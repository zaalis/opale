// Opale — moodboards: the board model, shared by the server and the
// interface. A board is a ".canvas" file in the JSON Canvas format (the open
// format of Obsidian Canvas), so a board opens in both applications. What
// JSON Canvas has no word for (shapes, drawings, kanban, mind maps…) is
// written as a text card whose text is a readable fallback, with the details
// under an "opale" key that other applications ignore.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./meta.js'));
  else root.OpaleBoard = factory(root.OpaleMeta);
})(typeof self !== 'undefined' ? self : this, function (Meta) {
  'use strict';

  const VERSION = 1;
  const SIDES = ['top', 'right', 'bottom', 'left'];
  // The six colours JSON Canvas names by number.
  const PRESETS = { 1: '#fb464c', 2: '#e9973f', 3: '#e0de71', 4: '#44cf6e', 5: '#53dfdd', 6: '#a882ff' };
  const STICKY_COLORS = ['#fff59d', '#ffd59e', '#ffb3c1', '#c5f0a4', '#a8e6ff', '#d4c2ff', '#f5f5f5', '#ffcc80'];

  // ------------------------------------------------------------- utilities
  const finite = (value, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : fallback));
  const str = (value, fallback = '') => (typeof value === 'string' ? value : value === undefined || value === null ? fallback : String(value));
  const bool = (value) => value === true;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const round = (value) => Math.round(value * 100) / 100;
  const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

  let counter = 0;
  function newId() {
    counter = (counter + 1) % 1679616;
    const random = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    return `${Date.now().toString(16)}${counter.toString(36).padStart(4, '0')}${random}`.slice(-16);
  }

  function color(value, fallback = '') {
    const text = str(value).trim();
    if (PRESETS[text]) return PRESETS[text];
    if (/^#[0-9a-f]{3,8}$/i.test(text)) return text.toLowerCase();
    if (/^(rgb|hsl)a?\([\d\s.,%/]+\)$/i.test(text)) return text;
    if (text === 'transparent') return text;
    return fallback;
  }

  // ----------------------------------------------------------------- kinds
  // Default size, style and data of every kind of element. `data` holds what
  // the element says, `style` how it looks.
  const KINDS = {
    text: { w: 260, h: 44, style: { color: '', fontSize: 22, align: 'left', bold: false, italic: false, font: 'sans' }, data: { text: '' } },
    sticky: { w: 200, h: 200, style: { fill: STICKY_COLORS[0], color: '#1f1d16', fontSize: 0, align: 'center' }, data: { text: '' } },
    mdcard: { w: 320, h: 180, style: { fill: '', stroke: '', color: '' }, data: { text: '' } },
    shape: { w: 180, h: 120, style: { fill: '#ffffff', stroke: '#1f2937', strokeWidth: 2, dash: 'solid', color: '#111827', fontSize: 18, align: 'center', valign: 'middle', opacity: 1 }, data: { shape: 'rect', text: '' } },
    connector: { w: 0, h: 0, style: { color: '#64748b', width: 2, dash: 'solid', path: 'curve', start: 'none', end: 'arrow' }, data: { label: '', relation: '' } },
    stroke: { w: 0, h: 0, style: { color: '#1f2937', width: 4, opacity: 1, tool: 'pen' }, data: { points: [] } },
    image: { w: 320, h: 240, style: { radius: 6, opacity: 1 }, data: { file: '', alt: '' } },
    note: { w: 360, h: 280, style: { fill: '' }, data: { file: '', subpath: '' } },
    file: { w: 260, h: 72, style: {}, data: { file: '' } },
    link: { w: 320, h: 96, style: {}, data: { url: '', title: '' } },
    embed: { w: 560, h: 340, style: {}, data: { url: '' } },
    video: { w: 480, h: 270, style: {}, data: { file: '', url: '' } },
    frame: { w: 800, h: 520, style: { fill: '', stroke: '' }, data: { title: 'Cadre' } },
    grid: { w: 720, h: 480, style: { stroke: '' }, data: { title: 'Grille', rows: 3, cols: 3 } },
    code: { w: 460, h: 220, style: {}, data: { code: '', lang: 'js' } },
    table: { w: 480, h: 180, style: {}, data: { rows: [['', '', ''], ['', '', ''], ['', '', '']], header: true } },
    kanban: { w: 900, h: 460, style: {}, data: { title: 'Kanban', columns: [] } },
    mindmap: { w: 420, h: 220, style: { color: '#6366f1' }, data: { root: null } },
    card: { w: 300, h: 170, style: { accent: '#6366f1' }, data: { title: '', description: '', assignee: '', due: '', status: 'todo', points: '', tshirt: '', tags: [] } },
    flipcard: { w: 260, h: 180, style: { fill: '#ffffff' }, data: { front: '', back: '', flipped: false } },
    usercard: { w: 300, h: 200, style: { accent: '#0ea5e9' }, data: { name: '', role: '', image: '', notes: '' } },
    timeline: { w: 960, h: 300, style: {}, data: { title: 'Planning', start: '', unit: 'week', count: 8, lanes: [], items: [] } },
    comment: { w: 36, h: 36, style: {}, data: { thread: [], resolved: false } },
    emoji: { w: 80, h: 80, style: {}, data: { char: '😀' } },
    sticker: { w: 140, h: 140, style: {}, data: { sticker: 'star' } },
    icon: { w: 64, h: 64, style: { color: '#1f2937' }, data: { icon: 'star' } },
    ui: { w: 160, h: 44, style: {}, data: { ui: 'button', text: 'Bouton' } },
    mermaid: { w: 520, h: 360, style: {}, data: { source: 'flowchart TD\n  A[Début] --> B{Choix}\n  B -->|Oui| C[Action]\n  B -->|Non| D[Fin]' } },
    poll: { w: 340, h: 240, style: {}, data: { question: '', options: [] } },
    wheel: { w: 320, h: 360, style: {}, data: { entries: [], result: '' } },
    scale: { w: 520, h: 150, style: {}, data: { left: '', right: '', steps: 5, marks: [] } },
    activity: { w: 420, h: 300, style: {}, data: { type: 'choice', question: '', options: [], answers: [], revealed: false } },
  };
  const KIND_NAMES = Object.keys(KINDS);

  // What each element turns into in the file: [JSON Canvas type, field].
  const NATIVE = { image: 'file', note: 'file', file: 'file', link: 'link', embed: 'link', frame: 'group', grid: 'group' };

  function create(kind, props = {}) {
    const spec = KINDS[kind] || KINDS.mdcard;
    const el = {
      id: props.id || newId(), kind: KINDS[kind] ? kind : 'mdcard',
      x: finite(props.x), y: finite(props.y), w: finite(props.w, spec.w), h: finite(props.h, spec.h),
      rotation: finite(props.rotation), layer: str(props.layer, 'base'), locked: bool(props.locked), group: props.group ? str(props.group) : '',
      style: { ...clone(spec.style), ...(isObject(props.style) ? clone(props.style) : {}) },
      data: { ...clone(spec.data), ...(isObject(props.data) ? clone(props.data) : {}) },
    };
    if (isObject(props.reactions)) el.reactions = clone(props.reactions);
    if (kind === 'connector') {
      el.from = endpoint(props.from); el.to = endpoint(props.to);
    }
    return normalize(el);
  }

  function endpoint(value) {
    const end = isObject(value) ? value : {};
    const out = {};
    if (end.id) out.id = str(end.id);
    if (SIDES.includes(end.side)) out.side = end.side;
    out.x = finite(end.x); out.y = finite(end.y);
    return out;
  }

  // Make an element safe to draw whatever the file said: numbers are finite,
  // sizes positive, texts are strings, lists are lists.
  function normalize(el) {
    el.x = finite(el.x); el.y = finite(el.y);
    el.w = Math.max(el.kind === 'connector' || el.kind === 'stroke' ? 0 : 4, finite(el.w, 4));
    el.h = Math.max(el.kind === 'connector' || el.kind === 'stroke' ? 0 : 4, finite(el.h, 4));
    el.rotation = ((finite(el.rotation) % 360) + 360) % 360;
    const d = el.data;
    switch (el.kind) {
      case 'stroke':
        d.points = (Array.isArray(d.points) ? d.points : []).filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [round(finite(p[0])), round(finite(p[1])), round(clamp(finite(p[2], 0.5), 0, 1))]);
        break;
      case 'table': {
        let rows = Array.isArray(d.rows) ? d.rows.filter(Array.isArray) : [];
        if (!rows.length) rows = [['']];
        const cols = Math.max(1, ...rows.map((row) => row.length));
        d.rows = rows.map((row) => Array.from({ length: cols }, (_, i) => str(row[i])));
        if (Array.isArray(d.widths)) d.widths = d.widths.slice(0, cols).map((w) => clamp(finite(w, 1), 0.05, 20));
        d.header = d.header !== false;
        break;
      }
      case 'kanban':
        d.columns = (Array.isArray(d.columns) ? d.columns : []).filter(isObject).map((column) => ({
          id: str(column.id) || newId(), title: str(column.title), color: color(column.color),
          cards: (Array.isArray(column.cards) ? column.cards : []).filter(isObject).map((card) => ({ id: str(card.id) || newId(), text: str(card.text), color: color(card.color) })),
        }));
        break;
      case 'mindmap': {
        const topic = (node, depth) => {
          if (!isObject(node) || depth > 40) return null;
          return { id: str(node.id) || newId(), text: str(node.text), collapsed: bool(node.collapsed), color: color(node.color), children: (Array.isArray(node.children) ? node.children : []).map((child) => topic(child, depth + 1)).filter(Boolean) };
        };
        d.root = topic(d.root, 0) || { id: newId(), text: 'Idée centrale', collapsed: false, color: '', children: [] };
        break;
      }
      case 'timeline':
        d.unit = ['day', 'week', 'month'].includes(d.unit) ? d.unit : 'week';
        d.count = clamp(Math.round(finite(d.count, 8)), 1, 120);
        d.lanes = (Array.isArray(d.lanes) ? d.lanes : []).filter(isObject).map((lane) => ({ id: str(lane.id) || newId(), title: str(lane.title) }));
        d.items = (Array.isArray(d.items) ? d.items : []).filter(isObject).map((item) => ({ id: str(item.id) || newId(), lane: str(item.lane), start: finite(item.start), length: Math.max(0.25, finite(item.length, 1)), text: str(item.text), color: color(item.color) }));
        break;
      case 'card':
        d.tags = (Array.isArray(d.tags) ? d.tags : []).map(String).slice(0, 20);
        if (!['todo', 'doing', 'done', 'blocked'].includes(d.status)) d.status = 'todo';
        break;
      case 'comment':
        d.thread = (Array.isArray(d.thread) ? d.thread : []).filter(isObject).map((item) => ({ id: str(item.id) || newId(), text: str(item.text), date: str(item.date), author: str(item.author, 'Moi') }));
        d.resolved = bool(d.resolved);
        break;
      case 'poll':
      case 'activity':
        d.options = (Array.isArray(d.options) ? d.options : []).filter(isObject).map((option) => ({ id: str(option.id) || newId(), text: str(option.text), votes: Math.max(0, Math.round(finite(option.votes))), correct: bool(option.correct), x: finite(option.x, 0.5), y: finite(option.y, 0.5) }));
        if (el.kind === 'activity') {
          d.answers = (Array.isArray(d.answers) ? d.answers : []).map(String).slice(0, 500);
          if (!['choice', 'open', 'scale', 'ranking', 'wordcloud', 'matrix', 'quiz'].includes(d.type)) d.type = 'choice';
        }
        break;
      case 'wheel':
        d.entries = (Array.isArray(d.entries) ? d.entries : []).map(String).slice(0, 60);
        break;
      case 'scale':
        d.steps = clamp(Math.round(finite(d.steps, 5)), 2, 11);
        d.marks = (Array.isArray(d.marks) ? d.marks : []).filter(isObject).map((mark) => ({ id: str(mark.id) || newId(), value: clamp(finite(mark.value), 0, 1), label: str(mark.label), color: color(mark.color) }));
        break;
      case 'grid':
        d.rows = clamp(Math.round(finite(d.rows, 3)), 1, 50); d.cols = clamp(Math.round(finite(d.cols, 3)), 1, 50);
        break;
      default:
    }
    for (const key of ['text', 'title', 'label', 'file', 'url', 'code', 'lang', 'source', 'alt', 'question', 'front', 'back', 'name', 'role', 'notes', 'description', 'assignee', 'due', 'char', 'icon', 'sticker', 'shape', 'ui']) {
      if (key in d && typeof d[key] !== 'string') d[key] = str(d[key]);
    }
    return el;
  }

  // ------------------------------------------------------------- documents
  function emptyDoc() {
    return { elements: [], layers: [{ id: 'base', name: 'Calque 1', visible: true, locked: false }], settings: { grid: 'dots', snap: true, privateMode: false }, vote: null };
  }

  // A short readable text for what JSON Canvas cannot show.
  function fallbackText(el) {
    const d = el.data;
    switch (el.kind) {
      case 'shape': case 'sticky': case 'text': case 'mdcard': return d.text || '';
      case 'code': return `\`\`\`${d.lang || ''}\n${d.code}\n\`\`\``;
      case 'table': return d.rows.map((row, i) => `| ${row.map((cell) => cell.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |${i === 0 && d.header ? `\n|${row.map(() => ' --- ').join('|')}|` : ''}`).join('\n');
      case 'kanban': return [`## ${d.title}`, ...d.columns.map((column) => `### ${column.title}\n${column.cards.map((card) => `- ${card.text}`).join('\n')}`)].join('\n\n');
      case 'mindmap': {
        const lines = [];
        const walk = (node, depth) => { lines.push(`${'  '.repeat(depth)}- ${node.text}`); node.children.forEach((child) => walk(child, depth + 1)); };
        if (d.root) walk(d.root, 0);
        return lines.join('\n');
      }
      case 'card': return [`**${d.title}**`, d.description, [d.assignee && `👤 ${d.assignee}`, d.due && `📅 ${d.due}`, d.points && `${d.points} pts`, d.tshirt].filter(Boolean).join(' · ')].filter(Boolean).join('\n\n');
      case 'flipcard': return `${d.front}\n\n---\n\n${d.back}`;
      case 'usercard': return `**${d.name}** — ${d.role}\n\n${d.notes}`;
      case 'timeline': return `## ${d.title}\n${d.items.map((item) => `- ${item.text}`).join('\n')}`;
      case 'comment': return d.thread.map((item) => `> ${item.text}`).join('\n');
      case 'emoji': return d.char;
      case 'mermaid': return `\`\`\`mermaid\n${d.source}\n\`\`\``;
      case 'poll': case 'activity': return [d.question, ...d.options.map((option) => `- ${option.text} (${option.votes})`)].join('\n');
      case 'wheel': return d.entries.map((entry) => `- ${entry}`).join('\n');
      case 'scale': return `${d.left} ⟷ ${d.right}`;
      case 'ui': return d.text;
      case 'video': return d.url || d.file;
      default: return '';
    }
  }

  // Board -> JSON Canvas text.
  function serialize(doc) {
    const nodes = []; const edges = [];
    doc.elements.forEach((el, z) => {
      const opale = { kind: el.kind, z };
      if (el.rotation) opale.rotation = el.rotation;
      if (el.layer && el.layer !== 'base') opale.layer = el.layer;
      if (el.locked) opale.locked = true;
      if (el.group) opale.group = el.group;
      if (el.reactions && Object.keys(el.reactions).length) opale.reactions = el.reactions;
      if (Object.keys(el.style).length) opale.style = el.style;
      const data = { ...el.data };
      if (el.kind === 'connector' && el.from.id && el.to.id) {
        const edge = { id: el.id, fromNode: el.from.id, toNode: el.to.id };
        if (el.from.side) edge.fromSide = el.from.side;
        if (el.to.side) edge.toSide = el.to.side;
        edge.fromEnd = el.style.start && el.style.start !== 'none' ? 'arrow' : 'none';
        edge.toEnd = el.style.end && el.style.end !== 'none' ? 'arrow' : 'none';
        if (el.style.color) edge.color = el.style.color;
        if (data.label) edge.label = data.label;
        opale.data = data;
        edge.opale = opale;
        edges.push(edge);
        return;
      }
      const node = { id: el.id, type: 'text', x: Math.round(el.x), y: Math.round(el.y), width: Math.max(1, Math.round(el.w)), height: Math.max(1, Math.round(el.h)) };
      const type = NATIVE[el.kind];
      if (type === 'file' && data.file) { node.type = 'file'; node.file = data.file; if (data.subpath) node.subpath = data.subpath.startsWith('#') ? data.subpath : `#${data.subpath}`; delete data.file; delete data.subpath; }
      else if (type === 'link' && data.url) { node.type = 'link'; node.url = data.url; delete data.url; }
      else if (type === 'group') { node.type = 'group'; node.label = data.title || ''; delete data.title; }
      else if (el.kind === 'video' && data.file) { node.type = 'file'; node.file = data.file; delete data.file; }
      else if (el.kind === 'video' && data.url) { node.type = 'link'; node.url = data.url; delete data.url; }
      else {
        node.text = fallbackText(el);
        if (['text', 'sticky', 'mdcard', 'shape'].includes(el.kind)) delete data.text;
      }
      const fill = el.kind === 'sticky' || el.kind === 'mdcard' || el.kind === 'frame' ? el.style.fill : '';
      if (fill) node.color = fill;
      if (el.kind === 'connector') opale.ends = { from: el.from, to: el.to };
      if (Object.keys(data).length) opale.data = data;
      node.opale = opale;
      nodes.push(node);
    });
    const out = { nodes, edges, opale: { version: VERSION, layers: doc.layers, settings: doc.settings } };
    if (doc.vote) out.opale.vote = doc.vote;
    return `${JSON.stringify(out, null, '\t')}\n`;
  }

  // JSON Canvas text -> board. Never throws: a damaged file gives an empty
  // board and `problem` says why, so the interface can refuse to overwrite it.
  function parse(text) {
    const doc = emptyDoc();
    const source = str(text).replace(/^﻿/, '').trim();
    if (!source) return { doc, problem: null };
    let json;
    try { json = JSON.parse(source); } catch (error) { return { doc, problem: `Fichier illisible : ${error.message}` }; }
    if (!isObject(json)) return { doc, problem: 'Fichier illisible : ce n’est pas un tableau JSON Canvas.' };
    const meta = isObject(json.opale) ? json.opale : {};
    if (Array.isArray(meta.layers)) {
      const layers = meta.layers.filter(isObject).map((layer) => ({ id: str(layer.id) || newId(), name: str(layer.name, 'Calque'), visible: layer.visible !== false, locked: bool(layer.locked) }));
      if (layers.length) doc.layers = layers;
    }
    if (!doc.layers.some((layer) => layer.id === 'base')) doc.layers.unshift({ id: 'base', name: 'Calque 1', visible: true, locked: false });
    if (isObject(meta.settings)) {
      doc.settings.grid = ['dots', 'lines', 'none'].includes(meta.settings.grid) ? meta.settings.grid : 'dots';
      doc.settings.snap = meta.settings.snap !== false;
      doc.settings.privateMode = bool(meta.settings.privateMode);
    }
    if (isObject(meta.vote)) {
      const votes = {};
      if (isObject(meta.vote.votes)) for (const [id, count] of Object.entries(meta.vote.votes)) { const n = Math.round(finite(count)); if (n > 0) votes[id] = n; }
      doc.vote = { active: bool(meta.vote.active), perPerson: clamp(Math.round(finite(meta.vote.perPerson, 5)), 1, 99), votes };
    }
    const items = [];
    const seen = new Set();
    const unique = (id) => { let value = str(id) || newId(); while (seen.has(value)) value = newId(); seen.add(value); return value; };
    const nodes = Array.isArray(json.nodes) ? json.nodes : [];
    nodes.forEach((node, index) => {
      if (!isObject(node)) return;
      const o = isObject(node.opale) ? node.opale : {};
      let kind = KINDS[o.kind] ? o.kind : null;
      const data = isObject(o.data) ? { ...o.data } : {};
      if (node.type === 'file') {
        const file = str(node.file);
        const fileKind = Meta.kindOf(file);
        if (!kind) kind = fileKind === 'image' ? 'image' : fileKind === 'note' ? 'note' : fileKind === 'video' ? 'video' : 'file';
        data.file = file;
        if (node.subpath) data.subpath = str(node.subpath).replace(/^#/, '');
      } else if (node.type === 'link') {
        if (!kind) kind = 'link';
        data.url = str(node.url);
      } else if (node.type === 'group') {
        if (!kind || (kind !== 'frame' && kind !== 'grid')) kind = 'frame';
        data.title = str(node.label);
      } else {
        if (!kind) kind = 'mdcard';
        if (['text', 'sticky', 'mdcard', 'shape'].includes(kind)) data.text = str(node.text);
      }
      if (kind === 'connector' && !isObject(o.ends)) return;
      const style = isObject(o.style) ? { ...o.style } : {};
      const nodeColor = color(node.color);
      if (nodeColor && (kind === 'sticky' || kind === 'mdcard' || kind === 'frame') && !style.fill) style.fill = nodeColor;
      const el = create(kind, {
        id: unique(node.id), x: node.x, y: node.y, w: node.width, h: node.height, rotation: o.rotation,
        layer: o.layer, locked: o.locked, group: o.group, style, data, reactions: o.reactions,
        from: isObject(o.ends) ? o.ends.from : undefined, to: isObject(o.ends) ? o.ends.to : undefined,
      });
      items.push({ el, z: finite(o.z, index) });
    });
    const edges = Array.isArray(json.edges) ? json.edges : [];
    edges.forEach((edge, index) => {
      if (!isObject(edge) || !edge.fromNode || !edge.toNode) return;
      const o = isObject(edge.opale) ? edge.opale : {};
      const style = isObject(o.style) ? { ...o.style } : {};
      if (!o.style) {
        style.start = edge.fromEnd === 'arrow' ? 'arrow' : 'none';
        style.end = edge.toEnd === 'none' ? 'none' : 'arrow';
      }
      const edgeColor = color(edge.color);
      if (edgeColor) style.color = edgeColor;
      const data = isObject(o.data) ? { ...o.data } : {};
      if (edge.label !== undefined) data.label = str(edge.label);
      const el = create('connector', {
        id: unique(edge.id), style, data, layer: o.layer, locked: o.locked, group: o.group, reactions: o.reactions,
        from: { id: str(edge.fromNode), side: edge.fromSide }, to: { id: str(edge.toNode), side: edge.toSide },
      });
      items.push({ el, z: finite(o.z, nodes.length + index) });
    });
    items.sort((a, b) => a.z - b.z);
    doc.elements = items.map((item) => item.el);
    // A connector whose element is gone keeps its last position instead.
    const ids = new Set(doc.elements.map((el) => el.id));
    for (const el of doc.elements) {
      if (el.kind !== 'connector') continue;
      for (const end of [el.from, el.to]) if (end.id && !ids.has(end.id)) delete end.id;
    }
    for (const el of doc.elements) if (el.layer && !doc.layers.some((layer) => layer.id === el.layer)) el.layer = 'base';
    if (doc.vote) for (const id of Object.keys(doc.vote.votes)) if (!ids.has(id)) delete doc.vote.votes[id];
    return { doc, problem: null };
  }

  // ------------------------------------------------------- vault references
  // Every vault file a board points at (for the index, links and renames).
  function fileRefs(text) {
    let json;
    try { json = JSON.parse(str(text).replace(/^﻿/, '')); } catch { return []; }
    const refs = [];
    const add = (value) => { const file = str(value).trim(); if (file && !/^[a-z][a-z0-9+.-]*:/i.test(file)) refs.push(file); };
    for (const node of Array.isArray(json && json.nodes) ? json.nodes : []) {
      if (!isObject(node)) continue;
      if (node.type === 'file') add(node.file);
      const data = isObject(node.opale) && isObject(node.opale.data) ? node.opale.data : null;
      if (data && data.image) add(data.image);
    }
    return [...new Set(refs)];
  }

  // Point the board at moved files: `map(path) -> new path | null`. Returns
  // the new text, or the same text when nothing changed. Only file fields are
  // touched, every other byte of the JSON stays as it was written.
  function rewriteFileRefs(text, map) {
    let json;
    try { json = JSON.parse(str(text).replace(/^﻿/, '')); } catch { return { text, changed: 0 }; }
    let changed = 0;
    for (const node of Array.isArray(json && json.nodes) ? json.nodes : []) {
      if (!isObject(node)) continue;
      if (node.type === 'file' && typeof node.file === 'string') {
        const next = map(node.file);
        if (next && next !== node.file) { node.file = next; changed++; }
      }
      const data = isObject(node.opale) && isObject(node.opale.data) ? node.opale.data : null;
      if (data && typeof data.image === 'string' && data.image) {
        const next = map(data.image);
        if (next && next !== data.image) { data.image = next; changed++; }
      }
    }
    return changed ? { text: `${JSON.stringify(json, null, '\t')}\n`, changed } : { text, changed: 0 };
  }

  // -------------------------------------------------------------- geometry
  function center(el) { return { x: el.x + el.w / 2, y: el.y + el.h / 2 }; }
  function rotatePoint(point, origin, degrees) {
    if (!degrees) return { x: point.x, y: point.y };
    const a = (degrees * Math.PI) / 180; const cos = Math.cos(a); const sin = Math.sin(a);
    const dx = point.x - origin.x; const dy = point.y - origin.y;
    return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
  }
  // The axis-aligned box around an element, rotation included.
  function bounds(el, lookup) {
    if (el.kind === 'connector') {
      const a = endPoint(el, 'from', lookup); const b = endPoint(el, 'to', lookup);
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
    }
    if (!el.rotation) return { x: el.x, y: el.y, w: el.w, h: el.h };
    const c = center(el);
    const corners = [[el.x, el.y], [el.x + el.w, el.y], [el.x + el.w, el.y + el.h], [el.x, el.y + el.h]].map(([x, y]) => rotatePoint({ x, y }, c, el.rotation));
    const xs = corners.map((p) => p.x); const ys = corners.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  function union(boxes) {
    const list = boxes.filter(Boolean);
    if (!list.length) return null;
    const x = Math.min(...list.map((b) => b.x)); const y = Math.min(...list.map((b) => b.y));
    return { x, y, w: Math.max(...list.map((b) => b.x + b.w)) - x, h: Math.max(...list.map((b) => b.y + b.h)) - y };
  }
  const intersects = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
  const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

  // The middle of one side of an element, and the direction leaving it.
  function sidePoint(el, side) {
    const c = center(el);
    const point = side === 'top' ? { x: c.x, y: el.y } : side === 'bottom' ? { x: c.x, y: el.y + el.h } : side === 'left' ? { x: el.x, y: c.y } : { x: el.x + el.w, y: c.y };
    const normal = side === 'top' ? { x: 0, y: -1 } : side === 'bottom' ? { x: 0, y: 1 } : side === 'left' ? { x: -1, y: 0 } : { x: 1, y: 0 };
    const p = rotatePoint(point, c, el.rotation);
    const n = rotatePoint({ x: c.x + normal.x, y: c.y + normal.y }, c, el.rotation);
    return { x: p.x, y: p.y, nx: n.x - c.x, ny: n.y - c.y };
  }
  // The side of `el` that faces a point best.
  function facingSide(el, point) {
    const c = center(el);
    const local = rotatePoint(point, c, -el.rotation);
    const dx = (local.x - c.x) / Math.max(1, el.w); const dy = (local.y - c.y) / Math.max(1, el.h);
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
  }
  // Where one end of a connector is, attached or free.
  function endPoint(el, which, lookup, other) {
    const end = el[which];
    const target = end.id && lookup ? lookup(end.id) : null;
    if (!target || target.kind === 'connector') return { x: end.x, y: end.y, nx: 0, ny: 0, free: true };
    let side = end.side;
    if (!side) {
      const otherEnd = el[which === 'from' ? 'to' : 'from'];
      const otherTarget = otherEnd.id && lookup ? lookup(otherEnd.id) : null;
      const toward = other || (otherTarget && otherTarget.kind !== 'connector' ? center(otherTarget) : { x: otherEnd.x, y: otherEnd.y });
      side = facingSide(target, toward);
    }
    return { ...sidePoint(target, side), side };
  }

  // The drawn path of a connector: SVG "d" in board coordinates, the point
  // and angle at each end (for arrow heads) and where its label sits.
  function connectorPath(el, lookup) {
    const a = endPoint(el, 'from', lookup);
    const b = endPoint(el, 'to', lookup, a.free ? null : undefined);
    const kind = el.style.path || 'curve';
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (kind === 'straight' || distance < 1) {
      return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, a, b, startAngle: Math.atan2(a.y - b.y, a.x - b.x), endAngle: Math.atan2(b.y - a.y, b.x - a.x), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, points: [a, b] };
    }
    if (kind === 'elbow') {
      const out = (p, other) => (p.free ? { x: p.x, y: p.y } : { x: p.x + p.nx * 24, y: p.y + p.ny * 24 });
      const p1 = out(a, b); const p2 = out(b, a);
      const horizontal = a.free ? Math.abs(b.x - a.x) > Math.abs(b.y - a.y) : Math.abs(a.nx) > 0.5;
      const pts = [a];
      if (!a.free) pts.push(p1);
      if (horizontal) { const mx = (p1.x + p2.x) / 2; pts.push({ x: mx, y: p1.y }, { x: mx, y: p2.y }); }
      else { const my = (p1.y + p2.y) / 2; pts.push({ x: p1.x, y: my }, { x: p2.x, y: my }); }
      if (!b.free) pts.push(p2);
      pts.push(b);
      const clean = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.5);
      const d = clean.map((p, i) => `${i ? 'L' : 'M'} ${round(p.x)} ${round(p.y)}`).join(' ');
      const last = clean[clean.length - 2] || a; const first = clean[1] || b;
      const midIndex = Math.floor((clean.length - 1) / 2);
      const m1 = clean[midIndex]; const m2 = clean[midIndex + 1] || m1;
      return { d, a, b, startAngle: Math.atan2(a.y - first.y, a.x - first.x), endAngle: Math.atan2(b.y - last.y, b.x - last.x), mid: { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2 }, points: clean };
    }
    const reach = Math.min(160, Math.max(30, distance * 0.4));
    const c1 = a.free ? { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 } : { x: a.x + a.nx * reach, y: a.y + a.ny * reach };
    const c2 = b.free ? { x: b.x + (a.x - b.x) / 3, y: b.y + (a.y - b.y) / 3 } : { x: b.x + b.nx * reach, y: b.y + b.ny * reach };
    const at = (t) => {
      const u = 1 - t;
      return { x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y };
    };
    const points = Array.from({ length: 17 }, (_, i) => at(i / 16));
    return { d: `M ${round(a.x)} ${round(a.y)} C ${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(b.x)} ${round(b.y)}`, a, b, startAngle: Math.atan2(a.y - c1.y, a.x - c1.x), endAngle: Math.atan2(b.y - c2.y, b.x - c2.x), mid: at(0.5), points };
  }

  // Distance from a point to a polyline (for clicking thin lines).
  function distanceToPolyline(point, points) {
    let best = Infinity;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]; const b = points[i];
      const dx = b.x - a.x; const dy = b.y - a.y;
      const t = dx || dy ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
      best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
    }
    return best;
  }

  // ------------------------------------------------------------- drawing
  // Smooth a hand-drawn line: drop points too close together, then round the
  // corners (Chaikin), keeping the first and last points.
  function smoothPoints(points, minDistance = 1.5) {
    const kept = [];
    for (const p of points) {
      const last = kept[kept.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minDistance) kept.push(p);
    }
    if (points.length && kept[kept.length - 1] !== points[points.length - 1]) kept.push(points[points.length - 1]);
    if (kept.length < 3) return kept;
    let out = kept;
    for (let pass = 0; pass < 2; pass++) {
      const next = [out[0]];
      for (let i = 0; i < out.length - 1; i++) {
        const a = out[i]; const b = out[i + 1];
        next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1], (a[2] + b[2]) / 2], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1], (a[2] + b[2]) / 2]);
      }
      next.push(out[out.length - 1]);
      out = next;
    }
    return out.map((p) => [round(p[0]), round(p[1]), round(p[2])]);
  }

  // The outline of a pressure-sensitive stroke, as a filled SVG path.
  function strokeOutline(points, width) {
    if (!points.length) return '';
    if (points.length === 1) {
      const [x, y] = points[0]; const r = width / 2;
      return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
    }
    const left = []; const right = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i]; const prev = points[Math.max(0, i - 1)]; const next = points[Math.min(points.length - 1, i + 1)];
      let dx = next[0] - prev[0]; let dy = next[1] - prev[1];
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const taper = Math.min(1, (i + 1) / 4, (points.length - i) / 4);
      const r = (width / 2) * (0.55 + 0.9 * (p[2] ?? 0.5)) * (0.6 + 0.4 * taper);
      left.push([p[0] - dy * r, p[1] + dx * r]); right.push([p[0] + dy * r, p[1] - dx * r]);
    }
    const all = left.concat(right.reverse());
    let d = `M ${round(all[0][0])} ${round(all[0][1])}`;
    for (let i = 1; i < all.length - 1; i++) {
      const mx = (all[i][0] + all[i + 1][0]) / 2; const my = (all[i][1] + all[i + 1][1]) / 2;
      d += ` Q ${round(all[i][0])} ${round(all[i][1])} ${round(mx)} ${round(my)}`;
    }
    return `${d} Z`;
  }

  // Make a stroke's points relative to its own box.
  function fitStroke(el) {
    const pts = el.data.points;
    if (!pts.length) return el;
    const pad = el.style.width;
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs) - pad; const minY = Math.min(...ys) - pad;
    el.data.points = pts.map((p) => [round(p[0] - minX), round(p[1] - minY), p[2]]);
    el.x += minX; el.y += minY;
    el.w = Math.max(...xs) - Math.min(...xs) + pad * 2; el.h = Math.max(...ys) - Math.min(...ys) + pad * 2;
    return el;
  }

  // ----------------------------------------------------------- templates
  // Text in, several stickies out ("Ajout en bloc"): one per line or bullet.
  function bulkLines(text) {
    return str(text).split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '').trim()).filter(Boolean).slice(0, 400);
  }

  // Tasks of a board as Markdown, for "Exporter en plan".
  function planMarkdown(doc, title) {
    const cards = doc.elements.filter((el) => el.kind === 'card');
    const lines = [`# ${title || 'Plan'}`, ''];
    const groups = [['doing', 'En cours'], ['todo', 'À faire'], ['blocked', 'Bloqué'], ['done', 'Terminé']];
    const byId = new Map(doc.elements.map((el) => [el.id, el]));
    for (const [status, label] of groups) {
      const list = cards.filter((card) => card.data.status === status);
      if (!list.length) continue;
      lines.push(`## ${label}`, '');
      for (const card of list) {
        const d = card.data;
        const extra = [d.assignee && `👤 ${d.assignee}`, d.due && `📅 ${d.due}`, d.points && `${d.points} pts`, d.tshirt && `taille ${d.tshirt}`, ...d.tags.map((tag) => `#${tag.replace(/\s+/g, '-')}`)].filter(Boolean);
        lines.push(`- [${status === 'done' ? 'x' : ' '}] ${d.title || 'Sans titre'}${extra.length ? ` — ${extra.join(' · ')}` : ''}`);
        if (d.description) lines.push(`  ${d.description.replace(/\n/g, '\n  ')}`);
        const blockers = doc.elements.filter((el) => el.kind === 'connector' && el.data.relation === 'dependency' && el.to.id === card.id && byId.get(el.from.id));
        for (const blocker of blockers) lines.push(`  - dépend de : ${byId.get(blocker.from.id).data.title || 'une autre tâche'}`);
      }
      lines.push('');
    }
    const points = cards.reduce((sum, card) => sum + (Number(card.data.points) || 0), 0);
    if (points) lines.push(`**Total : ${points} points**`, '');
    return lines.join('\n');
  }

  return {
    VERSION, KINDS, KIND_NAMES, SIDES, PRESETS, STICKY_COLORS,
    newId, clone, color, create, normalize, emptyDoc, serialize, parse, fallbackText,
    fileRefs, rewriteFileRefs,
    center, rotatePoint, bounds, union, intersects, contains, sidePoint, facingSide, endPoint, connectorPath, distanceToPolyline,
    smoothPoints, strokeOutline, fitStroke, bulkLines, planMarkdown,
  };
});
