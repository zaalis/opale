// Opale — the central area: tabs, the view each one shows, and per-tab
// back/forward history.
import { api, app, bus, debounce, fileUrl, h, icon, iconButton, Meta, noteTitle, reportError, showMenu } from './core.js';
import { store } from './store.js';
import { NoteView } from './note.js';
import { GraphView } from './graph.js';

let nextId = 1;

function simpleHeader(title) {
  const back = iconButton('back', 'Précédent (Alt+←)', () => workspace.back());
  const forward = iconButton('forward', 'Suivant (Alt+→)', () => workspace.forward());
  const header = h('div.view-header', h('div.view-nav', back, forward), h('div.view-crumbs', h('span.crumb.current', title)), h('div.view-actions'));
  header.update = () => { back.disabled = !workspace.canGo(-1); forward.disabled = !workspace.canGo(1); };
  return header;
}

class FileView {
  constructor(path) {
    this.type = 'file'; this.path = path;
    this.header = simpleHeader(Meta.baseName(path));
    const kind = Meta.kindOf(path); const url = fileUrl(path);
    let content;
    if (kind === 'image') content = h('div.file-stage', h('img.file-image', { src: url, alt: Meta.baseName(path) }));
    else if (kind === 'pdf') content = h('iframe.file-frame', { src: url, title: Meta.baseName(path) });
    else if (kind === 'audio') content = h('div.file-stage', h('audio', { controls: true, src: url }));
    else if (kind === 'video') content = h('div.file-stage', h('video.file-video', { controls: true, src: url }));
    else content = h('div.empty-state', h('p', `Opale n’affiche pas les fichiers « .${Meta.extOf(path) || '?'} ».`),
      h('button.btn', { type: 'button', onClick: () => api('/api/reveal', { method: 'POST', body: { path } }).catch(reportError) }, 'Afficher dans l’Explorateur Windows'));
    this.el = h('div.view.file-view', this.header, content);
  }
  updateHeader() { this.header.update(); }
  setPath(path) { this.path = path; }
  destroy() {}
}

class EmptyView {
  constructor() {
    this.type = 'empty';
    this.header = simpleHeader('Nouvel onglet');
    const action = (label, hint, run) => h('button.empty-action', { type: 'button', onClick: run }, h('span', label), hint ? h('kbd', hint) : null);
    this.el = h('div.view.empty-view', this.header, h('div.empty-state',
      h('div.empty-logo', { html: '<svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true"><defs><linearGradient id="og" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7dd3fc"/><stop offset=".5" stop-color="#a78bfa"/><stop offset="1" stop-color="#f0abfc"/></linearGradient></defs><path d="M32 4 54 20 46 52 18 52 10 20Z" fill="url(#og)" opacity=".92"/><path d="M32 4 38 24 54 20M38 24 46 52M38 24 24 30 10 20M24 30 18 52M24 30 32 4" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.4" stroke-linejoin="round"/></svg>' }),
      h('div.empty-actions',
        action('Créer une note', 'Ctrl+N', () => app.commands.run('note:new')),
        action('Ouvrir une note', 'Ctrl+O', () => app.commands.run('switcher:open')),
        action('Note du jour', '', () => app.commands.run('daily:open')),
        action('Voir le graphe', 'Ctrl+G', () => app.commands.run('graph:open')),
        action('Toutes les commandes', 'Ctrl+P', () => app.commands.run('palette:open')))));
  }
  updateHeader() { this.header.update(); }
  destroy() {}
}

function entryFor(path) { return { type: Meta.kindOf(path) === 'note' ? 'note' : 'file', path }; }
function titleOf(entry) {
  if (entry.type === 'graph') return 'Graphe';
  if (entry.type === 'empty') return 'Nouvel onglet';
  return noteTitle(entry.path);
}

export const workspace = {
  tabs: [], activeId: null,

  init(root) {
    this.tabsEl = h('div.tabs', { role: 'tablist' });
    this.viewsEl = h('div.views');
    const bar = h('div.tabbar',
      this.tabsEl,
      iconButton('plus', 'Nouvel onglet (Ctrl+T)', () => this.newTab(), '.tab-new'),
      h('div.tabbar-space'),
      iconButton('sidebar-right', 'Afficher ou masquer le panneau droit', () => app.layout.toggle('right')));
    root.append(bar, this.viewsEl);
    this.persist = debounce(() => this.persistNow(), 500);
    bus.on('index', (change) => this.onIndex(change));
  },

  get active() { return this.tabs.find((tab) => tab.id === this.activeId) || null; },
  get activeView() { const tab = this.active; return tab ? tab.view : null; },
  get activeNote() { const view = this.activeView; return view && view.type === 'note' ? view : null; },
  current(tab) { return tab.history[tab.index]; },

  makeView(entry, options) {
    if (entry.type === 'note') return new NoteView(entry.path, options);
    if (entry.type === 'graph') return new GraphView();
    if (entry.type === 'file') return new FileView(entry.path);
    return new EmptyView();
  },

  // Show `entry` in a tab: replaces what the tab displays.
  show(tab, entry, options = {}, record = true) {
    if (tab.view) { tab.view.destroy(); tab.view.el.remove(); }
    if (record) { tab.history.splice(tab.index + 1); tab.history.push({ type: entry.type, path: entry.path }); tab.index = tab.history.length - 1; }
    tab.view = this.makeView(entry, options);
    tab.view.el.hidden = tab.id !== this.activeId;
    this.viewsEl.append(tab.view.el);
    this.renderTabs();
    if (tab.id === this.activeId) this.afterActivate();
    this.persist();
  },

  createTab(entry, options = {}, activate = true) {
    const tab = { id: nextId++, history: [], index: -1, view: null };
    this.tabs.push(tab);
    this.show(tab, entry, options);
    if (activate || this.activeId === null) this.activate(tab.id);
    return tab;
  },

  activate(id) {
    const tab = this.tabs.find((item) => item.id === id);
    if (!tab) return;
    const previous = this.activeNote;
    if (previous && previous.active && tab.view !== previous) previous.commitActive();
    this.activeId = id;
    for (const item of this.tabs) item.view.el.hidden = item.id !== id;
    this.renderTabs();
    this.afterActivate();
    this.persist();
  },

  afterActivate() {
    const tab = this.active;
    if (!tab) return;
    if (tab.view.updateHeader) tab.view.updateHeader();
    if (tab.view.onShow) tab.view.onShow();
    this.announce();
    bus.emit('active-view', tab.view);
  },

  // Window title, and what the server reports as "the note being looked at".
  announce() {
    const tab = this.active;
    if (!tab) return;
    const entry = this.current(tab);
    document.title = `${titleOf(entry)} — ${app.vault ? app.vault.name : ''} — Opale`;
    api('/api/active', { method: 'POST', body: { path: entry.type === 'note' ? entry.path : '' } }).catch(() => {});
  },

  openPath(path, options = {}) {
    if (!store.has(path)) return reportError(new Error(`« ${path} » est introuvable.`));
    const entry = entryFor(path);
    const viewOptions = { mode: options.mode, subpath: options.subpath, line: options.line, focusTitle: options.focusTitle };
    const active = this.active;
    const jump = (view) => {
      if (view.type !== 'note') return;
      view.ready.then(() => { if (options.subpath) view.followAnchor(options.subpath); else if (typeof options.line === 'number') view.scrollToLine(options.line, true); });
    };
    if (!options.newTab) {
      if (active && this.current(active).path === path && this.current(active).type === entry.type) return jump(active.view);
      const existing = this.tabs.find((tab) => this.current(tab).path === path && this.current(tab).type === entry.type);
      if (existing) { this.activate(existing.id); return jump(existing.view); }
      if (active) return this.show(active, entry, viewOptions);
    }
    return this.createTab(entry, viewOptions, !options.background);
  },

  // Follow a link from a note. An unresolved link creates its note.
  async openLink({ target, subpath, path, source, newTab, view }) {
    if (!target && subpath && view && view.followAnchor) return view.followAnchor(subpath);
    const resolved = path && store.has(path) ? path : store.resolve(target, source);
    if (resolved) return this.openPath(resolved, { newTab, subpath });
    const clean = String(target || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\.md$/i, '');
    if (!clean) return undefined;
    try {
      const body = clean.includes('/') ? { folder: Meta.dirName(clean), name: Meta.baseName(clean), exact: true } : { name: clean, source, exact: true };
      const created = await api('/api/note', { method: 'POST', body });
      await this.waitFor(created.path);
      return this.openPath(created.path, { newTab });
    } catch (error) { return reportError(error); }
  },

  // The index is updated by the event stream; give it a moment to catch up
  // with a file the server has just created.
  async waitFor(path) {
    for (let i = 0; i < 40 && !store.has(path); i++) await new Promise((resolve) => setTimeout(resolve, 25));
    if (!store.has(path)) await store.load();
  },

  openGraph(options = {}) {
    const existing = this.tabs.find((tab) => this.current(tab).type === 'graph');
    if (existing && !options.newTab) return this.activate(existing.id);
    const active = this.active;
    if (active && this.current(active).type === 'empty') return this.show(active, { type: 'graph' });
    return this.createTab({ type: 'graph' });
  },

  newTab() { return this.createTab({ type: 'empty' }); },

  closeTab(id) {
    const at = this.tabs.findIndex((tab) => tab.id === id);
    if (at < 0) return;
    const [tab] = this.tabs.splice(at, 1);
    tab.view.destroy(); tab.view.el.remove();
    if (!this.tabs.length) { this.activeId = null; this.newTab(); return; }
    if (this.activeId === id) this.activate(this.tabs[Math.min(at, this.tabs.length - 1)].id);
    else this.renderTabs();
    this.persist();
  },
  closeOthers(id) { for (const tab of [...this.tabs]) if (tab.id !== id) this.closeTab(tab.id); },
  closeActive() { if (this.active) this.closeTab(this.activeId); },

  cycle(step) {
    if (this.tabs.length < 2) return;
    const at = this.tabs.findIndex((tab) => tab.id === this.activeId);
    this.activate(this.tabs[(at + step + this.tabs.length) % this.tabs.length].id);
  },

  canGo(step) { const tab = this.active; return !!tab && !!tab.history[tab.index + step]; },
  go(step) {
    const tab = this.active;
    if (!tab) return;
    // Skip entries whose file has since been deleted.
    let index = tab.index + step;
    while (tab.history[index] && tab.history[index].path && !store.has(tab.history[index].path)) index += step;
    if (!tab.history[index]) return;
    tab.index = index;
    this.show(tab, tab.history[index], {}, false);
  },
  back() { this.go(-1); },
  forward() { this.go(1); },

  renderTabs() {
    this.tabsEl.replaceChildren(...this.tabs.map((tab) => {
      const entry = this.current(tab);
      const el = h(`div.tab${tab.id === this.activeId ? '.active' : ''}`, {
        role: 'tab', 'aria-selected': tab.id === this.activeId ? 'true' : 'false', draggable: true, title: entry.path || titleOf(entry), dataset: { id: String(tab.id) },
        onMousedown: (event) => { if (event.button === 0 && !event.target.closest('.tab-close')) this.activate(tab.id); },
        onAuxclick: (event) => { if (event.button === 1) { event.preventDefault(); this.closeTab(tab.id); } },
        onContextmenu: (event) => {
          event.preventDefault();
          showMenu(event.clientX, event.clientY, [
            { label: 'Fermer', icon: 'x', run: () => this.closeTab(tab.id), hint: 'Ctrl+W' },
            { label: 'Fermer les autres onglets', run: () => this.closeOthers(tab.id), disabled: this.tabs.length < 2 },
            entry.path ? 'separator' : null,
            entry.path ? { label: 'Afficher dans l’explorateur de fichiers', icon: 'locate', run: () => app.explorer.reveal(entry.path) } : null,
          ]);
        },
        onDragstart: (event) => { event.dataTransfer.setData('application/x-opale-tab', String(tab.id)); event.dataTransfer.effectAllowed = 'move'; },
        onDragover: (event) => { if ([...event.dataTransfer.types].includes('application/x-opale-tab')) event.preventDefault(); },
        onDrop: (event) => {
          const moved = Number(event.dataTransfer.getData('application/x-opale-tab'));
          const from = this.tabs.findIndex((item) => item.id === moved); const to = this.tabs.findIndex((item) => item.id === tab.id);
          if (from < 0 || to < 0 || from === to) return;
          event.preventDefault();
          this.tabs.splice(to, 0, this.tabs.splice(from, 1)[0]);
          this.renderTabs(); this.persist();
        },
      },
      h('span.tab-icon', { html: icon(entry.type === 'graph' ? 'graph' : entry.type === 'empty' ? 'plus' : entry.type === 'file' ? 'image' : 'file', 14) }),
      h('span.tab-title', titleOf(entry)),
      h('button.tab-close', { type: 'button', title: 'Fermer l’onglet', 'aria-label': 'Fermer l’onglet', html: icon('x', 13), onClick: (event) => { event.stopPropagation(); this.closeTab(tab.id); } }));
      return el;
    }));
    const activeEl = this.tabsEl.querySelector('.tab.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },

  onIndex(change) {
    const renamed = new Map((change.renames || []).filter((pair) => pair[2] !== 'folder').map((pair) => [pair[0], pair[1]]));
    const removed = new Set((change.removes || []).filter((path) => !renamed.has(path)));
    const upserts = new Map((change.upserts || []).map((entry) => [entry.path, entry]));
    for (const tab of [...this.tabs]) {
      for (const entry of tab.history) if (entry.path && renamed.has(entry.path)) entry.path = renamed.get(entry.path);
      const view = tab.view;
      if (!view.path) continue;
      if (renamed.has(view.path)) view.setPath(renamed.get(view.path));
      if (removed.has(view.path)) {
        if (view.type === 'note') { view.saveSoon.cancel(); view.saved = view.content; }
        this.closeTab(tab.id);
        continue;
      }
      if (view.type === 'note' && upserts.has(view.path)) view.onFileChanged(upserts.get(view.path));
    }
    this.renderTabs();
    if (this.activeView && this.activeView.updateHeader) this.activeView.updateHeader();
    if (renamed.size) { this.announce(); this.persist(); }
  },

  persistNow() {
    if (!app.vault) return;
    const tabs = this.tabs.map((tab) => { const entry = this.current(tab); return { type: entry.type, path: entry.path, mode: tab.view.type === 'note' ? tab.view.mode : undefined }; });
    const state = { tabs, active: this.tabs.findIndex((tab) => tab.id === this.activeId), layout: app.layout.state(), explorer: app.explorer.state() };
    api('/api/workspace', { method: 'PUT', body: state }).catch(() => {});
  },

  restore(saved, pendingOpen) {
    const tabs = Array.isArray(saved && saved.tabs) ? saved.tabs : [];
    for (const item of tabs) {
      if (item.type === 'graph') this.createTab({ type: 'graph' }, {}, false);
      else if (item.type === 'empty') this.createTab({ type: 'empty' }, {}, false);
      else if (item.path && store.has(item.path)) this.createTab(entryFor(item.path), { mode: item.mode }, false);
    }
    if (pendingOpen && store.has(pendingOpen)) { this.openPath(pendingOpen, { newTab: this.tabs.length > 0 }); return; }
    if (!this.tabs.length) {
      // First visit: land on the welcome note when the vault has one.
      const welcome = store.has('Bienvenue.md') ? 'Bienvenue.md' : null;
      if (welcome) this.createTab(entryFor(welcome)); else this.newTab();
      return;
    }
    const wanted = this.tabs[Math.max(0, Math.min(Number(saved && saved.active) || 0, this.tabs.length - 1))];
    this.activate(wanted.id);
  },

  async flushAll() { await Promise.all(this.tabs.map((tab) => (tab.view.type === 'note' ? tab.view.flush() : null))); },
};

app.workspace = workspace;
