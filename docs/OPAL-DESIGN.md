# Opal Design

Opal Design est un atelier de création visuelle à nœuds, intégré aux fichiers `.canvas` d’Opale. Il utilise le moteur du moodboard et le même modèle collaboratif. L’interface et les icônes sont propres à Opale ; aucun composant, marque ou fichier de Weave n’est intégré.

## Ouvrir un atelier

Dans la barre de l’explorateur, utiliser le bouton Opal Design. Le menu de création de tableaux propose aussi le moodboard libre, le kanban, le tableau, la carte mentale et la chronologie. Dans un projet partagé, choisir « Nouveau document Opal Design » dans le menu du projet ou d’un dossier.

La bibliothèque à gauche recherche et filtre les outils. Le canevas conserve ses points de fond, ses notes libres, son zoom et son déplacement. Le bouton Dossiers ouvre l’explorateur habituel. L’inspecteur à droite contient les paramètres et l’historique du nœud sélectionné.

## Connecter les modèles

Ouvrir **Paramètres → Opal Design**. Les 39 entrées de fournisseurs proviennent du catalogue du projet connexion ide : huit fournisseurs intégrés et 31 connexions compatibles. Les modules de catalogue et d’authentification ont été repris dans `lib/design/accounts/` ; Opale fonctionne ensuite sans dépendre du dossier de l’IDE.

- ChatGPT : connexion dans le navigateur avec PKCE et retour local ; renouvellement du jeton.
- Grok et MiniMax par abonnement : connexion par code selon le mécanisme de l’IDE.
- OpenAI, Anthropic, Gemini et les fournisseurs compatibles : clé API personnelle.
- Ollama, serveur GGUF et fournisseur personnalisé : adresse du serveur et modèle à renseigner ou découvrir.

Les modèles disponibles dépendent du compte, du fournisseur et des droits accordés. Actualiser les modèles interroge le fournisseur ; il est également possible de saisir des identifiants supplémentaires. Les modèles image sont distingués des modèles texte. Les routes d’image sont adaptées aux API OpenAI compatibles et Gemini ; une compatibilité texte ne garantit pas une compatibilité image.

Un abonnement de conversation n’accorde pas automatiquement un accès aux API d’image. Les trois connexions par abonnement exposent ici les traitements texte autorisés par leur mécanisme ; utiliser une connexion API compatible pour les nœuds image. Les connexions Claude/Gemini par abonnement d’application ne sont pas ajoutées artificiellement.

Les clés et jetons sont stockés hors des coffres et chiffrés par AES-256-GCM avec une clé propre au profil Linux, enregistrée avec des permissions 0600. Ils ne sont pas synchronisés avec l’IDE ni partagés avec les collaborateurs. Chaque membre qui lance un modèle utilise sa propre connexion et son éventuelle facturation fournisseur. Opale n’ajoute pas de compteur de crédits.

## Créer et retoucher

Relier une sortie à une entrée de même type, soit en glissant le port, soit par deux clics. Les boucles et les types incompatibles sont refusés. Les outils comprennent :

- Consigne, image et note du coffre.
- Assistant texte, génération d’image et retouche ciblée.
- Sélection peinte au pinceau, gomme, rectangle ou ellipse ; dureté et taille réglables ; annulation des traits.
- Sélection assistée par une IA image à partir d’une description, puis correction manuelle du masque. La précision dépend du modèle : vérifier la sélection avant de retoucher.
- Inversion et agrandissement/réduction du masque.
- Recadrage, redimensionnement, rotation/miroir, couleurs, flou et composition de calques.
- Assemblage de texte, aperçu, comparaison avant/après et sortie.

Pour une retouche protégée, relier l’image source et un masque au nœud Retouche ciblée. Le blanc autorise les changements, le noir protège l’image. Après l’appel IA, Opale recompose le résultat localement : les pixels où le masque vaut zéro sont repris exactement de l’image source décodée. Les valeurs intermédiaires donnent une transition progressive. Cette protection concerne les pixels du résultat PNG, pas l’identité binaire du fichier original ni ses métadonnées.

Le bouton Exécuter traite les dépendances dans l’ordre. Les résultats amont inchangés sont réutilisés. Exécuter une branche relance son dernier nœud ; un changement de consigne, paramètre ou entrée invalide les résultats concernés. Les versions précédentes sont conservées, dans une limite de 20 par nœud. Si le nœud change pendant une requête, le résultat arrive dans l’historique sans écraser la nouvelle configuration.

Le mode Auto, désactivé au départ, attend une courte pause après les modifications locales. Les modifications reçues d’un autre membre ne déclenchent pas de requêtes payantes sur votre ordinateur. Arrêter interrompt les requêtes actives ; le temps de génération dépend du modèle et du réseau. Les transformations locales et aperçus ne nécessitent pas d’IA.

## Réutiliser, partager et exporter

Le menu Modèles de workflow propose une chaîne de retouche prête à relier. Enregistrer comme outil conserve les nœuds et leurs paramètres dans une bibliothèque locale, en retirant les fichiers, masques, résultats et historiques du document d’origine.

Dans un projet partagé, les nœuds, consignes, liaisons et images résultantes suivent le stockage partagé existant. Les lecteurs peuvent consulter ; ils ne peuvent pas lancer un traitement ni modifier le document. Les pièces jointes restent rattachées à leur projet. L’export d’une copie transporte également les résultats, masques et versions référencées.

Télécharger le résultat récupère l’image produite. La capture du tableau utilise l’export du moodboard : aperçu, zone personnalisée ou document entier, dimensions, 4K/8K, densité et formats PNG, JPEG, WebP, TIFF, BMP, SVG ou PDF. Le SVG contient une capture matricielle et ne transforme pas le document en dessin vectoriel éditable.

## Animations et limites

Les listes de choix utilisent une fenêtre arrondie animée ; les sections dépliantes et les arbres de projets animent l’ouverture et la fermeture. Les animations respectent la préférence système de réduction des mouvements.

Cette version est un atelier d’image et de texte. Elle ne comprend pas de génération vidéo, audio ou 3D, de retouche PSD complète, ni de connexion universelle aux abonnements de toutes les applications IA. La disponibilité de chaque modèle doit être vérifiée avec le compte réel. Le moteur d’image limite les transformations à 64 mégapixels et 16 384 pixels par côté.

Sous Linux, les mises à jour ciblent uniquement la branche Linux. Les boîtes de dialogue de fichiers et la fenêtre utilisent GTK/WebKit ; les fichiers .ppt/.pptx sont convertis par LibreOffice Impress. Les abonnements doivent être reconnectés sur Linux : les jetons Windows DPAPI ne sont pas importés.
