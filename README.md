# PQC Watch

Agrégateur d'actualités sur la **cryptographie post-quantique (PQC)**, la **distribution quantique de clés (QKD)**, la **menace quantique** pour la cybersécurité et les **ordinateurs quantiques** (jalons et annonces).

Le site est généré et mis à jour automatiquement : GitHub Actions collecte des sources publiques (RSS/Atom et quelques pages web) toutes les 15 minutes, ne conserve que les articles pertinents, commite les données si elles ont changé et publie le site sur GitHub Pages.

## Fonctionnement

```
sources.json            liste des flux suivis (nom, URL, type)
scripts/collect.py      collecte, filtrage par mots-clés, dédoublonnage, historique
site/                   site statique (HTML/CSS/JS, sans framework)
site/anim.js            animation « Treillis Hoplite » (motif H de la charte)
site/assets/brand/      logos et icônes Hoplite
site/data/articles.json données générées (historique sur 2 ans)
.github/workflows/      workflow GitHub Actions (cron + déploiement Pages)
tests/                  tests unitaires du collecteur
```

Le collecteur utilise uniquement la bibliothèque standard Python (3.9+), aucune dépendance à installer.

Thèmes détectés automatiquement :

| Thème | Exemples de termes |
|---|---|
| PQC | post-quantum, ML-KEM, ML-DSA, SLH-DSA, FN-DSA, HQC, FIPS 203/204/205, crypto-agility |
| QKD | QKD, quantum key distribution, BB84, quantum internet |
| Menace quantique | Shor, CRQC, Q-Day, « harvest now, decrypt later » |
| Normes & politiques | NIST, CNSA 2.0, ANSSI, ENISA, NCSC, BSI, ETSI, IETF |
| Ordinateurs quantiques | qubits logiques, correction d'erreurs, avantage quantique, annonces des grands acteurs (IBM, Google, IonQ, Quantinuum, Pasqal…) |

Le thème « Ordinateurs quantiques » est volontairement ciblé (annonces, jalons, correction d'erreurs) : la physique quantique en général n'est pas retenue. Un article peut porter plusieurs thèmes.

## Le site

Quatre vues, avec une barre de navigation qui reste collée en haut de la page :

- **À la une** : l'article phare, six articles à lire ensuite, le pouls de la semaine (courbes sur 14 jours), « en bref » et trois rubriques par type de source ;
- **Briefing** : six articles à retenir, un par écran, aux flèches du clavier, au clic ou au doigt ;
- **Toute l'actu** : mosaïque filtrable par sujet, source et période ;
- **Sources** : une tuile par source suivie (nombre d'articles, dernier titre, état de la collecte).

Un article peut porter une image (`image` dans les données) : seule son adresse est conservée, elle est chargée depuis le site de l'éditeur. Elles sont **masquées par défaut**, le temps de clarifier les droits des éditeurs ; `?images=1` dans l'adresse du site les affiche. Les images viennent des flux (`media:content`, `enclosure`, première image du texte) ou, pour les sources marquées `"og_image": true` (ex. NIST), de l'image de partage de la page de l'article. Les logos et pixels de suivi sont ignorés.

Le motif H de la charte (`site/assets/brand/motif-cell.png`) est répété sur tout le fond de la carte « À la une » et du briefing. Sans ce fichier, ou si le visiteur demande moins de mouvement, aucune animation n'est affichée.

Les sources marquées `"all": true` dans `sources.json` sont considérées comme entièrement dédiées au sujet (aucun filtre appliqué). Par défaut, toutes les sources sont filtrées.

Une source peut aussi exclure un thème avec `"exclude_themes": ["Ordinateurs quantiques"]` : c'est le cas des flux de prépublications (arXiv, IACR), très volumineux, qui noieraient ce thème sous des articles de recherche.

## Mise en place sur GitHub

1. Pousser le dépôt sur GitHub (branche `main`).
2. Dans **Settings → Pages**, choisir **Source : GitHub Actions**.
3. Dans **Settings → Actions → General → Workflow permissions**, cocher **Read and write permissions** (nécessaire pour committer les données).
4. Lancer le workflow une première fois : onglet **Actions → PQC Watch → Run workflow**.

Le site est ensuite disponible à `https://<utilisateur>.github.io/<dépôt>/`.

## Utilisation locale

```bash
python -m unittest discover -s tests -v
python scripts/collect.py
python -m http.server 8000 -d site
```

Puis ouvrir http://localhost:8000.

## Ajouter une source

Deux types de sources :

- **Flux RSS/Atom** (par défaut) :

  ```json
  { "name": "Nom affiché", "url": "https://exemple.org/feed.xml", "category": "Presse spécialisée" }
  ```

- **Scraping d'une page d'actualités** (`"type": "scrape"`) : le collecteur lit les liens de la page dont l'URL matche `link_pattern` (regex) et prend le texte du lien comme titre. Si le titre contient une date `jj/mm/aaaa`, elle est utilisée comme date de l'article.

  ```json
  {
    "name": "ETSI – communiqués",
    "type": "scrape",
    "url": "https://www.etsi.org/newsroom/press-releases",
    "link_pattern": "/newsroom/press-releases/[^/]+/?$",
    "category": "Officiel"
  }
  ```

- **Plan de site** (`"type": "sitemap"`) : pour un site sans flux RSS dont les pages sont protégées contre les robots mais dont le `sitemap.xml` est public (annoncé dans son `robots.txt`), comme celui de l'ANSSI. Le collecteur lit les adresses qui matchent `link_pattern`. **Le titre est déduit de l'adresse** (les pages elles-mêmes ne sont pas lues) et **la date est celle de la dernière modification** de la page, pas forcément de sa publication.

  ```json
  { "name": "ANSSI", "type": "sitemap", "url": "https://cyber.gouv.fr/sitemap.xml", "link_pattern": "cyber\.gouv\.fr/(actualites|nous-connaitre/publications|enjeux-technologiques)/.+", "category": "Officiel", "lang": "fr" }
  ```

`category` sert au filtre « Type de source ». `"lang": "fr"` marque une source en français (par défaut : anglais) : c'est ce qu'utilise le filtre « Français uniquement » de « Toute l'actu ». Les mots-clés de détection existent en français et en anglais, et la langue d'un article est corrigée quand son titre est nettement dans l'autre langue (ex. un document en anglais publié par l'ANSSI). Ajouter `"all": true` si la source ne traite que du sujet (sinon les articles sont filtrés par mots-clés).

Le scraping est fragile par nature : si un site change sa structure, la source passe en erreur dans le journal du workflow sans bloquer les autres. Les pages rendues en JavaScript (ex. ANSSI) ne sont pas lisibles par ce scraper simple.

## Limites connues

- L'ANSSI n'est pas incluse : sa liste d'actualités est rendue en JavaScript et n'est pas accessible au scraper actuel.
- Le filtrage repose sur des motifs de mots-clés : il peut laisser passer quelques articles hors sujet ou en manquer certains formulés autrement. Les motifs sont dans `THEMES` de `scripts/collect.py`.
- Le collecteur utilise un User-Agent de navigateur, car plusieurs éditeurs refusent les clients non navigateur (erreur 403).
