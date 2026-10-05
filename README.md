# Opale Android

Application Android native, écrite en Kotlin avec Jetpack Compose. Cette branche remplace le lanceur Windows, le serveur Node et le rendu HTML par des écrans et un stockage Android.

## Utilisation

- Notes Markdown : écrire par blocs, lire, modifier la source, cocher les tâches, suivre les liens `[[Note]]`.
- Images : sélection Android, copie dans le coffre, tailles et alignements, déplacement entre les emplacements du document avec le doigt ou les boutons.
- Moodboards : glisser avec un doigt pour déplacer la vue ; toucher une fois pour sélectionner ; utiliser **Modifier** pour éditer et **Déplacer** pour déplacer l’objet. Pincer pour zoomer.
- Coffre : stockage privé prêt au démarrage, ou dossier choisi avec le sélecteur Android. Les autorisations de dossier sont conservées.
- Recherche, étiquettes, rétroliens, graphe, signets, note du jour, dossiers, renommage, export et partage natifs.
- Sauvegarde automatique, brouillons persistants et détection des fichiers modifiés depuis leur ouverture. La corbeille conserve les fichiers dans `.trash`.

Les fichiers sont des `.md`, `.canvas` et pièces jointes ordinaires. L’application fonctionne hors connexion. Elle ne fournit pas son propre service de synchronisation ; un dossier synchronisé dépend de son fournisseur Android.

## Ouvrir le projet

Ouvrir ce dossier dans Android Studio et laisser Gradle synchroniser. Le projet initial créé dans `AndroidStudioProjects/opale` a servi de base. Identifiant Android : `fr.zaalis.opale`, minimum Android 7.0 / API 24.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
.\gradlew.bat :app:assembleDebug
```

Pour une compilation release, définir `OPALE_SIGNING_PROPERTIES` vers un fichier privé contenant `storeFile`, `storePassword`, `keyAlias` et `keyPassword`. Aucune clé privée ni mot de passe n’est publié.

## Architecture

| Dossier | Rôle |
| --- | --- |
| `app/.../AppModel.kt` | Navigation des documents, sauvegarde, brouillons, recherche, préférences |
| `app/.../MainActivity.kt` | Écrans Compose et sélecteurs/partage Android |
| `app/.../data` | Coffre local et Storage Access Framework, révisions, liens, corbeille |
| `app/.../notes` | Markdown et interactions tactiles d’images |
| `app/.../board` | Modèle Canvas conservant les extensions, rendu natif et gestes |
| `docs/CARTOGRAPHIE_ANDROID.md` | Étude préalable de la version Windows |
| `docs/VALIDATION_ANDROID.md` | État de l’implémentation et preuves de compilation/exécution |
| `artifacts` | APK release installable et somme SHA-256 |

La copie Windows déplacée dans `.legacy-windows` reste disponible localement et est ignorée par Git. La branche `main` du dépôt conserve la version Windows.

## Compatibilité et limites

Les extensions JSON Canvas inconnues sont conservées. Les widgets complexes ne doivent pas être confondus avec leurs équivalents Windows : le document de validation décrit leur niveau de prise en charge. Les blocs Markdown non reconnus restent éditables en source. Les intégrations de bureau Node/MCP, les exports spécifiques Windows et les moteurs web Mermaid/draw.io ne sont pas transportés dans l’APK.

Le coffre privé est supprimé par Android lors d’une désinstallation : exporter ses fichiers ou choisir un dossier externe pour les conserver indépendamment de l’application. Les dossiers externes cloud peuvent avoir des garanties d’écriture plus faibles que les fichiers locaux ; le fournisseur Android ne donne pas d’opération portable de comparaison et remplacement atomique.
