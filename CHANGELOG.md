# Wijzigingen

## 0.5.1 — 2026-11-09

De velden van een metadatamodel uit het beheerportaal in de volgorde die de gemeente koos, ook als de database de sleutels van het schema anders bewaart.

## 0.5.0 — 2026-11-09

Metadatamodellen uit het beheerportaal:

- `metadateren.velden`: ook datum en getal; per veld de rol en het element ("RGBZ titel"); bij een model uit het portaal de volgorde die de gemeente koos.
- `suggesties(inhoud, huidig, type?)`: de titel en de taal via de rol, met de standaard van het model (bv. "dut" bij RGBZ).
- `bevindingen`: de regel noemt het element van het gekozen model.
- `opgeschoond(metadata, type?)` en `registreer`/`legMetadataVast(…, type?)`: een getalveld gaat als getal.
- `Verbinding.objecttype(naam, versie?)`.

## 0.4.3 — 2026-11-09

- `anonimiseren.wijzigCategorie(adapter, verbinding, stand, sessie, sleutel, categorie)`: een andere grondslag voor een kaart. Een voorvertoning gaat in het register naar de sleutel van die categorie en krijgt in het document de kleur van het nieuwe niveau (`herkleurPii`, of terugzetten en opnieuw markeren). Een kaart die blijft staan onthoudt de keuze; een bevestigd gegeven kan niet.
- `voegToe(…, { categorie })`: meteen met een andere grondslag.
- `Verbinding.wijzigPiiCategorie(id, plaatshouder, categorie)`.

## 0.4.2 — 2026-11-09

Beoordelen stuurt het bestand mee als de werkomgeving het kan opleveren (liefst als docx, xlsx of pptx), voor de controles die in de html niet te zien zijn. Te groot (meer dan ongeveer 19 MB) of lukt het niet: alleen de html, met een advies.

## 0.4.1 — 2026-11-09

- Of een plaatshouder nog een voorvertoning is, leidt de kern af uit het register: niet elke werkomgeving kan dat in het document bijhouden (rekenbladen, presentaties, Collabora).
- Na terugzetten leest de kern de plekken opnieuw: een werkomgeving die niet één plek kan terugzetten (Collabora), blijft zo kloppen.
- `raadSoort` herkent meer gezondheidswoorden.

## 0.4.0 — 2026-11-09

Anonimiseren in het document: `begin` (het origineel eerst als versie), `vindEnMarkeer` (registreren als voorvertoning en in het document vervangen; opnieuw zoeken laat staan wat de medewerker liet staan), `hervat` (een lopende sessie na heropenen), `voegToe` (selectie of "toch anonimiseren"), `laatStaan` (alle plekken of één), `bevestigInDocument` (nieuwe versie), `zetVersieTerug`, `raadSoort` en `kanInDocument`. Na elke versie schrijft de kern het versienummer als documenteigenschap Versie.

## 0.3.4 — 2026-11-09

Anonimiseren bij de bron. `anonimiseren.bevestig(adapter, verbinding, stand, gekozen)`:

1. registreert de gekozen gegevens versleuteld in het register (dezelfde waarde één keer);
2. laat de werkomgeving ze in het document zelf vervangen door hun plaatshouder (`vervangTekst`);
3. legt het resultaat vast als nieuwe versie.

Geeft de registraties, het aantal vervangingen en hoe vaak een waarde nog in het document staat (bijvoorbeeld over opmaak heen). `kanBijDeBron(adapter)` zegt of de werkomgeving het kan. Nieuw op `Verbinding`: `registreerPii`, `piiRegister`, `onthulPii`, `vernietigPii`.

Het stuk hoeft niet meer gelijk te zijn aan de laatste versie: wat de medewerker ziet, wordt de nieuwe versie.

## 0.3.3 — 2026-11-09

Module `anonimiseren`: `vind` (treffers bij de html van het stuk), `overal` (dezelfde tekst overal als treffer van de medewerker) en `bevestig` (afschermen en vastleggen bij de laatste versie; weigert als het stuk sindsdien is gewijzigd). `vergelijkMetLaatsteVersie` kijkt alleen naar de gewone weergave.

## 0.3.2 — 2026-11-09

- `registreer(..., aard)`: zakelijk (standaard) of persoonlijk; persoonlijk zonder metadata. `maakZakelijk(verbinding, stand)` en `Verbinding.wijzigAard`.
- `vergelijkMetLaatsteVersie(stand, html)`: wijkt het geopende stuk af van de laatste vastgelegde versie (gewijzigd, of een kopie met dezelfde afdruk)? Vergelijkt de html op sha-256.
- `bepaalStand`: verwijst de afdruk naar een stuk dat je niet kunt zien (persoonlijk van een ander, of uit een andere omgeving), dan geldt het als nieuw, met een melding.

## 0.3.1 — 2026-11-08

Voorstel voor de naam: zonder kop 1 de titel van de eerste dia van een presentatie.

## 0.3.0 — 2026-11-08

`teBewaren`: kan de werkomgeving het bestand opleveren, dan wordt dat de versie en gaat de html mee als weergave. Registreren en versie vastleggen gebruiken dit.

## 0.2.0 — 2026-11-07

`Verbinding.zoeken` en `Verbinding.maakOnleesbaar`.

## 0.1.0 — 2026-11-07

Fase 1 van het werkende prototype: contract, minimaal platform, integratielaag met twee ingangen, assistentkern, paneel en een demo-werkomgeving met de modules metadateren en toegankelijkheid.
