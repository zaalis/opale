// Opale — window frame: ribbon, the two resizable side bars with their tabs,
// the central area and the status bar.
import { app, bus, debounce, h, icon, iconButton } from './core.js';
import { store } from './store.js';

const LEFT_TABS = [['files', 'files', 'Fichiers'], ['search', 'search', 'Rechercher (Ctrl+Maj+F)'], ['bookmarks', 'bookmark', 'Signets'], ['tags', 'tag', 'Étiquettes']];
const RIGHT_TABS = [['backlinks', 'link-in', 'Rétroliens'], ['outgoing', 'link-out', 'Liens sortants'], ['outline', 'outline', 'Plan de la note'], ['graph', 'graph', 'Graphe local']];

function buildSide(side, tabs) {
  const panes = {}; const buttons = {};
  const tabBar = h('div.sidebar-tabs', { role: 'tablist' });
  const body = h('div.sidebar-body');
  for (const [key, iconName, title] of tabs) {
    buttons[key] = iconButton(iconName, title, () => layout.show(side, key), '.sidebar-tab');
    buttons[key].setAttribute('role', 'tab');
    panes[key] = h('div.sidebar-pane', { hidden: true, role: 'tabpanel', 'aria-label': title });
    tabBar.append(buttons[key]); body.append(panes[key]);
  }
  const el = h(`aside.sidebar.${side}`, tabBar, body);
  return { el, panes, buttons, tab: tabs[0][0], open: true, width: side === 'left' ? 280 : 300 };
}

export const layout = {
  init(root) {
    this.sides = { left: buildSide('left', LEFT_TABS), right: buildSide('right', RIGHT_TABS) };
    this.main = h('main.main');
    this.vaultName = h('span.vault-name');
    this.sides.left.el.append(h('div.vault-footer',
      h('button.vault-switch', { type: 'button', title: 'Changer de coffre', onClick: () => app.commands.run('vault:switch') }, h('span', { html: icon('vault', 16) }), this.vaultName),
      iconButton('settings', 'Paramètres (Ctrl+,)', () => app.commands.run('settings:open'))));
    const ribbon = h('nav.ribbon', { 'aria-label': 'Actions rapides' },
      iconButton('sidebar-left', 'Afficher ou masquer le panneau gauche', () => this.toggle('left')),
      iconButton('search', 'Ouvrir une note (Ctrl+O)', () => app.commands.run('switcher:open')),
      iconButton('graph', 'Graphe (Ctrl+G)', () => app.commands.run('graph:open')),
      iconButton('calendar', 'Note du jour', () => app.commands.run('daily:open')),
      iconButton('template', 'Insérer un modèle', () => app.commands.run('template:insert')),
      iconButton('dice', 'Note au hasard', () => app.commands.run('note:random')),
      iconButton('command', 'Palette de commandes (Ctrl+P)', () => app.commands.run('palette:open')),
      h('div.ribbon-space'),
      iconButton('sparkle', 'Connexion à zaalis IDE', () => app.commands.run('settings:connection'), '.ribbon-agent'));
    this.agentButton = ribbon.querySelector('.ribbon-agent');
    this.status = h('footer.statusbar');
    this.resizers = { left: this.resizer('left'), right: this.resizer('right') };
    root.append(h('div.workspace', ribbon, this.sides.left.el, this.resizers.left, this.main, this.resizers.right, this.sides.right.el), this.status);
    this.buildStatus();
    this.apply();
    this.notify = debounce(() => bus.emit('layout'), 30);
  },

  resizer(side) {
    const handle = h(`div.resizer.${side}`, { role: 'separator', 'aria-orientation': 'vertical', title: 'Glisser pour redimensionner' });
    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const start = event.clientX; const width = this.sides[side].width;
      document.body.classList.add('resizing');
      const move = (moveEvent) => {
        const delta = (moveEvent.clientX - start) * (side === 'left' ? 1 : -1);
        this.sides[side].width = Math.max(190, Math.min(640, width + delta));
        this.apply();
      };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('resizing'); app.workspace.persist(); bus.emit('layout'); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    });
    return handle;
  },

  apply() {
    for (const [name, side] of Object.entries(this.sides)) {
      side.el.hidden = !side.open;
      side.el.style.width = `${side.width}px`;
      this.resizers[name].hidden = !side.open;
      for (const [key, pane] of Object.entries(side.panes)) {
        pane.hidden = key !== side.tab;
        side.buttons[key].classList.toggle('active', key === side.tab);
        side.buttons[key].setAttribute('aria-selected', String(key === side.tab));
      }
    }
  },

  show(side, tab) {
    const target = this.sides[side];
    if (tab && target.panes[tab]) target.tab = tab;
    target.open = true;
    this.apply(); this.notify();
    if (app.workspace.persist) app.workspace.persist();
  },
  toggle(side) {
    this.sides[side].open = !this.sides[side].open;
    this.apply(); this.notify();
    app.workspace.persist();
  },
  current(side) { return this.sides[side].tab; },
  visible(side, tab) { const target = this.sides[side]; return target.open && target.tab === tab; },

  state() { return Object.fromEntries(Object.entries(this.sides).map(([name, side]) => [name, { open: side.open, tab: side.tab, width: side.width }])); },
  restore(state) {
    for (const [name, side] of Object.entries(this.sides)) {
      const saved = state && state[name];
      if (!saved) continue;
      side.open = saved.open !== false;
      if (side.panes[saved.tab]) side.tab = saved.tab;
      if (Number(saved.width) >= 190) side.width = Math.min(640, Number(saved.width));
    }
    this.apply();
  },

  // ------------------------------------------------------------ status bar
  buildStatus() {
    this.statusAgent = h('button.status-item.status-agent', { type: 'button', hidden: true, onClick: () => app.commands.run('settings:connection') });
    this.statusSave = h('span.status-item.status-save');
    this.statusBacklinks = h('button.status-item', { type: 'button', title: 'Afficher les rétroliens', onClick: () => this.show('right', 'backlinks') });
    this.statusWords = h('span.status-item');
    this.statusMode = h('button.status-item', { type: 'button', title: 'Changer de mode d’affichage', onClick: () => { const view = app.workspace.activeNote; if (view) view.toggleReading(); } });
    this.status.append(this.statusAgent, h('div.status-space'), this.statusSave, this.statusBacklinks, this.statusWords, this.statusMode);
    const refresh = debounce(() => this.updateStatus(), 200);
    for (const event of ['active-view', 'note-content', 'note-saved', 'note-mode', 'note-rendered', 'index']) bus.on(event, refresh);
    bus.on('agent', () => this.updateAgent());
  },

  updateStatus() {
    const view = app.workspace.activeNote;
    for (const item of [this.statusSave, this.statusBacklinks, this.statusWords, this.statusMode]) item.hidden = !view || !view.loaded;
    if (!view || !view.loaded) return;
    const stats = view.stats();
    this.statusSave.textContent = view.conflict ? 'Conflit' : view.dirty ? 'Enregistrement…' : 'Enregistré';
    this.statusSave.classList.toggle('warn', !!view.conflict);
    this.statusBacklinks.textContent = `${stats.backlinks} rétrolien${stats.backlinks > 1 ? 's' : ''}`;
    this.statusWords.textContent = `${stats.words} mot${stats.words > 1 ? 's' : ''} · ${stats.chars} caractère${stats.chars > 1 ? 's' : ''}`;
    this.statusMode.textContent = { live: 'Aperçu en direct', source: 'Source', reading: 'Lecture' }[view.mode];
  },

  updateAgent() {
    const agent = app.agent || {};
    const on = !!agent.active;
    this.statusAgent.hidden = !on;
    this.statusAgent.replaceChildren(h('span.dot'), `${agent.client || 'Assistant'} connecté`);
    this.statusAgent.title = on ? `${agent.calls || 0} action(s) dans ce coffre` : '';
    this.agentButton.classList.toggle('on', on);
    this.agentButton.title = on ? `${agent.client || 'Assistant'} est connecté à ce coffre` : 'Connexion à zaalis IDE';
  },

  setVault(vault) { this.vaultName.textContent = vault ? vault.name : ''; this.vaultName.title = vault ? vault.path : ''; },
  counts() { return { notes: store.notes().length }; },
};

app.layout = layout;
