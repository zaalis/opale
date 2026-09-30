# Opale

Carnet de notes Markdown local, dans l'esprit d'Obsidian : un **coffre** est un simple
dossier de fichiers `.md`, reliés par des liens `[[…]]`. Code entièrement original,
sans dépendance applicative : un serveur Node, une interface web et une fenêtre native sur chaque système.

Un coffre Obsidian existant s'ouvre tel quel (Opale range ses réglages dans `.opale/`
et ne touche pas à `.obsidian/`).

## Lancer

```powershell
npm start            # fenêtre de l'application
npm run serve        # serveur seul, puis http://127.0.0.1:27184
```

Opale est un projet autonome : il ne dépend d'aucun autre dossier et peut être placé
n'importe où.

## Construire l’application

Cette branche est la cible Windows. Les sources communes restent identiques aux branches [Linux](https://github.com/zaalis/opale/tree/Linux) et [macOS](https://github.com/zaalis/opale/tree/macOS), qui portent chacune leur fenêtre native et leurs livrables propres.

### Windows

Prérequis : Node.js et Visual Studio avec « Développement Desktop en C++ ». Les
fichiers du SDK WebView2 nécessaires sont fournis dans `native/webview2`.

```powershell
npm run build        # dist\Opale.exe + opale-server.exe + pickfolder.exe
npm run installer    # produit aussi dist\Opale-Setup.exe et Uninstall Opale.exe
npm run shortcut     # raccourcis Bureau et menu Démarrer, et enregistrement pour zaalis IDE
```

`Opale.exe` démarre `opale-server.exe` placé à côté de lui ; sans lui, il lance
`..\server.js` avec Node. Le serveur s'arrête quand la fenêtre se ferme.

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

Non repris d'Obsidian : extensions communautaires, Sync/Publish, Canvas, rendu LaTeX,
volets côte à côte.

## Connexion à zaalis IDE

Tant qu’Opale tourne, il publie son adresse dans `%APPDATA%\Opale\instance.json` sous Windows, `~/Library/Application Support/Opale/instance.json` sous macOS, ou `~/.config/Opale/instance.json` sous Linux (port, jeton, coffre ouvert). zaalis IDE lit ce fichier :

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
shared/              métadonnées et rendu Markdown (serveur + interface)
interface/           l'application (modules ES, sans bibliothèque)
native/              fenêtre WebView2, icône, scripts de construction
test/                node --test
```

```powershell
npm test
```
