// Opale — one open note. Three ways to look at it:
//   live     rendered page where the block you click turns into its Markdown
//   source   the whole file as text, with syntax colouring
//   reading  rendered, read-only
// The note text lives in `content`; every mode edits that one string, and it
// is saved shortly after each change.
import { api, app, bus, confirmDialog, debounce, h, icon, iconButton, Markdown, Meta, reportError, showMenu, toast } from './core.js';
import { store } from './store.js';
import { keys, primary, TEXT } from './platform.js';
import { attachEditing, caretPoint, closeSuggest, embedFor, uploadFile } from './editing.js';
import { findImages, ImageLayer, isImageFile, pickImageFiles } from './images.js';
import { displayOf, findEmbeds, followEdit, LinkDoctor, sourceOf, toShown, toSource } from './links.js';
import { bindNoteInteractions, decorate } from './renderer.js';

const EDITABLE_JOIN = new Set(['paragraph', 'heading', 'list', 'blockquote']);
// Blocks typed exactly as written: an embed there is only text.
const LITERAL = new Set(['code', 'frontmatter', 'math', 'comment']);

// Text of a rendered block before a point, without what embeds display
// (their content is not typed, so it must not steer the caret).
function textBefore(blockEl, container, offset) {
  const range = document.createRange();
  range.selectNodeContents(blockEl);
  range.setEnd(container, offset);
  const fragment = range.cloneContents();
  for (const node of fragment.querySelectorAll('.embed, .broken-dot, .code-tools')) node.remove();
  return fragment.textContent;
}

// Does an embed of `text` overlap the stretch [from, to)?
function embedIn(text, from, to) {
  return findEmbeds(text).filter((embed) => (from === to ? embed.start < from && embed.end > from : embed.start < to && embed.end > from));
}

// Colour the source without changing a single character, so the transparent
// textarea laid over it lines up exactly.
function highlightSource(text) {
  const esc = Markdown.escapeHtml;
  const lines = text.split('\n'); const out = [];
  let front = lines[0] === '---' && lines.slice(1).some((line) => line.trim() === '---' || line.trim() === '...');
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (front) { out.push(`<span class="s-meta">${esc(line)}</span>`); if (i > 0 && (line.trim() === '---' || line.trim() === '...')) front = false; continue; }
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { out.push(`<span class="s-code">${esc(line)}</span>`); if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && line.trim() === mark[1]) fence = null; continue; }
    if (mark) { fence = mark[1]; out.push(`<span class="s-code">${esc(line)}</span>`); continue; }
    let html = esc(line)
      .replace(/(`+)(?!`)(.+?)\1/g, '<span class="s-code">$&</span>')
      .replace(/(!?\[\[)([^\[\]]+?)(\]\])/g, '<span class="s-mark">$1</span><span class="s-link">$2</span><span class="s-mark">$3</span>')
      .replace(/(!?\[)([^\[\]]*)(\]\()([^)\s]+)(\))/g, '<span class="s-mark">$1</span><span class="s-link">$2</span><span class="s-mark">$3</span><span class="s-url">$4</span><span class="s-mark">$5</span>')
      .replace(/(^|\s)(#[\p{L}\p{N}_\-\/]+)/gu, (m, pre, tag) => (/^#\d+$/.test(tag) ? m : `${pre}<span class="s-tag">${tag}</span>`))
      .replace(/(\*\*|__|~~|==)(?=\S)(.+?)\1/g, '<span class="s-mark">$1</span><span class="s-strong">$2</span><span class="s-mark">$1</span>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<span class="s-url">$2</span>');
    const heading = /^( {0,3}#{1,6})(\s.*)?$/.exec(line);
    if (heading && (heading[2] !== undefined || line.trim().length === heading[1].trim().length)) html = `<span class="s-heading">${html}</span>`;
    else html = html.replace(/^(\s*)((?:&gt;\s?)+)/, '$1<span class="s-mark">$2</span>').replace(/^(\s*)([-*+]|\d+[.)])(\s+)(\[.\])?/, (m, indent, bullet, gap, task) => `${indent}<span class="s-mark">${bullet}</span>${gap}${task ? `<span class="s-task">${task}</span>` : ''}`);
    out.push(html);
  }
  return out.join('\n');
}

// Where a click in the rendered block falls in its Markdown source: walk the
// source and let it "consume" the visible text before the click, skipping the
// syntax characters that are not displayed.
function mapPrefix(source, prefix) {
  const wanted = prefix.replace(/\s+/g, ' ');
  let matched = 0; let i = 0;
  for (; i < source.length && matched < wanted.length; i++) {
    const ch = source[i]; const next = wanted[matched];
    if (ch === next || (next === ' ' && /\s/.test(ch))) matched++;
  }
  return i;
}

export class NoteView {
  constructor(path, options = {}) {
    this.type = 'note';
    this.path = path;
    const preferred = app.settings.defaultMode || 'live';
    this.mode = options.mode || preferred;
    this.editMode = this.mode !== 'reading' ? this.mode : (preferred === 'reading' ? 'live' : preferred);
    this.content = ''; this.saved = ''; this.mtime = 0; this.loaded = false;
    this.history = []; this.historyIndex = -1; this.lastPush = 0;
    this.blocks = []; this.active = null; this._lines = null;
    this.saving = false; this.pendingMtime = null; this.conflict = false;
    this.saveSoon = debounce(() => this.save(), 650);
    this.images = new ImageLayer(this);
    this.links = new LinkDoctor(this);
    this.build();
    this.ready = this.load(options);
  }

  // ------------------------------------------------------------- structure
  build() {
    this.backBtn = iconButton('back', 'Précédent (Alt+←)', () => app.workspace.back());
    this.forwardBtn = iconButton('forward', 'Suivant (Alt+→)', () => app.workspace.forward());
    this.crumbs = h('div.view-crumbs');
    this.modeBtn = iconButton('book', 'Basculer lecture / édition (Ctrl+E)', () => this.toggleReading());
    this.moreBtn = iconButton('more', 'Plus d’options', (event) => this.openMenu(event));
    this.header = h('div.view-header', h('div.view-nav', this.backBtn, this.forwardBtn), this.crumbs, h('div.view-actions', this.modeBtn, this.moreBtn));
    this.banner = h('div.note-banner', { hidden: true });
    this.titleEl = h('div.inline-title', { contentEditable: 'plaintext-only', spellcheck: false, role: 'textbox', 'aria-label': 'Titre de la note' });
    this.titleEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); this.titleEl.blur(); this.focusBody(); }
      if (event.key === 'Escape') { event.preventDefault(); this.titleEl.textContent = Meta.stem(this.path); this.titleEl.blur(); }
    });
    this.titleEl.addEventListener('blur', () => this.renameFromTitle());
    this.body = h('div.note-body');
    this.sizer = h('div.note-sizer', this.titleEl, this.body);
    this.scroller = h('div.note-scroll', { tabIndex: -1 }, this.sizer);
    this.el = h('div.view.note-view', this.header, this.banner, this.scroller);
    bindNoteInteractions(this.body, this);
    this.body.addEventListener('mousedown', (event) => {
      if (this.mode !== 'live') return;
      if (this.images.onMouseDown(event)) return;
      this.onLiveMouseDown(event);
    });
    this.body.addEventListener('dblclick', (event) => { if (this.mode === 'live') this.images.onDoubleClick(event); });
    // A picture that fails to load gets its red dot once the failure is known.
    this.body.addEventListener('error', (event) => {
      if (event.target.matches && event.target.matches('img.embed-image')) setTimeout(() => this.links.decorate(this.body), 0);
    }, true);
    // Keys and pastes that reach the page itself rather than a block being
    // typed in: a selected image, undo after moving one, a pasted picture.
    this.scroller.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.target.closest('textarea, input') || event.target.isContentEditable) return;
      if (this.images.onKey(event)) return;
      if (this.mode !== 'reading') this.undoKeys(event, false);
    });
    // WebKit (the macOS window) offers ⌘V outside a text field only when the page asks for it.
    this.scroller.addEventListener('beforepaste', (event) => {
      if (this.mode === 'live' && !event.target.closest('textarea, input') && !event.target.isContentEditable) event.preventDefault();
    });
    this.scroller.addEventListener('paste', (event) => {
      if (this.mode !== 'live' || event.target.closest('textarea, input') || event.target.isContentEditable) return;
      const files = [...((event.clipboardData && event.clipboardData.files) || [])].filter(isImageFile);
      if (!files.length) return;
      event.preventDefault();
      const selected = this.images.selected && this.images.entryAt(this.images.selected.start);
      this.images.insertFiles(files, selected ? { offset: selected.end, paragraph: false } : null);
    });
    this.body.addEventListener('contextmenu', (event) => this.contextMenu(event));
    this.scroller.addEventListener('mousedown', (event) => {
      // Clicking the empty page under the note continues it.
      if (event.target !== this.scroller && event.target !== this.sizer) return;
      if (this.mode === 'live') { event.preventDefault(); this.marginClick(event); }
      else if (this.mode === 'source' && this.sourceArea) { event.preventDefault(); this.sourceArea.focus(); this.sourceArea.setSelectionRange(this.sourceArea.value.length, this.sourceArea.value.length); }
    });
  }

  updateHeader() {
    const folder = Meta.dirName(this.path);
    const parts = folder ? folder.split('/') : [];
    this.crumbs.replaceChildren(...parts.flatMap((part, index) => [
      h('button.crumb', { type: 'button', title: 'Afficher dans l’explorateur de fichiers', onClick: () => app.explorer.reveal(parts.slice(0, index + 1).join('/')) }, part),
      h('span.crumb-sep', '/'),
    ]), h('span.crumb.current', Meta.stem(this.path)));
    this.backBtn.disabled = !app.workspace.canGo(-1);
    this.forwardBtn.disabled = !app.workspace.canGo(1);
    const reading = this.mode === 'reading';
    this.modeBtn.innerHTML = icon(reading ? 'pencil' : 'book');
    this.modeBtn.title = keys(reading ? 'Passer en édition (Ctrl+E)' : 'Passer en lecture (Ctrl+E)');
    this.el.dataset.mode = this.mode;
    if (document.activeElement !== this.titleEl) this.titleEl.textContent = Meta.stem(this.path);
  }

  // ---------------------------------------------------------------- loading
  async load(options = {}) {
    try {
      const note = await api(`/api/note?path=${encodeURIComponent(this.path)}`);
      this.content = this.saved = note.content; this.mtime = note.mtime; this.loaded = true; this._lines = null;
      this.history = [{ text: this.content }]; this.historyIndex = 0;
      this.render();
      if (options.subpath) this.followAnchor(options.subpath);
      else if (typeof options.line === 'number') this.scrollToLine(options.line, true);
      if (options.focusTitle) this.focusTitle();
    } catch (error) {
      this.body.replaceChildren(h('div.empty-state', h('p', error.status === 404 ? 'Cette note n’existe plus.' : `Impossible d’ouvrir la note : ${error.message}`)));
    }
  }

  lines() { if (!this._lines) this._lines = this.content.split('\n'); return this._lines; }

  render() {
    this.images.reset();
    this.links.close();
    this.active = null; this.sourceArea = null;
    closeSuggest();
    this.updateHeader();
    const top = this.scroller.scrollTop;
    if (this.mode === 'reading') this.renderReading();
    else if (this.mode === 'source') this.renderSource();
    else this.renderLive();
    this.scroller.scrollTop = top;
    bus.emit('note-rendered', this);
  }

  renderReading() {
    this.body.replaceChildren(h('div.markdown.reading', { html: Markdown.render(this.content, store.renderContext(this.path)) || `<p class="note-empty">${keys('Note vide — passez en édition avec Ctrl+E.')}</p>` }));
    decorate(this.body);
    this.links.decorate(this.body);
  }

  // Draw the note again after a change made outside the typing, keeping the place.
  redraw() { this.active = null; this.render(); }

  // A broken embed was clicked: open the window that repairs it.
  repairLink(el) { this.links.open(el, el.querySelector('.broken-dot') || el); }

  // ----------------------------------------------------------------- source
  renderSource() {
    const textarea = h('textarea.source-input', { spellcheck: !!app.settings.spellcheck, 'aria-label': 'Source Markdown de la note', autocapitalize: 'off' });
    textarea.value = this.content;
    const colours = h('pre.source-highlight', { 'aria-hidden': 'true' });
    const paint = () => { colours.innerHTML = `${highlightSource(textarea.value)}\n`; };
    attachEditing(textarea, this.path);
    textarea.addEventListener('input', () => { this.setContent(textarea.value); paint(); });
    textarea.addEventListener('keydown', (event) => this.undoKeys(event));
    this.body.replaceChildren(h('div.source-editor', colours, textarea));
    this.sourceArea = textarea;
    paint();
  }

  // ------------------------------------------------------------------- live
  renderLive() {
    this.images.reset();
    this.blocks = Markdown.liveBlocks(this.content);
    const ctx = store.renderContext(this.path, { live: true, footnotes: { order: [], defs: {} } });
    const container = h('div.markdown.live');
    this.blocks.forEach((block, index) => container.append(this.blockElement(block, index, ctx)));
    this.tail = h('div.lp-tail', { title: 'Cliquer pour écrire' });
    container.append(this.tail);
    this.liveEl = container;
    this.body.replaceChildren(container);
    decorate(container);
    this.links.decorate(container);
  }

  blockElement(block, index, ctx) {
    const el = h('div.lp-block', { dataset: { index: String(index), type: block.token.type } });
    el.innerHTML = Markdown.renderToken(block.token, ctx) || (block.token.type === 'comment' ? '<span class="lp-hidden">%% commentaire %%</span>' : '');
    return el;
  }

  onLiveMouseDown(event) {
    if (event.button !== 0 || !this.loaded) return;
    const target = event.target;
    if (target.closest('textarea')) return;
    if (target.closest('a, button, input, summary, audio, video, .code-tools, .embed-missing')) return;
    event.preventDefault();
    this.liveClick(target, event.clientX, event.clientY);
  }

  // A click in the side margins of the page acts on the line at that height,
  // as in a word processor; below the note it starts a new paragraph.
  marginClick(event) {
    const blocks = this.liveEl ? [...this.liveEl.querySelectorAll(':scope > .lp-block')] : [];
    const last = blocks[blocks.length - 1];
    if (last && event.clientY <= last.getBoundingClientRect().bottom) {
      const box = this.liveEl.getBoundingClientRect();
      const x = Math.min(Math.max(event.clientX, box.left + 2), box.right - 2);
      let target = document.elementFromPoint(x, event.clientY);
      // Never pick up a picture from the margin: aim at its block instead.
      if (target && target.closest('img, .embed, .broken-dot')) target = target.closest('.lp-block') || target;
      if (target && this.liveEl.contains(target)) return this.liveClick(target, x, event.clientY, event.clientX);
    }
    return this.appendParagraph();
  }

  liveClick(target, x, y, pointerX = x) {
    const event = { clientX: pointerX, clientY: y };
    let blockEl = target.closest('.lp-block');
    if (blockEl && this.active && blockEl === this.active.el) return;
    if (!blockEl) {
      if (target.closest('.lp-tail') || !this.blocks.length) return this.appendParagraph();
      // A click in the margin between two blocks edits the nearest one.
      const elements = [...this.liveEl.querySelectorAll(':scope > .lp-block')];
      // Below the last block is the empty end of the page: start a new paragraph there.
      if (event.clientY > elements[elements.length - 1].getBoundingClientRect().bottom) return this.appendParagraph();
      blockEl = elements.reduce((best, element) => {
        const rect = element.getBoundingClientRect();
        const distance = Math.min(Math.abs(event.clientY - rect.top), Math.abs(event.clientY - rect.bottom));
        return !best || distance < best.distance ? { element, distance } : best;
      }, null).element;
      const index = Number(blockEl.dataset.index);
      if (!this.partsOf(this.blocks[index])) return this.besideEmbeds(index, event);
      return this.activate(index, { at: 'end' });
    }
    const index = Number(blockEl.dataset.index);
    // Only pictures in this block: there is no text to show, ever.
    if (!this.partsOf(this.blocks[index])) return this.besideEmbeds(index, event);
    let prefix = null;
    const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    if (range && blockEl.contains(range.startContainer)) prefix = textBefore(blockEl, range.startContainer, range.startOffset);
    this.activate(index, prefix === null ? { at: 'end' } : { prefix });
  }

  // Beside a block that holds only pictures, a click starts a new paragraph
  // on that side of them, the way a word processor puts the caret there.
  besideEmbeds(index, event) {
    const el = this.liveEl.children[index];
    const media = el ? [...el.querySelectorAll('img, .embed, video, audio')].map((item) => item.getBoundingClientRect()) : [];
    const first = media[0];
    const before = !!first && (event.clientY < first.top || (event.clientX < first.left && event.clientY <= first.bottom));
    this.insertParagraph(index, before ? 'before' : 'after');
  }

  // How a block is typed in: `head` and `tail` are lines made only of
  // embeds, which stay drawn above and below the text; `middle` is the text,
  // where each remaining embed shows as one symbol. Null when the block holds
  // nothing but embeds.
  partsOf(block) {
    if (!block) return null;
    const lines = this.lines().slice(block.start, block.end + 1);
    const type = block.token.type;
    const objects = !LITERAL.has(type);
    if (!objects || type !== 'paragraph') return { head: '', middle: lines.join('\n'), tail: '', objects };
    const only = lines.map((line) => {
      const embeds = findEmbeds(line);
      if (!embeds.length) return false;
      let rest = line;
      for (const embed of embeds.reverse()) rest = rest.slice(0, embed.start) + rest.slice(embed.end);
      return !rest.trim();
    });
    if (only.every(Boolean)) return null;
    let first = 0; while (only[first]) first++;
    let last = lines.length - 1; while (only[last]) last--;
    return {
      head: lines.slice(0, first).map((line) => `${line}\n`).join(''),
      middle: lines.slice(first, last + 1).join('\n'),
      tail: lines.slice(last + 1).map((line) => `\n${line}`).join(''),
      objects,
    };
  }

  // Embed lines drawn around the text being typed. Each picture remembers
  // where it is written, so clicking it still selects it.
  staticPart(source, offset) {
    const part = h('div.lp-static', { html: Markdown.render(source, store.renderContext(this.path, { live: true })) });
    decorate(part);
    const images = [...part.querySelectorAll('img.embed-image')].filter((img) => !img.closest('[data-embed-path]'));
    const refs = findImages(source, this.path);
    if (refs.length === images.length) images.forEach((img, i) => { img.dataset.offset = String(offset + refs[i].start); });
    this.links.decorate(part);
    return part;
  }

  nearestEditable(from, step) {
    for (let i = from; i >= 0 && i < this.blocks.length; i += step) if (this.partsOf(this.blocks[i])) return i;
    return -1;
  }

  // Turn block `index` into text to type in. Returns false when it has none.
  activate(index, caret = { at: 'end' }) {
    if (this.active) {
      if (this.active.index === index) return true;
      const line = this.blocks[index] ? this.blocks[index].start : 0;
      this.commitActive();
      index = this.blockAtLine(line);
    }
    const block = this.blocks[index]; const el = this.liveEl && this.liveEl.children[index];
    const parts = this.partsOf(block);
    if (!block || !el || !parts) return false;
    const source = parts.head + parts.middle + parts.tail;
    const token = block.token;
    const kind = token.type === 'heading' ? `.lp-h${token.level}` : token.type === 'code' || token.type === 'frontmatter' || token.type === 'table' || token.type === 'math' ? '.lp-mono' : '';
    const textarea = h(`textarea.lp-input${kind}`, { rows: 1, spellcheck: !!app.settings.spellcheck, 'aria-label': 'Bloc en cours d’édition', autocapitalize: 'off' });
    const shown = parts.objects ? displayOf(parts.middle, this.path) : { text: parts.middle, spans: [] };
    textarea.value = shown.text;
    attachEditing(textarea, this.path);
    let base = 0;
    const lines = this.lines();
    for (let i = 0; i < block.start; i++) base += lines[i].length + 1;
    el.classList.add('is-editing');
    el.replaceChildren(...[
      parts.head ? this.staticPart(parts.head, base) : null,
      h('div.lp-input-wrap', textarea),
      parts.tail ? this.staticPart(parts.tail, base + parts.head.length + parts.middle.length) : null,
    ].filter(Boolean));
    this.active = { index, textarea, el, head: parts.head, tail: parts.tail, objects: parts.objects, spans: shown.spans, shown: shown.text };
    const resize = () => { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`; };
    textarea.addEventListener('input', () => { this.onBlockInput(); resize(); });
    textarea.addEventListener('keydown', (event) => this.onBlockKey(event));
    textarea.addEventListener('copy', (event) => this.copyShown(event, false));
    textarea.addEventListener('cut', (event) => this.copyShown(event, true));
    textarea.addEventListener('blur', () => {
      const active = this.active;
      // Switching window keeps the block open; clicking elsewhere closes it.
      setTimeout(() => { if (active && this.active === active && document.activeElement !== textarea) this.commitActive(); }, 0);
    });
    resize();
    // Where the caret goes, first as an offset in the block's Markdown.
    let offset = source.length;
    if (caret.at === 'start') offset = 0;
    else if (typeof caret.offset === 'number') offset = Math.max(0, Math.min(caret.offset, source.length));
    else if (typeof caret.prefix === 'string') {
      if (token.type === 'code') offset = Math.min(source.length, source.indexOf('\n') + 1 + caret.prefix.length);
      else if (token.type === 'frontmatter' || token.type === 'table') offset = source.length;
      else if (parts.objects) { const full = displayOf(source, this.path); offset = toSource(full.spans, mapPrefix(full.text, caret.prefix)); }
      else offset = mapPrefix(source, caret.prefix);
    }
    const inText = Math.max(0, Math.min(offset - parts.head.length, parts.middle.length));
    const at = toShown(shown.spans, inText);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(at, at);
    return true;
  }

  blockAtLine(line) {
    const at = this.blocks.findIndex((block) => line >= block.start && line <= block.end);
    if (at >= 0) return at;
    const after = this.blocks.findIndex((block) => block.start > line);
    return after < 0 ? this.blocks.length - 1 : Math.max(0, after - 1);
  }

  // Put the caret at a given line and column of the note, in live mode.
  activateAt(line, column) {
    if (this.active) this.commitActive();
    if (!this.blocks.length) return this.appendParagraph();
    const index = this.blockAtLine(line);
    const block = this.blocks[index];
    const lines = this.lines();
    let offset = 0;
    for (let i = block.start; i < Math.min(line, block.end + 1); i++) offset += lines[i].length + 1;
    return this.activate(index, { offset: line > block.end ? Infinity : offset + column });
  }

  onBlockInput() {
    const active = this.active;
    const { index, textarea } = active; const block = this.blocks[index];
    let middle = textarea.value;
    const pictures = active.spans.length;
    if (active.objects) {
      // Follow the symbols through the edit, then let any embed just
      // finished (pasted, completed, typed) become a symbol too.
      const spans = followEdit(active.shown, textarea.value, active.spans);
      middle = sourceOf(textarea.value, spans);
      const caret = toSource(spans, textarea.selectionStart);
      const shown = displayOf(middle, this.path, caret);
      if (shown.text !== textarea.value) {
        const at = toShown(shown.spans, caret);
        textarea.value = shown.text;
        textarea.setSelectionRange(at, at);
      }
      active.spans = shown.spans; active.shown = shown.text;
    }
    const lines = this.lines().slice();
    const fresh = (active.head + middle + active.tail).split('\n');
    const delta = fresh.length - (block.end - block.start + 1);
    lines.splice(block.start, block.end - block.start + 1, ...fresh);
    block.end += delta;
    for (let i = index + 1; i < this.blocks.length; i++) { this.blocks[i].start += delta; this.blocks[i].end += delta; }
    // A picture deleted or added while typing is an undo step of its own.
    this.setContent(lines.join('\n'), { step: active.spans.length !== pictures });
  }

  // Copying text that holds a symbol copies the embed it stands for.
  copyShown(event, cut) {
    const active = this.active;
    if (!active || !active.objects || !event.clipboardData) return;
    const { textarea } = active;
    const from = textarea.selectionStart; const to = textarea.selectionEnd;
    const inside = active.spans.filter((span) => span.at >= from && span.at + span.symbol.length <= to);
    if (from === to || !inside.length) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', sourceOf(textarea.value.slice(from, to), inside.map((span) => ({ ...span, at: span.at - from }))));
    if (cut) {
      textarea.setRangeText('', from, to, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  commitActive() {
    if (!this.active) return;
    const { ephemeral, textarea } = this.active;
    this.active = null;
    closeSuggest();
    // A paragraph opened by a click and left empty leaves no trace in the file.
    if (ephemeral && !textarea.value.trim() && this.content === ephemeral.after) {
      this.content = ephemeral.before; this._lines = null;
      this.history.splice(ephemeral.historyIndex + 1);
      this.historyIndex = Math.min(ephemeral.historyIndex, this.history.length - 1);
      this.lastPush = 0;
      this.saveSoon();
      bus.emit('note-content', this);
    }
    const top = this.scroller.scrollTop;
    this.renderLive();
    this.scroller.scrollTop = top;
    bus.emit('note-rendered', this);
  }

  onBlockKey(event) {
    if (event.defaultPrevented || !this.active) return;
    const { textarea, index } = this.active;
    if (this.undoKeys(event)) return;
    if (event.key === 'Escape') { event.preventDefault(); this.commitActive(); this.scroller.focus({ preventScroll: true }); return; }
    const plain = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && textarea.selectionStart === textarea.selectionEnd;
    if (!plain) return;
    if (event.key === 'ArrowUp' && caretPoint(textarea, textarea.selectionStart).y === caretPoint(textarea, 0).y) {
      const target = this.nearestEditable(index - 1, -1);
      if (target >= 0) { event.preventDefault(); this.activate(target, { at: 'end' }); }
    } else if (event.key === 'ArrowDown' && caretPoint(textarea, textarea.selectionStart).y === caretPoint(textarea, textarea.value.length).y) {
      const target = this.nearestEditable(index + 1, 1);
      if (target >= 0) { event.preventDefault(); this.activate(target, { at: 'start' }); }
    } else if (event.key === 'Backspace' && textarea.selectionStart === 0 && (index > 0 || this.active.head)) {
      event.preventDefault(); this.mergeWithPrevious();
    }
  }

  // Backspace at the very start of a block behaves as it would in plain text:
  // it removes the line break (or the blank line) that separates the blocks.
  // Right after a picture it selects the picture instead, as a word processor
  // does; a second Backspace then removes it.
  mergeWithPrevious() {
    const { index, head } = this.active;
    const block = this.blocks[index]; const previous = this.blocks[index - 1];
    const lines = this.lines();
    let base = 0;
    for (let i = 0; i < block.start; i++) base += lines[i].length + 1;
    let picture = null;
    if (head) picture = findEmbeds(head).pop();
    else if (previous && !this.partsOf(previous)) {
      let start = 0;
      for (let i = 0; i < previous.start; i++) start += lines[i].length + 1;
      const last = findEmbeds(lines.slice(previous.start, previous.end + 1).join('\n')).pop();
      if (last) picture = { start: last.start + start - base };
    }
    if (picture) {
      this.commitActive();
      const entry = this.images.entryAt(base + picture.start);
      if (entry) this.images.select(entry);
      return;
    }
    if (!previous) return;
    if (!EDITABLE_JOIN.has(previous.token.type) || !EDITABLE_JOIN.has(block.token.type)) { const target = this.nearestEditable(index - 1, -1); if (target >= 0) this.activate(target, { at: 'end' }); return; }
    const next = lines.slice();
    let line; let column;
    if (block.start - previous.end > 1) { next.splice(block.start - 1, 1); line = block.start - 1; column = 0; }
    else { column = next[previous.end].length; next.splice(previous.end, 2, next[previous.end] + next[block.start]); line = previous.end; }
    this.active = null;
    this.setContent(next.join('\n'));
    this.renderLive();
    this.activateAt(line, column);
  }

  // An empty paragraph to type in, at line `line` of the (already changed)
  // note. It disappears again if nothing is typed in it.
  openParagraph(line, before) {
    const top = this.scroller.scrollTop;
    this.renderLive();
    this.scroller.scrollTop = top;
    const block = { start: line, end: line, token: { type: 'paragraph', text: '', start: line, end: line } };
    let at = this.blocks.findIndex((item) => item.start > line);
    if (at < 0) at = this.blocks.length;
    this.blocks.splice(at, 0, block);
    const el = this.blockElement(block, at, store.renderContext(this.path, { live: true }));
    const elements = this.liveEl.querySelectorAll(':scope > .lp-block');
    this.liveEl.insertBefore(el, elements[at] || this.tail);
    this.liveEl.querySelectorAll(':scope > .lp-block').forEach((child, i) => { child.dataset.index = String(i); });
    this.activate(at, { at: 'end' });
    if (this.active) this.active.ephemeral = { ...before, after: this.content };
  }

  insertParagraph(index, where) {
    if (this.active) this.commitActive();
    const block = this.blocks[index];
    if (!block) return;
    const before = { before: this.content, historyIndex: this.historyIndex };
    const lines = this.lines().slice();
    let line;
    if (where === 'before') {
      const gap = block.start === 0 || !lines[block.start - 1].trim();
      lines.splice(block.start, 0, ...(gap ? ['', ''] : ['', '', '']));
      line = gap ? block.start : block.start + 1;
    } else {
      const next = lines[block.end + 1];
      const gap = next === undefined || !next.trim();
      lines.splice(block.end + 1, 0, ...(gap ? ['', ''] : ['', '', '']));
      line = block.end + 2;
    }
    this.setContent(lines.join('\n'));
    this.openParagraph(line, before);
  }

  appendParagraph() {
    if (this.active) this.commitActive();
    const before = { before: this.content, historyIndex: this.historyIndex };
    // Exactly one blank line between the last block and the new one, however
    // many times the end of the page is clicked.
    const kept = this.content.replace(/\s+$/, '');
    this.setContent(kept ? `${kept}\n\n` : '');
    this.openParagraph(this.lines().length - 1, before);
  }

  focusBody() {
    if (this.mode === 'source' && this.sourceArea) { this.sourceArea.focus(); return; }
    if (this.mode !== 'live') return;
    const first = this.blocks.findIndex((block) => block.token.type !== 'frontmatter' && this.partsOf(block));
    if (first >= 0) this.activate(first, { at: 'end' }); else this.appendParagraph();
  }

  focusTitle() {
    this.titleEl.focus();
    const range = document.createRange();
    range.selectNodeContents(this.titleEl);
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
  }

  // The textarea the user is typing in, if any (used by formatting commands).
  activeTextarea() { return this.mode === 'source' ? this.sourceArea : this.active ? this.active.textarea : null; }

  // Used for a file dropped anywhere over the application, not only over the
  // textarea. In the live view the files land where they were dropped
  // (`options.target`, from dropTargetAt); otherwise at the caret if there is
  // one, or at the end of the note.
  async insertAttachments(paths, options = {}) {
    const files = options.files || [];
    const embeds = await Promise.all(paths.map((path, index) => embedFor(path, files[index])));
    if (!embeds.length) return;
    if (this.mode === 'live' && (options.target || !this.active)) { this.images.insertEmbeds(embeds, options.target || null); return; }
    this.insertText(embeds.join(' '));
  }

  // At the caret when there is one, otherwise as a new paragraph at the end.
  insertText(text) {
    const textarea = this.activeTextarea();
    if (textarea) {
      const { selectionStart: from, selectionEnd: to, value } = textarea;
      const left = from > 0 && !/\s/.test(value[from - 1]) ? ' ' : '';
      const right = to < value.length && !/\s/.test(value[to]) ? ' ' : '';
      textarea.focus();
      textarea.setRangeText(left + text + right, from, to, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    this.setContent(this.content.trimEnd() ? `${this.content.trimEnd()}\n\n${text}\n` : `${text}\n`);
    if (this.mode !== 'source') this.render();
  }

  // Where files dropped at (x, y) would go in the live view, or null.
  dropTargetAt(x, y) {
    if (this.mode !== 'live' || !this.loaded) return null;
    const box = this.scroller.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
    return this.images.dropTarget(x, y);
  }
  previewDrop(x, y) { const target = this.dropTargetAt(x, y); this.images.showCaret(target); return !!target; }
  clearDropPreview() { this.images.hideCaret(); }

  // "Insert an image": at `target` when given (right-click in the live view),
  // otherwise at the caret while typing, or at the end of the note.
  async chooseImages(target = null) {
    if (this.mode === 'reading') this.setMode(this.editMode);
    const files = (await pickImageFiles()).filter(isImageFile);
    if (!files.length) return;
    if (this.mode === 'live' && (target || !this.active)) { this.images.insertFiles(files, target); return; }
    try {
      const embeds = [];
      for (const file of files) { const path = await uploadFile(file, this.path); embeds.push(await embedFor(path, file)); }
      this.insertText(embeds.join(' '));
    } catch (error) { reportError(error); }
  }

  // ----------------------------------------------------------- content flow
  // `step`: a change of its own for undo (an image moved, a link repaired),
  // never merged with the typing just before or after it.
  setContent(text, options = {}) {
    if (text === this.content) return;
    this.content = text; this._lines = null;
    if (options.step) this.lastPush = 0;
    this.pushHistory();
    if (options.step) this.lastPush = 0;
    this.saveSoon();
    bus.emit('note-content', this);
  }

  pushHistory() {
    const now = Date.now(); const top = this.history[this.historyIndex];
    if (top && top.text === this.content) return;
    // Quick successive keystrokes collapse into one undo step.
    if (top && this.historyIndex > 0 && this.historyIndex === this.history.length - 1 && now - this.lastPush < 500) { top.text = this.content; this.lastPush = now; return; }
    this.history.splice(this.historyIndex + 1);
    this.history.push({ text: this.content });
    if (this.history.length > 300) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.lastPush = now;
  }

  // `caret` false: undo from the page itself (after moving an image, say)
  // redraws it instead of opening the changed block for typing.
  undoKeys(event, caret = true) {
    if (!primary(event) || event.altKey) return false;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) { event.preventDefault(); this.travel(-1, caret); return true; }
    if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); this.travel(1, caret); return true; }
    return false;
  }

  travel(step, caret = true) {
    const target = this.history[this.historyIndex + step];
    if (!target) return;
    const before = this.content;
    this.historyIndex += step; this.lastPush = 0;
    this.content = target.text; this._lines = null;
    this.saveSoon();
    bus.emit('note-content', this);
    // Land the caret where the text changed.
    let at = 0;
    const limit = Math.min(before.length, target.text.length);
    while (at < limit && before[at] === target.text[at]) at++;
    let same = 0;
    while (same < limit - at && before[before.length - 1 - same] === target.text[target.text.length - 1 - same]) same++;
    const changedBefore = before.length - same; const changedAfter = target.text.length - same;
    // Undoing a picture's move, size or removal brings the picture back where
    // it was and selects it; its Markdown is never shown.
    const pictures = embedIn(target.text, at, changedAfter);
    const picture = pictures.find((embed) => before.slice(embed.start, embed.end) !== embed.raw) || pictures[0];
    const layout = !!picture || embedIn(before, at, changedBefore).length > 0;
    if (this.mode === 'source' && this.sourceArea) {
      this.renderSource();
      this.sourceArea.focus(); this.sourceArea.setSelectionRange(at, at);
    } else if (this.mode === 'live' && (!caret || layout)) {
      this.active = null;
      const top = this.scroller.scrollTop;
      this.renderLive();
      this.scroller.scrollTop = top;
      this.scroller.focus({ preventScroll: true });
      bus.emit('note-rendered', this);
      const entry = picture && this.images.entryAt(picture.start);
      if (entry) {
        this.images.select(entry);
        entry.img.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        entry.img.animate([{ transform: 'scale(.97)', opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)' });
      }
    } else if (this.mode === 'live') {
      this.active = null;
      this.renderLive();
      const head = this.content.slice(0, at);
      const line = head.split('\n').length - 1;
      this.activateAt(line, at - (head.lastIndexOf('\n') + 1));
    } else this.render();
  }

  async save() {
    if (!this.loaded || this.conflict || this.content === this.saved) return;
    if (this.saving) { this.saveSoon(); return; }
    this.saving = true;
    const text = this.content;
    try {
      // While the window is closing, the request must be allowed to outlive it.
      const result = await api('/api/note', { method: 'PUT', body: { path: this.path, content: text, baseMtime: this.mtime }, keepalive: !!app.unloading && text.length < 60000 });
      this.mtime = result.mtime; this.saved = text;
    } catch (error) {
      if (error.code === 'conflict') this.showConflict(error.data.current);
      else if (error.status === 404 || error.code === 'missing') reportError(new Error('La note a été déplacée ou supprimée : enregistrement impossible.'));
      else reportError(error);
    } finally {
      this.saving = false;
      const pending = this.pendingMtime; this.pendingMtime = null;
      if (pending !== null && pending !== this.mtime) this.externalChange();
      else if (this.content !== this.saved && !this.conflict) this.saveSoon();
      bus.emit('note-saved', this);
    }
  }

  flush() { this.saveSoon.cancel(); return this.save(); }
  get dirty() { return this.content !== this.saved; }

  // The index reports a new version of this file.
  onFileChanged(entry) {
    if (!this.loaded || entry.mtime === this.mtime) return;
    // Our own save may be announced before its HTTP answer arrives.
    if (this.saving) { this.pendingMtime = entry.mtime; return; }
    this.externalChange();
  }

  async externalChange() {
    let note;
    try { note = await api(`/api/note?path=${encodeURIComponent(this.path)}`); } catch { return; }
    if (note.mtime === this.mtime) return;
    if (note.content === this.content) { this.mtime = note.mtime; this.saved = note.content; return; }
    if (this.dirty) return this.showConflict(note);
    this.adopt(note);
  }

  adopt(note) {
    const editing = this.mode === 'live' && this.active ? this.blocks[this.active.index].start : null;
    this.content = this.saved = note.content; this.mtime = note.mtime; this._lines = null;
    this.pushHistory();
    this.clearConflict();
    this.render();
    if (editing !== null) this.activateAt(editing, 0);
    bus.emit('note-content', this);
  }

  showConflict(current) {
    this.conflict = true;
    this.banner.hidden = false;
    this.banner.replaceChildren(
      h('span', 'Cette note a été modifiée en dehors de cet onglet pendant que vous écriviez.'),
      h('button.btn.small', { type: 'button', onClick: () => this.adopt(current) }, 'Charger la version du disque'),
      h('button.btn.small.primary', { type: 'button', onClick: () => { this.mtime = current.mtime; this.clearConflict(); this.flush(); } }, 'Garder ma version'));
  }
  clearConflict() { this.conflict = false; this.banner.hidden = true; this.banner.replaceChildren(); }

  // ----------------------------------------------------------------- modes
  setMode(mode) {
    if (mode === this.mode) return;
    if (this.active) this.commitActive();
    this.mode = mode;
    if (mode !== 'reading') this.editMode = mode;
    this.render();
    app.workspace.persist();
    bus.emit('note-mode', this);
  }
  toggleReading() { this.setMode(this.mode === 'reading' ? this.editMode : 'reading'); }
  toggleSource() { this.setMode(this.mode === 'source' ? 'live' : 'source'); }

  toggleTask(line) {
    const lines = this.lines().slice();
    const match = /^(\s*(?:>\s?)*(?:[-*+]|\d+[.)])\s+)\[(.)\]/.exec(lines[line] || '');
    if (!match) return;
    lines[line] = `${match[1]}[${match[2] === ' ' ? 'x' : ' '}]${lines[line].slice(match[0].length)}`;
    this.active = null;
    this.setContent(lines.join('\n'), { step: true });
    this.render();
  }

  // ------------------------------------------------------------ navigation
  scrollToLine(line, flash) {
    if (this.mode === 'source' && this.sourceArea) {
      const offset = this.lines().slice(0, line).reduce((sum, value) => sum + value.length + 1, 0);
      const point = caretPoint(this.sourceArea, offset);
      this.scroller.scrollTop += point.y - this.scroller.getBoundingClientRect().top - 80;
      this.sourceArea.focus({ preventScroll: true }); this.sourceArea.setSelectionRange(offset, offset);
      return;
    }
    if (this.active) this.commitActive();
    const candidates = [...this.body.querySelectorAll('[data-line]')].filter((element) => !element.closest('[data-embed-path]'));
    let best = null;
    for (const element of candidates) { const value = Number(element.dataset.line); if (value <= line && (!best || value >= Number(best.dataset.line))) best = element; }
    if (!best) return;
    best.scrollIntoView({ block: 'start', behavior: 'auto' });
    this.scroller.scrollTop -= 24;
    if (flash) { best.classList.add('flash'); setTimeout(() => best.classList.remove('flash'), 1500); }
  }

  followAnchor(subpath) {
    if (!subpath) return;
    const meta = Meta.extract(this.content);
    if (subpath.startsWith('^')) {
      const block = meta.blockIds.find((item) => item.id.toLowerCase() === subpath.slice(1).toLowerCase());
      if (block) this.scrollToLine(block.line, true);
      return;
    }
    const wanted = subpath.split('#').pop().trim().toLowerCase();
    const heading = meta.headings.find((item) => Markdown.plainText(item.text).toLowerCase() === wanted || item.text.toLowerCase() === wanted);
    if (heading) this.scrollToLine(heading.line, true);
  }

  // ------------------------------------------------------ rename and menu
  async renameFromTitle() {
    const wanted = this.titleEl.textContent.replace(/\s+/g, ' ').trim();
    const current = Meta.stem(this.path);
    if (!wanted || wanted === current) { this.titleEl.textContent = current; return; }
    try {
      await this.flush();
      await api('/api/rename', { method: 'POST', body: { from: this.path, to: Meta.joinPath(Meta.dirName(this.path), `${wanted}.md`) } });
    } catch (error) { this.titleEl.textContent = current; reportError(error); }
  }

  setPath(path) {
    this.path = path;
    for (const textarea of this.el.querySelectorAll('textarea')) textarea.dataset.notePath = path;
    this.updateHeader();
  }

  openMenu(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const bookmarked = app.bookmarks.includes(this.path);
    showMenu(rect.right - 220, rect.bottom + 4, [
      { label: 'Aperçu en direct', checked: this.mode === 'live', run: () => this.setMode('live') },
      { label: 'Mode source', checked: this.mode === 'source', run: () => this.setMode('source') },
      { label: 'Mode lecture', checked: this.mode === 'reading', run: () => this.setMode('reading'), hint: 'Ctrl+E' },
      'separator',
      { label: 'Renommer', icon: 'pencil', run: () => this.focusTitle(), hint: 'F2' },
      { label: 'Déplacer vers…', icon: 'folder', run: () => app.explorer.moveDialog(this.path) },
      { label: bookmarked ? 'Retirer des signets' : 'Ajouter aux signets', icon: 'bookmark', run: () => app.panels.toggleBookmark(this.path) },
      { label: 'Ouvrir le graphe local', icon: 'graph', run: () => app.panels.showRight('graph') },
      'separator',
      { label: 'Copier le lien [[…]]', icon: 'link', run: () => navigator.clipboard.writeText(`[[${store.linkText(this.path)}]]`).then(() => toast('Lien copié')) },
      { label: 'Copier le chemin', icon: 'copy', run: () => navigator.clipboard.writeText(this.path).then(() => toast('Chemin copié')) },
      { label: TEXT.revealItem, icon: 'external', run: () => api('/api/reveal', { method: 'POST', body: { path: this.path } }).catch(reportError) },
      'separator',
      { label: 'Supprimer la note', icon: 'trash', danger: true, run: () => this.deleteNote() },
    ]);
  }

  // Right-click in the note: clipboard actions while typing, link actions on a link.
  contextMenu(event) {
    if (this.mode === 'live' && this.images.contextMenu(event)) return undefined;
    event.preventDefault();
    const textarea = event.target.closest('textarea');
    const missing = event.target.closest('.embed-missing.is-broken-link');
    if (missing && !event.target.closest('[data-embed-path]')) return showMenu(event.clientX, event.clientY, [{ label: 'Réparer l’image…', icon: 'image', run: () => this.repairLink(missing) }]);
    const link = event.target.closest('a.internal-link');
    const selected = String(window.getSelection() || '');
    if (textarea) {
      const has = textarea.selectionStart !== textarea.selectionEnd;
      const paste = async () => {
        try {
          const text = await navigator.clipboard.readText();
          textarea.focus();
          textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        } catch { toast(keys('Collez avec Ctrl+V : l’accès au presse-papiers a été refusé.')); }
      };
      const command = (name) => () => { textarea.focus(); document.execCommand(name); };
      return showMenu(event.clientX, event.clientY, [
        { label: 'Couper', run: command('cut'), disabled: !has, hint: 'Ctrl+X' },
        { label: 'Copier', icon: 'copy', run: command('copy'), disabled: !has, hint: 'Ctrl+C' },
        { label: 'Coller', run: paste, hint: 'Ctrl+V' },
        { label: 'Tout sélectionner', run: () => { textarea.focus(); textarea.select(); }, hint: 'Ctrl+A' },
        'separator',
        { label: 'Gras', run: () => app.commands.run('format:bold'), hint: 'Ctrl+B' },
        { label: 'Italique', run: () => app.commands.run('format:italic'), hint: 'Ctrl+I' },
        { label: 'Lien interne [[…]]', icon: 'link', run: () => app.commands.run('format:wikilink') },
        { label: 'Case à cocher', icon: 'check', run: () => app.commands.run('format:task'), hint: 'Ctrl+L' },
      ]);
    }
    if (link) {
      const source = (link.closest('[data-embed-path]') || {}).dataset ? link.closest('[data-embed-path]').dataset.embedPath : this.path;
      const open = (newTab) => app.workspace.openLink({ target: link.dataset.href || '', subpath: link.dataset.subpath || '', path: link.dataset.path || '', source, newTab, view: this });
      const broken = link.closest('.is-broken-link');
      if (broken && broken.matches('.embed-missing')) return showMenu(event.clientX, event.clientY, [{ label: 'Réparer l’image…', icon: 'image', run: () => this.repairLink(broken) }]);
      return showMenu(event.clientX, event.clientY, [
        broken ? { label: 'Réparer le lien…', icon: 'link', run: () => this.repairLink(broken) } : null,
        broken ? 'separator' : null,
        { label: link.dataset.path ? 'Ouvrir' : 'Créer la note', icon: 'file', run: () => open(false) },
        { label: 'Ouvrir dans un nouvel onglet', icon: 'plus', run: () => open(true) },
        link.dataset.path ? { label: 'Afficher dans l’explorateur de fichiers', icon: 'locate', run: () => app.explorer.reveal(link.dataset.path) } : null,
      ]);
    }
    if (selected) return showMenu(event.clientX, event.clientY, [{ label: 'Copier', icon: 'copy', run: () => navigator.clipboard.writeText(selected).then(() => toast('Copié')), hint: 'Ctrl+C' }]);
    if (this.mode === 'live') {
      const target = this.images.dropTarget(event.clientX, event.clientY);
      return showMenu(event.clientX, event.clientY, [{ label: 'Insérer une image ici…', icon: 'image', run: () => this.chooseImages(target) }]);
    }
    return undefined;
  }

  async deleteNote() {
    const ok = await confirmDialog({ title: 'Supprimer la note', message: `« ${Meta.stem(this.path)} » sera ${app.settings.trash === 'permanent' ? 'supprimée définitivement' : 'déplacée dans la corbeille'}.`, confirm: 'Supprimer', danger: true });
    if (!ok) return;
    this.saveSoon.cancel(); this.saved = this.content;
    try { await api('/api/delete', { method: 'POST', body: { path: this.path } }); } catch (error) { reportError(error); }
  }

  stats() {
    const meta = Meta.extract(this.content);
    return { words: meta.words, chars: meta.chars, backlinks: store.backlinkCount(this.path) };
  }

  onHide() { this.images.reset(); }
  destroy() { this.images.reset(); closeSuggest(); if (this.dirty) this.flush(); }
}
