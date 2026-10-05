// Opale — commands, keyboard shortcuts, the command palette and the quick
// switcher. Everything the interface can do is a command, so it can be run
// from a button, a shortcut or the palette alike.
import { api, app, fuzzy, h, highlighted, isTextInput, Meta, openModal, reportError, toast, topModal } from './core.js';
import { store } from './store.js';
import { FORMATS } from './editing.js';

const list = [];
const byId = new Map();

function register(id, name, run, options = {}) {
  const command = { id, name, run, hotkey: options.hotkey || '', when: options.when, hidden: !!options.hidden };
  list.push(command); byId.set(id, command);
}

const note = () => app.workspace.activeNote;
const hasNote = () => !!note();

// A modal with a text field and a filtered list: palette, switcher, pickers.
export function openPicker({ placeholder, items, footer, onSubmitEmpty, className = '' }) {
  const input = h('input.text-input.picker-input', { type: 'text', placeholder, spellcheck: false, 'aria-label': placeholder, autocomplete: 'off' });
  const listEl = h('div.picker-list', { role: 'listbox' });
  let shown = []; let index = 0;
  const pick = (item, event) => { modal.close(); item.run(event || {}); };
  const draw = () => {
    shown = items(input.value.trim());
    index = Math.min(index, Math.max(0, shown.length - 1));
    listEl.replaceChildren(...(shown.length ? shown.map((item, at) => h(`div.picker-item${at === index ? '.active' : ''}`, { role: 'option', 'aria-selected': String(at === index), onMousemove: () => { if (index !== at) { index = at; mark(); } }, onClick: (event) => pick(item, event) },
      h('span.picker-label', item.ranges ? highlighted(item.label, item.ranges) : item.label), item.detail ? h('span.picker-detail', item.detail) : null, item.hint ? h('kbd', item.hint) : null))
      : [h('div.panel-empty', 'Aucun résultat.')]));
    const active = listEl.querySelector('.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  };
  const mark = () => { [...listEl.children].forEach((child, at) => child.classList.toggle('active', at === index)); };
  input.addEventListener('input', () => { index = 0; draw(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (shown.length) { index = (index + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length; mark(); listEl.children[index].scrollIntoView({ block: 'nearest' }); }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey && onSubmitEmpty && input.value.trim()) { modal.close(); onSubmitEmpty(input.value.trim(), event); }
      else if (shown[index]) pick(shown[index], event);
      else if (onSubmitEmpty && input.value.trim()) { modal.close(); onSubmitEmpty(input.value.trim(), event); }
    }
  });
  const modal = openModal({ className: `modal-picker ${className}`, body: h('div.picker', input, listEl, footer ? h('div.picker-footer', footer) : null) });
  draw();
  input.focus();
  return modal;
}

function openPalette() {
  openPicker({
    placeholder: 'Exécuter une commande…',
    items: (query) => list.filter((command) => !command.hidden && (!command.when || command.when()))
      .map((command) => ({ command, match: fuzzy(query, command.name) })).filter((item) => item.match)
      .sort((a, b) => b.match.score - a.match.score || a.command.name.localeCompare(b.command.name)).slice(0, 80)
      .map((item) => ({ label: item.command.name, ranges: item.match.ranges, hint: item.command.hotkey, run: () => run(item.command.id) })),
  });
}

async function createNamed(name, newTab) {
  try {
    const clean = name.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\.md$/i, '');
    const body = clean.includes('/') ? { folder: Meta.dirName(clean), name: Meta.baseName(clean), exact: true } : { name: clean, exact: true, source: note() ? note().path : '' };
    const created = await api('/api/note', { method: 'POST', body });
    await app.workspace.waitFor(created.path);
    app.workspace.openPath(created.path, { newTab });
  } catch (error) { reportError(error); }
}

function openSwitcher() {
  openPicker({
    placeholder: 'Ouvrir ou créer une note…',
    footer: [h('span', h('kbd', '↵'), ' ouvrir'), h('span', h('kbd', 'Ctrl ↵'), ' nouvel onglet'), h('span', h('kbd', 'Maj ↵'), ' créer')],
    onSubmitEmpty: (name, event) => createNamed(name, event.ctrlKey),
    items: (query) => {
      const entries = [...store.files.values()];
      if (!query) {
        return entries.filter((entry) => entry.kind === 'note').sort((a, b) => b.mtime - a.mtime).slice(0, 40)
          .map((entry) => ({ label: Meta.stem(entry.path), detail: Meta.dirName(entry.path), run: (event) => app.workspace.openPath(entry.path, { newTab: event.ctrlKey }) }));
      }
      const results = [];
      for (const entry of entries) {
        const name = entry.kind === 'note' ? Meta.stem(entry.path) : Meta.baseName(entry.path);
        const match = fuzzy(query, name);
        if (match) results.push({ score: match.score + (entry.kind === 'note' ? 40 : 0), label: name, ranges: match.ranges, detail: Meta.dirName(entry.path), path: entry.path });
        else {
          const byPath = fuzzy(query, entry.path);
          if (byPath) results.push({ score: byPath.score - 200, label: name, detail: entry.path, path: entry.path });
        }
        for (const alias of (entry.meta && entry.meta.aliases) || []) {
          const aliasMatch = fuzzy(query, alias);
          if (aliasMatch) results.push({ score: aliasMatch.score, label: alias, ranges: aliasMatch.ranges, detail: `alias de ${name}`, path: entry.path });
        }
      }
      return results.sort((a, b) => b.score - a.score).slice(0, 50).map((item) => ({ ...item, run: (event) => app.workspace.openPath(item.path, { newTab: event.ctrlKey }) }));
    },
  });
}

async function openDaily() {
  try {
    const daily = await api('/api/daily', { method: 'POST', body: {} });
    await app.workspace.waitFor(daily.path);
    app.workspace.openPath(daily.path);
  } catch (error) { reportError(error); }
}

async function insertTemplate() {
  const view = note();
  if (!view) return toast('Ouvrez une note pour y insérer un modèle.');
  let templates;
  try { templates = (await api('/api/templates')).templates; } catch (error) { return reportError(error); }
  if (!templates.length) return toast(`Aucun modèle. Créez des notes dans le dossier « ${app.settings.templateFolder || 'Modèles'} ».`, { duration: 7000 });
  return openPicker({
    placeholder: 'Insérer un modèle…',
    items: (query) => templates.map((path) => ({ path, match: fuzzy(query, Meta.stem(path)) })).filter((item) => item.match).sort((a, b) => b.match.score - a.match.score)
      .map((item) => ({ label: Meta.stem(item.path), ranges: item.match.ranges, run: async () => {
        try {
          const { content } = await api('/api/template', { method: 'POST', body: { path: item.path, title: Meta.stem(view.path) } });
          const textarea = view.activeTextarea();
          if (textarea) { textarea.focus(); textarea.setRangeText(content, textarea.selectionStart, textarea.selectionEnd, 'end'); textarea.dispatchEvent(new Event('input', { bubbles: true })); }
          else { view.setContent(view.content ? `${view.content.replace(/\n*$/, '')}\n\n${content}` : content); view.render(); }
        } catch (error) { reportError(error); }
      } })),
  });
}

function format(kind) {
  const view = note();
  const textarea = view && view.activeTextarea();
  if (!textarea) return toast('Placez le curseur dans le texte (mode édition) pour mettre en forme.');
  textarea.focus();
  return FORMATS[kind](textarea);
}

export function run(id) {
  const command = byId.get(id);
  if (!command || (command.when && !command.when())) return undefined;
  try { return command.run(); } catch (error) { return reportError(error); }
}

function combo(event) {
  let key = event.key;
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  return `${event.ctrlKey || event.metaKey ? 'Ctrl+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Maj+' : ''}${key}`;
}

function onKeydown(event) {
  if (event.defaultPrevented || event.isComposing) return;
  if (event.key === 'Escape') { const modal = topModal(); if (modal) { event.preventDefault(); modal.close(); } return; }
  // AltGr shows up as Ctrl+Alt on Windows keyboards: never a shortcut.
  if (event.ctrlKey && event.altKey) return;
  // Undo and redo reach the open note wherever the focus is, except in a
  // field that has its own (search box, title, dialog).
  const key = event.key.toLowerCase();
  const board = app.workspace.activeView;
  if (board && board.type === 'board' && board.input.ownsKeys() && (event.ctrlKey || event.metaKey) && ['g', 'l', 'd', 'z', 'y', '[', ']', '0', '1'].includes(key)) return;
  if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y') && !isTextInput(document.activeElement) && !topModal()) {
    const open = note();
    if (open && open.mode !== 'reading' && open.undoKeys(event, false)) return;
  }
  const pressed = combo(event);
  const command = list.find((item) => item.hotkey === pressed);
  if (!command) return;
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
  if (plain && isTextInput(document.activeElement)) return;
  if (topModal() && !['palette:open', 'switcher:open'].includes(command.id)) return;
  if (command.when && !command.when()) return;
  event.preventDefault();
  if (topModal()) topModal().close();
  run(command.id);
}

export const commands = {
  list, run,
  init() {
    const ws = app.workspace;
    register('note:new', 'Nouvelle note', () => app.explorer.newNote(undefined), { hotkey: 'Ctrl+N' });
    register('board:new', 'Nouveau moodboard', () => app.explorer.newBoard());
    register('switcher:open', 'Ouvrir une note (sélecteur rapide)', openSwitcher, { hotkey: 'Ctrl+O' });
    register('palette:open', 'Palette de commandes', openPalette, { hotkey: 'Ctrl+P', hidden: true });
    register('search:open', 'Rechercher dans toutes les notes', () => app.panels.searchFor(''), { hotkey: 'Ctrl+Maj+F' });
    register('graph:open', 'Ouvrir le graphe', () => ws.openGraph(), { hotkey: 'Ctrl+G' });
    register('daily:open', 'Ouvrir la note du jour', openDaily);
    register('template:insert', 'Insérer un modèle', insertTemplate);
    register('note:insert-image', 'Insérer une image…', () => note().chooseImages(), { when: hasNote });
    register('note:random', 'Ouvrir une note au hasard', () => {
      const current = note() && note().path;
      const pool = store.notes().filter((entry) => entry.path !== current);
      if (pool.length) ws.openPath(pool[Math.floor(Math.random() * pool.length)].path);
    });

    register('tab:new', 'Nouvel onglet', () => ws.newTab(), { hotkey: 'Ctrl+T' });
    register('tab:close', 'Fermer l’onglet', () => ws.closeActive(), { hotkey: 'Ctrl+W' });
    register('tab:next', 'Onglet suivant', () => ws.cycle(1), { hotkey: 'Ctrl+Tab' });
    register('tab:previous', 'Onglet précédent', () => ws.cycle(-1), { hotkey: 'Ctrl+Maj+Tab' });
    register('nav:back', 'Revenir en arrière', () => ws.back(), { hotkey: 'Alt+ArrowLeft' });
    register('nav:forward', 'Aller en avant', () => ws.forward(), { hotkey: 'Alt+ArrowRight' });

    register('view:reading', 'Basculer entre lecture et édition', () => note().toggleReading(), { hotkey: 'Ctrl+E', when: hasNote });
    register('view:source', 'Basculer le mode source', () => note().toggleSource(), { when: hasNote });
    register('note:rename', 'Renommer la note', () => note().focusTitle(), { hotkey: 'F2', when: hasNote });
    register('note:move', 'Déplacer la note vers un autre dossier', () => app.explorer.moveDialog(note().path), { when: hasNote });
    register('note:delete', 'Supprimer la note', () => note().deleteNote(), { when: hasNote });
    register('note:bookmark', 'Ajouter ou retirer des signets', () => app.panels.toggleBookmark(note().path), { when: hasNote });
    register('note:reveal', 'Afficher la note dans l’explorateur de fichiers', () => app.explorer.reveal(note().path), { when: hasNote });
    register('note:copy-link', 'Copier le lien vers la note', () => navigator.clipboard.writeText(`[[${store.linkText(note().path)}]]`).then(() => toast('Lien copié')), { when: hasNote });
    register('note:save', 'Enregistrer maintenant', () => note().flush().then(() => toast('Enregistré')), { hotkey: 'Ctrl+S', when: hasNote });

    const formats = [['bold', 'Gras', 'Ctrl+B'], ['italic', 'Italique', 'Ctrl+I'], ['strike', 'Barré', 'Ctrl+Maj+X'], ['highlight', 'Surligné', 'Ctrl+Maj+H'], ['code', 'Code en ligne', ''], ['link', 'Insérer un lien Markdown', 'Ctrl+K'], ['wikilink', 'Insérer un lien interne [[…]]', ''],
      ['task', 'Basculer la case à cocher', 'Ctrl+L'], ['bullet', 'Liste à puces', ''], ['numbered', 'Liste numérotée', ''], ['quote', 'Citation', ''], ['comment', 'Commentaire %%…%%', ''],
      ['h1', 'Titre 1', ''], ['h2', 'Titre 2', ''], ['h3', 'Titre 3', ''], ['h4', 'Titre 4', ''], ['paragraph', 'Retirer le titre', '']];
    // The editor handles these shortcuts itself; they are listed for the palette.
    for (const [kind, name, hotkey] of formats) register(`format:${kind}`, `Mise en forme : ${name}`, () => format(kind), { when: hasNote, hotkey: hotkey && `${hotkey}​` });

    register('sidebar:left', 'Afficher ou masquer le panneau gauche', () => app.layout.toggle('left'));
    register('sidebar:right', 'Afficher ou masquer le panneau droit', () => app.layout.toggle('right'));
    register('panel:files', 'Afficher l’explorateur de fichiers', () => app.layout.show('left', 'files'));
    register('panel:bookmarks', 'Afficher les signets', () => app.layout.show('left', 'bookmarks'));
    register('panel:tags', 'Afficher les étiquettes', () => app.layout.show('left', 'tags'));
    register('panel:backlinks', 'Afficher les rétroliens', () => app.layout.show('right', 'backlinks'));
    register('panel:outgoing', 'Afficher les liens sortants', () => app.layout.show('right', 'outgoing'));
    register('panel:outline', 'Afficher le plan de la note', () => app.layout.show('right', 'outline'));
    register('panel:graph', 'Afficher le graphe local', () => app.layout.show('right', 'graph'));

    register('settings:open', 'Ouvrir les paramètres', () => app.settings_ui.open(), { hotkey: 'Ctrl+,' });
    register('settings:connection', 'Connexion à zaalis IDE', () => app.settings_ui.open('connection'));
    register('theme:toggle', 'Basculer entre thème clair et sombre', () => app.settings_ui.change({ theme: app.settings.theme === 'light' ? 'dark' : 'light' }));
    register('vault:switch', 'Changer de coffre', () => app.launcher.open());
    register('vault:reveal', 'Afficher le coffre dans l’Explorateur Windows', () => api('/api/reveal', { method: 'POST', body: { path: '' } }).catch(reportError));
    register('app:reload', 'Recharger Opale', () => ws.flushAll().then(() => location.reload()), { hotkey: 'Ctrl+R' });

    document.addEventListener('keydown', onKeydown);
  },
  hotkeys() { return list.filter((command) => command.hotkey).map((command) => ({ name: command.name, hotkey: command.hotkey.replace('​', '') })); },
};

app.commands = commands;
