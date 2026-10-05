# Validation du portage Android

Date : 5 octobre 2026. Version : 0.1.0-android.

## Résultat livré

Application Kotlin/Jetpack Compose native, issue du projet Android Studio `C:/Users/boque/AndroidStudioProjects/opale`. Les sources actives et le dépôt de publication se trouvent dans `opale android`, branche `Android`, dépôt `https://github.com/zaalis/opale.git`. Les sources `app/src` et la configuration Gradle sont également synchronisées dans le projet Android Studio initial.

L’application utilise ses vues Android, le stockage privé ou Storage Access Framework, le sélecteur Photos et le partage Android. L’APK ne contient pas le serveur Node, le shell C++ Windows ni de WebView d’interface.

## Fonctions et correspondances

| Fonction | État Android |
| --- | --- |
| Notes Markdown | Édition native par blocs, lecture et source ; titres, listes, tâches, code, métadonnées et liens |
| Images | Import Photos, copie dans le coffre, tailles S/M/L/origine et alignements ; appui prolongé puis glisser vers un emplacement ; commandes alternatives |
| Coffre | Dossier privé ou autorisation persistante SAF ; dossiers, import/export, renommage avec réécriture des références, corbeille conservant le fichier |
| Sauvegarde | Automatique et manuelle ; brouillons locaux persistants, contrôle de révision, choix explicite en cas de conflit |
| Navigation | Explorer, notes récentes, signets, note du jour |
| Recherche | Expressions textuelles, phrases, tags, chemins, expressions régulières, OR et exclusions |
| Liens | Navigation wiki, rétroliens et graphe natif |
| Moodboard | Pan à un doigt, sélection par tap, bouton Modifier, mode Déplacer explicite, zoom à deux doigts, recentrage, dessin, annuler/rétablir |
| Objets du moodboard | Texte, pense-bêtes, formes, images, références de notes, cadres/grilles, tableaux, Kanban et connecteurs ; formulaire natif courant |
| Calques | Visibilité et verrouillage, gardes de mutation sur les objets/calques verrouillés |
| Données Canvas | Conservation des propriétés inconnues et extensions Opale ; données avancées accessibles |
| Apparence | Clair/sombre/système, taille du texte, insets système et clavier ; interface d’édition compacte en paysage |

## Compilation et contrôles

Chaîne exécutée dans le dossier Git :

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:OPALE_SIGNING_PROPERTIES = 'C:\Users\boque\.android\opale\signing.properties'
.\gradlew.bat :app:assembleRelease :app:testDebugUnitTest :app:connectedDebugAndroidTest :app:lintDebug --console=plain
```

- Compilation release signée : réussie.
- Tests unitaires : **13**, aucun échec. Parsing Markdown, positions/images/tâches, chemins et recherche.
- Tests Android : **14**, aucun échec, sur `Medium_Phone_API_36.1`, Android 16. Création/édition/source/recréation d’activité/recherche, pan et sélection explicite, JSON Canvas, calques, verrouillage et connecteurs ; coffre local/révisions/renommages/corbeille/import.
- Lint : **0 erreur**, **34 avertissements**. Suggestions de versions plus récentes, ressources de couleur du template inutilisées et suggestions de style KTX/catalogue. Aucun avertissement de permission large de stockage ni de WebView.
- Signature : vérifiée par `apksigner`, schéma APK v2, RSA 3072. Clé privée et fichier de signature conservés hors Git dans `C:/Users/boque/.android/opale`.
- Installation de l’APK release sur l’émulateur : réussie ; lancement de `MainActivity` réussi, sans erreur `AndroidRuntime` dans le contrôle effectué.
- APK : `artifacts/Opale-Android.apk`. Identifiant `fr.zaalis.opale`, versionCode 1, minimum API 24, cible/compilation API 37.

Les avertissements JDK `Unsafe`/accès natif proviennent des outils de test et de signature exécutés sur l’ordinateur, et n’empêchent pas les contrôles.

## Parcours exécutés dans l’émulateur

1. Ouvrir un vrai dossier `Documents/OpaleValidation` avec Files, accorder l’accès, lire une note externe.
2. Cocher une tâche : le fichier `.md` externe contient bien `[x]`.
3. Arrêter puis relancer l’application : coffre autorisé et note retrouvés.
4. Sélectionner une image dans Photos : fichier copié dans `Pièces jointes`, embed Markdown créé.
5. Injecter les événements tactiles Android d’appui prolongé, mouvement et relâchement : l’image passe du bas de la note à son premier emplacement ; le Markdown est réécrit en conséquence.
6. Choisir la taille S : la largeur `96` est conservée dans le Markdown.
7. Ouvrir le moodboard externe, recentrer, parcourir avec un doigt : la somme SHA-256 du fichier Canvas reste identique après le pan.
8. Toucher un pense-bête puis Modifier : formulaire Android visible ; la sélection seule ne lance pas l’édition.
9. Vérifier visuellement le rendu clair et sombre, le format 375 dp et une taille système de texte à 130 % ; ouvrir le clavier et faire une rotation.

Les captures dans `screenshots` montrent les parcours exécutés. Ce sont des contrôles d’émulateur et d’événements Android injectés, pas un essai humain sur tablette physique.

## Limites à connaître

- Il ne s’agit pas d’une preuve de parité intégrale avec chaque widget Windows. Les cartes mentales, frises complexes, sondages/activité et widgets de code/Mermaid/draw.io ont un rendu résumé ; leurs données sont conservées et restent éditables dans les données avancées. Les exports spécifiques Windows PDF/JPG, les moteurs web et les intégrations Node/MCP ne sont pas implémentés dans cette version.
- Aucun essai sur téléphone/tablette physique, stylet, appareil Android 7 ou fournisseur cloud de documents n’a été effectué. Le minimum API 24 est une contrainte de compilation ; l’exécution vérifiée est Android 16.
- SAF n’offre pas de comparaison et remplacement atomique portable entre applications. Vérification de révision avant écriture et relecture ensuite réduisent les erreurs, sans garantir l’absence de toute course avec un fournisseur externe.
- La corbeille existe dans `.trash` ; son fichier peut être récupéré depuis le dossier externe, mais aucun écran natif de restauration n’est fourni.
- Aucun compte/synchronisation propre à Opale ni service réseau n’est inclus. Le stockage privé disparaît lors de la désinstallation ; un coffre externe reste indépendant de l’app.
- Les formats d’images décodés nativement par Android sont affichés ; les SVG et autres pièces jointes restent conservés/partageables.

## Conservation de l’existant

La copie Windows initiale est conservée localement dans `.legacy-windows`, ignorée par Git. Le template Android Studio a été sauvegardé dans `.legacy-windows/android-studio-template` avant synchronisation. Le checkout Windows `opale-github-audit` n’a pas été modifié. La publication est limitée à la branche `Android`.

## Empreinte de l’APK livré

SHA-256 : `8c75364279798a6b10f44a57869cc946f0a40bb133b9c22e2cd3697cbb486fd9`.
Taille : 8134064 octets.
Certificat SHA-256 : `ece34ad9e08ae7e768520b3322d71d9bb9ea793f026e3c48e14cb26991cbcfc4`.
