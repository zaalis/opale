# Correctifs de l’éditeur de texte — 17 novembre 2026

Version conservée : **0.3.0**, avec un nouvel identifiant de compilation Windows.

## Corrections

- Sélection à la souris conservée lors du passage à la police, à la taille, aux flèches du champ numérique et aux palettes. Le focus du champ reste utilisable pour saisir une taille telle que 100.
- Barre synchronisée sur toute la sélection : famille, taille, graisse, gras, italique, souligné, barré, surlignage et réglages de paragraphe. Une sélection de styles différents affiche un état mixte. Les boutons actifs suivent la couleur d’accent du thème.
- Entrée au début d’un paragraphe, y compris un texte mis en forme : le paragraphe vide et son style sont conservés lors de l’enregistrement et de la réouverture.
- Une action de mise en forme forme une étape d’annulation. Les opérations sans changement ne créent pas d’étapes parasites. Ctrl+Z/Ctrl+Maj+Z fonctionnent aussi depuis les réglages ; en collaboration, les ajouts d’un autre participant restent présents.
- Palettes de couleur intégrées : second clic sur le rectangle pour fermer, clic à l’extérieur ou Échap. Les menus « Plus d’options » des notes locales et partagées se referment au second clic.
- Copier-coller enrichi : tailles en points, pixels et tailles HTML, familles, graisse, italique et couleurs conservés lorsqu’ils sont fournis ; conversion vers une famille Google locale équivalente si nécessaire.
- **40 familles Google Fonts supplémentaires** : 104 familles, 310 fichiers WOFF2 locaux avec licences. TTF originaux dans `artifacts/google-fonts-ttf` de chaque projet.

## Cas réel du PDF

Le test ouvre `B1 Enviro..pdf` dans le lecteur PDF de Chrome, sélectionne le texte par Ctrl+A, puis effectue un vrai Ctrl+C/Ctrl+V dans Opale. Le texte et la casse sont conservés. Dans ce cas, le presse-papiers contient du texte brut également étiqueté « text/html », sans aucune police ni taille : ces informations ne peuvent pas être retrouvées à partir du collage seul. La police de la note s’applique alors et le comportement est expliqué lors du collage. Un autre test réel du presse-papiers confirme la conservation de Helvetica 12 pt (adapté à Roboto 16 px), Lora 18 pt (24 px), du gras et de l’italique lorsque les métadonnées sont fournies.

## Vérification et portée

- Windows : 142 tests Node réussis ; essais d’interface avec vrais déplacements de souris, sélection inverse, liste de polices, champ numérique, palettes, menus, Entrée, presse-papiers et deux profils WebRTC.
- Linux : mêmes changements et polices reportés dans le code ; 148 tests Node réussis, deux tests propres à Windows ignorés ; essais des interactions dans Chromium et du rendu dans la fenêtre GTK/WebKit à partir des sources.
- Suite de régression : enregistrement/réouverture, retrait des styles, import/export PDF, pièces jointes, 104 familles hors ligne et collaboration.
- Windows est recompilé pour cette livraison. Les paquets Linux précédents ne sont pas reconstruits dans cette intervention, conformément à la demande de recompilation Windows pour l’instant.
- Aucun installateur n’est lancé et aucune publication GitHub n’est effectuée.

Scripts : `scripts/verify-text-interactions.cjs`, `scripts/verify-typography.cjs`. Captures et journaux : `artifacts/typography`.

## Livrable Windows vérifié

- Fichier : `dist/Opale-Setup-0.3.0.exe` ; copie identique dans `dist/Opale-Setup.exe`.
- Taille : 105,591,296 octets.
- SHA-256 : `d0397a39d1af9ca27602df5e36738e5ffc9500413c06f8b97f74a2fdae334823`.
- Identifiant de compilation : `3d49e19cc9ae0ece5dfa5fd43ea9b7e2a5f99c70eac40d55b53357ea4761ac4c`.
- Les deux suites de tests d’interface ont été exécutées sur le serveur Windows compilé. Le test du vrai copier-coller PDF utilise le fichier B1 Enviro local fourni.
