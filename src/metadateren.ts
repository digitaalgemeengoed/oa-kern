import type { Bevinding, Inhoud, Objecttype } from "@oa/contract";

/** Een invoerveld, afgeleid uit het schema van het objecttype. */
export interface Veld {
  naam: string;
  label: string;
  beschrijving?: string;
  soort: "tekst" | "lange-tekst" | "keuze";
  verplicht: boolean;
  opties?: string[];
  maxLengte?: number;
  standaard?: string;
}

interface Eigenschap {
  type?: string;
  enum?: string[];
  title?: string;
  description?: string;
  maxLength?: number;
  default?: string;
}

/** De velden van een objecttype, verplichte eerst, in de volgorde van het schema. */
export function velden(type: Objecttype): Veld[] {
  const s = type.schema as { properties?: Record<string, Eigenschap>; required?: string[] };
  const verplicht = new Set(s.required ?? []);
  const lijst = Object.entries(s.properties ?? {}).map(([naam, e]): Veld => ({
    naam,
    label: e.title ?? naam,
    beschrijving: e.description,
    soort: e.enum ? "keuze" : (e.maxLength ?? 0) > 400 ? "lange-tekst" : "tekst",
    verplicht: verplicht.has(naam),
    opties: e.enum,
    maxLengte: e.maxLength,
    standaard: e.default,
  }));
  return [...lijst.filter((v) => v.verplicht), ...lijst.filter((v) => !v.verplicht)];
}

/**
 * Voorstellen uit de inhoud zelf. De medewerker beslist; een voorstel is
 * nooit vastgelegd zonder dat hij het ziet.
 */
export function suggesties(inhoud: Inhoud, huidig: Record<string, unknown>): Record<string, string> {
  const s: Record<string, string> = {};
  if (inhoud.formaat === "html" && !huidig.naam) {
    const m = inhoud.data.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const titel = m?.[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (titel && titel.length >= 3) s.naam = titel.slice(0, 200);
  }
  if (!huidig.taal) s.taal = "nl";
  return s;
}

/** Ontbrekende verplichte velden als bevindingen, zodat het paneel ze naast de rest toont. */
export function bevindingen(type: Objecttype, metadata: Record<string, unknown>): Bevinding[] {
  return velden(type)
    .filter((v) => v.verplicht && (metadata[v.naam] === undefined || metadata[v.naam] === ""))
    .map((v) => ({
      id: `md-${v.naam}`,
      module: "metadateren" as const,
      ernst: "fout" as const,
      regel: `MDTO ${v.naam}`,
      melding: `${v.label} is nog niet ingevuld.`,
    }));
}

/** Alleen ingevulde waarden; lege velden gaan niet als lege tekst naar het platform. */
export function opgeschoond(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).filter(([, w]) => w !== undefined && w !== null && w !== ""));
}
