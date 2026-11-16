# Mini-rapport — pièces jointes des projets partagés

Date : 16 novembre 2026

## Fonction ajoutée

- Une image ou un fichier déposé dans une note ou un moodboard partagé est envoyé dans le dossier Google Drive du projet. La référence est insérée après confirmation de l’envoi ; les autres membres autorisés peuvent ouvrir le fichier.
- Les images s’affichent dans les notes et les moodboards. Les autres fichiers peuvent être ouverts ou téléchargés selon leur type. Le collage et la sélection d’images des notes utilisent le même stockage partagé ; les images HTTPS déposées sont également prises en charge dans les limites du téléchargement public existant.
- Une copie locale est conservée après l’envoi ou la première lecture. Les lecteurs ne peuvent pas envoyer de fichiers. Les pièces jointes référencées sont incluses lors de l’export du projet.
- Un fichier du coffre local déposé sur un moodboard partagé est copié dans le projet pour éviter une référence inaccessible aux autres.

## Vérifications

- 124 tests automatisés réussis, dont un test avec deux membres et Drive simulé : transfert binaire, cache hors ligne, lecteur, isolation entre projets et export.
- Test navigateur automatisé : dépôt et affichage d’une image dans une note partagée, dépôt et lecture d’un fichier texte dans un moodboard partagé. Réussi avec le serveur de développement et le serveur Windows compilé.
- Suite navigateur des moodboards et des notes solo réussie.
- Installateur Windows recompilé : `dist/Opale-Setup.exe`. Il n’a pas été exécuté.

## Limites

- L’envoi d’une nouvelle pièce jointe nécessite une connexion Drive : il n’existe pas encore de file d’attente hors ligne. Les fichiers déjà téléchargés restent lisibles dans le cache local.
- Les pièces jointes sont accessibles depuis les notes et moodboards qui les référencent ; elles n’apparaissent pas comme fichiers indépendants dans l’arborescence des projets partagés. La suppression d’une référence ne supprime pas automatiquement le fichier de Drive.
- Les tests multi-comptes utilisent un Drive simulé. Un essai avec deux vrais comptes Google et deux ordinateurs reste nécessaire, notamment pour les autorisations Drive et les fichiers volumineux. Le geste physique depuis une autre application vers la fenêtre native n’a pas été reproduit.

## Complément — menus et médias

- Le clic droit propose le téléchargement des images, vidéos, audios et autres fichiers depuis les notes et les moodboards ; l’action reste disponible en lecture seule. Le remplacement d’une image d’un projet partagé copie le fichier choisi dans le projet.
- La lecture d’une vidéo WebM et l’affichage d’une image ont été vérifiés dans une note et un moodboard ; les téléchargements par menu ont été vérifiés dans Chrome avec le serveur compilé. Le navigateur intégré peut prendre en charge différents formats selon ses codecs.
- 124 tests automatisés réussis ; installateur recompilé, non installé. Les limites précédentes restent valables : pièces jointes hors arborescence, nouvel envoi hors ligne indisponible et vérification à faire avec deux comptes Google réels.
