// Opale — a moodboard open in a tab: an infinite board of stickies, shapes,
// drawings, pictures, notes and the rest, saved to its ".canvas" file as you
// work. This module holds the document, the camera, drawing and saving; the
// pointer and keyboard live in input.js, the toolbars and panels in ui.js.
import { api, app, bus, h, iconButton, Meta, reportError, toast } from '../core.js';
import { store } from '../store.js';
import { History } from './history.js';
import { createNode, place, placeConnector, render } from './render.js';
import { WIDGETS } from './widgets.js';
import { Input } from './input.js';
import { BoardUi } from './ui.js';

const Board = window.OpaleBoard;
export const MIN_ZOOM = 0.05; export const MAX_ZOOM = 8;
const SAVE_DELAY = 500; const SAVE_MAX_WAIT = 3000;

// "a.b.2.c" inside an object.
export function getPath(data, path) {
  if (path.startsWith('node.')) { const hit = findTopic(data.root, path.slice(5)); return hit ? hit.node.text : ''; }
  if (path === 'tags') return (data.tags || []).join(', ');
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), data);
}
export function setPath(data, path, value) {
  if (path.startsWith('node.')) { const hit = findTopic(data.root, path.slice(5)); if (hit) hit.node.text = value; return; }
  if (path === 'tags') { data.tags = value.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean); return; }
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((value, key) => (value == null ? undefined : value[key]), data);
  if (parent != null) parent[last] = value;
}
function findTopic(root, id, parent = null) {
  if (!root) return null;
  if (root.id === id) return { node: root, parent };
  for (const child of root.children || []) { const hit = findTopic(child, id, root); if (hit) return hit; }
  return null;
}

export class BoardView {
  constructor(path, options = {}) {
    this.type = 'board';
    this.path = path;
    this.doc = Board.emptyDoc();
    this.byId = new Map();
    this.lookup = (id) => this.byId.get(id);
    this.nodes = new Map();
    this.selection = new Set();
    this.camera = { x: 0, y: 0, k: 1 };
    this.savedCamera = options.camera && Number.isFinite(options.camera.k) ? options.camera : null;
    this.history = new History(this);
    this.dirtyIds = new Set(); this.orderDirty = false; this.frame = 0;
    this.loaded = false; this.readOnly = false; this.conflict = false;
    this.saving = false; this.pendingMtime = null; this.mtime = 0; this.savedText = '';
    this.unsaved = false; this.firstUnsaved = 0; this.saveTimer = null;
    this.widgetFocus = null; this.interacting = null; this.editing = null;
    this.build();
    this.input = new Input(this);
    this.ui = new BoardUi(this);
    this.off = [
      bus.on('settings', () => this.redrawAll()),
      bus.on('index', (change) => this.onIndex(change)),
    ];
    this.ready = this.load();
  }

  // ------------------------------------------------------------ structure
  build() {
    const back = iconButton('back', 'Précédent (Alt+←)', () => app.workspace.back());
    const forward = iconButton('forward', 'Suivant (Alt+→)', () => app.workspace.forward());
    this.crumbs = h('div.view-crumbs');
    this.actions = h('div.view-actions');
    this.header = h('div.view-header.board-header', h('div.view-nav', back, forward), this.crumbs, this.actions);
    this.header.update = () => { back.disabled = !app.workspace.canGo(-1); forward.disabled = !app.workspace.canGo(1); };
    this.banner = h('div.note-banner', { hidden: true });
    this.world = h('div.board-world');
    this.overlay = h('div.board-overlay');
    this.stage = h('div.board-stage', { tabIndex: 0, 'aria-label': 'Moodboard' }, this.world, this.overlay);
    this.el = h('div.view.board-view', this.header, this.banner, this.stage);
    this.resize = new ResizeObserver(() => { this.applyCamera(); this.ui.update(); });
    this.resize.observe(this.stage);
  }

  updateHeader() {
    this.header.update();
    const folder = Meta.dirName(this.path);
    this.crumbs.replaceChildren(...(folder ? [h('span.crumb', folder), h('span.crumb-sep', '/')] : []), h('span.crumb.current', Meta.stem(this.path)));
  }
  setPath(path) { this.path = path; this.updateHeader(); }

  // The board is a separate mode: the side panels step aside while it shows.
  onShow() {
    this.updateHeader();
    if (!this.focusLayout && app.layout && app.layout.focusMode) this.focusLayout = app.layout.focusMode(true);
    requestAnimationFrame(() => { this.applyCamera(); this.ui.update(); });
  }
  onHide() {
    if (this.focusLayout) { this.focusLayout(); this.focusLayout = null; }
    if (this.editing) this.finishEdit(true);
    this.flush();
  }

  // ----------------------------------------------------------------- data
  layer(id) { return this.doc.layers.find((layer) => layer.id === (id || 'base')) || this.doc.layers[0]; }
  nodeOf(id) { return this.nodes.get(id) || null; }
  get selected() { return [...this.selection].map((id) => this.byId.get(id)).filter(Boolean); }

  reindex() { this.byId = new Map(this.doc.elements.map((el) => [el.id, el])); for (const id of this.nodes.keys()) if (!this.byId.has(id)) this.dirtyIds.add(id); }

  // What, besides the element itself, changes how it looks.
  contentKey(el) {
    const file = el.data.file || el.data.image;
    const entry = file ? store.files.get(file) : null;
    return [entry ? entry.mtime : 0, el.kind === 'sticky' && this.doc.settings.privateMode, this.interacting === el.id, el.kind === 'mermaid' && document.documentElement.dataset.theme, this.widgetFocus && this.widgetFocus.id === el.id ? this.widgetFocus.node : ''];
  }

  // -------------------------------------------------------------- loading
  async load() {
    try {
      const file = await api(`/api/note?path=${encodeURIComponent(this.path)}`);
      this.adoptText(file.content, file.mtime);
      this.loaded = true;
      if (this.savedCamera) this.setCamera(this.savedCamera.x, this.savedCamera.y, this.savedCamera.k);
      else this.zoomToFit(false);
      this.ui.update();
    } catch (error) {
      this.stage.replaceChildren(h('div.empty-state', h('p', error.status === 404 ? 'Ce moodboard n’existe plus.' : `Impossible d’ouvrir le moodboard : ${error.message}`)));
    }
  }

  adoptText(text, mtime) {
    const { doc, problem } = Board.parse(text);
    this.mtime = mtime; this.savedText = text;
    this.readOnly = !!problem;
    if (problem) this.showBanner(`${problem} Le moodboard est ouvert en lecture seule pour ne pas écraser le fichier.`, [['Ouvrir comme texte', () => this.openAsText()]]);
    else if (!this.conflict) this.hideBanner();
    this.doc = doc;
    this.reindex();
    this.selection = new Set([...this.selection].filter((id) => this.byId.has(id)));
    this.renderAll();
  }

  openAsText() { app.workspace.openPath(this.path, { newTab: true, asText: true }); }

  // ------------------------------------------------------------ rendering
  renderAll() {
    this.world.replaceChildren();
    this.nodes.clear();
    for (const el of this.doc.elements) {
      const node = createNode(el);
      this.nodes.set(el.id, node);
      this.world.append(node);
    }
    for (const el of this.doc.elements) render(this, el, this.nodes.get(el.id));
    this.dirtyIds.clear(); this.orderDirty = false;
    this.ui.update();
  }
  redrawAll() { for (const node of this.nodes.values()) node.renderKey = null; this.sync(); }
  redraw(el) { const node = this.nodes.get(el.id); if (node) node.renderKey = null; this.sync([el.id]); }

  // Draw again what changed, once per frame.
  sync(ids) {
    if (ids) for (const id of ids) this.dirtyIds.add(id);
    else for (const el of this.doc.elements) this.dirtyIds.add(el.id);
    if (!this.frame) this.frame = requestAnimationFrame(() => this.paint());
  }
  syncOrder() { this.orderDirty = true; this.sync([]); }

  paint() {
    this.frame = 0;
    const moved = new Set();
    for (const id of this.dirtyIds) {
      const el = this.byId.get(id);
      let node = this.nodes.get(id);
      if (!el) { if (node) { node.remove(); this.nodes.delete(id); } continue; }
      if (!node) { node = createNode(el); this.nodes.set(id, node); this.world.append(node); this.orderDirty = true; }
      render(this, el, node);
      if (el.kind !== 'connector') moved.add(id);
    }
    this.dirtyIds.clear();
    // Lines follow what they join.
    if (moved.size) {
      for (const el of this.doc.elements) {
        if (el.kind !== 'connector') continue;
        if (moved.has(el.from.id) || moved.has(el.to.id)) placeConnector(this, el, this.nodes.get(el.id));
      }
    }
    if (this.orderDirty) {
      this.orderDirty = false;
      let previous = null;
      for (const el of this.doc.elements) {
        const node = this.nodes.get(el.id);
        if (!node) continue;
        if (previous ? node.previousSibling !== previous : node !== this.world.firstChild) this.world.insertBefore(node, previous ? previous.nextSibling : this.world.firstChild);
        previous = node;
      }
    }
    this.ui.update();
  }

  // Derived sizes (a mind map follows its ideas, a table its rows). Not an
  // undo step: undoing the change that caused it brings the size back too.
  autoSize(el, w, hgt, exact = false) {
    let changed = false;
    if (w != null && Number.isFinite(w)) { const next = exact ? Math.round(w) : Math.max(el.w, Math.round(w)); if (next !== el.w) { el.w = next; changed = true; } }
    if (hgt != null && Number.isFinite(hgt)) { const next = exact ? Math.round(hgt) : Math.max(el.h, Math.round(hgt)); if (next !== el.h) { el.h = next; changed = true; } }
    if (!changed) return;
    const node = this.nodes.get(el.id);
    if (node) { place(this, el, node); node.renderKey = null; }
    this.markDirty();
    this.sync([el.id]);
  }

  // --------------------------------------------------------------- camera
  setCamera(x, y, k) {
    this.camera = { x, y, k: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k)) };
    this.applyCamera();
  }
  applyCamera() {
    const { x, y, k } = this.camera;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    this.stage.style.setProperty('--zoom', k);
    // The dot grid keeps a readable spacing at every zoom level.
    let step = 24 * k;
    while (step < 12) step *= 4;
    while (step > 96) step /= 4;
    this.stage.style.backgroundSize = `${step}px ${step}px`;
    this.stage.style.backgroundPosition = `${x % step}px ${y % step}px`;
    this.stage.dataset.grid = this.doc.settings.grid;
    this.stage.classList.toggle('is-far', k < 0.35);
    this.ui.update();
    this.persistCamera();
  }
  persistCamera() {
    clearTimeout(this.cameraTimer);
    this.cameraTimer = setTimeout(() => app.workspace.persist(), 800);
  }
  // Glide to a camera instead of jumping there.
  animateCamera(target, duration = 260) {
    cancelAnimationFrame(this.cameraFrame);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { this.setCamera(target.x, target.y, target.k); return; }
    const from = { ...this.camera }; const start = performance.now();
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, target.k));
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - (1 - t) ** 3;
      // Interpolate the zoom geometrically so the motion feels even.
      const zoom = from.k * (k / from.k) ** e;
      const ratio = (zoom - from.k) / ((k - from.k) || 1);
      const blend = Math.abs(k - from.k) > 1e-6 ? ratio : e;
      this.setCamera(from.x + (target.x - from.x) * blend, from.y + (target.y - from.y) * blend, zoom);
      if (t < 1) this.cameraFrame = requestAnimationFrame(step);
    };
    this.cameraFrame = requestAnimationFrame(step);
  }
  stageRect() { return this.stage.getBoundingClientRect(); }
  toWorld(clientX, clientY) { const r = this.stageRect(); return { x: (clientX - r.left - this.camera.x) / this.camera.k, y: (clientY - r.top - this.camera.y) / this.camera.k }; }
  toScreen(x, y) { const r = this.stageRect(); return { x: r.left + this.camera.x + x * this.camera.k, y: r.top + this.camera.y + y * this.camera.k }; }
  viewCenter() { const r = this.stageRect(); return this.toWorld(r.left + r.width / 2, r.top + r.height / 2); }

  zoomAt(clientX, clientY, k, animate = false) {
    const r = this.stageRect();
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));
    const sx = clientX - r.left; const sy = clientY - r.top;
    const wx = (sx - this.camera.x) / this.camera.k; const wy = (sy - this.camera.y) / this.camera.k;
    const target = { x: sx - wx * zoom, y: sy - wy * zoom, k: zoom };
    if (animate) this.animateCamera(target, 200); else this.setCamera(target.x, target.y, target.k);
  }
  zoomBy(factor) { const r = this.stageRect(); this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, this.camera.k * factor, true); }
  zoomToBox(box, animate = true, padding = 80, maxZoom = 1.5) {
    const r = this.stageRect();
    if (!box || !r.width) return;
    const k = Math.max(MIN_ZOOM, Math.min(maxZoom, Math.min((r.width - padding * 2) / Math.max(1, box.w), (r.height - padding * 2) / Math.max(1, box.h))));
    const target = { x: r.width / 2 - (box.x + box.w / 2) * k, y: r.height / 2 - (box.y + box.h / 2) * k, k };
    if (animate) this.animateCamera(target, 320); else this.setCamera(target.x, target.y, target.k);
  }
  zoomToFit(animate = true) {
    const box = Board.union(this.doc.elements.map((el) => Board.bounds(el, this.lookup)));
    if (!box) { const r = this.stageRect(); this.setCamera(r.width / 2, r.height / 2, 1); return; }
    this.zoomToBox(box, animate, 80, 1);
  }
  zoomToSelection() { const box = Board.union(this.selected.map((el) => Board.bounds(el, this.lookup))); if (box) this.zoomToBox(box, true, 120, 2); }

  // -------------------------------------------------------------- changes
  // Every change goes through here, so it can be undone and is saved.
  change(fn, label = '') {
    if (this.readOnly) { toast('Moodboard en lecture seule : le fichier n’a pas pu être lu.'); return undefined; }
    this.history.begin(label);
    let result;
    try { result = fn(); } finally { if (this.history.commit()) { this.markDirty(); this.ui.updateHistory(); } }
    return result;
  }
  // Note that `el` is about to change (inside change()).
  touch(el) { this.history.capture(el); this.dirtyIds.add(el.id); this.sync([el.id]); }
  add(el, index = this.doc.elements.length) {
    this.history.captureNew(el.id); this.history.captureOrder();
    this.doc.elements.splice(index, 0, el);
    this.byId.set(el.id, el);
    this.sync([el.id]); this.orderDirty = true;
    return el;
  }
  remove(ids) {
    const gone = new Set(ids);
    // Lines that joined a removed element go with it.
    for (const el of this.doc.elements) if (el.kind === 'connector' && (gone.has(el.from.id) || gone.has(el.to.id))) gone.add(el.id);
    this.history.captureOrder();
    for (const id of gone) { const el = this.byId.get(id); if (el) this.history.capture(el); }
    this.doc.elements = this.doc.elements.filter((el) => !gone.has(el.id));
    for (const id of gone) { this.byId.delete(id); this.selection.delete(id); }
    if (this.doc.vote && Object.keys(this.doc.vote.votes).some((id) => gone.has(id))) { this.history.captureMeta(); for (const id of gone) delete this.doc.vote.votes[id]; }
    if (this.widgetFocus && gone.has(this.widgetFocus.id)) this.widgetFocus = null;
    this.sync([...gone]);
  }
  // Change one element's data (widgets, toolbars). `options.silent` skips undo.
  mutate(target, fn, options = {}) {
    if (this.readOnly) return;
    // Always the live element: an undo replaces the objects of the board.
    const el = this.byId.get(target.id);
    if (!el) return;
    if (options.merge || options.silent) { fn(el.data, el); Board.normalize(el); this.redraw(el); this.markDirty(); return; }
    this.change(() => { this.touch(el); fn(el.data, el); Board.normalize(el); });
    this.redraw(el);
  }
  setMeta(fn) { this.change(() => { this.history.captureMeta(); fn(this.doc); }); this.redrawAll(); this.applyCamera(); }

  undo() { if (this.readOnly) return; if (this.editing) this.finishEdit(true); this.travel(this.history.undo()); }
  redo() { if (this.readOnly) return; if (this.editing) this.finishEdit(true); this.travel(this.history.redo()); }
  travel(result, select = true) {
    if (!result) return;
    if (this.editing) this.finishEdit(false);
    this.reindex();
    for (const id of result.removed) { const node = this.nodes.get(id); if (node) { node.remove(); this.nodes.delete(id); } this.selection.delete(id); }
    for (const id of result.ids) { const node = this.nodes.get(id); if (node) node.renderKey = null; }
    this.orderDirty = true;
    if (result.meta) this.redrawAll(); else this.sync(result.ids);
    this.selection = new Set([...this.selection].filter((id) => this.byId.has(id)));
    if (select && result.ids.length && result.ids.every((id) => this.byId.has(id))) this.selection = new Set(result.ids.filter((id) => this.byId.get(id).kind !== 'connector' || result.ids.length === 1));
    this.markDirty();
    this.ui.updateHistory();
  }

  select(ids, additive = false) {
    const list = [...ids].filter((id) => this.byId.has(id));
    // A group is picked up whole.
    const groups = new Set(list.map((id) => this.byId.get(id).group).filter(Boolean));
    if (groups.size) for (const el of this.doc.elements) if (el.group && groups.has(el.group)) list.push(el.id);
    if (!additive) this.selection = new Set(list);
    else for (const id of list) this.selection.add(id);
    if (this.widgetFocus && !this.selection.has(this.widgetFocus.id)) { const old = this.byId.get(this.widgetFocus.id); this.widgetFocus = null; if (old) this.redraw(old); }
    if (this.interacting && !this.selection.has(this.interacting)) { const old = this.byId.get(this.interacting); this.interacting = null; if (old) this.redraw(old); }
    this.ui.update();
  }
  clearSelection() { this.select([]); }

  // ---------------------------------------------------------------- saving
  // Saved half a second after the last change, and at least every three
  // seconds while changes keep coming, so nothing is lost on a crash.
  markDirty() {
    if (this.readOnly) return;
    if (!this.unsaved) this.firstUnsaved = Date.now();
    this.unsaved = true;
    clearTimeout(this.saveTimer);
    const wait = Math.max(0, Math.min(SAVE_DELAY, this.firstUnsaved + SAVE_MAX_WAIT - Date.now()));
    this.saveTimer = setTimeout(() => this.save(), wait);
    bus.emit('note-saved', this);
  }
  get dirty() { return this.unsaved; }

  async save() {
    clearTimeout(this.saveTimer); this.saveTimer = null;
    if (!this.loaded || this.readOnly || this.conflict || !this.unsaved) return;
    // An open undo step (a drag in progress) is saved when it ends.
    if (this.history.open) { this.saveTimer = setTimeout(() => this.save(), 250); return; }
    if (this.saving) { this.saveAgain = true; return this.savePromise; }
    const text = Board.serialize(this.doc);
    this.unsaved = false;
    if (text === this.savedText) { bus.emit('note-saved', this); return; }
    this.saving = true;
    let failed = false;
    try {
      this.savePromise = api('/api/note', { method: 'PUT', body: { path: this.path, content: text, baseMtime: this.mtime }, keepalive: !!app.unloading && text.length < 60000 });
      const result = await this.savePromise;
      this.mtime = result.mtime; this.savedText = text;
    } catch (error) {
      failed = true;
      this.unsaved = true;
      if (error.code === 'conflict') this.showConflict(error.data.current);
      else if (error.status === 404 || error.code === 'missing') reportError(new Error('Le moodboard a été déplacé ou supprimé : enregistrement impossible.'));
      else { reportError(error); this.saveTimer = setTimeout(() => this.save(), 4000); }
    } finally {
      this.saving = false;
      const pending = this.pendingMtime; this.pendingMtime = null;
      if (pending !== null && pending !== this.mtime) this.externalChange();
      else if (!failed && (this.unsaved || this.saveAgain) && !this.conflict) { this.saveAgain = false; if (this.unsaved) this.save(); }
      bus.emit('note-saved', this);
      this.ui.update();
    }
  }
  async flush() { clearTimeout(this.saveTimer); if (this.editing) this.finishEdit(true); if (this.history.open) this.history.commit(); if (this.saving) { try { await this.savePromise; } catch {} } if (this.unsaved) await this.save(); }

  onIndex(change) {
    // Pictures and notes shown on the board may have appeared, moved or changed.
    const touched = new Set([...(change.upserts || []).map((entry) => entry.path), ...(change.removes || []), ...(change.renames || []).flat()]);
    if (!touched.size) return;
    const ids = this.doc.elements.filter((el) => touched.has(el.data.file) || touched.has(el.data.image)).map((el) => el.id);
    for (const id of ids) { const node = this.nodes.get(id); if (node) node.renderKey = null; }
    if (ids.length) this.sync(ids);
  }

  // The index reports a new version of this file.
  onFileChanged(entry) {
    if (!this.loaded || entry.mtime === this.mtime) return;
    if (this.saving) { this.pendingMtime = entry.mtime; return; }
    this.externalChange();
  }
  async externalChange() {
    let file;
    try { file = await api(`/api/note?path=${encodeURIComponent(this.path)}`); } catch { return; }
    if (file.mtime === this.mtime) return;
    if (file.content === this.savedText) { this.mtime = file.mtime; return; }
    if (this.unsaved || this.history.open || this.editing) { this.showConflict(file); return; }
    const camera = { ...this.camera };
    this.adoptText(file.content, file.mtime);
    this.history.undoStack = []; this.history.redoStack = []; this.ui.updateHistory();
    this.setCamera(camera.x, camera.y, camera.k);
  }
  showConflict(current) {
    this.conflict = true;
    this.showBanner('Ce moodboard a été modifié ailleurs (assistant, autre fenêtre ou Obsidian) pendant que vous travailliez.', [
      ['Charger la version du disque', () => { this.conflict = false; this.unsaved = false; this.hideBanner(); this.adoptText(current.content, current.mtime); this.history.undoStack = []; this.history.redoStack = []; this.ui.updateHistory(); }],
      ['Garder ma version', () => { this.mtime = current.mtime; this.conflict = false; this.hideBanner(); this.unsaved = true; this.save(); }, true],
    ]);
  }
  showBanner(message, actions = []) {
    this.banner.hidden = false;
    this.banner.replaceChildren(h('span', message), ...actions.map(([label, run, primary]) => h(`button.btn.small${primary ? '.primary' : ''}`, { type: 'button', onClick: run }, label)));
  }
  hideBanner() { this.banner.hidden = true; this.banner.replaceChildren(); }

  // --------------------------------------------------------------- editing
  // Type in the text `path` of an element, in place, at the board's scale.
  editField(element, path, options = {}) {
    const el = element && this.byId.get(element.id);
    if (!el || !path || this.readOnly) return;
    if (this.editing) this.finishEdit(true);
    this.paint();
    const node = this.nodes.get(el.id);
    if (!node) return;
    let target = [...node.querySelectorAll('[data-edit]')].find((item) => item.dataset.edit === path);
    if (!target) {
      if (path === 'text' || path === 'label') target = node.querySelector('.b-body');
      if (!target) return;
    }
    const original = getPath(el.data, path) ?? '';
    const multiline = !['title', 'lang', 'name', 'role', 'assignee', 'due', 'start', 'tags', 'label', 'xLabel', 'yLabel'].includes(path.split('.').pop()) && !/^rows\./.test(path) && !/^columns\.\d+\.title$/.test(path) && !/^lanes\./.test(path) && !/^marks\./.test(path);
    const textarea = h('textarea.b-editor', { spellcheck: !!app.settings.spellcheck, value: String(original), 'aria-label': 'Texte' });
    const style = getComputedStyle(target);
    Object.assign(textarea.style, { font: style.font, color: style.color, textAlign: style.textAlign, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing });
    if (target.dataset.mono) textarea.classList.add('is-mono');
    target.classList.add('is-editing');
    const saved = [...target.childNodes];
    target.replaceChildren(textarea);
    node.classList.add('is-editing');
    const grow = () => {
      textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`;
      if (el.kind === 'text' && path === 'text') {
        const needed = target.scrollHeight;
        if (Math.abs(needed - el.h) > 1) { el.h = Math.max(24, needed); place(this, el, node); this.ui.update(); }
      }
    };
    textarea.addEventListener('input', grow);
    textarea.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.finishEdit(true); this.stage.focus({ preventScroll: true }); }
      else if (event.key === 'Enter' && (!multiline ? !event.shiftKey : (event.ctrlKey || event.metaKey))) { event.preventDefault(); this.finishEdit(true); this.stage.focus({ preventScroll: true }); }
      else if (event.key === 'Tab' && /^rows\.\d+\.\d+$/.test(path)) {
        event.preventDefault();
        const [, r, c] = path.split('.').map(Number);
        const cols = el.data.rows[0].length;
        let next = r * cols + c + (event.shiftKey ? -1 : 1);
        this.finishEdit(true);
        if (next >= el.data.rows.length * cols) { WIDGETS.table.actions.addRow(this, el); }
        next = Math.max(0, next);
        this.editField(el, `rows.${Math.floor(next / cols)}.${next % cols}`);
      } else if (event.key === 'Tab' && path.startsWith('node.')) {
        event.preventDefault(); this.finishEdit(true); WIDGETS.mindmap.key(this, el, event);
      }
    });
    textarea.addEventListener('blur', () => setTimeout(() => { if (this.editing && this.editing.textarea === textarea) this.finishEdit(true); }, 0));
    textarea.addEventListener('pointerdown', (event) => event.stopPropagation());
    textarea.addEventListener('wheel', (event) => { if (textarea.scrollHeight > textarea.clientHeight) event.stopPropagation(); }, { passive: true });
    this.editing = { el, path, textarea, target, saved, original: String(original), options };
    this.ui.update();
    grow();
    textarea.focus({ preventScroll: true });
    if (options.caretEnd !== false) textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    if (options.initial !== undefined) { textarea.value = options.initial; grow(); }
  }

  finishEdit(commit) {
    const editing = this.editing;
    if (!editing) return;
    this.editing = null;
    const { el, path, textarea, target, original, options } = editing;
    const value = textarea.value;
    target.classList.remove('is-editing');
    const node = this.nodes.get(el.id);
    if (node) { node.classList.remove('is-editing'); node.renderKey = null; }
    if (!this.byId.has(el.id)) return;
    const empty = !value.trim();
    if (commit && options.dropEmpty && empty) {
      // A new item left empty is not kept, and leaves no undo step: the step
      // that added it is taken back.
      const result = this.history.dropLast(el.id);
      if (result) this.travel(result, false);
      return;
    }
    if (commit && value !== original) {
      this.change(() => {
        this.touch(el);
        setPath(el.data, path, value);
        if (el.kind === 'text' && path === 'text') el.h = Math.max(24, el.h);
        Board.normalize(el);
      });
      if (el.kind === 'text' && path === 'text' && empty && !options.keepEmpty) this.change(() => this.remove([el.id]));
    } else if (el.kind === 'text' && path === 'text' && !original && empty) {
      // A text box created and left empty disappears.
      this.change(() => this.remove([el.id]));
    }
    this.redraw(el);
    this.ui.update();
  }

  // Text kinds edit their main text.
  editElement(el, target) {
    if (!el || this.readOnly) return;
    const field = target && target.closest('[data-edit]');
    const node = this.nodes.get(el.id);
    if (field && node && node.contains(field)) { this.editField(el, field.dataset.edit); return; }
    if (['text', 'sticky', 'shape', 'mdcard'].includes(el.kind)) this.editField(el, 'text');
    else if (el.kind === 'connector') { if (!el.data.label) this.mutate(el, (d) => { d.label = ' '; }, { silent: true }); this.editField(el, 'label'); }
    else if (el.kind === 'frame' || el.kind === 'grid') this.editField(el, 'title');
    else if (el.kind === 'code') this.editField(el, 'code');
    else if (el.kind === 'note') this.ui.editNote(el);
    else if (el.kind === 'embed' || (el.kind === 'video' && !el.data.file)) { this.interacting = el.id; this.redraw(el); }
    else if (el.kind === 'mermaid') this.editMermaid(el);
    else if (el.kind === 'image') this.ui.replaceImage(el);
    else if (el.kind === 'link' || el.kind === 'file') this.ui.openElement(el);
    else if (el.kind === 'comment') this.openThread(el);
    else if (el.kind === 'mindmap') { this.widgetFocus = { id: el.id, node: el.data.root.id }; this.editField(el, `node.${el.data.root.id}`); }
  }

  // ------------------------------------------- helpers used by the widgets
  dragWithin(event, source, handlers) { return this.input.dragWithin(event, source, handlers); }
  dragValue(event, compute, apply, el) { return this.input.dragValue(event, compute, apply, el); }
  pickValue(anchor, items, onPick) { this.ui.pickValue(anchor, items, onPick); }
  chooseVaultImage(onPick) { this.ui.chooseVaultImage(onPick); }
  openThread(el) { this.ui.openThread(el); }
  editMermaid(el) { this.ui.editMermaid(el); }
  convertMermaid(el) { this.ui.convertMermaid(el); }
  editLines(el, field, hint) { this.ui.editLines(el, field, hint); }
  pulse(el, selector) {
    const node = this.nodes.get(el.id);
    requestAnimationFrame(() => { const part = node && node.querySelector(selector); if (part) part.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'cubic-bezier(.34, 1.56, .64, 1)' }); });
  }

  stats() { return { elements: this.doc.elements.length }; }

  destroy() {
    if (this.editing) this.finishEdit(true);
    this.flush();
    if (this.focusLayout) { this.focusLayout(); this.focusLayout = null; }
    cancelAnimationFrame(this.frame); cancelAnimationFrame(this.cameraFrame);
    clearTimeout(this.cameraTimer);
    this.resize.disconnect();
    this.off.forEach((off) => off());
    this.input.destroy();
    this.ui.destroy();
  }
}
