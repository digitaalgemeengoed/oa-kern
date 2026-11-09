import { METADATAMODELLEN, rollenVan, type Bevinding, type Inhoud, type ModelId, type Objecttype, type Rol } from "@digitaalgemeengoed/oa-contract";

/** Een invoerveld, afgeleid uit het schema van het objecttype. */
export interface Veld {
  naam: string;
  label: string;
  beschrijving?: string;
  soort: "tekst" | "lange-tekst" | "keuze" | "datum" | "getal";
  verplicht: boolean;
  /** Wat het veld betekent (titel, taal …), als het schema dat zegt. */
  rol?: Rol;
  /** Hoe het gekozen metadatamodel het element noemt, zoals "MDTO naam". */
  element?: string;
  opties?: string[];
  maxLengte?: number;
  standaard?: string;
}

interface Eigenschap {
  type?: string;
  "x-oa-type"?: string;
  "x-oa-rol"?: Rol;
  [model: `x-${string}`]: unknown;
  enum?: string[];
  title?: string;
  description?: string;
  maxLength?: number;
  default?: string;
}

/** De velden van een objecttype, verplichte eerst, in de volgorde van het schema. */
export function velden(type: Objecttype): Veld[] {
  const s = type.schema as { properties?: Record<string, Eigenschap>; required?: string[]; "x-oa-model"?: ModelId };
  const verplicht = new Set(s.required ?? []);
  const model = s["x-oa-model"] ?? "mdto";
  const rollen = rollenVan(type.schema);
  const lijst = Object.entries(s.properties ?? {}).map(([naam, e]): Veld => {
    const element = e[`x-${model}`];
    return {
      naam,
      label: e.title ?? naam,
      beschrijving: e.description,
      soort: e.enum
        ? "keuze"
        : e["x-oa-type"] === "datum"
          ? "datum"
          : e.type === "number" || e.type === "integer"
            ? "getal"
            : e["x-oa-type"] === "lange-tekst" || (e.maxLength ?? 0) > 400
              ? "lange-tekst"
              : "tekst",
      verplicht: verplicht.has(naam),
      rol: (Object.entries(rollen) as [Rol, string][]).find(([, k]) => k === naam)?.[0],
      element: typeof element === "string" ? `${METADATAMODELLEN[model]?.naam ?? model.toUpperCase()} ${element}` : undefined,
      opties: e.enum,
      maxLengte: e.maxLength,
      standaard: e.default,
    };
  });
  // Een gemeente die zelf de volgorde koos (beheerportaal): die volgorde. De
  // database bewaart de sleutels van het schema in een eigen volgorde; de
  // keuze zelf (x-oa-config) heeft de goede. Anders verplichte eerst.
  if (s["x-oa-model"]) {
    const config = (type.schema as { "x-oa-config"?: { velden?: { sleutel: string }[] } })["x-oa-config"];
    const plaats = new Map((config?.velden ?? []).map((v, i) => [v.sleutel, i] as const));
    return [...lijst].sort((a, b) => (plaats.get(a.naam) ?? 1e9) - (plaats.get(b.naam) ?? 1e9));
  }
  return [...lijst.filter((v) => v.verplicht), ...lijst.filter((v) => !v.verplicht)];
}

/**
 * Voorstellen uit de inhoud zelf. De medewerker beslist; een voorstel is
 * nooit vastgelegd zonder dat hij het ziet.
 */
export function suggesties(inhoud: Inhoud, huidig: Record<string, unknown>, type?: Objecttype): Record<string, string> {
  const s: Record<string, string> = {};
  const rollen = type ? rollenVan(type.schema) : { titel: "naam", taal: "taal" };
  const titel = rollen.titel;
  const taal = rollen.taal;
  if (titel && inhoud.formaat === "html" && !huidig[titel]) {
    // De eerste kop 1; in een presentatie de titel van de eerste dia.
    const m = inhoud.data.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? inhoud.data.match(/^\s*<section data-oa="dia"><h2[^>]*>([\s\S]*?)<\/h2>/i);
    const t = m?.[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (t && t.length >= 3) s[titel] = t.slice(0, 200);
  }
  if (taal && !huidig[taal]) {
    // De standaard van het schema (bv. "dut" bij RGBZ), anders Nederlands.
    const v = type ? velden(type).find((x) => x.naam === taal) : undefined;
    s[taal] = v?.standaard ?? (v?.opties?.includes("nl") || !v?.opties ? "nl" : v.opties[0]!);
  }
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
      regel: v.element ?? `MDTO ${v.naam}`,
      melding: `${v.label} is nog niet ingevuld.`,
    }));
}

/** Alleen ingevulde waarden; lege velden gaan niet als lege tekst naar het platform. */
export function opgeschoond(metadata: Record<string, unknown>, type?: Objecttype): Record<string, unknown> {
  const getal = new Set(type ? velden(type).filter((v) => v.soort === "getal").map((v) => v.naam) : []);
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, w]) => w !== undefined && w !== null && w !== "")
      .map(([k, w]) => [k, getal.has(k) && typeof w === "string" && w.trim() !== "" && !Number.isNaN(Number(w.replace(",", "."))) ? Number(w.replace(",", ".")) : w]),
  );
}
