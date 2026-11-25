# Module d'ordonnance (Wikipediatrie)

Module HTML de prescription modulaire en pédiatrie (pratique française), publié par GitHub Pages et intégré dans la page Notion publique "Wikipediatrie" par un bloc Intégrer. Le clinicien choisit des pathologies, coche des lignes, saisit éventuellement le poids, puis copie une ordonnance finale.

## Langue et style

- Répondre en français, ton standard, sans émojis, formulation impersonnelle (pas de "tu" ni de "vous").
- Ne jamais utiliser le tiret long (U+2014), ni dans le code, ni dans les textes, ni dans les messages de commit.
- Signaler toute erreur ou incohérence médicale repérée (posologie, dose maximale, forme, concentration), sans la corriger silencieusement. Ne rien inventer.

## Architecture

| Fichier | Rôle |
|---|---|
| `index.html` | Le module complet : HTML, CSS et JS dans un seul fichier, aucune dépendance externe, aucune CDN. |
| `data/medicaments.json` | Copie de la base Notion "Médicaments". **Généré automatiquement, ne jamais le modifier à la main** : il est écrasé à chaque synchronisation. |
| `scripts/export-notion.mjs` | Lit la base Notion (API version 2025-09-03, endpoint data_sources) et écrit le JSON. |
| `.github/workflows/publier.yml` | À chaque push sur main, chaque nuit et à la demande : export Notion (si le secret `NOTION_TOKEN` existe), tests, puis publication sur GitHub Pages. |
| `tests/run-tests.mjs` | Tests de la logique et de l'export. Un test en échec bloque la publication. |
| `tests/fixture.json` | Jeu de lignes de test (certaines fictives). |

Dans `index.html`, toute la logique métier (calculs, ordre, mentions, alertes) est entre les commentaires `// === LOGIQUE DEBUT ===` et `// === LOGIQUE FIN ===`, sans accès au DOM. Les tests extraient ce bloc : ne pas déplacer ces marqueurs et ne pas y mettre de code dépendant du navigateur.

## Données

- Source unique des lignes : la base Notion "Médicaments" (data source `42319207-651b-81d8-bb4a-000b186ddb80`). Pour modifier une ligne (posologie, tag, statut AMM), modifier Notion, puis lancer la synchronisation (onglet Actions, "Synchroniser et publier", "Run workflow").
- Une entrée par ligne d'ordonnance. Clés du JSON : id, nom, ligne, molecule, pathologies, famille, zone, puissance, situation, magistrale, ages, statut, aVerifier, doseMgKg, prises, concentration, dosageUnitaire, doseMax, arrondi, statutAMM, remboursement, conditions, mention. Toute nouvelle propriété Notion doit être ajoutée dans `PROPRIETES` (script d'export) puis utilisée dans le module.
- Les lignes dont le texte contient des crochets `[...]` (modèle non rempli) sont ignorées à l'export.

## Règles de calcul au poids

- Marqueurs dans la ligne : `{mL}`, `{mg}`, `{unités}`.
- Dose par prise = poids x Dose mg/kg/jour / Prises par jour, plafonnée à Dose max / Prises.
- Conversion : par Concentration mg/mL (formes buvables), sinon par Dosage unitaire mg (comprimés, gélules, gouttes), sinon en mg seuls. Arrondi au pas "Arrondi" (défaut 0,5 mL, 1 unité ou 1 mg). Égalité entre deux pas : arrondi vers le bas. Un arrondi ne doit jamais dépasser la dose maximale.
- `{mg}` affiche la dose réellement administrée après arrondi.
- Le nom qui suit `{unités}` (comprimé, gélule, capsule, sachet, goutte...) est accordé : pluriel à partir de 2.
- Alertes : poids absent ou hors bornes (0,5 à 150 kg), dose plafonnée, écart d'arrondi supérieur à 10 % (attention) ou à 25 % (erreur).
- Les doses hebdomadaires ou par injection sont saisies dans "Dose mg/kg/jour" avec Prises par jour = 1.
- Le poids n'est jamais inscrit dans le texte copié, et rien n'est stocké ni envoyé.

## Format et ordre de l'ordonnance

- Une ligne par médicament, texte repris tel quel de la base (format des règles du projet : `Nom commercial (molécule) galénique : posologie, X fois par jour pendant Y jours`).
- Ordre : famille 1 à 7 (dermocorticoïdes, autres topiques anti-inflammatoires ou immunomodulateurs, topiques anti-infectieux, autres topiques spécifiques, émollients, systémiques, symptomatiques), puis zone (corps et membres, cuir chevelu, visage et plis, sans objet), puis puissance décroissante, puis nom.
- Préparation magistrale : la mention "Prescription à but thérapeutique en l'absence de spécialités équivalentes disponibles, renouvelable" est placée sous la dernière préparation d'un groupe consécutif.
- Mentions réglementaires (insérées par défaut sous la ligne, désactivables avec alerte) : les options Notion n'ont pas d'apostrophe, la table `MENTIONS_OFFICIELLES` donne le texte officiel. Hors AMM : "Prescription hors autorisation de mise sur le marché". Accès compassionnel : "Prescription au titre d'un accès compassionnel en dehors du cadre d'une autorisation de mise sur le marché". Indication non remboursable : "NR".
- Médicaments d'exception : placés dans un second bloc à copier (formulaire spécifique), sauf si toute la sélection en relève.
- Statut AMM, remboursement et conditions de prescription sont affichés en badges et en alertes, hors du texte copié.

## Contraintes de publication

- Le dépôt et la page sont publics : aucune donnée patient, aucun jeton, aucune clé API, aucune information personnelle du clinicien dans le dépôt.
- Le jeton Notion n'existe que dans le secret GitHub `NOTION_TOKEN`. Ne jamais le demander, l'afficher ni l'écrire dans un fichier.
- Compatible iframe Notion : largeur fluide, fond neutre, boutons d'au moins 42 px de haut, pas de boîte de dialogue `alert()`. La copie utilise l'API presse-papiers avec repli `execCommand`, puis sélection du texte.

## Avant chaque commit

1. `node tests/run-tests.mjs` doit réussir. Ajouter un test pour toute nouvelle règle de calcul ou d'ordre.
2. Vérifier le rendu dans un navigateur si l'interface change (serveur local : `python3 -m http.server` puis http://localhost:8000).
3. Message de commit en français, court, sans tiret long.
