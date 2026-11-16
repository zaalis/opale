# Opale — réactivité, lecture TXT et moodboards

Date : 16 novembre 2026. Base : `446a101` sur `main`. Modifications locales, non poussées.

## Résultat

- Dépôt d’images : aperçu immédiat à l’emplacement du dépôt dans un moodboard ; aperçu également dans les notes. La copie locale et la référence sont créées sans attendre Google Drive. Les imports par URL montrent un squelette pendant le téléchargement.
- Pièces jointes partagées : sauvegarde Drive en arrière-plan, file d’attente locale persistante, reprise après réouverture, déduplication des reprises et comptage dans les éléments en attente. L’adresse fondée sur le contenu ne change pas après l’envoi.
- Participants connectés : transfert direct WebRTC des fichiers jusqu’à 24 Mio, avec vérification du contenu et régulation pour préserver la réactivité du texte. Les fichiers plus volumineux passent par Drive. Les anciennes pièces jointes restent lisibles.
- Gestes : l’élément du moodboard suit le déplacement et le redimensionnement chez les autres avant la validation finale, au lieu d’afficher uniquement un contour de déplacement. La cadence de présence des moodboards passe de 60 à 32 ms.
- Chargement des images : squelette neutre avec reflet discret, espace réservé et respect du réglage système de réduction des mouvements. Reprises automatiques bornées puis état d’erreur.
- Fichiers `.txt` : affichage en lecture seule dans un onglet, en texte brut sélectionnable, pour les fichiers locaux et partagés. UTF-8 et UTF-16 avec BOM sont pris en charge ; le HTML est affiché littéralement. Limite d’aperçu : 8 Mio.
- Contour jaune extérieur : suppression de la règle qui dessinait l’anneau du moodboard ; le conteneur ne dessine plus d’outline ou d’ombre de focus.
- Blocs texte : protection du champ actif pendant les rafraîchissements, suppression du contour orange du champ d’édition, suppression des blocs nouveaux laissés vides et suppression de la création implicite d’un texte par double-clic dans le vide. Le double-clic sur un bloc existant conserve l’édition. Les poignées de sélection utiles restent disponibles sur un élément volontairement sélectionné et disparaissent après un clic dans le vide.

## Vérifications exécutées

- `npm test` : **126 tests réussis**, aucun échec. Deux nouveaux scénarios couvrent la file de pièces jointes hors ligne, la reprise après redémarrage, les permissions, l’intégrité, la récupération depuis Drive et les ajouts pendant un envoi actif.
- `scripts/verify-board-browser.cjs` : suite existante réussie dans Chrome (création, édition, historique, déplacements, imports, sauvegarde, conflits, annulation des glisser-déposer, restauration des onglets).
- `scripts/verify-shared-attachments.cjs` : réussi avec le serveur source puis le serveur Windows compilé ; images, fichiers, lecture vidéo et téléchargements contextuels.
- `scripts/verify-collab-speed.cjs` : réussi avec **deux processus serveur indépendants et deux contextes Chrome isolés**, puis à nouveau avec deux instances de `dist/opale-server.exe`. Drive est simulé, mais le canal WebRTC entre navigateurs est réel et authentifié.
- Dans ce dernier essai, Drive a été rendu indisponible après établissement du canal : le texte a été reçu en **15 ms** lors du passage sur les exécutables compilés ; une image d’environ 119 Ko a traversé le canal par plusieurs blocs et s’est affichée chez l’autre participant sans copie dans Drive. L’aperçu local a été vérifié pendant qu’une requête de dépôt était volontairement retardée.
- Contrôles navigateur ciblés réussis : conservation du champ pendant un rafraîchissement, clic ailleurs sans contour résiduel, absence de texte parasite au double-clic dans le vide, suppression d’un nouveau bloc vide, mouvement/redimensionnement distant avant validation, animation du squelette et réduction des mouvements, lecture TXT sans exécution HTML, absence d’erreur JavaScript.
- `npm run installer` : application et installateur Windows recompilés avec succès. Le client Google intégré a passé le contrôle de construction.
- Capture de contrôle : `artifacts/collab-loading-check.png`.

## Limites et utilisation

Les mesures ont été faites sur cette machine ; elles ne garantissent pas 15 ms entre deux ordinateurs sur Internet. L’établissement initial du canal passe toujours par Drive ; un réseau qui bloque WebRTC sans relais TURN conserve la voie Drive avec son délai. Une image distante ne peut être complète avant le transfert de ses octets. Aucun essai avec deux comptes Google réels sur deux machines physiques n’a été effectué ici.

Les deux ordinateurs doivent utiliser la nouvelle version pour les nouvelles pièces jointes et leur transfert direct. L’installateur est prêt dans `dist/Opale-Setup.exe` ; il n’a pas été exécuté et la version installée n’a pas été remplacée. Aucun changement n’a été envoyé sur GitHub.
