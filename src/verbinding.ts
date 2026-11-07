import {
  LEES,
  VASTLEG,
  type Fout,
  type Gebeurtenis,
  type Inhoud,
  type Objecttype,
  type ToegankelijkheidAntwoord,
  type WieBenIk,
  type Informatieobject,
} from "@digitaalgemeengoed/oa-contract";

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
  objecttype(naam: string) {
    return this.vraag<Objecttype>(LEES.objecttype(naam));
  }
  object(id: string) {
    return this.vraag<ObjectMetStaat>(LEES.object(id));
  }
  gebeurtenissen(id: string) {
    return this.vraag<Gebeurtenis[]>(LEES.gebeurtenissen(id));
  }
  toegankelijkheid(inhoud: Inhoud, taal?: string) {
    return this.vraag<ToegankelijkheidAntwoord>(LEES.toegankelijkheid, { method: "POST", body: JSON.stringify({ inhoud, taal }) });
  }
  maakObject(objecttype: string, metadata: Record<string, unknown>, inhoud?: Inhoud) {
    return this.vraag<ObjectMetStaat>(VASTLEG.objecten, { method: "POST", body: JSON.stringify({ objecttype, metadata, inhoud }) });
  }
  legMetadataVast(id: string, metadata: Record<string, unknown>, verwachteVolgnummer?: number) {
    return this.vraag<ObjectMetStaat>(VASTLEG.metadata(id), { method: "PUT", body: JSON.stringify({ metadata, verwachteVolgnummer }) });
  }
  voegVersieToe(id: string, inhoud: Inhoud) {
    return this.vraag<ObjectMetStaat>(VASTLEG.versies(id), { method: "POST", body: JSON.stringify({ inhoud }) });
  }
}
