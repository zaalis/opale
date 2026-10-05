// Opale — start-up: load the vault, build the window, follow server events.
import { api, app, bus, h, Meta, toast } from './core.js';
import { store } from './store.js';
import { layout } from './layout.js';
import { workspace } from './workspace.js';
import { explorer } from './explorer.js';
import { panels } from './panels.js';
import { commands } from './commands.js';
import { settingsUi } from './settings.js';
import { launcher } from './launcher.js';
import { uploadFile } from './editing.js';

const root = document.getElementById('app');

const ACTIVITY = {
  write_note: 'a écrit', append_to_note: 'a complété', edit_note: 'a modifié', set_properties: 'a mis à jour les propriétés de',
  create_folder: 'a créé le dossier', move: 'a déplacé', delete: 'a supprimé', daily_note: 'a ouvert la note du jour',
};
let lastActivityToast = 0;

function onActivity(event) {
  if (event.tool === 'connect') { toast(`${event.client || 'Un assistant'} est connecté à ce coffre`, { kind: 'agent', duration: 6000 }); return; }
  // A batch of edits should not bury the screen in messages.
  if (Date.now() - lastActivityToast < 2500) return;
  lastActivityToast = Date.now();
  const who = app.agent.client || 'L’assistant';
  if (event.tool === 'move_many') { toast(`${who} a réorganisé des fichiers`, { kind: 'agent' }); return; }
  const verb = ACTIVITY[event.tool];
  if (!verb || !event.path) return;
  const name = Meta.kindOf(event.path) === 'note' ? Meta.stem(event.path) : Meta.baseName(event.path);
  const canOpen = event.tool !== 'delete' && event.tool !== 'create_folder';
  toast(`${who} ${verb} « ${name} »`, { kind: 'agent', action: canOpen ? { label: 'Ouvrir', run: () => workspace.waitFor(event.path).then(() => workspace.openPath(event.path)) } : undefined });
}

function connectEvents() {
  const source = new EventSource('/api/events');
  let dropped = false; let banner = null;
  source.addEventListener('hello', async () => {
    if (!dropped) return;
    dropped = false;
    if (banner) { banner.remove(); banner = null; }
    // Anything may have changed while the stream was down: reload the index.
    try { await store.load(); bus.emit('index', { upserts: [], removes: [], renames: [] }); } catch {}
  });
  source.addEventListener('fs', (event) => store.apply(JSON.parse(event.data)));
  source.addEventListener('vault', () => location.reload());
  source.addEventListener('agent', (event) => { app.agent = JSON.parse(event.data); bus.emit('agent', app.agent); });
  source.addEventListener('activity', (event) => onActivity(JSON.parse(event.data)));
  // An assistant asks to show a note: never replace what the user is reading.
  source.addEventListener('open-note', (event) => {
    const { path } = JSON.parse(event.data);
    workspace.waitFor(path).then(() => {
      const open = workspace.tabs.find((tab) => tab.view.path === path);
      if (open) workspace.activate(open.id); else workspace.openPath(path, { newTab: true });
    });
  });
  source.onerror = () => {
    if (dropped) return;
    dropped = true;
    banner = h('div.offline', 'Connexion au serveur Opale interrompue. Nouvelle tentative en cours…');
    document.body.append(banner);
  };
}

function installFileDrop() {
  let depth = 0;
  const hasFiles = (event) => event.dataTransfer && [...event.dataTransfer.types].includes('Files');
  // While a picture is dragged over the live view, show where it will land.
  let preview = 0;
  const clearPreview = () => { cancelAnimationFrame(preview); preview = 0; document.body.classList.remove('is-dropping-note'); const note = workspace.activeNote; if (note) note.clearDropPreview(); };
  const clear = () => { depth = 0; document.body.classList.remove('is-dropping'); clearPreview(); for (const target of document.querySelectorAll('.tree.drop-target, .tree .drop-target')) target.classList.remove('drop-target'); };
  // Child views handle their own drops and may stop propagation.
  document.addEventListener('drop', clear, true);
  document.addEventListener('dragend', clear, true);
  window.addEventListener('blur', clear);
  document.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    depth++;
    document.body.classList.add('is-dropping');
  });
  document.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    const note = workspace.activeNote;
    if (!note || preview || event.target.closest('.tree, textarea')) { if (note && event.target.closest('.tree, textarea')) { note.clearDropPreview(); document.body.classList.remove('is-dropping-note'); } return; }
    const { clientX: x, clientY: y } = event;
    preview = requestAnimationFrame(() => { preview = 0; document.body.classList.toggle('is-dropping-note', note.previewDrop(x, y)); });
  });
  document.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) { document.body.classList.remove('is-dropping'); clearPreview(); }
  });
  document.addEventListener('drop', async (event) => {
    if (!hasFiles(event)) return;
    clear();
    // The explorer owns direct imports into its selected folder; a textarea
    // already owns precise caret insertion.
    if (event.target.closest('.tree, textarea')) return;
    event.preventDefault();
    const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith('image/') || Meta.kindOf(file.name) === 'image');
    if (!files.length) { toast('Déposez une image (PNG, JPEG, WebP, SVG…).', { kind: 'error' }); return; }
    const note = workspace.activeNote;
    if (!note) return explorer.importImages(files, explorer.targetFolder() || '');
    // Decided now, before the upload: the page may move in the meantime.
    const target = note.dropTargetAt(event.clientX, event.clientY);
    try {
      const paths = [];
      for (const file of files) paths.push(await uploadFile(file, note.path));
      await Promise.all(paths.map((path) => workspace.waitFor(path)));
      await note.insertAttachments(paths, { files, target });
      toast(`${paths.length} image${paths.length > 1 ? 's ajoutées' : ' ajoutée'} à la note.`);
    } catch (error) { console.error(error); toast(error.message || String(error), { kind: 'error' }); }
  });
}

async function start() {
  let state;
  try { state = await api('/api/state'); }
  catch (error) { root.replaceChildren(h('div.fatal', h('h1', 'Opale ne répond pas'), h('p', error.message), h('button.btn.primary', { type: 'button', onClick: () => location.reload() }, 'Réessayer'))); return; }
  app.version = state.version;
  if (!state.vault) { document.title = 'Opale'; launcher.showFull(state, root); return; }

  app.vault = state.vault; app.settings = state.settings; app.bookmarks = state.bookmarks; app.snippets = state.snippets; app.agent = state.agent || {};
  settingsUi.apply();
  await store.load();

  layout.init(root);
  workspace.init(layout.main);
  explorer.init(layout.sides.left.panes.files);
  panels.init(layout.sides.left.panes, layout.sides.right.panes);
  commands.init();

  const saved = state.workspace || {};
  layout.restore(saved.layout);
  layout.setVault(app.vault);
  explorer.restore(saved.explorer);
  workspace.restore(saved, state.pendingOpen);
  panels.renderTags(); panels.renderBookmarks(); panels.refreshRight();
  layout.updateAgent(); layout.updateStatus();
  installFileDrop();

  // Settings that change how an open note is drawn.
  bus.on('settings', (patch) => { if (patch && ('spellcheck' in patch || 'showProperties' in patch)) for (const tab of workspace.tabs) if (tab.view.type === 'note' && tab.view.loaded && !tab.view.active) tab.view.render(); });

  connectEvents();
  const flush = () => { app.unloading = true; workspace.flushAll(); workspace.persist.flush(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') workspace.flushAll(); });
}

start();
