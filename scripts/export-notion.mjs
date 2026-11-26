// Export des bases Notion "Médicaments" et "Pathologies" vers data/medicaments.json.
// Lancé par l'automatisation GitHub (.github/workflows/publier.yml).
// Le jeton est lu dans la variable d'environnement NOTION_TOKEN (secret du dépôt),
// il ne doit jamais être écrit dans un fichier du dépôt.
//
// Usage local (facultatif) : NOTION_TOKEN=xxx node scripts/export-notion.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ID_SOURCE = process.env.NOTION_DATA_SOURCE_ID || "42319207-651b-81d8-bb4a-000b186ddb80";
const ID_PATHOLOGIES = process.env.NOTION_PATHOLOGIES_ID || "42419207-651b-8177-a31b-000b098f9895";
const VERSION_API = "2025-09-03";
const RACINE = fileURLToPath(new URL("..", import.meta.url));
const SORTIE = RACINE + "data/medicaments.json";

// Correspondance entre les propriétés Notion et les clés du JSON.
export const PROPRIETES = {
  nom: "Nom",
  ligne: "Ligne d'ordonnance",
  molecule: "Molécule",
  famille: "Famille",
  zone: "Zone",
  puissance: "Puissance",
  situation: "Situation",
  magistrale: "Préparation magistrale",
  ages: "Tranche d'âge",
  statut: "Statut",
  aVerifier: "À vérifier",
  doseMgKg: "Dose mg/kg/jour",
  prises: "Prises par jour",
  concentration: "Concentration mg/mL",
  dosageUnitaire: "Dosage unitaire mg",
  doseMax: "Dose max mg/jour",
  arrondi: "Arrondi",
  statutAMM: "Statut AMM",
  remboursement: "Remboursement",
  conditions: "Conditions de prescription",
  mention: "Mention obligatoire",
  ageAMM: "Âge AMM",
  indicationsAMM: "Indications AMM",
};

const sansTirets = (id) => String(id).replace(/-/g, "");

function valeur(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case "title":
    case "rich_text": {
      const t = (prop[prop.type] || []).map((r) => r.plain_text).join("").trim();
      return t || null;
    }
    case "select":
      return prop.select ? prop.select.name : null;
    case "multi_select":
      return (prop.multi_select || []).map((o) => o.name);
    case "number":
      return typeof prop.number === "number" ? prop.number : null;
    case "checkbox":
      return Boolean(prop.checkbox);
    case "relation":
      return (prop.relation || []).map((r) => sansTirets(r.id));
    default:
      return null;
  }
}

// Pathologies d'une ligne : relation "Pathologies" vers la base Pathologies (noms retrouvés
// grâce à nomsParId), sinon ancien champ multi-sélection ("Pathologies" ou "Pathologies (ancien)").
function lirePathologies(p, options) {
  const rel = p["Pathologies"];
  if (rel && rel.type === "relation" && options.nomsParId) {
    const ids = options.idsComplets || valeur(rel);
    return ids.map((id) => options.nomsParId.get(sansTirets(id))).filter(Boolean);
  }
  for (const nom of ["Pathologies", "Pathologies (ancien)"]) {
    if (p[nom] && p[nom].type === "multi_select") return valeur(p[nom]);
  }
  return [];
}

// Transforme une page de la base Pathologies. Synonymes séparés par des points-virgules.
export function convertirPathologie(page) {
  const p = page.properties || {};
  const nom = valeur(p["Nom"]);
  if (!nom) return null;
  const synonymes = (valeur(p["Synonymes"]) || "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
  return {
    id: sansTirets(page.id),
    nom,
    synonymes,
    categories: valeur(p["Catégories"]) || [],
    sousCategorie: valeur(p["Sous-catégorie"]),
  };
}

// Transforme une page Notion en ligne du JSON. Renvoie null pour les pages à ignorer.
// options.nomsParId : Map id de pathologie -> nom ; options.idsComplets : relation complète si tronquée.
export function convertirPage(page, options = {}) {
  const p = page.properties || {};
  const ligne = { id: page.id.replace(/-/g, "") };
  for (const [cle, nomNotion] of Object.entries(PROPRIETES)) {
    ligne[cle] = valeur(p[nomNotion]);
  }
  ligne.pathologies = lirePathologies(p, options);
  for (const cle of ["pathologies", "ages", "conditions", "indicationsAMM"]) {
    if (!Array.isArray(ligne[cle])) ligne[cle] = [];
  }
  ligne.magistrale = ligne.magistrale === true;
  // Lignes vides ou modèles non remplis (crochets) : ignorées.
  if (!ligne.nom || !ligne.ligne || /\[[^\]]+\]/.test(ligne.ligne)) return null;
  return ligne;
}

// Contrôles de cohérence : renvoie une liste d'avertissements (non bloquants).
export function controler(lignes) {
  const avert = [];
  for (const l of lignes) {
    const marqueurs = /\{(mL|mg|unités)\}/.test(l.ligne);
    if (marqueurs && !(l.doseMgKg > 0 && l.prises > 0)) {
      avert.push(`${l.nom} : marqueurs de calcul sans dose ou nombre de prises`);
    }
    if (/\{mL\}/.test(l.ligne) && !(l.concentration > 0)) {
      avert.push(`${l.nom} : marqueur {mL} sans concentration`);
    }
    if (/\{unités\}/.test(l.ligne) && !(l.dosageUnitaire > 0)) {
      avert.push(`${l.nom} : marqueur {unités} sans dosage unitaire`);
    }
    if (!marqueurs && l.doseMgKg > 0) {
      avert.push(`${l.nom} : dose au poids renseignée mais aucun marqueur dans la ligne`);
    }
    if (!l.famille) avert.push(`${l.nom} : famille non renseignée`);
  }
  return avert;
}

const entetes = (jeton) => ({
  Authorization: `Bearer ${jeton}`,
  "Notion-Version": VERSION_API,
  "Content-Type": "application/json",
});

// Relation tronquée par l'API (plus de 25 éléments) : lecture complète, page par page.
async function relationComplete(jeton, idPage, idPropriete) {
  const ids = [];
  let curseur;
  do {
    const url = `https://api.notion.com/v1/pages/${idPage}/properties/${encodeURIComponent(idPropriete)}`
      + (curseur ? `?start_cursor=${encodeURIComponent(curseur)}` : "");
    const rep = await fetch(url, { headers: entetes(jeton) });
    if (!rep.ok) throw new Error(`Notion a répondu ${rep.status} sur une relation : ${(await rep.text()).slice(0, 300)}`);
    const json = await rep.json();
    for (const r of json.results || []) if (r.relation) ids.push(sansTirets(r.relation.id));
    curseur = json.has_more ? json.next_cursor : undefined;
  } while (curseur);
  return ids;
}

async function interroger(jeton, idSource = ID_SOURCE) {
  const pages = [];
  let curseur;
  do {
    const rep = await fetch(`https://api.notion.com/v1/data_sources/${idSource}/query`, {
      method: "POST",
      headers: entetes(jeton),
      body: JSON.stringify(curseur ? { page_size: 100, start_cursor: curseur } : { page_size: 100 }),
    });
    if (!rep.ok) {
      const texte = await rep.text();
      throw new Error(`Notion a répondu ${rep.status} : ${texte.slice(0, 500)}`);
    }
    const json = await rep.json();
    pages.push(...json.results);
    curseur = json.has_more ? json.next_cursor : undefined;
  } while (curseur);
  return pages;
}

async function principal() {
  const jeton = process.env.NOTION_TOKEN;
  if (!jeton) {
    console.error("NOTION_TOKEN absent : export impossible.");
    process.exit(1);
  }
  // Référentiel des pathologies (synonymes). En cas d'échec (intégration non connectée à la
  // base Pathologies), repli sur l'ancien champ multi-sélection des lignes.
  let pathologies = [];
  let nomsParId = null;
  try {
    pathologies = (await interroger(jeton, ID_PATHOLOGIES))
      .filter((pg) => !pg.in_trash && !pg.archived)
      .map(convertirPathologie)
      .filter(Boolean)
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    nomsParId = new Map(pathologies.map((x) => [x.id, x.nom]));
    console.log(`${pathologies.length} pathologies lues.`);
  } catch (e) {
    console.warn("Avertissement : base Pathologies illisible, repli sur l'ancien champ. Connecter l'intégration à la base Pathologies.", e.message);
  }

  const pages = (await interroger(jeton)).filter((pg) => !pg.in_trash && !pg.archived);
  const lignes = [];
  for (const pg of pages) {
    const rel = pg.properties && pg.properties["Pathologies"];
    let idsComplets;
    if (nomsParId && rel && rel.type === "relation" && rel.has_more) {
      idsComplets = await relationComplete(jeton, pg.id, rel.id);
    }
    const l = convertirPage(pg, { nomsParId, idsComplets });
    if (l) lignes.push(l);
  }
  lignes.sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.id.localeCompare(b.id));

  // Sécurité : ne jamais écraser les données avec une liste vide (jeton sans accès, base vide).
  if (lignes.length === 0) {
    console.error("Aucune ligne reçue de Notion : fichier non modifié. Vérifier que l'intégration a accès à la base Médicaments.");
    process.exit(1);
  }

  // Sécurité : si aucune ligne n'a de pathologie (relation vide, accès manquant), ne rien écraser.
  if (!lignes.some((l) => l.pathologies.length)) {
    console.error("Aucune ligne n'a de pathologie : fichier non modifié. Vérifier la relation Pathologies et l'accès de l'intégration.");
    process.exit(1);
  }

  for (const a of controler(lignes)) console.warn("Avertissement :", a);

  let ancien = null;
  try {
    ancien = JSON.parse(await readFile(SORTIE, "utf8"));
  } catch {
    /* premier export */
  }
  if (ancien && !ancien.echantillon && JSON.stringify(ancien.lignes) === JSON.stringify(lignes)
    && JSON.stringify(ancien.pathologies || []) === JSON.stringify(pathologies)) {
    console.log(`Aucun changement (${lignes.length} lignes).`);
    return;
  }
  const sortie = { genere: new Date().toISOString(), source: "Notion, bases Médicaments et Pathologies", pathologies, lignes };
  await mkdir(dirname(SORTIE), { recursive: true });
  await writeFile(SORTIE, JSON.stringify(sortie, null, 2) + "\n", "utf8");
  console.log(`${lignes.length} lignes et ${pathologies.length} pathologies exportées vers data/medicaments.json.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
