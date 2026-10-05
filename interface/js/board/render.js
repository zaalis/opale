// Opale — how each kind of moodboard element is drawn. Every element is a
// positioned <div> in the board's world layer; its content is rebuilt only
// when what it shows changed (a cache key per node), while moving it only
// touches its position.
import { fileUrl, h, icon, Markdown, Meta } from '../core.js';
import { store } from '../store.js';
import { decorate } from '../renderer.js';
import { SHAPES } from './shapes.js';
import { iconSvg, stickerSvg } from './stickers.js';
import { WIDGETS } from './widgets.js';

const Board = window.OpaleBoard;
export const esc = (value) => Markdown.escapeHtml(String(value == null ? '' : value));

// Inline Markdown, line by line (bold, italics, links, tags…).
export function inline(view, text) {
  const ctx = store.renderContext(view.path);
  return String(text || '').split('\n').map((line) => Markdown.renderInline(line, ctx) || '&#8203;').join('<br>');
}

const FONTS = { sans: 'var(--font-text)', serif: 'Georgia, "Times New Roman", serif', mono: 'var(--font-mono)', hand: '"Segoe Print", "Comic Sans MS", cursive' };

export function shapeOf(id) { return SHAPES[id] || SHAPES.rect; }

// ----------------------------------------------------------------- nodes
export function createNode(el) {
  const node = h(`div.b-el.k-${el.kind}`, { dataset: { id: el.id } });
  node.body = h('div.b-body');
  node.append(node.body);
  return node;
}

export function place(view, el, node) {
  if (el.kind === 'connector') return placeConnector(view, el, node);
  const s = node.style;
  s.transform = `translate(${el.x}px, ${el.y}px)${el.rotation ? ` rotate(${el.rotation}deg)` : ''}`;
  s.width = `${el.w}px`; s.height = `${el.h}px`;
  const layer = view.layer(el.layer);
  node.classList.toggle('is-hidden', !!layer && !layer.visible);
  node.classList.toggle('is-layer-locked', !!layer && layer.locked);
  node.classList.toggle('is-locked', el.locked);
}

// Draw `el` into `node` (content only when it changed).
export function render(view, el, node) {
  place(view, el, node);
  if (el.kind === 'connector') return;
  const key = JSON.stringify([el.data, el.style, Math.round(el.w), Math.round(el.h), el.reactions || null, view.contentKey(el)]);
  if (node.renderKey === key) return;
  node.renderKey = key;
  const draw = DRAW[el.kind] || WIDGETS[el.kind] && WIDGETS[el.kind].render || DRAW.mdcard;
  draw(view, el, node.body, node);
  node.classList.toggle('has-reactions', !!(el.reactions && Object.keys(el.reactions).length));
  drawReactions(el, node);
}

function drawReactions(el, node) {
  let bar = node.querySelector(':scope > .b-reactions');
  const entries = Object.entries(el.reactions || {}).filter(([, n]) => n > 0);
  if (!entries.length) { if (bar) bar.remove(); return; }
  if (!bar) { bar = h('div.b-reactions'); node.append(bar); }
  bar.innerHTML = entries.map(([emoji, n]) => `<button type="button" class="b-reaction" data-action="react:${esc(emoji)}">${esc(emoji)}<span>${n}</span></button>`).join('');
}

// ------------------------------------------------------------- the kinds
const DRAW = {
  text(view, el, body) {
    const s = el.style;
    body.className = 'b-body b-text';
    Object.assign(body.style, { color: s.color || '', fontSize: `${s.fontSize || 22}px`, textAlign: s.align || 'left', fontWeight: s.bold ? '700' : '', fontStyle: s.italic ? 'italic' : '', fontFamily: FONTS[s.font] || '' });
    body.innerHTML = `<div class="b-text-inner" data-edit="text">${el.data.text ? inline(view, el.data.text) : '<span class="b-placeholder">Texte</span>'}</div>`;
  },

  sticky(view, el, body, node) {
    const s = el.style;
    body.className = 'b-body b-sticky';
    body.style.background = s.fill || Board.STICKY_COLORS[0];
    body.style.color = s.color || '#1f1d16';
    body.style.textAlign = s.align || 'center';
    body.innerHTML = `<div class="b-sticky-text" data-edit="text">${el.data.text ? inline(view, el.data.text) : ''}</div>`;
    fitText(body.firstChild, s.fontSize, el);
    node.classList.toggle('is-private', !!view.doc.settings.privateMode && !!el.data.text);
  },

  mdcard(view, el, body) {
    body.className = 'b-body b-mdcard';
    body.style.background = el.style.fill ? `color-mix(in srgb, ${el.style.fill} 14%, var(--bg-1))` : '';
    body.style.borderColor = el.style.fill || el.style.stroke || '';
    body.innerHTML = `<div class="b-mdcard-inner markdown" data-edit="text">${Markdown.render(el.data.text || '', store.renderContext(view.path)) || '<p class="b-placeholder">Double-cliquez pour écrire</p>'}</div>`;
    decorate(body);
  },

  shape(view, el, body) {
    const s = el.style;
    const shape = shapeOf(el.data.shape);
    body.className = 'b-body b-shape';
    const box = shape.text ? shape.text(el.w, el.h) : { x: 0, y: 0, w: el.w, h: el.h };
    const style = { fill: s.fill || 'transparent', stroke: s.stroke || 'transparent', strokeWidth: s.strokeWidth ?? 2, dash: s.dash || 'solid', opacity: s.opacity ?? 1 };
    body.innerHTML = `<svg class="b-shape-svg" width="${el.w}" height="${el.h}" viewBox="0 0 ${el.w} ${el.h}">${shape.render(el.w, el.h, style)}</svg>`
      + `<div class="b-shape-text v-${s.valign || 'middle'}" data-edit="text" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;color:${esc(s.color || '#111827')};font-size:${s.fontSize || 18}px;text-align:${s.align || 'center'};font-weight:${s.bold ? 700 : 500}">${el.data.text ? `<div>${inline(view, el.data.text)}</div>` : ''}</div>`;
  },

  stroke(view, el, body) {
    const s = el.style;
    body.className = 'b-body b-stroke';
    const d = Board.strokeOutline(el.data.points, s.width || 4);
    const highlighter = s.tool === 'highlighter';
    body.innerHTML = `<svg width="${el.w}" height="${el.h}" viewBox="0 0 ${el.w} ${el.h}" overflow="visible"><path class="b-hit" d="${d}" fill="${esc(s.color || '#1f2937')}" opacity="${highlighter ? 0.38 : s.opacity ?? 1}"${highlighter ? ' style="mix-blend-mode:multiply"' : ''}/></svg>`;
  },

  image(view, el, body) {
    body.className = 'b-body b-image';
    const file = el.data.file;
    body.style.borderRadius = `${el.style.radius ?? 6}px`;
    if (!file || !store.has(file)) {
      body.innerHTML = `<div class="b-missing">${icon('image', 28)}<span>${esc(Meta.baseName(file || 'Image'))}</span><button type="button" class="broken-dot" data-action="repair" title="Image introuvable — cliquer pour réparer"></button></div>`;
      return;
    }
    body.innerHTML = '';
    const img = h('img', { src: fileUrl(file), alt: el.data.alt || Meta.baseName(file), draggable: false, decoding: 'async' });
    img.style.opacity = el.style.opacity ?? 1;
    img.addEventListener('error', () => { body.innerHTML = `<div class="b-missing">${icon('image', 28)}<span>Image illisible</span><button type="button" class="broken-dot" data-action="repair" title="Image illisible — cliquer pour en choisir une autre"></button></div>`; }, { once: true });
    body.append(img);
  },

  note(view, el, body) {
    body.className = 'b-body b-note';
    const file = el.data.file;
    if (!file || !store.has(file)) {
      body.innerHTML = `<div class="b-missing">${icon('file', 28)}<span>${esc(Meta.stem(file || 'Note'))}</span><button type="button" class="broken-dot" data-action="repair" title="Note introuvable — cliquer pour réparer"></button></div>`;
      return;
    }
    body.innerHTML = `<div class="b-note-head"><span class="b-note-icon">${icon('file', 14)}</span><span class="b-note-title">${esc(Meta.stem(file))}</span><button type="button" class="b-mini" data-action="open" title="Ouvrir la note">${icon('external', 13)}</button></div><div class="b-note-content markdown"><p class="b-placeholder">Chargement…</p></div>`;
    const content = body.querySelector('.b-note-content');
    store.text(file).then((text) => {
      if (!content.isConnected) return;
      content.innerHTML = Markdown.render(text, store.renderContext(file, { embedDepth: 1 })) || '<p class="b-placeholder">Note vide — double-cliquez pour écrire.</p>';
      decorate(content);
    }).catch(() => { content.innerHTML = '<p class="b-placeholder">Impossible de lire la note.</p>'; });
  },

  file(view, el, body) {
    body.className = 'b-body b-file';
    const file = el.data.file;
    const ok = file && store.has(file);
    const entry = ok ? store.files.get(file) : null;
    const size = entry && entry.size ? (entry.size > 1048576 ? `${(entry.size / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(entry.size / 1024))} Ko`) : '';
    body.innerHTML = `<span class="b-file-icon">${icon(Meta.kindOf(file || '') === 'pdf' ? 'book' : 'file', 22)}</span><span class="b-file-text"><span class="b-file-name">${esc(Meta.baseName(file || 'Fichier'))}</span><span class="b-file-meta">${ok ? `${esc((Meta.extOf(file) || 'fichier').toUpperCase())}${size ? ` · ${size}` : ''}` : 'Fichier introuvable'}</span></span>${ok ? `<button type="button" class="b-mini" data-action="open" title="Ouvrir">${icon('external', 13)}</button>` : '<button type="button" class="broken-dot" data-action="repair" title="Fichier introuvable — cliquer pour réparer"></button>'}`;
  },

  link(view, el, body) {
    body.className = 'b-body b-link';
    let host = '';
    try { host = new URL(el.data.url).hostname.replace(/^www\./, ''); } catch {}
    body.innerHTML = `<span class="b-link-icon">${icon('external', 18)}</span><span class="b-file-text"><span class="b-file-name" data-edit="title">${esc(el.data.title || host || 'Lien')}</span><span class="b-file-meta">${esc(el.data.url || 'Aucune adresse')}</span></span><button type="button" class="b-mini" data-action="open" title="Ouvrir dans le navigateur">${icon('external', 13)}</button>`;
  },

  embed(view, el, body) { drawFrameUrl(view, el, body, embedUrl(el.data.url)); },

  video(view, el, body) {
    body.className = 'b-body b-video';
    if (el.data.file) {
      if (!store.has(el.data.file)) { body.innerHTML = `<div class="b-missing">${icon('image', 28)}<span>${esc(Meta.baseName(el.data.file))}</span><button type="button" class="broken-dot" data-action="repair" title="Vidéo introuvable — cliquer pour réparer"></button></div>`; return; }
      body.innerHTML = `<video src="${esc(fileUrl(el.data.file))}" controls preload="metadata"></video>`;
      return;
    }
    const url = embedUrl(el.data.url);
    if (/\.(mp4|webm|ogv|mov)(\?|#|$)/i.test(el.data.url || '')) { body.innerHTML = `<video src="${esc(el.data.url)}" controls preload="metadata"></video>`; return; }
    drawFrameUrl(view, el, body, url);
  },

  frame(view, el, body, node) {
    body.className = 'b-body b-frame';
    body.style.background = el.style.fill || '';
    body.style.borderColor = el.style.stroke || '';
    let title = node.querySelector(':scope > .b-frame-title');
    if (!title) { title = h('div.b-frame-title'); node.prepend(title); }
    title.innerHTML = `<span data-edit="title">${esc(el.data.title || 'Cadre')}</span>`;
  },

  grid(view, el, body, node) {
    DRAW.frame(view, el, body, node);
    body.classList.add('b-grid');
    const { rows, cols } = el.data;
    const lines = [];
    for (let c = 1; c < cols; c++) lines.push(`<line x1="${(el.w * c) / cols}" y1="0" x2="${(el.w * c) / cols}" y2="${el.h}"/>`);
    for (let r = 1; r < rows; r++) lines.push(`<line x1="0" y1="${(el.h * r) / rows}" x2="${el.w}" y2="${(el.h * r) / rows}"/>`);
    body.innerHTML = `<svg width="${el.w}" height="${el.h}" class="b-grid-lines">${lines.join('')}</svg>`;
  },

  code(view, el, body) {
    body.className = 'b-body b-code';
    body.innerHTML = `<div class="b-code-head"><span class="b-code-lang" data-edit="lang">${esc(el.data.lang || 'texte')}</span><button type="button" class="b-mini" data-action="copy" title="Copier le code">${icon('copy', 13)}</button></div><pre class="b-code-body" data-edit="code" data-mono="1"><code>${Markdown.highlight(el.data.code || '', el.data.lang) || '<span class="b-placeholder">// Double-cliquez pour écrire du code</span>'}</code></pre>`;
  },

  emoji(view, el, body) {
    body.className = 'b-body b-emoji';
    body.style.fontSize = `${Math.min(el.w, el.h) * 0.8}px`;
    body.textContent = el.data.char || '🙂';
  },

  sticker(view, el, body) {
    body.className = 'b-body b-sticker';
    body.innerHTML = stickerSvg(el.data.sticker) || stickerSvg('star') || '';
  },

  icon(view, el, body) {
    body.className = 'b-body b-icon';
    body.innerHTML = iconSvg(el.data.icon, Math.min(el.w, el.h), el.style.color || 'currentColor');
  },

  ui(view, el, body) {
    DRAW.shape(view, { ...el, data: { ...el.data, shape: `ui-${el.data.ui}` } }, body);
  },
};

// Sticky notes: the text takes the largest size that fits (unless one is set).
function fitText(inner, fixed, el) {
  if (!inner) return;
  if (fixed) { inner.style.fontSize = `${fixed}px`; return; }
  const box = { w: el.w - 24, h: el.h - 24 };
  let low = 9; let high = Math.max(12, Math.min(32, el.h / 3));
  inner.style.width = `${box.w}px`;
  for (let i = 0; i < 9; i++) {
    const mid = (low + high) / 2;
    inner.style.fontSize = `${mid}px`;
    if (inner.scrollHeight <= box.h + 1 && inner.scrollWidth <= box.w + 1) low = mid; else high = mid;
  }
  inner.style.fontSize = `${Math.floor(low)}px`;
}

// A web address shown inside the board: YouTube and Vimeo become players.
export function embedUrl(url) {
  const value = String(url || '').trim();
  let match = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/.exec(value);
  if (match) return `https://www.youtube-nocookie.com/embed/${match[1]}`;
  match = /vimeo\.com\/(?:video\/)?(\d+)/.exec(value);
  if (match) return `https://player.vimeo.com/video/${match[1]}`;
  return /^https:\/\//i.test(value) ? value : '';
}

function drawFrameUrl(view, el, body, url) {
  body.className = 'b-body b-embed';
  if (!url) { body.innerHTML = `<div class="b-missing">${icon('external', 26)}<span>Adresse https:// requise</span></div>`; return; }
  const live = view.interacting === el.id;
  body.innerHTML = `<iframe src="${esc(url)}" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation" allow="fullscreen; picture-in-picture; encrypted-media" referrerpolicy="no-referrer" loading="lazy"></iframe>${live ? '' : '<div class="b-embed-shield" title="Double-cliquez pour interagir"></div>'}`;
}

// ------------------------------------------------------------- connectors
const CAP = 12;
function capPath(kind, point, angle, width) {
  const size = CAP + width * 1.5;
  const cos = Math.cos(angle); const sin = Math.sin(angle);
  const at = (dx, dy) => `${(point.x + dx * cos - dy * sin).toFixed(2)} ${(point.y + dx * sin + dy * cos).toFixed(2)}`;
  if (kind === 'arrow') return `<path d="M ${at(-size, -size * 0.5)} L ${at(0, 0)} L ${at(-size, size * 0.5)}" fill="none"/>`;
  if (kind === 'triangle') return `<path d="M ${at(-size, -size * 0.5)} L ${at(0, 0)} L ${at(-size, size * 0.5)} Z" class="b-cap-fill"/>`;
  if (kind === 'circle') return `<circle cx="${at(-size * 0.35, 0).split(' ')[0]}" cy="${at(-size * 0.35, 0).split(' ')[1]}" r="${size * 0.35}" class="b-cap-fill"/>`;
  if (kind === 'diamond') return `<path d="M ${at(0, 0)} L ${at(-size * 0.5, -size * 0.35)} L ${at(-size, 0)} L ${at(-size * 0.5, size * 0.35)} Z" class="b-cap-fill"/>`;
  if (kind === 'bar') return `<path d="M ${at(0, -size * 0.5)} L ${at(0, size * 0.5)}"/>`;
  if (kind === 'cross') return `<path d="M ${at(-size * 0.7, -size * 0.35)} L ${at(0, size * 0.35)} M ${at(-size * 0.7, size * 0.35)} L ${at(0, -size * 0.35)}"/>`;
  return '';
}

export function placeConnector(view, el, node) {
  const geo = Board.connectorPath(el, view.lookup);
  const pad = 40 + (el.style.width || 2) * 3;
  const xs = geo.points.map((p) => p.x); const ys = geo.points.map((p) => p.y);
  const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  node.style.transform = `translate(${box.x}px, ${box.y}px)`;
  node.style.width = `${box.w}px`; node.style.height = `${box.h}px`;
  const layer = view.layer(el.layer);
  node.classList.toggle('is-hidden', !!layer && !layer.visible);
  node.classList.toggle('is-layer-locked', !!layer && layer.locked);
  node.classList.toggle('is-locked', el.locked);
  node.geo = geo;
  const s = el.style;
  const dash = s.dash === 'dashed' ? `${(s.width || 2) * 4} ${(s.width || 2) * 3}` : s.dash === 'dotted' ? `${(s.width || 2) * 0.1} ${(s.width || 2) * 2.4}` : '';
  const dependency = el.data.relation === 'dependency';
  const colour = esc(s.color || (dependency ? '#ef4444' : '#64748b'));
  const key = JSON.stringify([geo.d, s, el.data, box.x, box.y]);
  if (node.renderKey === key) return;
  node.renderKey = key;
  node.body.className = 'b-body b-connector';
  node.body.innerHTML = `<svg width="${box.w}" height="${box.h}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" overflow="visible">`
    + `<path class="b-hit b-connector-hit" d="${geo.d}"/>`
    + `<g class="b-connector-line" stroke="${colour}" fill="none" stroke-width="${s.width || 2}" stroke-linecap="round" stroke-linejoin="round" style="--cap:${colour}">`
    + `<path d="${geo.d}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
    + `${capPath(s.start, geo.a, geo.startAngle, s.width || 2)}${capPath(s.end, geo.b, geo.endAngle, s.width || 2)}</g></svg>`
    + (el.data.label || dependency ? `<div class="b-connector-label" data-edit="label" style="left:${geo.mid.x - box.x}px;top:${geo.mid.y - box.y}px">${esc(el.data.label || 'bloque')}</div>` : '');
}
