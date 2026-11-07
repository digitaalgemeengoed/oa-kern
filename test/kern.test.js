import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { OBJECTTYPE_DOCUMENT_V1 } from "@digitaalgemeengoed/oa-contract";
import { metadateren, toegankelijkheid, registreer, bepaalStand } from "../dist/index.js";

const parser = (html) => parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;

/** Een adapter in het geheugen; met of zonder optionele vermogens. */
function nepAdapter(html, rijk = true) {
  let data = html;
  let afdruk = null;
  const log = [];
  return {
    log,
    get data() { return data; },
    werkomgeving: () => ({
      id: "nep",
      naam: "Nep",
      vermogens: ["inhoud-opleveren", "inhoud-vervangen", "tonen", ...(rijk ? ["segment-vervangen", "afdruk-schrijven"] : [])],
    }),
    leverInhoud: async () => ({ formaat: "html", mediaType: "text/html", codering: "tekst", data }),
    vervangInhoud: async (i) => { data = i.data; log.push("geheel"); },
    toon: () => {},
    vervangSegment: async (plek, h) => { log.push(`segment ${plek.pad} ${h}`); },
    schrijfAfdruk: async (a) => { afdruk = a; },
    leesAfdruk: async () => afdruk,
  };
}

test("velden komen uit het schema, verplichte eerst", () => {
  const v = metadateren.velden(OBJECTTYPE_DOCUMENT_V1);
  assert.deepEqual(v.slice(0, 3).map((x) => x.naam), ["naam", "informatiecategorie", "vertrouwelijkheid"]);
  assert.equal(v.find((x) => x.naam === "vertrouwelijkheid").soort, "keuze");
  assert.equal(v.find((x) => x.naam === "omschrijving").soort, "lange-tekst");
});

test("de naam wordt voorgesteld uit de eerste kop", () => {
  const s = metadateren.suggesties({ formaat: "html", data: "<h1>Raadsvoorstel <b>fietsen</b></h1>" }, {});
  assert.equal(s.naam, "Raadsvoorstel fietsen");
});

test("ontbrekende verplichte velden worden bevindingen", () => {
  const b = metadateren.bevindingen(OBJECTTYPE_DOCUMENT_V1, { naam: "X" });
  assert.deepEqual(b.map((x) => x.id), ["md-informatiecategorie", "md-vertrouwelijkheid"]);
});

const altBevinding = {
  id: "tg-1", module: "toegankelijkheid", ernst: "fout", regel: "WCAG 2.2 1.1.1", melding: "",
  plek: { pad: "body/1/0", beschrijving: "Afbeelding" },
  voorstel: { beschrijving: "", vraag: { label: "Alternatieve tekst", veld: "alt" } },
};

test("herstellen in een rijke werkomgeving vervangt alleen het deel", async () => {
  const a = nepAdapter('<h1>T</h1><p><img src="k.png"></p>');
  const u = await toegankelijkheid.herstel(a, altBevinding, "Kaart van de wijk", parser);
  assert.equal(u.terugval, undefined);
  assert.equal(a.log.length, 1);
  assert.match(a.log[0], /^segment body\/1\/0 <img /);
  assert.match(a.log[0], /alt="Kaart van de wijk"/);
  assert.match(a.log[0], /src="k.png"/);
});

test("zonder segmentvermogen valt de assistent zichtbaar terug op het hele document", async () => {
  const a = nepAdapter('<h1>T</h1><p><img src="k.png"></p>', false);
  const u = await toegankelijkheid.herstel(a, altBevinding, "Kaart", parser);
  assert.match(u.terugval, /opnieuw geladen/);
  assert.match(a.data, /^<h1>T<\/h1><p><img [^>]*alt="Kaart"[^>]*><\/p>$/);
  assert.deepEqual(a.log, ["geheel"]);
});

test("registreren schrijft de afdruk; zonder dat vermogen zegt de assistent het", async () => {
  const object = { identificatie: "11111111-1111-1111-1111-111111111111", objecttype: { naam: "document", versie: 1 }, versies: [{ nummer: 1 }], volgnummer: 2 };
  const verbinding = { maakObject: async () => object, object: async () => object };
  const rijk = nepAdapter("<h1>T</h1>");
  const s = await registreer(rijk, verbinding, "document", { naam: "T", omschrijving: "" });
  assert.equal(s.afdruk.identificatie, object.identificatie);
  assert.equal((await bepaalStand(rijk, verbinding)).object.identificatie, object.identificatie);
  const arm = nepAdapter("<h1>T</h1>", false);
  const s2 = await registreer(arm, verbinding, "document", { naam: "T" });
  assert.match(s2.terugval, /niet in het bestand bewaren/);
});
