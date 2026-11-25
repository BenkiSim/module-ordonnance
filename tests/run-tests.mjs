// Tests du module (logique de calcul, ordre des lignes, mentions) et du script d'export.
// Lancer : node tests/run-tests.mjs
// Exécutés automatiquement avant chaque publication : un test en échec bloque la mise en ligne.

import { readFile } from "node:fs/promises";
import vm from "node:vm";
import assert from "node:assert/strict";
import { convertirPage, controler } from "../scripts/export-notion.mjs";

const racine = new URL("..", import.meta.url);
const html = await readFile(new URL("index.html", racine), "utf8");
const debut = html.indexOf("// === LOGIQUE DEBUT ===");
const fin = html.indexOf("// === LOGIQUE FIN ===");
assert.ok(debut > 0 && fin > debut, "Marqueurs LOGIQUE DEBUT / FIN introuvables dans index.html");
const code = html.slice(debut, fin);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code + "\n;globalThis.__ = { MENTION_PMR, calculerDose, genererTexteLigne, construireOrdonnance, comparerLignes, formatMg, lirePoids, descriptionCalcul, filtrerAge };", ctx);
const M = ctx.__;

const fixture = JSON.parse(await readFile(new URL("tests/fixture.json", racine), "utf8")).lignes;
const L = (id) => {
  const l = fixture.find((x) => x.id === id);
  assert.ok(l, "Ligne de test introuvable : " + id);
  return l;
};

let n = 0;
const echecs = [];
function test(nom, fn) {
  n++;
  try { fn(); } catch (e) { echecs.push(nom + "\n   " + e.message); }
}
const ligne = (id, poids) => M.genererTexteLigne(L(id), M.calculerDose(L(id), poids));

// ---------- Calcul au poids ----------
test("Clamoxyl 12 kg : 300 mg par prise, 6 mL", () => {
  assert.match(ligne("clamoxyl", 12), /: 6 mL \(300 mg\) par prise/);
});
test("Clamoxyl 50 kg : plafonné à 1000 mg par prise (2000 mg/j en 2 prises)", () => {
  const c = M.calculerDose(L("clamoxyl"), 50);
  assert.equal(c.plafonne, true);
  assert.equal(c.mgFinal, 1000);
  assert.match(ligne("clamoxyl", 50), /: 20 mL \(1000 mg\)/);
});
test("Hémangiol 4,2 kg : 0,6 mL (2,25 mg), pas de 0,1 mL", () => {
  assert.match(ligne("hemangiol", 4.2), /: 0,6 mL \(2,25 mg\) par prise/);
});
test("Doxycycline 30 kg : 0,5 comprimé, écart signalé", () => {
  assert.match(ligne("doxy", 30), /: 0,5 comprimé \(50 mg\)/);
  const r = M.construireOrdonnance([L("doxy")], 30);
  assert.ok(r.alertes.some((a) => /s'écarte de 17 %/.test(a.texte)), "alerte d'écart attendue");
});
test("Solupred 20 kg : 4 comprimés (accord au pluriel)", () => {
  assert.match(ligne("solupred", 20), /: 4 comprimés \(20 mg\)/);
});
test("Solupred 7 kg : 1 comprimé (accord au singulier)", () => {
  assert.match(ligne("solupred", 7), /: 1 comprimé \(5 mg\)/);
});
test("Solupred 1 kg : dose sous le pas de mesure, minimum retenu et signalé", () => {
  const c = M.calculerDose(L("solupred"), 1);
  assert.equal(c.auMinimum, true);
  assert.equal(c.quantite, 1);
});
test("Enbrel 25 kg : 20 mg (ligne en mg seuls)", () => {
  assert.match(ligne("enbrel", 25), /^Enbrel \(étanercept\) solution injectable : 20 mg en injection/);
});
test("Enbrel 80 kg : plafonné à 50 mg", () => {
  assert.match(ligne("enbrel", 80), /: 50 mg en injection/);
});
test("Arrondi qui dépasserait la dose max : redescendu d'un pas", () => {
  const l = Object.assign({}, L("topalgic"), { doseMax: 99 });
  const c = M.calculerDose(l, 60); // 30 mg par prise, plafond 24,75 mg -> 9,9 gouttes -> 10 (25 mg > 24,75) -> 9 gouttes
  assert.equal(c.quantite, 9);
});
test("Égalité entre deux pas : arrondi vers le bas (Topalgic 12,5 kg = 2,5 gouttes)", () => {
  assert.match(ligne("topalgic", 12.5), /: 2 gouttes \(5 mg\)/);
});
test("Écart supérieur à 25 % : erreur (Doxy 12,5 kg)", () => {
  const r = M.construireOrdonnance([L("doxy")], 12.5);
  assert.ok(r.alertes.some((a) => a.niveau === "erreur" && /Forme ou dosage inadapté/.test(a.texte)));
});
test("Morphine 12,5 kg : 2,5 mg = 0,125 mL égalité, arrondi à 0,1 mL (2 mg)", () => {
  assert.match(ligne("morphine", 12.5), /: 0,1 mL \(2 mg\)/);
});
test("Sans poids : marqueurs remplacés par ?", () => {
  assert.match(ligne("clamoxyl", null), /: \? mL \(\? mg\)/);
  const r = M.construireOrdonnance([L("clamoxyl")], null);
  assert.ok(r.alertes.some((a) => a.niveau === "erreur" && /Poids requis/.test(a.texte)));
});
test("Poids aberrant : aucun calcul", () => {
  assert.equal(M.calculerDose(L("clamoxyl"), 400).ok, false);
  assert.equal(M.calculerDose(L("clamoxyl"), 0.2).ok, false);
});
test("Ligne non calculée : texte inchangé", () => {
  assert.equal(ligne("doliprane", 15), L("doliprane").ligne);
});
test("Saisie du poids avec virgule", () => {
  assert.equal(M.lirePoids("12,5"), 12.5);
  assert.equal(M.lirePoids(""), null);
});

// ---------- Ordre des lignes ----------
test("Ordre : dermocorticoïdes corps avant visage, puis familles 2 à 7", () => {
  const sel = ["doliprane", "protopic", "pmr", "nerisone-visage", "nerisone-corps", "clamoxyl", "mupirocine"].map(L);
  const r = M.construireOrdonnance(sel, 15, { mentions: false, separerExceptions: false });
  const ordre = r.texte.split("\n").map((t) => t.split(" ").slice(0, 2).join(" "));
  assert.deepEqual(ordre, ["- Nérisone", "- Nérisone", "- Protopic", "- Mupiderm", "- Préparation", "Prescription à", "- Clamoxyl", "- Doliprane"]);
  assert.match(r.texte.split("\n")[0], /corps/);
});
test("Puissance décroissante à zone égale", () => {
  const sel = ["locapred-corps", "nerisone-corps"].map(L);
  const r = M.construireOrdonnance(sel, null);
  assert.match(r.texte.split("\n")[0], /^- Nérisone/);
});

// ---------- Mentions ----------
test("Mention PMR sous la dernière préparation d'un groupe consécutif", () => {
  const r = M.construireOrdonnance([L("pmr"), L("pmr2")], null);
  const lignes = r.texte.split("\n");
  assert.equal(lignes.length, 3);
  assert.equal(lignes[2], M.MENTION_PMR);
});
test("Mention compassionnelle avec apostrophes officielles", () => {
  const r = M.construireOrdonnance([L("protopic")], null);
  assert.equal(r.texte.split("\n")[1], "Prescription au titre d'un accès compassionnel en dehors du cadre d'une autorisation de mise sur le marché");
});
test("Mentions désactivées : absentes du texte et alerte bloquante", () => {
  const r = M.construireOrdonnance([L("protopic")], null, { mentions: false });
  assert.equal(r.texte.split("\n").length, 1);
  assert.ok(r.alertes.some((a) => a.niveau === "erreur" && /Mentions réglementaires désactivées/.test(a.texte)));
});
test("Médicament d'exception séparé dans un second bloc", () => {
  const r = M.construireOrdonnance([L("dupixent"), L("nerisone-corps")], null);
  assert.ok(!/Dupixent/.test(r.texte));
  assert.match(r.texteException, /^- Dupixent/);
  assert.ok(r.alertes.some((a) => /médicament d'exception/.test(a.texte)));
});
test("Médicament d'exception seul : un seul bloc", () => {
  const r = M.construireOrdonnance([L("dupixent")], null);
  assert.match(r.texte, /^- Dupixent/);
  assert.equal(r.texteException, "");
});

test("Chaque médicament commence par un tiret, les mentions non", () => {
  const r = M.construireOrdonnance([L("protopic"), L("pmr")], null);
  const lignes = r.texte.split("\n");
  for (const t of lignes) {
    const estMention = t === M.MENTION_PMR || /^Prescription au titre/.test(t);
    assert.equal(t.startsWith("- "), !estMention, t);
  }
});

// ---------- Alertes ----------
test("Doublon de molécule signalé (amoxicilline)", () => {
  const r = M.construireOrdonnance([L("clamoxyl"), L("augmentin")], 15);
  assert.ok(r.alertes.some((a) => /Même molécule \(amoxicilline\)/.test(a.texte)));
});
test("Ordonnance sécurisée signalée", () => {
  const r = M.construireOrdonnance([L("morphine")], 15);
  assert.ok(r.alertes.some((a) => /Ordonnance sécurisée requise/.test(a.texte)));
});
test("Filtre d'âge", () => {
  assert.equal(M.filtrerAge(L("protopic"), "Nourrisson"), false);
  assert.equal(M.filtrerAge(L("doliprane"), "Nourrisson"), true);
  assert.equal(M.filtrerAge(L("protopic"), ""), true);
});
test("Le texte copié ne contient ni tiret long ni marqueur résiduel", () => {
  const r = M.construireOrdonnance(fixture, 15);
  assert.ok(!/\u2014/.test(r.texte + r.texteException), "tiret long trouvé");
  assert.ok(!/\{(mL|mg|unités)\}/.test(r.texte + r.texteException), "marqueur non remplacé");
});

// ---------- Script d'export ----------
const pageNotion = {
  id: "42319207-651b-81aa-bbbb-000000000001",
  properties: {
    "Nom": { type: "title", title: [{ plain_text: "Test" }, { plain_text: " ligne" }] },
    "Ligne d'ordonnance": { type: "rich_text", rich_text: [{ plain_text: "X (x) sirop 10 mg/mL : {mL} mL ({mg} mg) par prise, 2 fois par jour pendant 5 jours" }] },
    "Molécule": { type: "rich_text", rich_text: [] },
    "Pathologies": { type: "multi_select", multi_select: [{ name: "Gale" }] },
    "Famille": { type: "select", select: { name: "6. Traitements systémiques" } },
    "Préparation magistrale": { type: "checkbox", checkbox: false },
    "Dose mg/kg/jour": { type: "number", number: 10 },
    "Prises par jour": { type: "number", number: 2 },
    "Concentration mg/mL": { type: "number", number: 10 },
    "Conditions de prescription": { type: "multi_select", multi_select: [] },
    "Mention obligatoire": { type: "select", select: null },
  },
};
test("Export : conversion d'une page Notion", () => {
  const l = convertirPage(pageNotion);
  assert.equal(l.id, "42319207651b81aabbbb000000000001");
  assert.equal(l.nom, "Test ligne");
  assert.equal(l.molecule, null);
  assert.deepEqual(l.pathologies, ["Gale"]);
  assert.equal(l.doseMgKg, 10);
  assert.equal(l.mention, null);
  assert.deepEqual(l.ages, []);
  assert.equal(l.magistrale, false);
});
test("Export : modèle non rempli ignoré", () => {
  const modele = structuredClone(pageNotion);
  modele.properties["Ligne d'ordonnance"].rich_text = [{ plain_text: "Préparation magistrale : [principe actif] 1 % : 1 application par jour" }];
  assert.equal(convertirPage(modele), null);
});
test("Export : contrôle des marqueurs sans paramètres", () => {
  const l = convertirPage(pageNotion);
  l.concentration = null;
  assert.ok(controler([l]).some((a) => /\{mL\} sans concentration/.test(a)));
});

// ---------- Données publiées ----------
const donnees = JSON.parse(await readFile(new URL("data/medicaments.json", racine), "utf8"));
test("data/medicaments.json : lignes complètes", () => {
  assert.ok(Array.isArray(donnees.lignes) && donnees.lignes.length > 0, "aucune ligne");
  for (const l of donnees.lignes) {
    assert.ok(l.id && l.nom && l.ligne, "ligne incomplète : " + JSON.stringify(l).slice(0, 120));
    assert.ok(Array.isArray(l.pathologies), "pathologies non tableau : " + l.nom);
  }
});

if (echecs.length) {
  console.error(`${echecs.length} test(s) en échec sur ${n} :\n- ` + echecs.join("\n- "));
  process.exit(1);
}
console.log(`${n} tests réussis.`);
