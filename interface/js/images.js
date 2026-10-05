// Opale — images in the live view, handled the way a word processor does:
// click a picture to select it, drag a corner to resize it, drag the picture
// itself to move it elsewhere in the text, and choose how the text flows
// around it. Every change is written back to the Markdown, for instance
// "![[photo.png|left|320]]", so the note stays a plain text file.
import { app, bus, h, icon, Markdown, Meta, reportError, showMenu, toast } from './core.js';
import { store } from './store.js';
import { embedFor, uploadFile } from './editing.js';
import { keyLabel, keys, primary } from './platform.js';
import { findLinks } from './links.js';

// Blocks whose text an image can be dropped into; any other block (code,
// table, rule…) receives it as a new paragraph before or after it.
const INLINE_TYPES = new Set(['paragraph', 'heading', 'list', 'blockquote', 'footnote']);
const IMAGE_RE = /!\[\[([^\[\]\n]+?)\]\]|!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"\n]*)")?\s*\)/g;
const REMOTE_IMAGE = /^(https?:|data:image\/(png|jpe?g|gif|webp|avif);)/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HIDDEN = '\u0001';
const MIN_WIDTH = 48;

function safeDecode(value) { try { return decodeURIComponent(value); } catch { return value; } }
const blank = (length) => ' '.repeat(length);

// Every image written in `text` that the renderer turns into a picture, in
// reading order, with its offsets. Inline code and comments are not rendered,
// so they are masked first; the result lines up with the <img> elements.
export function findImages(text, notePath) {
  const masked = text.replace(/(`+)(?!`)([^]*?[^`])\1(?!`)/g, (m) => blank(m.length)).replace(/%%[^]*?%%/g, (m) => blank(m.length));
  const found = [];
  IMAGE_RE.lastIndex = 0;
  let match;
  while ((match = IMAGE_RE.exec(masked))) {
    if (masked[match.index - 1] === '\\') continue;
    let image = false;
    if (match[1] !== undefined) {
      const path = store.resolve(Meta.parseWikiInner(match[1]).target, notePath);
      image = !!path && Meta.kindOf(path) === 'image';
    } else if (REMOTE_IMAGE.test(match[3])) image = true;
    else if (!SCHEME.test(match[3])) {
      const path = store.resolve(safeDecode(match[3].split('#')[0]), notePath);
      image = !!path && Meta.kindOf(path) === 'image';
    }
    if (image) found.push({ start: match.index, end: match.index + match[0].length, raw: text.slice(match.index, match.index + match[0].length) });
  }
  return found;
}

// Placement and size currently written for one image.
export function optionsOf(raw) {
  const wiki = /^!\[\[([^]*)\]\]$/.exec(raw);
  if (wiki) { const pipe = wiki[1].search(/\\?\|/); return Markdown.imageOptions(pipe < 0 ? '' : wiki[1].slice(pipe).replace(/^\\?\|/, '')); }
  const md = /^!\[([^\]]*)\]/.exec(raw);
  return Markdown.imageOptions(md ? md[1] : '');
}

// Where the visible text `prefix` ends in the Markdown `source`, ignoring
// syntax characters that are not displayed (same idea as the click mapping).
function mapPrefix(source, prefix) {
  const wanted = prefix.replace(/\s+/g, ' ');
  let matched = 0; let i = 0;
  for (; i < source.length && matched < wanted.length; i++) {
    const ch = source[i]; const next = wanted[matched];
    if (ch === next || (next === ' ' && /\s/.test(ch))) matched++;
  }
  return i;
}

// The nearer edge of the word `offset` falls in, if it falls inside one.
function snapToWord(text, offset) {
  const inWord = (ch) => !!ch && !/\s/.test(ch) && ch !== HIDDEN;
  if (!inWord(text[offset - 1]) || !inWord(text[offset])) return offset;
  let back = offset; let ahead = offset;
  while (inWord(text[back - 1])) back--;
  while (inWord(text[ahead])) ahead++;
  return offset - back <= ahead - offset ? back : ahead;
}

// The markers at the start of a block an image must not be put before.
function leadOf(source, type) {
  const pattern = type === 'list' ? /^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/
    : type === 'heading' ? /^\s{0,3}#{1,6}\s+/
      : type === 'blockquote' ? /^(?:\s*>\s?)+(?:\[![^\]]*\][+-]?[^\n]*\n(?:\s*>\s?)*)?/
        : type === 'footnote' ? /^\[\^[^\]]+\]:\s*/ : null;
  const match = pattern && pattern.exec(source);
  return match ? match[0].length : 0;
}

function offsetOfLine(lines, line) {
  let offset = 0;
  for (let i = 0; i < line; i++) offset += lines[i].length + 1;
  return offset;
}

export function pickImageFiles() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*,.svg', multiple: true, hidden: true, 'aria-label': 'Choisir une ou plusieurs images' });
    input.addEventListener('change', () => { resolve([...(input.files || [])]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export const isImageFile = (file) => (file.type || '').startsWith('image/') || Meta.kindOf(file.name || '') === 'image';

export class ImageLayer {
  constructor(view) {
    this.view = view;
    this.selected = null; this.frame = null; this.toolbar = null; this.sizeLabel = null;
    this.caret = null; this.ghost = null; this.observer = null;
    this.outside = (event) => {
      if (!this.selected) return;
      const target = event.target;
      if (target === this.selected.img || (this.frame && this.frame.contains(target)) || (this.toolbar && this.toolbar.contains(target))) return;
      this.clear();
    };
  }

  // ---------------------------------------------------------------- mapping
  // Each picture of the live view with the Markdown it comes from.
  entries() {
    const view = this.view; const out = [];
    if (!view.liveEl) return out;
    const lines = view.lines();
    for (const el of view.liveEl.querySelectorAll(':scope > .lp-block')) {
      if (el.classList.contains('is-editing')) continue;
      const block = view.blocks[Number(el.dataset.index)];
      if (!block || block.token.type === 'frontmatter') continue;
      const images = [...el.querySelectorAll('img.embed-image')].filter((img) => !img.closest('[data-embed-path]'));
      if (!images.length) continue;
      const base = offsetOfLine(lines, block.start);
      const refs = findImages(lines.slice(block.start, block.end + 1).join('\n'), view.path);
      // Anything the mapping cannot account for is left to plain text editing.
      if (refs.length !== images.length) continue;
      images.forEach((img, i) => out.push({ img, blockEl: el, start: base + refs[i].start, end: base + refs[i].end, raw: refs[i].raw }));
    }
    return out;
  }
  entryFor(img) { return this.entries().find((entry) => entry.img === img) || null; }
  entryAt(start) { return this.entries().find((entry) => entry.start === start) || null; }
  isManaged(img) { return !!img && !!this.view.liveEl && this.view.liveEl.contains(img) && !img.closest('[data-embed-path]'); }

  // -------------------------------------------------------------- selection
  select(entry) {
    this.clear();
    const live = this.view.liveEl;
    if (!entry || !live) return;
    const options = optionsOf(entry.raw);
    this.selected = { start: entry.start, img: entry.img, blockEl: entry.blockEl };
    entry.img.classList.add('is-selected');
    this.frame = h('div.img-frame', { 'aria-hidden': 'true' }, ['nw', 'ne', 'sw', 'se'].map((corner) => h('span.img-handle', { dataset: { corner }, title: 'Redimensionner', onPointerdown: (event) => this.startResize(event, corner) })));
    this.toolbar = this.buildToolbar(options);
    live.append(this.frame, this.toolbar);
    this.place();
    if (!entry.img.complete) entry.img.addEventListener('load', () => this.place(), { once: true });
    this.observer = new ResizeObserver(() => this.place());
    this.observer.observe(live);
    document.addEventListener('mousedown', this.outside, true);
    this.view.scroller.focus({ preventScroll: true });
  }

  clear() {
    if (this.selected) this.selected.img.classList.remove('is-selected');
    if (this.frame) this.frame.remove();
    if (this.toolbar) this.toolbar.remove();
    if (this.observer) this.observer.disconnect();
    document.removeEventListener('mousedown', this.outside, true);
    this.selected = null; this.frame = null; this.toolbar = null; this.observer = null;
  }

  // The live view is about to be redrawn: what we hold points at old nodes.
  reset() { if (this.cancelMove) this.cancelMove(); this.clear(); this.hideCaret(); }

  place() {
    const selected = this.selected; const live = this.view.liveEl;
    if (!selected || !this.frame || !live) return;
    const host = live.getBoundingClientRect(); const rect = selected.img.getBoundingClientRect();
    Object.assign(this.frame.style, { left: `${rect.left - host.left}px`, top: `${rect.top - host.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const bar = this.toolbar; const width = bar.offsetWidth; const height = bar.offsetHeight;
    const left = Math.max(Math.min(0, host.width - width), Math.min(rect.left - host.left + rect.width / 2 - width / 2, host.width - width));
    const room = rect.top - this.view.scroller.getBoundingClientRect().top;
    const top = room > height + 12 ? rect.top - host.top - height - 8 : rect.bottom - host.top + 8;
    bar.style.left = `${left}px`; bar.style.top = `${top}px`;
  }

  buildToolbar(options) {
    const tool = (name, title, active, run, text) => h(`button.img-tool${active ? '.active' : ''}`, {
      type: 'button', title, 'aria-label': title, 'aria-pressed': active ? 'true' : undefined, html: text ? undefined : icon(name, 16),
      onMousedown: (event) => event.preventDefault(),
      onClick: (event) => { event.stopPropagation(); run(); },
    }, text || null);
    const start = () => this.selected && this.selected.start;
    this.sizeLabel = h('span.img-size', options.width ? `${options.width} px` : 'origine');
    return h('div.img-toolbar', { role: 'toolbar', 'aria-label': 'Mise en page de l’image' },
      tool('img-inline', 'Aligné sur le texte', !options.align, () => this.update(start(), { align: '' })),
      tool('img-left', 'À gauche, le texte l’entoure', options.align === 'left', () => this.update(start(), { align: 'left' })),
      tool('img-center', 'Centrée, seule sur sa ligne', options.align === 'center', () => this.update(start(), { align: 'center' })),
      tool('img-right', 'À droite, le texte l’entoure', options.align === 'right', () => this.update(start(), { align: 'right' })),
      h('span.img-sep'),
      tool('', 'Petite : un quart de la largeur', false, () => this.setFraction(start(), 0.25), 'S'),
      tool('', 'Moyenne : la moitié de la largeur', false, () => this.setFraction(start(), 0.5), 'M'),
      tool('', 'Grande : toute la largeur', false, () => this.setFraction(start(), 1), 'L'),
      tool('', 'Taille d’origine', !options.width, () => this.update(start(), { width: null }), '1:1'),
      this.sizeLabel,
      h('span.img-sep'),
      tool('image', 'Remplacer l’image… (double-clic)', false, () => this.replaceFile(start())),
      tool('trash', `Retirer de la note (${keyLabel('Backspace')})`, false, () => this.remove(start())));
  }

  // --------------------------------------------------------------- changes
  rerender(start) {
    const view = this.view; const top = view.scroller.scrollTop;
    view.renderLive();
    view.scroller.scrollTop = top;
    bus.emit('note-rendered', view);
    if (start === null || start === undefined) return;
    const entry = this.entryAt(start);
    if (entry) this.select(entry);
  }

  update(start, change) {
    const entry = typeof start === 'number' ? this.entryAt(start) : null;
    if (!entry) return;
    const raw = Markdown.rewriteImage(entry.raw, change);
    if (raw === entry.raw) return;
    const content = this.view.content;
    const from = entry.img.getBoundingClientRect();
    this.view.setContent(content.slice(0, entry.start) + raw + content.slice(entry.end), { step: true });
    this.rerender(entry.start);
    this.land(entry.start, from);
  }

  // The picture glides from where it was to where it now is.
  land(start, from) {
    const entry = from && this.entryAt(start);
    if (!entry) return;
    const to = entry.img.getBoundingClientRect();
    if (!to.width || !from.width) return;
    const dx = from.left - to.left; const dy = from.top - to.top; const scale = from.width / to.width;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(scale - 1) < 0.01) return;
    entry.img.style.transformOrigin = '0 0';
    const animation = entry.img.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    if (this.frame) { this.frame.animate([{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }], { duration: 340 }); }
    if (this.toolbar) { this.toolbar.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2, .8, .2, 1)' }); }
    animation.onfinish = () => { entry.img.style.transformOrigin = ''; };
  }

  maxWidth(entry) {
    const container = entry.img.parentElement || entry.blockEl;
    return Math.max(MIN_WIDTH, Math.floor((container || this.view.liveEl).clientWidth));
  }

  setFraction(start, fraction) {
    const entry = typeof start === 'number' ? this.entryAt(start) : null;
    if (entry) this.update(start, { width: Math.max(MIN_WIDTH, Math.round(this.maxWidth(entry) * fraction)) });
  }

  remove(start) {
    const entry = typeof start === 'number' ? this.entryAt(start) : null;
    if (!entry) return;
    this.view.setContent(Markdown.removeSpan(this.view.content, entry.start, entry.end), { step: true });
    this.rerender(null);
    this.view.scroller.focus({ preventScroll: true });
    toast(keys('Image retirée de la note. Le fichier reste dans le coffre (Ctrl+Z pour annuler).'));
  }

  // Point the picture at another file of the vault, in the same small window
  // that repairs a broken one. The Markdown itself is never shown.
  replaceFile(start) {
    const entry = typeof start === 'number' ? this.entryAt(start) : null;
    if (!entry) return;
    const link = findLinks(entry.raw)[0];
    if (!link) return;
    this.view.links.openFor({ ...link, base: entry.start }, this.toolbar || entry.img, { title: 'Remplacer l’image', text: 'Choisissez l’image à afficher à la place :' });
  }

  // ----------------------------------------------------------------- mouse
  // Live view mousedown. Returns true when the image layer took the event.
  onMouseDown(event) {
    if (event.target.closest('.img-frame, .img-toolbar')) return true;
    const img = event.target.closest('img.embed-image');
    if (!img || event.button !== 0 || !this.isManaged(img)) return false;
    // ⌘-click (Ctrl+click elsewhere) opens the picture in a tab (see renderer.js).
    if (primary(event)) { event.preventDefault(); return true; }
    let entry = this.entryFor(img);
    // A picture drawn above or below the text being typed: close the typing
    // and pick the picture up.
    if (!entry && img.dataset.offset && this.view.active && this.view.active.el.contains(img)) {
      event.preventDefault();
      const start = Number(img.dataset.offset);
      this.view.commitActive();
      entry = this.entryAt(start);
      if (!entry) return true;
      this.select(entry);
      this.startMove(event, entry);
      return true;
    }
    if (!entry) return false;
    event.preventDefault();
    if (this.view.active) {
      const start = entry.start;
      this.view.commitActive();
      entry = this.entryAt(start);
      if (!entry) return true;
    }
    if (!this.selected || this.selected.img !== entry.img) this.select(entry);
    this.startMove(event, entry);
    return true;
  }

  onDoubleClick(event) {
    const img = event.target.closest('img.embed-image');
    if (!img || !this.isManaged(img)) return false;
    const entry = this.entryFor(img);
    if (!entry) return false;
    event.preventDefault();
    this.replaceFile(entry.start);
    return true;
  }

  startResize(event, corner) {
    const selected = this.selected;
    if (!selected || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const entry = this.entryAt(selected.start);
    if (!entry) return;
    const img = entry.img; const handle = event.currentTarget;
    const rect = img.getBoundingClientRect();
    const startX = event.clientX; const startY = event.clientY; const startWidth = rect.width;
    const ratio = rect.height ? rect.width / rect.height : 1;
    const max = this.maxWidth(entry);
    // A centred picture grows on both sides at once.
    const factor = img.classList.contains('align-center') ? 2 : 1;
    const dirX = corner.endsWith('w') ? -1 : 1; const dirY = corner.startsWith('n') ? -1 : 1;
    let width = startWidth;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing-image');
    const move = (e) => {
      const dx = dirX * (e.clientX - startX); const dy = dirY * (e.clientY - startY) * ratio;
      const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      width = Math.round(Math.max(MIN_WIDTH, Math.min(max, startWidth + factor * delta)));
      img.style.width = `${width}px`; img.style.height = 'auto';
      this.sizeLabel.textContent = `${width} px`;
      this.place();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('is-resizing-image');
      if (Math.abs(width - startWidth) >= 1) this.update(entry.start, { width });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  startMove(event, entry) {
    if (this.cancelMove) this.cancelMove();
    const startX = event.clientX; const startY = event.clientY;
    const img = entry.img;
    let moving = false; let target = null; let pointer = null; let frame = 0; let finished = false;
    const scroller = this.view.scroller;
    // Holding the picture near the top or bottom edge scrolls the note.
    const scroll = () => {
      frame = 0;
      if (!moving || !pointer) return;
      const box = scroller.getBoundingClientRect();
      const step = pointer.y < box.top + 48 ? -Math.ceil((box.top + 48 - pointer.y) / 4) : pointer.y > box.bottom - 48 ? Math.ceil((pointer.y - box.bottom + 48) / 4) : 0;
      if (!step) return;
      scroller.scrollTop += step;
      target = this.dropTarget(pointer.x, pointer.y, entry);
      this.showCaret(target);
      frame = requestAnimationFrame(scroll);
    };
    const move = (e) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!moving) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
        moving = true;
        this.beginGhost(img);
      }
      this.moveGhost(e.clientX, e.clientY);
      target = this.dropTarget(e.clientX, e.clientY, entry);
      this.showCaret(target);
      if (!frame) frame = requestAnimationFrame(scroll);
    };
    const finish = (apply) => {
      if (finished) return;
      finished = true;
      this.cancelMove = null;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      if (frame) cancelAnimationFrame(frame);
      if (!moving) return;
      const from = this.ghost ? this.ghost.getBoundingClientRect() : null;
      const dropped = apply && target;
      // Let go elsewhere: the picture glides back from the pointer.
      this.endGhost(img);
      this.hideCaret();
      if (dropped) this.moveTo(entry.start, target, from);
      else if (from) this.land(entry.start, from);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    this.cancelMove = cancel;
  }

  beginGhost(img) {
    const rect = img.getBoundingClientRect();
    const width = Math.min(180, rect.width || 180);
    this.ghost = h('img.img-ghost', { src: img.currentSrc || img.src, alt: '', style: { width: `${width}px` } });
    document.body.append(this.ghost);
    img.classList.add('is-dragging');
    document.body.classList.add('is-dragging-image');
    if (this.frame) this.frame.hidden = true;
    if (this.toolbar) this.toolbar.hidden = true;
  }
  moveGhost(x, y) { if (this.ghost) { this.ghost.style.left = `${x + 14}px`; this.ghost.style.top = `${y + 14}px`; } }
  endGhost(img) {
    if (this.ghost) this.ghost.remove();
    this.ghost = null;
    img.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging-image');
    if (this.frame) this.frame.hidden = false;
    if (this.toolbar) this.toolbar.hidden = false;
  }

  // ------------------------------------------------------------- dropping
  // Where an image dropped at (x, y) goes: { offset, paragraph, caret }.
  dropTarget(x, y, moving = null) {
    const view = this.view; const live = view.liveEl;
    if (!live) return null;
    const blocks = [...live.querySelectorAll(':scope > .lp-block')].filter((el) => !el.classList.contains('is-editing'));
    if (!blocks.length) {
      const rect = live.getBoundingClientRect();
      return { offset: view.content.length, paragraph: true, caret: { left: rect.left, top: rect.top + 4, width: rect.width } };
    }
    const hit = document.elementFromPoint(x, y);
    let blockEl = hit && hit.closest('.lp-block');
    if (blockEl && (blockEl.parentElement !== live || blockEl.classList.contains('is-editing'))) blockEl = null;
    const middle = (el) => { const rect = el.getBoundingClientRect(); return y < (rect.top + rect.bottom) / 2 ? 'before' : 'after'; };
    if (!blockEl) {
      const last = blocks[blocks.length - 1];
      if (y > last.getBoundingClientRect().bottom) return this.paragraphTarget(last, 'after');
      if (y < blocks[0].getBoundingClientRect().top) return this.paragraphTarget(blocks[0], 'before');
      blockEl = blocks.reduce((best, el) => {
        const rect = el.getBoundingClientRect();
        const distance = Math.min(Math.abs(y - rect.top), Math.abs(y - rect.bottom));
        return !best || distance < best.distance ? { el, distance } : best;
      }, null).el;
      return this.paragraphTarget(blockEl, middle(blockEl));
    }
    const block = view.blocks[Number(blockEl.dataset.index)];
    if (!block) return null;
    if (!INLINE_TYPES.has(block.token.type)) return this.paragraphTarget(blockEl, middle(blockEl));
    // Dropped on the picture being moved: nothing changes.
    if (moving && hit === moving.img) return null;

    const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    if (!range || !blockEl.contains(range.startContainer)) return this.paragraphTarget(blockEl, middle(blockEl));
    const lines = view.lines();
    const source = lines.slice(block.start, block.end + 1).join('\n');
    const refs = findImages(source, view.path);
    // Pictures show no text, so hide their Markdown from the text matching
    // and count how many come before the drop point instead.
    let masked = source;
    for (const ref of refs) masked = masked.slice(0, ref.start) + HIDDEN.repeat(ref.end - ref.start) + masked.slice(ref.end);
    const before = document.createRange();
    before.selectNodeContents(blockEl);
    before.setEnd(range.startContainer, range.startOffset);
    const imagesBefore = [...before.cloneContents().querySelectorAll('img.embed-image')].length;
    let offset = Math.max(mapPrefix(masked, before.toString()), leadOf(source, block.token.type));
    if (imagesBefore && refs[imagesBefore - 1]) offset = Math.max(offset, refs[imagesBefore - 1].end);
    if (refs[imagesBefore] && offset > refs[imagesBefore].start) offset = refs[imagesBefore].start;
    // Never cut a word in two: go to the nearer edge of the word, and move the
    // caret shown on screen by the same amount.
    const snapped = snapToWord(masked, offset);
    if (snapped !== offset && range.startContainer.nodeType === 3) {
      const at = range.startOffset + snapped - offset;
      if (at >= 0 && at <= range.startContainer.length) range.setStart(range.startContainer, at);
    }
    offset = snapped;
    const absolute = offsetOfLine(lines, block.start) + offset;
    if (moving && absolute >= moving.start && absolute <= moving.end) return null;
    return { offset: absolute, paragraph: false, caret: this.caretRect(range, blockEl) };
  }

  paragraphTarget(blockEl, where) {
    const view = this.view; const block = view.blocks[Number(blockEl.dataset.index)];
    if (!block) return null;
    const lines = view.lines();
    const offset = where === 'before' ? offsetOfLine(lines, block.start) : offsetOfLine(lines, block.end) + lines[block.end].length;
    const rect = blockEl.getBoundingClientRect();
    return { offset, paragraph: true, caret: { left: rect.left, top: where === 'before' ? rect.top - 4 : rect.bottom + 3, width: rect.width } };
  }

  caretRect(range, blockEl) {
    const rects = range.getClientRects();
    let rect = rects.length ? rects[0] : range.getBoundingClientRect();
    if (!rect || !rect.height) {
      // A caret next to a picture: use the picture's edge.
      const node = range.startContainer.nodeType === 1 ? (range.startContainer.childNodes[range.startOffset] || range.startContainer.childNodes[range.startOffset - 1]) : null;
      rect = node && node.nodeType === 1 ? node.getBoundingClientRect() : blockEl.getBoundingClientRect();
      const atEnd = node && node === range.startContainer.childNodes[range.startOffset - 1];
      return { left: atEnd ? rect.right : rect.left, top: rect.top, height: Math.min(rect.height, 28) || 20 };
    }
    return { left: rect.left, top: rect.top, height: Math.max(rect.height, 16) };
  }

  showCaret(target) {
    if (!target) { this.hideCaret(); return; }
    if (!this.caret) { this.caret = h('div.img-drop-caret', { 'aria-hidden': 'true' }); document.body.append(this.caret); }
    const { caret } = target;
    this.caret.classList.toggle('is-line', !!target.paragraph);
    Object.assign(this.caret.style, target.paragraph
      ? { left: `${caret.left}px`, top: `${caret.top}px`, width: `${caret.width}px`, height: '' }
      : { left: `${caret.left - 1}px`, top: `${caret.top}px`, height: `${caret.height}px`, width: '' });
  }
  hideCaret() { if (this.caret) { this.caret.remove(); this.caret = null; } }

  moveTo(start, target, from = null) {
    const entry = this.entryAt(start);
    if (!entry || !target) return;
    const result = Markdown.moveSpan(this.view.content, entry.start, entry.end, target.offset, target.paragraph);
    if (result.text === this.view.content) { this.select(entry); this.land(entry.start, from); return; }
    this.view.setContent(result.text, { step: true });
    this.rerender(result.at);
    this.land(result.at, from);
  }

  // Embeds for freshly uploaded files, put where the user dropped them.
  insertEmbeds(embeds, target) {
    if (!embeds.length) return;
    const view = this.view;
    if (view.active) view.commitActive();
    const spot = target || { offset: view.content.length, paragraph: true };
    const result = Markdown.insertAt(view.content, Math.min(spot.offset, view.content.length), embeds.join(spot.paragraph ? '\n\n' : ' '), spot.paragraph);
    view.setContent(result.text, { step: true });
    this.rerender(result.at);
    const entry = this.entryAt(result.at);
    if (entry) entry.img.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  }

  async insertFiles(files, target) {
    const images = [...files].filter(isImageFile);
    if (!images.length) { toast('Choisissez une image (PNG, JPEG, WebP, SVG…).', { kind: 'error' }); return; }
    try {
      const embeds = [];
      const paths = [];
      for (const file of images) {
        const path = await uploadFile(file, this.view.path);
        paths.push(path);
        embeds.push(await embedFor(path, file));
      }
      await Promise.all(paths.map((path) => app.workspace.waitFor(path)));
      this.insertEmbeds(embeds, target);
    } catch (error) { reportError(error); }
  }

  // ------------------------------------------------------------ keyboard
  onKey(event) {
    if (!this.selected || event.target.closest('textarea, input')) return false;
    const start = this.selected.start;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.remove(start); return true; }
    if (event.key === 'Escape') { event.preventDefault(); this.clear(); return true; }
    if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); this.replaceFile(start); return true; }
    return false;
  }

  // ---------------------------------------------------------------- menu
  contextMenu(event) {
    const img = event.target.closest('img.embed-image');
    if (!img || !this.isManaged(img)) return false;
    const entry = this.entryFor(img);
    if (!entry) return false;
    event.preventDefault();
    if (this.view.active) this.view.commitActive();
    const current = this.entryAt(entry.start);
    if (!current) return true;
    this.select(current);
    const start = current.start; const options = optionsOf(current.raw); const path = img.dataset.path;
    showMenu(event.clientX, event.clientY, [
      { label: 'Aligné sur le texte', checked: !options.align, icon: 'img-inline', run: () => this.update(start, { align: '' }) },
      { label: 'À gauche, texte autour', checked: options.align === 'left', icon: 'img-left', run: () => this.update(start, { align: 'left' }) },
      { label: 'Centrée', checked: options.align === 'center', icon: 'img-center', run: () => this.update(start, { align: 'center' }) },
      { label: 'À droite, texte autour', checked: options.align === 'right', icon: 'img-right', run: () => this.update(start, { align: 'right' }) },
      'separator',
      { label: 'Petite (¼ de la largeur)', run: () => this.setFraction(start, 0.25) },
      { label: 'Moyenne (½ de la largeur)', run: () => this.setFraction(start, 0.5) },
      { label: 'Grande (toute la largeur)', run: () => this.setFraction(start, 1) },
      { label: 'Taille d’origine', checked: !options.width, run: () => this.update(start, { width: null }) },
      'separator',
      { label: 'Remplacer l’image…', icon: 'image', run: () => this.replaceFile(start), hint: 'Enter' },
      path ? { label: 'Ouvrir l’image dans un onglet', icon: 'image', run: () => app.workspace.openPath(path, { newTab: true }) } : null,
      path ? { label: 'Afficher dans l’explorateur de fichiers', icon: 'locate', run: () => app.explorer.reveal(path) } : null,
      'separator',
      { label: 'Retirer de la note', icon: 'trash', danger: true, run: () => this.remove(start), hint: 'Backspace' },
    ]);
    return true;
  }
}
