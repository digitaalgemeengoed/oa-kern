/**
 * De assistentkern. Kent het contract en de modules, kent geen
 * werkomgevingen en onthoudt niets tussen twee aanroepen: alle functies
 * krijgen wat ze nodig hebben mee.
 */
export * from "./verbinding.js";
export * as metadateren from "./metadateren.js";
export * as toegankelijkheid from "./toegankelijkheid.js";
export * as anonimiseren from "./anonimiseren.js";
export * as classificeren from "./classificeren.js";
export type { Bevestigd, Gevonden, PiiKaart, Sessie } from "./anonimiseren.js";
export * from "./vastleggen.js";
export type { Veld } from "./metadateren.js";
export type { Voorstel as Klassevoorstel, Resultaat as Klasse } from "./classificeren.js";
export type { Wijziging, Uitkomst, Parser } from "./toegankelijkheid.js";
