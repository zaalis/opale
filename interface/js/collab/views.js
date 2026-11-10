// Opale — notes and boards of a shared project. They are the usual editors;
// only where the text comes from and where edits go changes: every edit
// becomes operations on the project's replica (merged with everyone's, never
// replaced wholesale), undo takes back only this person's own steps, and the
// carets, pointers and selections of the others are drawn on top.
import { app, bus, h, Meta, showMenu, toast } from '../core.js';
import { NoteView } from '../note.js';
import { BoardView, getPath, setPath } from '../board/view.js';
import { caretPoint, closeSuggest } from '../editing.js';
import { toShown, toSource } from '../links.js';
import { collab, parsePath, nameOf } from './client.js';
import { follow, PresenceBar, tag } from './presence.js';

const Crdt = window.OpaleCrdt;
const Board = window.OpaleBoard;
const PRESENCE_EVERY = 60;

// Where an offset goes when the text changes from `prev` to `next`.
export function shiftMap(prev, next) {
  let start = 0; const max = Math.min(prev.length, next.length);
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  let tail = 0;
  while (tail < max - start && prev.charCodeAt(prev.length - 1 - tail) === next.charCodeAt(next.length - 1 - tail)) tail++;
  const oldEnd = prev.length - tail; const newEnd = next.length - tail;
  return (offset) => (offset <= start ? offset : offset >= oldEnd ? offset + (newEnd - oldEnd) : newEnd);
}
function throttle(fn, ms) {
  let last = 0; let timer = null;
  const run = () => { last = Date.now(); timer = null; fn(); };
  const call = () => { if (timer) return; const wait = ms - (Date.now() - last); if (wait <= 0) run(); else timer = setTimeout(run, wait); };
  call.cancel = () => { clearTimeout(timer); timer = null; };
  return call;
}
// Who wrote the operation that deleted `obj` in `changes`.
function deleterOf(project, changes, obj) {
  for (const change of changes || []) for (const op of change.o || []) if (op.k === 'reg' && op.o === obj && op.f === '_del' && op.v === true) return project.memberName(change.a);
  return 'un autre participant';
}
function crumbsFor(view) {
  const project = view.project; const file = project && project.file(view.fileId);
  const parts = file ? file.path.split('/') : [];
  const name = parts.pop() || 'Sans titre';
  return [h('button.crumb.collab-crumb', { type: 'button', title: 'Projet partagé', onClick: () => app.collabUi && app.collabUi.reveal(project.id) }, h('span.collab-crumb-mark', '⇄'), project ? project.info.name : ''), h('span.crumb-sep', '/'),
    ...parts.flatMap((part) => [h('span.crumb', part), h('span.crumb-sep', '/')]), h('span.crumb.current', name)];
}
function openError(view, error) {
  return h('div.empty-state', h('p', `Impossible d’ouvrir ce document partagé : ${error && error.message ? error.message : error}`),
    h('button.btn', { type: 'button', onClick: () => app.workspace.closeTab(app.workspace.tabs.find((tab) => tab.view === view)?.id) }, 'Fermer l’onglet'));
}

// =================================================================== notes
export class SharedNoteView extends NoteView {
  async load(options = {}) {
    const parsed = parsePath(this.path);
    this.shared = true;
    this.el.classList.add('is-shared');
    this.saveSoon = Object.assign(() => this.pushText(), { cancel() {} });
    this.lastCommit = 0; this.stepNext = false; this.offs = [];
    try { this.project = await collab.open(parsed.project); } catch (error) { this.body.replaceChildren(openError(this, error)); return; }
    this.fileId = parsed.file; this.key = Crdt.K.note(parsed.file); this.scope = `note:${parsed.file}`;
    if (!this.project.file(this.fileId)) { this.body.replaceChildren(h('div.empty-state', h('p', 'Cette note n’existe plus dans le projet partagé.'))); return; }
    this.content = this.saved = this.project.replica.textOf(this.key);
    this.loaded = true; this._lines = null;
    this.history = [{ text: this.content }]; this.historyIndex = 0;
    this.bar = new PresenceBar(this);
    this.header.querySelector('.view-actions').prepend(this.bar.el);
    this.header.after(this.bar.pill);
    this.carets = h('div.collab-carets', { 'aria-hidden': 'true' });
    this.scroller.append(this.carets);
    this.sendSoon = throttle(() => this.sendPresence(), PRESENCE_EVERY);
    this.drawSoon = throttle(() => this.drawCarets(), 30);
    const p = this.project;
    this.offs.push(
      p.on('effects', (effects, changes, local) => { if (!local && effects.texts.has(this.key)) this.remoteText(); }),
      p.on('files', () => this.onFiles()),
      p.on('presence', (id, data) => { this.bar.render(); this.drawSoon(); if (data && follow.is(p, id)) this.followNow(); }),
      p.on('members', () => this.applyRole()),
      p.on('removed', () => this.applyRole()),
      p.on('status', () => this.bar.render()),
      follow.on(() => this.followNow()),
    );
    const track = () => { this.project.touch(); this.sendSoon(); };
    for (const name of ['keyup', 'mouseup', 'input', 'focusin']) this.body.addEventListener(name, track);
    document.addEventListener('selectionchange', this.onSelection = () => { if (this.body.contains(document.activeElement)) this.sendSoon(); });
    this.scroller.addEventListener('scroll', () => this.drawSoon(), { passive: true });
    this.scroller.addEventListener('wheel', () => { if (follow.is(p)) follow.stop(); }, { passive: true });
    this.scroller.addEventListener('mousedown', () => { if (follow.is(p)) follow.stop(); }, true);
    this.titleEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      this.titleEl.textContent = this.fileName(); this.titleEl.blur();
    }, true);
    this.applyRole(true);
    this.render();
    app.workspace.renderTabs();
    this.bar.render();
    this.sendPresence();
    if (options.focusTitle) this.focusTitle();
  }
  fileName() { const file = this.project && this.project.file(this.fileId); return file ? file.display : ''; }

  applyRole(first = false) {
    if (!this.project) return;
    const locked = this.project.readOnly;
    this.modeBtn.hidden = locked;
    this.titleEl.contentEditable = locked ? 'false' : 'plaintext-only';
    if (locked && this.mode !== 'reading') { if (first) this.mode = 'reading'; else this.setMode('reading'); }
    this.updateBanner();
  }
  updateBanner() {
    const p = this.project;
    const file = p && p.replica.get(Crdt.K.file(this.fileId), '_del');
    const parts = [];
    if (file === true) parts.push(h('span', 'Cette note a été supprimée du projet par un participant. Vos modifications sont gardées dans le projet tant qu’elle peut être restaurée.'), h('button.btn.small.primary', { type: 'button', onClick: () => p.restore(this.fileId) }, 'Restaurer la note'));
    else if (p && p.removed) parts.push(h('span', 'Vous n’êtes plus membre de ce projet : la copie sur cet ordinateur reste lisible mais n’est plus synchronisée.'));
    else if (p && p.me.role === 'reader') parts.push(h('span', 'Lecture seule : votre rôle dans ce projet est « Lecteur ».'));
    this.banner.hidden = !parts.length;
    this.banner.replaceChildren(...parts);
  }

  // ------------------------------------------------------------ the text
  setContent(text, options = {}) { if (options.step) this.stepNext = true; super.setContent(text, options); }
  pushHistory() {}
  pushText() {
    if (!this.project || !this.loaded) return;
    const replica = this.project.replica;
    if (replica.textOf(this.key) === this.content) { this.saved = this.content; return; }
    const now = Date.now();
    const merge = !this.stepNext && now - this.lastCommit < 1000;
    this.stepNext = false; this.lastCommit = now;
    const change = this.project.commit(Crdt.textOps(replica, this.key, this.content), { scope: this.scope, merge });
    if (!change) { this.content = replica.textOf(this.key); this.redraw(); }
    this.saved = this.content;
    this.sendSoon && this.sendSoon();
  }
  async save() { this.pushText(); }
  flush() { this.pushText(); return this.project ? this.project.session.flush() : Promise.resolve(); }
  get dirty() { return false; }
  onFileChanged() {}
  externalChange() {}

  travel(step, caret = true) {
    if (!this.project) return;
    this.pushText();
    const before = this.content;
    const change = step < 0 ? this.project.undo(this.scope) : this.project.redo(this.scope);
    if (!change) { toast(step < 0 ? 'Rien à annuler de votre part dans cette note.' : 'Rien à rétablir.'); return; }
    const after = this.project.replica.textOf(this.key);
    this.history = [{ text: before }, { text: after }]; this.historyIndex = 0;
    super.travel(1, caret);
    this.history = [{ text: after }]; this.historyIndex = 0;
  }

  // Someone else changed the text: keep the caret and the place.
  remoteText() {
    const next = this.project.replica.textOf(this.key); const prev = this.content;
    if (next === prev) return;
    const map = shiftMap(prev, next);
    const top = this.scroller.scrollTop;
    if (this.mode === 'source' && this.sourceArea) {
      const area = this.sourceArea; const focused = document.activeElement === area;
      const from = map(area.selectionStart); const to = map(area.selectionEnd);
      this.content = this.saved = next; this._lines = null;
      this.renderSource();
      if (focused) { this.sourceArea.focus({ preventScroll: true }); this.sourceArea.setSelectionRange(from, to); }
    } else if (this.mode === 'live' && this.active) {
      const offset = this.activeOffset();
      const focused = document.activeElement === this.active.textarea;
      this.content = this.saved = next; this._lines = null;
      this.active = null; closeSuggest();
      this.renderLive();
      if (focused && offset !== null) {
        const at = map(offset);
        const head = next.slice(0, at);
        const line = head.split('\n').length - 1;
        this.activateAt(line, at - (head.lastIndexOf('\n') + 1));
      }
    } else {
      this.content = this.saved = next; this._lines = null;
      this.render();
    }
    this.scroller.scrollTop = top;
    bus.emit('note-content', this);
    this.drawSoon();
  }
  // The caret of this person as an offset in the note's Markdown.
  activeOffset(end = false) {
    if (this.mode === 'source' && this.sourceArea) return end ? this.sourceArea.selectionEnd : this.sourceArea.selectionStart;
    const active = this.active;
    if (this.mode !== 'live' || !active) return null;
    const block = this.blocks[active.index];
    const lines = this.lines();
    let base = 0;
    for (let i = 0; i < block.start; i++) base += lines[i].length + 1;
    const position = end ? active.textarea.selectionEnd : active.textarea.selectionStart;
    const inText = active.objects ? toSource(active.spans, position) : position;
    return base + active.head.length + inText;
  }

  // ------------------------------------------------------------ presence
  sendPresence() {
    if (!this.project || !this.loaded) return;
    const text = this.project.replica.text(this.key);
    const from = this.activeOffset(); const to = this.activeOffset(true);
    const data = { kind: 'note', typing: Date.now() - this.lastCommit < 1500, caret: null, end: null };
    if (from !== null && text) { data.caret = text.anchorAt(from); data.end = to !== from ? text.anchorAt(to) : null; }
    if (app.workspace.activeView === this) this.project.setPresence(this.fileId, data);
  }
  onShow() { if (super.onShow) super.onShow(); this.sendPresence(); }
  drawCarets() {
    if (!this.carets || !this.project) return;
    const text = this.project.replica.text(this.key);
    const box = this.scroller.getBoundingClientRect();
    const local = (x, y) => ({ x: x - box.left + this.scroller.scrollLeft, y: y - box.top + this.scroller.scrollTop });
    const out = [];
    for (const person of this.project.participants()) {
      const presence = person.presence;
      if (presence.doc !== this.fileId || presence.kind !== 'note' || presence.caret == null || !text) continue;
      const at = text.indexOfAnchor(presence.caret);
      if (at === null) continue;
      const end = presence.end ? text.indexOfAnchor(presence.end) : null;
      const label = tag(person, presence.typing ? ' écrit…' : person.state === 'idle' ? ' (inactif)' : '');
      const exact = this.pointIn(at);
      const cls = `div.collab-caret${person.state === 'idle' ? '.is-idle' : ''}`;
      if (exact) {
        const p = local(exact.x, exact.y);
        if (end !== null && end !== at) out.push(...this.selectionRects(Math.min(at, end), Math.max(at, end), person.color, local));
        out.push(h(cls, { style: `--who:${person.color};left:${p.x}px;top:${p.y}px;height:${exact.height}px`, dataset: { who: person.id } }, label));
      } else {
        // Live and reading views show the block the person is in.
        const line = this.content.slice(0, at).split('\n').length - 1;
        const block = this.blockFor(line);
        if (!block) continue;
        const r = block.getBoundingClientRect();
        const p = local(r.left, r.top);
        out.push(h(`${cls}.is-block`, { style: `--who:${person.color};left:${p.x - 10}px;top:${p.y}px;height:${Math.max(18, r.height)}px`, dataset: { who: person.id } }, label));
      }
    }
    this.carets.replaceChildren(...out);
  }
  // Exact point of an offset, when it is in a textarea on screen.
  pointIn(offset) {
    if (this.mode === 'source' && this.sourceArea) return caretPoint(this.sourceArea, Math.min(offset, this.sourceArea.value.length));
    const active = this.active;
    if (this.mode !== 'live' || !active) return null;
    const block = this.blocks[active.index];
    const lines = this.lines();
    let base = 0;
    for (let i = 0; i < block.start; i++) base += lines[i].length + 1;
    const inText = offset - base - active.head.length;
    const middle = active.textarea.value;
    const length = active.objects ? toSource(active.spans, middle.length) : middle.length;
    if (inText < 0 || inText > length) return null;
    return caretPoint(active.textarea, active.objects ? toShown(active.spans, inText) : inText);
  }
  selectionRects(from, to, color, local) {
    const a = this.pointIn(from); const b = this.pointIn(to);
    if (!a || !b) return [];
    const area = this.mode === 'source' ? this.sourceArea : this.active.textarea;
    const r = area.getBoundingClientRect();
    const rect = (x1, y, x2, height) => { const p = local(x1, y); return h('div.collab-sel', { style: `--who:${color};left:${p.x}px;top:${p.y}px;width:${Math.max(2, x2 - x1)}px;height:${height}px` }); };
    if (Math.abs(a.y - b.y) < 2) return [rect(a.x, a.y, b.x, a.height)];
    const out = [rect(a.x, a.y, r.right - 8, a.height)];
    if (b.y - (a.y + a.height) > 1) out.push(rect(r.left + 4, a.y + a.height, r.right - 8, b.y - (a.y + a.height)));
    out.push(rect(r.left + 4, b.y, b.x, b.height));
    return out;
  }
  blockFor(line) {
    if (this.mode === 'live' && this.liveEl && this.blocks.length) {
      const index = this.blockAtLine(line);
      return this.liveEl.children[index] || null;
    }
    let best = null;
    for (const element of this.body.querySelectorAll('[data-line]')) {
      if (element.closest('[data-embed-path]')) continue;
      const value = Number(element.dataset.line);
      if (value <= line && (!best || value >= Number(best.dataset.line))) best = element;
    }
    return best;
  }
  render() { super.render(); this.drawSoon && this.drawSoon(); }
  renderLive() { super.renderLive(); this.drawSoon && this.drawSoon(); }
  activate(index, caret) { const done = super.activate(index, caret); this.drawSoon && this.drawSoon(); return done; }
  followNow() {
    if (!this.project || !follow.is(this.project) || app.workspace.activeView !== this) return;
    const presence = this.project.session.presence.get(follow.target.id);
    if (!presence) return;
    if (presence.doc && presence.doc !== this.fileId) { const file = this.project.file(presence.doc); if (file) this.goTo(file); return; }
    this.drawCarets();
    const caret = this.carets.querySelector(`[data-who="${follow.target.id}"]`);
    if (caret) caret.scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.bar.render();
  }
  goTo(file) { if (file.kind !== 'folder') app.workspace.openPath(this.project.pathOf(file)); }

  // -------------------------------------------------------- header, menu
  updateHeader() {
    if (!this.project) { super.updateHeader(); return; }
    this.crumbs.replaceChildren(...crumbsFor(this));
    this.backBtn.disabled = !app.workspace.canGo(-1);
    this.forwardBtn.disabled = !app.workspace.canGo(1);
    const reading = this.mode === 'reading';
    this.modeBtn.title = reading ? 'Passer en édition (Ctrl+E)' : 'Passer en lecture (Ctrl+E)';
    this.modeBtn.innerHTML = reading ? '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16Z"/></svg>' : '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5Z"/></svg>';
    this.el.dataset.mode = this.mode;
    if (document.activeElement !== this.titleEl) this.titleEl.textContent = this.fileName();
  }
  onFiles() { this.updateHeader(); this.updateBanner(); app.workspace.renderTabs(); }
  async renameFromTitle() {
    if (!this.project) return;
    const wanted = this.titleEl.textContent.replace(/\s+/g, ' ').replace(/[\\/]/g, '-').trim();
    const file = this.project.file(this.fileId);
    if (!file || !wanted || wanted === file.name) { this.titleEl.textContent = this.fileName(); return; }
    this.project.rename(this.fileId, wanted);
  }
  setPath(path) { this.path = path; this.updateHeader(); }
  openMenu(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const locked = !this.project || this.project.readOnly;
    showMenu(rect.right - 220, rect.bottom + 4, [
      { label: 'Aperçu en direct', checked: this.mode === 'live', run: () => this.setMode('live'), disabled: locked },
      { label: 'Mode source', checked: this.mode === 'source', run: () => this.setMode('source'), disabled: locked },
      { label: 'Mode lecture', checked: this.mode === 'reading', run: () => this.setMode('reading'), hint: 'Ctrl+E' },
      'separator',
      { label: 'Renommer', icon: 'pencil', run: () => this.focusTitle(), disabled: locked },
      { label: 'Copier le lien [[…]]', icon: 'link', run: () => navigator.clipboard.writeText(`[[${this.fileName()}]]`).then(() => toast('Lien copié')) },
      { label: 'Membres et permissions…', icon: 'users', run: () => app.collabUi && app.collabUi.members(this.project) },
      { label: 'État de la synchronisation…', icon: 'cloud', run: () => app.collabUi && app.collabUi.status(this.project) },
      'separator',
      { label: 'Supprimer du projet', icon: 'trash', danger: true, disabled: locked, run: () => this.deleteNote() },
    ]);
  }
  async deleteNote() {
    if (!this.project) return;
    this.project.remove(this.fileId);
    toast(`« ${this.fileName()} » a été supprimée pour tous les participants.`, { action: { label: 'Annuler', run: () => this.project.restore(this.fileId) } });
  }
  // Attachments live in each person's own vault: not shared yet.
  async insertAttachments() { toast('Les images et fichiers joints ne sont pas encore partagés dans les projets partagés.'); }
  async chooseImages() { return this.insertAttachments(); }
  stats() { const meta = Meta.extract(this.content); return { words: meta.words, chars: meta.chars, backlinks: 0 }; }
  destroy() {
    for (const off of this.offs || []) off();
    if (this.onSelection) document.removeEventListener('selectionchange', this.onSelection);
    if (this.bar) this.bar.destroy();
    if (this.sendSoon) this.sendSoon.cancel();
    this.pushText();
    this.images.reset(); closeSuggest();
  }
}

// ================================================================== boards
const TEXT_PATHS = Crdt.TEXT_FIELDS;

export class SharedBoardView extends BoardView {
  async load() {
    const parsed = parsePath(this.path);
    this.shared = true; this.offs = []; this.base = new Map(); this.baseOrder = []; this.baseMeta = '';
    this.el.classList.add('is-shared');
    try { this.project = await collab.open(parsed.project); } catch (error) { this.stage.replaceChildren(openError(this, error)); return; }
    this.fileId = parsed.file; this.scope = `board:${parsed.file}`;
    if (!this.project.file(this.fileId)) { this.stage.replaceChildren(h('div.empty-state', h('p', 'Ce moodboard n’existe plus dans le projet partagé.'))); return; }
    this.readOnly = this.project.readOnly;
    // Gestures (moves, resizes…) commit through History directly: each
    // committed step is one undo step of this person.
    const commit = this.history.commit.bind(this.history);
    this.history.commit = () => { const done = commit(); if (done) this.pendingStep = true; return done; };
    this.readDoc();
    this.renderAll();
    this.loaded = true;
    if (this.savedCamera) this.setCamera(this.savedCamera.x, this.savedCamera.y, this.savedCamera.k);
    else this.zoomToFit(false);
    this.bar = new PresenceBar(this);
    this.actions.prepend(this.bar.el);
    this.header.after(this.bar.pill);
    this.othersLayer = h('div.collab-board-layer', { 'aria-hidden': 'true' });
    this.stage.append(this.othersLayer);
    this.sendSoon = throttle(() => this.sendPresence(), PRESENCE_EVERY);
    this.drawSoon = throttle(() => this.drawOthers(), 16);
    const p = this.project;
    const mine = (effects) => {
      const prefix = `E:${this.fileId}:`; const text = `T:${this.fileId}:`;
      for (const obj of effects.objs) if (obj.startsWith(prefix) || obj === Crdt.K.meta(this.fileId)) return true;
      for (const key of effects.texts) if (key.startsWith(text)) return true;
      return false;
    };
    this.offs.push(
      p.on('effects', (effects, changes, local) => { if (!local && mine(effects)) this.adoptRemote(changes); }),
      p.on('files', () => { this.updateHeader(); this.updateBanner(); app.workspace.renderTabs(); }),
      p.on('presence', (id, data) => { this.bar.render(); this.drawSoon(); if (data && follow.is(p, id)) this.followNow(); }),
      p.on('conflicts', (list) => this.onConflicts(list)),
      p.on('members', () => this.applyRole()),
      p.on('removed', () => this.applyRole()),
      p.on('status', () => this.bar.render()),
      follow.on(() => this.followNow()),
    );
    this.stage.addEventListener('pointermove', (event) => { this.pointer = this.toWorld(event.clientX, event.clientY); this.project.touch(); this.sendSoon(); }, { passive: true });
    this.stage.addEventListener('pointerleave', () => { this.pointer = null; this.sendSoon(); });
    const stopFollow = () => { if (follow.is(p)) follow.stop(); };
    this.stage.addEventListener('pointerdown', stopFollow, true);
    this.stage.addEventListener('wheel', stopFollow, { capture: true, passive: true });
    this.ui.updateHistory = () => {
      const stack = this.project.session.stack(this.scope);
      this.ui.undoButton.disabled = this.readOnly || !stack.canUndo();
      this.ui.redoButton.disabled = this.readOnly || !stack.canRedo();
    };
    this.applyRole();
    this.updateHeader();
    app.workspace.renderTabs();
    this.bar.render();
    this.ui.update();
    this.sendPresence();
  }
  updateBanner() {
    const p = this.project; if (!p) return;
    const gone = p.replica.get(Crdt.K.file(this.fileId), '_del') === true;
    if (gone) this.showBanner('Ce moodboard a été supprimé du projet par un participant.', [['Restaurer le moodboard', () => p.restore(this.fileId), true]]);
    else if (p.removed) this.showBanner('Vous n’êtes plus membre de ce projet : la copie sur cet ordinateur reste lisible mais n’est plus synchronisée.');
    else if (p.me.role === 'reader') this.showBanner('Lecture seule : votre rôle dans ce projet est « Lecteur ».');
    else this.hideBanner();
  }
  applyRole() { if (!this.project) return; this.readOnly = this.project.readOnly; this.updateBanner(); this.ui.update(); }

  // ----------------------------------------------------------- the doc
  readDoc() {
    const doc = Crdt.boardDoc(this.project.replica, this.fileId);
    for (const el of doc.elements) Board.normalize(el);
    this.doc = doc;
    this.reindex();
    this.selection = new Set([...this.selection].filter((id) => this.byId.has(id)));
    this.setBase();
  }
  setBase() {
    this.base = new Map(this.doc.elements.map((el) => [el.id, { json: JSON.stringify(el), el: Board.clone(el) }]));
    this.baseOrder = this.doc.elements.map((el) => el.id);
    this.baseMeta = JSON.stringify({ layers: this.doc.layers, settings: this.doc.settings, vote: this.doc.vote });
  }
  metaObject() { return { layers: this.doc.layers, settings: this.doc.settings, vote: this.doc.vote }; }

  // What changed on this board since the last sync becomes operations.
  syncNow() {
    if (!this.project || !this.loaded || this.readOnly) return;
    if (this.history.open) { this.needSync = true; return; }
    this.needSync = false;
    const replica = this.project.replica; const file = this.fileId;
    const ops = [];
    const now = new Map();
    for (const el of this.doc.elements) {
      now.set(el.id, el);
      const json = JSON.stringify(el); const base = this.base.get(el.id);
      if (base && base.json === json) continue;
      ops.push(...Crdt.elementOps(replica, file, el.id, base ? base.el : null, el));
    }
    for (const [id, base] of this.base) if (!now.has(id)) ops.push(...Crdt.elementOps(replica, file, id, base.el, null));
    const order = this.doc.elements.map((el) => el.id);
    if (order.join('\n') !== this.baseOrder.join('\n')) ops.push(...Crdt.orderOps(replica, file, order));
    const meta = JSON.stringify(this.metaObject());
    if (meta !== this.baseMeta) ops.push(...Crdt.metaOps(replica, file, JSON.parse(this.baseMeta), this.metaObject()));
    const step = this.pendingStep; this.pendingStep = false;
    this.setBase();
    if (!ops.length) return;
    const change = this.project.commit(ops, step ? { scope: this.scope } : { scope: this.scope, merge: true });
    if (!change) { this.readDoc(); this.renderAll(); }
    this.ui.updateHistory();
  }
  markDirty() {
    if (this.readOnly || !this.project) return;
    if (!this.syncQueued) { this.syncQueued = true; queueMicrotask(() => { this.syncQueued = false; this.syncNow(); }); }
  }
  get dirty() { return false; }
  async save() { this.syncNow(); }
  async flush() {
    if (this.editing) this.finishEdit(true);
    if (this.history.open) this.history.commit();
    this.syncNow();
    if (this.project) await this.project.session.flush();
  }
  change(fn, label = '') {
    if (this.readOnly) { toast(this.project && this.project.removed ? 'Vous n’êtes plus membre de ce projet.' : 'Lecture seule : votre rôle dans ce projet est « Lecteur ».'); return undefined; }
    this.history.begin(label);
    let result;
    try { result = fn(); } finally { if (this.history.commit()) this.markDirty(); }
    return result;
  }
  onFileChanged() {}
  externalChange() {}
  openAsText() { toast('Un moodboard partagé ne s’ouvre pas comme texte.'); }
  paint() {
    super.paint();
    if (!this.project) return;
    if (!this.history.open) {
      if (this.needSync) this.syncNow();
      if (this.remotePending) this.adoptRemote(this.remoteChanges);
    } else this.sendSoon && this.sendSoon(); // a gesture in progress is shown live
  }

  undo() { this.travelShared(-1); }
  redo() { this.travelShared(1); }
  travelShared(step) {
    if (this.readOnly || !this.project) return;
    if (this.editing) this.finishEdit(true);
    if (this.history.open) this.history.cancel();
    this.syncNow();
    const change = step < 0 ? this.project.undo(this.scope) : this.project.redo(this.scope);
    if (!change) { toast(step < 0 ? 'Rien à annuler de votre part sur ce moodboard.' : 'Rien à rétablir.'); return; }
    const touched = new Set();
    for (const op of change.o) {
      const match = /^(?:E|T):[^:]+:([^:]+)/.exec(op.o || op.x || '');
      if (match) touched.add(match[1]);
    }
    this.applyReplica();
    const ids = [...touched].filter((id) => this.byId.has(id));
    if (ids.length) this.selection = new Set(ids.filter((id) => this.byId.get(id).kind !== 'connector' || ids.length === 1));
    this.ui.update(); this.ui.updateHistory();
  }

  // Take the replica's version of the board, redrawing only what changed.
  applyReplica() {
    const previous = this.base;
    const editing = this.editing;
    this.readDoc();
    const changed = [];
    for (const [id, entry] of this.base) { const old = previous.get(id); if (!old || old.json !== entry.json) changed.push(id); }
    const removed = [...previous.keys()].filter((id) => !this.base.has(id));
    for (const id of removed) { const node = this.nodes.get(id); if (node) { node.remove(); this.nodes.delete(id); } }
    for (const id of changed) {
      if (editing && editing.el.id === id) continue; // its text box stays open
      const node = this.nodes.get(id); if (node) node.renderKey = null;
    }
    if (editing && this.byId.has(editing.el.id)) editing.el = this.byId.get(editing.el.id);
    this.orderDirty = true;
    this.sync(changed.filter((id) => !(editing && editing.el.id === id)));
    if (JSON.stringify(this.metaObject()) !== JSON.stringify(JSON.parse(this.baseMeta))) this.redrawAll();
    this.stage.dataset.grid = this.doc.settings.grid;
    return { changed, removed };
  }

  adoptRemote(changes) {
    // Not in the middle of a gesture: it is applied when the gesture ends.
    if (this.history.open) { this.remotePending = true; this.remoteChanges = [...(this.remoteChanges || []), ...(changes || [])]; return; }
    const all = [...(this.remoteChanges || []), ...(changes || [])];
    this.remotePending = false; this.remoteChanges = [];
    this.syncNow();
    const editing = this.editing;
    const caret = editing ? { from: editing.textarea.selectionStart, to: editing.textarea.selectionEnd, value: editing.textarea.value } : null;
    const { removed } = this.applyReplica();
    if (editing && removed.includes(editing.el.id)) {
      // Deleted by someone else while this person was typing in it.
      const lost = Board.clone(editing.el); const path = editing.path; const value = editing.textarea.value;
      this.finishEdit(false); // the element is gone: nothing is written
      setPath(lost.data, path, value);
      toast(`${deleterOf(this.project, all, Crdt.K.el(this.fileId, lost.id))} a supprimé l’élément que vous modifiiez.`, {
        action: { label: 'Restaurer', run: () => { this.project.commit(Crdt.elementOps(this.project.replica, this.fileId, lost.id, null, lost), { scope: this.scope }); this.applyReplica(); } },
      });
    } else if (editing && this.editing === editing) {
      // Someone typed in the same text: take their text, keep the caret.
      const shared = getPath(this.editing.el.data, editing.path);
      if (typeof shared === 'string' && shared !== caret.value) {
        const map = shiftMap(caret.value, shared);
        editing.textarea.value = shared;
        editing.textarea.setSelectionRange(map(caret.from), map(caret.to));
        editing.textarea.dispatchEvent(new Event('input'));
      }
    }
    if (this.interacting && !this.byId.has(this.interacting)) this.interacting = null;
    this.ui.update();
    this.drawSoon();
  }

  // Text typed in a text field reaches the others as it is typed.
  editField(element, path, options = {}) {
    super.editField(element, path, options);
    const editing = this.editing;
    if (!editing || !this.project || !TEXT_PATHS.has(path)) return;
    let last = 0;
    editing.textarea.addEventListener('input', () => {
      if (this.editing !== editing || !this.byId.has(editing.el.id)) return;
      const replica = this.project.replica;
      const key = Crdt.K.elText(this.fileId, editing.el.id, path);
      const shared = replica.get(Crdt.K.el(this.fileId, editing.el.id), `d.${path}`) && replica.textOf(key);
      const before = { ...editing.el, data: { ...editing.el.data, [path]: typeof shared === 'string' ? shared : getPath(editing.el.data, path) } };
      const after = { ...editing.el, data: { ...editing.el.data, [path]: editing.textarea.value } };
      const ops = Crdt.elementOps(replica, this.fileId, editing.el.id, before, after).filter((op) => op.k !== 'reg' || op.f === `d.${path}`);
      if (!ops.length) return;
      const now = Date.now();
      this.project.commit(ops, { scope: this.scope, merge: now - last < 1000 });
      last = now;
      this.ui.updateHistory();
      this.sendSoon();
    });
  }

  onConflicts(list) {
    const me = this.project.me.id;
    for (const conflict of list) {
      if (conflict.lose.a !== me || !conflict.obj.startsWith(`E:${this.fileId}:`)) continue;
      const id = conflict.obj.slice(`E:${this.fileId}:`.length);
      if (!this.byId.has(id) || conflict.field === 'z') continue;
      toast(`${this.project.memberName(conflict.win.a)} a modifié le même réglage d’un élément en même temps que vous : sa valeur a été gardée.`, {
        action: { label: 'Remettre la mienne', run: () => {
          const el = this.byId.get(id); if (!el) return;
          const after = Board.clone(el); const field = conflict.field;
          if (field.startsWith('d.')) after.data[field.slice(2)] = conflict.lose.v;
          else if (field.startsWith('s.')) after.style[field.slice(2)] = conflict.lose.v;
          else after[field] = conflict.lose.v;
          this.project.commit(Crdt.elementOps(this.project.replica, this.fileId, id, el, after), { scope: this.scope });
          this.applyReplica();
        } },
      });
      break;
    }
  }

  add(el, index) {
    const added = super.add(el, index);
    if (['image', 'file', 'video', 'note', 'pdf', 'audio'].includes(el.kind) && (el.data.file || el.data.image) && !this.warnedFiles) {
      this.warnedFiles = true;
      toast('Les images et fichiers de votre coffre ne sont pas encore partagés : les autres participants verront un cadre vide.');
    }
    return added;
  }
  select(ids, additive) { super.select(ids, additive); this.sendSoon && this.sendSoon(); }
  applyCamera() { super.applyCamera(); if (this.othersLayer) { this.drawSoon(); this.sendSoon(); } }

  // --------------------------------------------------------- presence
  sendPresence() {
    if (!this.project || !this.loaded || app.workspace.activeView !== this) return;
    const r = this.stageRect();
    const center = this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
    const data = { kind: 'board', cursor: this.pointer ? { x: Math.round(this.pointer.x), y: Math.round(this.pointer.y) } : null, sel: [...this.selection].slice(0, 60), view: { x: Math.round(center.x), y: Math.round(center.y), k: +this.camera.k.toFixed(3) }, gesture: null, editing: this.editing ? this.editing.el.id : null };
    const tx = this.history.tx;
    if (tx) {
      data.gesture = [];
      for (const id of tx.before.keys()) { const el = this.byId.get(id); if (el && el.kind !== 'connector') data.gesture.push({ id, x: Math.round(el.x), y: Math.round(el.y), w: Math.round(el.w), h: Math.round(el.h), r: el.rotation || 0 }); if (data.gesture.length >= 40) break; }
    }
    this.project.setPresence(this.fileId, data);
  }
  onShow() { super.onShow(); this.sendPresence && this.sendPresence(); }
  // Pointers, selections and gestures of the others, in this person's view:
  // everything travels in board coordinates, so zoom and position differ freely.
  drawOthers() {
    if (!this.othersLayer || !this.project) return;
    const r = this.stageRect();
    const screen = (x, y) => ({ x: this.camera.x + x * this.camera.k, y: this.camera.y + y * this.camera.k });
    const out = [];
    for (const person of this.project.participants()) {
      const presence = person.presence;
      if (presence.doc !== this.fileId || presence.kind !== 'board') continue;
      const idle = person.state === 'idle' ? '.is-idle' : '';
      const moving = new Set((presence.gesture || []).map((item) => item.id));
      for (const id of presence.sel || []) {
        if (moving.has(id)) continue;
        const el = this.byId.get(id); if (!el) continue;
        const box = Board.bounds(el, this.lookup); if (!box) continue;
        const a = screen(box.x, box.y);
        out.push(h(`div.collab-box${idle}`, { style: `--who:${person.color};left:${a.x - 3}px;top:${a.y - 3}px;width:${box.w * this.camera.k + 6}px;height:${box.h * this.camera.k + 6}px` }));
      }
      for (const item of presence.gesture || []) {
        const a = screen(item.x, item.y);
        out.push(h('div.collab-box.is-ghost', { style: `--who:${person.color};left:${a.x}px;top:${a.y}px;width:${item.w * this.camera.k}px;height:${item.h * this.camera.k}px;transform:rotate(${item.r}deg)` }));
      }
      if (presence.cursor) {
        const a = screen(presence.cursor.x, presence.cursor.y);
        if (a.x < -40 || a.y < -40 || a.x > r.width + 40 || a.y > r.height + 40) continue;
        out.push(h(`div.collab-pointer${idle}`, { style: `--who:${person.color};left:${a.x}px;top:${a.y}px` },
          h('span.collab-pointer-arrow', { html: '<svg width="16" height="18" viewBox="0 0 16 18"><path d="M1 1 15 8.5 8.6 10 5.6 16.6Z" fill="var(--who)" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>' }),
          tag(person, presence.editing ? ' écrit…' : '')));
      }
    }
    this.othersLayer.replaceChildren(...out);
  }
  followNow() {
    if (!this.project || !follow.is(this.project) || app.workspace.activeView !== this) return;
    const presence = this.project.session.presence.get(follow.target.id);
    if (!presence) return;
    if (presence.doc && presence.doc !== this.fileId) { const file = this.project.file(presence.doc); if (file) this.goTo(file); return; }
    if (!presence.view) return;
    const r = this.stageRect();
    const k = Math.max(0.05, Math.min(8, presence.view.k || 1));
    this.animateCamera({ x: r.width / 2 - presence.view.x * k, y: r.height / 2 - presence.view.y * k, k }, 220);
    this.bar.render();
  }
  goTo(file) { if (file.kind !== 'folder') app.workspace.openPath(this.project.pathOf(file)); }
  updateHeader() {
    if (!this.project) { super.updateHeader(); return; }
    this.header.update();
    this.crumbs.replaceChildren(...crumbsFor(this));
  }
  destroy() {
    for (const off of this.offs || []) off();
    if (this.bar) this.bar.destroy();
    if (this.sendSoon) this.sendSoon.cancel();
    if (this.history.open) this.history.commit();
    this.syncNow && this.syncNow();
    super.destroy();
  }
}

// Following someone into another document of the project.
bus.on('collab-open', (project) => {
  project.on('presence', (id, data) => {
    if (!data || !follow.is(project, id) || !data.doc) return;
    const view = app.workspace.activeView;
    if (view && view.project === project && view.fileId === data.doc) return;
    const file = project.file(data.doc);
    if (file && file.kind !== 'folder') app.workspace.openPath(project.pathOf(file));
  });
});
export { nameOf };
