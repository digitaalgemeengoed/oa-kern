import {
  type Aard,
  type AnonimiseerAntwoord,
  type AnonimiseringsMeting,
  type PiiCategorie,
  type PiiInvoer,
  type PiiOnthuld,
  type PiiRegister,
  type PiiSoort,
  type ToepassenAntwoord,
  LEES,
  VASTLEG,
  type Fout,
  type Gebeurtenis,
  type Inhoud,
  type Objecttype,
  type ToegankelijkheidAntwoord,
  type WieBenIk,
  type Informatieobject,
  type Zoekvraag,
  type Zoekantwoord,
  type Classificatiemodel,
  type Procestype,
  type SelectielijstResultaat,
  type Afwijking,
  type Wijzigingsvoorstel,
} from "@digitaalgemeengoed/oa-contract";

/** Het classificatiemodel dat nu geldt, met de resultaten uit de selectielijst die de gemeente gebruikt. */
export interface ClassificatieAntwoord {
  model: Classificatiemodel | null;
  selectielijst?: { id: string; naam: string; toelichting: string; procestypen: Procestype[]; resultaten: (SelectielijstResultaat & { afwijking?: Afwijking })[] };
}

export interface ObjectMetStaat extends Informatieobject {
  volgnummer: number;
  volledigheid: { volledig: boolean; ontbreekt: string[] };
}

export class VerbindingsFout extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    melding: string,
    readonly details?: unknown,
  ) {
    super(melding);
  }
  /** Platform of dienst weg: de assistent biedt niet aan wat zij niet kan waarmaken. */
  get nietBereikbaar(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

/**
 * De verbinding met de integratielaag. De kern praat alleen hiermee; de
 * sessie zit in een httpOnly-cookie, dus hier staan geen tokens.
 */
export class Verbinding {
  constructor(
    private readonly basis = "",
    private readonly doeFetch: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async vraag<T>(pad: string, init: RequestInit = {}): Promise<T> {
    let r: Response;
    try {
      r = await this.doeFetch(`${this.basis}${pad}`, {
        ...init,
        credentials: "same-origin",
        headers: { ...(init.body ? { "content-type": "application/json" } : {}), "x-oa-verzoek": "1", ...(init.headers ?? {}) },
      });
    } catch {
      throw new VerbindingsFout(0, "niet-bereikbaar", "De assistent kan de server nu niet bereiken.");
    }
    if (!r.ok) {
      let f: Partial<Fout> = {};
      try {
        f = await r.json();
      } catch {
        /* geen json */
      }
      throw new VerbindingsFout(r.status, f.fout ?? "fout", f.melding ?? `Fout ${r.status}`, f.details);
    }
    return (await r.json()) as T;
  }

  wieBenIk() {
    return this.vraag<WieBenIk>(LEES.wieBenIk);
  }
  /** Het actieve objecttype, of de versie waarmee een stuk is vastgelegd. */
  objecttype(naam: string, versie?: number) {
    return this.vraag<Objecttype>(LEES.objecttype(naam, versie));
  }
  object(id: string) {
    return this.vraag<ObjectMetStaat>(LEES.object(id));
  }
  gebeurtenissen(id: string) {
    return this.vraag<Gebeurtenis[]>(LEES.gebeurtenissen(id));
  }
  toegankelijkheid(inhoud: Inhoud, taal?: string, bestand?: Inhoud) {
    return this.vraag<ToegankelijkheidAntwoord>(LEES.toegankelijkheid, { method: "POST", body: JSON.stringify({ inhoud, taal, bestand }) });
  }
  anonimiseren(inhoud: Inhoud) {
    return this.vraag<AnonimiseerAntwoord>(LEES.anonimiseren, { method: "POST", body: JSON.stringify({ inhoud }) });
  }
  anonimiserenToepassen(inhoud: Inhoud, treffers: { begin: number; eind: number; soort: PiiSoort }[]) {
    return this.vraag<ToepassenAntwoord>(LEES.anonimiserenToepassen, { method: "POST", body: JSON.stringify({ inhoud, treffers }) });
  }
  legAnonimiseringVast(id: string, nummer: number, inhoud: Inhoud, overzicht: Partial<Record<PiiSoort, number>>) {
    return this.vraag<ObjectMetStaat>(VASTLEG.anonimisering(id, nummer), { method: "POST", body: JSON.stringify({ inhoud, overzicht }) });
  }
  /** Persoonsgegevens versleuteld registreren; dezelfde waarde krijgt dezelfde plaatshouder. */
  registreerPii(id: string, items: PiiInvoer[], voorvertoning = false) {
    return this.vraag<{ plaatshouders: { plaatshouder: string; soort: PiiSoort; categorie: PiiCategorie; nieuw: boolean }[] }>(VASTLEG.pii(id), {
      method: "POST",
      body: JSON.stringify({ items, ...(voorvertoning ? { voorvertoning } : {}) }),
    });
  }
  /** Voorvertoningen die de medewerker laat staan, uit het register. */
  vervallenPii(id: string, plaatshouders: string[]) {
    return this.vraag<PiiRegister>(VASTLEG.piiVervallen(id), { method: "POST", body: JSON.stringify({ plaatshouders }) });
  }
  /** Een voorvertoning in een andere AVG-categorie (grondslag); de plaatshouder blijft. */
  wijzigPiiCategorie(id: string, plaatshouder: string, categorie: PiiCategorie) {
    return this.vraag<{ plaatshouder: string; soort: PiiSoort; categorie: PiiCategorie }>(VASTLEG.piiCategorie(id), {
      method: "POST",
      body: JSON.stringify({ plaatshouder, categorie }),
    });
  }
  /** Bevestigen: register definitief en het geanonimiseerde document als nieuwe versie. */
  bevestigPii(id: string, v: { inhoud: Inhoud; weergave?: Inhoud; bronversie: number; behouden: string[]; meting?: AnonimiseringsMeting }) {
    return this.vraag<ObjectMetStaat>(VASTLEG.piiBevestig(id), { method: "POST", body: JSON.stringify(v) });
  }
  /** Bevestigde gegevens terugzetten: de waarden, binnen het eigen niveau. */
  terugzettenPii(id: string, plaatshouders: string[]) {
    return this.vraag<{ waarden: PiiOnthuld[] }>(VASTLEG.piiTerugzetten(id), { method: "POST", body: JSON.stringify({ plaatshouders }) });
  }
  /** Een eerdere versie terugzetten als nieuwe versie (niveau van die versie, met reden). */
  versieTerugzetten(id: string, nummer: number, reden: string) {
    return this.vraag<ObjectMetStaat>(VASTLEG.versieTerugzetten(id, nummer), { method: "POST", body: JSON.stringify({ reden }) });
  }
  /** De html van een versie: de versie zelf of haar html-weergave. */
  async versieHtml(id: string, versie: { nummer: number; formaat: string }): Promise<string> {
    const pad = versie.formaat === "html" ? LEES.inhoud(id, versie.nummer) : LEES.weergave(id, versie.nummer, "html");
    let r: Response;
    try {
      r = await this.doeFetch(`${this.basis}${pad}`, { credentials: "same-origin", headers: { "x-oa-verzoek": "1" } });
    } catch {
      throw new VerbindingsFout(0, "niet-bereikbaar", "De assistent kan de server nu niet bereiken.");
    }
    if (!r.ok) {
      const f = (await r.json().catch(() => ({}))) as Partial<Fout>;
      throw new VerbindingsFout(r.status, f.fout ?? "fout", f.melding ?? `Fout ${r.status}`);
    }
    return r.text();
  }
  piiRegister(id: string) {
    return this.vraag<PiiRegister>(LEES.pii(id));
  }
  /** De oorspronkelijke waarden; het platform toetst het niveau (PPL) en legt het inzien vast. */
  onthulPii(id: string, plaatshouders: string[]) {
    return this.vraag<{ waarden: PiiOnthuld[] }>(VASTLEG.piiOnthul(id), { method: "POST", body: JSON.stringify({ plaatshouders }) });
  }
  /** De sleutel van een categorie vernietigen (alleen beheerder): die waarden zijn daarna onleesbaar. */
  vernietigPii(id: string, categorie: PiiCategorie, reden: string, originelen: "laten" | "beperken" = "laten") {
    return this.vraag<PiiRegister>(VASTLEG.piiVernietig(id), { method: "POST", body: JSON.stringify({ categorie, reden, originelen }) });
  }
  zoeken(vraag: Zoekvraag) {
    return this.vraag<Zoekantwoord>(LEES.zoeken(vraag));
  }
  /** Sleutel vernietigen; alleen voor de rol beheerder. */
  maakOnleesbaar(id: string, reden: string) {
    return this.vraag<ObjectMetStaat>(VASTLEG.onleesbaar(id), { method: "POST", body: JSON.stringify({ reden }) });
  }
  maakObject(objecttype: string, metadata: Record<string, unknown>, inhoud?: Inhoud, weergave?: Inhoud, aard?: Aard) {
    return this.vraag<ObjectMetStaat>(VASTLEG.objecten, { method: "POST", body: JSON.stringify({ objecttype, aard, metadata, inhoud, weergave }) });
  }
  /** Zakelijk of persoonlijk; het platform staat in het prototype alleen persoonlijk naar zakelijk toe. */
  wijzigAard(id: string, aard: Aard) {
    return this.vraag<ObjectMetStaat>(VASTLEG.aard(id), { method: "PUT", body: JSON.stringify({ aard }) });
  }
  legMetadataVast(id: string, metadata: Record<string, unknown>, verwachteVolgnummer?: number) {
    return this.vraag<ObjectMetStaat>(VASTLEG.metadata(id), { method: "PUT", body: JSON.stringify({ metadata, verwachteVolgnummer }) });
  }
  /** Met de selectielijst (voor Classificeren), of alleen het model. */
  classificatie(alleenModel = false) {
    return this.vraag<ClassificatieAntwoord>(alleenModel ? LEES.classificatiemodel : LEES.classificatie);
  }
  legClassificatieVast(id: string, keuze: { resultaat: string; attributen?: Record<string, string | boolean>; einddatumProcesobject?: string }, verwachteVolgnummer?: number) {
    return this.vraag<ObjectMetStaat>(VASTLEG.classificatie(id), { method: "PUT", body: JSON.stringify({ ...keuze, verwachteVolgnummer }) });
  }
  /** Bij een vergrendeld stuk: de wijziging als voorstel, naast het stuk. */
  dienVoorstelIn(id: string, inhoud: Inhoud, weergave: Inhoud | undefined, reden: string) {
    return this.vraag<Wijzigingsvoorstel>(VASTLEG.voorstel(id), { method: "POST", body: JSON.stringify({ inhoud, weergave, reden }) });
  }
  /** Met een object: de voorstellen bij dat stuk. Zonder: de open voorstellen (alleen een vrijgever). */
  voorstellen(object?: string) {
    return this.vraag<Wijzigingsvoorstel[]>(LEES.voorstellen(object));
  }
  voorstelWeergave(id: string) {
    return this.vraag<Inhoud>(LEES.voorstelWeergave(id));
  }
  beoordeel(id: string, besluit: "goedkeuren" | "afwijzen", toelichting?: string) {
    return this.vraag<Wijzigingsvoorstel>(VASTLEG.beoordeling(id), { method: "POST", body: JSON.stringify({ besluit, ...(toelichting ? { toelichting } : {}) }) });
  }
  voegVersieToe(id: string, inhoud: Inhoud, weergave?: Inhoud) {
    return this.vraag<ObjectMetStaat>(VASTLEG.versies(id), { method: "POST", body: JSON.stringify({ inhoud, weergave }) });
  }
}
