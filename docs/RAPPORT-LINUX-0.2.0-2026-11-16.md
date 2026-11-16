# Opale Linux 0.2.0 - rapport du 16 novembre 2026

## Portage

Les changements Windows de `main` au commit `c30716d6eb8727b163ff77f5f1c55733b1af6afc` sont repris dans la branche `Linux` du dossier Opale-Linux. Le dossier Windows et la branche main restent inchangés.

Fonctions communes : Opal Design et ses nœuds IA/transformations, sélections protégées, historique, workflows, recherche et filtres, panneaux animés, outils actifs, menus refermables, statut de connexion vert, tableaux et notes personnels/partagés, synchronisation directe des modifications et des images, fichiers TXT, chargement squelette, exports avec aperçu/région/4K/8K/densité/sept formats, import horizontal des PDF et présentations, liens et icônes de sites. La version 0.2.0 figure dans À propos.

## Adaptations Linux

- Fenêtre GTK 3 / WebKitGTK, boîtes de dialogue natives de fichiers et de sauvegarde, thème natif suivant le thème de l'interface.
- Chemins XDG, permissions des fichiers privés et conservation de la sensibilité à la casse ; protection du coffre contre les symlinks sortants. Ouverture dans le gestionnaire de fichiers et corbeille Linux.
- Connexions IA propres au profil Linux. Les identifiants Design/Miro et les nouvelles clés des projets partagés sont chiffrés par AES-256-GCM avec une clé de profil en fichier 0600, hors des coffres. Cette protection repose sur les permissions du compte Linux ; elle ne remplace pas le chiffrement du disque. Aucun jeton de compte Windows n'est importé. Le client OAuth public de l'application est embarqué pour permettre la connexion Google.
- Conversion PPT/PPTX par LibreOffice Impress dans un profil temporaire isolé, sans modifier les documents déjà ouverts.
- Navigateur système Linux et repli vers le navigateur Windows pour les liens lorsque WSL ne dispose pas d'un navigateur configuré.
- Mises à jour exclusivement depuis `Linux`, avec manifeste distinct par architecture. Vérification silencieuse, icône masquée à jour, progression en octets et SHA-256. Une installation dans le compte utilise l'archive ; une installation système utilise le .deb avec autorisation Polkit et apt. L'utilitaire GTK attend la fermeture, installe puis relance l'application.

## Environnement et vérifications

Tests effectués dans Ubuntu 22.04.5 x86-64 via la distribution WSL2 NVIDIA-Workbench. L'entrée WSL Ubuntu habituelle ne démarrait pas, son disque virtuel étant introuvable ; elle n'a pas été modifiée. Node 22 de validation est installé séparément ; le paquet embarque son serveur et ne demande pas Node sur le PC destinataire.

- **146 tests Node réussis**, aucun échec, sur 148 scénarios ; deux scénarios propres à Windows sont ignorés. Tests Linux de casse, symlinks, lancement du navigateur, gestion des erreurs OAuth et chiffrement des identifiants inclus.
- Navigateur Chromium Linux, serveur source puis serveur Linux compilé : Design personnel/partagé, vrais clics, recherche, filtres, ports, masque, protection des pixels, historique, cache, outils actifs, Dossiers/Outils, menus, badge vert, arbre stable, enregistrement/réouverture et version 0.2.0.
- Export/import sous Linux : vraie capture 7 680 x 4 970 ; PNG/JPEG/WebP/TIFF/BMP/SVG/PDF ; choix du fichier ; capture d'un rectangle ; 100 pages PDF et six diapositives PowerPoint ; personnel et partagé ; favicon et ouverture du lien.
- Collaboration entre deux processus et navigateurs isolés : WebRTC authentifié, texte et transfert d'image sans Drive, mouvements en direct, TXT et squelette. Le Drive est simulé pour ces essais.
- Fenêtre native GTK/WebKit réellement exécutée sous affichage virtuel : interface, coffre, sauvegarde, Mermaid, décompression draw.io, pixels d'export et JPEG, recherche et création de nœuds Design, chargement/transformation d'image, À propos 0.2.0 et suivi du thème.
- .deb réellement installé dans WSL : lancement par /usr/bin/opale, instance unique, fermeture Ctrl+Q, arrêt du serveur, restauration de l'état de fenêtre, arrêt du serveur après crash de la fenêtre et sélecteur GTK annulable. Le dernier contrôle est exécuté avec l'utilisateur normal `workbench` et un répertoire runtime isolé. Un essai root parallèle avait rencontré un délai de portail GNOME ; le contrôle isolé est réussi.
- Mise à jour par la vraie archive : échec de remplacement provoqué et fichiers précédents restaurés ; installation des six fichiers identiques octet par octet ; progression 100 %. La vraie fenêtre GTK de mise à jour est lancée, termine l'installation et exécute une commande de redémarrage témoin dans le dossier temporaire.

Capture native : `artifacts/linux-native.png`. Journaux locaux : `linux-tests.log`, `linux-design-packaged.log`, `linux-exports-packaged.log`, `linux-native.log`, `linux-installed-user.log`, `linux-update.log` et `linux-build.log`.

## Paquets

- Debian/Ubuntu AMD64 : `dist/Opale_0.2.0_amd64.deb`, 30375882 octets. SHA-256 : `480134c4bf719a51fa206dbc409a74546955b82db5b1cd303c8fd50a11e6b9ba`.
- Archive AMD64 : `dist/Opale_0.2.0_linux-amd64.tar.gz`, 30397725 octets. SHA-256 : `3ff2650ca012975950edac07f9587a2323d6795ab63700a02482086ea828da78`.
- Manifeste : `dist/update-linux-amd64.json`.

Installation :

```bash
sudo apt install ./Opale_0.2.0_amd64.deb
# Pour convertir des présentations PowerPoint :
sudo apt install libreoffice-impress
```

L'archive permet aussi de lancer `./Opale` dans son dossier extrait ; GTK 3 et WebKitGTK 4.1 sont requis sur l'hôte.

## Limites du contrôle

Les essais portent sur Ubuntu x86-64 dans WSL et sur un affichage virtuel, pas sur toutes les distributions ou tous les pilotes graphiques Linux. Aucun paquet ARM64 n'a été construit pendant cette intervention. Les comptes IA réels et les appels payants n'ont pas été sollicités. Le chemin de mise à jour système par demande de mot de passe Polkit n'a pas été piloté graphiquement ; le .deb est installé réellement et le chemin archive est vérifié de bout en bout avec redémarrage témoin.
