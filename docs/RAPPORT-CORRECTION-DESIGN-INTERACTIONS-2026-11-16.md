# Correction des interactions Opal Design - 16 novembre 2026

## Cause

La bibliothèque et l'inspecteur sont placés dans le conteneur du canevas. Les gestionnaires du moodboard ne les reconnaissaient pas comme des panneaux d'interface : un clic remontait jusqu'au canevas, qui récupérait le focus et démarrait son interaction de sélection. La molette était aussi interceptée pour zoomer ou déplacer le fond.

Le défaut a été reproduit avant correction avec un vrai clic sur la recherche suivi d'une saisie clavier : le champ restait vide. Les précédents tests créaient surtout les nœuds via le contrôleur, ce qui ne couvrait pas ce problème de souris et de focus.

## Correction

Les panneaux de la bibliothèque et de l'inspecteur possèdent maintenant leurs interactions : clic, molette, double-clic, menu contextuel et clavier. Les raccourcis du canevas ne prennent plus la main lorsqu'un contrôle de panneau a le focus. Les zones de défilement empêchent la propagation vers le canevas, y compris pour le défilement tactile. Les dépôts de fichiers sur ces panneaux ne sont plus traités comme un dépôt sur le fond.

Fichiers : `interface/js/board/input.js`, `interface/css/design.css` et scénario `scripts/verify-design-browser.cjs`.

## Validation

- Reproduction du champ vide avant correction, puis réussite du même scénario après correction.
- Recherche par vrai clic et frappe clavier ; filtrage des outils affichés.
- Clic sur Tous, IA, Images, Sélection, Texte et Sorties ; catégorie active et outils vérifiés.
- Ajout par vrais clics de Consigne, Image source et Note ; nombre d'éléments vérifié.
- Défilement réel de la bibliothèque avec la molette ; caméra du canevas inchangée.
- Ouverture et fermeture des paramètres Opal Design depuis Connexions IA.
- Mêmes contrôles en document personnel et en projet partagé.
- Scénario complet réussi avec le serveur source, puis le serveur Windows compilé : ports, masque, retouche protégée, historique, cache, sauvegarde et réouverture.
- 135 tests Node réussis, aucun échec ; suite navigateur moodboard réussie ; `git diff --check` sans erreur.

## Compilation

Application Windows, serveur autonome et installateur recompilés avec succès. Installateur final : `dist/Opale-Setup.exe`.

SHA-256 : `2B6E9461C3F351EA7A32734150ED8C306CD312AA113FC552FD5AADF293E4483C`.

Journaux : `artifacts/design-interactions-tests.log`, `artifacts/build-design-interactions.log`, `artifacts/unit-tests.log`.

L'installateur n'a pas été exécuté. Il faut installer cette version puis relancer Opale pour remplacer l'application actuellement ouverte. Les tests collaboratifs utilisent un Drive simulé ; aucune génération payante n'a été lancée.
