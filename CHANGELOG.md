# Wijzigingen

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
