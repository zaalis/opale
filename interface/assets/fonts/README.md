# Google Fonts locales — Opale 0.3.0

104 familles, 310 variantes, téléchargées depuis le dépôt officiel https://github.com/google/fonts le 17 novembre 2026.

Les fichiers WOFF2 inclus dans l’application proviennent d’une compression sans perte des TTF complets. Aucun sous-ensemble de caractères n’est créé. Les TTF originaux et leurs licences sont conservés localement dans `artifacts/google-fonts-ttf`. Chaque dossier de l’application contient également la licence originale de la famille.

`catalog.json` décrit les fichiers et leur provenance. `fonts.css` utilise exclusivement des chemins relatifs. Aucun appel à Google Fonts n’est effectué pendant l’utilisation, en local comme dans les projets partagés.

Pour régénérer : `node scripts/download-google-fonts.cjs`, puis `python scripts/compress-fonts.py` (FontTools et Brotli sont nécessaires uniquement sur la machine de compilation).

Les graisses effectivement dessinées et l’italique dépendent de la famille ; le navigateur adapte les styles disponibles. Le dossier et son catalogue peuvent être déplacés ensemble.
