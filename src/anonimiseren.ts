import { heeftVermogen, type Adapter, type AnonimiseerAntwoord, type Inhoud, type PiiCategorie, type PiiInvoer, type PiiSoort, type Treffer } from "@digitaalgemeengoed/oa-contract";
import type { Verbinding } from "./verbinding.js";
import { legVersieVast, type Stand } from "./vastleggen.js";

/**
 * Anonimiseren bij de bron, in drie stappen (zoals de MIRA-demo):
 *  1. vinden: de dienst zoekt persoonsgegevens in de html van het stuk;
 *  2. kiezen: de medewerker zet onterechte treffers terug en voegt gemiste
 *     toe, ook uit een selectie in het document (dat gebeurt in het paneel;
 *     tot dan is alles een voorbeeld);
 *  3. bevestigen: het platform versleutelt elk gekozen gegeven in het
 *     register (een sleutel per document per AVG-categorie) en geeft een
 *     plaatshouder terug ([PERSOON 1]); de werkomgeving vervangt het gegeven
 *     in het document zelf door die plaatshouder, en de assistent legt dat
 *     vast als nieuwe versie. Eerdere versies bevatten de gegevens nog; die
 *     mag alleen PPL 3 lezen.
 */

export interface Gevonden extends AnonimiseerAntwoord {
  /** De html waarop de treffers slaan; bevestigen gebruikt precies deze. */
  inhoud: Inhoud;
}

export async function vind(adapter: Adapter, verbinding: Verbinding): Promise<Gevonden> {
  const inhoud = await adapter.leverInhoud();
  if (inhoud.formaat !== "html") throw new Error("Anonimiseren kan in deze werkomgeving nog niet: de assistent krijgt geen html.");
  const antwoord = await verbinding.anonimiseren(inhoud);
  return { ...antwoord, inhoud };
}

/** Elke plek waar dezelfde tekst nog eens staat (hoofdletters gelijk), als nieuwe treffer van de medewerker. */
export function overal(gevonden: Pick<Gevonden, "tekst" | "treffers">, tekst: string, soort: PiiSoort): Treffer[] {
  const t = tekst.trim();
  if (t.length < 2) return [];
  const uit: Treffer[] = [];
  let i = gevonden.tekst.indexOf(t);
  while (i >= 0) {
    const begin = i;
    const eind = i + t.length;
    const randOk = !/[\p{L}\p{N}]/u.test(gevonden.tekst[begin - 1] ?? "") && !/[\p{L}\p{N}]/u.test(gevonden.tekst[eind] ?? "");
    if (randOk && !gevonden.treffers.some((x) => begin < x.eind && x.begin < eind)) {
      uit.push({ id: `mw-${begin}-${eind}`, soort, tekst: t, begin, eind, score: 1, bron: "medewerker" });
    }
    i = gevonden.tekst.indexOf(t, i + 1);
  }
  return uit;
}

export interface Bevestigd {
  stand: Stand;
  /** Per gekozen waarde de plaatshouder; dezelfde waarde staat er één keer in. */
  registraties: { waarde: string; plaatshouder: string; soort: PiiSoort; categorie: PiiCategorie; nieuw: boolean }[];
  /** Zoveel keer is een waarde in het document vervangen. */
  vervangen: number;
  /** Zoveel keer staat een waarde na het vervangen nog in het document (bv. over opmaak heen). */
  resterend: number;
}

/** Kan deze werkomgeving persoonsgegevens in het document zelf vervangen? */
export function kanBijDeBron(adapter: Adapter): boolean {
  return !!adapter.vervangTekst && heeftVermogen(adapter.werkomgeving(), "tekst-vervangen");
}

export async function bevestig(adapter: Adapter, verbinding: Verbinding, stand: Stand, gekozen: Pick<Treffer, "soort" | "tekst" | "bron">[]): Promise<Bevestigd> {
  const object = stand.object;
  if (!object) throw new Error("Leg het stuk eerst vast: het register van persoonsgegevens hoort bij een geregistreerd stuk.");
  if (!kanBijDeBron(adapter)) throw new Error("Deze werkomgeving kan tekst in het document niet vervangen. Anonimiseren bij de bron kan hier niet.");

  // Elke waarde één keer; dezelfde tekst als andere soort telt apart (het register doet hetzelfde).
  const items: PiiInvoer[] = [];
  const gezien = new Set<string>();
  for (const t of gekozen) {
    const waarde = t.tekst.replace(/\s+/g, " ").trim();
    const k = `${t.soort}\0${waarde}`;
    if (!waarde || gezien.has(k)) continue;
    gezien.add(k);
    items.push({ soort: t.soort, waarde, bron: t.bron });
  }
  if (!items.length) throw new Error("Kies eerst welke persoonsgegevens geanonimiseerd worden.");

  // 1. Registreren (versleuteld). Lukt het vervangen daarna niet, dan is er niets verloren:
  //    opnieuw bevestigen geeft dezelfde plaatshouders.
  const { plaatshouders } = await verbinding.registreerPii(object.identificatie, items);
  const registraties = items.map((it, i) => ({ waarde: it.waarde, ...plaatshouders[i]! }));

  // 2. In het document zelf vervangen.
  const paren = registraties.map((r) => ({ van: r.waarde, naar: r.plaatshouder }));
  const vervangen = await adapter.vervangTekst!(paren);
  const na = await adapter.leverInhoud();
  const resterend = na.formaat === "html" ? telInHtml(na.data, paren) : 0;

  // 3. De geanonimiseerde stand als nieuwe versie vastleggen.
  const nieuw = await legVersieVast(adapter, verbinding, stand);
  return { stand: nieuw, registraties, vervangen, resterend };
}

/** Hoe vaak de waarden als heel woord nog in de tekst van de html staan. */
export function telInHtml(html: string, paren: { van: string }[]): number {
  let tekst = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  let n = 0;
  // Langste eerst, en wat geteld is weghalen: "Jan de Vries" telt niet ook als "Jan".
  for (const { van } of [...paren].sort((a, b) => b.van.length - a.van.length)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${van.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "gu");
    tekst = tekst.replace(re, () => {
      n++;
      return " ";
    });
  }
  return n;
}
