# Opale

Carnet de notes Markdown local, dans l'esprit d'Obsidian : un **coffre** est un simple
dossier de fichiers `.md`, reliés par des liens `[[…]]`. Code entièrement original,
sans dépendance : un serveur Node, une interface web, une fenêtre native GTK 3 / WebKitGTK.

Un coffre Obsidian existant s'ouvre tel quel (Opale range ses réglages dans `.opale/`
et ne touche pas à `.obsidian/`).

## Lancer

```bash
npm start            # fenêtre de l'application
npm run serve        # serveur seul, puis http://127.0.0.1:27184
```

Opale est un projet autonome : il ne dépend d'aucun autre dossier et peut être placé
n'importe où.

## Construire et installer sous Linux

Prérequis : Node.js 22+, GCC, pkg-config, GTK 3 et WebKitGTK 4.1.

```bash
sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev
npm ci
npm test
npm run package
sudo apt install ./dist/Opale_0.1.0_amd64.deb
```

Le paquet embarque le serveur Node et installe la fenêtre dans `/usr/lib/opale/Opale`, avec la commande `opale` et un lanceur de bureau. Node n'est pas requis sur la machine destinataire. `npm run install-local` installe pour l'utilisateur.

Les réglages et jetons sont conservés dans `$XDG_CONFIG_HOME/Opale` (par défaut `~/.config/Opale`). `OPALE_HOME` permet un dossier indépendant. Les coffres restent à leur emplacement et sont préservés lors de la désinstallation.

Le client OAuth de bureau `lib/google-client.json` est copié depuis l'édition classique et embarqué dans le serveur. Ce fichier local est exclu de Git : un build de publication exige qu'il soit présent et valide. Les utilisateurs se connectent dans leur navigateur système avec PKCE et retour sur 127.0.0.1. Aucun jeton de compte utilisateur n'est distribué.

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
  dans `$XDG_CONFIG_HOME/Opale/google.json (par défaut ~/.config/Opale/google.json)`.

## Connexion à zaalis IDE

Tant qu'Opale tourne, il publie son adresse dans `$XDG_CONFIG_HOME/Opale/instance.json (par défaut ~/.config/Opale/instance.json)`
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
shared/              métadonnées et rendu Markdown (serveur + interface)
interface/           l'application (modules ES, sans bibliothèque)
native/              fenêtre WebView2, icône, scripts de construction
test/                node --test
```

```powershell
npm test
```
