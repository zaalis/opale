# Rapport — Opal Design — 16 novembre 2026

## Résultat livré

Opal Design est intégré à Opale, dans un document `.canvas` personnel ou partagé. La référence ouverte dans Chrome a été consultée sans modifier le projet ni exécuter un modèle. L’atelier reprend une organisation de travail à nœuds, avec l’identité visuelle d’Opale, sans intégrer de code ou d’assets de Weave.

Création depuis l’explorateur et depuis les projets partagés ; bibliothèque d’outils filtrable ; canevas à points ; notes ; ports typés reliés par clic ou glisser-déposer ; inspecteur ; exécution des branches ; arrêt ; cache des dépendances ; variantes et historique ; comparateur ; workflows réutilisables. Les transformations locales comprennent recadrage, dimensions, rotation, miroir, couleur, flou et composition.

Les nœuds IA couvrent texte, image, retouche et sélection assistée. La sélection manuelle propose pinceau, gomme, rectangle, ellipse, dureté et annulation. La retouche compose le résultat avec la source originale : les pixels dont le masque est noir ne sont pas remplacés par la génération. La sélection assistée doit être vérifiée ; elle ne promet pas une segmentation parfaite.

Le catalogue de connexion ide a été intégré comme source autonome : 39 entrées de fournisseurs, sélection de modèles, découverte et identifiants supplémentaires. Les adaptateurs couvrent Responses OpenAI, messages Anthropic, generateContent Gemini et les serveurs compatibles. L’édition d’image xAI utilise sa requête JSON spécifique, conformément à la [documentation officielle xAI](https://docs.x.ai/developers/model-capabilities/images/editing), avec masque fourni comme référence et composition protégée locale. Les autres endpoints compatibles restent soumis aux capacités réelles du fournisseur.

Paramètres → Opal Design regroupe les connexions. La connexion ChatGPT reprend le flux navigateur PKCE actuel de l’IDE ; Grok et MiniMax reprennent leurs flux de connexion par code. Les autres fournisseurs utilisent une clé ou un serveur local selon leur catalogue. Les abonnements ne sont pas présentés comme donnant automatiquement accès aux API d’image. Les clés et jetons restent dans un fichier chiffré par DPAPI, hors des coffres et des documents partagés.

Les listes de choix sont remplacées visuellement par des menus arrondis et animés. Les sections dépliantes et les arbres personnel/partagé animent leur ouverture et leur fermeture. La réduction des mouvements est respectée. La zone de capture des câbles ne masque plus les ports des cartes.

## Vérifications effectuées

- **135 tests Node réussis, zéro échec**. Les neuf tests Design couvrent le graphe, la sérialisation, les références de fichiers, les adaptateurs de protocole, les flux de connexion annulables, les templates, DPAPI et les courses entre renouvellement et déconnexion.
- **Navigateur Chrome avec serveur Windows compilé** : création personnelle, 39 fournisseurs, absence de secret dans le catalogue et dans le document, liaison réelle à la souris, peinture d’un masque et sauvegarde, requête multipart de retouche, résultat protégé, historique, cache, transformation 64 × 64, refus de type incompatible, paramètres et menu animé, réouverture du document enregistré.
- Dernier contrôle de retouche : **14 944 pixels extérieurs conservés exactement et 1 440 pixels sélectionnés modifiés** sur une image 128 × 128. Le faux fournisseur renvoyait une image entièrement rouge alors que la source était bleue.
- **Projet partagé** : création d’un atelier, génération par fournisseur simulé, résultat stocké en pièce jointe partagée, récupération du fichier et export d’une copie. Aucun incident JavaScript relevé.
- **Régression moodboard sur serveur compilé** : outils, édition, sauvegarde, annuler/rétablir, déplacement, bibliothèques, Mermaid/draw.io, MCP, conflits externes, reprise après erreur, documents endommagés, onglets et restauration.
- **Régression collaboration** : deux serveurs indépendants et deux contextes navigateur, WebRTC authentifié, texte livré en 14 ms dans le scénario local, pièces jointes et déplacements transmis avec Drive simulé hors ligne, aperçu immédiat, TXT, chargement squelette, absence de contour de focus du canevas. Cette mesure locale ne promet pas une latence identique sur Internet.
- **Régression export/import sur serveur compilé** : capture réelle 7 680 × 4 970, PNG/JPEG/WebP/TIFF/BMP/SVG/PDF, enregistrement dans le fichier choisi via sélecteur simulé, rectangle de capture à la souris sans modifier le document, 100 pages PDF sur une rangée, six diapositives PowerPoint, import personnel et partagé, favicon et ouverture de liens.
- `git diff --check` réussi.
- Application native, serveur autonome, utilitaire de sélection de dossier, désinstalleur et installateur recompilés avec succès.

## Livrables

- Installateur final : `dist/Opale-Setup.exe`.
- Application et serveur : `dist/Opale.exe` et `dist/opale-server.exe`.
- SHA-256 de l’installateur final : `A988B58D8878C14277065912215A851D29F90F3C939FF7ED32F9182563A711C9`.
- Guide : `docs/OPAL-DESIGN.md`.
- Captures : `artifacts/opal-design.png` et `artifacts/design-settings.png`.
- Journaux : `artifacts/unit-tests.log`, `artifacts/design-browser-tests.log`, `artifacts/build-design.log`.

L’installateur n’a pas été exécuté et aucun changement n’a été envoyé sur GitHub. Un verrou Windows sur l’ancien exécutable d’installation a nécessité sa conservation sous un nom intermédiaire avant la copie du dernier installateur vers le nom standard.

## Limites et nettoyage

Les tests de fournisseurs utilisent des réponses simulées. Aucune connexion réelle à un abonnement et aucune génération payante n’ont été effectuées. La disponibilité effective de chaque modèle et de chaque connexion reste à vérifier avec le compte correspondant. Les essais collaboratifs utilisent un Drive simulé et deux processus locaux, pas deux PC physiques.

L’atelier prend en charge l’image et le texte. Il ne constitue pas un éditeur PSD complet et ne propose pas encore les chaînes vidéo, audio ou 3D. Les traitements IA attendent leur fournisseur ; le temps réel concerne les interactions, les aperçus et la collaboration. Les modèles et abonnements de l’IDE sont configurés indépendamment dans Opale.

La suppression demandée des anciens installateurs et objets de compilation a été tentée, puis refusée par le contrôle automatique d’exécution avec le motif « blocked by policy ». Aucun contournement n’a été effectué. Les anciens fichiers sont donc encore présents, ainsi que les installateurs intermédiaires ; le fichier à utiliser est bien `dist/Opale-Setup.exe`. Le script de compilation range désormais les nouveaux objets intermédiaires dans `dist` et prévoit leur nettoyage en fin de compilation.
