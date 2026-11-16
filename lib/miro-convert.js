'use strict';

// Miro REST objects -> the same JSON Canvas model the editor uses.
const crypto = require('crypto');
const Board = require('../shared/board.js');
const { VaultError } = require('./vault.js');

const COLORS = { light_yellow: '#fff9b1', yellow: '#f5d128', orange: '#ff9d48', light_pink: '#ffcee0', pink: '#ea94bb', red: '#f24726', light_green: '#d5f692', green: '#93d275', dark_green: '#67c6c0', light_blue: '#a6ccf5', blue: '#6eabf3', cyan: '#c6e5ff', violet: '#b384bb', white: '#ffffff', gray: '#d0d0d0', black: '#1a1a1a' };
const SHAPES = { rectangle: 'rect', round_rectangle: 'roundrect', circle: 'ellipse', triangle: 'triangle', rhombus: 'diamond', parallelogram: 'parallelogram', trapezoid: 'trapezoid', pentagon: 'pentagon', hexagon: 'hexagon', octagon: 'octagon', star: 'star', cloud: 'cloud', cross: 'cross', can: 'cylinder', flow_chart_predefined_process: 'subroutine', right_arrow: 'arrow-right', left_arrow: 'arrow-left', left_right_arrow: 'arrow-left-right' };
const idOf = (id) => crypto.createHash('sha256').update(`miro:${id}`).digest('hex').slice(0, 16);
const colour = (value, fallback = '') => Board.color(value, COLORS[value] || fallback);
const numeric = (v) => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v));
const safeUrl = (value) => { try { const u = new URL(String(value)); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } };

function decode(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };
  return String(value).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, key) => {
    if (key[0] !== '#') return entities[key.toLowerCase()] ?? all;
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}

// Deliberately produces text/Markdown, never embeds third-party HTML.
function richText(value) {
  let text = String(value || '').slice(0, 1000000)
    .replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, label) => {
      const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const url = safeUrl(decode(match ? match[1] ?? match[2] ?? match[3] : ''));
      const plain = decode(label.replace(/<[^>]*>/g, '')).replace(/[\[\]\\]/g, '\\$&');
      return url ? `[${plain}](${url.replace(/[()\s]/g, (c) => c === '(' ? '%28' : c === ')' ? '%29' : encodeURIComponent(c))})` : plain;
    })
    .replace(/<(?:strong|b)\b[^>]*>/gi, '**').replace(/<\/(?:strong|b)>/gi, '**')
    .replace(/<(?:em|i)\b[^>]*>/gi, '*').replace(/<\/(?:em|i)>/gi, '*')
    .replace(/<(?:s|del|strike)\b[^>]*>/gi, '~~').replace(/<\/(?:s|del|strike)>/gi, '~~')
    .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(?:p|div|h[1-6]|ul|ol|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  // Encoded HTML remains literal text, escaped for the Markdown renderer.
  text = decode(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function convertBoard(board, sourceItems, sourceConnectors = [], assets = new Map()) {
  if (!board || typeof board.id !== 'string' || !Array.isArray(sourceItems) || !Array.isArray(sourceConnectors)) throw new VaultError('Miro a renvoyé un tableau incomplet. L’import a été annulé.', 502, 'miro-data');
  const warnings = []; const doc = Board.emptyDoc(); const raw = new Map(); const boxes = new Map(); const active = new Set();
  const warn = (item, message) => warnings.push({ id: String(item.id || ''), type: String(item.type || 'inconnu'), message });
  for (const item of [...sourceItems, ...sourceConnectors]) {
    if (!item || typeof item.id !== 'string' || !item.id) throw new VaultError('Un élément Miro n’a pas d’identifiant valide. Aucun moodboard n’a été créé.', 502, 'miro-data');
    if (raw.has(item.id)) {
      if (JSON.stringify(raw.get(item.id)) !== JSON.stringify(item)) throw new VaultError('Le tableau Miro a changé pendant la pagination. Réessayez l’import.', 409, 'miro-changed');
      continue;
    }
    raw.set(item.id, item);
  }
  const boxOf = (item, depth = 0) => {
    if (boxes.has(item.id)) return boxes.get(item.id);
    if (active.has(item.id) || depth > 40) throw new VaultError('La hiérarchie des cadres Miro est incohérente. L’import a été annulé.', 502, 'miro-data');
    active.add(item.id);
    const geometry = item.geometry || {}; const pos = item.position || {};
    const dims = (key, fallback) => {
      if (numeric(geometry[key]) && Number(geometry[key]) > 0 && Number(geometry[key]) <= 100000) return Number(geometry[key]);
      warn(item, `${key === 'width' ? 'Largeur' : 'Hauteur'} absente ou invalide : taille standard utilisée.`); return fallback;
    };
    const w = dims('width', item.type === 'frame' ? 800 : 260); const h = dims('height', item.type === 'frame' ? 520 : 180);
    let cx = numeric(pos.x) ? Number(pos.x) : 0; let cy = numeric(pos.y) ? Number(pos.y) : 0;
    if (!numeric(pos.x) || !numeric(pos.y)) warn(item, 'Position absente : élément placé à l’origine du tableau.');
    if (Math.abs(cx) > 1e8 || Math.abs(cy) > 1e8) throw new VaultError('Un élément Miro possède une position trop grande pour être affichée.', 502, 'miro-data');
    if (pos.relativeTo === 'parent_top_left') {
      const parent = raw.get(item.parent && item.parent.id);
      if (!parent) throw new VaultError('Un élément Miro référence un cadre parent absent. Aucun fichier n’a été créé.', 502, 'miro-parent');
      const p = boxOf(parent, depth + 1); cx += p.x; cy += p.y;
    } else if (pos.relativeTo && pos.relativeTo !== 'canvas_center') warn(item, 'Référence de position inconnue : coordonnées du tableau utilisées.');
    const box = { x: cx - w / 2, y: cy - h / 2, w, h, rotation: numeric(geometry.rotation) ? Number(geometry.rotation) : 0 };
    active.delete(item.id); boxes.set(item.id, box); return box;
  };
  const boardUrl = safeUrl(board.viewLink) || `https://miro.com/app/board/${encodeURIComponent(board.id)}/`;
  const fallback = (item, box, reason) => {
    warn(item, reason);
    const data = item.data || {};
    const link = new URL(boardUrl); link.searchParams.set('moveToWidget', item.id);
    return Board.create('mdcard', { id: idOf(item.id), ...box, data: { text: [richText(data.title || data.content || item.type), richText(data.description), `[Ouvrir l’élément dans Miro](${link.href})`].filter(Boolean).join('\n\n') } });
  };
  const items = [...raw.values()].filter((i) => i.type !== 'connector');
  for (const item of items) {
    const box = boxOf(item); const data = item.data || {}; const s = item.style || {}; const text = richText(data.content);
    const props = { id: idOf(item.id), ...box, group: item.parent && raw.has(item.parent.id) ? idOf(item.parent.id) : '' };
    const textStyle = { color: colour(s.color, '#1a1a1a'), fontSize: numeric(s.fontSize) ? Math.min(288, Math.max(8, Number(s.fontSize))) : 18, align: ['left', 'center', 'right'].includes(s.textAlign) ? s.textAlign : 'center' };
    let el;
    switch (item.type) {
      case 'sticky_note': el = Board.create('sticky', { ...props, data: { text }, style: { ...textStyle, fill: colour(s.fillColor, '#fff9b1') } }); break;
      case 'text': el = Board.create('text', { ...props, data: { text }, style: { ...textStyle, align: ['left', 'center', 'right'].includes(s.textAlign) ? s.textAlign : 'left' } }); break;
      case 'shape': {
        const shape = SHAPES[data.shape] || 'rect';
        if (!SHAPES[data.shape]) warn(item, `Forme « ${data.shape || 'inconnue'} » remplacée par un rectangle; source conservée.`);
        el = Board.create('shape', { ...props, data: { text, shape }, style: { ...textStyle, fill: colour(s.fillColor, '#ffffff'), stroke: colour(s.borderColor, '#1a1a1a'), strokeWidth: numeric(s.borderWidth) ? Math.min(64, Math.max(0, Number(s.borderWidth))) : 1, dash: ['dotted', 'dashed'].includes(s.borderStyle) ? s.borderStyle : 'solid', opacity: numeric(s.fillOpacity) ? Math.min(1, Math.max(0, Number(s.fillOpacity))) : 1 } }); break;
      }
      case 'frame':
        el = Board.create('frame', { ...props, data: { title: richText(data.title) || 'Cadre Miro' }, style: { fill: colour(s.fillColor), stroke: colour(s.borderColor) } });
        if (data.showContent === false) warn(item, 'Le contenu masqué de ce cadre est visible dans la copie Opale.');
        break;
      case 'card': case 'app_card':
        el = Board.create('card', { ...props, data: { title: richText(data.title || data.content), description: richText(data.description), due: data.dueDate || '', tags: (Array.isArray(data.fields) ? data.fields : []).filter(Boolean).map((f) => richText(f.value || f.title)).filter(Boolean) }, style: { accent: colour(s.cardTheme || s.fillColor, '#6366f1') } });
        warn(item, 'Carte convertie : champs et comportement propres à Miro conservés dans la source JSON.'); break;
      case 'image':
        if (assets.has(item.id)) el = Board.create('image', { ...props, data: { file: assets.get(item.id), alt: richText(data.altText || data.title) } });
        else el = fallback(item, box, 'Image indisponible : carte de remplacement avec lien Miro.');
        break;
      case 'embed': case 'document': {
        const url = safeUrl(data.url || data.documentUrl);
        el = url ? Board.create('link', { ...props, data: { url, title: richText(data.title) || item.type } }) : fallback(item, box, 'Document ou contenu intégré non téléchargeable : lien Miro conservé.');
        if (url) warn(item, 'Contenu intégré conservé comme lien externe.'); break;
      }
      default: el = fallback(item, box, `Type « ${item.type || 'inconnu'} » non pris en charge par la conversion : carte de remplacement et source conservées.`);
    }
    doc.elements.push(el);
  }
  // Frames stay behind their children. IDs are stable and stay strings (Miro IDs exceed JS integer precision).
  doc.elements.sort((a, b) => Number(b.kind === 'frame') - Number(a.kind === 'frame'));
  const endpoint = (end) => {
    if (!end || !raw.has(end.id) || raw.get(end.id).type === 'connector') return null;
    const out = { id: idOf(end.id) }; const p = end.position;
    if (p && numeric(String(p.x).replace('%', '')) && numeric(String(p.y).replace('%', ''))) {
      const x = Number(String(p.x).replace('%', '')); const y = Number(String(p.y).replace('%', ''));
      out.side = [[x, 'left'], [100 - x, 'right'], [y, 'top'], [100 - y, 'bottom']].sort((a, b) => a[0] - b[0])[0][1];
    }
    return out;
  };
  const cap = (value) => value === 'none' ? 'none' : ['oval', 'filled_oval'].includes(value) ? 'circle' : ['diamond', 'filled_diamond'].includes(value) ? 'diamond' : ['triangle', 'filled_triangle', 'stealth', 'rounded_stealth'].includes(value) ? 'triangle' : 'arrow';
  for (const item of [...raw.values()].filter((i) => i.type === 'connector')) {
    const from = endpoint(item.startItem); const to = endpoint(item.endItem); const s = item.style || {};
    if (!from || !to) { doc.elements.push(fallback(item, { x: 0, y: 0, w: 320, h: 120 }, 'Connecteur libre ou incomplet : carte de remplacement; source conservée.')); continue; }
    doc.elements.push(Board.create('connector', { id: idOf(item.id), from, to, data: { label: (Array.isArray(item.captions) ? item.captions : []).filter(Boolean).map((c) => richText(c.content)).join(' · ') }, style: { color: colour(s.strokeColor, '#64748b'), width: numeric(s.strokeWidth) ? Math.min(24, Math.max(1, Number(s.strokeWidth))) : 2, dash: ['dotted', 'dashed'].includes(s.strokeStyle) ? s.strokeStyle : 'solid', path: item.shape === 'straight' ? 'straight' : item.shape === 'elbowed' ? 'elbow' : 'curve', start: cap(s.startStrokeCap || 'none'), end: cap(s.endStrokeCap || 'stealth') } }));
    if (item.isSupported === false) warn(item, 'Connecteur partiellement exposé par Miro : tracé simplifié.');
  }
  const content = Board.serialize(doc); const check = Board.parse(content);
  if (check.problem || check.doc.elements.length !== doc.elements.length) throw new VaultError('La conversion JSON Canvas n’a pas passé la vérification. Aucun fichier n’a été créé.', 500, 'miro-format');
  return { doc, content, warnings, count: doc.elements.length, boardUrl };
}

module.exports = { convertBoard, richText, safeUrl, idOf };
