# Vérification de l’édition Linux — 12 octobre 2026

Les sources communes du dossier `opale` ont été récupérées dans `Opale-Linux` : notes et images, moodboards, bibliothèques de modules, outils MCP, imports Mermaid/Draw.io, exports PDF/JPG, synchronisation Google Drive, fusion et gestion des conflits. Les sources natives Windows et les coffres d’essai personnels ne constituent pas le paquet Linux ; la fenêtre GTK/WebKitGTK et les installateurs Linux sont conservés.

Le client `lib/google-client.json` est identique au fichier du dossier classique (comparaison SHA-256), embarqué dans le serveur du paquet et exclu du dépôt source. Les jetons utilisateur ne sont pas copiés. Le build échoue explicitement si le client intégré est absent ou invalide. Le fichier local doit être remis en place pour reconstruire depuis un clone Git.

Adaptations : chemins XDG et `OPALE_HOME`, droits privés des données de compte, noms Linux du serveur et de la fenêtre, gestionnaire de fichiers, corbeille du système, sélecteur GTK, textes et chemins d’exemple, prise en compte de la casse pour les coffres et Drive, priorité des liens de nom exact, arrêt du serveur avec la fenêtre ou après un crash. OAuth ouvre le navigateur système et possède un repli vers l’hôte Windows dans WSL. Les scripts Unix sont enregistrés avec des fins de ligne LF.

## Validation

Environnement : Ubuntu 24.04 sous WSL2, x86_64, GTK 3.24.41, WebKitGTK 2.52.6, Node Linux 22.23.3 pour les tests et le build. Le serveur distribué embarque son propre Node 22.

- `node --test test/*.test.js` : 99 tests, 99 réussis, aucun échec ni test ignoré. Inclut OAuth/PKCE/Drive simulés, conflits et suppressions, casse des fichiers Linux, échappement par lien symbolique et ouverture du navigateur.
- Serveur embarqué + Chromium Linux : les 12 groupes de vérification des scripts `verify-board-browser.cjs` et `verify-board-export.cjs` réussissent, sans erreur JavaScript ; outils, création/édition/enregistrement, déplacement, annulation, imports, conflits, panne d’enregistrement et récupération, fichiers endommagés, MCP, images, onglets et exports PDF/JPG.
- Harnais compilé depuis la fenêtre native de production + serveur embarqué + WebKitGTK : affichage du moodboard, 11 outils, modification et lecture du fichier enregistré, import Mermaid, décompression Draw.io, vrais pixels de l’export et JPEG, client Google intégré et thème GTK synchronisé.
- Paquet `.deb` installé avec `dpkg -i` dans Ubuntu : lancement de la fenêtre et du serveur, métadonnées de lancement Linux, instance unique, fermeture Ctrl+Q et arrêt du serveur, mémorisation de la fenêtre, arrêt après destruction de la fenêtre, sélecteur GTK et annulation.
- Les dépendances Debian sont calculées à partir de la fenêtre, du sélecteur et du serveur effectivement compilés ; propriétaire `root:root` dans le paquet.

## Limites précises

Aucune connexion à un vrai compte Google et aucun transfert réel Drive n’ont été effectués. Les tests Drive utilisent un service simulé ; la configuration intégrée et sa disponibilité dans l’exécutable sont vérifiées. Le repli WSL du navigateur est testé avec un exécutable de substitution.

Le paquet a été compilé et installé sur Ubuntu 24.04 amd64. Il exige notamment glibc >= 2.38 et les paquets GTK de cette génération ; il ne constitue pas une preuve de compatibilité avec toutes les distributions Linux, architectures ou versions plus anciennes. Les tests graphiques sont effectués dans Xvfb avec rendu logiciel, pas une validation matérielle GPU ni une session Wayland complète.

Des avertissements non bloquants restent dans `dpkg-shlibdeps` (diversions usrmerge et bibliothèques sans symboles utilisés par le serveur empaqueté) et dans les portails du bureau WSL/Xvfb (PipeWire/RealtimeKit absents). L’installation du paquet et les contrôles ci-dessus réussissent malgré ces avertissements.

## Reproduire

```bash
npm ci
npm test
npm run package
# Playwright et Chromium doivent être installés pour les contrôles navigateur.
OPALE_TEST_SERVER=dist/opale-server node scripts/verify-board-browser.cjs
OPALE_TEST_SERVER=dist/opale-server node scripts/verify-board-export.cjs
# Après installation du .deb, avec Python, xdotool et Xvfb :
dbus-run-session -- xvfb-run -a python3 scripts/verify-installed.py
```

## Empreintes des artefacts validés

- Debian : e4ed231d54de4ea7ee93ad29d25e39a5f1d9884802b06d7e126644a9ad56e307
- Archive : b5def5762ea9d3494bd0cf2fe4712fb9494b9de78df32f3557f212c9cc1ceca3
