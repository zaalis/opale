# Publication Opale 0.2.0 - 16 novembre 2026

## Comportement final

Le bouton de mise à jour est masqué au démarrage, pendant la vérification silencieuse et lorsque l'application est à jour. Il ne provoque donc pas de bref affichage pendant une vérification sans nouveauté. Le téléchargement et le paquet prêt restent indiqués par la flèche et sa progression.

Version 0.2.0 cohérente dans package.json, le verrou de dépendances, les ressources de l'exécutable Windows, l'enregistrement du désinstalleur, l'API et le panneau Paramètres > À propos. Le manifeste de mise à jour est généré avec cette même version.

Cette publication regroupe le travail de la session : réactivité des projets partagés, corrections texte/TXT/focus, squelettes d'images, exports avec qualité et formats, import PDF/PowerPoint, Opal Design et ses corrections d'interactions, stabilité des arbres, connexions IA et mises à jour Windows. Les rapports détaillés sont conservés dans docs.

## Validation

- 140 tests automatisés réussis, aucun échec.
- Scénario Design sur le serveur Windows compilé : personnel/partagé, recherche, filtres, clics, outils actifs, Dossiers/Outils, fermeture des menus, masque, protection des pixels, historique, cache et export partagé.
- Panneau À propos vérifié dans le navigateur : Version 0.2.0.
- Contrôle du bouton de mise à jour avec API simulée : masqué à jour et pendant la recherche, visible au téléchargement, pourcentage réel affiché, action disponible quand le paquet est prêt.
- Suites navigateur moodboard et collaboration réussies sur le serveur compilé : outils, sauvegarde, conflits, MCP, WebRTC, image et texte sans Drive, lecture TXT, absence de cadre du canevas.
- Export/import vérifié : capture 8K réelle, sept formats, choix du fichier, rectangle personnalisé, 100 pages PDF sur une rangée, six slides PowerPoint, personnel et partagé, liens et favicon.
- Transaction d'installation native exécutée dans un dossier temporaire : refus d'un fichier verrouillé et restauration des anciens fichiers ; installation des quatre binaires identiques aux ressources embarquées ; progression 100 %.
- Application, serveur et installateur recompilés ; version et SHA-256 du manifeste comparés au paquet final ; `git diff --check` sans erreur.

Les comptes IA réels et les générations payantes n'ont pas été utilisés. Les essais de collaboration emploient des processus locaux et un Drive simulé. Le cycle complet d'installation et de redémarrage sur le profil de l'utilisateur n'a pas été exécuté : le test natif exerce le remplacement des binaires sans ouvrir l'application de l'utilisateur.

## Paquet publié

- `dist/Opale-Setup.exe` et `dist/update.json` doivent être publiés ensemble sur main.
- Taille : 66 503 680 octets.
- SHA-256 : `e9170ca56c6bc34996187bcc873129219283d5b31b990471fc96f139d52b1021`.
- Identité de compilation : `350fa3da2a72a8fb63d2c2c07c06148a2ed2713e135a5b7c9ee11b731edbc97d`.

Les anciennes versions d'Opale sans mécanisme de mise à jour demandent une installation manuelle de 0.2.0. Les versions Windows qui contiennent le mécanisme utiliseront les prochains paquets publiés sur main.
