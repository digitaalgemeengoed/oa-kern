import { heeftVermogen, type Adapter, type Bevinding, type Inhoud, type Plek } from "@digitaalgemeengoed/oa-contract";
import type { Verbinding } from "./verbinding.js";

export type Wijziging =
  | { soort: "vervang"; html: string }
  | { soort: "attribuut"; naam: string; waarde: string }
  | { soort: "tekst"; waarde: string };

export interface Uitkomst {
  /** Gezet als de werkomgeving het niet direct kon en de assistent terugviel. */
  terugval?: string;
}

/** Een documentparser; in de browser DOMParser, in tests linkedom. */
export type Parser = (html: string) => Document;

export const browserParser: Parser = (html) => new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");

/** Zoekt het element op een pad als "body/1/0": elementindices vanaf body. */
export function zoekElement(doc: Document, pad: string): Element | null {
  const delen = pad.split("/");
  if (delen[0] !== "body") return null;
  let e: Element | null = doc.body;
  for (const d of delen.slice(1)) {
    if (!e) return null;
    e = e.children.item(Number(d));
  }
  return e;
}

/** Past een wijziging toe op het element op een plek; geeft het nieuwe element en document terug. */
export function pasToe(parser: Parser, html: string, plek: Plek, w: Wijziging): { element: string; document: string } {
  const doc = parser(html);
  const e = zoekElement(doc, plek.pad);
  if (!e) throw new Error(`Het element op ${plek.beschrijving} is niet meer gevonden. Beoordeel opnieuw.`);
  let nieuw: string;
  if (w.soort === "vervang") {
    e.outerHTML = w.html;
    nieuw = w.html;
  } else if (w.soort === "attribuut") {
    e.setAttribute(w.naam, w.waarde);
    nieuw = e.outerHTML;
  } else {
    e.textContent = w.waarde;
    nieuw = e.outerHTML;
  }
  return { element: nieuw, document: doc.body.innerHTML };
}

/** Wat een voorstel concreet wijzigt, met het antwoord van de medewerker als het een vraag stelt. */
export function wijzigingVoor(b: Bevinding, antwoord?: string): Wijziging | null {
  const v = b.voorstel;
  if (!v) return null;
  if (v.vervanging) return { soort: "vervang", html: v.vervanging };
  if (v.vraag && antwoord !== undefined) {
    return v.vraag.veld === "tekst" ? { soort: "tekst", waarde: antwoord } : { soort: "attribuut", naam: v.vraag.veld, waarde: antwoord };
  }
  return null;
}

/** Zo groot mag het bestand (base64) zijn; de integratielaag neemt tot 30 MB aan, met de html erbij. */
export const MAX_BESTAND_BASE64 = 26 * 1024 * 1024;

/**
 * Beoordelen: leest alleen, legt niets vast. Kan de werkomgeving het bestand
 * opleveren, dan gaat dat mee (liefst als docx, xlsx of pptx): daarin ziet de
 * controle wat de html niet laat zien, zoals titel, taal en contrast. Lukt
 * dat niet, dan alleen de html.
 */
export async function beoordeel(adapter: Adapter, verbinding: Verbinding): Promise<{ bevindingen: Bevinding[]; gecontroleerd: string[] }> {
  const inhoud = await adapter.leverInhoud();
  let bestand: Inhoud | undefined;
  let teGroot = false;
  if (adapter.leverBestand && heeftVermogen(adapter.werkomgeving(), "bestand-opleveren")) {
    try {
      const b = await adapter.leverBestand("ooxml");
      if (b.codering === "base64" && b.data.length <= MAX_BESTAND_BASE64) bestand = b;
      else teGroot = b.data.length > MAX_BESTAND_BASE64;
    } catch {
      /* Zonder bestand: alleen de html. */
    }
  }
  const r = await verbinding.toegankelijkheid(inhoud, undefined, bestand);
  if (teGroot) {
    r.bevindingen.push({
      id: "tg-te-groot",
      module: "toegankelijkheid",
      ernst: "advies",
      regel: "—",
      melding: "Het bestand is te groot voor de uitgebreide controle (titel, taal, contrast). De inhoud is wel beoordeeld.",
      bron: "bestand",
    });
  }
  return r;
}

/**
 * Herstelt één bevinding in de werkomgeving. Kan de werkomgeving een deel
 * vervangen, dan alleen dat deel; anders gaat het hele document heen en weer
 * en zegt de assistent dat.
 */
export async function herstel(adapter: Adapter, b: Bevinding, antwoord: string | undefined, parser: Parser = browserParser): Promise<Uitkomst> {
  const w = wijzigingVoor(b, antwoord);
  if (!w || !b.plek) throw new Error("Deze bevinding kan de assistent niet zelf herstellen.");
  const inhoud = await adapter.leverInhoud();
  const r = pasToe(parser, inhoud.data, b.plek, w);
  const omgeving = adapter.werkomgeving();
  if (adapter.vervangSegment && heeftVermogen(omgeving, "segment-vervangen")) {
    await adapter.vervangSegment(b.plek, r.element);
    return {};
  }
  await adapter.vervangInhoud({ ...inhoud, data: r.document });
  return { terugval: "Deze werkomgeving kan geen deel van het document vervangen. Het document is opnieuw geladen." };
}
