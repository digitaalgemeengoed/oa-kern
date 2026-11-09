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

test("een ander metadatamodel (RGBZ): rollen, datum, getal, element en volgorde van de gemeente", async () => {
  const { schemaUitConfig, standaardConfig } = await import("@digitaalgemeengoed/oa-contract");
  const c = standaardConfig("rgbz");
  c.velden.push({ sleutel: "bedrag", aan: true, verplicht: false, label: "Bedrag", eigen: { type: "getal" } });
  const type = { naam: "document", versie: 2, titel: "Document", status: "actief", vervaldatum: null, schema: schemaUitConfig(c) };
  const v = metadateren.velden(type);
  assert.equal(v[0].naam, "titel", "de volgorde van het beheerportaal");
  // Zoals uit de database (jsonb): de sleutels van het schema in een andere volgorde.
  const geschud = { ...type, schema: { ...type.schema, properties: Object.fromEntries(Object.entries(type.schema.properties).reverse()) } };
  assert.deepEqual(metadateren.velden(geschud).map((x) => x.naam), v.map((x) => x.naam));
  assert.equal(v.find((x) => x.naam === "creatiedatum").soort, "datum");
  assert.equal(v.find((x) => x.naam === "beschrijving").soort, "lange-tekst");
  assert.equal(v.find((x) => x.naam === "bedrag").soort, "getal");
  assert.equal(v.find((x) => x.naam === "titel").rol, "titel");
  assert.equal(v.find((x) => x.naam === "titel").element, "RGBZ titel");
  const s = metadateren.suggesties({ formaat: "html", data: "<h1>Notitie duinpad</h1>" }, {}, type);
  assert.deepEqual(s, { titel: "Notitie duinpad", taal: "dut" });
  assert.equal(metadateren.bevindingen(type, { titel: "x" }).find((b) => b.id === "md-auteur").regel, "RGBZ auteur");
  assert.deepEqual(metadateren.opgeschoond({ bedrag: "12,50", titel: "x", leeg: "" }, type), { bedrag: 12.5, titel: "x" });
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

test("met bestand-opleveren gaat het origineel als versie, de html als weergave", async () => {
  const { teBewaren } = await import("../dist/index.js");
  const a = nepAdapter("<h1>Nota</h1>");
  assert.deepEqual(await teBewaren(a), { inhoud: { formaat: "html", mediaType: "text/html", codering: "tekst", data: "<h1>Nota</h1>" } });
  const docx = { formaat: "docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", codering: "base64", data: "UEsDBA==" };
  const metBestand = { ...a, werkomgeving: () => ({ ...a.werkomgeving(), vermogens: [...a.werkomgeving().vermogens, "bestand-opleveren"] }), leverBestand: async () => docx };
  const r = await teBewaren(metBestand);
  assert.equal(r.inhoud.formaat, "docx");
  assert.equal(r.weergave.formaat, "html");
  // Zonder het vermogen telt leverBestand niet mee.
  assert.equal((await teBewaren({ ...a, leverBestand: async () => docx })).inhoud.formaat, "html");
});

test("persoonlijk registreren stuurt geen metadata mee; zakelijk maken via het platform", async () => {
  const { maakZakelijk } = await import("../dist/index.js");
  const object = { identificatie: "22222222-2222-2222-2222-222222222222", aard: "persoonlijk", objecttype: { naam: "document", versie: 1 }, versies: [{ nummer: 1 }], volgnummer: 2 };
  const verzonden = [];
  const verbinding = {
    maakObject: async (...a) => (verzonden.push(a), object),
    wijzigAard: async (id, aard) => ({ ...object, identificatie: id, aard }),
  };
  const s = await registreer(nepAdapter("<h1>T</h1>"), verbinding, "document", { naam: "T" }, "persoonlijk");
  assert.deepEqual(verzonden[0][1], {});
  assert.equal(verzonden[0][4], "persoonlijk");
  assert.equal((await maakZakelijk(verbinding, s)).object.aard, "zakelijk");
});

test("kopie of gewijzigd: vergelijkt de html met de laatste versie", async () => {
  const { vergelijkMetLaatsteVersie } = await import("../dist/index.js");
  const { createHash } = await import("node:crypto");
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  const html = (data) => ({ formaat: "html", mediaType: "text/html", codering: "tekst", data });
  const metHtml = { object: { versies: [{ nummer: 1, formaat: "html", sha256: sha("<h1>Nota ë</h1>") }] } };
  assert.equal(await vergelijkMetLaatsteVersie(metHtml, html("<h1>Nota ë</h1>")), "gelijk");
  assert.equal(await vergelijkMetLaatsteVersie(metHtml, html("<h1>Nota</h1>")), "afwijkend");
  const metWeergave = { object: { versies: [{ nummer: 2, formaat: "docx", sha256: "x", weergaven: [{ formaat: "html", sha256: sha("<p>a</p>") }] }] } };
  assert.equal(await vergelijkMetLaatsteVersie(metWeergave, html("<p>a</p>")), "gelijk");
  assert.equal(await vergelijkMetLaatsteVersie({ object: null }, html("<p>a</p>")), "onbekend");
});

test("anonimiseren: overal toevoegen", async () => {
  const { anonimiseren } = await import("../dist/index.js");
  const gevonden = { tekst: "Sanne en Sannes, Sanne.", blokken: [], treffers: [], standaard: [], motor: "nep" };
  const nieuw = anonimiseren.overal(gevonden, "Sanne", "naam");
  assert.deepEqual(nieuw.map((t) => [t.begin, t.eind]), [[0, 5], [17, 22]]);
});

test("anonimiseren bij de bron: registreren, in het document vervangen, nieuwe versie", async () => {
  const { anonimiseren } = await import("../dist/index.js");
  let doc = "<p>Sanne de Boer belde. Sanne, <b>06-1234</b> en <i>Sanne</i> de Boer.</p>";
  const aanroepen = [];
  const adapter = {
    werkomgeving: () => ({ id: "t", naam: "t", vermogens: ["inhoud-leveren", "inhoud-vervangen", "melden", "tekst-vervangen"] }),
    leverInhoud: async () => ({ formaat: "html", mediaType: "text/html", codering: "tekst", data: doc }),
    vervangTekst: async (paren) => {
      aanroepen.push(["vervang", paren]);
      let n = 0;
      for (const p of [...paren].sort((x, y) => y.van.length - x.van.length))
        doc = doc.replace(new RegExp(`(?<![\\p{L}])${p.van}(?![\\p{L}])`, "gu"), () => (n++, p.naar));
      return n;
    },
  };
  const verbinding = {
    registreerPii: async (id, items) => (
      aanroepen.push(["registreer", id, items]),
      { plaatshouders: items.map((it, i) => ({ plaatshouder: `[${it.soort === "telefoon" ? "TELEFOON" : "PERSOON"} ${i + 1}]`, soort: it.soort, categorie: "c1", nieuw: true })) }
    ),
    voegVersieToe: async (id, inhoud) => (aanroepen.push(["versie", id, inhoud.data]), { identificatie: id, objecttype: { naam: "nota" }, versies: [{ nummer: 4 }] }),
  };
  const stand = { afdruk: null, object: { identificatie: "o-1", versies: [{ nummer: 3 }] } };
  const gekozen = [
    { soort: "naam", tekst: "Sanne de Boer", bron: "model" },
    { soort: "naam", tekst: " Sanne ", bron: "medewerker" },
    { soort: "naam", tekst: "Sanne", bron: "model" },
    { soort: "telefoon", tekst: "06-1234", bron: "patroon" },
  ];
  const r = await anonimiseren.bevestig(adapter, verbinding, stand, gekozen);
  assert.deepEqual(aanroepen[0], ["registreer", "o-1", [
    { soort: "naam", waarde: "Sanne de Boer", bron: "model" },
    { soort: "naam", waarde: "Sanne", bron: "medewerker" },
    { soort: "telefoon", waarde: "06-1234", bron: "patroon" },
  ]]);
  assert.deepEqual(aanroepen[1], ["vervang", [{ van: "Sanne de Boer", naar: "[PERSOON 1]" }, { van: "Sanne", naar: "[PERSOON 2]" }, { van: "06-1234", naar: "[TELEFOON 3]" }]]);
  // "<i>Sanne</i> de Boer" loopt over opmaak heen: als "Sanne" vervangen, en "de Boer" blijft staan.
  assert.equal(doc, "<p>[PERSOON 1] belde. [PERSOON 2], <b>[TELEFOON 3]</b> en <i>[PERSOON 2]</i> de Boer.</p>");
  assert.equal(r.vervangen, 4);
  assert.equal(r.resterend, 0);
  assert.deepEqual(aanroepen[2], ["versie", "o-1", doc]);
  assert.equal(r.stand.object.versies.at(-1).nummer, 4);
  assert.equal(r.registraties[2].plaatshouder, "[TELEFOON 3]");
  assert.equal(anonimiseren.telInHtml("<p>Jan de <b>Vries</b> en Jan</p>", [{ van: "Jan" }, { van: "Jan de Vries" }]), 2);

  await assert.rejects(anonimiseren.bevestig(adapter, verbinding, { afdruk: null, object: null }, gekozen), /eerst vast/);
  const zonder = { ...adapter, vervangTekst: undefined };
  assert.equal(anonimiseren.kanBijDeBron(zonder), false);
  await assert.rejects(anonimiseren.bevestig(zonder, verbinding, stand, gekozen), /kan tekst in het document niet vervangen/);
  await assert.rejects(anonimiseren.bevestig(adapter, verbinding, stand, []), /Kies eerst/);
});

test("anonimiseren in het document: voorvertoning, laat staan, toevoegen, bevestigen", async () => {
  const { anonimiseren } = await import("../dist/index.js");
  const { createHash } = await import("node:crypto");
  // Een nep-werkomgeving: plaatshouders als {p1:[PERSOON 1]} in de tekst.
  let tekst = "<p>Sanne de Boer belde Jan. Jan woont op de Kruisweg 1. Op 3 mei.</p>";
  let volg = 0;
  const pv = new Set();
  const plekken = () => [...tekst.matchAll(/\{(p\d+):([^}]+)\}/g)].map((m) => ({ plek: m[1], plaatshouder: m[2], voorvertoning: pv.has(m[1]) }));
  const eigenschappen = {};
  const adapter = {
    werkomgeving: () => ({ id: "t", naam: "t", vermogens: ["inhoud-opleveren", "inhoud-vervangen", "tonen", "pii-markeren", "afdruk-schrijven", "eigenschap-schrijven"] }),
    leverInhoud: async () => ({ formaat: "html", mediaType: "text/html", codering: "tekst", data: tekst }),
    markeerPii: async (ms) => {
      const uit = [];
      for (const m of [...ms].sort((a, b) => b.van.length - a.van.length))
        tekst = tekst.replace(new RegExp(`(?<![\\p{L}{:])${m.van.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}}])`, "gu"), () => {
          const p = `p${++volg}`;
          if (m.voorvertoning) pv.add(p);
          uit.push({ plek: p, plaatshouder: m.plaatshouder, voorvertoning: m.voorvertoning });
          return `{${p}:${m.plaatshouder}}`;
        });
      return uit;
    },
    leesPiiPlekken: async () => plekken(),
    herstelPii: async (ps) => ps.forEach(({ plek, waarde }) => (tekst = tekst.replace(new RegExp(`\\{${plek}:[^}]+\\}`), waarde))),
    zetPiiDefinitief: async () => pv.clear(),
    schrijfAfdruk: async (a) => (eigenschappen.afdruk = a),
    schrijfDocumenteigenschap: async (n, w) => (eigenschappen[n] = w),
  };
  const register = [];
  const aanroepen = [];
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  const object = (versies) => ({ identificatie: "o-1", objecttype: { naam: "nota" }, versies });
  const verbinding = {
    anonimiseren: async (inhoud) => ({
      tekst: "Sanne de Boer belde Jan. Jan woont op de Kruisweg 1. Op 3 mei.",
      blokken: [],
      standaard: ["naam", "adres"],
      motor: "nep",
      treffers: [
        { id: "a", soort: "naam", tekst: "Sanne de Boer", begin: 0, eind: 13, score: 0.9, bron: "model" },
        { id: "b", soort: "naam", tekst: "Jan", begin: 20, eind: 23, score: 0.8, bron: "model" },
        { id: "c", soort: "naam", tekst: "Jan", begin: 25, eind: 28, score: 0.8, bron: "model" },
        { id: "d", soort: "adres", tekst: "Kruisweg 1", begin: 42, eind: 52, score: 1, bron: "patroon" },
        { id: "e", soort: "datum", tekst: "3 mei", begin: 57, eind: 62, score: 1, bron: "patroon" },
      ],
    }),
    registreerPii: async (id, items, voorvertoning) => {
      aanroepen.push(["registreer", items.map((i) => i.waarde), voorvertoning]);
      const PH = { naam: "PERSOON", adres: "ADRES", datum: "DATUM" };
      return {
        plaatshouders: items.map((i) => {
          let r = register.find((x) => x.soort === i.soort && x.waarde === i.waarde);
          if (!r) {
            r = { plaatshouder: `[${PH[i.soort]} ${register.filter((x) => x.soort === i.soort).length + 1}]`, soort: i.soort, categorie: "c1", waarde: i.waarde, status: "voorvertoning", bron: i.bron };
            register.push(r);
            return { ...r, nieuw: true };
          }
          return { ...r, nieuw: false };
        }),
      };
    },
    piiRegister: async () => ({ registraties: register, niveau: 1 }),
    vervallenPii: async (id, ph) => (aanroepen.push(["vervallen", ph]), register.splice(register.findIndex((x) => x.plaatshouder === ph[0]), 1)),
    onthulPii: async (id, ph) => ({ waarden: ph.map((p) => ({ plaatshouder: p, waarde: register.find((x) => x.plaatshouder === p).waarde })) }),
    wijzigPiiCategorie: async (id, ph, categorie) => {
      aanroepen.push(["categorie", ph, categorie]);
      const r = register.find((x) => x.plaatshouder === ph);
      r.categorie = categorie;
      return { plaatshouder: ph, soort: r.soort, categorie };
    },
    bevestigPii: async (id, v) => (aanroepen.push(["bevestig", v.bronversie, v.behouden, v.inhoud.data]), object([{ nummer: 1 }, { nummer: 2, soort: "anonimisering", bronversie: 1 }])),
  };
  const stand = { afdruk: null, object: object([{ nummer: 1, formaat: "html", sha256: sha(tekst) }]) };

  const { sessie } = await anonimiseren.vindEnMarkeer(adapter, verbinding, stand);
  assert.equal(tekst, "<p>{p1:[PERSOON 1]} belde {p3:[PERSOON 2]}. {p4:[PERSOON 2]} woont op de {p2:[ADRES 1]}. Op 3 mei.</p>");
  assert.equal(sessie.bronversie, 1);
  assert.deepEqual(sessie.kaarten.map((k) => [k.plaatshouder, k.status, k.plekken.length]), [["[PERSOON 1]", "voorvertoning", 1], ["[PERSOON 2]", "voorvertoning", 2], ["[ADRES 1]", "voorvertoning", 1], [null, "laat-staan", 0]]);

  // Eén plek van Jan laten staan, daarna het adres helemaal.
  let s = await anonimiseren.laatStaan(adapter, verbinding, stand, sessie, "[PERSOON 2]", "p4");
  assert.equal(tekst, "<p>{p1:[PERSOON 1]} belde {p3:[PERSOON 2]}. Jan woont op de {p2:[ADRES 1]}. Op 3 mei.</p>");
  s = await anonimiseren.laatStaan(adapter, verbinding, stand, s, "[ADRES 1]");
  assert.ok(tekst.includes("Kruisweg 1"));
  assert.deepEqual(aanroepen.at(-1), ["vervallen", ["[ADRES 1]"]]);
  // De datum toch anonimiseren (de kaart die bleef staan).
  s = await anonimiseren.voegToe(adapter, verbinding, stand, s, { waarde: "3 mei", soort: "datum", bron: "patroon" });
  assert.ok(tekst.endsWith("Op {p5:[DATUM 1]}.</p>"));
  assert.equal(s.kaarten.filter((k) => k.status === "laat-staan").length, 1); // het adres

  // Een andere grondslag: zonder herkleuren terugzetten en opnieuw markeren, met het nieuwe niveau.
  const markeerVoor = adapter.markeerPii;
  const kleuren = [];
  adapter.markeerPii = async (ms) => (kleuren.push(...ms.map((m) => [m.plaatshouder, m.ppl, m.voorvertoning])), markeerVoor(ms));
  s = await anonimiseren.wijzigCategorie(adapter, verbinding, stand, s, "[PERSOON 2]", "c2");
  adapter.markeerPii = markeerVoor;
  assert.deepEqual(aanroepen.at(-1), ["categorie", "[PERSOON 2]", "c2"]);
  assert.deepEqual(kleuren, [["[PERSOON 2]", 2, true]]);
  assert.equal(tekst, "<p>{p1:[PERSOON 1]} belde {p6:[PERSOON 2]}. Jan woont op de Kruisweg 1. Op {p5:[DATUM 1]}.</p>", "Jan op de gelaten plek blijft staan");
  const jan = s.kaarten.find((k) => k.plaatshouder === "[PERSOON 2]");
  assert.deepEqual([jan.categorie, jan.ppl, jan.plekken], ["c2", 2, ["p6"]]);
  // Met herkleuren: alleen de kleur.
  const herkleurd = [];
  s = await anonimiseren.wijzigCategorie({ ...adapter, herkleurPii: async (ph, ppl) => herkleurd.push([ph, ppl]) }, verbinding, stand, s, "[DATUM 1]", "c3");
  assert.deepEqual(herkleurd, [["[DATUM 1]", 3]]);
  assert.equal(s.kaarten.find((k) => k.plaatshouder === "[DATUM 1]").ppl, 3);
  // Een kaart die blijft staan: alleen de keuze onthouden.
  const adres = s.kaarten.find((k) => k.status === "laat-staan");
  s = await anonimiseren.wijzigCategorie(adapter, verbinding, stand, s, adres.sleutel, "c2");
  assert.equal(s.kaarten.find((k) => k.sleutel === adres.sleutel).categorie, "c2");
  assert.deepEqual(aanroepen.filter((x) => x[0] === "categorie").length, 2);
  // Bij toch anonimiseren gaat de keuze mee naar het register.
  const registreer = verbinding.registreerPii;
  let mee;
  verbinding.registreerPii = async (id, items, v) => ((mee = items), registreer(id, items, v));
  const metAdres = await anonimiseren.voegToe(adapter, verbinding, stand, s, { waarde: "Kruisweg 1", soort: "adres", categorie: "c2" });
  verbinding.registreerPii = registreer;
  assert.deepEqual(mee, [{ soort: "adres", waarde: "Kruisweg 1", bron: "medewerker", categorie: "c2" }]);
  const nieuwAdres = metAdres.kaarten.find((k) => k.waarde === "Kruisweg 1" && k.plaatshouder);
  s = await anonimiseren.laatStaan(adapter, verbinding, stand, metAdres, nieuwAdres.sleutel);
  assert.ok(tekst.includes("Kruisweg 1"));
  // Bevestigd: de grondslag ligt vast.
  await assert.rejects(
    anonimiseren.wijzigCategorie(adapter, verbinding, stand, { ...s, kaarten: [{ ...jan, status: "bevestigd" }] }, "[PERSOON 2]", "c1"),
    /ligt vast/,
  );

  const r = await anonimiseren.bevestigInDocument(adapter, verbinding, stand, s);
  const b = aanroepen.find((x) => x[0] === "bevestig");
  assert.deepEqual(b.slice(0, 3), ["bevestig", 1, ["[PERSOON 1]", "[PERSOON 2]", "[DATUM 1]"]]);
  assert.equal(r.stand.object.versies.at(-1).nummer, 2);
  assert.equal(eigenschappen.Versie, "2");
  assert.equal(plekken().some((p) => p.voorvertoning), false);
  assert.equal(anonimiseren.raadSoort("06-12345678"), "telefoon");
  assert.equal(anonimiseren.raadSoort("mantelzorg aan uw moeder"), "gezondheid");
  assert.equal(anonimiseren.raadSoort("Klaas Bakker"), "naam");
});
