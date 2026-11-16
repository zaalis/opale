# Opale — exports configurables, captures et documents

16 novembre 2026. Modifications locales, non poussées sur GitHub.

## Fonctionnalités

Le nouveau bouton appareil photo et les options d’export ouvrent une fenêtre avec miniature du résultat. On peut exporter l’ensemble des éléments visibles du moodboard ou choisir **Enregistrement personnalisé** puis tracer un rectangle comme pour une capture d’écran. La zone est exprimée dans les coordonnées du moodboard et reste indépendante du zoom. Échap ou Annuler quitte la sélection sans modifier les éléments.

Formats réellement encodés : **PNG, JPEG (.jpg), WebP, TIFF (.tiff), BMP, SVG et PDF**. Le TIFF est RGB sans perte, compressé en Deflate lorsque le navigateur le permet ; le BMP est RGB 24 bits ; le SVG contient une image PNG incorporée, et le PDF une capture sur une page. Le SVG ne convertit pas les blocs en objets vectoriels éditables. Le JPEG et le WebP proposent une qualité de compression réglable, également utilisée pour la capture incorporée au PDF.

Les préréglages Full HD, 4K et 8K fixent respectivement le côté le plus long à 1 920, 3 840 et 7 680 pixels, en conservant le rapport largeur/hauteur. Les dimensions peuvent être personnalisées jusqu’à 16 384 pixels par côté, dans la limite de 64 mégapixels pour contenir la mémoire nécessaire à la capture. La densité est réglable de 36 à 1 200 pixels par pouce ; elle est écrite dans les métadonnées PNG, JPEG, WebP, TIFF et BMP, et détermine les dimensions physiques du SVG et du PDF. L’interface affiche les pixels, les mégapixels et le format physique en centimètres. La densité ne remplace pas le réglage du nombre de pixels.

Le nom du fichier est réglable. **Enregistrer sous…** utilise le sélecteur de destination du navigateur lorsqu’il est disponible. Dans l’application Windows, le téléchargement passe par une boîte de dialogue native IFileSaveDialog avec choix du dossier, du nom et confirmation d’écrasement. Dans un navigateur qui ne propose pas le sélecteur, les réglages de téléchargement de ce navigateur s’appliquent. L’annulation du choix de destination n’enregistre rien.

Les fichiers PDF, PPTX et PPT déposés, choisis dans **Importer**, ou ajoutés depuis le coffre sont transformés en images de pages, toutes alignées sur une seule rangée horizontale. Il n’y a pas de seuil de cinq pages ni de retour à la ligne. Les pages apparaissent progressivement, une progression est affichée et l’import peut être arrêté ; les pages déjà ajoutées restent présentes. Les pages d’un document sont groupées pour être déplacées ensemble. Il s’agit d’images statiques, pas d’une présentation interactive ni d’un import des animations PowerPoint.

Le rendu PDF utilise PDF.js 6.5.438 fourni dans l’application avec ses polices, tables de caractères, décodeurs et licence. Le PDF n’est pas envoyé à un service extérieur. L’import PowerPoint utilise l’application PowerPoint installée et activée sur le PC importateur, en lecture seule et sans fenêtre de document ; les macros sont désactivées pendant l’ouverture. Les réglages d’automatisation sont ensuite restaurés et les présentations déjà ouvertes par l’utilisateur sont conservées. En l’absence de PowerPoint, un message propose d’importer le PDF. Les API utilisées sont documentées par Microsoft : [Presentations.Open](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.presentations.open), [AutomationSecurity](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.application.automationsecurity).

Les pages utilisent le stockage de pièces jointes existant : coffre personnel pour un moodboard personnel, pièces jointes du projet pour un moodboard partagé. Les autres membres n’ont besoin ni d’Office ni du fichier original pour afficher les pages partagées.

Les liens collés ou déposés créent une carte dont le titre et le bouton ouvrent directement l’adresse dans le navigateur. Une icône de site est affichée si le favicon est disponible ; sinon l’icône générique reste visible. La récupération des icônes passe par le serveur local avec validation des adresses publiques, des redirections, du type de fichier et de la taille.

## Vérifications

- **126 tests automatisés réussis**, aucun échec.
- `verify-export-documents.cjs` réussi avec le serveur source puis avec le serveur Windows compilé : aperçu, capture réelle de **7 680 × 4 970 pixels**, sept formats téléchargés, écriture dans le fichier choisi via un sélecteur simulé, sélection d’un rectangle avec la souris sans modification du document, **100 pages PDF sur une seule rangée en personnel et en partagé**, six diapositives PowerPoint converties et importées en personnel et en partagé, favicon et ouverture effective d’un lien dans un nouvel onglet, aucune erreur JavaScript.
- Les fichiers PNG, JPEG, WebP, TIFF et BMP ont été relus par Pillow. Dimensions vérifiées : 800 × 518 pixels. Densité vérifiée : 300 ppp, avec l’arrondi normal en pixels par mètre pour PNG/BMP et la lecture EXIF pour WebP. Les versions PNG, TIFF et BMP sont identiques pixel par pixel. Le PDF a été relu par pdf-lib : sa page mesure 192 × 124,32 points, soit exactement les dimensions physiques attendues à 300 ppp.
- `verify-board-export.cjs` réussi sur le serveur compilé : capture de tous les éléments, positions négatives, rotation, connecteurs, images locales, exclusion d’un calque masqué, indépendance vis-à-vis de la caméra, JPG/PDF, message d’erreur sur un moodboard vide et document inchangé.
- `verify-board-browser.cjs` réussi : outils, édition, historique, déplacements, imports de diagrammes, sauvegarde, conflits, annulation des glisser-déposer, onglets et absence d’erreurs JavaScript.
- `verify-collab-speed.cjs` réussi sur le serveur compilé : connexion WebRTC authentifiée, texte et image sans Drive, aperçu immédiat, déplacements en direct, lecture TXT et squelette de chargement préservés.
- Interface d’export inspectée visuellement après la fin de l’animation. Les transitions utilisent les styles existants, et les animations ajoutées respectent la réduction des mouvements.
- Application Windows, serveur autonome et installateur recompilés. Un verrou sur le nom de l’installateur a nécessité une génération sous un nom temporaire, puis une copie vers `dist/Opale-Setup.exe`. Le script de compilation permet désormais de choisir ce chemin avec `OPALE_SETUP_OUTPUT`.

## Livrables et limites

- `dist/Opale.exe`, `dist/opale-server.exe`, `dist/Opale-Setup.exe`.
- Captures et fichiers de contrôle dans `artifacts/export-documents/`.
- L’installateur n’a pas été exécuté. La boîte de dialogue native de sauvegarde a été compilée ; son interaction visuelle dans WebView2 n’a pas été pilotée ici. Le chemin navigateur a été vérifié avec téléchargements réels et sélecteur de fichiers simulé.
- Les essais collaboratifs utilisent un Drive simulé. Aucun essai entre deux PC physiques avec deux comptes Google réels n’a été effectué pendant ce travail.
- Un PDF protégé par mot de passe demande une copie déverrouillée. Les diapositives importées sont des captures ; leur texte n’est pas directement éditable comme des blocs Opale.
