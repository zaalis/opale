// Opale — moodboard decorations: an emoji catalogue, original die-cut
// stickers and a set of simple line icons, each with an accent-insensitive
// search. Pure data and string builders: nothing here touches the DOM, so the
// module can be imported from Node as well as from the browser.

// ------------------------------------------------------------------ search
// Lower-case, strip accents and expand ligatures so "coeur" finds "cœur".
export function foldText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe').replace(/Œ/g, 'oe')
    .replace(/æ/g, 'ae').replace(/Æ/g, 'ae')
    .replace(/[’`]/g, '\'')
    .toLowerCase()
    .trim();
}

function splitWords(value) {
  return foldText(value).split(/[\s,;:/'’\-_.()!?]+/).filter(Boolean);
}

// Ranks `items` against `query`: every query word must appear somewhere in
// the item's text; exact names/keywords come first, then prefixes, then the
// rest (the sort is stable so catalogue order is kept within a rank).
function rankedSearch(items, query, describe, limit) {
  const q = foldText(query);
  if (!q) return items.slice(0, limit);
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const item of items) {
    const { name, keywords, extra = '' } = describe(item);
    const fname = foldText(name);
    const fkeys = keywords.map(foldText);
    const haystack = [fname, ...fkeys, foldText(extra)].join(' | ');
    if (!tokens.every((token) => haystack.includes(token))) continue;
    let score = 3;
    if (fname === q || fkeys.includes(q)) score = 0;
    else if (fname.startsWith(q) || fkeys.some((key) => key.startsWith(q))) score = 1;
    else if (splitWords(haystack).some((word) => word.startsWith(tokens[0]))) score = 2;
    scored.push({ item, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((entry) => entry.item);
}

function keywordList(value) {
  return String(value || '').split(',').map((word) => word.trim()).filter(Boolean);
}

// ------------------------------------------------------------------- emoji
// Text-default code points (Emoji_Presentation=No) need U+FE0F to render as
// emoji; this re-qualifies every sequence regardless of how it was typed.
const NEEDS_VS16 = /^(?=\p{Emoji})(?!\p{Emoji_Presentation})/u;
function qualify(sequence) {
  let out = '';
  for (const ch of sequence.replace(/️/g, '')) {
    out += ch;
    if (NEEDS_VS16.test(ch)) out += '️';
  }
  return out;
}

function flag(code) {
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// One emoji per line: "char|name|keyword, keyword…".
const EMOJI_SOURCE = {
  smileys: ['Smileys & émotions', `
😀|visage rieur|sourire, content, joie, smile, happy
😃|visage souriant aux grands yeux|sourire, joie, content
😄|visage aux yeux rieurs|rire, joie, heureux
😁|visage rayonnant|sourire, dents, ravi
😆|visage plissé de rire|rire, mdr, lol
😅|sourire avec goutte de sueur|ouf, soulagé, gêné
🤣|mort de rire|rire, mdr, lol
😂|larmes de joie|rire, mdr, lol, joy
🙂|visage légèrement souriant|sourire, ok
🙃|visage à l'envers|ironie, blague
😉|clin d'œil|complice, wink
😊|visage aux joues roses|timide, content, merci
😇|visage angélique|ange, innocent
🥰|visage souriant avec cœurs|amour, adorable, love
😍|yeux en cœur|amour, adore, love, coup de cœur
🤩|visage avec étoiles|waouh, star, impressionné, génial
😘|bisou envoyé|bisou, amour, kiss
😋|miam|délicieux, gourmand
😛|langue tirée|blague, taquin
😜|clin d'œil langue tirée|fou, blague
🤪|visage loufoque|fou, délire
🤑|visage argent|argent, riche, money
🤗|câlin|merci, accueil, hug
🤭|main sur la bouche|oups, gloussement
🤫|chut|silence, secret
🤔|visage pensif|réfléchir, hmm, question, think
🤐|bouche cousue|secret, silence
🤨|sourcil levé|doute, sceptique
😐|visage neutre|neutre, bof
😑|visage sans expression|blasé, bof
😶|visage sans bouche|muet, sans voix
😏|sourire narquois|malin, ironie
😒|visage blasé|ennui, agacé
🙄|yeux au ciel|agacé, soupir
😬|grimace|gêne, oups, malaise
😌|visage soulagé|soulagé, calme, zen
😔|visage abattu|déçu, triste
😪|visage endormi|sommeil, fatigue
🤤|bave|envie, miam
😴|dodo|sommeil, dormir, zzz
😷|visage avec masque|malade, masque
🤒|visage avec thermomètre|malade, fièvre
🤯|tête qui explose|choc, époustouflant, mind blown
🥳|visage festif|fête, anniversaire, bravo, party
😎|lunettes de soleil|cool, classe
🤓|visage d'intello|geek, nerd, lunettes
🧐|visage avec monocle|inspecter, analyser
😕|visage confus|confus, perplexe
😟|visage inquiet|inquiet, souci
🙁|visage légèrement triste|triste, déçu
😮|bouche ouverte|surprise, wow, oh
😯|visage ébahi|surprise, étonné
😲|visage stupéfait|choc, surprise
😳|visage gêné|rougir, gêne
🥺|visage implorant|s'il te plaît, mignon, pitié
😨|visage effrayé|peur
😰|visage anxieux|stress, anxiété, sueur
😢|visage qui pleure|larme, triste
😭|visage en pleurs|triste, sanglots
😱|cri de peur|horreur, choc
😖|visage contrarié|frustré
😩|visage épuisé|fatigué, las
😫|visage fatigué|épuisé
🥱|bâillement|ennui, fatigue
😤|visage déterminé|frustré, triomphe
😡|visage en colère|colère, rage, fâché
🤬|visage qui jure|colère, insulte
😈|diablotin|malin, diable
💀|crâne|mort, mdr
💩|tas de caca|caca, nul
🤡|clown|blague
👻|fantôme|halloween
👽|extraterrestre|alien, ovni
🤖|robot|ia, bot, automatisation
😺|chat souriant|chat, sourire
❤|cœur rouge|amour, love, j'aime, heart
🧡|cœur orange|amour, orange
💛|cœur jaune|amitié, jaune
💚|cœur vert|vert, écologie
💙|cœur bleu|bleu, confiance
💜|cœur violet|violet
🖤|cœur noir|noir
🤍|cœur blanc|blanc
🤎|cœur marron|marron
💔|cœur brisé|chagrin, rupture
💕|deux cœurs|amour
💖|cœur étincelant|amour, brillant
💯|cent points|100, parfait, top, score
💢|symbole de colère|colère
💥|collision|boum, explosion, impact
💫|étourdi|étoile, vertige
💦|gouttes de sueur|eau, sueur
💨|bouffée d'air|vite, rapide, fuite
💬|bulle de dialogue|discussion, message, commentaire, chat
💭|bulle de pensée|pensée, idée, rêve
🗯|bulle de colère|colère, cri
💤|zzz|sommeil, dodo, pause
`],
  people: ['Gestes & personnes', `
👋|main qui salue|salut, bonjour, au revoir, hello
🤚|dos de la main levée|stop, main
✋|main levée|stop, question, parole
🖐|main aux doigts écartés|cinq, main
🖖|salut vulcain|spock
👌|ok de la main|ok, parfait, d'accord
🤏|petite quantité|un peu, petit
✌|victoire|paix, deux
🤞|doigts croisés|chance, espoir
🤟|signe je t'aime|amour, rock
🤘|cornes|rock, metal
🤙|appelle-moi|téléphone, cool
👈|index vers la gauche|gauche, là
👉|index vers la droite|droite, là
👆|index vers le haut|haut, au-dessus
👇|index vers le bas|bas, en dessous
☝|index levé|attention, un, idée
👍|pouce levé|ok, oui, bien, validé, like, j'aime
👎|pouce baissé|non, mauvais, dislike
✊|poing levé|force, solidarité
👊|coup de poing|poing, check
👏|applaudissements|bravo, félicitations, clap
🙌|mains levées|hourra, bravo, victoire
👐|mains ouvertes|ouverture, accueil
🤲|paumes vers le haut|offrir, prière
🤝|poignée de main|accord, deal, partenariat, marché conclu
🙏|mains jointes|merci, s'il vous plaît, prière
✍|main qui écrit|écrire, noter, rédiger
💪|biceps|force, courage, motivation
🧠|cerveau|réflexion, intelligence, idée, brainstorming
👀|yeux|regarder, voir, attention, à suivre
👁|œil|voir, vision
👂|oreille|écouter
👃|nez|odeur, sentir
👄|bouche|parler
🗣|tête qui parle|parler, annonce, oral
👤|silhouette|personne, profil, utilisateur
👥|silhouettes|groupe, équipe, utilisateurs
👶|bébé|enfant, naissance
🧒|enfant|enfant
👩|femme|femme
👨|homme|homme
🧑|personne|adulte
👵|grand-mère|âgée
👴|grand-père|âgé
🙋|personne qui lève la main|question, volontaire, moi
🙅|personne faisant non|non, interdit
🙆|personne faisant ok|ok, d'accord
💁|personne au guichet|info, renseignement
🤷|haussement d'épaules|je ne sais pas, bof, peu importe
🤦|main sur le visage|facepalm, consternation
🙇|personne qui s'incline|excuse, respect
👩‍💻|développeuse|code, informatique, ordinateur, dev
👨‍💻|développeur|code, informatique, ordinateur, dev
👩‍🏫|enseignante|prof, cours, formation
👨‍🏫|enseignant|prof, cours, formation
👩‍🎨|artiste|peinture, design, créatif
👨‍🍳|cuisinier|chef, cuisine
👩‍🔬|scientifique|science, laboratoire, recherche
👨‍🚀|astronaute|espace, fusée
👩‍💼|employée de bureau|bureau, travail, manager
👨‍💼|employé de bureau|bureau, travail, manager
🦸|super-héros|héros, pouvoir
🧙|mage|magie, sorcier
🏃|personne qui court|course, vite, sport, urgent
🚶|personne qui marche|marche, piéton
🧘|personne en méditation|yoga, zen, calme
🕺|homme qui danse|danse, fête
💃|danseuse|danse, fête
👪|famille|famille, parents
`],
  nature: ['Nature', `
🐶|chien|animal, chiot
🐱|chat|animal, chaton
🐭|souris|animal
🐰|lapin|animal
🦊|renard|animal
🐻|ours|animal
🐼|panda|animal
🐨|koala|animal
🐯|tigre|animal
🦁|lion|animal, courage
🐮|vache|animal
🐷|cochon|animal
🐸|grenouille|animal
🐵|singe|animal
🙈|singe qui ne veut rien voir|oups, honte
🙉|singe qui ne veut rien entendre|rien entendu
🙊|singe qui ne veut rien dire|secret, oups
🐔|poule|animal
🐧|manchot|pingouin, animal
🐦|oiseau|animal
🦉|chouette|hibou, sagesse, nuit
🦄|licorne|magie, startup
🐝|abeille|travail, miel
🐛|chenille|bug, insecte
🦋|papillon|transformation
🐌|escargot|lent, lenteur
🐞|coccinelle|bug, insecte, chance
🐢|tortue|lent, patience
🐍|serpent|python
🐙|pieuvre|poulpe
🐠|poisson tropical|poisson
🐬|dauphin|mer
🐳|baleine|docker, mer
🦈|requin|mer
🐘|éléphant|mémoire
🦒|girafe|animal
🐾|empreintes de pattes|traces, patte
💐|bouquet|fleurs, cadeau, merci
🌸|fleur de cerisier|printemps, fleur
🌹|rose|fleur, amour
🌻|tournesol|fleur, été
🌷|tulipe|fleur, printemps
🌱|jeune pousse|croissance, début, germe, projet
🌿|herbe|plante, nature
☘|trèfle|plante
🍀|trèfle à quatre feuilles|chance
🌵|cactus|désert
🌲|sapin|arbre, forêt
🌳|arbre|nature
🌴|palmier|vacances, plage
🍁|feuille d'érable|automne, canada
🍂|feuilles mortes|automne
🍃|feuilles au vent|vent, nature
🍄|champignon|nature
🌍|globe Europe-Afrique|monde, terre, planète
🌎|globe Amériques|monde, terre
🌙|croissant de lune|nuit, lune
⭐|étoile|favori, star
🌟|étoile brillante|brillant, excellent
✨|étincelles|magie, brillant, nouveau, sparkles
⚡|éclair|énergie, rapide, électricité
🔥|feu|flamme, chaud, tendance, fire
🌈|arc-en-ciel|couleurs
☀|soleil|beau temps, été, météo
🌤|soleil derrière un petit nuage|éclaircie, météo
⛅|soleil derrière un nuage|nuageux, météo
🌥|soleil derrière un gros nuage|couvert, météo
☁|nuage|cloud, météo
🌦|soleil et pluie|averse, météo
🌧|nuage avec pluie|pluie, météo
⛈|orage|tonnerre, météo
🌩|nuage avec éclair|orage, météo
🌨|nuage avec neige|neige, météo
❄|flocon|neige, froid, hiver
☃|bonhomme de neige|neige, hiver
⛄|bonhomme de neige sans neige|hiver
🌬|visage qui souffle|vent
🌪|tornade|chaos
🌫|brouillard|flou
☔|parapluie sous la pluie|pluie
💧|goutte|eau
🌊|vague|mer, océan
🌡|thermomètre|température, chaleur
`],
  food: ['Nourriture', `
🍏|pomme verte|fruit
🍎|pomme rouge|fruit
🍐|poire|fruit
🍊|mandarine|fruit, orange
🍋|citron|fruit
🍌|banane|fruit
🍉|pastèque|fruit, été
🍇|raisin|fruit
🍓|fraise|fruit
🍒|cerises|fruit
🍑|pêche|fruit
🥭|mangue|fruit
🍍|ananas|fruit
🥥|noix de coco|fruit
🥝|kiwi|fruit
🍅|tomate|légume
🥑|avocat|légume
🥦|brocoli|légume
🥕|carotte|légume
🌽|maïs|légume
🌶|piment|épicé
🥐|croissant|viennoiserie, petit-déjeuner
🥖|baguette|pain
🧀|fromage|fromage
🥚|œuf|petit-déjeuner
🍳|œuf au plat|cuisine, petit-déjeuner
🥞|crêpes|pancakes
🥓|bacon|petit-déjeuner
🍔|hamburger|burger
🍟|frites|fast-food
🍕|pizza|repas
🌭|hot-dog|repas
🥪|sandwich|déjeuner
🌮|taco|repas
🥗|salade|légumes, sain
🍝|spaghetti|pâtes
🍜|bol de nouilles|ramen
🍣|sushi|japon
🍱|bento|déjeuner
🍦|glace italienne|dessert
🍩|donut|beignet, dessert
🍪|cookie|biscuit
🎂|gâteau d'anniversaire|anniversaire, fête
🍰|part de gâteau|dessert
🧁|cupcake|dessert
🍫|chocolat|dessert
🍬|bonbon|sucré
🍭|sucette|sucré
🍯|pot de miel|miel
🍿|pop-corn|cinéma
☕|café|boisson chaude, pause, coffee
🍵|thé|boisson chaude
🧃|brique de jus|jus, boisson
🥤|gobelet avec paille|boisson, soda
🍺|bière|boisson
🍻|chopes qui trinquent|santé, apéro
🥂|coupes de champagne|santé, célébration
🍷|verre de vin|vin
🍾|bouteille de champagne|célébration, fête
🍽|assiette et couverts|repas, restaurant
🥄|cuillère|couvert
🧂|sel|assaisonnement
`],
  activities: ['Activités', `
🎉|cotillons|fête, bravo, célébration, party
🎊|confettis|fête, célébration
🎈|ballon|fête, anniversaire
🎁|cadeau|surprise, anniversaire
🎀|ruban|nœud, cadeau
🎄|sapin de Noël|noël, fêtes
🎃|citrouille|halloween
🎆|feu d'artifice|fête, célébration
🎇|cierge magique|fête
🎗|ruban de soutien|soutien
🎟|billets d'entrée|ticket, événement
🎫|ticket|billet
🏆|trophée|victoire, gagnant, coupe
🏅|médaille sportive|récompense
🥇|médaille d'or|premier, gagnant
🥈|médaille d'argent|deuxième
🥉|médaille de bronze|troisième
🎖|médaille militaire|honneur
⚽|ballon de football|foot, sport
🏀|ballon de basket|sport
🏈|football américain|sport
⚾|baseball|sport
🎾|tennis|sport
🏐|volley-ball|sport
🏉|rugby|sport
🎱|boule de billard|billard, 8
🏓|ping-pong|sport
🏸|badminton|sport
⛳|drapeau de golf|golf, sport
🏹|arc et flèche|tir à l'arc
🎣|canne à pêche|pêche
🥊|gant de boxe|boxe, sport
🎿|skis|ski, hiver
🏂|snowboardeur|snowboard, hiver
🏄|surfeur|surf, vague
🚴|cycliste|vélo, sport
🏋|haltérophile|musculation, sport
🎯|cible|objectif, but, focus, target
🎮|manette de jeu|jeu vidéo
🕹|joystick|jeu vidéo
🎲|dé|jeu, hasard
🧩|pièce de puzzle|puzzle, solution
♟|pion d'échecs|échecs, stratégie
🃏|joker|carte
🎨|palette de peintre|art, peinture, design
🎭|arts du spectacle|théâtre
🎬|clap de cinéma|film, action
🎤|micro|chanter, karaoké, parole
🎧|casque audio|musique, écouter
🎼|partition|musique
🎵|note de musique|musique
🎶|notes de musique|musique
🎹|piano|musique
🥁|batterie|tambour, musique
🎸|guitare|musique
🎺|trompette|musique
🎻|violon|musique
🎳|bowling|jeu
🪁|cerf-volant|vent, jeu
🛹|skateboard|planche
`],
  travel: ['Voyages & lieux', `
🚗|voiture|auto, transport
🚕|taxi|transport
🚌|bus|transport
🚎|trolleybus|transport
🏎|voiture de course|course, vitesse
🚓|voiture de police|police
🚑|ambulance|urgence, santé
🚒|camion de pompiers|pompiers, urgence
🚚|camion|livraison
🚜|tracteur|ferme
🛴|trottinette|transport
🚲|vélo|bicyclette
🛵|scooter|transport
🏍|moto|transport
🚨|gyrophare|alerte, urgence, alarme
🚦|feu tricolore|circulation, statut
🚧|travaux|en cours, chantier, wip
⚓|ancre|marine, port
⛵|voilier|bateau
🚤|hors-bord|bateau
🚢|navire|bateau, paquebot
✈|avion|voyage, vol
🛫|avion qui décolle|départ, lancement
🛬|avion qui atterrit|arrivée
🚁|hélicoptère|vol
🚀|fusée|lancement, startup, décollage, rocket
🛸|soucoupe volante|ovni
🚂|locomotive|train
🚄|train à grande vitesse|tgv, train
🚇|métro|transport
🚉|gare|train
🗺|carte du monde|carte, voyage
🧭|boussole|direction, orientation
🏔|montagne enneigée|montagne
⛰|montagne|sommet
🌋|volcan|éruption
🏕|camping|tente, nature
🏖|plage avec parasol|vacances, été
🏝|île déserte|vacances
🏠|maison|domicile
🏡|maison avec jardin|domicile
🏢|immeuble de bureaux|bureau, entreprise
🏭|usine|industrie
🏥|hôpital|santé
🏦|banque|argent
🏨|hôtel|voyage
🏪|supérette|magasin, commerce
🏫|école|éducation
🏰|château|histoire
🗼|tour|tour Eiffel, paris
🗽|statue de la Liberté|new york
🏛|monument classique|musée, institution
🌉|pont de nuit|pont
🌃|nuit étoilée|nuit, ville
🌅|lever de soleil|matin, aube
🏙|ville|paysage urbain
🎡|grande roue|fête foraine
🎢|montagnes russes|fête foraine, hauts et bas
⛲|fontaine|parc
⛺|tente|camping
🗿|moaï|statue
`],
  objects: ['Objets', `
⌚|montre|heure, temps
📱|smartphone|téléphone, mobile
💻|ordinateur portable|laptop, informatique
⌨|clavier|saisie
🖥|écran d'ordinateur|ordinateur
🖨|imprimante|impression
🖱|souris d'ordinateur|souris, clic
💾|disquette|sauvegarder, enregistrer
💿|disque|cd
📷|appareil photo|photo
📸|appareil photo avec flash|photo, flash
📹|caméscope|vidéo
🎥|caméra|cinéma, vidéo
📞|combiné téléphonique|téléphone, appel
☎|téléphone|appel
📺|télévision|tv
📻|radio|son
🎙|micro de studio|podcast, enregistrement
⏰|réveil|alarme, heure
⏱|chronomètre|temps, durée
⏲|minuteur|temps, compte à rebours
🕰|pendule|horloge
⌛|sablier|temps, attente
⏳|sablier qui s'écoule|en cours, attente
🔋|pile|batterie, énergie
🔌|prise électrique|branchement
💡|ampoule|idée, lumière, inspiration
🔦|lampe torche|lumière
🕯|bougie|lumière
💸|billets qui s'envolent|dépense, argent
💵|billet de dollar|argent
💶|billet d'euro|argent, euro
💰|sac d'argent|argent, budget, richesse
💳|carte bancaire|paiement
💎|diamant|précieux, valeur
⚖|balance|justice, équilibre
🧰|boîte à outils|outils
🔧|clé à molette|outil, réglage
🔨|marteau|outil, construction
⚒|marteau et pioche|outils
🛠|marteau et clé|outils, réglages
⛏|pioche|outil
🔩|écrou et boulon|vis
⚙|engrenage|réglages, paramètres
🧱|brique|construction
⛓|chaînes|lien
🧲|aimant|attraction
🔮|boule de cristal|prédiction, avenir
💊|pilule|médicament
🩹|pansement|soin
🧪|tube à essai|expérience, test
🔬|microscope|science, détail
🔭|télescope|vision, futur
🧬|ADN|génétique, science
🧹|balai|nettoyage
🧺|panier|linge
🛒|caddie|courses, achat
🛍|sacs de shopping|achats, boutique
🎒|sac à dos|école, voyage
👓|lunettes|vue
🕶|lunettes de soleil|cool
👔|cravate|travail, bureau
👕|t-shirt|vêtement
👟|basket|chaussure, sport
👑|couronne|roi, reine, premier
🎩|haut-de-forme|chapeau, magie
🧢|casquette|chapeau
💼|porte-documents|travail, bureau, business
📁|dossier|fichiers
📂|dossier ouvert|fichiers
🗂|intercalaires|classement, organisation
📅|calendrier|date, agenda
📆|calendrier à feuilles|date, planning
🗓|calendrier à spirale|planning, agenda
📇|fichier rotatif|contacts
📈|graphique en hausse|croissance, progression, statistiques
📉|graphique en baisse|baisse, recul, statistiques
📊|graphique à barres|statistiques, données
📋|presse-papiers|liste, checklist
📌|punaise|épingler, important
📍|épingle|lieu, position, localisation
📎|trombone|pièce jointe
🖇|trombones liés|attache
📏|règle|mesure
📐|équerre|mesure, géométrie
✂|ciseaux|couper
🗃|boîte à fiches|archives
🗄|classeur|archives, rangement
🗑|corbeille|poubelle, supprimer
🔒|cadenas fermé|verrouillé, sécurité, privé
🔓|cadenas ouvert|déverrouillé
🔑|clé|accès, mot de passe
🗝|vieille clé|accès, secret
🔐|cadenas avec clé|sécurisé
📝|mémo|note, à faire, écrire
✏|crayon|écrire, modifier
✒|plume|écrire
🖊|stylo|écrire
🖋|stylo plume|écrire, signer
🖌|pinceau|peinture, art
🖍|crayon de cire|dessin
📒|carnet|notes
📓|cahier|notes
📔|carnet décoré|journal
📕|livre fermé|lecture
📖|livre ouvert|lecture, documentation
📚|livres|lecture, bibliothèque, apprendre
🔖|marque-page|signet
🏷|étiquette|tag, prix
📰|journal|actualité, presse
🗞|journal roulé|actualité, presse
📄|page|document
📃|page enroulée|document
📑|onglets|marque-pages
📜|parchemin|histoire, document
✉|enveloppe|courrier, mail
📧|e-mail|courriel, mail
📨|enveloppe entrante|courrier reçu
📩|enveloppe avec flèche|envoi
📤|boîte d'envoi|envoyer
📥|boîte de réception|recevoir
📦|colis|paquet, livraison
📫|boîte aux lettres|courrier
📮|boîte postale|courrier
🔔|cloche|notification, rappel
🔕|cloche barrée|silence, muet
📣|mégaphone|annonce, communication
📢|haut-parleur|annonce
🔍|loupe à gauche|recherche, chercher
🔎|loupe à droite|recherche, chercher
🔗|lien|url, chaîne
🧷|épingle à nourrice|attache
🧵|bobine de fil|couture
🧶|pelote de laine|tricot
🚪|porte|entrée, sortie
`],
  symbols: ['Symboles', `
✅|bouton coché|validé, fait, ok, terminé, done
☑|case cochée|validé, coché
✔|coche|validé, ok, check
❌|croix|non, erreur, refusé, annulé
❎|bouton croix|non, refusé
➕|plus|ajouter
➖|moins|retirer
➗|division|diviser
✖|multiplication|fois
❓|point d'interrogation rouge|question
❔|point d'interrogation blanc|question
❗|point d'exclamation rouge|important, attention
❕|point d'exclamation blanc|important
‼|double point d'exclamation|important, urgent
⁉|point d'exclamation et d'interrogation|surprise, quoi
⚠|avertissement|attention, danger, alerte
🚫|interdit|défendu, non
⛔|sens interdit|bloqué, stop
🛑|panneau stop|arrêt, stop
⭕|cercle rouge|rond, ok
🔴|disque rouge|rouge, statut, bloqué
🟠|disque orange|orange, statut
🟡|disque jaune|jaune, statut, en attente
🟢|disque vert|vert, statut, ok
🔵|disque bleu|bleu, statut
🟣|disque violet|violet
🟤|disque marron|marron
⚫|disque noir|noir
⚪|disque blanc|blanc
🟥|carré rouge|rouge
🟧|carré orange|orange
🟨|carré jaune|jaune
🟩|carré vert|vert
🟦|carré bleu|bleu
🟪|carré violet|violet
⬛|grand carré noir|noir
⬜|grand carré blanc|blanc
🔶|grand losange orange|losange
🔷|grand losange bleu|losange
🔺|triangle rouge pointant vers le haut|hausse
🔻|triangle rouge pointant vers le bas|baisse
⬆|flèche vers le haut|haut, monter
↗|flèche en haut à droite|diagonale, hausse
➡|flèche vers la droite|droite, suivant
↘|flèche en bas à droite|diagonale, baisse
⬇|flèche vers le bas|bas, descendre
↙|flèche en bas à gauche|diagonale
⬅|flèche vers la gauche|gauche, précédent
↖|flèche en haut à gauche|diagonale
↕|flèche haut bas|vertical
↔|flèche gauche droite|horizontal
↩|flèche de retour|retour, annuler
↪|flèche courbe vers la droite|rétablir
⤴|flèche courbe vers le haut|haut
⤵|flèche courbe vers le bas|bas
🔃|flèches dans le sens horaire|cycle, actualiser
🔄|flèches dans le sens antihoraire|actualiser, recommencer, sync
🔁|répéter|boucle
🔀|lecture aléatoire|mélanger, hasard
🔙|flèche retour|retour
🔚|flèche fin|fin
🔜|flèche bientôt|bientôt, prochainement
🔝|flèche top|top, haut
▶|lecture|play, démarrer
⏸|pause|attente
⏹|arrêt|stop
⏺|enregistrement|rec
⏭|piste suivante|suivant
⏮|piste précédente|précédent
⏩|avance rapide|accélérer
⏪|retour rapide|rembobiner
🔼|bouton vers le haut|haut
🔽|bouton vers le bas|bas
0⃣|touche zéro|0, chiffre, nombre
1⃣|touche un|1, chiffre, nombre, premier
2⃣|touche deux|2, chiffre, nombre
3⃣|touche trois|3, chiffre, nombre
4⃣|touche quatre|4, chiffre, nombre
5⃣|touche cinq|5, chiffre, nombre
6⃣|touche six|6, chiffre, nombre
7⃣|touche sept|7, chiffre, nombre
8⃣|touche huit|8, chiffre, nombre
9⃣|touche neuf|9, chiffre, nombre
🔟|touche dix|10, nombre
#⃣|touche dièse|hashtag, croisillon
*⃣|touche astérisque|étoile
🆕|bouton nouveau|new, nouveauté
🆗|bouton ok|ok, d'accord
🆒|bouton cool|cool
🆙|bouton up|up, mise à jour
🆓|bouton gratuit|free, gratuit
🆘|bouton sos|aide, secours
🆚|bouton versus|vs, contre, comparaison
ℹ|information|info, aide
♻|recyclage|recycler, écologie
✳|astérisque|étoile
❇|étincelle|brillant
💲|symbole dollar|argent, prix
💱|change de devises|monnaie, change
🔆|luminosité forte|lumière
📶|barres de réseau|signal, réseau
🔇|haut-parleur barré|muet, silence
🔈|haut-parleur volume faible|son
🔊|haut-parleur volume fort|son, fort
➰|boucle|boucle
♾|infini|infini, toujours
♿|accessibilité|fauteuil roulant, handicap
☮|symbole de paix|paix
☯|yin yang|équilibre
⚛|atome|science, physique
🕐|une heure|heure, horloge
`],
};

const FLAG_SOURCE = `
🏁|drapeau à damier|arrivée, fin, course, terminé, checkered
🚩|drapeau triangulaire|signalement, alerte, red flag
🎌|drapeaux croisés|japon, fête
🏳|drapeau blanc|reddition, paix
🏴|drapeau noir|noir
🏴‍☠|drapeau pirate|pirate, jolly roger
🏳‍🌈|drapeau arc-en-ciel|fierté, lgbt
`;

const COUNTRY_FLAGS = [
  ['FR', 'France', 'français, paris'],
  ['BE', 'Belgique', 'belge, bruxelles'],
  ['CH', 'Suisse', 'suisse, genève, berne'],
  ['CA', 'Canada', 'canadien, québec'],
  ['LU', 'Luxembourg', 'luxembourgeois'],
  ['EU', 'Union européenne', 'europe, ue, eu'],
  ['US', 'États-Unis', 'usa, amérique, américain'],
  ['GB', 'Royaume-Uni', 'uk, angleterre, anglais, britannique'],
  ['DE', 'Allemagne', 'allemand, berlin'],
  ['ES', 'Espagne', 'espagnol, madrid'],
  ['IT', 'Italie', 'italien, rome'],
  ['PT', 'Portugal', 'portugais, lisbonne'],
  ['NL', 'Pays-Bas', 'hollande, néerlandais'],
  ['JP', 'Japon', 'japonais, tokyo'],
  ['MA', 'Maroc', 'marocain'],
  ['SN', 'Sénégal', 'sénégalais'],
];

function parseEmojiLines(text, category) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [char, name, keywords] = line.split('|');
    return Object.freeze({ char: qualify(char), name, keywords: Object.freeze(keywordList(keywords)), category });
  });
}

export const EMOJI_CATEGORIES = Object.freeze([
  ...Object.entries(EMOJI_SOURCE).map(([id, [name, text]]) => Object.freeze({
    id, name, emojis: Object.freeze(parseEmojiLines(text, id)),
  })),
  Object.freeze({
    id: 'flags',
    name: 'Drapeaux',
    emojis: Object.freeze([
      ...parseEmojiLines(FLAG_SOURCE, 'flags'),
      ...COUNTRY_FLAGS.map(([code, name, keywords]) => Object.freeze({
        char: flag(code), name: `drapeau ${name}`, keywords: Object.freeze(['drapeau', 'pays', code.toLowerCase(), ...keywordList(keywords)]), category: 'flags',
      })),
    ]),
  }),
]);

export const ALL_EMOJI = Object.freeze(EMOJI_CATEGORIES.flatMap((category) => category.emojis));

export function searchEmoji(query) {
  return rankedSearch(ALL_EMOJI, query, (emoji) => ({ name: emoji.name, keywords: emoji.keywords }), 200);
}

// ---------------------------------------------------------------- stickers
// Each sticker is drawn on a 120×120 canvas as two layers: a silhouette
// (shape only, no colours) reused for the soft offset shadow and the thick
// white die-cut border, then the coloured artwork on top.
const INK = '#2b2d42';
const FONT = 'Segoe UI, system-ui, sans-serif';

function r1(value) {
  return Math.round(value * 10) / 10;
}

function escapeXml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Polygon points of a star / burst with `count` spikes.
function starPoints(cx, cy, outer, inner, count = 5, rotation = -90) {
  const points = [];
  for (let i = 0; i < count * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (rotation + (i * 180) / count) * (Math.PI / 180);
    points.push(`${r1(cx + radius * Math.cos(angle))},${r1(cy + radius * Math.sin(angle))}`);
  }
  return points.join(' ');
}

// Four-pointed sparkle centred on (cx, cy).
function sparklePath(cx, cy, r) {
  return `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z`;
}

// Heart centred on the origin, about 90 wide and 82 tall before scaling.
const HEART = 'M0 40C-40 14-48-8-42-22C-35-40-10-42 0-24C10-42 35-40 42-22C48-8 40 14 0 40Z';
function heart(cx, cy, scale, attrs = '') {
  return `<path transform="translate(${cx} ${cy}) scale(${scale})" d="${HEART}"${attrs}/>`;
}

// Bold centred label; squeezed with textLength when it would overflow.
function label(text, x, y, size, fill, maxWidth, extra = '') {
  const estimate = [...text].length * size * 0.64;
  const fit = estimate > maxWidth ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"` : '';
  const paint = fill ? ` fill="${fill}"` : '';
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="800" text-anchor="middle" dominant-baseline="central"${paint}${fit}${extra}>${escapeXml(text)}</text>`;
}

function wrapSticker(silhouette, art, size) {
  const n = Number(size);
  const dims = Number.isFinite(n) && n > 0 ? ` width="${r1(n)}" height="${r1(n)}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"${dims}>`
    + `<g opacity="0.2" transform="translate(3 5)" fill="${INK}" stroke="${INK}" stroke-width="12" stroke-linejoin="round" stroke-linecap="round">${silhouette}</g>`
    + `<g fill="#ffffff" stroke="#ffffff" stroke-width="12" stroke-linejoin="round" stroke-linecap="round">${silhouette}</g>`
    + art
    + '</svg>';
}

const DISC = '<circle cx="60" cy="60" r="46"/>';
const disc = (fill, stroke) => `<circle cx="60" cy="60" r="46" fill="${fill}" stroke="${stroke}" stroke-width="4"/>`;
const FACE_FILL = ['#ffd43b', '#f59f00'];
const PILL = '<rect x="12" y="32" width="96" height="56" rx="18"/>';
const pill = (fill, stroke) => `<rect x="12" y="32" width="96" height="56" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="4"/>`;
const shine = (d) => `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.75"/>`;
const line = (d, color, width, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;

const THUMB_HAND = 'M45 58L56 58L62 36Q64 27 72 29Q79 31 77 41L74 54L88 54Q97 55 95 63L91 85Q89 91 83 91L45 91Z';
function thumbArt() {
  return '<rect x="30" y="56" width="13" height="36" rx="3" fill="#ffffff" stroke="#495057" stroke-width="3"/>'
    + `<path d="${THUMB_HAND}" fill="#ffd43b" stroke="#e67700" stroke-width="3" stroke-linejoin="round"/>`
    + line('M80 66H93M80 76H91', '#e67700', 3);
}

const CHART_CARD = '<rect x="14" y="16" width="92" height="88" rx="14"/>';
function chartArt(bars, color, trend, head) {
  return '<rect x="14" y="16" width="92" height="88" rx="14" fill="#ffffff" stroke="#ced4da" stroke-width="3"/>'
    + line('M26 92H94', '#adb5bd', 3)
    + bars.map(([x, h]) => `<rect x="${x}" y="${92 - h}" width="14" height="${h}" rx="3" fill="#a5d8ff"/>`).join('')
    + line(trend, color, 7) + line(head, color, 7);
}

const CROWN = 'M20 40L38 60L60 24L82 60L100 40L94 92L26 92Z';
const ROCKET = '<path d="M60 12C76 24 82 44 80 72L40 72C38 44 44 24 60 12Z"/><path d="M40 56L26 74L28 86L42 76Z"/><path d="M80 56L94 74L92 86L78 76Z"/><path d="M48 80Q60 112 72 80Z"/>';
const PENCIL = '<rect x="12" y="46" width="72" height="28" rx="6"/><path d="M84 46L108 60L84 74Z"/>';
const CLOUD = 'M30 92C16 92 10 80 12 70C14 58 26 52 36 56C38 38 54 28 70 32C84 35 92 46 92 54C104 54 110 64 108 76C106 86 98 92 88 92Z';

const STICKER_DEFS = [
  {
    id: 'etoile', name: 'Étoile', keywords: 'étoile, favori, star, top, excellent',
    sil: `<polygon points="${starPoints(60, 62, 50, 24)}"/>`,
    art: `<polygon points="${starPoints(60, 62, 50, 24)}" fill="#ffd43b" stroke="#f59f00" stroke-width="4" stroke-linejoin="round"/>`
      + `<circle cx="50" cy="62" r="4.5" fill="${INK}"/><circle cx="70" cy="62" r="4.5" fill="${INK}"/>`
      + line('M52 73Q60 80 68 73', INK, 3.5) + shine('M46 36L52 26'),
  },
  {
    id: 'coeur', name: 'Cœur', keywords: 'coeur, amour, love, j\'aime, like, heart',
    sil: heart(60, 62, 1),
    art: heart(60, 62, 1, ' fill="#fa5252" stroke="#e03131" stroke-width="4" stroke-linejoin="round"') + shine('M32 48Q35 38 45 36'),
  },
  {
    id: 'pouce-haut', name: 'Pouce levé', keywords: 'pouce, ok, oui, j\'aime, like, approuvé, bravo, thumbs up',
    sil: DISC,
    art: disc('#4dabf7', '#1c7ed6') + thumbArt(),
  },
  {
    id: 'pouce-bas', name: 'Pouce baissé', keywords: 'pouce, non, je n\'aime pas, dislike, désapprouvé, thumbs down',
    sil: DISC,
    art: disc('#ff8787', '#e03131') + `<g transform="rotate(180 60 60)">${thumbArt()}</g>`,
  },
  {
    id: 'valide', name: 'Validé', keywords: 'validé, coche, check, ok, fait, terminé, oui, done',
    sil: DISC,
    art: disc('#40c057', '#2f9e44') + line('M38 62L53 77L83 45', '#ffffff', 12),
  },
  {
    id: 'refuse', name: 'Refusé', keywords: 'refusé, croix, non, erreur, rejeté, annulé, no',
    sil: DISC,
    art: disc('#fa5252', '#e03131') + line('M42 42L78 78M78 42L42 78', '#ffffff', 12),
  },
  {
    id: 'idee', name: 'Idée', keywords: 'idée, ampoule, lumière, inspiration, eurêka, idea',
    sil: '<path d="M60 14C36 14 24 32 26 50C27 62 34 70 41 77C44 80 45 84 45 88L75 88C75 84 76 80 79 77C86 70 93 62 94 50C96 32 84 14 60 14Z"/><rect x="45" y="88" width="30" height="16" rx="5"/><path d="M14 30L22 35M106 30L98 35M12 54L20 54M108 54L100 54" fill="none"/>',
    art: line('M14 30L22 35M106 30L98 35M12 54L20 54M108 54L100 54', '#fcc419', 5)
      + '<path d="M60 14C36 14 24 32 26 50C27 62 34 70 41 77C44 80 45 84 45 88L75 88C75 84 76 80 79 77C86 70 93 62 94 50C96 32 84 14 60 14Z" fill="#ffe066" stroke="#f59f00" stroke-width="4"/>'
      + '<rect x="45" y="88" width="30" height="16" rx="5" fill="#adb5bd" stroke="#495057" stroke-width="3"/>'
      + line('M47 94H73M47 99H73', '#495057', 2.5)
      + line('M52 72L56 58L60 68L64 58L68 72', '#f08c00', 3.5) + shine('M38 44Q40 32 50 28'),
  },
  {
    id: 'feu', name: 'Feu', keywords: 'feu, flamme, chaud, tendance, urgent, fire, hot',
    sil: '<path d="M60 10C66 30 88 40 92 64C95 88 78 106 60 106C42 106 25 90 28 68C30 54 38 46 44 38C46 50 50 54 54 56C52 38 54 24 60 10Z"/>',
    art: '<path d="M60 10C66 30 88 40 92 64C95 88 78 106 60 106C42 106 25 90 28 68C30 54 38 46 44 38C46 50 50 54 54 56C52 38 54 24 60 10Z" fill="#ff922b" stroke="#e8590c" stroke-width="4"/>'
      + '<path d="M60 52C64 64 76 70 76 84C76 96 68 101 60 101C52 101 44 96 44 86C44 76 52 72 54 66C56 72 58 74 60 74C58 66 58 58 60 52Z" fill="#ffd43b"/>'
      + '<ellipse cx="60" cy="91" rx="7" ry="8" fill="#fff3bf"/>',
  },
  {
    id: 'fusee', name: 'Fusée', keywords: 'fusée, lancement, décollage, startup, espace, rocket, launch',
    sil: `<g transform="rotate(45 60 60)">${ROCKET}</g>`,
    art: '<g transform="rotate(45 60 60)">'
      + '<path d="M48 80Q60 112 72 80Z" fill="#ff922b"/><path d="M53 80Q60 100 67 80Z" fill="#ffd43b"/>'
      + '<path d="M40 56L26 74L28 86L42 76Z" fill="#fa5252" stroke="#c92a2a" stroke-width="3" stroke-linejoin="round"/>'
      + '<path d="M80 56L94 74L92 86L78 76Z" fill="#fa5252" stroke="#c92a2a" stroke-width="3" stroke-linejoin="round"/>'
      + '<rect x="46" y="70" width="28" height="10" rx="3" fill="#868e96" stroke="#495057" stroke-width="3"/>'
      + '<path d="M60 12C76 24 82 44 80 72L40 72C38 44 44 24 60 12Z" fill="#e9ecef" stroke="#495057" stroke-width="3.5"/>'
      + '<path d="M60 12C68 18 73 25 76 32L44 32C47 25 52 18 60 12Z" fill="#fa5252"/>'
      + '<circle cx="60" cy="48" r="10" fill="#4dabf7" stroke="#495057" stroke-width="3.5"/>'
      + '</g>',
  },
  {
    id: 'trophee', name: 'Trophée', keywords: 'trophée, coupe, victoire, gagnant, champion, trophy, winner',
    sil: '<path d="M34 18H86V44C86 62 74 72 60 72C46 72 34 62 34 44Z"/><path d="M34 26H22C20 44 28 52 36 54M86 26H98C100 44 92 52 84 54"/><rect x="53" y="70" width="14" height="16"/><rect x="38" y="84" width="44" height="18" rx="4"/>',
    art: line('M34 26H22C20 44 28 52 36 54M86 26H98C100 44 92 52 84 54', '#fcc419', 7)
      + '<rect x="53" y="70" width="14" height="16" fill="#f59f00"/>'
      + '<path d="M34 18H86V44C86 62 74 72 60 72C46 72 34 62 34 44Z" fill="#fcc419" stroke="#e67700" stroke-width="4" stroke-linejoin="round"/>'
      + `<polygon points="${starPoints(60, 42, 12, 5.5)}" fill="#fff3bf"/>`
      + '<rect x="38" y="84" width="44" height="18" rx="4" fill="#7950f2" stroke="#5f3dc4" stroke-width="3"/>',
  },
  {
    id: 'attention', name: 'Attention', keywords: 'attention, alerte, danger, avertissement, prudence, warning',
    sil: '<path d="M60 16L106 96L14 96Z"/>',
    art: '<path d="M60 16L106 96L14 96Z" fill="#ffd43b" stroke="#f59f00" stroke-width="8" stroke-linejoin="round"/>'
      + `<rect x="55" y="40" width="10" height="32" rx="5" fill="${INK}"/><circle cx="60" cy="84" r="6" fill="${INK}"/>`,
  },
  {
    id: 'question', name: 'Question', keywords: 'question, interrogation, aide, pourquoi, doute, help',
    sil: DISC,
    art: disc('#9775fa', '#7048e8') + label('?', 60, 62, 68, '#ffffff', 70),
  },
  {
    id: 'exclamation', name: 'Exclamation', keywords: 'exclamation, important, alerte, attention',
    sil: DISC,
    art: disc('#ff922b', '#e8590c') + label('!', 60, 62, 68, '#ffffff', 70),
  },
  {
    id: 'drapeau', name: 'Drapeau', keywords: 'drapeau, jalon, objectif, étape, arrivée, flag, milestone',
    sil: '<rect x="26" y="20" width="8" height="86" rx="4"/><circle cx="30" cy="18" r="6"/><path d="M34 24C50 16 62 32 78 26C86 23 92 22 98 24L98 66C86 62 76 70 62 70C50 70 42 62 34 66Z"/>',
    art: '<rect x="26" y="20" width="8" height="86" rx="4" fill="#868e96" stroke="#495057" stroke-width="3"/>'
      + '<circle cx="30" cy="18" r="6" fill="#fcc419" stroke="#e67700" stroke-width="3"/>'
      + '<path d="M34 24C50 16 62 32 78 26C86 23 92 22 98 24L98 66C86 62 76 70 62 70C50 70 42 62 34 66Z" fill="#fa5252" stroke="#c92a2a" stroke-width="4" stroke-linejoin="round"/>',
  },
  {
    id: 'epingle', name: 'Épingle', keywords: 'épingle, punaise, lieu, carte, localisation, adresse, pin',
    sil: '<path d="M60 104C48 90 24 66 24 44C24 24 40 10 60 10C80 10 96 24 96 44C96 66 72 90 60 104Z"/>',
    art: '<path d="M60 104C48 90 24 66 24 44C24 24 40 10 60 10C80 10 96 24 96 44C96 66 72 90 60 104Z" fill="#fa5252" stroke="#c92a2a" stroke-width="4"/>'
      + '<circle cx="60" cy="44" r="14" fill="#ffffff"/>' + shine('M34 36Q38 24 48 20'),
  },
  {
    id: 'horloge', name: 'Horloge', keywords: 'horloge, heure, temps, délai, durée, clock, time',
    sil: DISC,
    art: '<circle cx="60" cy="60" r="44" fill="#ffffff" stroke="#4dabf7" stroke-width="8"/>'
      + line('M60 24V30M60 90V96M24 60H30M90 60H96', '#adb5bd', 5)
      + line('M60 60V34M60 60L78 70', INK, 6) + '<circle cx="60" cy="60" r="5" fill="#fa5252"/>',
  },
  {
    id: 'calendrier', name: 'Calendrier', keywords: 'calendrier, date, échéance, planning, agenda, deadline',
    sil: '<rect x="18" y="22" width="84" height="80" rx="12"/><rect x="34" y="12" width="10" height="20" rx="5"/><rect x="76" y="12" width="10" height="20" rx="5"/>',
    art: '<rect x="18" y="22" width="84" height="80" rx="12" fill="#ffffff" stroke="#adb5bd" stroke-width="3"/>'
      + '<path d="M18 34A12 12 0 0 1 30 22H90A12 12 0 0 1 102 34V46H18Z" fill="#fa5252"/>'
      + '<rect x="34" y="12" width="10" height="20" rx="5" fill="#495057"/><rect x="76" y="12" width="10" height="20" rx="5" fill="#495057"/>'
      + label('31', 60, 75, 36, INK, 60),
  },
  {
    id: 'cible', name: 'Cible', keywords: 'cible, objectif, but, focus, précision, target, goal',
    sil: `${DISC}<path d="M60 60L96 24M96 24L104 14M96 24L108 22" fill="none"/>`,
    art: '<circle cx="60" cy="60" r="46" fill="#fa5252" stroke="#c92a2a" stroke-width="3"/>'
      + '<circle cx="60" cy="60" r="34" fill="#ffffff"/><circle cx="60" cy="60" r="22" fill="#fa5252"/><circle cx="60" cy="60" r="10" fill="#ffffff"/>'
      + line('M60 60L96 24', '#495057', 5) + line('M96 24L104 14M96 24L108 22', '#fcc419', 5)
      + '<polygon points="60,60 72,57 63,48" fill="#495057"/>',
  },
  {
    id: 'couronne', name: 'Couronne', keywords: 'couronne, roi, reine, meilleur, premium, champion, crown',
    sil: `<path d="${CROWN}"/><rect x="24" y="84" width="72" height="16" rx="4"/><circle cx="20" cy="40" r="7"/><circle cx="60" cy="24" r="7"/><circle cx="100" cy="40" r="7"/>`,
    art: `<path d="${CROWN}" fill="#fcc419" stroke="#e67700" stroke-width="4" stroke-linejoin="round"/>`
      + '<rect x="24" y="84" width="72" height="16" rx="4" fill="#f59f00" stroke="#e67700" stroke-width="3"/>'
      + '<circle cx="20" cy="40" r="7" fill="#ffe066" stroke="#e67700" stroke-width="3"/><circle cx="60" cy="24" r="7" fill="#ffe066" stroke="#e67700" stroke-width="3"/><circle cx="100" cy="40" r="7" fill="#ffe066" stroke="#e67700" stroke-width="3"/>'
      + '<circle cx="40" cy="92" r="5" fill="#fa5252"/><circle cx="60" cy="92" r="5" fill="#4dabf7"/><circle cx="80" cy="92" r="5" fill="#fa5252"/>',
  },
  {
    id: 'etincelles', name: 'Étincelles', keywords: 'étincelles, magie, brillant, nouveau, wow, sparkles',
    sil: `<path d="${sparklePath(50, 64, 40)}"/><path d="${sparklePath(90, 30, 16)}"/><path d="${sparklePath(92, 90, 12)}"/>`,
    art: `<path d="${sparklePath(50, 64, 40)}" fill="#ffd43b" stroke="#f59f00" stroke-width="3" stroke-linejoin="round"/>`
      + `<path d="${sparklePath(90, 30, 16)}" fill="#ff8787" stroke="#e03131" stroke-width="3" stroke-linejoin="round"/>`
      + `<path d="${sparklePath(92, 90, 12)}" fill="#74c0fc" stroke="#1c7ed6" stroke-width="3" stroke-linejoin="round"/>`,
  },
  {
    id: 'cafe', name: 'Café', keywords: 'café, pause, tasse, boisson, matin, coffee, break',
    sil: '<path d="M24 40H84V82C84 96 74 104 62 104H46C34 104 24 96 24 82Z"/><path d="M84 50H92C102 50 104 72 92 76H84" fill="none"/><path d="M42 30C38 24 46 20 42 14M58 30C54 24 62 20 58 14" fill="none"/>',
    art: line('M42 30C38 24 46 20 42 14M58 30C54 24 62 20 58 14', '#adb5bd', 5)
      + line('M84 50H92C102 50 104 72 92 76H84', '#d6336c', 9)
      + '<path d="M24 40H84V82C84 96 74 104 62 104H46C34 104 24 96 24 82Z" fill="#f783ac" stroke="#d6336c" stroke-width="4" stroke-linejoin="round"/>'
      + '<rect x="28" y="42" width="52" height="7" rx="3.5" fill="#7f4f24"/>'
      + heart(54, 76, 0.3, ' fill="#ffffff"'),
  },
  {
    id: 'musique', name: 'Musique', keywords: 'musique, note, son, chanson, playlist, music',
    sil: '<ellipse cx="34" cy="86" rx="14" ry="11"/><ellipse cx="82" cy="76" rx="14" ry="11"/><polygon points="44,30 94,20 94,36 44,46"/><path d="M44 30V86M94 22V76" fill="none"/>',
    art: line('M44 30V86M94 22V76', '#7048e8', 7)
      + '<polygon points="44,30 94,20 94,36 44,46" fill="#9775fa" stroke="#7048e8" stroke-width="3" stroke-linejoin="round"/>'
      + '<ellipse cx="34" cy="86" rx="14" ry="11" fill="#9775fa" stroke="#7048e8" stroke-width="3" transform="rotate(-20 34 86)"/>'
      + '<ellipse cx="82" cy="76" rx="14" ry="11" fill="#9775fa" stroke="#7048e8" stroke-width="3" transform="rotate(-20 82 76)"/>',
  },
  {
    id: 'appareil-photo', name: 'Appareil photo', keywords: 'photo, appareil, image, souvenir, caméra, camera',
    sil: '<rect x="14" y="34" width="92" height="64" rx="14"/><path d="M38 34L46 22H74L82 34Z"/>',
    art: '<path d="M38 36L46 22H74L82 36Z" fill="#e03131" stroke="#c92a2a" stroke-width="3" stroke-linejoin="round"/>'
      + '<rect x="14" y="34" width="92" height="64" rx="14" fill="#ff8787" stroke="#e03131" stroke-width="4"/>'
      + '<circle cx="60" cy="66" r="22" fill="#343a40"/><circle cx="60" cy="66" r="14" fill="#74c0fc"/><circle cx="54" cy="60" r="4" fill="#ffffff"/>'
      + '<rect x="84" y="42" width="14" height="8" rx="2" fill="#ffe066"/>',
  },
  {
    id: 'palette', name: 'Palette', keywords: 'palette, peinture, couleurs, art, design, créatif, paint',
    sil: '<path d="M60 14C32 14 12 34 12 60C12 86 34 106 58 106C66 106 70 100 68 94C66 88 70 82 78 82H90C100 82 108 74 108 62C108 34 86 14 60 14Z"/>',
    art: '<path d="M60 14C32 14 12 34 12 60C12 86 34 106 58 106C66 106 70 100 68 94C66 88 70 82 78 82H90C100 82 108 74 108 62C108 34 86 14 60 14Z" fill="#f4d6a0" stroke="#c08a3e" stroke-width="4"/>'
      + '<circle cx="36" cy="50" r="8" fill="#fa5252"/><circle cx="57" cy="33" r="8" fill="#fcc419"/><circle cx="81" cy="38" r="8" fill="#40c057"/>'
      + '<circle cx="34" cy="76" r="8" fill="#4dabf7"/><circle cx="54" cy="88" r="7" fill="#9775fa"/>'
      + '<circle cx="86" cy="62" r="8" fill="#ffffff" stroke="#c08a3e" stroke-width="3"/>',
  },
  {
    id: 'crayon', name: 'Crayon', keywords: 'crayon, écrire, dessiner, modifier, note, pencil, edit',
    sil: `<g transform="rotate(-40 60 60)">${PENCIL}</g>`,
    art: '<g transform="rotate(-40 60 60)">'
      + '<path d="M84 46L108 60L84 74Z" fill="#ffe8cc" stroke="#e67700" stroke-width="3" stroke-linejoin="round"/>'
      + '<path d="M100 55L108 60L100 65Z" fill="#495057"/>'
      + '<rect x="26" y="46" width="58" height="28" fill="#fcc419" stroke="#e67700" stroke-width="3"/>'
      + line('M26 55H84M26 65H84', '#f59f00', 2)
      + '<rect x="12" y="46" width="16" height="28" rx="6" fill="#f783ac" stroke="#d6336c" stroke-width="3"/>'
      + '<rect x="24" y="46" width="8" height="28" fill="#adb5bd" stroke="#868e96" stroke-width="2"/>'
      + '</g>',
  },
  {
    id: 'loupe', name: 'Loupe', keywords: 'loupe, recherche, chercher, analyser, zoom, search',
    sil: '<circle cx="50" cy="50" r="32"/><path d="M74 74L100 100" fill="none" stroke-width="28"/>',
    art: line('M74 74L100 100', '#845ef7', 16)
      + '<circle cx="50" cy="50" r="30" fill="#d0ebff" stroke="#495057" stroke-width="8"/>'
      + shine('M34 46Q36 34 46 32'),
  },
  {
    id: 'cadeau', name: 'Cadeau', keywords: 'cadeau, surprise, anniversaire, bonus, récompense, gift',
    sil: '<rect x="20" y="52" width="80" height="52" rx="6"/><rect x="14" y="38" width="92" height="20" rx="6"/><path d="M60 38C50 20 30 22 34 32C36 38 48 38 60 38ZM60 38C70 20 90 22 86 32C84 38 72 38 60 38Z"/>',
    art: '<rect x="20" y="52" width="80" height="52" rx="6" fill="#9775fa" stroke="#7048e8" stroke-width="4"/>'
      + '<rect x="14" y="38" width="92" height="20" rx="6" fill="#b197fc" stroke="#7048e8" stroke-width="4"/>'
      + '<rect x="52" y="38" width="16" height="66" fill="#ffd43b"/>'
      + '<path d="M60 38C50 20 30 22 34 32C36 38 48 38 60 38ZM60 38C70 20 90 22 86 32C84 38 72 38 60 38Z" fill="#ffd43b" stroke="#f59f00" stroke-width="3" stroke-linejoin="round"/>',
  },
  {
    id: 'sac-argent', name: 'Sac d\'argent', keywords: 'argent, budget, euro, finance, économies, money',
    sil: '<path d="M42 30C30 44 18 62 18 80C18 98 36 106 60 106C84 106 102 98 102 80C102 62 90 44 78 30Z"/><path d="M44 30L38 16C50 20 70 20 82 16L76 30Z"/>',
    art: '<path d="M44 30L38 16C50 20 70 20 82 16L76 30Z" fill="#94d82d" stroke="#5c940d" stroke-width="3" stroke-linejoin="round"/>'
      + '<path d="M42 30C30 44 18 62 18 80C18 98 36 106 60 106C84 106 102 98 102 80C102 62 90 44 78 30Z" fill="#94d82d" stroke="#5c940d" stroke-width="4"/>'
      + '<rect x="40" y="27" width="40" height="8" rx="4" fill="#5c940d"/>'
      + label('€', 60, 74, 40, '#ffffff', 40),
  },
  {
    id: 'graphique-hausse', name: 'Graphique en hausse', keywords: 'graphique, hausse, croissance, progression, succès, statistiques, chart up',
    sil: CHART_CARD,
    art: chartArt([[28, 22], [50, 34], [72, 48]], '#40c057', 'M26 66L48 48L62 56L92 28', 'M77 27L93 27L93 43'),
  },
  {
    id: 'graphique-baisse', name: 'Graphique en baisse', keywords: 'graphique, baisse, chute, recul, perte, statistiques, chart down',
    sil: CHART_CARD,
    art: chartArt([[28, 48], [50, 34], [72, 22]], '#fa5252', 'M26 34L48 52L62 46L92 76', 'M77 77L93 77L93 61'),
  },
  {
    id: 'sourire', name: 'Sourire', keywords: 'sourire, content, heureux, joie, smiley, smile',
    sil: DISC,
    art: disc(...FACE_FILL)
      + `<ellipse cx="46" cy="50" rx="5" ry="7" fill="${INK}"/><ellipse cx="74" cy="50" rx="5" ry="7" fill="${INK}"/>`
      + line('M38 68Q60 92 82 68', INK, 6)
      + '<circle cx="32" cy="70" r="6" fill="#ff8787" opacity="0.6"/><circle cx="88" cy="70" r="6" fill="#ff8787" opacity="0.6"/>',
  },
  {
    id: 'triste', name: 'Triste', keywords: 'triste, déçu, larme, pleurer, chagrin, sad',
    sil: DISC,
    art: disc('#ffe066', '#f59f00')
      + `<ellipse cx="46" cy="54" rx="5" ry="6" fill="${INK}"/><ellipse cx="74" cy="54" rx="5" ry="6" fill="${INK}"/>`
      + line('M36 42L50 36M84 42L70 36', INK, 4) + line('M42 86Q60 70 78 86', INK, 6)
      + '<path d="M80 62C76 70 74 74 78 78C82 80 86 76 84 70Z" fill="#4dabf7"/>',
  },
  {
    id: 'etonne', name: 'Étonné', keywords: 'étonné, surprise, waouh, wow, choc, oh',
    sil: DISC,
    art: disc(...FACE_FILL)
      + `<circle cx="45" cy="50" r="9" fill="#ffffff" stroke="${INK}" stroke-width="3"/><circle cx="75" cy="50" r="9" fill="#ffffff" stroke="${INK}" stroke-width="3"/>`
      + `<circle cx="45" cy="51" r="4" fill="${INK}"/><circle cx="75" cy="51" r="4" fill="${INK}"/>`
      + line('M36 34Q45 28 54 33M66 33Q75 28 84 34', INK, 4)
      + `<ellipse cx="60" cy="81" rx="10" ry="13" fill="${INK}"/>`,
  },
  {
    id: 'amoureux', name: 'Amoureux', keywords: 'amoureux, adore, coup de coeur, yeux en coeur, love',
    sil: DISC,
    art: disc(...FACE_FILL)
      + heart(44, 50, 0.24, ' fill="#fa5252"') + heart(76, 50, 0.24, ' fill="#fa5252"')
      + `<path d="M38 68Q60 96 82 68Z" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`
      + '<path d="M50 80Q60 74 70 80Q66 86 60 86Q54 86 50 80Z" fill="#ff8787"/>',
  },
  {
    id: 'cool', name: 'Cool', keywords: 'cool, lunettes de soleil, classe, détendu, sunglasses',
    sil: DISC,
    art: disc(...FACE_FILL)
      + `<path d="M24 46H96V52C96 64 88 70 79 70C70 70 64 62 62 54H58C56 62 50 70 41 70C32 70 24 64 24 52Z" fill="${INK}"/>`
      + line('M32 52L38 50M70 52L76 50', '#ffffff', 3)
      + line('M46 84Q62 92 76 80', INK, 6),
  },
  {
    id: 'fete', name: 'Fête', keywords: 'fête, bravo, célébration, félicitations, cotillons, party',
    sil: '<path d="M18 104L40 48L74 82Z"/><circle cx="70" cy="30" r="6"/><circle cx="92" cy="48" r="6"/><circle cx="86" cy="22" r="5"/><circle cx="100" cy="72" r="5"/><path d="M54 40Q60 30 54 20M84 90Q94 84 104 90" fill="none"/>',
    art: '<path d="M18 104L40 48L74 82Z" fill="#9775fa" stroke="#7048e8" stroke-width="4" stroke-linejoin="round"/>'
      + line('M31 71L53 93M25 87L37 99', '#ffd43b', 5)
      + '<circle cx="70" cy="30" r="6" fill="#fa5252"/><circle cx="92" cy="48" r="6" fill="#4dabf7"/><circle cx="86" cy="22" r="5" fill="#fcc419"/><circle cx="100" cy="72" r="5" fill="#40c057"/>'
      + line('M54 40Q60 30 54 20', '#f783ac', 5) + line('M84 90Q94 84 104 90', '#20c997', 5),
  },
  {
    id: 'cent', name: 'Cent', keywords: '100, cent, parfait, score, top, cent pour cent',
    sil: label('100', 60, 52, 50, '', 92) + '<path d="M18 82Q60 74 102 82M26 96Q60 88 94 96" fill="none"/>',
    art: label('100', 60, 52, 50, '#fa5252', 92) + line('M18 82Q60 74 102 82M26 96Q60 88 94 96', '#fa5252', 7),
  },
  {
    id: 'badge-top', name: 'Top', keywords: 'top, badge, meilleur, excellent, génial',
    sil: `<polygon points="${starPoints(60, 60, 48, 40, 16)}"/>`,
    art: `<polygon points="${starPoints(60, 60, 48, 40, 16)}" fill="#fa5252" stroke="#c92a2a" stroke-width="3" stroke-linejoin="round"/>`
      + '<circle cx="60" cy="60" r="33" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="4 4" opacity="0.7"/>'
      + label('TOP', 60, 61, 30, '#ffffff', 58),
  },
  {
    id: 'badge-ok', name: 'OK', keywords: 'ok, badge, d\'accord, validé, oui',
    sil: PILL,
    art: pill('#40c057', '#2f9e44') + label('OK', 60, 61, 38, '#ffffff', 70),
  },
  {
    id: 'badge-nouveau', name: 'Nouveau', keywords: 'nouveau, new, badge, nouveauté, nouvelle',
    sil: `<polygon points="${starPoints(60, 60, 48, 40, 18)}"/>`,
    art: `<polygon points="${starPoints(60, 60, 48, 40, 18)}" fill="#fcc419" stroke="#f59f00" stroke-width="3" stroke-linejoin="round"/>`
      + label('NOUVEAU', 60, 61, 19, '#d9480f', 70, ' transform="rotate(-10 60 60)"'),
  },
  {
    id: 'badge-a-faire', name: 'À faire', keywords: 'à faire, todo, tâche, badge, liste',
    sil: PILL,
    art: pill('#ff922b', '#e8590c') + label('À FAIRE', 60, 61, 22, '#ffffff', 80),
  },
  {
    id: 'badge-en-cours', name: 'En cours', keywords: 'en cours, wip, progression, badge, avancement',
    sil: PILL,
    art: pill('#4dabf7', '#1c7ed6') + label('EN COURS', 60, 54, 20, '#ffffff', 80)
      + '<rect x="30" y="70" width="60" height="7" rx="3.5" fill="#ffffff" opacity="0.45"/><rect x="30" y="70" width="36" height="7" rx="3.5" fill="#ffffff"/>',
  },
  {
    id: 'badge-fait', name: 'Fait', keywords: 'fait, terminé, done, badge, validé, fini',
    sil: PILL,
    art: pill('#40c057', '#2f9e44') + line('M26 60L34 68L46 52', '#ffffff', 6) + label('FAIT', 76, 61, 24, '#ffffff', 52),
  },
  {
    id: 'badge-urgent', name: 'Urgent', keywords: 'urgent, priorité, asap, badge, important',
    sil: PILL,
    art: pill('#fa5252', '#e03131') + '<circle cx="32" cy="60" r="11" fill="#ffffff"/>'
      + label('!', 32, 61, 18, '#e03131', 12) + label('URGENT', 72, 61, 20, '#ffffff', 62),
  },
  {
    id: 'bulle-waouh', name: 'Bulle waouh', keywords: 'waouh, wow, bulle, génial, incroyable, bd',
    sil: `<polygon points="${starPoints(60, 60, 48, 36, 12, -75)}"/>`,
    art: `<polygon points="${starPoints(60, 60, 48, 36, 12, -75)}" fill="#ffd43b" stroke="#fa5252" stroke-width="4" stroke-linejoin="round"/>`
      + label('WAOUH', 60, 61, 22, '#e03131', 62, ' transform="rotate(-8 60 60)"'),
  },
  {
    id: 'bulle-question', name: 'Bulle question', keywords: 'bulle, question, dialogue, interrogation, discussion',
    sil: '<path d="M24 18H96A10 10 0 0 1 106 28V72A10 10 0 0 1 96 82H54L34 102L38 82H24A10 10 0 0 1 14 72V28A10 10 0 0 1 24 18Z"/>',
    art: '<path d="M24 18H96A10 10 0 0 1 106 28V72A10 10 0 0 1 96 82H54L34 102L38 82H24A10 10 0 0 1 14 72V28A10 10 0 0 1 24 18Z" fill="#ffffff" stroke="#4dabf7" stroke-width="5" stroke-linejoin="round"/>'
      + label('?', 60, 51, 50, '#1c7ed6', 40),
  },
  {
    id: 'fleche', name: 'Flèche', keywords: 'flèche, droite, suivant, direction, avancer, arrow',
    sil: '<path d="M14 46H66V24L106 60L66 96V74H14Z"/>',
    art: '<path d="M14 46H66V24L106 60L66 96V74H14Z" fill="#4dabf7" stroke="#1c7ed6" stroke-width="4" stroke-linejoin="round"/>',
  },
  {
    id: 'plante', name: 'Plante', keywords: 'plante, croissance, nature, vert, pousse, plant',
    sil: '<path d="M60 66C40 64 26 50 28 30C46 30 58 44 60 66ZM60 66C62 40 76 24 96 22C98 44 84 62 60 66ZM60 66C52 50 54 30 62 16C70 30 70 50 60 66Z"/><rect x="30" y="64" width="60" height="12" rx="4"/><path d="M34 70H86L80 104H40Z"/>',
    art: '<path d="M60 66C40 64 26 50 28 30C46 30 58 44 60 66Z" fill="#51cf66" stroke="#2f9e44" stroke-width="3"/>'
      + '<path d="M60 66C62 40 76 24 96 22C98 44 84 62 60 66Z" fill="#69db7c" stroke="#2f9e44" stroke-width="3"/>'
      + '<path d="M60 66C52 50 54 30 62 16C70 30 70 50 60 66Z" fill="#40c057" stroke="#2f9e44" stroke-width="3"/>'
      + line('M58 62L36 36M62 62L88 30', '#2f9e44', 2)
      + '<path d="M34 70H86L80 104H40Z" fill="#e8754a" stroke="#c0532f" stroke-width="4" stroke-linejoin="round"/>'
      + '<rect x="30" y="64" width="60" height="12" rx="4" fill="#d9480f" stroke="#c0532f" stroke-width="3"/>',
  },
  {
    id: 'soleil', name: 'Soleil', keywords: 'soleil, beau temps, été, météo, chaleur, sun',
    sil: `<polygon points="${starPoints(60, 60, 48, 34, 12)}"/>`,
    art: `<polygon points="${starPoints(60, 60, 48, 34, 12)}" fill="#ffa94d" stroke="#f76707" stroke-width="3" stroke-linejoin="round"/>`
      + '<circle cx="60" cy="60" r="28" fill="#ffd43b" stroke="#f59f00" stroke-width="3"/>'
      + `<circle cx="51" cy="56" r="3.5" fill="${INK}"/><circle cx="69" cy="56" r="3.5" fill="${INK}"/>`
      + line('M50 66Q60 75 70 66', INK, 3.5),
  },
  {
    id: 'nuage', name: 'Nuage', keywords: 'nuage, météo, cloud, ciel, gris',
    sil: `<path d="${CLOUD}"/>`,
    art: `<path d="${CLOUD}" fill="#ffffff" stroke="#74c0fc" stroke-width="5" stroke-linejoin="round"/>`
      + `<circle cx="50" cy="72" r="3.5" fill="${INK}"/><circle cx="72" cy="72" r="3.5" fill="${INK}"/>`
      + line('M56 80Q61 84 66 80', INK, 3)
      + '<circle cx="42" cy="80" r="4" fill="#ffc9c9"/><circle cx="80" cy="80" r="4" fill="#ffc9c9"/>',
  },
  {
    id: 'arc-en-ciel', name: 'Arc-en-ciel', keywords: 'arc-en-ciel, couleurs, météo, espoir, rainbow',
    sil: '<path d="M30 88A30 30 0 0 1 90 88" fill="none" stroke-width="48"/><ellipse cx="22" cy="92" rx="14" ry="10"/><ellipse cx="98" cy="92" rx="14" ry="10"/>',
    art: line('M16 88A44 44 0 0 1 104 88', '#fa5252', 7.5) + line('M23 88A37 37 0 0 1 97 88', '#ff922b', 7.5)
      + line('M30 88A30 30 0 0 1 90 88', '#fcc419', 7.5) + line('M37 88A23 23 0 0 1 83 88', '#40c057', 7.5)
      + line('M44 88A16 16 0 0 1 76 88', '#4dabf7', 7.5)
      + '<ellipse cx="22" cy="92" rx="14" ry="10" fill="#ffffff" stroke="#ced4da" stroke-width="3"/>'
      + '<ellipse cx="98" cy="92" rx="14" ry="10" fill="#ffffff" stroke="#ced4da" stroke-width="3"/>',
  },
  {
    id: 'eclair', name: 'Éclair', keywords: 'éclair, énergie, rapide, orage, flash, lightning',
    sil: '<path d="M70 10L28 64H55L46 106L92 48H64L78 10Z"/>',
    art: '<path d="M70 10L28 64H55L46 106L92 48H64L78 10Z" fill="#ffd43b" stroke="#f59f00" stroke-width="4" stroke-linejoin="round"/>',
  },
];

export const STICKERS = Object.freeze(STICKER_DEFS.map((def) => Object.freeze({
  id: def.id,
  name: def.name,
  keywords: Object.freeze(keywordList(def.keywords)),
  svg: (size) => wrapSticker(def.sil, def.art, size),
})));

const STICKERS_BY_ID = new Map(STICKERS.map((sticker) => [sticker.id, sticker]));

export function getSticker(id) {
  return STICKERS_BY_ID.get(id) || null;
}

export function stickerSvg(id, size) {
  const sticker = STICKERS_BY_ID.get(id);
  return sticker ? sticker.svg(size) : '';
}

export function searchStickers(query) {
  return rankedSearch(STICKERS, query, (sticker) => ({ name: sticker.name, keywords: sticker.keywords, extra: sticker.id }), STICKERS.length);
}

// ------------------------------------------------------------------- icons
// 24×24 line icons, drawn with stroke="currentColor" stroke-width="1.8"
// round caps/joins (same convention as core.js). Values are inner markup.
const PRINTER = '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6Z"/>';
const FACE = '<circle cx="12" cy="12" r="9"/>';
const FILE = '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z"/><path d="M14 3v5h5"/>';
const SHIELD = '<path d="M12 21s8-3.5 8-10V5l-8-3-8 3v6c0 6.5 8 10 8 10Z"/>';
const CLOUD_ICON = '<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 9Z"/>';

export const ICONS = Object.freeze({
  // Arrows and motion
  'arrow-up': '<path d="M12 19V5M5 12l7-7 7 7"/>',
  'arrow-down': '<path d="M12 5v14M5 12l7 7 7-7"/>',
  'arrow-left': '<path d="M19 12H5M12 5l-7 7 7 7"/>',
  'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
  'arrow-up-right': '<path d="M7 17 17 7M8 7h9v9"/>',
  'arrow-up-left': '<path d="M17 17 7 7M16 7H7v9"/>',
  'arrow-down-right': '<path d="m7 7 10 10M17 8v9H8"/>',
  'arrow-down-left': '<path d="M17 7 7 17M7 8v9h9"/>',
  'chevron-up': '<path d="m6 15 6-6 6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  collapse: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  'zoom-in': '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>',
  'zoom-out': '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>',
  'log-in': '<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/><path d="M3 12h11M10 8l4 4-4 4"/>',
  'log-out': '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5"/><path d="M9 12h12M17 8l4 4-4 4"/>',
  // Interface
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  'more-horizontal': '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
  'more-vertical': '<path d="M12 5h.01M12 12h.01M12 19h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  toggle: '<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="17" cy="12" r="3"/>',
  'toggle-off': '<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="7" cy="12" r="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 13.5a7 7 0 0 1 4 6.5"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4Z"/><path d="M10 21h4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z"/>',
  chat: '<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z"/>',
  'message-circle': '<path d="M21 12a9 9 0 0 1-13.2 8L3 21l1.1-4.6A9 9 0 1 1 21 12Z"/>',
  heart: '<path d="M12 20s-8-4.7-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.3 12 20 12 20Z"/>',
  star: '<polygon points="12 3 14.8 8.8 21 9.6 16.5 14 17.6 20.2 12 17.3 6.4 20.2 7.5 14 3 9.6 9.2 8.8"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.7-1.5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.8 3.7M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m3 3 18 18"/>',
  filter: '<path d="M3 4h18l-7 8.5V19l-4 2v-8.5Z"/>',
  sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  'x-circle': '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.5"/>',
  alert: '<path d="M10.3 4 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v5M12 17.5v.5"/>',
  'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
  edit: '<path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/>',
  link: '<path d="M9.5 14.5a4.2 4.2 0 0 0 6 0l3.2-3.2a4.2 4.2 0 0 0-6-6l-1.2 1.2"/><path d="M14.5 9.5a4.2 4.2 0 0 0-6 0l-3.2 3.2a4.2 4.2 0 0 0 6 6l1.2-1.2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 16V5M7 10l5-5 5 5M4 20h16"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
  save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
  print: PRINTER,
  maximize: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  minimize: '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>',
  // Time and places
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  timer: '<circle cx="12" cy="14" r="7"/><path d="M12 14v-4M10 3h4M19 6l-1.5 1.5"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
  'map-pin': '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  compass: '<circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5"/>',
  // Media
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5-9 9"/>',
  camera: '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="4"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 12h18M3 16h4M17 8h4M17 16h4"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
  headphones: '<path d="M4 17v-5a8 8 0 0 1 16 0v5"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  'volume-off': '<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="m17 9 5 5M22 9l-5 5"/>',
  play: '<polygon points="7 4 20 12 7 20"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  skip: '<polygon points="5 4 15 12 5 20"/><path d="M19 5v14"/>',
  'skip-back': '<polygon points="19 20 9 12 19 4"/><path d="M5 19V5"/>',
  // Files and data
  file: FILE,
  'file-text': `${FILE}<path d="M9 13h6M9 17h6"/>`,
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  book: '<path d="M5 4a1 1 0 0 1 1-1h13v15H6.5a1.5 1.5 0 0 0 0 3H19"/><path d="M5 4v15.5"/>',
  newspaper: '<path d="M4 5h13v13a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2Z"/><path d="M17 9h3v9a2 2 0 0 1-2 2"/><path d="M7 9h7M7 13h7M7 16h4"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  cloud: CLOUD_ICON,
  'cloud-upload': `${CLOUD_ICON}<path d="M12 16v-5M9.5 13.5 12 11l2.5 2.5"/>`,
  'cloud-download': `${CLOUD_ICON}<path d="M12 10v5M9.5 12.5 12 15l2.5-2.5"/>`,
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><path d="M12 19.5h.01"/>',
  bluetooth: '<path d="m7 7 10 10-5 4V3l5 4L7 17"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2M6 10v4M10 10v4"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
  smartphone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  tablet: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>',
  printer: PRINTER,
  qrcode: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h.01M17.5 21H21v-3.5"/>',
  // Commerce and money
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M12 8v13M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5M12 8s1.5-5 4-5a2.5 2.5 0 0 1 0 5"/>',
  'shopping-cart': '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h9.6a1 1 0 0 0 1-.8L21 7H6"/>',
  'credit-card': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  wallet: '<path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6"/><path d="M17 14h.01"/>',
  euro: '<path d="M18 6.5A7 7 0 1 0 18 17.5"/><path d="M4 10h10M4 14h10"/>',
  dollar: '<path d="M12 2v20M16.5 6.5C16 5 14.3 4.5 12 4.5c-2.6 0-4.5 1.2-4.5 3.3 0 4.7 9 2.6 9 7.4 0 2.1-2 3.3-4.5 3.3-2.3 0-4-.6-4.7-2.2"/>',
  package: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5Z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9M7.5 5.2l9 4.6"/>',
  truck: '<path d="M2 5h12v11H2ZM14 9h4l4 4v3h-8Z"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  receipt: '<path d="M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21l-2.4-1.5L5 21Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  calculator: '<rect x="5" y="2" width="14" height="20" rx="2"/><rect x="8" y="5" width="8" height="4" rx="0.5"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 17h.01M12 17h.01M15.5 17h.01"/>',
  // Charts and goals
  'chart-bar': '<path d="M3 21h18"/><rect x="5" y="11" width="3" height="7"/><rect x="10.5" y="6" width="3" height="12"/><rect x="16" y="13" width="3" height="5"/>',
  'chart-line': '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-6"/>',
  'chart-pie': '<path d="M12 3v9h9a9 9 0 1 1-9-9Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z"/>',
  'trending-up': '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  'trending-down': '<path d="m3 7 6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 13.8 7 22l5-3 5 3-1.5-8.2"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v4M9 18h6l1 3H8Z"/>',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5Z"/>',
  medal: '<path d="M8 3h8l-2 6h-4Z"/><circle cx="12" cy="15" r="6"/><path d="m12 12.5.8 1.7 1.8.2-1.3 1.2.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.2 1.8-.2Z"/>',
  // Nature and weather
  zap: '<polygon points="13 2 4 14 11 14 10 22 20 10 13 10"/>',
  fire: '<path d="M12 22c4 0 7-2.7 7-7 0-4.5-4-7-5-11-2 2-3 4-3 6-1-1-2-2-2-4-2 2-4 5-4 9 0 4.3 3 7 7 7Z"/><path d="M12 22c-1.7 0-3-1.3-3-3 0-2 1.5-3 3-5 1.5 2 3 3 3 5 0 1.7-1.3 3-3 3Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  'cloud-rain': '<path d="M7 15a4 4 0 0 1-.4-8A6 6 0 0 1 18 7.5a3.8 3.8 0 0 1-.5 7.5Z"/><path d="M8 18v2M12 17v4M16 18v2"/>',
  snowflake: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  umbrella: '<path d="M3 12a9 9 0 0 1 18 0Z"/><path d="M12 12v7a2 2 0 0 1-4 0M12 3V2"/>',
  droplet: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
  wind: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  thermometer: '<path d="M10 4a2 2 0 0 1 4 0v10.3a4 4 0 1 1-4 0Z"/><path d="M12 10v7"/>',
  leaf: '<path d="M5 19C5 9 11 4 20 4c0 9-5 15-15 15Z"/><path d="m5 19 8-8"/>',
  tree: '<path d="M12 2 5 11h4l-4 6h14l-4-6h4Z"/><path d="M12 17v5"/>',
  flower: '<circle cx="12" cy="9" r="1.6"/><circle cx="12" cy="5" r="2.2"/><circle cx="16" cy="9" r="2.2"/><circle cx="12" cy="13" r="2.2"/><circle cx="8" cy="9" r="2.2"/><path d="M12 15v7M12 20c-2 0-3.5-1-4-3M12 20c2 0 3.5-1 4-3"/>',
  mountain: '<path d="M2 20 9 7l4 7 2-3 7 9Z"/>',
  // Food
  coffee: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 2v3M12 2v3M3 22h16"/>',
  pizza: '<path d="M12 21 3 6a15 15 0 0 1 18 0Z"/><path d="M4.5 8.5a13 13 0 0 1 15 0"/><circle cx="10" cy="11" r="1"/><circle cx="14" cy="14" r="1"/>',
  apple: '<path d="M12 7c-2-1.5-7-1.5-7 4.5C5 17 8 21 10 21c1 0 1.2-.5 2-.5s1 .5 2 .5c2 0 5-4 5-9.5C19 5.5 14 5.5 12 7Z"/><path d="M12 7c0-2 1-4 3-4"/>',
  // Transport
  car: '<path d="M5 17H3v-5l2-5h14l2 5v5h-2"/><path d="M3 12h18M9 17h6"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 11h16M8 18v3M16 18v3M8 14.5h.01M16 14.5h.01"/>',
  plane: '<path d="M10.5 3.5a1.5 1.5 0 0 1 3 0V9l7.5 4.5v2L13.5 13v5l2.5 2v1.5L12 20.5l-4 1V20l2.5-2v-5L3 15.5v-2L10.5 9Z"/>',
  train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14M9 21l1.5-4M15 21l-1.5-4M9 13.5h.01M15 13.5h.01"/>',
  bike: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9h7l2.5 7.5M9 9l3.5 7.5H5.5M14 6h3l-1 3"/>',
  ship: '<path d="M3 15h18l-2.5 5h-13Z"/><path d="M6 15V9h12v6M12 9V4h4"/>',
  rocket: '<path d="M12 2c3 2 5 5.5 5 9.5V17H7v-5.5C7 7.5 9 4 12 2Z"/><circle cx="12" cy="10" r="2"/><path d="m7 13-3 3v3h3M17 13l3 3v3h-3M10 20l2 2 2-2"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 11h8M4 13a8 8 0 0 0 16 0"/>',
  // Buildings
  building: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10.5 21v-3h3v3"/>',
  factory: '<path d="M3 21V10l5 3v-3l5 3v-3l5 3V4h3v17Z"/><path d="M7 17h2M12 17h2"/>',
  store: '<path d="M3 9 5 4h14l2 5"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 11v10h14V11M10 21v-5h4v5"/>',
  school: '<path d="M4 21V10l8-5 8 5v11Z"/><path d="M10 21v-5h4v5M12 5V2h3M12 12.5h.01"/>',
  hospital: '<rect x="3" y="4" width="18" height="17" rx="1"/><path d="M12 8v6M9 11h6M9 21v-3h6v3"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12h18"/>',
  // Tools and creation
  tools: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V5h6v3M3 13h18M10 13v2M14 13v2"/>',
  hammer: '<rect x="12.5" y="3" width="5" height="12" rx="1" transform="rotate(-45 15 9)"/><path d="M13.2 10.8 4.5 19.5"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 1 5-1.3l-3 3 .3 2 2 .3 3-3a4 4 0 0 1-5.4 5L8 20a2 2 0 0 1-3-3l7.7-6.6a4 4 0 0 1 2-4.1Z"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 7.5 20 18M8.5 16.5 20 6"/>',
  paint: '<rect x="4" y="3" width="14" height="5" rx="1"/><path d="M18 5.5h2v5h-8v3"/><rect x="10.5" y="13.5" width="3" height="7" rx="1"/>',
  brush: '<path d="M20 4 10 14"/><path d="M10 14a3 3 0 0 0-4 1c-1 1.5 0 3-2 5 3 0 5.5-.5 7-2a3 3 0 0 0-1-4Z"/>',
  pen: '<path d="M12 21 6 13l2-8h8l2 8Z"/><path d="M12 21v-8M8 5V3h8v2"/><circle cx="12" cy="11" r="1.5"/>',
  pencil: '<path d="m4 20 1-5L16 4l4 4L9 19Z"/><path d="m14 6 4 4M4 20l5-1"/>',
  eraser: '<path d="m7 21-4-4a1.4 1.4 0 0 1 0-2L14 4a1.4 1.4 0 0 1 2 0l5 5a1.4 1.4 0 0 1 0 2L11 21Z"/><path d="M8.5 9.5l6 6M11 21h10"/>',
  highlighter: '<path d="m9 11-5 5v3h5l5-5"/><path d="m9 11 7-7 5 5-7 7Z"/><path d="M3 22h7"/>',
  ruler: '<rect x="2" y="8" width="20" height="8" rx="1"/><path d="M6 8v3M10 8v4M14 8v3M18 8v4"/>',
  scale: '<path d="M12 3v18M7 21h10M4 7h16M4 7l-2.5 6a2.5 2.5 0 0 0 5 0ZM20 7l-2.5 6a2.5 2.5 0 0 0 5 0Z"/>',
  magnet: '<path d="M5 3h4v8a3 3 0 0 0 6 0V3h4v8a7 7 0 0 1-14 0Z"/><path d="M5 7h4M15 7h4"/>',
  plug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0Z"/><path d="M12 17v5"/>',
  // Layout and organisation
  layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14.5h18M9 9v11M15 9v11"/>',
  frame: '<path d="M7 3v18M17 3v18M3 7h18M3 17h18"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  checklist: '<path d="m3 6 2 2 3-3M3 13l2 2 3-3M11 6h10M11 13h10M11 20h10M4 20h.01"/>',
  kanban: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v7M12 7v4M16 7v10"/>',
  'git-branch': '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9a6 6 0 0 1-6 6H6"/>',
  puzzle: '<path d="M4 7h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4h-4a2 2 0 1 0-4 0H4v-4a2 2 0 1 0 0-4Z"/>',
  'sticky-note': '<path d="M4 4h16v10l-6 6H4Z"/><path d="M14 20v-6h6"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3Z"/><path d="M12 13v8"/>',
  paperclip: '<path d="M20 11.5 12.5 19a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7l-7.4 7.4a1.7 1.7 0 0 1-2.3-2.3L15 7.5"/>',
  inbox: '<path d="M3 13h5l1.5 3h5l1.5-3h5"/><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Z"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4Z"/>',
  // Typography
  type: '<path d="M5 7V4h14v3M12 4v16M9 20h6"/>',
  bold: '<path d="M7 4h6a4 4 0 0 1 0 8H7ZM7 12h7a4 4 0 0 1 0 8H7Z"/>',
  italic: '<path d="M10 4h8M6 20h8M14 4l-4 16"/>',
  underline: '<path d="M7 4v6a5 5 0 0 0 10 0V4M5 21h14"/>',
  'align-left': '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  'align-center': '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  'align-right': '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  quote: '<path d="M4 11h5v6H4v-6Zm0 0c0-3 1-5 4-6M14 11h5v6h-5v-6Zm0 0c0-3 1-5 4-6"/>',
  // Ideas, feelings and people
  lightbulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1v2h5v-2c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z"/>',
  brain: '<path d="M12 5a3 3 0 0 0-5.6-1.5A3 3 0 0 0 4 8a3 3 0 0 0 0 5 3 3 0 0 0 2 4.5A3 3 0 0 0 12 19Z"/><path d="M12 5a3 3 0 0 1 5.6-1.5A3 3 0 0 1 20 8a3 3 0 0 1 0 5 3 3 0 0 1-2 4.5A3 3 0 0 1 12 19Z"/>',
  smile: `${FACE}<path d="M8 14a4.5 4.5 0 0 0 8 0M9 9.5h.01M15 9.5h.01"/>`,
  frown: `${FACE}<path d="M8 16.5a4.5 4.5 0 0 1 8 0M9 9.5h.01M15 9.5h.01"/>`,
  meh: `${FACE}<path d="M8.5 15h7M9 9.5h.01M15 9.5h.01"/>`,
  'thumbs-up': '<path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"/><path d="m7 10 4-8a2.5 2.5 0 0 1 3 3l-1 4h6a2 2 0 0 1 2 2.3l-1.3 7.7a2 2 0 0 1-2 1.7H7"/>',
  'thumbs-down': '<path d="M7 14V3H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1Z"/><path d="m7 14 4 8a2.5 2.5 0 0 0 3-3l-1-4h6a2 2 0 0 0 2-2.3l-1.3-7.7a2 2 0 0 0-2-1.7H7"/>',
  hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 10V3.5a1.5 1.5 0 0 1 3 0V10M14 10V5a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3 14.5a1.5 1.5 0 0 1 2.5-1.7L8 15"/>',
  handshake: '<path d="m11 17 2 2a1.4 1.4 0 0 0 2-2"/><path d="m13 15 2.5 2.5a1.4 1.4 0 0 0 2-2L14 12l-1.5 1.5a2 2 0 0 1-3-3L13 7l3 1 3-1 3 5-3 3"/><path d="m2 12 3-5 4 1M5 15l4 4a1.4 1.4 0 0 0 2-2"/>',
  megaphone: '<path d="M3 10v4a1 1 0 0 0 1 1h3l9 5V4L7 9H4a1 1 0 0 0-1 1Z"/><path d="M19 9a3 3 0 0 1 0 6M7 15l1 5h3l-1-4.5"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  'at-sign': '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  infinity: '<path d="M12 12c-2-2.7-4-4-6-4a4 4 0 0 0 0 8c2 0 4-1.3 6-4Zm0 0c2 2.7 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.3-6 4Z"/>',
  sparkles: '<path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8Z"/><path d="m18 14 .9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9Z"/>',
  shield: SHIELD,
  'shield-check': `${SHIELD}<path d="m9 11.5 2 2 4-4"/>`,
  bug: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 11v9M9 7a3 3 0 0 1 6 0M3 13h4M17 13h4M4 8l3 2M20 8l-3 2M4 19l3-2M20 19l-3-2"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>',
  atom: '<circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>',
  dna: '<path d="M7 2c0 5 10 5 10 10S7 17 7 22M17 2c0 5-10 5-10 10s10 5 10 10M9 4.5h6M9 19.5h6M10 12h4"/>',
  graduation: '<path d="M2 10 12 5l10 5-10 5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5M22 10v5"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 21 9.8C21 6 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  loader: '<path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  glasses: '<circle cx="6.5" cy="15" r="3.5"/><circle cx="17.5" cy="15" r="3.5"/><path d="M10 15a2 2 0 0 1 4 0M3 15l1.5-8H7M21 15l-1.5-8H17"/>',
  ticket: '<path d="M3 7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4Z"/><path d="M14 6v2M14 11v2M14 16v2"/>',
  // Shapes
  circle: '<circle cx="12" cy="12" r="9"/>',
  square: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  triangle: '<path d="M12 3 22 20H2Z"/>',
  diamond: '<path d="M12 2 22 12 12 22 2 12Z"/>',
  hexagon: '<path d="M12 2 21 7v10l-9 5-9-5V7Z"/>',
  cursor: '<path d="M5 3l14 7-6 2-2 6Z"/><path d="m13 12 6 6"/>',
});

const ICON_KEYWORD_SOURCE = {
  'arrow-up': 'flèche, haut, monter, up',
  'arrow-down': 'flèche, bas, descendre, down',
  'arrow-left': 'flèche, gauche, retour, précédent, left',
  'arrow-right': 'flèche, droite, suivant, right',
  'arrow-up-right': 'flèche, diagonale, haut droite, hausse',
  'arrow-up-left': 'flèche, diagonale, haut gauche',
  'arrow-down-right': 'flèche, diagonale, bas droite, baisse',
  'arrow-down-left': 'flèche, diagonale, bas gauche',
  'chevron-up': 'chevron, haut, replier',
  'chevron-down': 'chevron, bas, déplier, menu déroulant',
  'chevron-left': 'chevron, gauche, précédent',
  'chevron-right': 'chevron, droite, suivant',
  refresh: 'actualiser, rafraîchir, recharger, synchroniser, refresh',
  undo: 'annuler, défaire, retour, undo',
  redo: 'rétablir, refaire, redo',
  expand: 'agrandir, déplier, plein écran, expand',
  collapse: 'réduire, replier, rétrécir, collapse',
  move: 'déplacer, bouger, glisser, move',
  'zoom-in': 'zoom, agrandir, loupe, plus',
  'zoom-out': 'zoom, réduire, loupe, moins',
  'log-in': 'connexion, entrer, se connecter, login',
  'log-out': 'déconnexion, sortir, se déconnecter, logout',
  home: 'maison, accueil, domicile, home',
  menu: 'menu, hamburger, navigation',
  'more-horizontal': 'plus, options, points de suspension, more',
  'more-vertical': 'plus, options, kebab, more',
  search: 'recherche, chercher, loupe, trouver, search',
  settings: 'réglages, paramètres, engrenage, configuration, settings',
  sliders: 'réglages, curseurs, ajuster, filtres, sliders',
  toggle: 'interrupteur, activer, actif, toggle',
  'toggle-off': 'interrupteur, désactiver, inactif, toggle',
  user: 'utilisateur, personne, profil, compte, user',
  users: 'utilisateurs, équipe, groupe, personnes, users',
  bell: 'cloche, notification, alerte, rappel, bell',
  mail: 'courrier, e-mail, message, enveloppe, mail',
  phone: 'téléphone, appel, contact, phone',
  chat: 'discussion, message, commentaire, bulle, chat',
  'message-circle': 'message, bulle, discussion, commentaire',
  heart: 'coeur, amour, favori, j\'aime, like',
  star: 'étoile, favori, note, star',
  bookmark: 'marque-page, signet, favori, bookmark',
  flag: 'drapeau, signaler, jalon, flag',
  tag: 'étiquette, tag, prix, catégorie',
  lock: 'cadenas, verrouillé, sécurité, privé, lock',
  unlock: 'cadenas, déverrouillé, ouvert, unlock',
  key: 'clé, accès, mot de passe, key',
  eye: 'oeil, voir, visible, afficher, eye',
  'eye-off': 'oeil barré, masquer, caché, invisible',
  filter: 'filtre, entonnoir, trier, filter',
  sort: 'trier, ordre, classement, sort',
  plus: 'plus, ajouter, nouveau, add',
  minus: 'moins, retirer, soustraire',
  x: 'croix, fermer, supprimer, annuler, close',
  check: 'coche, valider, ok, fait, check',
  'check-circle': 'coche, validé, succès, ok',
  'x-circle': 'croix, erreur, échec, refusé',
  info: 'information, info, aide, détail',
  help: 'aide, question, interrogation, help',
  alert: 'alerte, attention, avertissement, danger, warning',
  'alert-circle': 'alerte, erreur, attention',
  ban: 'interdit, bloqué, défendu, ban',
  trash: 'corbeille, poubelle, supprimer, effacer, trash',
  edit: 'modifier, éditer, crayon, edit',
  copy: 'copier, dupliquer, copy',
  clipboard: 'presse-papiers, coller, clipboard',
  link: 'lien, url, chaîne, link',
  external: 'lien externe, ouvrir, nouvel onglet, external',
  download: 'télécharger, téléchargement, download',
  upload: 'téléverser, envoyer, importer, upload',
  share: 'partager, partage, share',
  save: 'enregistrer, sauvegarder, disquette, save',
  print: 'imprimer, impression, print',
  maximize: 'agrandir, plein écran, maximiser',
  minimize: 'réduire, minimiser, quitter plein écran',
  calendar: 'calendrier, date, agenda, planning, calendar',
  clock: 'horloge, heure, temps, clock',
  timer: 'minuteur, chronomètre, compte à rebours, timer',
  hourglass: 'sablier, attente, temps',
  'map-pin': 'épingle, lieu, localisation, adresse, carte',
  map: 'carte, plan, itinéraire, map',
  globe: 'globe, monde, internet, web, langue',
  compass: 'boussole, direction, navigation, explorer',
  image: 'image, photo, illustration, picture',
  camera: 'appareil photo, photo, caméra, camera',
  video: 'vidéo, caméra, film, video',
  film: 'film, cinéma, pellicule, vidéo',
  music: 'musique, note, son, music',
  mic: 'micro, microphone, voix, enregistrer',
  headphones: 'casque, écouter, audio, musique',
  volume: 'volume, son, haut-parleur, audio',
  'volume-off': 'muet, silence, son coupé',
  play: 'lecture, jouer, démarrer, play',
  pause: 'pause, attente',
  stop: 'arrêt, stop',
  skip: 'suivant, passer, avancer, skip',
  'skip-back': 'précédent, reculer, retour',
  file: 'fichier, document, page, file',
  'file-text': 'fichier texte, document, note',
  folder: 'dossier, répertoire, classement, folder',
  archive: 'archive, archiver, boîte, ranger',
  book: 'livre, lecture, documentation, book',
  newspaper: 'journal, actualité, presse, article, news',
  code: 'code, développement, programmation, balise',
  terminal: 'terminal, console, ligne de commande, shell',
  database: 'base de données, stockage, données, database',
  server: 'serveur, hébergement, infrastructure, server',
  cloud: 'nuage, cloud, en ligne',
  'cloud-upload': 'nuage, envoyer, téléverser, sauvegarde en ligne',
  'cloud-download': 'nuage, télécharger, récupérer',
  wifi: 'wifi, réseau, connexion, internet, sans fil',
  bluetooth: 'bluetooth, sans fil, appairage',
  battery: 'batterie, pile, énergie, charge',
  cpu: 'processeur, puce, cpu, matériel',
  monitor: 'écran, moniteur, ordinateur, desktop',
  laptop: 'ordinateur portable, laptop, pc',
  smartphone: 'smartphone, téléphone, mobile, portable',
  tablet: 'tablette, ipad, écran',
  keyboard: 'clavier, saisie, taper, raccourci',
  mouse: 'souris, clic, pointeur',
  printer: 'imprimante, imprimer, printer',
  qrcode: 'qr code, code-barres, scanner',
  gift: 'cadeau, surprise, anniversaire, gift',
  'shopping-cart': 'panier, caddie, achat, courses, cart',
  'credit-card': 'carte bancaire, paiement, carte de crédit',
  wallet: 'portefeuille, argent, wallet',
  euro: 'euro, argent, prix, monnaie, €',
  dollar: 'dollar, argent, prix, monnaie, $',
  package: 'colis, paquet, livraison, boîte',
  truck: 'camion, livraison, transport',
  receipt: 'reçu, facture, ticket de caisse',
  calculator: 'calculatrice, calcul, compter',
  'chart-bar': 'graphique, barres, histogramme, statistiques',
  'chart-line': 'graphique, courbe, évolution, statistiques',
  'chart-pie': 'graphique, camembert, secteurs, répartition',
  'trending-up': 'tendance, hausse, croissance, progression',
  'trending-down': 'tendance, baisse, déclin, recul',
  target: 'cible, objectif, but, focus, target',
  award: 'récompense, prix, distinction, médaille, award',
  trophy: 'trophée, coupe, victoire, gagnant, trophy',
  crown: 'couronne, roi, reine, premium, crown',
  medal: 'médaille, récompense, gagnant',
  zap: 'éclair, énergie, rapide, flash, zap',
  fire: 'feu, flamme, tendance, chaud, fire',
  sun: 'soleil, jour, clair, été, sun',
  moon: 'lune, nuit, sombre, mode sombre, moon',
  'cloud-rain': 'pluie, nuage, météo, averse',
  snowflake: 'flocon, neige, hiver, froid',
  umbrella: 'parapluie, pluie, protection',
  droplet: 'goutte, eau, liquide',
  wind: 'vent, air, météo',
  thermometer: 'thermomètre, température, chaleur',
  leaf: 'feuille, nature, écologie, plante',
  tree: 'arbre, sapin, forêt, nature',
  flower: 'fleur, nature, printemps, jardin',
  mountain: 'montagne, sommet, paysage',
  coffee: 'café, pause, tasse, boisson, coffee',
  pizza: 'pizza, repas, nourriture',
  apple: 'pomme, fruit, nourriture',
  car: 'voiture, auto, transport, car',
  bus: 'bus, autobus, transport',
  plane: 'avion, vol, voyage, plane',
  train: 'train, gare, transport',
  bike: 'vélo, bicyclette, cyclisme, bike',
  ship: 'bateau, navire, mer',
  rocket: 'fusée, lancement, décollage, startup',
  anchor: 'ancre, marine, port',
  building: 'immeuble, bâtiment, bureau, entreprise',
  factory: 'usine, industrie, production',
  store: 'magasin, boutique, commerce',
  school: 'école, éducation, classe',
  hospital: 'hôpital, santé, médical',
  briefcase: 'mallette, travail, business, porte-documents',
  tools: 'outils, boîte à outils, maintenance',
  hammer: 'marteau, construction, outil',
  wrench: 'clé, réparer, réglage, outil',
  scissors: 'ciseaux, couper, découper',
  paint: 'peinture, rouleau, repeindre',
  brush: 'pinceau, peinture, dessin',
  pen: 'stylo, plume, signer, écrire',
  pencil: 'crayon, écrire, dessiner, modifier',
  eraser: 'gomme, effacer',
  highlighter: 'surligneur, surligner, marquer',
  ruler: 'règle, mesure, dimension',
  scale: 'balance, justice, équilibre, comparer',
  magnet: 'aimant, attraction, magnétisme',
  plug: 'prise, brancher, électricité, plugin',
  layers: 'calques, couches, empiler, layers',
  layout: 'mise en page, disposition, gabarit, layout',
  grid: 'grille, tableau, galerie, grid',
  columns: 'colonnes, diviser, deux colonnes',
  table: 'tableau, tableur, cellules',
  frame: 'cadre, plan de travail, frame',
  crop: 'rogner, recadrer, crop',
  list: 'liste, éléments, puces',
  checklist: 'liste de tâches, à faire, todo, checklist',
  kanban: 'kanban, tableau, colonnes, projet',
  'git-branch': 'branche, git, version, embranchement',
  puzzle: 'puzzle, pièce, extension, solution',
  'sticky-note': 'post-it, note, pense-bête, sticky',
  pin: 'punaise, épingler, fixer, pin',
  paperclip: 'trombone, pièce jointe, attacher',
  inbox: 'boîte de réception, courrier, inbox',
  send: 'envoyer, avion en papier, send',
  type: 'texte, typographie, police',
  bold: 'gras, texte, bold',
  italic: 'italique, texte, italic',
  underline: 'souligné, texte, underline',
  'align-left': 'aligner à gauche, texte',
  'align-center': 'centrer, aligner, texte',
  'align-right': 'aligner à droite, texte',
  quote: 'citation, guillemets, quote',
  lightbulb: 'ampoule, idée, inspiration, lightbulb',
  brain: 'cerveau, réflexion, intelligence, brainstorming',
  smile: 'sourire, content, heureux, smiley',
  frown: 'triste, mécontent, déçu',
  meh: 'neutre, bof, mitigé',
  'thumbs-up': 'pouce levé, j\'aime, ok, approuver, like',
  'thumbs-down': 'pouce baissé, je n\'aime pas, désapprouver, dislike',
  hand: 'main, stop, salut, lever la main',
  handshake: 'poignée de main, accord, partenariat, deal',
  megaphone: 'mégaphone, annonce, communication, marketing',
  rss: 'rss, flux, abonnement',
  'at-sign': 'arobase, mention, e-mail, @',
  hash: 'dièse, hashtag, numéro, #',
  percent: 'pourcentage, remise, taux, %',
  infinity: 'infini, illimité, boucle',
  sparkles: 'étincelles, magie, nouveau, ia, sparkles',
  shield: 'bouclier, sécurité, protection',
  'shield-check': 'bouclier, sécurisé, vérifié, protection',
  bug: 'bug, bogue, insecte, erreur',
  flask: 'fiole, expérience, laboratoire, test',
  atom: 'atome, science, physique',
  dna: 'adn, génétique, biologie',
  graduation: 'diplôme, formation, études, toque',
  palette: 'palette, couleurs, peinture, design',
  loader: 'chargement, en cours, attente, loader',
  power: 'alimentation, marche, arrêt, power',
  glasses: 'lunettes, lecture, vue',
  ticket: 'billet, ticket, événement',
  circle: 'cercle, rond, forme',
  square: 'carré, forme, rectangle',
  triangle: 'triangle, forme',
  diamond: 'losange, forme, diamant',
  hexagon: 'hexagone, forme',
  cursor: 'curseur, pointeur, sélection, souris',
};

export const ICON_KEYWORDS = Object.freeze(Object.fromEntries(
  Object.keys(ICONS).map((name) => [name, Object.freeze(keywordList(ICON_KEYWORD_SOURCE[name]))]),
));

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

// Accepts only plain colour values so the result can be dropped into markup.
const COLOR_PATTERNS = [
  /^currentcolor$/i,
  /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  /^rgba?\(\s*\d{1,3}(?:\.\d+)?%?(?:\s*,\s*|\s+)\d{1,3}(?:\.\d+)?%?(?:\s*,\s*|\s+)\d{1,3}(?:\.\d+)?%?(?:\s*[,/]\s*(?:\d*\.?\d+%?))?\s*\)$/i,
  /^hsla?\(\s*\d{1,3}(?:\.\d+)?(?:deg)?(?:\s*,\s*|\s+)\d{1,3}(?:\.\d+)?%(?:\s*,\s*|\s+)\d{1,3}(?:\.\d+)?%(?:\s*[,/]\s*(?:\d*\.?\d+%?))?\s*\)$/i,
];

export function isSafeColor(color) {
  return typeof color === 'string' && color.length <= 64 && COLOR_PATTERNS.some((re) => re.test(color.trim()));
}

export function iconSvg(name, size = 24, color = 'currentColor') {
  const inner = Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : null;
  if (inner === null) return '';
  const n = Number(size);
  const px = Number.isFinite(n) && n > 0 ? r1(Math.min(n, 4096)) : 24;
  const stroke = isSafeColor(color) ? color.trim() : 'currentColor';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export function searchIcons(query) {
  return rankedSearch(ICON_NAMES, query, (name) => ({ name, keywords: ICON_KEYWORDS[name] }), ICON_NAMES.length);
}
