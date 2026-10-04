// Opale — settings window, and the application of settings to the page.
import { api, app, bus, confirmDialog, h, icon, openModal, reportError, toast } from './core.js';
import { store } from './store.js';

const ACCENTS = ['#fbbf24', '#8b7cf6', '#38bdf8', '#2dd4bf', '#4ade80', '#fb7185', '#e879f9'];

const SECTIONS = [
  ['editor', 'Éditeur'], ['files', 'Fichiers et liens'], ['appearance', 'Apparence'], ['daily', 'Notes quotidiennes et modèles'],
  ['hotkeys', 'Raccourcis clavier'], ['connection', 'Connexion à zaalis IDE'], ['about', 'À propos'],
];

function row(label, hint, control) {
  return h('div.setting', h('div.setting-text', h('div.setting-label', label), hint ? h('div.setting-hint', hint) : null), h('div.setting-control', control));
}
function toggle(key, label) {
  const input = h('input', { type: 'checkbox', checked: !!app.settings[key], 'aria-label': label, onChange: () => settingsUi.change({ [key]: input.checked }) });
  return h('label.switch', input, h('span.switch-track'));
}
function select(key, label, options) {
  const input = h('select.select', { 'aria-label': label, onChange: () => settingsUi.change({ [key]: input.value }) }, options.map(([value, text]) => h('option', { value, selected: app.settings[key] === value }, text)));
  return input;
}
function numberSelect(key, label, options) {
  const input = h('select.select', { 'aria-label': label, onChange: () => settingsUi.change({ [key]: Number(input.value) }) }, options.map(([value, text]) => h('option', { value: String(value), selected: Number(app.settings[key]) === value }, text)));
  return input;
}
function text(key, label, placeholder) {
  const input = h('input.text-input', { type: 'text', value: app.settings[key] || '', placeholder: placeholder || '', spellcheck: false, 'aria-label': label, onChange: () => settingsUi.change({ [key]: input.value.trim() }) });
  return input;
}

const PANES = {
  editor: () => [
    row('Mode par défaut', 'Comment une note s’ouvre.', select('defaultMode', 'Mode par défaut', [['live', 'Aperçu en direct'], ['source', 'Source'], ['reading', 'Lecture']])),
    row('Largeur de ligne lisible', 'Limite la largeur du texte pour le confort de lecture.', toggle('readableLineLength', 'Largeur de ligne lisible')),
    row('Taille du texte', `${app.settings.fontSize} px`, (() => {
      const input = h('input', { type: 'range', min: '12', max: '24', step: '1', value: String(app.settings.fontSize), 'aria-label': 'Taille du texte', onInput: () => { document.documentElement.style.setProperty('--font-size', `${input.value}px`); input.closest('.setting').querySelector('.setting-hint').textContent = `${input.value} px`; }, onChange: () => settingsUi.change({ fontSize: Number(input.value) }) });
      return input;
    })()),
    row('Afficher les propriétés', 'Montre le bloc de propriétés (frontmatter) en haut des notes.', toggle('showProperties', 'Afficher les propriétés')),
    row('Correcteur orthographique', 'Souligne les fautes pendant la saisie.', toggle('spellcheck', 'Correcteur orthographique')),
  ],
  files: () => [
    row('Emplacement des nouvelles notes', 'Où Ctrl+N crée une note.', select('newNoteLocation', 'Emplacement des nouvelles notes', [['root', 'Racine du coffre'], ['current', 'Même dossier que la note active'], ['folder', 'Dossier indiqué ci-dessous']])),
    row('Dossier des nouvelles notes', 'Utilisé avec « Dossier indiqué ».', text('newNoteFolder', 'Dossier des nouvelles notes', 'Boîte de réception')),
    row('Emplacement des pièces jointes', 'Où vont les images collées ou déposées.', select('attachmentLocation', 'Emplacement des pièces jointes', [['folder', 'Dossier indiqué ci-dessous'], ['current', 'Même dossier que la note'], ['root', 'Racine du coffre']])),
    row('Dossier des pièces jointes', '', text('attachmentFolder', 'Dossier des pièces jointes', 'Pièces jointes')),
    row('Taille des images insérées', 'Largeur donnée à une image collée ou déposée dans une note. Une image plus petite garde sa taille.', numberSelect('imageWidth', 'Taille des images insérées', [[240, 'Petite (240 px)'], [400, 'Moyenne (400 px)'], [640, 'Grande (640 px)'], [0, 'Taille d’origine']])),
    row('Fichiers supprimés', 'Ce que devient un fichier supprimé.', select('trash', 'Fichiers supprimés', [['local', 'Corbeille du coffre (.trash)'], ['system', 'Corbeille de Windows'], ['permanent', 'Suppression définitive']])),
    row('Mettre à jour les liens', 'Réécrit les liens quand une note est renommée ou déplacée.', toggle('autoUpdateLinks', 'Mettre à jour les liens')),
  ],
  appearance: () => [
    row('Thème', '', select('theme', 'Thème', [['dark', 'Sombre'], ['light', 'Clair']])),
    row('Couleur d’accent', 'Liens, sélection et éléments actifs.', h('div.accents',
      ACCENTS.map((colour) => h(`button.accent${app.settings.accent === colour ? '.active' : ''}`, { type: 'button', title: colour, 'aria-label': `Couleur ${colour}`, style: { background: colour }, onClick: () => settingsUi.change({ accent: colour }).then(() => settingsUi.show('appearance')) })),
      h('input.accent-custom', { type: 'color', value: app.settings.accent, 'aria-label': 'Couleur personnalisée', onChange: (event) => settingsUi.change({ accent: event.target.value }).then(() => settingsUi.show('appearance')) }))),
    h('p.setting-note', 'Pour aller plus loin, déposez des fichiers .css dans le dossier ', h('code', '.opale/snippets'), ' du coffre : ils sont chargés au démarrage.'),
  ],
  daily: () => [
    row('Dossier des notes quotidiennes', '', text('dailyFolder', 'Dossier des notes quotidiennes', 'Journal')),
    row('Format de date', 'YYYY année, MM mois, DD jour, dddd jour de la semaine, MMMM mois en lettres.', text('dailyFormat', 'Format de date', 'YYYY-MM-DD')),
    row('Modèle de note quotidienne', 'Nom d’une note dont le contenu sert de point de départ.', text('dailyTemplate', 'Modèle de note quotidienne', 'Modèles/Quotidien')),
    row('Dossier des modèles', 'Les notes de ce dossier sont proposées par « Insérer un modèle ».', text('templateFolder', 'Dossier des modèles', 'Modèles')),
    h('p.setting-note', 'Dans un modèle : ', h('code', '{{title}}'), ', ', h('code', '{{date}}'), ', ', h('code', '{{time}}'), ' ou ', h('code', '{{date:dddd D MMMM YYYY}}'), '.'),
  ],
  hotkeys: () => [h('div.hotkeys', app.commands.hotkeys().sort((a, b) => a.name.localeCompare(b.name)).map((item) => h('div.hotkey', h('span', item.name), h('kbd', item.hotkey))))],
  connection: () => {
    const box = h('div.connection', h('div.panel-empty', 'Chargement…'));
    api('/api/connection').then((info) => {
      const agent = info.agent || {};
      let shown = false;
      const token = h('code.token', '•'.repeat(24));
      const reveal = h('button.btn.small', { type: 'button', onClick: () => { shown = !shown; token.textContent = shown ? info.token : '•'.repeat(24); reveal.textContent = shown ? 'Masquer' : 'Afficher'; } }, 'Afficher');
      const copy = (value, what) => navigator.clipboard.writeText(value).then(() => toast(`${what} copié`));
      box.replaceChildren(
        h(`div.connection-status${agent.active ? '.on' : ''}`, h('span.dot'), agent.active ? `${agent.client || 'Un assistant'} est connecté — ${agent.calls} action(s), dernière : ${agent.lastTool || '—'}` : 'Aucun assistant connecté pour le moment.'),
        h('p.setting-note', 'Dans zaalis IDE : ', h('strong', 'Paramètres → MCP → Opale → Connecter'), '. L’IDE détecte Opale tant que cette fenêtre est ouverte, et son assistant peut alors lire, écrire et réorganiser ce coffre.'),
        row('Adresse MCP', 'Pour relier un autre client MCP (Streamable HTTP).', h('div.inline', h('code', info.endpoint), h('button.btn.small', { type: 'button', onClick: () => copy(info.endpoint, 'Adresse') }, 'Copier'))),
        row('Jeton d’accès', 'À transmettre comme jeton Bearer. Donne accès à tout le coffre.', h('div.inline', token, reveal, h('button.btn.small', { type: 'button', onClick: () => copy(info.token, 'Jeton') }, 'Copier'))),
        row('Révoquer l’accès', 'Génère un nouveau jeton : tout client déjà connecté devra se reconnecter.', h('button.btn.small.danger', { type: 'button', onClick: async () => {
          if (!await confirmDialog({ title: 'Régénérer le jeton', message: 'Les programmes connectés à Opale perdront leur accès jusqu’à leur reconnexion.', confirm: 'Régénérer', danger: true })) return;
          try { await api('/api/connection/rotate', { method: 'POST', body: {} }); settingsUi.show('connection'); toast('Nouveau jeton généré'); } catch (error) { reportError(error); }
        } }, 'Régénérer le jeton')),
        h('details.tools', h('summary', `${info.tools.length} outils proposés à l’assistant`), h('ul', info.tools.map((tool) => h('li', h('code', tool.name), ' — ', tool.description)))));
    }).catch((error) => box.replaceChildren(h('div.panel-empty', error.message)));
    return [box];
  },
  about: () => [
    h('div.about', h('div.about-name', 'Opale'), h('div.about-version', `Version ${app.version}`),
      h('p', 'Carnet de notes Markdown local : vos notes sont de simples fichiers dans un dossier.'),
      row('Coffre ouvert', app.vault.path, h('button.btn.small', { type: 'button', onClick: () => api('/api/reveal', { method: 'POST', body: { path: '' } }).catch(reportError) }, 'Ouvrir le dossier')),
      row('Contenu', `${store.notes().length} notes · ${store.files.size - store.notes().length} autres fichiers · ${store.folders.length} dossiers`, h('span'))),
  ],
};

export const settingsUi = {
  modal: null, section: 'editor',

  apply() {
    const settings = app.settings || {};
    const root = document.documentElement;
    root.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
    const accent = /^#[0-9a-f]{6}$/i.test(settings.accent || '') ? settings.accent : '#fbbf24';
    root.style.setProperty('--accent', accent);
    // Light accents (yellow, green…) need dark text on primary buttons.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
    root.style.setProperty('--on-accent', 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1c1407' : '#fff');
    root.style.setProperty('--font-size', `${Math.max(12, Math.min(24, Number(settings.fontSize) || 16))}px`);
    document.body.classList.toggle('readable', settings.readableLineLength !== false);
    document.body.classList.toggle('hide-properties', settings.showProperties === false);
    let style = document.getElementById('snippets');
    if (!style) { style = h('style', { id: 'snippets' }); document.head.append(style); }
    style.textContent = app.snippets || '';
  },

  async change(patch) {
    try {
      const result = await api('/api/settings', { method: 'PUT', body: patch });
      app.settings = result.settings;
      this.apply();
      bus.emit('settings', patch);
    } catch (error) { reportError(error); }
  },

  show(section) {
    if (!this.modal) return;
    this.section = PANES[section] ? section : 'editor';
    for (const button of this.nav.children) button.classList.toggle('active', button.dataset.section === this.section);
    this.title.textContent = SECTIONS.find((item) => item[0] === this.section)[1];
    this.pane.replaceChildren(...PANES[this.section]());
    this.pane.scrollTop = 0;
  },

  open(section) {
    if (this.modal) { this.show(section || this.section); return; }
    this.nav = h('nav.settings-nav', { 'aria-label': 'Sections des paramètres' }, SECTIONS.map(([key, label]) => h('button.settings-nav-item', { type: 'button', dataset: { section: key }, onClick: () => this.show(key) }, label)));
    this.title = h('h2.settings-title');
    this.pane = h('div.settings-pane');
    const close = h('button.icon-btn', { type: 'button', title: 'Fermer', 'aria-label': 'Fermer', html: icon('x'), onClick: () => this.modal.close() });
    this.modal = openModal({ className: 'modal-settings', body: h('div.settings', this.nav, h('div.settings-main', h('div.settings-head', this.title, close), this.pane)), onClose: () => { this.modal = null; } });
    this.show(section || this.section);
  },
};

app.settings_ui = settingsUi;
