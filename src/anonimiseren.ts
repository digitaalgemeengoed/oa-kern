import {
  heeftVermogen,
  PII_CATEGORIE,
  PII_SOORT,
  type Adapter,
  type AnonimiseerAntwoord,
  type Inhoud,
  type PiiCategorie,
  type PiiInvoer,
  type PiiPlek,
  type PiiSoort,
  type Ppl,
  type Treffer,
} from "@digitaalgemeengoed/oa-contract";
import type { Verbinding } from "./verbinding.js";
import { legVersieVast, naVersie, teBewaren, vergelijkMetLaatsteVersie, type Stand } from "./vastleggen.js";

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

// ---------------------------------------------------------------------------
// Anonimiseren in het document (zoals de MIRA-demo). De plaatshouders staan al
// tijdens de voorvertoning in het document; het origineel is dan al als
// versie vastgelegd, en de gegevens staan versleuteld in het register als
// voorvertoning. De originele waarden ziet de medewerker alleen in het paneel.
// ---------------------------------------------------------------------------

/** Eén persoonsgegeven in de sessie: een kaart in het paneel. */
export interface PiiKaart {
  /** Sleutel van de kaart: de plaatshouder, of voor wat blijft staan `soort\0waarde`. */
  sleutel: string;
  plaatshouder: string | null;
  soort: PiiSoort;
  categorie: PiiCategorie;
  ppl: Ppl;
  status: "voorvertoning" | "bevestigd" | "laat-staan";
  bron: Treffer["bron"];
  /** Zekerheid van de herkenning (0 tot 1); ontbreekt bij handmatig. */
  score?: number;
  /** Alleen in het geheugen van het paneel; na hervatten via inzien. */
  waarde?: string;
  /** De plekken in het document. */
  plekken: string[];
}

export interface Sessie {
  /** Het origineel: de versie waar deze anonimisering van uitgaat. */
  bronversie: number;
  kaarten: PiiKaart[];
  motor?: string;
}

const normaal = (w: string) => w.replace(/\s+/g, " ").trim();
const sleutelVan = (soort: PiiSoort, waarde: string) => `${soort}\u0000${normaal(waarde)}`;

/** Kan deze werkomgeving plaatshouders in het document zetten en terugzetten? */
export function kanInDocument(adapter: Adapter): boolean {
  const w = adapter.werkomgeving();
  return heeftVermogen(w, "pii-markeren") && !!adapter.markeerPii && !!adapter.leesPiiPlekken && !!adapter.herstelPii;
}

/**
 * Stap 0: het origineel vastleggen. Wijkt het stuk af van de laatste versie
 * (of is dat niet na te gaan), dan eerst een nieuwe versie.
 */
export async function begin(adapter: Adapter, verbinding: Verbinding, stand: Stand): Promise<{ stand: Stand; bronversie: number }> {
  if (!stand.object) throw new Error("Leg het stuk eerst vast: anonimiseren maakt een nieuwe versie, en het origineel blijft bewaard.");
  // Staan er al voorvertoningen in het document, dan loopt er een sessie: het origineel is de laatste versie.
  if (await loopt(adapter, verbinding, stand)) return { stand, bronversie: stand.object.versies.at(-1)!.nummer };
  let s = stand;
  if ((await vergelijkMetLaatsteVersie(stand, await adapter.leverInhoud())) !== "gelijk") s = await legVersieVast(adapter, verbinding, stand);
  return { stand: s, bronversie: s.object!.versies.at(-1)!.nummer };
}

/**
 * Loopt er een sessie? Dan staan er plaatshouders in het document die in het
 * register nog voorvertoning zijn. Niet elke werkomgeving kan dat zelf in het
 * document bijhouden; het register weet het altijd.
 */
async function loopt(adapter: Adapter, verbinding: Verbinding, stand: Stand): Promise<boolean> {
  if (!adapter.leesPiiPlekken || !stand.object) return false;
  const plekken = await adapter.leesPiiPlekken();
  if (!plekken.length) return false;
  if (plekken.some((p) => p.voorvertoning)) return true;
  const register = await verbinding.piiRegister(stand.object.identificatie);
  const voorlopig = new Set(register.registraties.filter((r) => r.status === "voorvertoning").map((r) => r.plaatshouder));
  return plekken.some((p) => voorlopig.has(p.plaatshouder));
}

function kaartUit(r: { plaatshouder: string; soort: PiiSoort; categorie: PiiCategorie }, status: PiiKaart["status"], bron: Treffer["bron"], extra: Partial<PiiKaart> = {}): PiiKaart {
  return { sleutel: r.plaatshouder, plaatshouder: r.plaatshouder, soort: r.soort, categorie: r.categorie, ppl: PII_CATEGORIE[r.categorie].ppl, status, bron, plekken: [], ...extra };
}

/** Plekken uit het document bij de kaarten zetten (volgorde van het document). */
function verdeelPlekken(kaarten: PiiKaart[], plekken: PiiPlek[]): PiiKaart[] {
  const per = new Map<string, string[]>();
  for (const p of plekken) per.set(p.plaatshouder, [...(per.get(p.plaatshouder) ?? []), p.plek]);
  const met = kaarten.map((k) => (k.plaatshouder ? { ...k, plekken: per.get(k.plaatshouder) ?? [] } : k));
  const plekIndex = new Map(plekken.map((p, i) => [p.plek, i] as const));
  const positie = (k: PiiKaart) => (k.plekken.length ? (plekIndex.get(k.plekken[0]!) ?? 1e9) : 1e9);
  return met.sort((a, b) => positie(a) - positie(b));
}

/**
 * Stap 1: vinden, registreren als voorvertoning en in het document vervangen.
 * Wat standaard niet wordt geanonimiseerd (bv. data), staat als kaart
 * "blijft staan" klaar om toch te anonimiseren.
 */
export async function vindEnMarkeer(adapter: Adapter, verbinding: Verbinding, stand: Stand, lopend?: Sessie | null): Promise<{ stand: Stand; sessie: Sessie }> {
  if (!kanInDocument(adapter)) throw new Error("Deze werkomgeving kan geen plaatshouders in het document zetten.");
  const b = lopend ? { stand, bronversie: lopend.bronversie } : await begin(adapter, verbinding, stand);
  // Wat de medewerker in deze sessie liet staan, blijft staan bij opnieuw zoeken.
  const gelaten = new Map((lopend?.kaarten ?? []).filter((k) => k.status === "laat-staan").map((k) => [k.sleutel, k] as const));
  const g = await vind(adapter, verbinding);
  const groepen = new Map<string, Treffer>();
  for (const t of g.treffers) {
    const k = sleutelVan(t.soort, t.tekst);
    if (!normaal(t.tekst) || groepen.has(k)) continue;
    groepen.set(k, t);
  }
  const aan = [...groepen.values()].filter((t) => g.standaard.includes(t.soort) && !gelaten.has(sleutelVan(t.soort, t.tekst)));
  const uit = [...groepen.values()].filter((t) => !g.standaard.includes(t.soort) || gelaten.has(sleutelVan(t.soort, t.tekst)));
  const id = b.stand.object!.identificatie;
  const kaarten: PiiKaart[] = [];
  if (aan.length) {
    const { plaatshouders } = await verbinding.registreerPii(
      id,
      aan.map((t) => ({ soort: t.soort, waarde: normaal(t.tekst), bron: t.bron })),
      true,
    );
    // Wat al als plaatshouder in het document staat, niet opnieuw: de medewerker kan er een plek van hebben laten staan.
    const alAanwezig = new Set((await adapter.leesPiiPlekken!()).map((p) => p.plaatshouder));
    const markeringen = aan
      .map((t, i) => ({ van: normaal(t.tekst), plaatshouder: plaatshouders[i]!.plaatshouder, ppl: PII_CATEGORIE[plaatshouders[i]!.categorie].ppl, voorvertoning: true }))
      .filter((m) => !alAanwezig.has(m.plaatshouder));
    if (markeringen.length) await adapter.markeerPii!(markeringen);
    aan.forEach((t, i) => {
      const r = plaatshouders[i]!;
      if (!kaarten.some((k) => k.plaatshouder === r.plaatshouder))
        kaarten.push(kaartUit(r, "voorvertoning", t.bron, { score: t.bron === "medewerker" ? undefined : t.score, waarde: normaal(t.tekst) }));
    });
  }
  // Plaatshouders die al in het document staan (deze sessie, of eerder bevestigd) horen er ook bij.
  const register = await verbinding.piiRegister(id);
  for (const r of register.registraties) {
    if (kaarten.some((k) => k.plaatshouder === r.plaatshouder)) continue;
    const eerder = lopend?.kaarten.find((k) => k.plaatshouder === r.plaatshouder);
    kaarten.push(eerder ? { ...eerder } : kaartUit(r, (r.status ?? "bevestigd") === "voorvertoning" ? "voorvertoning" : "bevestigd", r.bron));
  }
  const plekken = await adapter.leesPiiPlekken!();
  const gesorteerd = verdeelPlekken(kaarten, plekken).filter((k) => k.plekken.length);
  for (const t of uit)
    gesorteerd.push({
      sleutel: sleutelVan(t.soort, t.tekst),
      plaatshouder: null,
      soort: t.soort,
      categorie: PII_SOORT[t.soort].categorie,
      ppl: PII_CATEGORIE[PII_SOORT[t.soort].categorie].ppl,
      status: "laat-staan",
      bron: t.bron,
      score: t.score,
      waarde: normaal(t.tekst),
      plekken: [],
    });
  return { stand: b.stand, sessie: { bronversie: b.bronversie, kaarten: gesorteerd, motor: g.motor } };
}

/** Een sessie die nog loopt (voorvertoningen in het document) weer oppakken, bv. na heropenen. */
export async function hervat(adapter: Adapter, verbinding: Verbinding, stand: Stand): Promise<Sessie | null> {
  if (!stand.object || !kanInDocument(adapter)) return null;
  const plekken = await adapter.leesPiiPlekken!();
  const register = await verbinding.piiRegister(stand.object.identificatie);
  const voorlopig = new Set(register.registraties.filter((r) => r.status === "voorvertoning").map((r) => r.plaatshouder));
  if (!plekken.some((p) => p.voorvertoning || voorlopig.has(p.plaatshouder))) return null;
  const kaarten = register.registraties.map((r) => kaartUit(r, r.status === "voorvertoning" ? "voorvertoning" : "bevestigd", r.bron));
  return { bronversie: stand.object.versies.at(-1)!.nummer, kaarten: verdeelPlekken(kaarten, plekken).filter((k) => k.plekken.length) };
}

/**
 * Iets anonimiseren dat de herkenning miste (een selectie in het document),
 * of een kaart die bleef staan toch anonimiseren: registreren als
 * voorvertoning en overal in het document vervangen.
 */
export async function voegToe(
  adapter: Adapter,
  verbinding: Verbinding,
  stand: Stand,
  sessie: Sessie,
  v: { waarde: string; soort: PiiSoort; bron?: Treffer["bron"]; categorie?: PiiCategorie },
): Promise<Sessie> {
  const waarde = normaal(v.waarde);
  if (waarde.length < 2) throw new Error("Selecteer eerst de tekst die je wilt anonimiseren.");
  const id = stand.object!.identificatie;
  const bron = v.bron ?? "medewerker";
  const afwijkend = v.categorie && v.categorie !== PII_SOORT[v.soort].categorie ? { categorie: v.categorie } : {};
  const { plaatshouders } = await verbinding.registreerPii(id, [{ soort: v.soort, waarde, bron, ...afwijkend }], true);
  const r = plaatshouders[0]!;
  const nieuw = await adapter.markeerPii!([{ van: waarde, plaatshouder: r.plaatshouder, ppl: PII_CATEGORIE[r.categorie].ppl, voorvertoning: true }]);
  if (!nieuw.length && r.nieuw) {
    await verbinding.vervallenPii(id, [r.plaatshouder]);
    throw new Error(`"${waarde}" staat niet (als heel woord) in het document.`);
  }
  const zonder = sessie.kaarten.filter((k) => k.sleutel !== sleutelVan(v.soort, waarde) && k.plaatshouder !== r.plaatshouder);
  const bestaand = sessie.kaarten.find((k) => k.plaatshouder === r.plaatshouder);
  const kaart = bestaand ?? kaartUit(r, "voorvertoning", bron, { waarde });
  const plekken = await adapter.leesPiiPlekken!();
  return { ...sessie, kaarten: verdeelPlekken([...zonder, { ...kaart, waarde: kaart.waarde ?? waarde }], plekken) };
}

/**
 * Een andere grondslag (AVG-categorie) voor een kaart. Een voorvertoning gaat
 * in het register over naar de sleutel van die categorie (het platform toetst
 * of je het origineel mag lezen) en krijgt in het document de kleur van het
 * nieuwe niveau. Bij een kaart die blijft staan geldt de keuze als je haar
 * toch anonimiseert. Een bevestigd gegeven kan niet: de grondslag ligt vast.
 */
export async function wijzigCategorie(adapter: Adapter, verbinding: Verbinding, stand: Stand, sessie: Sessie, sleutel: string, categorie: PiiCategorie): Promise<Sessie> {
  const kaart = sessie.kaarten.find((k) => k.sleutel === sleutel);
  if (!kaart || kaart.categorie === categorie) return sessie;
  const ppl = PII_CATEGORIE[categorie].ppl;
  const vervang = (k: PiiKaart, plekken?: PiiPlek[]) => {
    const kaarten = sessie.kaarten.map((x) => (x === kaart ? { ...k, categorie, ppl } : x));
    return { ...sessie, kaarten: plekken ? verdeelPlekken(kaarten, plekken) : kaarten };
  };
  if (kaart.status === "laat-staan" || !kaart.plaatshouder) return vervang(kaart);
  if (kaart.status === "bevestigd") throw new Error("De grondslag van een bevestigd gegeven ligt vast. Zet het terug (De-anonimiseer) en anonimiseer het opnieuw met de juiste grondslag.");
  await verbinding.wijzigPiiCategorie(stand.object!.identificatie, kaart.plaatshouder, categorie);
  if (adapter.herkleurPii) {
    await adapter.herkleurPii(kaart.plaatshouder, ppl);
    return vervang(kaart);
  }
  // Zonder herkleuren: de plekken terugzetten (als platte plaatshouder) en opnieuw markeren.
  await adapter.herstelPii!(kaart.plekken.map((plek) => ({ plek, waarde: kaart.plaatshouder! })));
  await adapter.markeerPii!([{ van: kaart.plaatshouder, plaatshouder: kaart.plaatshouder, ppl, voorvertoning: true }]);
  return vervang(kaart, await adapter.leesPiiPlekken!());
}

/**
 * Laat staan: het origineel komt terug op alle plekken van de kaart, of op
 * één plek. Een voorvertoning zonder plekken vervalt; een bevestigd gegeven
 * terugzetten mag alleen binnen het eigen niveau (het platform toetst).
 */
export async function laatStaan(adapter: Adapter, verbinding: Verbinding, stand: Stand, sessie: Sessie, sleutel: string, plek?: string): Promise<Sessie> {
  const kaart = sessie.kaarten.find((k) => k.sleutel === sleutel);
  if (!kaart?.plaatshouder) return sessie;
  const id = stand.object!.identificatie;
  let waarde = kaart.waarde;
  if (kaart.status === "bevestigd") {
    waarde = (await verbinding.terugzettenPii(id, [kaart.plaatshouder])).waarden[0]?.waarde;
  } else if (waarde === undefined) {
    waarde = (await verbinding.onthulPii(id, [kaart.plaatshouder])).waarden[0]?.waarde;
  }
  if (waarde === undefined) throw new Error("De oorspronkelijke waarde is niet te achterhalen.");
  const weg = plek ? [plek] : kaart.plekken;
  await adapter.herstelPii!(weg.map((p) => ({ plek: p, waarde: waarde! })));
  // Wat er echt nog staat (niet elke werkomgeving kan één plek terugzetten).
  const nu = await adapter.leesPiiPlekken!();
  const rest = nu.filter((p) => p.plaatshouder === kaart.plaatshouder).map((p) => p.plek);
  if (rest.length) return { ...sessie, kaarten: verdeelPlekken(sessie.kaarten.map((k) => (k === kaart ? { ...k, waarde } : k)), nu) };
  if (kaart.status === "voorvertoning") await verbinding.vervallenPii(id, [kaart.plaatshouder]);
  const blijft: PiiKaart = { ...kaart, sleutel: sleutelVan(kaart.soort, waarde), plaatshouder: null, status: "laat-staan", plekken: [], waarde };
  return { ...sessie, kaarten: sessie.kaarten.map((k) => (k === kaart ? blijft : k)) };
}

/**
 * Stap 4: bevestigen. Wat nog in het document staat wordt definitief, de
 * markering is geen voorvertoning meer, en het document wordt een nieuwe
 * versie (soort anonimisering). Het origineel lezen kan daarna alleen PPL 3.
 */
export async function bevestigInDocument(adapter: Adapter, verbinding: Verbinding, stand: Stand, sessie: Sessie): Promise<{ stand: Stand; sessie: Sessie }> {
  const plekken = await adapter.leesPiiPlekken!();
  // Alles wat nog in het document staat; het platform maakt alleen de voorvertoningen definitief.
  const behouden = [...new Set(plekken.map((p) => p.plaatshouder))];
  await adapter.zetPiiDefinitief?.();
  const { inhoud, weergave } = await teBewaren(adapter);
  const object = await verbinding.bevestigPii(stand.object!.identificatie, { inhoud, weergave, bronversie: sessie.bronversie, behouden });
  const nieuw = await naVersie(adapter, stand, object);
  const kaarten = sessie.kaarten.map((k) => (k.status === "voorvertoning" && k.plaatshouder && behouden.includes(k.plaatshouder) ? { ...k, status: "bevestigd" as const } : k));
  return { stand: nieuw, sessie: { ...sessie, kaarten } };
}

/** Raadt de soort van een selectie (zoals de demo); de medewerker kan haar aanpassen. */
export function raadSoort(x: string): PiiSoort {
  const t = x.toLowerCase();
  if (/\b\d{9}\b/.test(t) && /bsn|^\d{9}$/.test(t)) return "bsn";
  if (/06[\s-]?\d{2,8}|0\d{2}[\s-]?\d{7}|\+31/.test(t)) return "telefoon";
  if (/@/.test(t) && /\.\w{2,}/.test(t)) return "e-mail";
  if (/\b[a-z]{2}\d{2}\s?[a-z]{4}\s?\d{4}/.test(t) || /iban/.test(t)) return "iban";
  if (/\d{4}\s?[a-z]{2}\b/.test(t) || /weg\b|straat|laan\b|plein|gracht|kade\b|singel|pad \d|pad\b/.test(t)) return "adres";
  if (/€\s?\d|euro|mln\b|bedrag/.test(t)) return "bedrag";
  if (/\d{1,2}[\s-](jan|feb|mrt|maart|apr|mei|jun|jul|aug|sep|okt|nov|dec)|\d{2}-\d{2}-\d{4}/.test(t)) return "datum";
  if (/gezondheid|ziekte|medisch|hart|diagnose|aandoening|stoornis|therapie|handicap|chronisch|mantelzorg|diabetes|kanker|depressie|ziekenhuis|medicijn|zwanger/.test(t)) return "gezondheid";
  if (/religie|geloof|kerk|moskee|synagoge/.test(t)) return "religie";
  if (/etniciteit|afkomst|huidskleur/.test(t)) return "etniciteit";
  if (/biometr|vingerafdruk|gezichtsherkenning/.test(t)) return "biometrie";
  if (/strafrecht|justitie|veroordeling|delict|reclassering/.test(t)) return "strafrechtelijk";
  if (/gemeente|stichting|vereniging|ministerie|provincie|b\.v\.|n\.v\.|\bbv\b|\bnv\b|advies/.test(t)) return "organisatie";
  if (/^(drs|mr|ir|prof|dr|mw|dhr|mevr|mevrouw|de heer|wethouder)\.?\s/i.test(x)) return "naam";
  if (/^[A-Z][a-zà-ü.]*(\s(van|de|den|der|het|ten|ter))*\s[A-Z]/.test(x) && x.split(/\s+/).length <= 5) return "naam";
  return "overig";
}

/**
 * Een eerdere versie terugzetten als nieuwe versie (het platform toetst het
 * niveau en vraagt een reden), en het document daarmee vullen.
 */
export async function zetVersieTerug(adapter: Adapter, verbinding: Verbinding, stand: Stand, nummer: number, reden: string): Promise<Stand> {
  const id = stand.object!.identificatie;
  const object = await verbinding.versieTerugzetten(id, nummer, reden);
  const laatste = object.versies.at(-1)!;
  const html = await verbinding.versieHtml(id, laatste);
  await adapter.vervangInhoud({ formaat: "html", mediaType: "text/html", codering: "tekst", data: html });
  return naVersie(adapter, stand, object);
}
