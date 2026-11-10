# Projets partagés : architecture

Des notes et des moodboards modifiés à plusieurs, en direct, sans serveur Opale.
Chaque membre a une copie complète ; Drive est la mémoire commune ; les ordinateurs
ouverts au même moment échangent directement.

```
   ordinateur A                         ordinateur B
 ┌──────────────────────┐   WebRTC   ┌──────────────────────┐
 │ interface            │◄──────────►│ interface            │  modifications, présence
 │  CRDT + session      │  (chiffré) │  CRDT + session      │
 ├──────────────────────┤            ├──────────────────────┤
 │ serveur local Opale  │            │ serveur local Opale  │  copie locale, clés, signatures
 └─────────┬────────────┘            └──────────┬───────────┘
           │   petits lots, points de sauvegarde, signalisation
           └──────────────► Google Drive ◄──────┘  (compte Google de chacun)
```

## Fichiers

| Où | Rôle |
| --- | --- |
| `shared/collab-crdt.js` | CRDT : texte (RGA, identifiants `lamport@appareil`, suppressions marquées par auteur), registres « dernier écrit gagne » avec détection des conflits, éléments de moodboard champ par champ, ordre d'empilement, arborescence des fichiers, annulation par personne. |
| `shared/collab-session.js` | Session d'un projet ouvert : livraison causale, relais vers ceux qui ne voient pas l'auteur, élection du coordinateur, présence, état. |
| `lib/collab/identity.js` | Clé Ed25519 par projet et par ordinateur, protégée par DPAPI (Windows). |
| `lib/collab/acl.js` | Journal signé des membres et des appareils ; règles des rôles. |
| `lib/collab/drive.js` | Accès Drive par identifiants persistants (`appProperties`), jamais par nom. |
| `lib/collab/store.js` | Copie locale : `%APPDATA%\Opale\projects\<id>\` (journal des modifications écrit et synchronisé sur disque avant tout envoi). |
| `lib/collab/service.js` | Création, invitation, adhésion, envoi vers Drive, relevés, points de sauvegarde, signatures, poignée de main. |
| `interface/js/collab/` | Connexions WebRTC (`mesh.js`), projet ouvert (`client.js`), éditeurs partagés (`views.js`), présence et suivi (`presence.js`), barre latérale et fenêtres (`ui.js`). |

## Dans Drive

`Mon Drive › Opale › Projets partagés › <nom>` (dossier du propriétaire, partagé avec
les membres selon leur rôle) contient :

- `projet.json` (description signée du projet ; l'identifiant du projet est l'empreinte
  de la clé du propriétaire), `acl-*.json` (décisions sur les membres, signées) ;
- `ops-<appareil>-<de>-<à>.json` : lots de modifications signées, envoyés 1,5 s après
  la dernière modification ; `rel-*.json` : modifications d'un ordinateur parti avant
  d'envoyer les siennes, sauvegardées par le coordinateur ;
- `snap-*.json` : points de sauvegarde complets (toutes les 400 modifications, ou par
  le coordinateur), qui permettent de repartir sans relire tout l'historique ;
- `appareils/` et `signalisation/` (accessibles en écriture à tous les membres, y
  compris les lecteurs) : fiches des appareils, messages de connexion éphémères.

Rien de la présence (curseurs, sélections, gestes) n'y est écrit.

## Connexion entre ordinateurs

1. **Découverte** : en ouvrant un projet, l'ordinateur dépose un petit fichier « je
   suis là » pour chaque autre appareil du projet dans `signalisation/`. Ceux qui ont
   le projet ouvert le voient au relevé suivant (toutes les 3 s) et répondent.
2. **Établissement** : l'offre et la réponse WebRTC (adresses réseau, empreinte DTLS)
   passent de la même façon, un fichier chacune. Le serveur ne lit que les fichiers
   écrits par des comptes membres, pour des appareils du projet.
3. **Authentification** : une fois le canal ouvert, chaque côté signe avec la clé de son
   appareil une phrase qui contient les deux empreintes DTLS et un nombre aléatoire de
   l'autre côté. L'autre vérifie la clé dans le journal des membres (rôle courant,
   appareil non révoqué). Rien d'autre ne passe avant.
4. **Réseaux bloqués** : les adresses sont trouvées par STUN (serveurs publics de Google
   par défaut, modifiables). Quand une connexion directe est impossible, un relais TURN
   peut être configuré (Réseau…). Sans lui, ces ordinateurs restent synchronisés par
   Drive (quelques secondes de délai) mais ne voient pas les curseurs.

Services extérieurs utilisés : Google Drive (stockage, signalisation) et, pour la
connexion directe, les serveurs STUN de Google, qui voient l'adresse IP de chaque
ordinateur. Les membres du projet voient aussi ces adresses dans la signalisation.

## Coordinateur

Parmi les ordinateurs connectés, celui qui a le plus petit identifiant et un rôle qui
permet d'écrire est coordinateur ; s'il part (fenêtre fermée : départ annoncé ; coupure
brutale : 9 s sans nouvelles), le suivant prend le relais. Il écrit les points de
sauvegarde et enregistre sur Drive les modifications d'un ordinateur parti avant de les
y avoir envoyées. Chaque ordinateur envoie aussi lui-même ses propres modifications :
le coordinateur n'est qu'un filet de sécurité. Quand tout le monde est parti, la
session s'arrête ; le prochain repart de Drive.

## Fusion

- Texte : chaque caractère a un identifiant ; deux personnes qui écrivent au même
  endroit gardent toutes deux leur texte. Pas de remplacement de fichier entier.
- Moodboards : chaque champ de chaque élément (position, taille, couleur, texte…) est
  fusionné séparément ; le texte des cartes est fusionné caractère par caractère. Deux
  changements du même champ au même moment : le dernier gagne et l'autre personne est
  prévenue (« Remettre la mienne »).
- Supprimer un élément pendant qu'un autre l'édite : l'autre est prévenu, avec
  « Restaurer » (son texte en cours est gardé).
- Annuler (Ctrl+Z) ne reprend que ses propres modifications.

## Droits

Propriétaire, Administrateur, Éditeur, Lecteur. Chaque décision est signée et vérifiée
par tous ; un appareil n'est reconnu que si sa fiche a été déposée dans Drive par le
compte Google qu'elle annonce. Retirer un membre : Opale refuse ses connexions et ses
nouvelles modifications, et Drive retire le partage du dossier. Ce qu'il a déjà copié
sur ses ordinateurs ne peut pas être effacé à distance.

## Limites connues

- Les images et pièces jointes d'un coffre personnel ne sont pas partagées (une
  image posée sur un moodboard partagé reste un cadre vide chez les autres).
- L'assistant (MCP) ne voit que le coffre personnel, pas les projets partagés.
- La découverte passe par Drive : il faut quelques secondes pour voir arriver un
  participant, et un réseau qui bloque WebRTC sans relais TURN reste en mode Drive.
- Le même projet ouvert dans deux fenêtres d'Opale sur le même ordinateur n'est pas
  pris en charge (la seconde demande de recharger).

## Vérifications

- `test/collab-crdt.test.js`, `test/collab-session.test.js`,
  `test/collab-service.test.js` (Drive simulé, plusieurs « ordinateurs » dans un même
  processus).
- Essai de bout en bout : trois serveurs Opale indépendants (données séparées, comptes
  différents) sur un Drive simulé (`OPALE_FAKE_DRIVE=<dossier>`,
  `OPALE_FAKE_EMAIL=<adresse>`), pilotés dans Chrome. Panne Drive simulée par un fichier
  `offline-<adresse>` dans ce dossier, connexion Google expirée par `auth-<adresse>`.
