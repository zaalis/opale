'use strict';

// Model Context Protocol endpoint (Streamable HTTP, JSON responses). This is
// the route an assistant uses to work in the vault: read, write, reorganise,
// search. Every tool goes through the Vault class, so path safety, the link
// index and the live interface all stay consistent with what the agent does.
const Meta = require('../shared/meta.js');
const Board = require('../shared/board.js');
const { search } = require('./search.js');
const { VaultError, cleanRelative } = require('./vault.js');

const PROTOCOL_VERSION = '2025-03-26';
const MAX_NOTE_CHARS = 200000;

function text(value) { return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }; }
function fail(message) { return { content: [{ type: 'text', text: message }], isError: true }; }

function needVault(app) {
  if (!app.vault) throw new VaultError('Aucun coffre n’est ouvert dans Opale. Ouvrez un coffre dans l’application.', 409, 'no-vault');
  return app.vault;
}
function requireString(args, key) {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new VaultError(`Paramètre « ${key} » requis.`);
  return value;
}
// An existing file, found by exact path, path without ".md", or note name.
function existing(vault, reference) {
  const found = vault.locate(reference);
  if (!found || vault.isFolder(found)) throw new VaultError(`Note introuvable : « ${reference} ». Utilisez list_files ou search pour trouver le bon chemin.`, 404, 'missing');
  return found;
}
// Where a note should live: the existing file if there is one, otherwise the
// given path with ".md" added when no extension was supplied.
function notePath(vault, reference) {
  const raw = String(reference).replace(/\\/g, '/').replace(/^\/+/, '').trim();
  const maps = vault._lowerMaps();
  for (const candidate of [raw, `${raw}.md`]) if (maps.files.has(candidate.toLowerCase())) return maps.files.get(candidate.toLowerCase());
  const clean = cleanRelative(raw);
  return /\.[A-Za-z0-9]{1,8}$/.test(Meta.baseName(clean)) ? clean : `${clean}.md`;
}
// A moodboard path: the existing file, or the given path with ".canvas".
function boardPath(vault, reference, mustExist) {
  const raw = String(reference).replace(/\\/g, '/').replace(/^\/+/, '').trim();
  const maps = vault._lowerMaps();
  for (const candidate of [raw, `${raw}.canvas`]) if (maps.files.has(candidate.toLowerCase())) return maps.files.get(candidate.toLowerCase());
  if (mustExist) throw new VaultError(`Moodboard introuvable : « ${reference} ».`, 404, 'missing');
  const clean = cleanRelative(raw);
  if (/\.[A-Za-z0-9]{1,8}$/.test(Meta.baseName(clean)) && Meta.kindOf(clean) !== 'board') throw new VaultError('Un moodboard est un fichier « .canvas ».');
  return Meta.kindOf(clean) === 'board' ? clean : `${clean}.canvas`;
}

// One element from the simple description an assistant gives.
function boardItem(item, vault) {
  const value = item && typeof item === 'object' ? item : {};
  const kind = String(value.kind || value.type || 'sticky');
  const textOf = String(value.text == null ? '' : value.text);
  const size = (el) => { if (typeof value.w === 'number') el.w = Math.max(20, value.w); if (typeof value.h === 'number') el.h = Math.max(20, value.h); return el; };
  const style = {};
  if (value.color) { const colour = Board.color(value.color); if (colour) style[kind === 'text' ? 'color' : kind === 'card' ? 'accent' : 'fill'] = colour; }
  const fileRef = () => {
    const found = value.file ? vault.locate(String(value.file)) : null;
    if (!found || vault.isFolder(found)) throw new VaultError(`Fichier introuvable dans le coffre : « ${value.file || ''} ».`, 404, 'missing');
    return found;
  };
  switch (kind) {
    case 'sticky': case 'text': case 'mdcard': return size(Board.create(kind, { style, data: { text: textOf } }));
    case 'shape': return size(Board.create('shape', { style, data: { text: textOf, shape: String((value.data && value.data.shape) || value.shape || 'rect') } }));
    case 'card': return size(Board.create('card', { style, data: { title: String(value.title || textOf), description: String(value.description || ''), assignee: String(value.assignee || ''), due: String(value.due || ''), status: value.status, points: String(value.points || ''), tags: Array.isArray(value.tags) ? value.tags : [] } }));
    case 'image': return size(Board.create('image', { data: { file: fileRef() } }));
    case 'note': return size(Board.create('note', { data: { file: fileRef() } }));
    case 'link': return size(Board.create('link', { data: { url: String(value.url || textOf), title: String(value.title || '') } }));
    case 'frame': return size(Board.create('frame', { style, data: { title: String(value.title || textOf || 'Cadre') } }));
    case 'code': return size(Board.create('code', { data: { code: textOf, lang: String(value.lang || '') } }));
    case 'table': return size(Board.create('table', { data: { rows: Array.isArray(value.rows) ? value.rows : [[textOf]] } }));
    case 'mindmap': {
      const tree = (node) => ({ text: String((node && node.text) || ''), children: (node && Array.isArray(node.children) ? node.children : []).map(tree) });
      return size(Board.create('mindmap', { data: { root: tree({ text: textOf || value.title || 'Idée centrale', children: value.children }) } }));
    }
    case 'kanban': {
      const columns = (Array.isArray(value.columns) ? value.columns : []).map((column) => ({ title: String((column && column.title) || ''), cards: (column && Array.isArray(column.cards) ? column.cards : []).map((card) => ({ text: String(card && typeof card === 'object' ? card.text || '' : card) })) }));
      return size(Board.create('kanban', { data: { title: String(value.title || 'Kanban'), columns } }));
    }
    default: throw new VaultError(`Type d’élément inconnu : « ${kind} ».`);
  }
}

function clip(content) {
  return content.length > MAX_NOTE_CHARS ? `${content.slice(0, MAX_NOTE_CHARS)}\n\n[… contenu tronqué : ${content.length - MAX_NOTE_CHARS} caractères restants]` : content;
}

function moveOne(vault, fromRef, toRef) {
  const from = vault.locate(fromRef);
  if (!from) throw new VaultError(`Introuvable : « ${fromRef} ».`, 404, 'missing');
  let to = String(toRef).replace(/\\/g, '/').replace(/^\/+/, '').trim();
  const intoFolder = to.endsWith('/') || vault.isFolder(to.replace(/\/+$/, ''));
  to = to.replace(/\/+$/, '');
  if (intoFolder) to = Meta.joinPath(to, Meta.baseName(from));
  else if (!vault.isFolder(from) && !Meta.extOf(to) && Meta.extOf(from)) to = `${to}.${Meta.extOf(from)}`;
  return vault.rename(from, to);
}

const TOOLS = [
  {
    name: 'vault_info',
    description: 'Vue d’ensemble du coffre ouvert dans Opale : nombre de notes, dossiers, notes orphelines, liens non résolus, notes les plus liées, étiquettes, notes récentes. À appeler en premier pour analyser ou réorganiser le coffre.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (args, app) => text(needVault(app).overview()),
  },
  {
    name: 'list_files',
    description: 'Liste les fichiers et sous-dossiers d’un dossier du coffre. Sans « folder », liste la racine.',
    inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Dossier relatif au coffre (vide = racine).' }, recursive: { type: 'boolean', description: 'Inclure tous les sous-dossiers.' }, notes_only: { type: 'boolean' } }, additionalProperties: false },
    run: (args, app) => {
      const vault = needVault(app);
      const folder = args.folder ? vault.canonical(cleanRelative(String(args.folder), { allowRoot: true })) : '';
      if (folder && !vault.isFolder(folder)) throw new VaultError(`Dossier introuvable : « ${folder} ».`, 404, 'missing');
      const prefix = folder ? `${folder}/` : '';
      const inside = (file) => file.startsWith(prefix) && (args.recursive || !file.slice(prefix.length).includes('/'));
      const folders = [...vault.folders].filter(inside).sort().map((value) => `${value}/`);
      const files = [...vault.files.values()].filter((entry) => inside(entry.path) && (!args.notes_only || entry.kind === 'note')).map((entry) => entry.path).sort();
      const shown = [...folders, ...files];
      return text(shown.length ? `${shown.length} élément(s) dans « ${folder || '/'} » :\n${shown.slice(0, 2000).join('\n')}${shown.length > 2000 ? `\n… ${shown.length - 2000} de plus` : ''}` : `« ${folder || '/'} » est vide.`);
    },
  },
  {
    name: 'read_note',
    description: 'Lit le contenu Markdown d’une note. « path » accepte un chemin (Projets/Idée.md) ou un simple nom de note (Idée).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    run: (args, app) => {
      const vault = needVault(app);
      const file = existing(vault, requireString(args, 'path'));
      const note = vault.read(file);
      const entry = vault.files.get(file);
      const header = `Chemin : ${file}${entry && entry.meta ? ` · ${entry.meta.words} mots · étiquettes : ${entry.meta.tags.map((tag) => '#' + tag).join(' ') || 'aucune'}` : ''}`;
      return text(`${header}\n\n${clip(note.content)}`);
    },
  },
  {
    name: 'write_note',
    description: 'Crée une note ou remplace entièrement son contenu. Les dossiers manquants sont créés. Utilisez [[Nom de note]] pour lier des notes et #étiquette pour les étiquettes.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Chemin relatif au coffre, « .md » ajouté si absent.' }, content: { type: 'string' }, overwrite: { type: 'boolean', description: 'false pour refuser d’écraser une note existante (défaut : true).' } }, required: ['path', 'content'], additionalProperties: false },
    run: (args, app) => {
      const vault = needVault(app);
      const file = notePath(vault, requireString(args, 'path'));
      const existed = vault.files.has(file);
      const entry = vault.write(file, String(args.content == null ? '' : args.content), { createOnly: args.overwrite === false });
      app.activity({ tool: 'write_note', path: entry.path });
      return text(`${existed ? 'Note mise à jour' : 'Note créée'} : ${entry.path}`);
    },
  },
  {
    name: 'append_to_note',
    description: 'Ajoute du texte à la fin d’une note (créée si besoin), ou à la fin de la section « heading » si ce titre est fourni.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, heading: { type: 'string', description: 'Titre de section sous lequel insérer (facultatif).' } }, required: ['path', 'content'], additionalProperties: false },
    run: (args, app) => {
      const vault = needVault(app);
      const file = notePath(vault, requireString(args, 'path'));
      const addition = String(args.content == null ? '' : args.content);
      const current = vault.files.has(file) ? vault.read(file).content : '';
      let next;
      if (args.heading) {
        const lines = current.split('\n');
        const wanted = String(args.heading).replace(/^#+\s*/, '').trim().toLowerCase();
        const headings = Meta.extract(current).headings;
        const at = headings.findIndex((heading) => heading.text.toLowerCase() === wanted);
        if (at < 0) throw new VaultError(`Section « ${args.heading} » introuvable dans ${file}.`, 404, 'missing');
        const following = headings.slice(at + 1).find((heading) => heading.level <= headings[at].level);
        let end = following ? following.line : lines.length;
        while (end > headings[at].line + 1 && !lines[end - 1].trim()) end--;
        lines.splice(end, 0, addition, ...(following ? [''] : []));
        next = lines.join('\n');
      } else next = current ? `${current.replace(/\n*$/, '')}\n${addition}\n` : `${addition}\n`;
      const entry = vault.write(file, next);
      app.activity({ tool: 'append_to_note', path: entry.path });
      return text(`Texte ajouté à ${entry.path}`);
    },
  },
  {
    name: 'edit_note',
    description: 'Remplace un passage exact dans une note. « find » doit correspondre au texte tel qu’il est écrit ; s’il apparaît plusieurs fois, précisez davantage ou passez replace_all.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'find', 'replace'], additionalProperties: false },
    run: (args, app) => {
      const vault = needVault(app);
      const file = existing(vault, requireString(args, 'path'));
      const find = String(args.find == null ? '' : args.find).replace(/\r\n?/g, '\n');
      if (!find) throw new VaultError('« find » ne peut pas être vide.');
      const content = vault.read(file).content;
      const count = content.split(find).length - 1;
      if (!count) throw new VaultError(`Passage introuvable dans ${file}. Relisez la note avec read_note.`, 404, 'missing');
      if (count > 1 && !args.replace_all) throw new VaultError(`Le passage apparaît ${count} fois dans ${file} : précisez-le ou passez replace_all.`, 409, 'ambiguous');
      const replacement = String(args.replace == null ? '' : args.replace);
      vault.write(file, args.replace_all ? content.split(find).join(replacement) : content.replace(find, () => replacement));
      app.activity({ tool: 'edit_note', path: file });
      return text(`${args.replace_all ? count : 1} remplacement(s) dans ${file}`);
    },
  },
  {
    name: 'set_properties',
    description: 'Modifie les propriétés (frontmatter YAML) d’une note : étiquettes, alias, date, statut… Une valeur null supprime la propriété.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, properties: { type: 'object', description: 'Exemple : {"tags":["projet","idée"],"statut":"en cours","ancienne":null}' } }, required: ['path', 'properties'], additionalProperties: false },
    run: (args, app) => {
      const vault = needVault(app);
      const file = existing(vault, requireString(args, 'path'));
      if (!args.properties || typeof args.properties !== 'object' || Array.isArray(args.properties)) throw new VaultError('« properties » doit être un objet.');
      const content = vault.read(file).content;
      const split = Meta.splitFrontmatter(content);
      const current = split.yaml === null ? {} : Meta.parseYaml(split.yaml);
      for (const [key, value] of Object.entries(args.properties)) {
        if (value === null) delete current[key]; else current[key] = value;
      }
      vault.write(file, Meta.withFrontmatter(content, current));
      app.activity({ tool: 'set_properties', path: file });
      return text(`Propriétés de ${file} : ${Object.keys(current).join(', ') || 'aucune'}`);
    },
  },
  {
    name: 'create_folder',
    description: 'Crée un dossier (et ses parents) dans le coffre.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    run: (args, app) => {
      const folder = needVault(app).createFolder(requireString(args, 'path'));
      app.activity({ tool: 'create_folder', path: folder });
      return text(`Dossier créé : ${folder}/`);
    },
  },
  {
    name: 'move',
    description: 'Déplace ou renomme une note, un fichier ou un dossier. Les liens [[…]] qui pointent dessus sont mis à jour automatiquement dans tout le coffre. Si « to » est un dossier existant (ou finit par /), l’élément y est déplacé en gardant son nom.',
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'], additionalProperties: false },
    run: (args, app) => {
      const result = moveOne(needVault(app), requireString(args, 'from'), requireString(args, 'to'));
      app.activity({ tool: 'move', path: result.to });
      return text(`Déplacé : ${result.from} → ${result.to}${result.linksUpdated ? ` (${result.linksUpdated} lien(s) mis à jour dans ${result.notesUpdated} note(s))` : ''}`);
    },
  },
  {
    name: 'move_many',
    description: 'Déplace ou renomme plusieurs éléments en une fois, pour trier ou réorganiser le coffre. Chaque déplacement met à jour les liens. Les échecs sont rapportés sans interrompre les autres.',
    inputSchema: { type: 'object', properties: { moves: { type: 'array', maxItems: 200, items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } } }, required: ['moves'], additionalProperties: false },
    run: (args, app) => {
      const vault = needVault(app);
      if (!Array.isArray(args.moves) || !args.moves.length) throw new VaultError('« moves » doit contenir au moins un déplacement.');
      const lines = []; let done = 0;
      for (const move of args.moves.slice(0, 200)) {
        try {
          const result = moveOne(vault, String(move && move.from), String(move && move.to));
          lines.push(`OK  ${result.from} → ${result.to}${result.linksUpdated ? ` (${result.linksUpdated} lien(s))` : ''}`); done++;
        } catch (error) { lines.push(`ÉCHEC  ${move && move.from} → ${move && move.to} : ${error.message}`); }
      }
      app.activity({ tool: 'move_many', path: '' });
      return text(`${done}/${args.moves.length} déplacement(s) effectué(s)\n${lines.join('\n')}`);
    },
  },
  {
    name: 'delete',
    description: 'Supprime une note, un fichier ou un dossier. Par défaut l’élément va dans la corbeille du coffre (.trash) et reste récupérable ; permanent:true l’efface définitivement.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, permanent: { type: 'boolean' } }, required: ['path'], additionalProperties: false },
    run: (args, app) => {
      const vault = needVault(app);
      const target = vault.locate(requireString(args, 'path'));
      if (!target) throw new VaultError(`Introuvable : « ${args.path} ».`, 404, 'missing');
      const result = vault.remove(target, { permanent: args.permanent === true });
      app.activity({ tool: 'delete', path: result.path });
      return text(`${result.mode === 'permanent' ? 'Supprimé définitivement' : 'Mis à la corbeille'} : ${result.path}${result.removed > 1 ? ` (${result.removed} fichiers)` : ''}`);
    },
  },
  {
    name: 'search',
    description: 'Recherche dans les notes. Syntaxe : mots (tous requis), "phrase exacte", -exclu, a OR b, /regex/, file:nom, path:dossier, tag:#étiquette, content:mot.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['query'], additionalProperties: false },
    run: (args, app) => {
      const found = search(needVault(app), requireString(args, 'query'), { limit: args.limit || 25, matchesPerFile: 4 });
      if (!found.total) return text(`Aucun résultat pour « ${args.query} ».`);
      const blocks = found.results.map((result) => `${result.path}${result.count ? ` (${result.count})` : ''}${result.matches.map((match) => `\n  L${match.line + 1}: ${match.text.trim()}`).join('')}`);
      return text(`${found.total} note(s) pour « ${args.query} »${found.total > found.results.length ? `, ${found.results.length} affichées` : ''} :\n\n${blocks.join('\n')}`);
    },
  },
  {
    name: 'get_backlinks',
    description: 'Notes qui contiennent un lien vers la note donnée, avec la ligne concernée. include_unlinked ajoute les mentions du nom sans lien.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, include_unlinked: { type: 'boolean' } }, required: ['path'], additionalProperties: false },
    run: (args, app) => {
      const vault = needVault(app);
      const file = existing(vault, requireString(args, 'path'));
      const result = vault.backlinks(file, { unlinked: args.include_unlinked === true });
      const format = (groups) => groups.map((group) => `${group.path}${group.items.map((item) => `\n  L${item.line + 1}: ${item.text}`).join('')}`).join('\n');
      return text(`Rétroliens vers ${file} : ${result.linked.length} note(s)\n${format(result.linked)}${args.include_unlinked ? `\n\nMentions sans lien : ${result.unlinked.length} note(s)\n${format(result.unlinked)}` : ''}`);
    },
  },
  {
    name: 'get_links',
    description: 'Liens sortants d’une note : vers quoi elle pointe, et lesquels ne mènent à aucune note existante.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    run: (args, app) => {
      const vault = needVault(app);
      const file = existing(vault, requireString(args, 'path'));
      const links = vault.outgoing(file).filter((link) => link.target);
      if (!links.length) return text(`${file} ne contient aucun lien.`);
      return text(`${links.length} lien(s) dans ${file} :\n${links.map((link) => `${link.embed ? '!' : ''}[[${link.target}${link.subpath ? '#' + link.subpath : ''}]] → ${link.path || 'NON RÉSOLU'}`).join('\n')}`);
    },
  },
  {
    name: 'list_tags',
    description: 'Toutes les étiquettes du coffre avec leur nombre de notes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (args, app) => {
      const tags = needVault(app).tags();
      return text(tags.length ? tags.map((item) => `#${item.tag} (${item.count})`).join('\n') : 'Aucune étiquette dans ce coffre.');
    },
  },
  {
    name: 'find_by_tag',
    description: 'Notes portant une étiquette (les sous-étiquettes sont incluses : « projet » trouve aussi #projet/web).',
    inputSchema: { type: 'object', properties: { tag: { type: 'string' } }, required: ['tag'], additionalProperties: false },
    run: (args, app) => {
      const notes = needVault(app).notesByTag(requireString(args, 'tag'));
      return text(notes.length ? `${notes.length} note(s) avec #${String(args.tag).replace(/^#/, '')} :\n${notes.join('\n')}` : `Aucune note avec #${String(args.tag).replace(/^#/, '')}.`);
    },
  },
  {
    name: 'daily_note',
    description: 'Ouvre (ou crée) la note quotidienne d’une date, et y ajoute éventuellement du texte. Sans date : aujourd’hui.',
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'AAAA-MM-JJ' }, append: { type: 'string', description: 'Texte à ajouter à la fin de la note.' } }, additionalProperties: false },
    run: (args, app) => {
      const vault = needVault(app);
      let date = new Date();
      if (args.date) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(args.date));
        if (!match) throw new VaultError('« date » doit être au format AAAA-MM-JJ.');
        date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      }
      const daily = vault.ensureDaily(date);
      if (args.append) {
        const current = vault.read(daily.path).content;
        vault.write(daily.path, current ? `${current.replace(/\n*$/, '')}\n${args.append}\n` : `${args.append}\n`);
      }
      app.activity({ tool: 'daily_note', path: daily.path });
      return text(`Note quotidienne : ${daily.path}${daily.created ? ' (créée)' : ''}\n\n${clip(vault.read(daily.path).content)}`);
    },
  },
  {
    name: 'open_note',
    description: 'Affiche une note dans la fenêtre d’Opale pour que l’utilisateur la voie.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    run: (args, app) => {
      const file = existing(needVault(app), requireString(args, 'path'));
      const shown = app.openInUi(file);
      return text(shown ? `Note affichée dans Opale : ${file}` : `Aucune fenêtre Opale n’est ouverte ; ${file} s’ouvrira au prochain lancement.`);
    },
  },
  {
    name: 'get_active_note',
    description: 'La note que l’utilisateur regarde en ce moment dans Opale (chemin et contenu). Utile pour « cette note », « la note ouverte ».',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (args, app) => {
      const vault = needVault(app);
      const active = app.activeNote();
      if (!active || !vault.files.has(active)) return text('Aucune note n’est ouverte dans Opale pour le moment.');
      return text(`Note active : ${active}\n\n${clip(vault.read(active).content)}`);
    },
  },
  {
    name: 'read_board',
    description: 'Lit un moodboard (fichier .canvas) : liste ses éléments (pense-bêtes, textes, formes, images, notes, cartes, liens entre éléments…) avec leur id, leur type, leur position et leur texte.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Chemin du moodboard (.canvas).' } }, required: ['path'], additionalProperties: false },
    run: (args, app) => {
      const vault = needVault(app);
      const file = boardPath(vault, requireString(args, 'path'), true);
      const { doc, problem } = Board.parse(vault.read(file).content);
      if (problem) return fail(problem);
      const items = doc.elements.map((el) => {
        const item = { id: el.id, kind: el.kind, x: Math.round(el.x), y: Math.round(el.y), w: Math.round(el.w), h: Math.round(el.h) };
        const summary = Board.fallbackText(el) || el.data.file || el.data.url || el.data.title || '';
        if (summary) item.text = summary.length > 2000 ? `${summary.slice(0, 2000)}…` : summary;
        if (el.kind === 'connector') { item.from = el.from.id || [Math.round(el.from.x), Math.round(el.from.y)]; item.to = el.to.id || [Math.round(el.to.x), Math.round(el.to.y)]; }
        return item;
      });
      return text({ path: file, count: items.length, elements: items });
    },
  },
  {
    name: 'add_to_board',
    description: 'Ajoute des éléments à un moodboard (créé s’il n’existe pas), placés automatiquement sous le contenu existant si x/y ne sont pas donnés. Types (kind) : sticky (pense-bête), text, shape (shape : rect, ellipse, diamond…), card (tâche : title, description, assignee, due, status todo|doing|done|blocked, points), image (file = chemin d’une image du coffre), note (file = chemin d’une note), link (url), frame (title), code (text = code, lang), table (rows = tableau de lignes), mindmap (text = racine, children = [{text, children}]), kanban (title, columns = [{title, cards: [texte]}]). « connect » relie des éléments : indices dans items ou ids existants.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Chemin du moodboard (.canvas ajouté si absent).' },
        items: { type: 'array', items: { type: 'object' } },
        connect: { type: 'array', items: { type: 'object', properties: { from: {}, to: {}, label: { type: 'string' } } } },
      },
      required: ['path', 'items'], additionalProperties: false,
    },
    run: (args, app) => {
      const vault = needVault(app);
      const file = boardPath(vault, requireString(args, 'path'), false);
      const existed = vault.files.has(file);
      const parsed = existed ? Board.parse(vault.read(file).content) : { doc: Board.emptyDoc(), problem: null };
      if (parsed.problem) return fail(parsed.problem);
      const doc = parsed.doc;
      if (!Array.isArray(args.items) || !args.items.length) throw new VaultError('Paramètre « items » requis (liste non vide).');
      if (args.items.length > 500) throw new VaultError('500 éléments au plus par appel.');
      const content = Board.union(doc.elements.filter((el) => el.kind !== 'connector').map((el) => Board.bounds(el)));
      const startX = content ? content.x : 0;
      let cursorX = startX; let cursorY = content ? content.y + content.h + 120 : 0; let rowHeight = 0;
      const created = args.items.map((item) => {
        const el = boardItem(item, vault);
        if (typeof item.x === 'number' && typeof item.y === 'number') { el.x = item.x; el.y = item.y; }
        else {
          if (cursorX > startX && cursorX + el.w > startX + 2400) { cursorX = startX; cursorY += rowHeight + 60; rowHeight = 0; }
          el.x = cursorX; el.y = cursorY; cursorX += el.w + 40; rowHeight = Math.max(rowHeight, el.h);
        }
        doc.elements.push(el);
        return el;
      });
      const ids = new Map(doc.elements.map((el) => [el.id, el]));
      const pick = (ref) => (typeof ref === 'number' ? created[ref] : ids.get(String(ref)));
      for (const link of Array.isArray(args.connect) ? args.connect : []) {
        const from = pick(link && link.from); const to = pick(link && link.to);
        if (!from || !to) throw new VaultError('connect : élément introuvable (indice dans items ou id existant attendu).');
        doc.elements.push(Board.create('connector', { from: { id: from.id }, to: { id: to.id }, data: { label: String((link && link.label) || '') } }));
      }
      const entry = vault.write(file, Board.serialize(doc));
      app.activity({ tool: 'write_note', path: entry.path });
      return text({ path: entry.path, board: existed ? 'mis à jour' : 'créé', ids: created.map((el) => el.id) });
    },
  },
  {
    name: 'write_board',
    description: 'Crée ou remplace entièrement un moodboard à partir d’un document JSON Canvas (format d’Obsidian Canvas : { nodes: [...], edges: [...] }). Préférez add_to_board pour ajouter des éléments.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, canvas: { type: 'object', description: 'Document JSON Canvas.' }, overwrite: { type: 'boolean' } }, required: ['path', 'canvas'], additionalProperties: false },
    run: (args, app) => {
      const vault = needVault(app);
      const file = boardPath(vault, requireString(args, 'path'), false);
      const { doc, problem } = Board.parse(JSON.stringify(args.canvas || {}));
      if (problem) return fail(problem);
      const existed = vault.files.has(file);
      const entry = vault.write(file, Board.serialize(doc), { createOnly: args.overwrite === false });
      app.activity({ tool: 'write_note', path: entry.path });
      return text(`${existed ? 'Moodboard remplacé' : 'Moodboard créé'} : ${entry.path} (${doc.elements.length} éléments)`);
    },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

function instructions(app) {
  return [
    `Opale est le coffre de notes Markdown de l’utilisateur${app.vault ? ` (coffre ouvert : « ${app.vault.name} »)` : ''}.`,
    'Les notes sont liées par [[Nom de note]], étiquetées par #étiquette, et décrites par un frontmatter YAML.',
    'Commencez par vault_info ou list_files pour connaître la structure. Pour réorganiser, utilisez move / move_many : les liens sont réécrits automatiquement.',
    'delete envoie à la corbeille du coffre sauf si permanent:true est demandé explicitement par l’utilisateur.',
    'Les moodboards sont des fichiers .canvas (format JSON Canvas) : lisez-les avec read_board et complétez-les avec add_to_board plutôt que de réécrire le fichier.',
  ].join(' ');
}

async function handleMessage(message, app) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return { jsonrpc: '2.0', id: message && message.id !== undefined ? message.id : null, error: { code: -32600, message: 'Requête JSON-RPC invalide.' } };
  }
  const notification = message.id === undefined || message.id === null;
  const reply = (result) => (notification ? null : { jsonrpc: '2.0', id: message.id, result });
  const params = message.params && typeof message.params === 'object' ? message.params : {};
  switch (message.method) {
    case 'initialize':
      return reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'opale', title: 'Opale', version: app.version }, instructions: instructions(app) });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOL_BY_NAME.get(String(params.name || ''));
      if (!tool) return reply(fail(`Outil inconnu : « ${params.name} ».`));
      try {
        const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
        app.seen(tool.name);
        return reply(await tool.run(args, app));
      } catch (error) {
        // Expected failures (missing note, conflict) are tool results the
        // model can read and correct, not protocol errors.
        return reply(fail(error instanceof VaultError ? error.message : `Erreur interne : ${error.message || error}`));
      }
    }
    default:
      return notification ? null : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Méthode inconnue : ${message.method}` } };
  }
}

module.exports = { handleMessage, TOOLS, PROTOCOL_VERSION };
