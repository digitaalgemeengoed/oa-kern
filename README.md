# oa-kern

De **assistentkern** van de Office Assistent. Kent het contract en de modules, kent geen werkomgevingen en onthoudt niets tussen twee aanroepen. Zonder framework, zodat dezelfde kern onder elk paneel kan.

> Onderdeel van het werkende prototype van de Office Assistent. Een prototype, geen product.

## Wat erin staat

| Onderdeel | Wat |
|---|---|
| `Verbinding` | Praat met de integratielaag. De sessie zit in een httpOnly-cookie; hier staan geen tokens. |
| `metadateren` | Velden uit het schema van het objecttype, voorstellen uit de inhoud (naam uit de eerste kop), ontbrekende verplichte velden als bevindingen. |
| `toegankelijkheid` | Beoordelen (leest alleen) en herstellen. Kan de werkomgeving een deel vervangen, dan alleen dat deel; anders gaat het hele document heen en weer en zegt de assistent dat. |
| `registreer`, `legVersieVast`, `legMetadataVast`, `bepaalStand` | Vastleggen in het platform; de adapter schrijft de identificatie in het bestand als de werkomgeving dat kan. |

Waar een vermogen ontbreekt, valt de kern zichtbaar terug: elke functie geeft dan een `terugval` met de uitleg voor de medewerker.

## Bouwen en testen

```
npm run build
npm test
```

## Licentie

© 2026 Gemeente Haarlem. EUPL 1.2, zie `LICENSE`.

Gemaakt door Erik Hoekstra, programma-architect en senior consultant, afdeling i-Ontwikkeling, Gemeente Haarlem, met assistentie van Claude (Anthropic).
