# Rapport : images façon Word

## Ce qui a été ajouté

- **Insertion à l'endroit voulu** : une image déposée depuis l'Explorateur Windows se place exactement là où on la lâche : au milieu d'une phrase, entre deux paragraphes, avant ou après un bloc de code. Un trait indique le point d'arrivée pendant le survol.
- **Taille prédéfinie** : 400 px par défaut, réglable dans *Paramètres → Fichiers et liens → Taille des images insérées* (240 / 400 / 640 / taille d'origine). Une image plus petite que ce réglage garde sa taille.
- **Sélection au clic** : cadre, 4 poignées et barre d'outils.
- **Redimensionnement** en tirant une poignée (les proportions sont gardées).
- **Déplacement** en faisant glisser l'image dans le texte. Elle ne coupe jamais un mot, et Échap annule pendant le glisser.
- **Position** : dans le texte, à gauche ou à droite (le texte l'entoure, comme dans Word), ou centrée.
- **Tailles rapides** : S (¼), M (½), L (toute la largeur), 1:1 (taille d'origine).
- **Clavier** : Suppr retire l'image (le fichier reste dans le coffre), Entrée ou double-clic montre le Markdown, Échap désélectionne, Ctrl+Z / Ctrl+Y.
- **Clic droit** sur une image : mêmes réglages. Clic droit dans le texte : *Insérer une image ici…*. Dans la palette (Ctrl+P) : *Insérer une image…*.
- **Coller** (Ctrl+V) une image : à l'endroit du curseur, ou juste après l'image sélectionnée.

Tout est écrit dans le Markdown, par exemple `![[photo.png|left|320]]`. La note reste un simple fichier texte, et Obsidian l'affiche toujours à 320 px.

## Tests effectués

| Test | Résultat |
| --- | --- |
| Tests automatiques (`npm test`), dont 2 nouveaux sur les images | 28 / 28 OK |
| Sélection, poignées, redimensionnement 320 → 401 px | OK |
| Boutons gauche / droite / centre, tailles S / M / L / 1:1 | OK |
| Glisser dans une phrase, en début de paragraphe, avant / après un bloc de code | OK |
| Dépôt d'un fichier au milieu d'une phrase, sous le dernier paragraphe | OK |
| Taille prédéfinie (900 px → 400 px ; 200 px gardé ; réglage 240 appliqué) | OK |
| Images dans une liste, un encadré, un tableau (`\|` gardé), format `![…](…)` | OK |
| Code et `code en ligne` jamais modifiés | OK |
| Suppr, Ctrl+Z, double-clic, menu clic droit, collage | OK |
| Mode lecture : le texte entoure bien les images | OK |
| Recompilation (`npm run installer`) et vérification de l'exe | OK |

## Défauts trouvés en testant, puis corrigés

1. Une image lâchée au milieu d'un mot le coupait (« vign|es »). Elle se cale maintenant sur la limite de mot la plus proche.
2. Une image flottante qui débordait sur le paragraphe suivant ne recevait plus les clics. Corrigé.
3. Un paragraphe en cours d'édition à côté d'une image flottante sautait sous l'image. Il reste maintenant à côté.
4. Deux images flottantes du même côté s'empilaient côte à côte et écrasaient le texte. Elles se placent maintenant l'une sous l'autre.
5. Ctrl+Z après une action sur une image ouvrait le Markdown. La page est maintenant simplement réaffichée.
6. Coller une image dans une ligne ajoutait un retour à la ligne qui coupait les listes. Elle est maintenant insérée dans la ligne, avec des espaces autour.

## Limites connues

- Dans le mode **Source**, on garde le texte brut : la mise en page à la souris se fait dans l'*Aperçu en direct*.
- Les images des notes intégrées (`![[Autre note]]`) ne se modifient que dans leur propre note.
