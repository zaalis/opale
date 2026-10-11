// Opale — side panels. Left: search, bookmarks, tags. Right: backlinks,
// outgoing links, outline and the local graph of the active note.
import { api, app, bus, debounce, h, highlighted, icon, iconButton, Markdown, Meta, reportError, showMenu } from './core.js';
import { store } from './store.js';
import { GraphView } from './graph.js';

function fileRow(path, options = {}) {
  return h(`div.result-file${options.unresolved ? '.unresolved' : ''}`, {
    title: path, role: 'button', tabIndex: 0,
    onClick: (event) => options.onOpen(event.ctrlKey || event.metaKey),
    onAuxclick: (event) => { if (event.button === 1) options.onOpen(true); },
    onKeydown: (event) => { if (event.key === 'Enter') options.onOpen(event.ctrlKey); },
    onContextmenu: options.onMenu,
  }, h('span.result-name', options.label || (Meta.kindOf(path) === 'note' ? Meta.stem(path) : Meta.baseName(path))),
  options.detail ? h('span.result-detail', options.detail) : (Meta.dirName(path) ? h('span.result-detail', Meta.dirName(path)) : null),
  options.count !== undefined ? h('span.count', String(options.count)) : null);
}

function matchLine(path, item) {
  return h('div.result-line', { role: 'button', tabIndex: 0, onClick: (event) => app.workspace.openPath(path, { line: item.line, newTab: event.ctrlKey || event.metaKey }), onKeydown: (event) => { if (event.key === 'Enter') app.workspace.openPath(path, { line: item.line }); } },
    item.ranges ? highlighted(item.text, item.ranges) : item.text || ' ');
}

function section(title, count, content, open = true) {
  const details = h('details.panel-section', { open });
  details.append(h('summary', h('span', title), h('span.count', String(count))), content);
  return details;
}

export const panels = {
  init(left, right) {
    this.left = left; this.right = right;
    this.buildSearch(); this.buildBookmarks(); this.buildTags();
    for (const key of ['backlinks', 'outgoing', 'outline']) this.right[key].append(h('div.panel-scroll'));
    this.localGraph = null;
    const refreshRight = debounce(() => this.refreshRight(), 250);
    bus.on('active-view', () => { this.refreshRight(); this.renderBookmarks(); });
    bus.on('note-content', (view) => { if (view === app.workspace.activeView) refreshRight(); });
    // A note finishes loading after its tab became active.
    bus.on('note-rendered', (view) => { if (view === app.workspace.activeView) refreshRight(); });
    bus.on('index', () => { refreshRight(); this.renderTags(); this.renderBookmarks(); if (this.searchInput.value.trim() && app.layout.visible('left', 'search')) this.runSearch(); });
    bus.on('layout', () => { this.refreshRight(); if (app.layout.visible('left', 'tags')) this.renderTags(); });
  },

  // ---------------------------------------------------------------- search
  buildSearch() {
    this.searchInput = h('input.text-input', { type: 'search', placeholder: 'Rechercher dans le coffre…', spellcheck: false, 'aria-label': 'Rechercher dans le coffre' });
    this.searchInfo = h('div.panel-info');
    this.searchResults = h('div.panel-scroll');
    this.runSearch = debounce(() => this.search(), 180);
    this.searchInput.addEventListener('input', () => this.runSearch());
    this.searchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { this.runSearch.cancel(); this.search(); } });
    this.left.search.append(h('div.panel-toolbar.search-bar', this.searchInput), this.searchInfo, this.searchResults);
    this.searchHelp();
  },

  searchHelp() {
    const row = (code, text) => h('div.help-row', { role: 'button', tabIndex: 0, onClick: () => { this.searchInput.value = code.replace('…', ''); this.searchInput.focus(); this.runSearch(); } }, h('code', code), h('span', text));
    this.searchInfo.textContent = '';
    this.searchResults.replaceChildren(h('div.search-help',
      h('div.help-title', 'Options de recherche'),
      row('"phrase exacte"', 'la phrase telle quelle'), row('mot -exclu', 'sans le second mot'), row('a OR b', 'l’un ou l’autre'),
      row('tag:#…', 'notes avec l’étiquette'), row('file:…', 'dans le nom du fichier'), row('path:…', 'dans le chemin'), row('/regex/', 'expression régulière')));
  },

  async search() {
    const query = this.searchInput.value.trim();
    if (!query) return this.searchHelp();
    const ticket = (this.searchTicket = (this.searchTicket || 0) + 1);
    let found;
    try { found = await api(`/api/search?q=${encodeURIComponent(query)}&limit=200`); } catch (error) { this.searchInfo.textContent = error.message; return undefined; }
    if (ticket !== this.searchTicket) return undefined;
    this.searchInfo.textContent = found.total ? `${found.total} note${found.total > 1 ? 's' : ''}${found.total > found.results.length ? ` (${found.results.length} affichées)` : ''}` : 'Aucun résultat';
    this.searchResults.replaceChildren(...found.results.map((result) => h('div.result-group',
      fileRow(result.path, { count: result.count || undefined, onOpen: (newTab) => app.workspace.openPath(result.path, { newTab, line: result.matches[0] ? result.matches[0].line : undefined }) }),
      ...result.matches.map((match) => matchLine(result.path, match)))));
    return undefined;
  },

  searchFor(query) {
    app.layout.show('left', 'search');
    this.searchInput.value = query;
    this.searchInput.focus();
    this.searchInput.select();
    this.runSearch.cancel();
    if (query) this.search(); else this.searchHelp();
  },

  // ------------------------------------------------------------- bookmarks
  buildBookmarks() {
    this.bookmarkList = h('div.panel-scroll');
    this.left.bookmarks.append(h('div.panel-toolbar', iconButton('plus', 'Ajouter la note active aux signets', () => { const view = app.workspace.activeView; if (view && view.path) this.toggleBookmark(view.path, true); })), this.bookmarkList);
  },

  renderBookmarks() {
    const active = app.workspace.activeView && app.workspace.activeView.path;
    const rows = app.bookmarks.filter((path) => store.has(path)).map((path) => {
      const row = fileRow(path, {
        onOpen: (newTab) => app.workspace.openPath(path, { newTab }),
        onMenu: (event) => { event.preventDefault(); showMenu(event.clientX, event.clientY, [{ label: 'Retirer des signets', icon: 'trash', run: () => this.toggleBookmark(path) }, { label: 'Ouvrir dans un nouvel onglet', icon: 'plus', run: () => app.workspace.openPath(path, { newTab: true }) }]); },
      });
      row.classList.toggle('active', path === active);
      row.prepend(h('span.result-icon', { html: icon('bookmark', 14) }));
      return row;
    });
    this.bookmarkList.replaceChildren(...(rows.length ? rows : [h('div.panel-empty', 'Aucun signet. Ajoutez la note active avec le bouton + ou depuis le menu d’une note.')]));
  },

  async toggleBookmark(path, addOnly) {
    const has = app.bookmarks.includes(path);
    if (has && addOnly) return;
    const next = has ? app.bookmarks.filter((item) => item !== path) : [...app.bookmarks, path];
    try { app.bookmarks = (await api('/api/bookmarks', { method: 'PUT', body: { bookmarks: next } })).bookmarks; this.renderBookmarks(); }
    catch (error) { reportError(error); }
  },

  // ------------------------------------------------------------------ tags
  buildTags() {
    this.tagList = h('div.panel-scroll');
    this.tagSort = 'count';
    this.left.tags.append(h('div.panel-toolbar', iconButton('sort', 'Trier par nombre ou par nom', () => { this.tagSort = this.tagSort === 'count' ? 'name' : 'count'; this.renderTags(); })), this.tagList);
  },

  renderTags() {
    // "projet/web" counts for "projet" as well, and nests under it.
    const tree = new Map();
    for (const { tag, count } of store.tags()) {
      const parts = tag.split('/'); let level = tree;
      parts.forEach((part, index) => {
        const key = part.toLowerCase();
        if (!level.has(key)) level.set(key, { name: part, full: parts.slice(0, index + 1).join('/'), count: 0, children: new Map() });
        const node = level.get(key);
        node.count += count; level = node.children;
      });
    }
    const order = this.tagSort === 'count' ? (a, b) => b.count - a.count || a.name.localeCompare(b.name) : (a, b) => a.name.localeCompare(b.name);
    const rows = [];
    const walk = (level, depth) => {
      for (const node of [...level.values()].sort(order)) {
        rows.push(h('div.tag-row', { role: 'button', tabIndex: 0, style: { paddingLeft: `${10 + depth * 16}px` }, onClick: () => this.searchFor(`tag:#${node.full}`), onKeydown: (event) => { if (event.key === 'Enter') this.searchFor(`tag:#${node.full}`); } },
          h('span.tag-name', `#${depth ? node.name : node.full}`), h('span.count', String(node.count))));
        walk(node.children, depth + 1);
      }
    };
    walk(tree, 0);
    this.tagList.replaceChildren(...(rows.length ? rows : [h('div.panel-empty', 'Aucune étiquette. Écrivez #étiquette dans une note.')]));
  },

  // ----------------------------------------------------------- right panel
  showRight(tab) { app.layout.show('right', tab); },

  refreshRight() {
    const view = app.workspace.activeNote;
    const tab = app.layout.current('right');
    if (!app.layout.visible('right', tab)) return;
    if (tab === 'graph') return this.renderLocalGraph(view);
    const target = this.right[tab].querySelector('.panel-scroll');
    if (!view || !view.loaded) { target.replaceChildren(h('div.panel-empty', 'Ouvrez une note pour voir ce panneau.')); return undefined; }
    if (tab === 'backlinks') return this.renderBacklinks(view, target);
    if (tab === 'outgoing') return this.renderOutgoing(view, target);
    return this.renderOutline(view, target);
  },

  async renderBacklinks(view, target) {
    const path = view.path;
    const ticket = (this.backlinkTicket = (this.backlinkTicket || 0) + 1);
    let data;
    try { data = await api(`/api/backlinks?path=${encodeURIComponent(path)}&unlinked=1`); } catch { return; }
    if (ticket !== this.backlinkTicket) return;
    const group = (item) => h('div.result-group', fileRow(item.path, { count: item.items.length, onOpen: (newTab) => app.workspace.openPath(item.path, { newTab, line: item.items[0].line }) }), ...item.items.map((line) => matchLine(item.path, line)));
    const linkedCount = data.linked.reduce((sum, item) => sum + item.items.length, 0);
    const unlinkedCount = data.unlinked.reduce((sum, item) => sum + item.items.length, 0);
    target.replaceChildren(
      section('Mentions liées', linkedCount, h('div', data.linked.length ? data.linked.map(group) : h('div.panel-empty', 'Aucune note ne pointe vers celle-ci.'))),
      section('Mentions non liées', unlinkedCount, h('div', data.unlinked.length ? data.unlinked.map(group) : h('div.panel-empty', 'Le nom de cette note n’apparaît nulle part ailleurs.')), false));
  },

  renderOutgoing(view, target) {
    const meta = Meta.extract(view.content);
    const seen = new Set(); const resolved = []; const missing = [];
    for (const link of meta.links) {
      if (!link.target) continue;
      const path = store.resolve(link.target, view.path);
      const key = path || `?${link.target.toLowerCase()}`;
      if (seen.has(key) || path === view.path) continue;
      seen.add(key);
      if (path) resolved.push(fileRow(path, { onOpen: (newTab) => app.workspace.openPath(path, { newTab }) }));
      else missing.push(fileRow(link.target, { unresolved: true, label: link.target, detail: 'à créer', onOpen: (newTab) => app.workspace.openLink({ target: link.target, source: view.path, newTab }) }));
    }
    target.replaceChildren(
      section('Liens', resolved.length, h('div', resolved.length ? resolved : h('div.panel-empty', 'Cette note ne contient aucun lien.'))),
      section('Liens non résolus', missing.length, h('div', missing.length ? missing : h('div.panel-empty', 'Tous les liens mènent à une note existante.'))));
  },

  renderOutline(view, target) {
    const headings = Meta.extract(view.content).headings;
    if (!headings.length) { target.replaceChildren(h('div.panel-empty', 'Aucun titre dans cette note. Commencez une ligne par # pour en créer un.')); return; }
    const top = Math.min(...headings.map((heading) => heading.level));
    target.replaceChildren(...headings.map((heading) => h('div.outline-row', {
      role: 'button', tabIndex: 0, style: { paddingLeft: `${10 + (heading.level - top) * 14}px` }, dataset: { level: String(heading.level) },
      onClick: () => view.scrollToLine(heading.line, true), onKeydown: (event) => { if (event.key === 'Enter') view.scrollToLine(heading.line, true); },
    }, Markdown.plainText(heading.text) || 'Titre vide')));
  },

  renderLocalGraph(view) {
    const pane = this.right.graph;
    if (!view) {
      if (this.localGraph) { this.localGraph.destroy(); this.localGraph = null; }
      pane.replaceChildren(h('div.panel-empty', 'Ouvrez une note pour voir son graphe local.'));
      return;
    }
    if (!this.localGraph) { this.localGraph = new GraphView({ local: true, center: view.path }); pane.replaceChildren(this.localGraph.el); }
    this.localGraph.setCenter(view.path);
    this.localGraph.onShow();
  },
};

app.panels = panels;
