// Opale — file explorer: the vault's folders and files as a tree, with
// create, rename, move (drag and drop), duplicate and delete.
import { api, app, bus, confirmDialog, fuzzy, h, highlighted, icon, iconButton, Meta, openModal, reportError, showMenu, toast } from './core.js';
import { store } from './store.js';

const SORTS = {
  'name-asc': ['Nom (A → Z)', (a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' })],
  'name-desc': ['Nom (Z → A)', (a, b) => b.name.localeCompare(a.name, 'fr', { numeric: true, sensitivity: 'base' })],
  'mtime-desc': ['Modification (récent → ancien)', (a, b) => b.entry.mtime - a.entry.mtime],
  'mtime-asc': ['Modification (ancien → récent)', (a, b) => a.entry.mtime - b.entry.mtime],
  'ctime-desc': ['Création (récent → ancien)', (a, b) => b.entry.ctime - a.entry.ctime],
  'ctime-asc': ['Création (ancien → récent)', (a, b) => a.entry.ctime - b.entry.ctime],
};

export const explorer = {
  expanded: new Set(), selected: '', renaming: '', pendingRename: '',

  init(root) {
    this.list = h('div.tree', { role: 'tree', tabIndex: 0, 'aria-label': 'Fichiers du coffre' });
    this.el = h('div.panel.explorer',
      h('div.panel-toolbar',
        iconButton('file-plus', 'Nouvelle note (Ctrl+N)', () => this.newNote(this.targetFolder())),
        iconButton('folder-plus', 'Nouveau dossier', () => this.newFolder(this.targetFolder())),
        iconButton('sort', 'Ordre de tri', (event) => this.sortMenu(event)),
        iconButton('collapse', 'Tout replier', () => { this.expanded.clear(); this.render(); app.workspace.persist(); }),
        iconButton('locate', 'Afficher la note active', () => { const note = app.workspace.activeView; if (note && note.path) this.reveal(note.path); })),
      this.list);
    root.append(this.el);
    this.bind();
    bus.on('index', (change) => this.onIndex(change));
    bus.on('active-view', () => this.markActive());
    bus.on('settings', () => this.render());
  },

  state() { return { expanded: [...this.expanded] }; },
  restore(state) { this.expanded = new Set(Array.isArray(state && state.expanded) ? state.expanded.filter((folder) => store.folders.includes(folder)) : []); this.render(); },

  // Folder new items go to: the selected folder, or the selected file's folder.
  targetFolder() {
    if (!this.selected) return undefined;
    return store.folders.includes(this.selected) ? this.selected : Meta.dirName(this.selected);
  },

  children() {
    const map = new Map([['', { folders: [], files: [] }]]);
    for (const folder of store.folders) map.set(folder, { folders: [], files: [] });
    for (const folder of store.folders) { const parent = map.get(Meta.dirName(folder)); if (parent) parent.folders.push({ path: folder, name: Meta.baseName(folder) }); }
    for (const entry of store.files.values()) {
      const parent = map.get(Meta.dirName(entry.path));
      if (parent) parent.files.push({ path: entry.path, name: entry.kind === 'note' ? Meta.stem(entry.path) : Meta.baseName(entry.path), entry });
    }
    const order = (SORTS[app.settings.explorerSort] || SORTS['name-asc'])[1];
    for (const node of map.values()) { node.folders.sort(SORTS['name-asc'][1]); node.files.sort(order); }
    return map;
  },

  render() {
    const map = this.children();
    const rows = [];
    const active = app.workspace.activeView && app.workspace.activeView.path;
    const walk = (folder, depth) => {
      const node = map.get(folder);
      if (!node) return;
      for (const item of node.folders) {
        const open = this.expanded.has(item.path);
        rows.push(this.row(item, depth, { folder: true, open }));
        if (open) walk(item.path, depth + 1);
      }
      for (const item of node.files) rows.push(this.row(item, depth, { active: item.path === active }));
    };
    walk('', 0);
    if (!rows.length) rows.push(h('div.panel-empty', 'Ce coffre est vide. Créez une note avec Ctrl+N.'));
    this.list.replaceChildren(...rows);
    if (this.renaming) this.startRename(this.renaming);
  },

  row(item, depth, flags) {
    const classes = `div.tree-row${flags.folder ? '.folder' : '.file'}${flags.active ? '.active' : ''}${item.path === this.selected ? '.selected' : ''}`;
    const ext = !flags.folder && item.entry.kind !== 'note' ? Meta.extOf(item.path) : '';
    return h(classes, { role: 'treeitem', draggable: true, tabIndex: -1, title: item.path, dataset: { path: item.path, folder: flags.folder ? '1' : '' }, style: { paddingLeft: `${8 + depth * 16}px` }, 'aria-expanded': flags.folder ? String(!!flags.open) : null },
      h('span.tree-chevron', { html: flags.folder ? icon(flags.open ? 'chevron-down' : 'chevron-right', 14) : '' }),
      h('span.tree-name', item.name),
      ext ? h('span.tree-ext', ext) : null);
  },

  markActive() {
    const active = app.workspace.activeView && app.workspace.activeView.path;
    for (const row of this.list.querySelectorAll('.tree-row.file')) row.classList.toggle('active', row.dataset.path === active);
  },

  select(path) {
    this.selected = path;
    for (const row of this.list.querySelectorAll('.tree-row')) row.classList.toggle('selected', row.dataset.path === path);
  },

  reveal(path) {
    const parts = path.split('/');
    const folders = store.folders.includes(path) ? parts.length : parts.length - 1;
    for (let i = 1; i <= folders; i++) this.expanded.add(parts.slice(0, i).join('/'));
    this.selected = path;
    app.layout.show('left', 'files');
    this.render();
    const row = this.list.querySelector(`.tree-row[data-path="${CSS.escape(path)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
    app.workspace.persist();
  },

  onIndex(change) {
    for (const pair of change.renames || []) {
      const [from, to] = pair;
      if (this.selected === from) this.selected = to;
      if (pair[2] === 'folder') {
        for (const folder of [...this.expanded]) if (folder === from || folder.startsWith(`${from}/`)) { this.expanded.delete(folder); this.expanded.add(to + folder.slice(from.length)); }
      }
    }
    if (this.pendingRename && (store.folders.includes(this.pendingRename) || store.has(this.pendingRename))) { this.renaming = this.pendingRename; this.pendingRename = ''; }
    this.render();
  },

  bind() {
    const list = this.list;
    const rowOf = (event) => event.target.closest('.tree-row');
    list.addEventListener('click', (event) => {
      const row = rowOf(event);
      if (!row || event.target.closest('input')) return;
      const path = row.dataset.path;
      this.select(path);
      if (row.dataset.folder) { if (this.expanded.has(path)) this.expanded.delete(path); else this.expanded.add(path); this.render(); app.workspace.persist(); }
      else app.workspace.openPath(path, { newTab: event.ctrlKey || event.metaKey });
    });
    list.addEventListener('auxclick', (event) => {
      const row = rowOf(event);
      if (row && event.button === 1 && !row.dataset.folder) { event.preventDefault(); app.workspace.openPath(row.dataset.path, { newTab: true }); }
    });
    list.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const row = rowOf(event);
      if (row) this.select(row.dataset.path);
      this.menu(event.clientX, event.clientY, row ? row.dataset.path : '', row ? !!row.dataset.folder : true);
    });
    list.addEventListener('keydown', (event) => {
      if (event.target.closest('input')) return;
      const rows = [...list.querySelectorAll('.tree-row')];
      const at = rows.findIndex((row) => row.dataset.path === this.selected);
      const current = rows[at];
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = rows[Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
        if (next) { this.select(next.dataset.path); next.scrollIntoView({ block: 'nearest' }); }
      } else if (current && (event.key === 'ArrowRight' || event.key === 'ArrowLeft') && current.dataset.folder) {
        event.preventDefault();
        if (event.key === 'ArrowRight') this.expanded.add(this.selected); else this.expanded.delete(this.selected);
        this.render();
      } else if (current && event.key === 'Enter') { event.preventDefault(); current.click(); }
      else if (current && event.key === 'F2') { event.preventDefault(); this.startRename(this.selected); }
      else if (current && event.key === 'Delete') { event.preventDefault(); this.remove(this.selected); }
    });

    list.addEventListener('dragstart', (event) => {
      const row = rowOf(event);
      if (!row) return;
      event.dataTransfer.setData('application/x-opale-path', row.dataset.path);
      event.dataTransfer.setData('text/plain', `[[${store.files.has(row.dataset.path) ? store.linkText(row.dataset.path) : row.dataset.path}]]`);
      event.dataTransfer.effectAllowed = 'move';
    });
    const dropFolder = (event) => {
      const row = rowOf(event);
      if (!row) return '';
      return row.dataset.folder ? row.dataset.path : Meta.dirName(row.dataset.path);
    };
    list.addEventListener('dragover', (event) => {
      if (![...event.dataTransfer.types].includes('application/x-opale-path')) return;
      event.preventDefault();
      const folder = dropFolder(event);
      for (const row of list.querySelectorAll('.drop-target')) row.classList.remove('drop-target');
      const target = folder ? list.querySelector(`.tree-row.folder[data-path="${CSS.escape(folder)}"]`) : null;
      (target || list).classList.add('drop-target');
    });
    const clearDrop = () => { list.classList.remove('drop-target'); for (const row of list.querySelectorAll('.drop-target')) row.classList.remove('drop-target'); };
    list.addEventListener('dragleave', (event) => { if (!list.contains(event.relatedTarget)) clearDrop(); });
    list.addEventListener('drop', (event) => {
      const from = event.dataTransfer.getData('application/x-opale-path');
      clearDrop();
      if (!from) return;
      event.preventDefault();
      const folder = dropFolder(event);
      if (Meta.dirName(from) === folder || folder === from || folder.startsWith(`${from}/`)) return;
      this.move(from, Meta.joinPath(folder, Meta.baseName(from)), folder);
    });
  },

  async move(from, to, folder) {
    try {
      await app.workspace.flushAll();
      const result = await api('/api/rename', { method: 'POST', body: { from, to } });
      if (folder) this.expanded.add(folder);
      if (result.linksUpdated) toast(`${result.linksUpdated} lien(s) mis à jour dans ${result.notesUpdated} note(s)`);
    } catch (error) { reportError(error); }
  },

  menu(x, y, path, isFolder) {
    if (!path) {
      return showMenu(x, y, [
        { label: 'Nouvelle note', icon: 'file-plus', run: () => this.newNote('') },
        { label: 'Nouveau dossier', icon: 'folder-plus', run: () => this.newFolder('') },
        'separator',
        { label: 'Afficher le coffre dans l’Explorateur Windows', icon: 'external', run: () => api('/api/reveal', { method: 'POST', body: { path: '' } }).catch(reportError) },
      ]);
    }
    const bookmarked = app.bookmarks.includes(path);
    return showMenu(x, y, [
      isFolder ? { label: 'Nouvelle note', icon: 'file-plus', run: () => this.newNote(path) } : { label: 'Ouvrir dans un nouvel onglet', icon: 'plus', run: () => app.workspace.openPath(path, { newTab: true }) },
      isFolder ? { label: 'Nouveau dossier', icon: 'folder-plus', run: () => this.newFolder(path) } : { label: 'Dupliquer', icon: 'copy', run: () => this.duplicate(path), disabled: Meta.kindOf(path) !== 'note' },
      'separator',
      { label: 'Renommer', icon: 'pencil', run: () => this.startRename(path), hint: 'F2' },
      { label: 'Déplacer vers…', icon: 'folder', run: () => this.moveDialog(path) },
      isFolder ? null : { label: bookmarked ? 'Retirer des signets' : 'Ajouter aux signets', icon: 'bookmark', run: () => app.panels.toggleBookmark(path) },
      'separator',
      { label: 'Copier le chemin', icon: 'copy', run: () => navigator.clipboard.writeText(path).then(() => toast('Chemin copié')) },
      { label: 'Afficher dans l’Explorateur Windows', icon: 'external', run: () => api('/api/reveal', { method: 'POST', body: { path } }).catch(reportError) },
      'separator',
      { label: 'Supprimer', icon: 'trash', danger: true, run: () => this.remove(path), hint: 'Suppr' },
    ]);
  },

  sortMenu(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    showMenu(rect.left, rect.bottom + 4, Object.entries(SORTS).map(([key, [label]]) => ({
      label, checked: (app.settings.explorerSort || 'name-asc') === key,
      run: () => { app.settings.explorerSort = key; this.render(); api('/api/settings', { method: 'PUT', body: { explorerSort: key } }).catch(() => {}); },
    })));
  },

  async newNote(folder) {
    try {
      const active = app.workspace.activeNote;
      const body = folder === undefined ? { source: active ? active.path : '' } : { folder };
      const created = await api('/api/note', { method: 'POST', body });
      if (Meta.dirName(created.path)) { const parts = Meta.dirName(created.path).split('/'); for (let i = 1; i <= parts.length; i++) this.expanded.add(parts.slice(0, i).join('/')); }
      await app.workspace.waitFor(created.path);
      this.selected = created.path;
      app.workspace.openPath(created.path, { focusTitle: true, mode: app.settings.defaultMode === 'reading' ? 'live' : undefined });
    } catch (error) { reportError(error); }
  },

  async newFolder(folder) {
    try {
      const created = await api('/api/folder', { method: 'POST', body: { folder: folder || '' } });
      if (folder) this.expanded.add(folder);
      this.selected = created.path;
      app.layout.show('left', 'files');
      if (store.folders.includes(created.path)) { this.render(); this.startRename(created.path); } else this.pendingRename = created.path;
    } catch (error) { reportError(error); }
  },

  startRename(path) {
    this.renaming = '';
    const row = this.list.querySelector(`.tree-row[data-path="${CSS.escape(path)}"]`);
    if (!row) return;
    const isFolder = !!row.dataset.folder;
    const isNote = !isFolder && Meta.kindOf(path) === 'note';
    const label = row.querySelector('.tree-name');
    const initial = isNote ? Meta.stem(path) : Meta.baseName(path);
    const input = h('input.tree-rename', { type: 'text', value: initial, spellcheck: false, 'aria-label': 'Nouveau nom' });
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      input.replaceWith(label);
      if (!commit || !name || name === initial) return;
      await this.move(path, Meta.joinPath(Meta.dirName(path), isNote ? `${name}.md` : name));
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (event) => event.stopPropagation());
    label.replaceWith(input);
    row.draggable = false;
    input.focus();
    const dot = isNote || isFolder ? initial.length : (initial.lastIndexOf('.') > 0 ? initial.lastIndexOf('.') : initial.length);
    input.setSelectionRange(0, dot);
  },

  async duplicate(path) {
    try {
      const note = await api(`/api/note?path=${encodeURIComponent(path)}`);
      const created = await api('/api/note', { method: 'POST', body: { folder: Meta.dirName(path), name: Meta.stem(path), content: note.content } });
      await app.workspace.waitFor(created.path);
      app.workspace.openPath(created.path, { newTab: true });
    } catch (error) { reportError(error); }
  },

  async remove(path) {
    const isFolder = store.folders.includes(path);
    const count = isFolder ? [...store.files.keys()].filter((file) => file.startsWith(`${path}/`)).length : 0;
    const fate = app.settings.trash === 'permanent' ? 'supprimé définitivement' : app.settings.trash === 'system' ? 'envoyé à la corbeille de Windows' : 'déplacé dans la corbeille du coffre (.trash)';
    const ok = await confirmDialog({
      title: isFolder ? 'Supprimer le dossier' : 'Supprimer le fichier',
      message: `« ${Meta.baseName(path)} »${isFolder && count ? ` et ses ${count} fichier(s)` : ''} sera ${fate}.`,
      confirm: 'Supprimer', danger: true,
    });
    if (!ok) return;
    try { await api('/api/delete', { method: 'POST', body: { path } }); if (this.selected === path) this.selected = ''; }
    catch (error) { reportError(error); }
  },

  moveDialog(path) {
    const folders = ['', ...store.folders].filter((folder) => folder !== path && !folder.startsWith(`${path}/`) && folder !== Meta.dirName(path));
    const input = h('input.text-input', { type: 'text', placeholder: 'Chercher un dossier…', spellcheck: false, 'aria-label': 'Dossier de destination' });
    const list = h('div.picker-list', { role: 'listbox' });
    let items = []; let index = 0;
    const choose = (folder) => { modal.close(); this.move(path, Meta.joinPath(folder, Meta.baseName(path)), folder); };
    const draw = () => {
      const query = input.value.trim();
      items = folders.map((folder) => ({ folder, label: folder || '/ (racine du coffre)', match: fuzzy(query, folder || '/') })).filter((item) => item.match)
        .sort((a, b) => b.match.score - a.match.score || a.folder.localeCompare(b.folder)).slice(0, 60);
      index = Math.min(index, Math.max(0, items.length - 1));
      list.replaceChildren(...(items.length ? items.map((item, at) => h(`div.picker-item${at === index ? '.active' : ''}`, { role: 'option', onClick: () => choose(item.folder) },
        h('span', { html: icon('folder', 15) }), h('span', item.folder ? highlighted(item.folder, item.match.ranges) : item.label))) : [h('div.panel-empty', 'Aucun dossier ne correspond.')]));
      const active = list.querySelector('.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => { index = 0; draw(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); index = (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % Math.max(1, items.length); draw(); }
      if (event.key === 'Enter' && items[index]) { event.preventDefault(); choose(items[index].folder); }
    });
    const modal = openModal({ title: `Déplacer « ${Meta.baseName(path)} »`, className: 'modal-picker', body: h('div.picker', input, list) });
    draw();
    input.focus();
  },
};

app.explorer = explorer;
