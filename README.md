# Module d'ordonnance

Outil de prescription modulaire pour la page Notion Wikipediatrie : choix des pathologies, sélection des lignes, calcul des doses au poids, mentions réglementaires, puis copie d'une ordonnance prête à coller.

Aide à la prescription pour un clinicien, qui reste décisionnaire. Les lignes proviennent de la base Notion "Médicaments" et sont au statut "À valider" tant qu'elles n'ont pas été vérifiées.

## Mise en route (une seule fois)

### 1. Activer GitHub Pages
Settings, Pages, Build and deployment, Source : **GitHub Actions**.

### 2. Créer le jeton Notion (lecture seule)
1. Ouvrir https://www.notion.so/profile/integrations, "Nouvelle intégration", type interne, espace de travail concerné.
2. Capacités : cocher uniquement "Lire le contenu". Copier le jeton secret.
3. Dans Notion, ouvrir la base "Médicaments" puis la base "Pathologies" (sous WikiPédiatrie), menu "...", "Connexions", ajouter l'intégration sur chacune. Ne la connecter à aucune autre page.

### 3. Enregistrer le jeton dans GitHub
Settings, Secrets and variables, Actions, "New repository secret" : nom `NOTION_TOKEN`, valeur : le jeton. Le jeton n'est écrit nulle part ailleurs.

### 4. Lancer la première synchronisation
Onglet Actions, "Synchroniser et publier", "Run workflow". Au bout d'une à deux minutes, le module est en ligne avec toutes les lignes de la base :
https://benkisim.github.io/module-ordonnance/

### 5. Intégrer dans Notion
Dans la page Wikipediatrie, taper `/intégrer` (ou `/embed`), coller l'adresse ci-dessus, puis agrandir le bloc à la hauteur voulue.

## Mises à jour

| Changement | Où | Mise en ligne |
|---|---|---|
| Ligne de prescription ou conseil (ajout, posologie, tag, statut AMM, âge et indications d'AMM, PMR) | Base Notion "Médicaments" | Chaque nuit, ou immédiatement avec "Run workflow" |
| Fonctionnement ou apparence du module | Demande à Claude Code sur ce dépôt | 1 à 2 minutes après le push |

Le fichier `data/medicaments.json` est régénéré à chaque synchronisation : ne pas le modifier à la main.

## Tester en local

```
node tests/run-tests.mjs
python3 -m http.server 8000
```
puis ouvrir http://localhost:8000. Le module ne fonctionne pas en ouvrant directement le fichier (il charge le JSON).

## Confidentialité

Le dépôt et le site sont publics. Le module fonctionne entièrement dans le navigateur : le poids saisi n'est ni enregistré ni transmis. Aucune donnée patient ne doit figurer dans le dépôt.
