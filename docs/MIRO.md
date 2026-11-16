# Importer un moodboard Miro dans Opale

Ouvrez un coffre, puis **Paramètres → Plugins → Miro**. Le rectangle Miro ouvre
la configuration, la connexion et l’import. Aucun abonnement supplémentaire ni
serveur public Opale n’est nécessaire pour ce fonctionnement local. L’accès reste
soumis aux permissions de votre compte et de votre organisation Miro.

## Configuration, une seule fois sur cet ordinateur

1. Connectez-vous au compte Miro voulu et ouvrez
   [Your apps](https://miro.com/app/settings/user-profile/apps).
2. Créez une **Developer team** si Miro vous le demande, puis créez une application,
   par exemple « Opale — import de moodboards ». La Developer team sert à créer
   l’application ; lors de l’autorisation, choisissez l’équipe qui contient vos tableaux.
3. Dans les paramètres de l’application, activez la permission **`boards:read`**.
   Opale utilise exclusivement la lecture : aucune permission d’écriture n’est nécessaire.
4. Dans **Redirect URI**, recopiez exactement l’**Adresse de redirection** affichée
   dans le plugin Opale. Habituellement : `http://127.0.0.1:27184/oauth/miro`.
   Le port affiché fait foi ; il peut changer si le port habituel est déjà occupé.
   `localhost` et `127.0.0.1` ne sont pas interchangeables dans cette configuration.
5. Copiez le **Client ID** et le **Client secret** depuis Miro dans les deux champs
   du plugin. Cliquez sur **Enregistrer la configuration**. Ces valeurs restent
   sur cet ordinateur, hors du coffre ; sous Windows elles sont chiffrées par DPAPI
   pour le compte Windows actuel. Elles ne sont pas copiées vers Google Drive avec le coffre.
6. Cliquez sur **Connecter mon compte Miro**. Le navigateur s’ouvre sur Miro.
   Vérifiez le compte, choisissez l’équipe qui contient les moodboards et autorisez
   la lecture. Si votre organisation demande l’approbation d’un administrateur,
   faites approuver l’application.
7. Le navigateur confirme la connexion. Revenez dans Opale ; le statut et la liste
   des tableaux se mettent à jour automatiquement. Si votre application utilise
   des jetons avec expiration, Opale renouvelle le jeton lorsque Miro fournit un
   refresh token. Un accès révoqué ou non renouvelable nécessite une reconnexion.

Ne partagez pas le Client secret, les jetons ou le fichier local `miro.json`.
Une déconnexion efface les jetons locaux et demande leur révocation à Miro ;
si Miro est injoignable, le plugin indique comment retirer l’accès depuis Miro.

## Import

Choisissez un tableau dans la liste, ou collez son adresse Miro, puis cliquez sur
**Importer dans ce coffre**. **Voir plus de tableaux** charge la page suivante.
Laissez le tableau stable pendant sa lecture ; Opale interrompt l’import si Miro
signale une modification au cours de la pagination.

Un nouveau dossier `Imports Miro/<nom du tableau>/` contient :

- `<nom du tableau>.canvas` : JSON Canvas avec les extensions Opale pour les formes,
  post-it, cadres, styles et autres éléments avancés ; il s’ouvre dans l’éditeur de moodboards.
- `Images/` : images téléchargées localement. Les liens temporaires de Miro ne sont
  pas utilisés comme dépendances du moodboard.
- `source-miro.json` : les données reçues de l’API pour cet import.
- `Rapport d’import.md` : résultat, remplacements et limites de conversion.

L’interface propose **Ouvrir le moodboard** et **Lire le rapport** après l’import.
Les imports suivants créent un autre dossier ; aucun moodboard existant n’est écrasé.
Le dossier complet est publié après validation du fichier Canvas et des références
aux images. Un échec avant cette publication laisse les notes existantes intactes.

## Fidélité et limites

Les textes, post-it, formes courantes, cadres, images et connecteurs entre éléments
sont convertis. Les positions des éléments dans les cadres sont ramenées aux coordonnées
du tableau. Les identifiants Miro restent traités comme des chaînes pour éviter les
pertes de précision. Les couleurs, dimensions et rotations disponibles sont reprises.

La copie n’est pas une synchronisation et ne modifie jamais le tableau Miro. L’API
ne restitue pas toutes les fonctions de Miro : superposition exacte, polices propres
à Miro, dessins libres, commentaires et certains widgets peuvent être absents ou
simplifiés. Les contenus externes deviennent des liens. Les éléments reçus mais
non convertibles deviennent des cartes de remplacement avec lien Miro et une
observation. `source-miro.json` n’est donc pas une sauvegarde intégrale de Miro.

Si une image originale est indisponible ou dans un format non pris en charge,
Opale essaie la prévisualisation et le signale. Si celle-ci échoue aussi, une carte
remplace l’image. PNG, JPEG, GIF et WebP sont reconnus par leur signature ; les
réponses HTML ne sont jamais enregistrées comme images. Limites : 10 000 éléments,
20 Mo par image, 200 Mo d’images par import. Les erreurs réseau, permissions,
pagination incohérente, connexion expirée ou enregistrement apparaissent dans une
petite fenêtre avec explication et référence.

## Dépannage

- **Connexion refusée** : contrôlez Client ID, secret, `boards:read` et URI exacte,
  puis reconnectez-vous. Après modification des permissions, autorisez de nouveau l’application.
- **Tableau absent ou HTTP 403/404** : vérifiez le compte et l’équipe autorisés, ainsi
  que l’accès réel au tableau. Reconnectez-vous pour choisir une autre équipe.
- **Port différent** : recopiez la nouvelle adresse de redirection dans Miro et
  relancez la connexion. Gardez Opale ouvert pendant l’autorisation.
- **HTTP 429** : Opale fait des tentatives espacées ; si la limite persiste, attendez
  avant de recommencer.
- **Coffre changé pendant l’import** : ouvrez le coffre voulu et relancez l’import.
- **Identifiants illisibles sur un autre compte Windows** : reconfigurez l’application
  sur ce compte ; ne transférez pas le fichier chiffré.

Documentation officielle : [OAuth Miro](https://developers.miro.com/docs/getting-started-with-oauth),
[exemple OAuth local](https://developers.miro.com/docs/miro-nodejs-quickstart-with-oauth-and-express),
[REST API](https://developers.miro.com/reference/get-items-1).
