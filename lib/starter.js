'use strict';

// Notes written into a brand-new vault: a short tour that doubles as a first
// graph to look at.
const NOTES = {
  'Bienvenue.md': `---
tags: [opale, guide]
---
# Bienvenue dans Opale

Opale est un carnet de notes en **Markdown**. Vos notes sont de simples fichiers \`.md\` rangés dans ce dossier : elles vous appartiennent, et n'importe quel éditeur peut les ouvrir.

## Pour commencer

- [ ] Créer une note avec \`Ctrl+N\`
- [ ] Lier deux notes avec \`[[\` — voir [[Liens et rétroliens]]
- [ ] Ouvrir le graphe avec \`Ctrl+G\`
- [ ] Retrouver une note avec \`Ctrl+O\`, une commande avec \`Ctrl+P\`

> [!tip] Astuce
> Cliquez sur n'importe quel paragraphe pour le modifier : le Markdown apparaît là où vous écrivez, le reste de la page reste mis en forme.

## Aller plus loin

- [[Mise en forme]] — tout ce que le Markdown d'Opale sait afficher
- [[Liens et rétroliens]] — relier les idées entre elles
- [[Connexion à zaalis IDE]] — laisser une IA travailler dans ce coffre

#opale
`,
  'Guide/Liens et rétroliens.md': `---
tags: [guide]
aliases: [Liens]
---
# Liens et rétroliens

Un lien s'écrit entre doubles crochets : \`[[Bienvenue]]\` donne [[Bienvenue]].

| Écriture | Résultat |
| --- | --- |
| \`[[Note]]\` | lien vers une note |
| \`[[Note\\|texte affiché]]\` | lien avec un autre texte |
| \`[[Note#Titre]]\` | lien vers une section |
| \`![[Note]]\` | contenu de la note intégré ici |
| \`![[image.png\\|300]]\` | image, largeur 300 px |

## Rétroliens

Le panneau de droite liste les notes qui pointent vers la note ouverte. C'est ce qui transforme un tas de fichiers en réseau : voir aussi [[Mise en forme]].

## Notes qui n'existent pas encore

Un lien vers [[Une idée à écrire plus tard]] apparaît atténué. Cliquez dessus : la note est créée.

## Renommer sans rien casser

Renommez ou déplacez une note : tous les liens qui y mènent sont réécrits automatiquement.
`,
  'Guide/Mise en forme.md': `---
tags: [guide]
---
# Mise en forme

Du texte en **gras**, en *italique*, ~~barré~~, ==surligné==, du \`code\`, une étiquette #exemple et une note de bas de page[^1].

## Listes et tâches

1. Premier point
2. Deuxième point
   - sous-point
   - autre sous-point

- [x] Tâche terminée
- [ ] Tâche à faire

## Citations et encadrés

> Une citation simple.

> [!note] Encadré
> Les encadrés existent en plusieurs couleurs : \`note\`, \`tip\`, \`info\`, \`warning\`, \`danger\`, \`success\`, \`question\`, \`quote\`…

> [!warning]- Encadré repliable
> Ajoutez \`-\` ou \`+\` après le type pour le rendre repliable.

## Code

\`\`\`js
function saluer(nom) {
  return \`Bonjour \${nom} !\`;
}
\`\`\`

## Tableaux

| Colonne | Centré | À droite |
| --- | :---: | ---: |
| a | b | 1 |
| c | d | 22 |

Retour à [[Bienvenue]].

[^1]: Les notes de bas de page sont regroupées en fin de page.
`,
  'Guide/Connexion à zaalis IDE.md': `---
tags: [guide, ia]
---
# Connexion à zaalis IDE

Opale peut être relié à **zaalis IDE** en un clic. L'assistant de l'IDE peut alors travailler dans ce coffre.

## Se connecter

1. Laissez Opale ouvert.
2. Dans zaalis IDE : **Paramètres → MCP → Opale → Connecter**.

## Ce que l'assistant sait faire

- lire et analyser vos notes, chercher dans le coffre
- créer, compléter et corriger des notes
- trier : déplacer et renommer notes et dossiers (les liens suivent)
- gérer étiquettes et propriétés
- ouvrir une note dans cette fenêtre pour vous la montrer

> [!info] Tout reste sur ce PC
> La connexion est locale (127.0.0.1) et protégée par un jeton. Ce que l'assistant supprime va dans la corbeille du coffre (\`.trash\`), sauf demande explicite.

Voir aussi [[Bienvenue]] et [[Liens et rétroliens]].
`,
};

module.exports = { NOTES };
