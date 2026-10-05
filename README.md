# Opale — macOS

Carnet de notes Markdown local, dans l'esprit d'Obsidian : un **coffre** est un simple
dossier de fichiers `.md`, reliés par des liens `[[…]]`. Code entièrement original,
sans dépendance applicative : un serveur Node, une interface web et une fenêtre native
macOS (AppKit + WKWebView).

Un coffre Obsidian existant s'ouvre tel quel (Opale range ses réglages dans `.opale/`
et ne touche pas à `.obsidian/`).

Cette branche est la cible macOS. Les sources communes suivent la branche
[main](https://github.com/zaalis/opale/tree/main) (Windows) ; seuls changent la fenêtre
native, les raccourcis (⌘), les noms propres au système (Finder, Corbeille) et les
polices.

## Lancer

```sh
npm start            # serveur + fenêtre (l'app compilée si elle existe, sinon le navigateur)
npm run serve        # serveur seul, puis http://127.0.0.1:27184
```

Opale est un projet autonome : il ne dépend d'aucun autre dossier et peut être placé
n'importe où.

## Construire l'application macOS

Prérequis, sur un Mac : les outils de développement Xcode (`xcode-select --install`)
et Node.js 18 ou plus récent.

```sh
npm install
npm run build             # dist/Opale.app pour l'architecture de ce Mac
npm run dmg               # idem + dist/Opale-Setup.dmg
npm run installer         # dist/Opale-Setup.dmg, Apple Silicon + Intel
npm run build:universal   # même installateur universel
bash native/build.sh --arch x86_64 --dmg  # dist/Opale-Setup-x64.dmg
```

`Opale.app` contient la fenêtre (Swift, macOS 12 minimum) et le serveur empaqueté
(`opale-server-arm64` / `opale-server-x64`). La fenêtre démarre le serveur et l'arrête
quand on quitte l'application ; une deuxième ouverture ramène la fenêtre existante.

L'application est signée ad hoc, pas notarisée. Pour une copie téléchargée ailleurs :
clic droit sur l'app > Ouvrir, ou `xattr -dr com.apple.quarantine /Applications/Opale.app`.

À la première suppression avec « Corbeille » choisie dans les réglages, macOS demande
l'autorisation de piloter le Finder (pour que « Remettre » fonctionne). Si elle est
refusée, le fichier va quand même à la Corbeille, sans « Remettre ».

## Ce qu'Opale fait

- Explorateur de fichiers (créer, renommer, déplacer par glisser-déposer, dupliquer, corbeille)
- Onglets façon navigateur, historique précédent/suivant, note ouverte restaurée au lancement
- Trois modes : aperçu en direct (le bloc cliqué redevient du Markdown), source, lecture
- Liens `[[Note]]`, `[[Note|texte]]`, `[[Note#Titre]]`, intégrations `![[…]]`, complétion en tapant `[[` ou `#`
- Renommer ou déplacer une note réécrit les liens qui y mènent ; les liens cassés se réparent depuis la note
- Rétroliens et mentions non liées, liens sortants, plan, étiquettes, signets
- Recherche : `"phrase"`, `-exclu`, `a OR b`, `/regex/`, `tag:`, `file:`, `path:`, `content:`
- Graphe global et graphe local, sélecteur rapide (`⌘O`), palette de commandes (`⌘P`)
- Propriétés (frontmatter), encadrés, tâches, tableaux, notes de bas de page, code coloré
- Notes quotidiennes, modèles, pièces jointes collées ou déposées, thèmes clair/sombre, extraits CSS
- Images mises en page comme dans un traitement de texte : déposées à l'endroit voulu avec une taille
  prédéfinie, sélection au clic, poignées de redimensionnement, déplacement par glisser, placement
  dans le texte, à gauche, centré ou à droite (texte autour). Tout est écrit dans le Markdown :
  `![[photo.png|left|320]]`
- Moodboards (fichiers `.canvas`, format JSON Canvas lu par Obsidian) : pense-bêtes, formes,
  flèches, dessins, images, notes, cadres, Kanban, cartes mentales, tableaux, imports Mermaid et
  draw.io, calques, export PDF (vectoriel) ou JPG. Pincement du trackpad et ⌘ + molette pour zoomer.

Non repris d'Obsidian : extensions communautaires, Sync/Publish, rendu LaTeX,
volets côte à côte.

## Raccourcis sur Mac

Les raccourcis suivent les usages du Mac : `⌘N` nouvelle note, `⌘T` / `⌘W` onglets,
`⌃Tab` / `⌃⇧Tab` onglet suivant/précédent, `⌥⌘←` / `⌥⌘→` précédent/suivant,
`⌘E` lecture/édition, `⌘G` graphe, `⇧⌘F` recherche, `⌘,` réglages, `⌘⌫` supprimer
dans l'explorateur, `⌘`-clic pour ouvrir dans un nouvel onglet. `⌃` reste au système
(`⌃A`, `⌃E`… dans le texte ; `⌃`-clic = clic droit). La liste complète est dans
**Réglages → Raccourcis**.

## Connexion à zaalis IDE

Tant qu'Opale tourne, il publie son adresse dans
`~/Library/Application Support/Opale/instance.json` (port, jeton, coffre ouvert).
zaalis IDE lit ce fichier.

Les deux projets sont séparés, et reliés par défaut : dès qu'Opale est présent sur le
Mac et lancé, l'assistant de l'IDE a accès au coffre ouvert, sans réglage. Dans l'IDE,
**Paramètres → MCP → Opale** montre l'état et permet de lancer Opale ou de couper le
lien. L'agent reçoit le serveur MCP `opale` et une Skill qui
décrit ses outils : `vault_info`, `list_files`, `read_note`, `write_note`,
`append_to_note`, `edit_note`, `set_properties`, `create_folder`, `move`, `move_many`,
`delete`, `search`, `get_backlinks`, `get_links`, `list_tags`, `find_by_tag`,
`daily_note`, `open_note`, `get_active_note`, ainsi que les outils des moodboards
(`board_catalog`, `read_board`, `add_to_board`, `edit_board`, `import_to_board`,
`write_board`).

Tout autre client MCP (Streamable HTTP) peut s'y relier : adresse et jeton dans
**Réglages → Connexion à zaalis IDE**.

## Sécurité

- Écoute sur `127.0.0.1` uniquement ; en-tête `Host` vérifié (pas de DNS rebinding).
- L'interface s'authentifie par un cookie `SameSite=Strict` + un en-tête dédié ; les
  programmes par un jeton Bearer, régénérable dans les paramètres.
- Tous les chemins sont relatifs au coffre : pas de `..`, pas de lien symbolique
  sortant, pas d'accès aux dossiers cachés (`.git`, `.opale`, `.trash`).
- Les noms de fichiers sont comparés sans tenir compte de la casse ni de la composition
  des accents (macOS les rend décomposés, le clavier les tape composés).
- Le HTML d'une note est échappé ; les fichiers du coffre ne sont jamais servis comme pages.
- La suppression va dans `.trash` par défaut, y compris pour l'assistant.
- La fenêtre n'ouvre que le serveur local : les liens web partent dans le navigateur par défaut.

## Organisation

```
server.js            serveur HTTP : interface, API du coffre, /mcp
lib/vault.js         lecture/écriture, index des liens, renommage, surveillance du dossier
lib/search.js        langage de recherche
lib/mcp.js           outils proposés à l'assistant
lib/platform.js      ce qui dépend du système : dossiers, sélecteur, Finder, Corbeille
shared/              métadonnées, rendu Markdown, modèle des moodboards (serveur + interface)
interface/           l'application (modules ES, sans bibliothèque)
interface/js/platform.js   raccourcis ⌘ et libellés propres au Mac
native/main.swift    fenêtre macOS : menus, serveur, téléchargements, export des moodboards
native/build.sh      construction de Opale.app et du .dmg
test/                node --test
```

```sh
npm test
```
