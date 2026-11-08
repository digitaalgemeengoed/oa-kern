import { heeftVermogen, type Adapter, type Afdruk, type Inhoud } from "@digitaalgemeengoed/oa-contract";
import { opgeschoond } from "./metadateren.js";
import type { ObjectMetStaat, Verbinding } from "./verbinding.js";

export interface Stand {
  /** Het object in het platform, of null als het stuk nog niet is geregistreerd. */
  object: ObjectMetStaat | null;
  afdruk: Afdruk | null;
  /** Gezet als de werkomgeving de afdruk niet kan bewaren. */
  terugval?: string;
}

/** Waar staat dit stuk? Leest de afdruk in het bestand en het object in het platform. */
export async function bepaalStand(adapter: Adapter, verbinding: Verbinding): Promise<Stand> {
  if (!adapter.leesAfdruk || !heeftVermogen(adapter.werkomgeving(), "afdruk-schrijven")) {
    return { object: null, afdruk: null, terugval: "Deze werkomgeving kan geen identificatie in het bestand bewaren. De assistent herkent het stuk na heropenen niet." };
  }
  const afdruk = await adapter.leesAfdruk();
  if (!afdruk) return { object: null, afdruk: null };
  const object = await verbinding.object(afdruk.identificatie);
  return { object, afdruk };
}

/**
 * Wat er wordt vastgelegd. Kan de werkomgeving het bestand zelf opleveren
 * (docx, odt …), dan is dat de versie en gaat de html mee als weergave: het
 * origineel blijft bewaard (Archiefwet, MDTO), de html is waarmee de
 * assistent en de zoekindex werken. Anders is de html de versie.
 */
export async function teBewaren(adapter: Adapter): Promise<{ inhoud: Inhoud; weergave?: Inhoud }> {
  const html = await adapter.leverInhoud();
  if (adapter.leverBestand && heeftVermogen(adapter.werkomgeving(), "bestand-opleveren")) {
    const bestand = await adapter.leverBestand();
    if (bestand.formaat !== html.formaat) return { inhoud: bestand, weergave: html };
  }
  return { inhoud: html };
}

/**
 * Registreren: het platform kent de identificatie toe en legt de eerste
 * versie vast. De adapter schrijft de identificatie in het bestand, zodat het
 * stuk herkenbaar blijft als het het platform verlaat.
 */
export async function registreer(adapter: Adapter, verbinding: Verbinding, objecttype: string, metadata: Record<string, unknown>): Promise<Stand> {
  const { inhoud, weergave } = await teBewaren(adapter);
  const object = await verbinding.maakObject(objecttype, opgeschoond(metadata), inhoud, weergave);
  const afdruk: Afdruk = { identificatie: object.identificatie, versie: object.versies.at(-1)?.nummer ?? 0, objecttype: object.objecttype.naam };
  if (adapter.schrijfAfdruk && heeftVermogen(adapter.werkomgeving(), "afdruk-schrijven")) {
    await adapter.schrijfAfdruk(afdruk);
    return { object, afdruk };
  }
  return { object, afdruk: null, terugval: "Het stuk is geregistreerd, maar deze werkomgeving kan de identificatie niet in het bestand bewaren." };
}

/** Een nieuwe versie vastleggen; ongewijzigde inhoud levert geen versie op. */
export async function legVersieVast(adapter: Adapter, verbinding: Verbinding, stand: Stand): Promise<Stand> {
  if (!stand.object) throw new Error("Het stuk is nog niet geregistreerd.");
  const { inhoud, weergave } = await teBewaren(adapter);
  const object = await verbinding.voegVersieToe(stand.object.identificatie, inhoud, weergave);
  const afdruk: Afdruk = { identificatie: object.identificatie, versie: object.versies.at(-1)?.nummer ?? 0, objecttype: object.objecttype.naam };
  if (adapter.schrijfAfdruk && heeftVermogen(adapter.werkomgeving(), "afdruk-schrijven")) await adapter.schrijfAfdruk(afdruk);
  return { ...stand, object, afdruk };
}

/** Metadata vastleggen tegen de stand die de medewerker zag. */
export async function legMetadataVast(verbinding: Verbinding, stand: Stand, metadata: Record<string, unknown>): Promise<Stand> {
  if (!stand.object) throw new Error("Het stuk is nog niet geregistreerd.");
  const object = await verbinding.legMetadataVast(stand.object.identificatie, opgeschoond(metadata), stand.object.volgnummer);
  return { ...stand, object };
}
