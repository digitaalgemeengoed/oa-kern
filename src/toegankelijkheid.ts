import { heeftVermogen, type Adapter, type Bevinding, type Plek } from "@oa/contract";
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

/** Beoordelen: leest alleen, legt niets vast. */
export async function beoordeel(adapter: Adapter, verbinding: Verbinding): Promise<{ bevindingen: Bevinding[]; gecontroleerd: string[] }> {
  const inhoud = await adapter.leverInhoud();
  return verbinding.toegankelijkheid(inhoud);
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
