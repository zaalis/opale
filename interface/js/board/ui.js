// Moodboard controls. All document edits use the view's transactions.
import { api, app, h, iconButton, Meta, openModal, promptText, reportError, showMenu, toast } from '../core.js';
import { store } from '../store.js';
import { uploadFile } from '../editing.js';
import { SHAPES, search as searchShapes, shapeSvg } from './shapes.js';
import { searchEmoji, searchIcons, searchStickers, iconSvg, stickerSvg } from './stickers.js';
import { WIDGETS } from './widgets.js';

const Board = window.OpaleBoard;
const NAMES = { text: 'Texte', sticky: 'Pense-bête', mdcard: 'Carte Markdown', shape: 'Forme', connector: 'Flèche', stroke: 'Dessin', image: 'Image', note: 'Note du coffre', file: 'Fichier', link: 'Lien', embed: 'Page intégrée', video: 'Vidéo', frame: 'Cadre', grid: 'Grille', code: 'Code', table: 'Tableau', kanban: 'Kanban', mindmap: 'Carte mentale', card: 'Tâche', flipcard: 'Carte recto-verso', usercard: 'Profil', timeline: 'Planning', comment: 'Commentaire', mermaid: 'Mermaid', poll: 'Sondage', wheel: 'Roue', scale: 'Échelle', activity: 'Activité', ui: 'Maquette' };
const svgNS = 'http://www.w3.org/2000/svg';
const button = (label, run) => h('button.btn.small', { type: 'button', onClick: run }, label);
function svg(tag, attrs = {}) { const node = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); return node; }
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class BoardUi {
  constructor(view) {
    this.view = view;
    this.modals = new Set();
    this.tools = new Map();
    const tools = [ ['select', 'Sélection (V)', 'locate'], ['hand', 'Déplacer la vue (H)', 'pin'], ['text', 'Texte (T)', 'pencil'], ['sticky', 'Pense-bête (N)', 'file'], ['shape', 'Forme (S)', 'template'], ['connector', 'Flèche (L)', 'forward'], ['pen', 'Stylo (P)', 'pencil'], ['highlighter', 'Surligneur', 'pencil'], ['eraser', 'Gomme (E)', 'trash'], ['frame', 'Cadre (F)', 'template'], ['comment', 'Commentaire (C)', 'info'] ];
    this.toolbar = h('div.board-ui.board-tools', { role: 'toolbar', 'aria-label': 'Outils du moodboard' });
    for (const [tool, label, ico] of tools) {
      const b = iconButton(ico, label, () => { view.input.setTool(tool); view.stage.focus(); });
      b.dataset.tool = tool; this.tools.set(tool, b); this.toolbar.append(b);
    }
    this.toolbar.append(button('Ajouter', () => this.library()));
    this.zoomLabel = button('100 %', () => view.zoomBy(1 / view.camera.k));
    this.saveLabel = h('span.board-save', { role: 'status' });
    this.nav = h('div.board-ui.board-zoom', iconButton('collapse', 'Tout afficher', () => view.zoomToFit()), button('−', () => view.zoomBy(0.8)), this.zoomLabel, button('+', () => view.zoomBy(1.25)), this.saveLabel);
    this.inspector = h('div.board-ui.board-inspector', { 'aria-label': 'Propriétés de la sélection', hidden: true });
    this.selection = h('div.board-selection', { hidden: true });
    this.effects = svg('svg', { class: 'board-effects' });
    this.preview = svg('g'); this.effects.append(this.preview);
    view.overlay.append(this.effects, this.selection, this.toolbar, this.nav, this.inspector);
    this.undoButton = iconButton('back', 'Annuler (Ctrl+Z)', () => view.undo());
    this.redoButton = iconButton('forward', 'Rétablir (Ctrl+Y)', () => view.redo());
    view.actions.append(this.undoButton, this.redoButton, button('Importer', () => this.importDialog()), button('Calques', () => this.layers()), iconButton('more', 'Options du moodboard', (e) => this.options(e)));
    this.update();
  }

  modal(options) {
    const original = options.onClose;
    const modal = openModal({ ...options, onClose: (result) => { this.modals.delete(modal); if (original) original(result); } });
    this.modals.add(modal); return modal;
  }
  updateHistory() { this.undoButton.disabled = this.view.readOnly || !this.view.history.undoStack.length; this.redoButton.disabled = this.view.readOnly || !this.view.history.redoStack.length; }
  updateTools() {
    for (const [tool, b] of this.tools) { b.classList.toggle('active', tool === this.view.input.tool); b.setAttribute('aria-pressed', String(tool === this.view.input.tool)); b.disabled = this.view.readOnly && !['select', 'hand'].includes(tool); }
  }
  update() {
    const v = this.view;
    this.updateHistory(); this.updateTools();
    this.zoomLabel.textContent = `${Math.round(v.camera.k * 100)} %`;
    this.saveLabel.textContent = v.conflict ? 'Conflit' : v.readOnly ? 'Lecture seule' : v.unsaved || v.saving ? 'Enregistrement…' : 'Enregistré';
    const { x, y, k } = v.camera;
    this.preview.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
    for (const [id, node] of v.nodes) node.classList.toggle('is-selected', v.selection.has(id));
    const box = Board.union(v.selected.map((el) => Board.bounds(el, v.lookup)));
    this.selection.hidden = !box || !!v.editing;
    if (box) {
      Object.assign(this.selection.style, { left: `${x + box.x * k}px`, top: `${y + box.y * k}px`, width: `${box.w * k}px`, height: `${box.h * k}px` });
      this.selection.replaceChildren();
      if (!v.readOnly && v.selected.every((el) => !el.locked && !v.layer(el.layer).locked)) {
        if (v.selected.length === 1 && v.selected[0].kind === 'connector') {
          const el = v.selected[0];
          for (const end of ['from', 'to']) {
            const p = Board.endPoint(el, end, v.lookup);
            this.selection.append(h('button.board-handle', { type: 'button', 'aria-label': `Extrémité ${end}`, dataset: { handle: end }, style: { left: `${(p.x - box.x) * k}px`, top: `${(p.y - box.y) * k}px` } }));
          }
        } else {
          for (const dir of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) this.selection.append(h(`button.board-handle.handle-${dir}`, { type: 'button', 'aria-label': `Redimensionner ${dir}`, dataset: { handle: dir } }));
          this.selection.append(h('button.board-handle.handle-rotate', { type: 'button', 'aria-label': 'Rotation', dataset: { handle: 'rotate' } }));
          if (v.selected.length === 1) for (const side of Board.SIDES) this.selection.append(h(`button.board-connect.connect-${side}`, { type: 'button', title: 'Relier à un nouvel élément', 'aria-label': `Relier vers ${side}`, dataset: { handle: `quick-${side}` } }, '+'));
        }
      }
    }
    const key = JSON.stringify(v.selected.map((el) => [el.id, el.kind, el.style, el.locked, el.data.shape]));
    if (key !== this.inspectorKey) { this.inspectorKey = key; this.buildInspector(); }
  }
  buildInspector() {
    const v = this.view; const el = v.selected[0];
    this.inspector.hidden = !el || v.readOnly;
    this.inspector.replaceChildren(); if (!el || v.readOnly) return;
    this.inspector.append(h('span', v.selected.length > 1 ? `${v.selected.length} éléments` : NAMES[el.kind] || el.kind));
    if ('fill' in el.style || 'color' in el.style || 'stroke' in el.style) {
      for (const [field, label] of [['fill', 'Fond'], ['color', 'Texte / trait'], ['stroke', 'Contour']]) {
        if (!(field in el.style)) continue;
        this.inspector.append(h('label.board-color', label, h('input', { type: 'color', value: /^#[a-f0-9]{6}$/i.test(el.style[field]) ? el.style[field] : '#6366f1', 'aria-label': label, onChange: (e) => this.style(field, e.target.value) })));
      }
    }
    if ('fontSize' in el.style) this.inspector.append(h('label.board-color', 'Taille', h('input', { type: 'number', min: 8, max: 160, value: el.style.fontSize || 18, 'aria-label': 'Taille du texte', onChange: (e) => this.style('fontSize', Math.max(8, Math.min(160, Number(e.target.value) || 18))) })));
    if (el.kind === 'shape') this.inspector.append(button('Formes', () => this.library('shape')));
    if (el.kind === 'connector') this.inspector.append(h('select.text-input', { 'aria-label': 'Tracé de la flèche', value: el.style.path, onChange: (e) => this.style('path', e.target.value) }, ['curve', 'straight', 'elbow'].map((path) => h('option', { value: path }, { curve: 'Courbe', straight: 'Droite', elbow: 'Coudée' }[path]))));
    this.inspector.append(button('Modifier', () => v.editElement(el)), iconButton('copy', 'Dupliquer', () => v.input.duplicate(v.selected, 32, true)), iconButton('pin', el.locked ? 'Déverrouiller' : 'Verrouiller', () => this.toggleLock()), iconButton('trash', 'Supprimer la sélection', () => v.change(() => v.remove(v.selected.filter((item) => !item.locked).map((item) => item.id)))));
  }
  style(field, value) { const v = this.view; v.change(() => { for (const el of v.selected.filter((el) => !el.locked)) { v.touch(el); el.style[field] = value; Board.normalize(el); } }); }
  group(join) { const v = this.view; const id = join ? Board.newId() : ''; v.change(() => { for (const el of v.selected.filter((el) => !el.locked)) { v.touch(el); el.group = id; } }); }
  toggleLock() { const v = this.view; const locked = !v.selected.every((el) => el.locked); v.change(() => { for (const el of v.selected) { v.touch(el); el.locked = locked; } }); }
  order(mode) {
    const v = this.view;
    v.change(() => {
      v.history.captureOrder();
      const chosen = new Set(v.selected.filter((el) => !el.locked).map((el) => el.id));
      const all = v.doc.elements;
      if (mode === 'front' || mode === 'back') { const picked = all.filter((el) => chosen.has(el.id)); const rest = all.filter((el) => !chosen.has(el.id)); v.doc.elements = mode === 'front' ? rest.concat(picked) : picked.concat(rest); }
      else if (mode === 'up') { for (let i = all.length - 2; i >= 0; i--) if (chosen.has(all[i].id) && !chosen.has(all[i + 1].id)) [all[i], all[i + 1]] = [all[i + 1], all[i]]; }
      else { for (let i = 1; i < all.length; i++) if (chosen.has(all[i].id) && !chosen.has(all[i - 1].id)) [all[i], all[i - 1]] = [all[i - 1], all[i]]; }
      v.syncOrder();
    });
  }
  contextMenu(event, el) {
    const v = this.view;
    const widget = el && WIDGETS[el.kind];
    showMenu(event.clientX, event.clientY, [
      ...(widget && widget.menu ? widget.menu(v, el, event.target) || [] : []),
      el && { label: 'Modifier', run: () => v.editElement(el), disabled: v.readOnly },
      el && { label: 'Dupliquer', run: () => v.input.duplicate(v.selected, 32, true), disabled: v.readOnly },
      el && { label: 'Grouper', run: () => this.group(true), disabled: v.readOnly },
      el && { label: 'Dégrouper', run: () => this.group(false), disabled: v.readOnly },
      el && { label: el.locked ? 'Déverrouiller' : 'Verrouiller', run: () => this.toggleLock(), disabled: v.readOnly },
      el && { label: 'Premier plan', run: () => this.order('front'), disabled: v.readOnly },
      el && { label: 'Arrière-plan', run: () => this.order('back'), disabled: v.readOnly },
      el && { label: 'Supprimer', danger: true, disabled: v.readOnly, run: () => v.change(() => v.remove(v.selected.filter((item) => !item.locked).map((item) => item.id))) },
      !el && { label: 'Ajouter un élément', run: () => this.library(), disabled: v.readOnly },
      { label: 'Tout afficher', run: () => v.zoomToFit() },
    ]);
  }
  addElements(elements, options = {}) {
    const v = this.view;
    if (v.readOnly || !elements.length) return [];
    v.change(() => { for (const el of elements) v.add(el, el.kind === 'frame' ? 0 : v.doc.elements.length); });
    if (options.select !== false) v.select(elements.map((el) => el.id));
    else v.clearSelection();
    v.stage.focus();
    return elements;
  }
  placeItem(item, at = this.view.viewCenter()) {
    if (this.view.readOnly) return;
    if (item.kind === 'shape' && this.view.selected.length === 1 && this.view.selected[0].kind === 'shape') { this.view.mutate(this.view.selected[0], (d) => { d.shape = item.data.shape; }); return; }
    const el = Board.create(item.kind, { ...item, x: at.x, y: at.y });
    this.addElements([el]); return el;
  }
  library(initial = 'widgets') {
    if (this.view.readOnly) return;
    const results = h('div.board-library-grid');
    const query = h('input.text-input', { type: 'search', placeholder: 'Rechercher…', 'aria-label': 'Rechercher un élément' });
    const tabs = h('div.board-library-tabs'); let category = initial;
    const refresh = () => {
      results.replaceChildren(); const q = query.value;
      let items = [];
      if (category === 'shape') items = searchShapes(q).map((s) => ({ label: s.name, preview: shapeSvg(s.id, 80, 55, { fill: '#ffffff', stroke: '#64748b', strokeWidth: 2 }), item: { kind: 'shape', w: s.w || 180, h: s.h || 120, data: { shape: s.id } } }));
      else if (category === 'emoji') items = searchEmoji(q).map((s) => ({ label: s.name, text: s.char, item: { kind: 'emoji', data: { char: s.char } } }));
      else if (category === 'sticker') items = searchStickers(q).map((s) => ({ label: s.name, preview: stickerSvg(s.id, 64), item: { kind: 'sticker', data: { sticker: s.id } } }));
      else if (category === 'icon') items = searchIcons(q).map((s) => ({ label: s, preview: iconSvg(s, 48), item: { kind: 'icon', data: { icon: s } } }));
      else items = Object.keys(Board.KINDS).filter((kind) => !['connector', 'stroke', 'emoji', 'sticker', 'icon', 'shape'].includes(kind)).map((kind) => ({ label: NAMES[kind] || kind, item: { kind } })).filter((s) => s.label.toLowerCase().includes(q.toLowerCase()));
      for (const choice of items.slice(0, 200)) {
        const b = h('button.board-library-item', { type: 'button', title: choice.label, onClick: () => { modal.close(); this.placeFromLibrary(choice.item); } }, choice.preview ? h('span', { html: choice.preview }) : h('span.board-library-symbol', choice.text || '＋'), h('span', choice.label));
        results.append(b);
      }
      if (!items.length) results.append(h('p', 'Aucun résultat.'));
      for (const b of tabs.children) b.classList.toggle('active', b.dataset.category === category);
    };
    for (const [key, label] of [['widgets', 'Éléments'], ['shape', 'Formes'], ['emoji', 'Émojis'], ['sticker', 'Autocollants'], ['icon', 'Icônes']]) tabs.append(h('button.btn.small', { type: 'button', dataset: { category: key }, onClick: () => { category = key; refresh(); } }, label));
    query.addEventListener('input', refresh);
    const modal = this.modal({ title: 'Ajouter au moodboard', body: h('div.board-library', tabs, query, results) }); refresh(); query.focus();
  }
  async placeFromLibrary(item) {
    try {
      if (['image', 'note', 'file', 'video'].includes(item.kind)) {
        const kinds = item.kind === 'file' ? null : [item.kind];
        this.pickFiles(kinds, (file) => this.placeItem({ kind: item.kind, data: { file } })); return;
      }
      if (['link', 'embed'].includes(item.kind)) {
        const url = await promptText({ title: 'Adresse du lien', label: 'URL https://', validate: (s) => /^https?:\/\//i.test(s) ? '' : 'Une adresse http:// ou https:// est requise.' });
        if (url) this.placeItem({ ...item, data: { url } }); return;
      }
      const el = this.placeItem(item); if (!el) return;
      if (el.kind === 'mermaid') this.editMermaid(el);
      else if (el.kind === 'comment') this.openThread(el);
      else this.view.editElement(el);
    } catch (error) { reportError(error); }
  }
  pickFiles(kinds, pick) {
    const list = h('div.board-file-list'); const search = h('input.text-input', { type: 'search', 'aria-label': 'Rechercher dans le coffre', placeholder: 'Rechercher dans le coffre…' });
    const refresh = () => { list.replaceChildren(); for (const entry of [...store.files.values()].filter((entry) => (!kinds || kinds.includes(entry.kind)) && entry.path.toLowerCase().includes(search.value.toLowerCase())).slice(0, 200)) list.append(button(entry.path, () => { modal.close(); pick(entry.path); })); if (!list.children.length) list.append(h('p', 'Aucun fichier correspondant dans le coffre.')); };
    search.addEventListener('input', refresh);
    const modal = this.modal({ title: 'Choisir un fichier', body: h('div', search, list) }); refresh(); search.focus();
  }
  chooseVaultImage(pick) { this.pickFiles(['image'], pick); }
  replaceImage(el) { this.chooseVaultImage((file) => this.view.mutate(el, (d) => { d.file = file; })); }
  repair(el) { this.pickFiles(null, (file) => this.view.mutate(el, (d) => { d.file = file; })); }
  openElement(el) {
    if (el.data.file) app.workspace.openPath(el.data.file, { newTab: true });
    else if (/^https?:\/\//i.test(el.data.url)) window.open(el.data.url, '_blank', 'noopener,noreferrer');
  }
  async addVaultFiles(paths, at, options = {}) {
    const elements = paths.filter((path) => store.has(path)).map((path, i) => { const kind = Meta.kindOf(path); return Board.create(['image', 'note', 'video'].includes(kind) ? kind : 'file', { x: at.x + i * 36, y: at.y + i * 36, data: { file: path } }); });
    return this.addElements(elements, options);
  }
  async dropFiles(files, at) {
    if (this.view.readOnly) return;
    try {
      const paths = [];
      for (const file of files) {
        if (/\.(drawio|xml)$/i.test(file.name)) { const result = await window.OpaleBoardDrawio.importText(await file.text(), at); this.importResult(result, { select: false }); }
        else if (/\.(mmd|mermaid)$/i.test(file.name)) this.importMermaid(await file.text(), at, { select: false });
        else { const path = await uploadFile(file, this.view.path); await app.workspace.waitFor(path); paths.push(path); }
      }
      await this.addVaultFiles(paths, at, { select: false });
    } catch (error) { reportError(error); }
  }
  pasteText(text, at) {
    if (/^\s*(flowchart|graph|mindmap|sequenceDiagram)\b/i.test(text)) return this.importMermaid(text, at);
    if (/^https?:\/\/\S+$/i.test(text.trim())) this.placeItem({ kind: 'link', data: { url: text.trim() } }, at);
    else this.placeItem({ kind: 'mdcard', data: { text } }, at);
  }
  importResult(result, options = {}) { if (result.error) return toast(result.error, { kind: 'error' }); this.addElements(result.elements || [], options); if (result.warnings && result.warnings.length) toast(result.warnings.join(' · '), { duration: 9000 }); }
  importMermaid(text, at = this.view.viewCenter(), options = {}) { this.importResult(window.OpaleBoardMermaid.toElements(text, at), options); }
  importDialog() {
    if (this.view.readOnly) return;
    const text = h('textarea.text-input.board-source', { 'aria-label': 'Source Mermaid ou draw.io', placeholder: 'flowchart LR\n  A[Idée] --> B[Projet]' });
    const file = h('input', { type: 'file', accept: '.drawio,.xml,.mmd,.mermaid,.canvas', 'aria-label': 'Fichier à importer' });
    let busy = false;
    const run = async () => {
      if (busy) return; busy = true; submit.disabled = true;
      try {
        const selected = file.files[0]; const source = selected ? await selected.text() : text.value;
        let result;
        if (selected && /\.canvas$/i.test(selected.name)) {
          const parsed = Board.parse(source);
          if (parsed.problem) { toast(parsed.problem, { kind: 'error' }); return; }
          const at = this.view.viewCenter();
          const elements = this.view.change(() => this.view.input.instantiate(parsed.doc.elements, at.x, at.y));
          modal.close(); this.view.select(elements.map((el) => el.id)); this.view.zoomToSelection(); return;
        }
        else if (/^\s*</.test(source)) result = await window.OpaleBoardDrawio.importText(source, this.view.viewCenter());
        else result = window.OpaleBoardMermaid.toElements(source, this.view.viewCenter());
        if (result.error) { toast(result.error, { kind: 'error' }); return; }
        modal.close(); this.importResult(result); this.view.zoomToSelection();
      } catch (error) { reportError(error); } finally { busy = false; submit.disabled = false; }
    };
    const submit = button('Importer', run);
    const modal = this.modal({ title: 'Importer un diagramme', body: h('div.form', h('p', 'Mermaid, draw.io (XML) ou JSON Canvas. Les éléments importés restent modifiables.'), file, text), footer: [submit] }); text.focus();
  }
  editMermaid(el) { this.editSource('Diagramme Mermaid', el.data.source || '', (source) => this.view.mutate(el, (d) => { d.source = source; })); }
  convertMermaid(el) {
    const result = window.OpaleBoardMermaid.toElements(el.data.source, { x: el.x, y: el.y });
    if (result.error) return toast(result.error, { kind: 'error' });
    this.view.change(() => { this.view.remove([el.id]); for (const item of result.elements) this.view.add(item); }); this.view.select(result.elements.map((item) => item.id));
  }
  editSource(title, value, save) {
    const field = h('textarea.text-input.board-source', { value, 'aria-label': title });
    const modal = this.modal({ title, body: field, footer: [button('Enregistrer', () => { save(field.value); modal.close(); })] }); field.focus();
  }
  editLines(el, field, hint) { this.editSource(hint || 'Une entrée par ligne', (el.data[field] || []).join('\n'), (text) => this.view.mutate(el, (d) => { d[field] = Board.bulkLines(text); })); }
  async editNote(el) {
    if (!el.data.file) return this.repair(el);
    try {
      const path = el.data.file; const file = await api(`/api/note?path=${encodeURIComponent(path)}`);
      const field = h('textarea.text-input.board-source', { value: file.content, 'aria-label': 'Contenu Markdown de la note' });
      const error = h('p.field-error');
      const save = button('Enregistrer', async () => { save.disabled = true; try { await api('/api/note', { method: 'PUT', body: { path, content: field.value, baseMtime: file.mtime } }); modal.close(); } catch (problem) { error.textContent = problem.code === 'conflict' ? 'La note a changé sur disque. Copiez votre texte avant de rouvrir la note.' : problem.message; } finally { save.disabled = false; } });
      const modal = this.modal({ title: Meta.stem(path), body: h('div', field, error), footer: [save] }); field.focus();
    } catch (error) { reportError(error); }
  }
  openThread(el) {
    const list = h('div.board-thread');
    for (const item of el.data.thread) list.append(h('div', h('strong', item.author || 'Vous'), h('p', item.text)));
    const field = h('textarea.text-input', { 'aria-label': 'Nouveau commentaire', placeholder: 'Votre commentaire…' });
    const modal = this.modal({ title: 'Commentaires', body: h('div', list, field), footer: [button(el.data.resolved ? 'Rouvrir' : 'Résoudre', () => { this.view.mutate(el, (d) => { d.resolved = !d.resolved; }); modal.close(); }), button('Ajouter', () => { if (!field.value.trim()) return; this.view.mutate(el, (d) => { d.thread.push({ id: Board.newId(), author: 'Vous', text: field.value.trim(), at: Date.now() }); }); modal.close(); })] }); field.focus();
  }
  pickValue(anchor, items, onPick) { const rect = anchor.getBoundingClientRect(); showMenu(rect.left, rect.bottom, items.map((item) => typeof item === 'object' ? { ...item, run: () => onPick(item.value ?? item.id) } : { label: String(item), run: () => onPick(item) })); }
  layers() {
    const v = this.view; const list = h('div.board-file-list');
    const refresh = () => {
      list.replaceChildren();
      for (const layer of v.doc.layers) list.append(h('div.board-layer', h('span', layer.name), button(layer.visible ? 'Masquer' : 'Afficher', () => { v.setMeta(() => { layer.visible = !layer.visible; }); refresh(); }), button(layer.locked ? 'Déverrouiller' : 'Verrouiller', () => { v.setMeta(() => { layer.locked = !layer.locked; }); refresh(); }), button('Déplacer la sélection ici', () => v.change(() => { for (const el of v.selected) { v.touch(el); el.layer = layer.id; } }))));
    };
    this.modal({ title: 'Calques', body: list, footer: [button('Ajouter un calque', async () => { const name = await promptText({ title: 'Nom du calque' }); if (name) { v.setMeta((doc) => doc.layers.push({ id: Board.newId(), name, visible: true, locked: false })); refresh(); } })] }); refresh();
  }
  options(event) {
    const v = this.view; const rect = event.currentTarget.getBoundingClientRect();
    showMenu(rect.left, rect.bottom, [
      { label: 'Grille de points', checked: v.doc.settings.grid !== 'none', run: () => v.setMeta((doc) => { doc.settings.grid = doc.settings.grid === 'none' ? 'dots' : 'none'; }) },
      { label: 'Repères magnétiques', checked: v.doc.settings.snap, run: () => v.setMeta((doc) => { doc.settings.snap = !doc.settings.snap; }) },
      { label: 'Masquer le texte des pense-bêtes', checked: v.doc.settings.privateMode, run: () => v.setMeta((doc) => { doc.settings.privateMode = !doc.settings.privateMode; }) },
      'separator',
      { label: 'Exporter le moodboard (.canvas)', run: () => download(Meta.baseName(v.path), Board.serialize(v.doc), 'application/json') },
      { label: 'Exporter le plan de tâches (.md)', run: () => download(`${Meta.stem(v.path)}-plan.md`, Board.planMarkdown(v.doc), 'text/markdown') },
      { label: 'Ouvrir comme texte', run: () => v.openAsText() },
    ]);
  }

  // Transient drawing aids share the camera transform and never enter the file.
  effect(name) { if (!this[name]) { this[name] = svg('g'); this.preview.append(this[name]); } return this[name]; }
  showGuides(guides) { const g = this.effect('guides'); g.replaceChildren(); for (const line of guides) g.append(svg('line', { ...line, class: 'board-guide' })); }
  showMarquee(box) { const g = this.effect('marquee'); g.replaceChildren(); if (box) g.append(svg('rect', { x: box.x, y: box.y, width: box.w, height: box.h, class: 'board-marquee' })); }
  showLasso(points) { const g = this.effect('lasso'); g.replaceChildren(); if (points) g.append(svg('polygon', { points: points.map((p) => `${p.x},${p.y}`).join(' '), class: 'board-marquee' })); }
  showAngle(event, angle) { if (!this.angle) { this.angle = h('span.board-angle'); this.view.overlay.append(this.angle); } this.angle.hidden = !event; if (event) { const r = this.view.stageRect(); Object.assign(this.angle.style, { left: `${event.clientX - r.left + 18}px`, top: `${event.clientY - r.top}px` }); this.angle.textContent = `${Math.round(angle)}°`; } }
  showAnchors(el, side) { const g = this.effect('anchors'); g.replaceChildren(); if (el) for (const dir of Board.SIDES) { const p = Board.sidePoint(el, dir); g.append(svg('circle', { cx: p.x, cy: p.y, r: 5 / this.view.camera.k, class: dir === side ? 'board-anchor active' : 'board-anchor' })); } }
  showEraser(event) { const g = this.effect('eraser'); g.replaceChildren(); if (event) { const p = this.view.toWorld(event.clientX, event.clientY); g.append(svg('circle', { cx: p.x, cy: p.y, r: this.view.input.options.eraserSize / this.view.camera.k, class: 'board-eraser' })); } }
  showDropLine(line) { const g = this.effect('dropLine'); g.replaceChildren(); if (line) { const r = this.view.stageRect(); const a = this.view.toWorld(line.x ?? line.left, line.y ?? line.top); g.append(svg('line', { x1: a.x, y1: a.y, x2: a.x + (line.w ?? line.width ?? 120) / this.view.camera.k, y2: a.y, class: 'board-guide' })); } }
  clearTransient() {
    this.preview.replaceChildren();
    this.guides = this.marquee = this.lasso = this.anchors = this.eraser = this.dropLine = null;
    if (this.angle) this.angle.hidden = true;
  }
  liveStroke(color, width, highlighter) { const path = svg('path', { fill: Board.color(color, '#1f2937'), opacity: highlighter ? 0.38 : 1 }); this.preview.append(path); return { update: (d) => path.setAttribute('d', d), remove: () => path.remove() }; }
  revealIfNeeded(box) { const r = this.view.stageRect(); const p = this.view.toScreen(box.x, box.y); if (p.x < r.left || p.y < r.top || p.x > r.right || p.y > r.bottom) this.view.zoomToBox(box); }
  destroy() { this.clearTransient(); for (const modal of [...this.modals]) modal.close(); }
}
