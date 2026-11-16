# Opal Design, stabilité et mises à jour Windows - 16 novembre 2026

## Modèles et interface

Les modèles texte sont conservés car le nœud Assistant texte les utilise : rédaction de consignes, transformation de texte, analyse d'image pour les modèles disposant de cette capacité. Les modèles locaux sont conservés, y compris les identifiants personnalisés et les modèles image. Leur serveur doit exposer les routes compatibles configurées.

Les choix effectifs excluent les modalités sans adaptateur Design (embeddings, reranking, audio, transcription, temps réel vocal, vidéo, etc.) ainsi que les modèles image dont le protocole n'est pas pris en charge chez le fournisseur concerné. GPT-3.5 Turbo et GPT-4 sont retirés des choix OpenAI : leurs fiches officielles les indiquent arrêtés. Sources : [GPT-3.5 Turbo](https://developers.openai.com/api/docs/models/gpt-3.5-turbo), [GPT-4](https://developers.openai.com/api/docs/models/gpt-4). Un serveur local ou personnalisé peut continuer à employer ses propres identifiants.

Une actualisation réussie des modèles distants utilise la liste renvoyée par le fournisseur, au lieu de réintroduire systématiquement les choix historiques du catalogue. Cette liste ne prouve pas que chaque modèle est facturable ou autorisé pour chaque type de requête : aucune génération payante n'a été lancée pour tester les comptes réels.

Les outils Sélectionner, Main et Note libre affichent maintenant l'état actif orange et `aria-pressed`. Note libre sélectionne comme un outil du moodboard : cliquer ensuite sur le canevas place la note. Outils réaffiche directement la bibliothèque après Dossiers. Les trois points ferment leur menu au second clic ; Échap et le clic extérieur restent fonctionnels. Le statut Abonnement connecté utilise un badge vert discret.

## Clignotement

L'arbre personnel et partagé réutilise les lignes inchangées. Les clés des sous-fichiers partagés sont distinctes de celles de leur projet. Une actualisation identique ne retire plus les lignes du DOM et ne rejoue pas leur animation d'entrée. Les animations d'ouverture et de fermeture restent disponibles pour les changements de structure réels. Le point d'envoi n'utilise plus de pulsation. Les conteneurs d'arbre et de canevas ne dessinent plus de cadre jaune de focus.

## Mises à jour Windows

Le bouton de mise à jour se trouve dans la barre verticale gauche, juste au-dessus de Connexion à zaalis IDE. La version Windows vérifie GitHub à son démarrage, puis chaque heure. Le serveur source ouvert directement dans un navigateur n'active pas l'installation native.

Le téléchargement suit le paquet de `zaalis/opale`, branche `main`. Le commit est résolu avant de lire le manifeste et le fichier Windows, pour que les deux correspondent à la même publication. Le cercle montre le pourcentage réel d'octets reçus. La taille, le format exécutable et le SHA-256 sont vérifiés avant l'état Prêt. Un fichier modifié est refusé. Un fichier déjà téléchargé et vérifié est réutilisé. La version installée et les publications plus anciennes ne sont pas retéléchargées.

Au clic quand le paquet est prêt, Opale attend l'enregistrement des documents et refuse de fermer en cas de conflit, contenu non enregistré ou traitement Design en cours. Il lance l'installateur puis ferme sa fenêtre. L'installateur attend la fin de la fenêtre et de son serveur ; il ne force pas leur terminaison. Une petite fenêtre présente l'installation jusqu'à 100 %, puis Redémarrage en cours et relance l'application.

L'installation ne remplace que les quatre fichiers de l'application. Elle prépare tous les fichiers avant leur remplacement et garde une sauvegarde pendant la transaction pour revenir à la version précédente en cas de fichier verrouillé. Les coffres et comptes ne sont pas réécrits.

## Publication des versions

`npm run installer` génère maintenant une identité de compilation et `dist/update.json` avec taille et SHA-256 de l'installateur. Pour publier une mise à jour, les fichiers `dist/Opale-Setup.exe` et `dist/update.json` doivent correspondre et être publiés ensemble sur `main`. Les fichiers source ne sont pas compilés sur le PC destinataire.

La première installation de cette version reste manuelle, car les anciennes versions ne contiennent pas le mécanisme. Aucune publication GitHub et aucune installation sur le profil de l'utilisateur n'ont été effectuées pendant ce travail.

## Validation et livrables

- 140 tests Node réussis : catalogue, conservation du local, liste distante, téléchargement simultané mutualisé, commit figé, cache vérifié, rejet des fichiers corrompus et version déjà installée.
- Tests navigateur sur serveur Windows compilé : outils actifs, filtres, recherche, ajout, retour Dossiers vers Outils, double clic successif du menu, badge vert sur connexion simulée, sauvegarde/réouverture, retouche protégée et partage.
- Huit actualisations identiques du projet partagé : mêmes lignes DOM encore montées.
- Bouton de mise à jour testé avec API simulée : emplacement au-dessus de l'IDE, 37 % affiché, passage Prêt, enregistrement, appel d'installation et demande de fermeture.
- Code de transaction natif testé directement avec les ressources Windows réelles dans un dossier temporaire : fichier verrouillé refusé et anciens fichiers restaurés ; installation réussie des quatre binaires identiques octet par octet ; progression 100 %. Le test n'ouvre pas de fenêtre et ne relance pas l'Opale de l'utilisateur.
- Régressions collaboration et moodboard réussies sur le serveur compilé : WebRTC, texte/image hors Drive, focus sans cadre, TXT, squelette, outils, historique, imports et conflits.
- Application, serveur, désinstalleur et installateur recompilés ; manifeste final vérifié contre l'installateur.

Installateur : `dist/Opale-Setup.exe`.
SHA-256 : `2b24cc80d9f823dc8b31e234656cf039f1944a356378ddf8a98e1923f1c6ecaf`.
Journaux : `artifacts/build-update.log`, `artifacts/unit-tests.log`, `artifacts/design-update-tests.log`.

Le téléchargement d'une future publication GitHub et le cycle graphique complet fermeture/installation/redémarrage sur le profil réel n'ont pas été exécutés. Les tests réseau utilisent un fournisseur et un GitHub simulés ; le code de remplacement Windows est exécuté réellement dans le dossier temporaire.
