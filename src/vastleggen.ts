import { heeftVermogen, type Aard, type Adapter, type Afdruk, type Inhoud, type Objecttype } from "@digitaalgemeengoed/oa-contract";
import { opgeschoond } from "./metadateren.js";
import { VerbindingsFout, type ObjectMetStaat, type Verbinding } from "./verbinding.js";

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
  try {
    const object = await verbinding.object(afdruk.identificatie);
    return { object, afdruk };
  } catch (e) {
    // Een persoonlijk stuk van iemand anders bestaat voor jou niet (404),
    // net als een stuk uit een andere omgeving. Dan als nieuw stuk.
    if (e instanceof VerbindingsFout && e.status === 404) {
      return {
        object: null,
        afdruk: null,
        terugval: "Dit bestand verwijst naar een stuk dat je niet kunt zien: het is van iemand anders persoonlijk, of het komt uit een andere omgeving. Je kunt het als nieuw stuk vastleggen.",
      };
    }
    throw e;
  }
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
export async function registreer(
  adapter: Adapter,
  verbinding: Verbinding,
  objecttype: string,
  metadata: Record<string, unknown>,
  aard: Aard = "zakelijk",
  type?: Objecttype,
): Promise<Stand> {
  const { inhoud, weergave } = await teBewaren(adapter);
  // Een persoonlijk stuk heeft geen metadata (het platform weigert die).
  const object = await verbinding.maakObject(objecttype, aard === "persoonlijk" ? {} : opgeschoond(metadata, type), inhoud, weergave, aard);
  const afdruk: Afdruk = { identificatie: object.identificatie, versie: object.versies.at(-1)?.nummer ?? 0, objecttype: object.objecttype.naam };
  if (adapter.schrijfAfdruk && heeftVermogen(adapter.werkomgeving(), "afdruk-schrijven")) {
    await adapter.schrijfAfdruk(afdruk);
    await schrijfVersienummer(adapter, afdruk.versie);
    return { object, afdruk };
  }
  return { object, afdruk: null, terugval: "Het stuk is geregistreerd, maar deze werkomgeving kan de identificatie niet in het bestand bewaren." };
}

/** Een nieuwe versie vastleggen; ongewijzigde inhoud levert geen versie op. */
export async function legVersieVast(adapter: Adapter, verbinding: Verbinding, stand: Stand): Promise<Stand> {
  if (!stand.object) throw new Error("Het stuk is nog niet geregistreerd.");
  const { inhoud, weergave } = await teBewaren(adapter);
  const object = await verbinding.voegVersieToe(stand.object.identificatie, inhoud, weergave);
  return naVersie(adapter, stand, object);
}

/** Na een nieuwe versie: de afdruk en het versienummer in het bestand bijwerken. */
export async function naVersie(adapter: Adapter, stand: Stand, object: ObjectMetStaat): Promise<Stand> {
  const afdruk: Afdruk = { identificatie: object.identificatie, versie: object.versies.at(-1)?.nummer ?? 0, objecttype: object.objecttype.naam };
  if (adapter.schrijfAfdruk && heeftVermogen(adapter.werkomgeving(), "afdruk-schrijven")) await adapter.schrijfAfdruk(afdruk);
  await schrijfVersienummer(adapter, afdruk.versie);
  return { ...stand, object, afdruk };
}

/** Het versienummer van het platform als documenteigenschap "Versie" (een veld in de koptekst kan het tonen). */
export async function schrijfVersienummer(adapter: Adapter, versie: number): Promise<void> {
  if (!versie || !adapter.schrijfDocumenteigenschap || !heeftVermogen(adapter.werkomgeving(), "eigenschap-schrijven")) return;
  await adapter.schrijfDocumenteigenschap("Versie", String(versie));
}

/** Metadata vastleggen tegen de stand die de medewerker zag. */
export async function legMetadataVast(verbinding: Verbinding, stand: Stand, metadata: Record<string, unknown>, type?: Objecttype): Promise<Stand> {
  if (!stand.object) throw new Error("Het stuk is nog niet geregistreerd.");
  const object = await verbinding.legMetadataVast(stand.object.identificatie, opgeschoond(metadata, type), stand.object.volgnummer);
  return { ...stand, object };
}

/**
 * Een persoonlijk stuk zakelijk maken. Het platform zet een kopie in het
 * archief; de metadata volgt daarna (het stuk heet tot dan onvolledig).
 */
export async function maakZakelijk(verbinding: Verbinding, stand: Stand): Promise<Stand> {
  if (!stand.object) throw new Error("Het stuk is nog niet vastgelegd.");
  const object = await verbinding.wijzigAard(stand.object.identificatie, "zakelijk");
  return { ...stand, object };
}

/**
 * Is dit hetzelfde stuk als de laatste vastgelegde versie? Het paneel vraagt
 * het bij openen: wijkt de inhoud af, dan is het stuk sindsdien gewijzigd,
 * of het is een kopie (Opslaan als) met dezelfde afdruk. Dat laatste kan de
 * assistent niet zelf zien; de medewerker kiest.
 *
 * Vergelijkt de html van nu met de html-weergave van de laatste versie (of
 * de versie zelf als die html is), op sha-256.
 */
export async function vergelijkMetLaatsteVersie(stand: Stand, html: Inhoud): Promise<"gelijk" | "afwijkend" | "onbekend"> {
  const laatste = stand.object?.versies.at(-1);
  if (!laatste || html.formaat !== "html") return "onbekend";
  const bewaard = laatste.formaat === "html" ? laatste.sha256 : laatste.weergaven?.find((w) => w.formaat === "html" && (w.soort ?? "weergave") === "weergave")?.sha256;
  if (!bewaard || !globalThis.crypto?.subtle) return "onbekend";
  const bytes = html.codering === "base64" ? Uint8Array.from(atob(html.data), (c) => c.charCodeAt(0)) : new TextEncoder().encode(html.data);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  return hex === bewaard ? "gelijk" : "afwijkend";
}
