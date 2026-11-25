// Export de la base Notion "Médicaments" vers data/medicaments.json.
// Lancé par l'automatisation GitHub (.github/workflows/publier.yml).
// Le jeton est lu dans la variable d'environnement NOTION_TOKEN (secret du dépôt),
// il ne doit jamais être écrit dans un fichier du dépôt.
//
// Usage local (facultatif) : NOTION_TOKEN=xxx node scripts/export-notion.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ID_SOURCE = process.env.NOTION_DATA_SOURCE_ID || "42319207-651b-81d8-bb4a-000b186ddb80";
const VERSION_API = "2025-09-03";
const RACINE = fileURLToPath(new URL("..", import.meta.url));
const SORTIE = RACINE + "data/medicaments.json";

// Correspondance entre les propriétés Notion et les clés du JSON.
export const PROPRIETES = {
  nom: "Nom",
  ligne: "Ligne d'ordonnance",
  molecule: "Molécule",
  pathologies: "Pathologies",
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
};

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
    default:
      return null;
  }
}

// Transforme une page Notion en ligne du JSON. Renvoie null pour les pages à ignorer.
export function convertirPage(page) {
  const p = page.properties || {};
  const ligne = { id: page.id.replace(/-/g, "") };
  for (const [cle, nomNotion] of Object.entries(PROPRIETES)) {
    ligne[cle] = valeur(p[nomNotion]);
  }
  for (const cle of ["pathologies", "ages", "conditions"]) {
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

async function interroger(jeton) {
  const pages = [];
  let curseur;
  do {
    const rep = await fetch(`https://api.notion.com/v1/data_sources/${ID_SOURCE}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jeton}`,
        "Notion-Version": VERSION_API,
        "Content-Type": "application/json",
      },
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
  const pages = await interroger(jeton);
  const lignes = pages
    .filter((pg) => !pg.in_trash && !pg.archived)
    .map(convertirPage)
    .filter(Boolean)
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.id.localeCompare(b.id));

  // Sécurité : ne jamais écraser les données avec une liste vide (jeton sans accès, base vide).
  if (lignes.length === 0) {
    console.error("Aucune ligne reçue de Notion : fichier non modifié. Vérifier que l'intégration a accès à la base Médicaments.");
    process.exit(1);
  }

  for (const a of controler(lignes)) console.warn("Avertissement :", a);

  let ancien = null;
  try {
    ancien = JSON.parse(await readFile(SORTIE, "utf8"));
  } catch {
    /* premier export */
  }
  if (ancien && !ancien.echantillon && JSON.stringify(ancien.lignes) === JSON.stringify(lignes)) {
    console.log(`Aucun changement (${lignes.length} lignes).`);
    return;
  }
  const sortie = { genere: new Date().toISOString(), source: "Notion, base Médicaments", lignes };
  await mkdir(dirname(SORTIE), { recursive: true });
  await writeFile(SORTIE, JSON.stringify(sortie, null, 2) + "\n", "utf8");
  console.log(`${lignes.length} lignes exportées vers data/medicaments.json.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
