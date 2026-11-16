# Opale

Carnet de notes Markdown local, dans l'esprit d'Obsidian : un **coffre** est un simple
dossier de fichiers `.md`, reliés par des liens `[[…]]`. Code entièrement original,
sans dépendance : un serveur Node, une interface web, une fenêtre native WebView2.

Un coffre Obsidian existant s'ouvre tel quel (Opale range ses réglages dans `.opale/`
et ne touche pas à `.obsidian/`).

## Lancer

Le plugin **Miro** est accessible dans **Paramètres → Plugins** pour importer
des moodboards dans le coffre, avec images locales et rapport de conversion.
Voir le [guide de connexion Miro](docs/MIRO.md).

```powershell
npm start            # fenêtre de l'application
npm run serve        # serveur seul, puis http://127.0.0.1:27184
```

Opale est un projet autonome : il ne dépend d'aucun autre dossier et peut être placé
n'importe où.

## Construire l'application Windows

Prérequis : Node.js et Visual Studio avec « Développement Desktop en C++ ». Les
fichiers du SDK WebView2 nécessaires sont fournis dans `native/webview2`.

```powershell
npm run build        # dist\Opale.exe + opale-server.exe + pickfolder.exe
npm run installer    # dist\Opale-Setup.exe, installateur Windows autonome
npm run shortcut     # raccourcis Bureau et menu Démarrer, et enregistrement pour zaalis IDE
```

`Opale.exe` démarre `opale-server.exe` placé à côté de lui ; sans lui, il lance
`..\server.js` avec Node. Le serveur s'arrête quand la fenêtre se ferme.

Pour distribuer l'application, utilisez `Opale-Setup.exe`. Il installe Opale dans
le profil Windows de l'utilisateur, crée le raccourci du menu Démarrer (et, au
choix, celui du Bureau), l'enregistre dans la liste des applications installées et
ajoute **Opale — Désinstallation**. Les coffres de notes et les réglages sont
préservés lors de la désinstallation.

## Ce qu'Opale fait

- Explorateur de fichiers (créer, renommer, déplacer par glisser-déposer, dupliquer, corbeille)
- Onglets, historique précédent/suivant, note ouverte restaurée au lancement
- Trois modes : aperçu en direct (le bloc cliqué redevient du Markdown), source, lecture
- Liens `[[Note]]`, `[[Note|texte]]`, `[[Note#Titre]]`, intégrations `![[…]]`, complétion en tapant `[[` ou `#`
- Renommer ou déplacer une note réécrit les liens qui y mènent
- Rétroliens et mentions non liées, liens sortants, plan, étiquettes, signets
- Recherche : `"phrase"`, `-exclu`, `a OR b`, `/regex/`, `tag:`, `file:`, `path:`, `content:`
- Graphe global et graphe local, sélecteur rapide (`Ctrl+O`), palette de commandes (`Ctrl+P`)
- Propriétés (frontmatter), encadrés, tâches, tableaux, notes de bas de page, code coloré
- Notes quotidiennes, modèles, pièces jointes collées ou déposées, thèmes clair/sombre, extraits CSS
- Images mises en page comme dans un traitement de texte : déposées à l'endroit voulu avec une taille
  prédéfinie, sélection au clic, poignées de redimensionnement, déplacement par glisser, placement
  dans le texte, à gauche, centré ou à droite (texte autour). Tout est écrit dans le Markdown :
  `![[photo.png|left|320]]`

Non repris d'Obsidian : extensions communautaires, Publish, rendu LaTeX, volets côte à côte.

## Synchronisation Google Drive

**Paramètres → Intégrations → Google Drive** garde un coffre identique sur plusieurs
ordinateurs. Le coffre est rangé dans `Mon Drive › Opale › <nom du coffre>` et reste
lisible depuis drive.google.com.

Mise en place, une seule fois, dans [console.cloud.google.com](https://console.cloud.google.com) :

1. Créer un projet et activer **Google Drive API**.
2. **Écran de consentement OAuth** : « Externe », s'ajouter comme utilisateur test, puis
   **Publier l'application** (en mode « Test », Google coupe l'accès au bout de 7 jours).
   La portée `drive.file` n'exige pas de validation par Google.
3. **Identifiants → ID client OAuth → Application de bureau**, télécharger le JSON et
   l'importer dans Opale. Le même fichier sert sur tous les ordinateurs.

Sur un autre ordinateur, l'écran des coffres propose **Récupérer un coffre depuis Drive**.

Fonctionnement :

- Une synchronisation part quelques secondes après chaque modification, et toutes les
  30 secondes pour les changements des autres ordinateurs. La barre d'état montre un
  cercle et un pourcentage pendant les gros transferts, une icône discrète sinon.
- Chaque fichier est comparé à la dernière version commune (`.opale/sync.json`). Une
  note modifiée sur deux ordinateurs à des endroits différents est fusionnée ; modifiée
  aux mêmes lignes, la version locale reste en place et l'autre est enregistrée à côté
  (`Note (conflit PC-PORTABLE 2026-10-11 14h32).md`), à régler dans la fenêtre des conflits.
- Supprimer d'un côté envoie à la corbeille de l'autre (`.trash` ou corbeille de Drive),
  sauf si le fichier y a été modifié entre-temps. Une suppression massive, ou un dossier
  Drive disparu, suspend la synchronisation jusqu'à confirmation.
- Un renommage est un déplacement dans Drive (l'historique des versions de Drive suit).
- `.opale` et `.trash` ne quittent jamais l'ordinateur. Le compte Google est enregistré
  dans `%APPDATA%\Opale\google.json`.

## Projets partagés

La section **Projets partagés** (barre de gauche, sous les notes) réunit des notes et
des moodboards modifiables à plusieurs, en direct. Chaque membre garde une copie
complète sur son ordinateur ; le dossier du projet dans Drive sert de mémoire commune.
Il n'y a pas de serveur Opale : les ordinateurs se trouvent grâce à Drive puis se
parlent directement. Détails : [docs/PROJETS-PARTAGES.md](docs/PROJETS-PARTAGES.md).

- **Créer** (bouton +) : crée `Mon Drive › Opale › Projets partagés › <nom>` et une
  première note. **Inviter** (Membres et permissions) : adresse du compte Google et rôle
  (Administrateur, Éditeur, Lecteur) ; Drive partage le dossier, Opale donne un code.
  **Rejoindre** : le projet apparaît dans la liste des projets partagés avec vous, ou
  avec le code.
- Point de couleur à côté du projet : vert = tout est sur Drive, orange clignotant =
  envoi en cours, jaune = modifications seulement sur cet ordinateur, rouge = erreur.
  **État de la synchronisation** détaille les quatre états (cet ordinateur, participants
  connectés, Drive, en attente).
- Curseurs, sélections, déplacements en cours et « Suivre cette personne » (clic sur
  un visage, Échap pour arrêter) ne passent qu'entre ordinateurs, jamais par Drive.

**Mise en place Google** : en plus de `drive.file`, l'écran de consentement OAuth doit
déclarer la portée `https://www.googleapis.com/auth/drive`, seule à permettre d'ouvrir
un dossier partagé par quelqu'un d'autre. Elle est demandée à part, au premier usage
des projets partagés. Google la classe « restreinte » : tant que l'application n'est
pas vérifiée, l'écran de connexion affiche un avertissement et les comptes doivent être
ajoutés comme utilisateurs test (100 au plus).

## Connexion à zaalis IDE

Tant qu'Opale tourne, il publie son adresse dans `%APPDATA%\Opale\instance.json`
(port, jeton, coffre ouvert). zaalis IDE lit ce fichier :

Les deux projets sont séparés, et reliés par défaut : dès qu'Opale est présent sur le
PC et lancé, l'assistant de l'IDE a accès au coffre ouvert, sans réglage. Dans l'IDE,
**Paramètres → MCP → Opale** montre l'état et permet de lancer Opale ou de couper le
lien. L'agent reçoit le serveur MCP `opale` et une Skill qui
décrit ses outils : `vault_info`, `list_files`, `read_note`, `write_note`,
`append_to_note`, `edit_note`, `set_properties`, `create_folder`, `move`, `move_many`,
`delete`, `search`, `get_backlinks`, `get_links`, `list_tags`, `find_by_tag`,
`daily_note`, `open_note`, `get_active_note`.

Tout autre client MCP (Streamable HTTP) peut s'y relier : adresse et jeton dans
**Paramètres → Connexion à zaalis IDE**.

## Sécurité

- Écoute sur `127.0.0.1` uniquement ; en-tête `Host` vérifié (pas de DNS rebinding).
- L'interface s'authentifie par un cookie `SameSite=Strict` + un en-tête dédié ; les
  programmes par un jeton Bearer, régénérable dans les paramètres.
- Tous les chemins sont relatifs au coffre : pas de `..`, pas de lien symbolique
  sortant, pas d'accès aux dossiers cachés (`.git`, `.opale`, `.trash`).
- Le HTML d'une note est échappé ; les fichiers du coffre ne sont jamais servis comme pages.
- La suppression va dans `.trash` par défaut, y compris pour l'assistant.

## Organisation

```
server.js            serveur HTTP : interface, API du coffre, /mcp
lib/vault.js         lecture/écriture, index des liens, renommage, surveillance du dossier
lib/search.js        langage de recherche
lib/mcp.js           outils proposés à l'assistant
lib/google.js        compte Google (OAuth bureau + PKCE) et appels à l'API Drive
lib/sync.js          synchronisation à trois états, conflits, planification
lib/merge.js         fusion à trois voies des notes
lib/collab/          projets partagés : identité, membres, Drive, copie locale, service
shared/              métadonnées, rendu Markdown, CRDT et session des projets partagés
interface/js/collab/ projets partagés dans l'interface (WebRTC, présence, éditeurs, fenêtres)
interface/           l'application (modules ES, sans bibliothèque)
native/              fenêtre WebView2, icône, scripts de construction
test/                node --test
```

```powershell
npm test
```

### Client Google Drive intégré à la compilation

Pour construire l'application Windows avec Drive, placer dans `lib/google-client.json` un objet contenant `clientId` et `clientSecret` du client OAuth Google pour application de bureau. Ce fichier local est ignoré par Git. `npm run build` et `npm run installer` vérifient sa présence avant d'intégrer ces valeurs au serveur compilé. Ne jamais y placer de jeton de connexion ou de données de compte. Un client OAuth intégré à une application distribuée est accessible aux destinataires de l'exécutable ; son secret ne doit pas être considéré comme confidentiel. La disponibilité pour d'autres comptes dépend également de la configuration et, si nécessaire, de la validation de l'application côté Google.
