import type { Adapter, AnonimiseerAntwoord, Inhoud, PiiSoort, Treffer } from "@digitaalgemeengoed/oa-contract";
import type { Verbinding } from "./verbinding.js";
import { vergelijkMetLaatsteVersie, type Stand } from "./vastleggen.js";

/**
 * Anonimiseren, in drie stappen:
 *  1. vinden: de dienst zoekt persoonsgegevens in de html van het stuk;
 *  2. kiezen: de medewerker zet onterechte treffers terug en voegt gemiste
 *     toe (dat gebeurt in het paneel; tot dan is alles een voorbeeld);
 *  3. bevestigen: de dienst schermt de gekozen treffers af en het platform
 *     legt de geanonimiseerde weergave vast bij de laatste versie. Het
 *     origineel en het document zelf blijven ongewijzigd.
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

export async function bevestig(
  verbinding: Verbinding,
  stand: Stand,
  gevonden: Gevonden,
  gekozen: Treffer[],
): Promise<{ stand: Stand; overzicht: Partial<Record<PiiSoort, number>> }> {
  const object = stand.object;
  const laatste = object?.versies.at(-1);
  if (!object || !laatste) throw new Error("Leg het stuk eerst vast: de geanonimiseerde weergave hoort bij een versie.");
  if ((await vergelijkMetLaatsteVersie(stand, gevonden.inhoud)) !== "gelijk") {
    throw new Error(`Het stuk wijkt af van versie ${laatste.nummer}. Leg eerst een nieuwe versie vast; de geanonimiseerde weergave hoort bij precies die inhoud.`);
  }
  const r = await verbinding.anonimiserenToepassen(
    gevonden.inhoud,
    gekozen.map(({ begin, eind, soort }) => ({ begin, eind, soort })),
  );
  const nieuw = await verbinding.legAnonimiseringVast(object.identificatie, laatste.nummer, r.inhoud, r.overzicht);
  return { stand: { ...stand, object: nieuw }, overzicht: r.overzicht };
}
