# Mini-rapport Opale — 16 novembre 2026

## Résultat

- Le moodboard montre un aperçu de placement pour les outils de création compatibles, dont le texte, avant le clic.
- La fenêtre Calques affiche une vignette de la dernière image présente dans chaque calque, une poignée de déplacement et des boutons monter/descendre utilisables sans glisser. L'ordre des calques détermine leur superposition ; l'ordre est enregistré dans le document.
- Le dépôt d'une image depuis Chrome est pris en charge pour les fichiers transférés et pour les images HTTPS transmises sous forme de HTML ou d'URL. Les images PNG, JPEG, GIF et WebP récupérées par URL sont enregistrées dans les pièces jointes du coffre local. Les serveurs locaux et privés sont refusés et le téléchargement est limité à 20 Mo. Un site peut refuser ou empêcher le téléchargement, notamment si l'image requiert une connexion ou une URL temporaire.
- Les pièces jointes ne sont **pas encore synchronisées entre les membres d'un projet partagé**. Le dépôt sur un moodboard partagé est désormais refusé avec un message explicite, afin d'éviter d'y créer une référence locale invisible pour les autres. Cette limite préexistante concerne aussi les notes partagées.

## Vérifications

- 123 tests automatisés réussis, dont les scénarios de collaboration multi-appareils, panne Drive, reprise et permissions, avec Drive simulé.
- Suite de vérification du moodboard réussie dans Chrome automatisé, sur le serveur de développement puis sur le serveur Windows compilé. Test ciblé réussi pour l'aperçu, la vignette, l'ordre des calques et un dépôt HTML simulé ; le téléchargement d'une image HTTPS publique a également réussi. Le geste physique Chrome vers la fenêtre native Opale n'a pas été reproduit.
- La connexion Google enregistrée a répondu à une lecture Drive réelle et un dossier de projet partagé a été détecté. Cela ne vérifie ni les invitations ni les éditions simultanées entre deux vrais comptes ; il n'est donc pas possible d'affirmer que tous les cas de partage et de synchronisation fonctionnent parfaitement.
- L'installateur et le serveur Windows ont été recompilés ; l'installateur n'a pas été exécuté.

## À vérifier ou terminer

1. Synchroniser réellement les fichiers et images des projets partagés, avec gestion des droits, des suppressions, des conflits et du mode hors ligne.
2. Tester avec deux comptes Google et deux appareils : invitation, rôles, modifications simultanées, coupure réseau et reprise ; vérifier les fichiers avec les deux comptes une fois leur prise en charge implémentée.
3. Tester le glisser-déposer physique depuis plusieurs sites Chrome dans l'application native et vérifier les sites nécessitant une authentification.
