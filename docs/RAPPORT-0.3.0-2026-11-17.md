# Opale 0.3.0 — mini rapport du 17 novembre 2026

## Texte et polices

- Mode **Édition enrichie**, accessible par le bouton **Aa** et dans le menu de la note. Il est proposé par défaut aux nouveaux coffres ; les préférences existantes restent utilisables.
- 64 familles Google Fonts, 209 variantes locales avec leurs licences : sans sérif, sérif, manuscrites, titres et monospace. Fichiers WOFF2 dans `interface/assets/fonts`, TTF originaux dans `artifacts/google-fonts-ttf`. Aucune requête Google pendant l’utilisation ; chemins relatifs portables.
- Police, taille de 8 à 144 px, graisse, gras, italique, souligné, barré, couleurs du texte et du surlignage, alignement, interligne, espacement des lettres, titres et listes. Retrait de la mise en forme, raccourcis clavier et menu contextuel.
- Sélection entre paragraphes, Ctrl+A, copie/coupe, remplacement, suppression globale et annulation. Le mode enrichi utilise une zone de saisie continue. Le mode aperçu par blocs conserve aussi le correctif Ctrl+A vers la source.
- Styles enregistrés dans le Markdown au moyen de marqueurs `data-opale` contrôlés. La mise en forme est synchronisée dans les projets partagés ; pointeur de souris, sélection et curseur de saisie sont affichés. Le rôle Lecteur reste en lecture seule.
- Les blocs techniques (code, tableaux, propriétés, mathématiques, callouts…) sont conservés et restent modifiables en mode source. Les images collées sont enregistrées comme pièces jointes locales ou partagées.
- Les textes, formes, pense-bêtes et cartes Markdown des moodboards bénéficient également du catalogue de polices et des réglages de graisse/décoration.

## PDF

- Bouton **Importer PDF** dans la barre de la note, et **Créer une note modifiable** depuis un PDF ouvert, y compris une pièce jointe d’un projet partagé.
- Extraction testée sur `B1 Enviro..pdf`, première partie « Nostalgie ». Majuscules et minuscules conservées, taille et graisse extraites ; les polices absentes du catalogue sont remplacées par une famille locale adaptée.
- Export **PDF ↓** : pages A4 avec mise en forme et polices rendues localement, découpage évitant les lignes coupées. Rendu haute résolution contrôlé sous Chromium et WebKitGTK.
- L’import produit une copie du texte modifiable, avec une reconstruction des paragraphes ; il ne reproduit pas nécessairement la composition exacte du document original. Les PDF scannés ne sont pas reconnus par OCR. L’export actuel est un PDF visuel rasterisé : son texte n’est pas une couche vectorielle sélectionnable.

## Validation

- Windows : **142 tests Node réussis**.
- Linux : **148 tests réussis**, **2 tests propres à Windows ignorés**.
- Navigateurs sur les serveurs source et compilés : police/taille/graisse après réouverture, activation et retrait des décorations, couleurs/surlignage, alignement/interligne, suppression globale et annulation, collage multiligne et HTML contrôlé, image collée, extraction PDF, 64 polices avec réseau extérieur bloqué, véritable fichier PDF, deux profils reliés par WebRTC, pointeur, synchronisation des styles, suppression partagée et copie modifiable d’un PDF partagé.
- Collaboration : transport WebRTC réel entre deux processus ; Drive simulé pour l’inscription et les permissions de test.
- Linux : fenêtre GTK/WebKit réellement exécutée sous affichage virtuel dans WSL Ubuntu x86-64 ; texte enrichi, enregistrement/réouverture, polices locales, véritable export PDF, version 0.3.0 et thème vérifiés. Captures et PDF inspectés visuellement.
- Windows : application C++ compilée et ressources de version vérifiées ; contrôles d’interface effectués dans Chromium avec le serveur Windows embarqué.

Les installateurs ne sont pas exécutés sur l’installation personnelle. Les modifications et paquets restent locaux ; aucune publication GitHub n’a été effectuée. Le paquet Linux cible AMD64 ; aucun build ARM64 n’est annoncé.

Sources des polices : [dépôt officiel Google Fonts](https://github.com/google/fonts). Détail des familles et licences : `interface/assets/fonts/catalog.json` et chaque sous-dossier.

## Paquets finaux

| Fichier | Taille | SHA-256 |
|---|---:|---|
| Opale-Setup-0.3.0.exe | 93,189,120 octets | `86183a0e6df80d812d4a5892381bab2a442236d4ebe4fbbbe4a29b056297c840` |
| Opale_0.3.0_amd64.deb | 56,374,228 octets | `858c0ac0fe9e7f1dacb45f4e2a7b1a5a924bb70dfe64aa1b85093260234ee31f` |
| Opale_0.3.0_linux-amd64.tar.gz | 56,397,009 octets | `85e0bc5dc0607ddbbb7daafca815b64dfac4b7350e893b54538ae57b61b6e889` |

Windows : `dist/Opale-Setup-0.3.0.exe` (copie identique dans `dist/Opale-Setup.exe`). Linux : `dist/Opale_0.3.0_amd64.deb` et `dist/Opale_0.3.0_linux-amd64.tar.gz`. Les manifestes de mise à jour sont cohérents avec les tailles et SHA-256 des fichiers.

Les 209 polices WOFF2 occupent 25 652 904 octets ; les TTF originaux conservés représentent 68 856 212 octets.
