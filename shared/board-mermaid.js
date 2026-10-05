// Opale — moodboards: Mermaid diagrams. A small, tolerant reader for the
// three Mermaid dialects people paste most (flowchart / graph, mindmap,
// sequenceDiagram), a layered layout (Sugiyama-lite: cycle breaking, longest
// path layers, barycenter ordering, orthogonal routes), and two outputs:
// editable board elements (shapes, connectors, frames, a mind map) and a
// standalone SVG drawn by the live "mermaid" element of a board. No DOM, no
// dependency: the same code runs in Node and in the browser. Nothing here
// throws on bad input; problems come back as `{ error }` or `warnings`.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./board.js'));
  else root.OpaleBoardMermaid = factory(root.OpaleBoard);
})(typeof self !== 'undefined' ? self : this, function (Board) {
  'use strict';

  const MAX_SOURCE = 400000;
  const MAX_NODES = 4000;
  const MAX_EDGES = 12000;
  const DIRECTIONS = { TB: 'TB', TD: 'TB', BT: 'BT', LR: 'LR', RL: 'RL' };
  const FONT = 'Segoe UI, system-ui, sans-serif';
  const CHAR = 0.53125; // average glyph width / font size (8.5px at 16px)
  const NODE_FONT = 16;
  const LABEL_FONT = 14;
  const LINE_H = 22;
  const LABEL_LINE_H = 18;
  const NODE_MIN_W = 120;
  const NODE_H = 56;
  const LAYER_GAP = 60;
  const NODE_GAP = 40;
  const FRAME_PAD = 20;
  const FRAME_TITLE = 28;
  const MARGIN = 16;
  const EDGE_COLOR = '#64748b';
  const THEMES = {
    light: { stroke: '#1f2937', fill: '#ffffff', text: '#111827', edge: EDGE_COLOR, labelBg: '#ffffff', frameFill: 'rgba(100,116,139,0.07)', frameStroke: '#94a3b8', muted: '#475569', lifeline: '#94a3b8' },
    dark: { stroke: '#c6c3d3', fill: '#1e1d25', text: '#ecebf3', edge: EDGE_COLOR, labelBg: '#1e1d25', frameFill: 'rgba(198,195,211,0.06)', frameStroke: '#5b5868', muted: '#a9a6b8', lifeline: '#5b5868' },
  };
  const BRANCH_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#ec4899'];
  const FLOW_SHAPES = ['rect', 'roundrect', 'stadium', 'subroutine', 'cylinder', 'circle', 'diamond', 'hexagon', 'parallelogram', 'parallelogram-alt', 'trapezoid', 'trapezoid-alt', 'asymmetric', 'double-circle'];

  // ------------------------------------------------------------- utilities
  const str = (value) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value));
  const num = (value, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
  const r1 = (value) => Math.round(value * 10) / 10;
  const failure = (error) => (error && error.message ? error.message : str(error));

  // Text for SVG: escaped, and without the characters XML refuses.
  function esc(text) {
    return str(text)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Approximate width of a line of text: wide glyphs (CJK, emoji) count double.
  function textWidth(text, size) {
    let width = 0;
    for (const ch of str(text)) width += ch.codePointAt(0) >= 0x2e80 ? size : size * CHAR;
    return width;
  }
  function textBox(text, size, lineHeight) {
    const lines = str(text).split('\n');
    return { lines, w: Math.max(0, ...lines.map((line) => textWidth(line, size))), h: lines.length * lineHeight };
  }

  const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ', apos: '\'', laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—', euro: '€', copy: '©', deg: '°', middot: '·', bull: '•' };
  function fromCode(code, match) {
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
    return String.fromCodePoint(code);
  }
  // Mermaid's own "#quot;" / "#35;" codes and HTML entities.
  function decodeEntities(text) {
    return text
      .replace(/#(\d{1,7});/g, (match, code) => fromCode(Number(code), match))
      .replace(/#([a-z]{2,8});/gi, (match, name) => (Object.prototype.hasOwnProperty.call(ENTITIES, name.toLowerCase()) ? ENTITIES[name.toLowerCase()] : match))
      .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, body) => {
        if (body[0] === '#') return fromCode(body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1)), match);
        return Object.prototype.hasOwnProperty.call(ENTITIES, body.toLowerCase()) ? ENTITIES[body.toLowerCase()] : match;
      });
  }

  // A label as Mermaid writes it -> plain text with real line breaks.
  function cleanLabel(raw) {
    let text = str(raw).trim();
    let markdown = false;
    if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') text = text.slice(1, -1).trim();
    if (text.length >= 2 && text[0] === '`' && text[text.length - 1] === '`') { text = text.slice(1, -1); markdown = true; }
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/?[a-z][^<>]*>/gi, '');
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
    if (markdown) text = text.replace(/\*([^*\n]+)\*/g, '$1').replace(/(^|\s)_([^_\n]+)_/g, '$1$2');
    text = decodeEntities(text);
    return text.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n').trim();
  }

  // Source -> lines without fences, front matter and %% comments.
  function prepare(source) {
    let text = str(source).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const fence = /^\s*(`{3,}|~{3,})[ \t]*mermaid[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*\n?\s*$/i.exec(text);
    if (fence) text = fence[2];
    const raw = text.split('\n');
    const lines = [];
    let i = 0;
    while (i < raw.length && !raw[i].trim()) i++;
    if (i < raw.length && raw[i].trim() === '---') {
      let j = i + 1;
      while (j < raw.length && raw[j].trim() !== '---') j++;
      if (j < raw.length) i = j + 1;
    }
    for (; i < raw.length; i++) {
      if (/^\s*%%/.test(raw[i])) continue;
      lines.push({ text: raw[i], line: i + 1 });
    }
    return lines;
  }

  // ============================================================ flowchart
  // Node openers, longest first, with their closers and shapes.
  const OPENERS = [
    ['(((', [[')))', 'double-circle']]],
    ['((', [['))', 'circle']]],
    ['([', [['])', 'stadium']]],
    ['[[', [[']]', 'subroutine']]],
    ['[(', [[')]', 'cylinder']]],
    ['{{', [['}}', 'hexagon']]],
    ['[/', [['/]', 'parallelogram'], ['\\]', 'trapezoid']]],
    ['[\\', [['\\]', 'parallelogram-alt'], ['/]', 'trapezoid-alt']]],
    ['[', [[']', 'rect']]],
    ['(', [[')', 'roundrect']]],
    ['{', [['}', 'diamond']]],
    ['>', [[']', 'asymmetric']]],
  ];
  // Shape names of the newer `A@{ shape: … }` syntax.
  const SHAPE_NAMES = {
    rect: 'rect', rectangle: 'rect', proc: 'rect', process: 'rect', square: 'rect',
    rounded: 'roundrect', event: 'roundrect', round: 'roundrect',
    stadium: 'stadium', pill: 'stadium', terminal: 'stadium',
    subroutine: 'subroutine', subproc: 'subroutine', 'fr-rect': 'subroutine', subprocess: 'subroutine',
    cyl: 'cylinder', cylinder: 'cylinder', database: 'cylinder', db: 'cylinder',
    circle: 'circle', circ: 'circle',
    diam: 'diamond', diamond: 'diamond', decision: 'diamond', question: 'diamond', rhombus: 'diamond',
    hex: 'hexagon', hexagon: 'hexagon', prepare: 'hexagon',
    'lean-r': 'parallelogram', 'lean-right': 'parallelogram', 'in-out': 'parallelogram',
    'lean-l': 'parallelogram-alt', 'lean-left': 'parallelogram-alt', 'out-in': 'parallelogram-alt',
    'trap-b': 'trapezoid', 'trapezoid-bottom': 'trapezoid', priority: 'trapezoid', trapezoid: 'trapezoid',
    'trap-t': 'trapezoid-alt', 'trapezoid-top': 'trapezoid-alt', manual: 'trapezoid-alt', 'inv-trapezoid': 'trapezoid-alt',
    odd: 'asymmetric', asymmetric: 'asymmetric',
    'dbl-circ': 'double-circle', 'double-circle': 'double-circle',
  };
  const ID_RE = /^[A-Za-z0-9_À-￿](?:[A-Za-z0-9_À-￿]|-(?=[A-Za-z0-9_À-￿]))*/;
  const WORD_CHAR = /[A-Za-z0-9_À-￿]/;
  const LINK_RE = /^(<|o|x)?(~{3,}|-\.+-|-{2,}|={2,})(>|o|x)?/;
  const MARKS = { '<': 'arrow', '>': 'arrow', o: 'circle', x: 'cross' };
  const IGNORED = /^(classDef|class|style|linkStyle|click|accTitle|accDescr|direction)\b/;

  const skipWs = (s, i) => { while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++; return i; };

  // One line -> statements, cut at ";" outside quotes, brackets and |labels|.
  function splitStatements(line) {
    const out = [];
    let depth = 0; let quote = false; let pipe = false; let start = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') quote = !quote;
      else if (quote) continue;
      else if (c === '[' || c === '(' || c === '{') depth++;
      else if (c === ']' || c === ')' || c === '}') depth = Math.max(0, depth - 1);
      else if (c === '|' && depth === 0) pipe = !pipe;
      else if (c === ';' && depth === 0 && !pipe && !/#\w+$/.test(line.slice(Math.max(start, i - 10), i))) { out.push(line.slice(start, i)); start = i + 1; }
    }
    out.push(line.slice(start));
    return out.map((part) => part.trim()).filter(Boolean);
  }

  // A node's shape and label after its id; null when nothing opens there,
  // { error } when the shape never closes.
  function readShape(s, i) {
    let opened = false;
    for (const [open, closes] of OPENERS) {
      if (!s.startsWith(open, i)) continue;
      opened = true;
      const from = i + open.length;
      const k = skipWs(s, from);
      if (s[k] === '"') {
        const q = s.indexOf('"', k + 1);
        if (q > 0) {
          const m = skipWs(s, q + 1);
          for (const [close, shape] of closes) if (s.startsWith(close, m)) return { shape, label: s.slice(k, q + 1), end: m + close.length };
        }
      }
      let best = null;
      for (const [close, shape] of closes) {
        const at = s.indexOf(close, from);
        if (at >= 0 && (!best || at < best.at)) best = { at, close, shape };
      }
      if (best) return { shape: best.shape, label: s.slice(from, best.at), end: best.at + best.close.length };
    }
    return opened ? { error: true } : null;
  }

  // `{ shape: diam, label: "Texte" }` of the `A@{ … }` syntax.
  function readAttrs(s, i) {
    let quote = false;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '"') quote = !quote;
      else if (!quote && s[j] === '}') {
        const body = s.slice(i + 1, j);
        const shape = /(?:^|[,\s])shape\s*:\s*([\w-]+)/.exec(body);
        const label = /(?:^|[,\s])label\s*:\s*("([^"]*)"|[^,}]+)/.exec(body);
        return { shape: shape ? SHAPE_NAMES[shape[1].toLowerCase()] || 'rect' : 'rect', label: label ? (label[2] !== undefined ? label[2] : label[1]) : null, end: j + 1 };
      }
    }
    return null;
  }

  function readNode(s, i) {
    const m = ID_RE.exec(s.slice(i, i + 400));
    if (!m) return null;
    let j = i + m[0].length;
    const ref = { id: m[0], shape: null, label: null };
    if (s.startsWith('@{', j)) {
      const attrs = readAttrs(s, j + 1);
      if (!attrs) return null;
      ref.shape = attrs.shape; ref.label = attrs.label === null ? ref.id : attrs.label; j = attrs.end;
    } else {
      const k = skipWs(s, j);
      const c = s[k];
      if (c === '[' || c === '(' || c === '{' || (c === '>' && k === j)) {
        const spec = readShape(s, k);
        if (!spec || spec.error) return null;
        ref.shape = spec.shape; ref.label = spec.label; j = spec.end;
      }
    }
    const cls = /^:::[\w-]+/.exec(s.slice(j, j + 200));
    if (cls) j += cls[0].length;
    return { ref, end: j };
  }

  // `A & B & C`
  function readGroup(s, i) {
    const refs = [];
    let j = i;
    for (;;) {
      j = skipWs(s, j);
      const node = readNode(s, j);
      if (!node) return null;
      refs.push(node.ref);
      j = node.end;
      const k = skipWs(s, j);
      if (s[k] === '&') { j = k + 1; continue; }
      return { refs, end: j };
    }
  }

  const lineKind = (body) => (body[0] === '~' ? 'invisible' : body.includes('.') ? 'dotted' : body[0] === '=' ? 'thick' : 'solid');

  // A link: `-->`, `-.->`, `==>`, `<-->`, `--o`, `--x`, `---`, `~~~`, with a
  // label written `-- text -->` or `-->|text|`.
  function readLink(s, i) {
    const rest = s.slice(i);
    const m = LINK_RE.exec(rest);
    let startMark = ''; let endMark = ''; let body = ''; let label = ''; let used = 0;
    const textForm = (openLen, kind) => {
      const closer = kind === 'thick' ? /={2,}[>ox]|={3,}/ : kind === 'dotted' ? /\.+-[>ox]?/ : /-{2,}[>ox]|-{3,}/;
      const after = rest.slice(openLen);
      const c = closer.exec(after);
      if (!c) return false;
      label = after.slice(0, c.index);
      const last = c[0][c[0].length - 1];
      endMark = '>ox'.includes(last) ? last : '';
      body = kind === 'thick' ? '===' : kind === 'dotted' ? '-.-' : '---';
      used = openLen + c.index + c[0].length;
      return true;
    };
    if (m) {
      startMark = m[1] || '';
      body = m[2];
      const glued = (m[3] === 'o' || m[3] === 'x') && WORD_CHAR.test(rest[m[0].length] || '');
      const short = body === '--' || body === '==';
      if (short && (!m[3] || glued)) {
        if (!textForm(startMark.length + 2, body[0] === '=' ? 'thick' : 'solid')) {
          if (!glued) return null;
          body = m[2]; endMark = m[3]; used = m[0].length;
        }
      } else {
        endMark = m[3] || '';
        used = m[0].length;
      }
    } else {
      const dotted = /^(<)?-\.(?!\.)/.exec(rest);
      if (!dotted) return null;
      startMark = dotted[1] || '';
      if (!textForm(dotted[0].length, 'dotted')) return null;
    }
    let next = i + used;
    const pipe = /^\s*\|([^|]*)\|/.exec(s.slice(next));
    if (pipe) { label = pipe[1]; next += pipe[0].length; }
    const start = MARKS[startMark] || 'none';
    const end = MARKS[endMark] || 'none';
    const arrow = start === 'arrow' && end === 'arrow' ? 'both' : end !== 'none' ? end : start;
    return { line: lineKind(body), start, end, arrow, label: cleanLabel(label), next };
  }

  // A whole statement, parsed before anything is applied.
  function readStatement(s) {
    const first = readGroup(s, 0);
    if (!first) return null;
    const groups = [first.refs]; const links = [];
    let i = first.end;
    for (;;) {
      i = skipWs(s, i);
      if (i >= s.length) break;
      const link = readLink(s, i);
      if (!link) return null;
      const next = readGroup(s, link.next);
      if (!next) return null;
      links.push(link); groups.push(next.refs);
      i = next.end;
    }
    return { groups, links };
  }

  function parseFlowchart(lines, out) {
    const nodes = new Map();
    const memberOf = new Map();
    const subById = new Map();
    const stack = [];
    let auto = 0;
    const warn = (line, text) => { if (out.warnings.length < 50) out.warnings.push(`Ligne ${line} ignorée : ${text.slice(0, 80)}`); };
    const touch = (ref) => {
      let node = nodes.get(ref.id);
      if (!node) {
        if (nodes.size >= MAX_NODES) return false;
        node = { id: ref.id, label: ref.id, shape: 'rect', explicit: false };
        nodes.set(ref.id, node);
      }
      if (ref.shape) { node.shape = ref.shape; node.label = cleanLabel(ref.label); node.explicit = true; }
      const sub = stack[stack.length - 1];
      if (sub && !memberOf.has(ref.id)) { memberOf.set(ref.id, sub.id); sub.nodes.push(ref.id); }
      return true;
    };
    for (const { text, line } of lines) {
      for (const stmt of splitStatements(text)) {
        const sub = /^subgraph(?:\s+(.*))?$/i.exec(stmt);
        if (sub) {
          const rest = (sub[1] || '').trim();
          let id = ''; let title = '';
          const named = /^([^\s[\]"]+)\s*\[(.*)\]$/.exec(rest);
          if (named) { id = named[1]; title = cleanLabel(named[2]); }
          else if (/^[^\s"]+$/.test(rest)) { id = rest; title = rest; }
          else title = cleanLabel(rest);
          if (!id) id = `subgraph-${++auto}`;
          let unique = id; let n = 2;
          while (subById.has(unique)) unique = `${id}-${n++}`;
          const parent = stack[stack.length - 1];
          const entry = { id: unique, title, nodes: [], parent: parent ? parent.id : null };
          subById.set(unique, entry);
          out.subgraphs.push(entry);
          stack.push(entry);
          continue;
        }
        if (/^end$/i.test(stmt)) {
          if (stack.length) stack.pop();
          else warn(line, stmt);
          continue;
        }
        if (IGNORED.test(stmt)) continue;
        const parsed = readStatement(stmt);
        if (!parsed) { warn(line, stmt); continue; }
        for (const refs of parsed.groups) for (const ref of refs) touch(ref);
        parsed.links.forEach((link, k) => {
          for (const a of parsed.groups[k]) {
            for (const b of parsed.groups[k + 1]) {
              if (out.edges.length >= MAX_EDGES || !nodes.has(a.id) || !nodes.has(b.id)) continue;
              out.edges.push({ from: a.id, to: b.id, label: link.label, line: link.line, arrow: link.arrow, start: link.start, end: link.end });
            }
          }
        });
      }
    }
    if (stack.length) out.warnings.push('Sous-graphe non fermé : « end » manquant.');
    // A subgraph used as an edge end: drop the implicit node of that name.
    const hasMembers = (id) => out.subgraphs.some((s) => s.id === id && s.nodes.length) || out.subgraphs.some((s) => s.parent === id);
    for (const s of out.subgraphs) {
      const node = nodes.get(s.id);
      if (!node || node.explicit || !hasMembers(s.id)) continue;
      nodes.delete(s.id);
      for (const other of out.subgraphs) other.nodes = other.nodes.filter((id) => id !== s.id);
    }
    out.nodes = [...nodes.values()].map((node) => ({ id: node.id, label: node.label, shape: node.shape }));
    if (!out.nodes.length) out.error = 'Aucun nœud trouvé dans le diagramme Mermaid.';
  }

  // ============================================================== mindmap
  const MIND_CLOSE = { '((': '))', '))': '((', '{{': '}}', '(': ')', ')': '(', '[': ']' };
  const MIND_SHAPES = { '((': 'circle', '))': 'bang', '{{': 'hexagon', '(': 'round', ')': 'cloud', '[': 'rect' };

  function mindNode(text) {
    const clean = text.replace(/\s*:::.*$/, '').trim();
    const m = /^([^\s()[\]{}]*)(\(\(|\)\)|\{\{|\(|\)|\[)([\s\S]*)$/.exec(clean);
    if (m) {
      const close = MIND_CLOSE[m[2]];
      if (m[3].endsWith(close) && m[3].length >= close.length) return { text: cleanLabel(m[3].slice(0, -close.length)), shape: MIND_SHAPES[m[2]], children: [] };
    }
    return { text: cleanLabel(clean), shape: 'default', children: [] };
  }

  function parseMindmap(lines, out) {
    let root = null; let count = 0;
    const stack = [];
    for (const { text, line } of lines) {
      if (!text.trim()) continue;
      const trimmed = text.trim();
      if (/^::icon\(/i.test(trimmed) || trimmed.startsWith(':::')) continue;
      const indent = text.replace(/\t/g, '    ').search(/\S/);
      const node = mindNode(trimmed);
      if (++count > MAX_NODES) { out.warnings.push('Carte mentale tronquée : trop de nœuds.'); break; }
      if (!root) { root = node; stack.push({ indent, node }); continue; }
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
      if (stack[stack.length - 1].indent >= indent && out.warnings.length < 50) out.warnings.push(`Ligne ${line} : plusieurs racines, nœud rattaché à la racine.`);
      if (stack.length > 60) continue;
      stack[stack.length - 1].node.children.push(node);
      stack.push({ indent, node });
    }
    out.tree = root;
    if (!root) out.error = 'La carte mentale Mermaid est vide.';
  }

  // ============================================================= sequence
  const SEQ_ARROWS = {
    '<<-->>': { line: 'dotted', arrow: 'both' }, '<<->>': { line: 'solid', arrow: 'both' },
    '-->>': { line: 'dotted', arrow: 'arrow' }, '->>': { line: 'solid', arrow: 'arrow' },
    '--x': { line: 'dotted', arrow: 'cross' }, '-x': { line: 'solid', arrow: 'cross' },
    '--)': { line: 'dotted', arrow: 'arrow' }, '-)': { line: 'solid', arrow: 'arrow' },
    '-->': { line: 'dotted', arrow: 'none' }, '->': { line: 'solid', arrow: 'none' },
  };
  const SEQ_MESSAGE = /^([^\s:][^:]*?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^:]+?)\s*(?::(.*))?$/;
  const SEQ_SKIP = /^(note|loop|alt|else|opt|par|and|end|rect|critical|option|break|activate|deactivate|autonumber|title|box|destroy|links?|properties|details|accTitle|accDescr)\b/i;

  function parseSequence(lines, out) {
    const byId = new Map();
    const unquote = (value) => cleanLabel(str(value).trim());
    const add = (id, label, kind) => {
      const key = unquote(id);
      if (!key) return null;
      let p = byId.get(key);
      if (!p) {
        if (byId.size >= 200) return null;
        p = { id: key, label: label ? unquote(label) : key, kind: kind || 'participant' };
        byId.set(key, p); out.participants.push(p);
      } else {
        if (label) p.label = unquote(label);
        if (kind) p.kind = kind;
      }
      return p;
    };
    for (const { text, line } of lines) {
      const t = text.trim();
      if (!t) continue;
      const decl = /^(?:create\s+)?(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(t);
      if (decl) { add(decl[2], decl[3], decl[1].toLowerCase()); continue; }
      if (SEQ_SKIP.test(t)) continue;
      const m = SEQ_MESSAGE.exec(t);
      if (!m) { if (out.warnings.length < 50) out.warnings.push(`Ligne ${line} ignorée : ${t.slice(0, 80)}`); continue; }
      const a = add(m[1]); const b = add(m[4]);
      if (!a || !b || out.messages.length >= 2000) continue;
      const kind = SEQ_ARROWS[m[2]];
      out.messages.push({ from: a.id, to: b.id, label: cleanLabel(m[5] || ''), line: kind.line, arrow: kind.arrow });
    }
    if (!out.participants.length) out.error = 'Le diagramme de séquence Mermaid est vide.';
  }

  // ================================================================ parse
  function parse(source) {
    const out = { type: null, direction: 'TB', nodes: [], edges: [], subgraphs: [], tree: null, participants: [], messages: [], warnings: [], error: null };
    try {
      const text = str(source);
      if (text.length > MAX_SOURCE) { out.error = 'Diagramme Mermaid trop volumineux.'; return out; }
      const lines = prepare(text);
      const first = lines.findIndex((l) => l.text.trim());
      if (first < 0) { out.error = 'Le diagramme Mermaid est vide.'; return out; }
      const header = lines[first].text.trim();
      const body = lines.slice(first + 1);
      const flow = /^(?:flowchart-elk|flowchart|graph)(?:\s+(TB|TD|BT|LR|RL))?(?=$|[\s;])\s*;?\s*(.*)$/i.exec(header);
      if (flow) {
        out.type = 'flowchart';
        out.direction = DIRECTIONS[(flow[1] || 'TB').toUpperCase()];
        parseFlowchart((flow[2] ? [{ text: flow[2], line: lines[first].line }] : []).concat(body), out);
      } else if (/^mindmap\s*$/i.test(header)) {
        out.type = 'mindmap';
        parseMindmap(body, out);
      } else if (/^sequenceDiagram\s*$/i.test(header)) {
        out.type = 'sequence';
        parseSequence(body, out);
      } else {
        out.error = `Type de diagramme Mermaid non pris en charge : ${header.split(/\s+/)[0].slice(0, 40)}`;
      }
    } catch (error) {
      out.error = `Diagramme Mermaid illisible : ${failure(error)}`;
    }
    return out;
  }

  // =============================================================== layout
  // Size of a flowchart node from its label and shape.
  function nodeSize(label, shape) {
    const box = textBox(label, NODE_FONT, LINE_H);
    const tw = Math.max(box.w, NODE_FONT); const th = box.h;
    let w = Math.max(NODE_MIN_W, Math.ceil(tw + 40));
    let h = Math.max(NODE_H, Math.ceil(th + 26));
    switch (shape) {
      case 'diamond': w = Math.max(140, Math.ceil(tw * 1.6 + 50)); h = Math.max(90, Math.ceil(th * 1.6 + 44)); break;
      case 'hexagon': w += 40; break;
      case 'circle': case 'double-circle': {
        const d = Math.max(80, Math.ceil(Math.hypot(tw, th) + 24)) + (shape === 'double-circle' ? 12 : 0);
        w = d; h = d; break;
      }
      case 'cylinder': h += 20; break;
      case 'parallelogram': case 'parallelogram-alt': case 'trapezoid': case 'trapezoid-alt': w += 40; break;
      case 'stadium': w += 24; break;
      case 'asymmetric': w += 30; break;
      case 'subroutine': w += 20; break;
      default:
    }
    return { w, h };
  }
  const slant = (w, h) => Math.min(h * 0.4, w * 0.2, 24);

  // How far inside its box a shape's outline is at the middle of a side.
  function sideInset(shape, side, w, h) {
    if (side !== 'left' && side !== 'right') return 0;
    if (shape === 'parallelogram' || shape === 'parallelogram-alt' || shape === 'trapezoid' || shape === 'trapezoid-alt') return slant(w, h) / 2;
    if (shape === 'asymmetric' && side === 'left') return slant(w, h);
    return 0;
  }

  // Drop repeated points and the middle of straight runs.
  function simplify(points) {
    const out = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
      if (out.length >= 2) {
        const a = out[out.length - 2]; const b = last;
        if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - p.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - p.y) < 0.5)) out.pop();
      }
      out.push({ x: p.x, y: p.y });
    }
    return out;
  }

  function nearestSide(box, p) {
    const d = { top: Math.abs(p.y - box.y), bottom: Math.abs(p.y - (box.y + box.h)), left: Math.abs(p.x - box.x), right: Math.abs(p.x - (box.x + box.w)) };
    return Object.keys(d).reduce((best, side) => (d[side] < d[best] ? side : best), 'top');
  }

  // An orthogonal route between two boxes (edges to subgraphs, fallbacks).
  function boxRoute(a, b, horizontal) {
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }; const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const vertical = () => {
      if (b.y >= a.y + a.h) { const my = (a.y + a.h + b.y) / 2; return [{ x: ac.x, y: a.y + a.h }, { x: ac.x, y: my }, { x: bc.x, y: my }, { x: bc.x, y: b.y }]; }
      if (b.y + b.h <= a.y) { const my = (b.y + b.h + a.y) / 2; return [{ x: ac.x, y: a.y }, { x: ac.x, y: my }, { x: bc.x, y: my }, { x: bc.x, y: b.y + b.h }]; }
      return null;
    };
    const side = () => {
      if (b.x >= a.x + a.w) { const mx = (a.x + a.w + b.x) / 2; return [{ x: a.x + a.w, y: ac.y }, { x: mx, y: ac.y }, { x: mx, y: bc.y }, { x: b.x, y: bc.y }]; }
      if (b.x + b.w <= a.x) { const mx = (b.x + b.w + a.x) / 2; return [{ x: a.x, y: ac.y }, { x: mx, y: ac.y }, { x: mx, y: bc.y }, { x: b.x + b.w, y: bc.y }]; }
      return null;
    };
    const route = (horizontal ? side() || vertical() : vertical() || side()) || [{ x: ac.x, y: a.y + a.h }, { x: ac.x, y: b.y + b.h }];
    return simplify(route);
  }

  function selfLoop(box) {
    const x = box.x + box.w; const y1 = box.y + box.h * 0.3; const y2 = box.y + box.h * 0.7;
    return [{ x, y: y1 }, { x: x + 30, y: y1 }, { x: x + 30, y: y2 }, { x, y: y2 }];
  }

  function midOfRoute(points) {
    if (points.length < 2) return points[0] || { x: 0, y: 0 };
    const i = Math.floor((points.length - 1) / 2);
    return { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
  }

  function layoutFlowchart(graph) {
    const dir = DIRECTIONS[str(graph.direction).toUpperCase()] || 'TB';
    const horizontal = dir === 'LR' || dir === 'RL';
    const nodes = (Array.isArray(graph.nodes) ? graph.nodes : []).filter(isObject);
    const n = nodes.length;
    const index = new Map();
    nodes.forEach((node, i) => { const id = str(node.id); if (!index.has(id)) index.set(id, i); });
    const size = nodes.map((node) => nodeSize(node.label === undefined ? node.id : node.label, node.shape));
    const crossOf = (i) => (horizontal ? size[i].h : size[i].w);
    const alongOf = (i) => (horizontal ? size[i].w : size[i].h);

    // Subgraphs: ancestry chain of each node, members of each subgraph.
    const subs = (Array.isArray(graph.subgraphs) ? graph.subgraphs : []).filter((s) => isObject(s) && s.id !== undefined);
    const subById = new Map();
    for (const s of subs) if (!subById.has(str(s.id))) subById.set(str(s.id), s);
    const ancestry = (id) => {
      const chain = []; const seen = new Set();
      let cur = id;
      while (cur !== null && cur !== undefined && subById.has(str(cur)) && !seen.has(str(cur)) && chain.length < 40) {
        seen.add(str(cur)); chain.unshift(str(cur));
        cur = subById.get(str(cur)).parent;
      }
      return chain;
    };
    const subOfNode = new Map();
    for (const s of subById.values()) for (const id of Array.isArray(s.nodes) ? s.nodes : []) if (!subOfNode.has(str(id))) subOfNode.set(str(id), str(s.id));
    const chainOfNode = nodes.map((node) => (subOfNode.has(str(node.id)) ? ancestry(subOfNode.get(str(node.id))) : []));
    const members = new Map();
    chainOfNode.forEach((chain, i) => { for (const sid of chain) { if (!members.has(sid)) members.set(sid, []); members.get(sid).push(i); } });
    const resolve = (id) => {
      const key = str(id);
      if (index.has(key)) return index.get(key);
      const list = members.get(key);
      return list && list.length ? list[0] : -1;
    };

    // Layout edges (self loops and edges into their own subgraph are routed apart).
    const edges = Array.isArray(graph.edges) ? graph.edges : [];
    const ledges = [];
    edges.forEach((e, ei) => {
      if (!isObject(e)) return;
      const u = resolve(e.from); const v = resolve(e.to);
      if (u >= 0 && v >= 0 && u !== v) ledges.push({ u, v, ei, rev: false });
    });

    // 1. Break cycles: an iterative DFS reverses back edges.
    const out = Array.from({ length: n }, () => []);
    const indeg0 = new Int32Array(n);
    ledges.forEach((e, k) => { out[e.u].push(k); indeg0[e.v]++; });
    const state = new Uint8Array(n);
    const starts = [];
    for (let i = 0; i < n; i++) if (!indeg0[i]) starts.push(i);
    for (let i = 0; i < n; i++) if (indeg0[i]) starts.push(i);
    for (const s of starts) {
      if (state[s]) continue;
      state[s] = 1;
      const stack = [[s, 0]];
      while (stack.length) {
        const top = stack[stack.length - 1];
        const list = out[top[0]];
        if (top[1] < list.length) {
          const k = list[top[1]++];
          const w = ledges[k].v;
          if (state[w] === 1) ledges[k].rev = true;
          else if (state[w] === 0) { state[w] = 1; stack.push([w, 0]); }
        } else { state[top[0]] = 2; stack.pop(); }
      }
    }

    // 2. Layers by longest path (Kahn), then sources pulled next to their children.
    const dagOut = Array.from({ length: n }, () => []);
    const dagIn = Array.from({ length: n }, () => []);
    for (const e of ledges) {
      const a = e.rev ? e.v : e.u; const b = e.rev ? e.u : e.v;
      dagOut[a].push(b); dagIn[b].push(a);
    }
    const layer = new Int32Array(n);
    const indeg = new Int32Array(n);
    for (let i = 0; i < n; i++) indeg[i] = dagIn[i].length;
    const topo = [];
    for (let i = 0; i < n; i++) if (!indeg[i]) topo.push(i);
    for (let q = 0; q < topo.length; q++) {
      const u = topo[q];
      for (const v of dagOut[u]) {
        if (layer[u] + 1 > layer[v]) layer[v] = layer[u] + 1;
        if (--indeg[v] === 0) topo.push(v);
      }
    }
    for (let q = topo.length - 1; q >= 0; q--) {
      const u = topo[q];
      if (dagIn[u].length || !dagOut[u].length) continue;
      let min = Infinity;
      for (const v of dagOut[u]) min = Math.min(min, layer[v]);
      layer[u] = min - 1;
    }
    let maxLayer = 0;
    for (let i = 0; i < n; i++) maxLayer = Math.max(maxLayer, layer[i]);
    const L = n ? maxLayer + 1 : 0;

    // 3. Virtual graph: long edges get one dummy per crossed layer.
    const vLayer = Array.from(layer); const vReal = nodes.map((_, i) => i);
    const vChain = chainOfNode.slice();
    const up = Array.from({ length: n }, () => []); const down = Array.from({ length: n }, () => []);
    const commonChain = (a, b) => { const out2 = []; for (let i = 0; i < a.length && i < b.length && a[i] === b[i]; i++) out2.push(a[i]); return out2; };
    for (const e of ledges) {
      const a = e.rev ? e.v : e.u; const b = e.rev ? e.u : e.v;
      const chain = [a];
      let prev = a;
      const inner = layer[b] - layer[a] > 1 ? commonChain(chainOfNode[a], chainOfNode[b]) : null;
      for (let l = layer[a] + 1; l < layer[b]; l++) {
        const d = vLayer.length;
        vLayer.push(l); vReal.push(-1); vChain.push(inner); up.push([prev]); down.push([]);
        down[prev].push(d);
        chain.push(d); prev = d;
      }
      down[prev].push(b); up[b].push(prev);
      chain.push(b);
      e.chain = chain;
    }
    const V = vLayer.length;
    const layers = Array.from({ length: L }, () => []);
    for (let v = 0; v < V; v++) layers[vLayer[v]].push(v);

    // 4. Order within layers: barycenter sweeps that keep subgraphs together.
    const pos = new Float64Array(V);
    const bary = new Float64Array(V);
    layers.forEach((list) => list.forEach((v, i) => { pos[v] = i; }));
    const sortLayer = (list, neighbours) => {
      for (const v of list) {
        const nb = neighbours[v];
        if (!nb.length) { bary[v] = pos[v]; continue; }
        let sum = 0;
        for (const w of nb) sum += pos[w];
        bary[v] = sum / nb.length;
      }
      const groupSum = new Map();
      for (const v of list) for (const sid of vChain[v]) { const g = groupSum.get(sid) || [0, 0]; g[0] += bary[v]; g[1]++; groupSum.set(sid, g); }
      const groupBary = (sid) => { const g = groupSum.get(sid); return g[0] / g[1]; };
      list.sort((a, b) => {
        const ca = vChain[a]; const cb = vChain[b];
        for (let d = 0; ; d++) {
          const ga = ca[d]; const gb = cb[d];
          if (ga === undefined && gb === undefined) return bary[a] - bary[b] || pos[a] - pos[b];
          if (ga === gb) continue;
          const ka = ga === undefined ? bary[a] : groupBary(ga);
          const kb = gb === undefined ? bary[b] : groupBary(gb);
          if (ka !== kb) return ka - kb;
          if ((ga === undefined) !== (gb === undefined)) return ga === undefined ? 1 : -1;
          if (ga === undefined) return pos[a] - pos[b];
          return ga < gb ? -1 : 1;
        }
      });
      list.forEach((v, i) => { pos[v] = i; });
    };
    if (subById.size) { const none = up.map(() => []); for (const list of layers) sortLayer(list, none); }
    for (let iter = 0; iter < 8; iter++) {
      if (iter % 2 === 0) for (let l = 1; l < L; l++) sortLayer(layers[l], up);
      else for (let l = L - 2; l >= 0; l--) sortLayer(layers[l], down);
    }

    // 5. Cross-axis coordinates: packed, then pulled toward neighbours.
    const vCross = (v) => (vReal[v] >= 0 ? crossOf(vReal[v]) : 0);
    const sep = (a, b) => {
      const ca = vChain[a]; const cb = vChain[b];
      let common = 0;
      while (common < ca.length && common < cb.length && ca[common] === cb[common]) common++;
      const ends = ca.length - common; const begins = cb.length - common;
      const frame = (ends + begins) * FRAME_PAD + (horizontal ? begins * FRAME_TITLE : 0);
      const da = vReal[a] < 0; const db = vReal[b] < 0;
      const base = da && db ? 14 : da || db ? 24 : NODE_GAP;
      return (vCross(a) + vCross(b)) / 2 + base + frame;
    };
    const coord = new Float64Array(V);
    for (const list of layers) {
      let c = 0;
      list.forEach((v, i) => { if (i) c += sep(list[i - 1], v); coord[v] = c; });
      for (const v of list) coord[v] -= c / 2;
    }
    const place = (list, desired) => {
      const k = list.length;
      if (!k) return;
      const F = new Float64Array(k); const B = new Float64Array(k);
      F[0] = desired[0];
      for (let i = 1; i < k; i++) F[i] = Math.max(desired[i], F[i - 1] + sep(list[i - 1], list[i]));
      B[k - 1] = desired[k - 1];
      for (let i = k - 2; i >= 0; i--) B[i] = Math.min(desired[i], B[i + 1] - sep(list[i], list[i + 1]));
      for (let i = 0; i < k; i++) coord[list[i]] = (F[i] + B[i]) / 2;
    };
    const pull = (list, neighbours) => place(list, list.map((v) => {
      const nb = neighbours[v];
      if (!nb.length) return coord[v];
      let sum = 0;
      for (const w of nb) sum += coord[w];
      return sum / nb.length;
    }));
    for (let iter = 0; iter < 6; iter++) {
      if (iter % 2 === 0) for (let l = 1; l < L; l++) pull(layers[l], up);
      else for (let l = L - 2; l >= 0; l--) pull(layers[l], down);
    }
    const both = up.map((list, v) => list.concat(down[v]));
    for (let l = 0; l < L; l++) pull(layers[l], both);

    // Reserve a cross-axis lane for every top-level group. Per-layer packing
    // alone cannot protect a frame spanning several layers from an outsider
    // on another layer (or from the accumulated padding of nested frames).
    if (subById.size) {
      const lanes = new Map();
      for (let v = 0; v < V; v++) {
        const key = vChain[v][0] || null;
        if (!lanes.has(key)) lanes.set(key, { vertices: [], min: Infinity, max: -Infinity });
        const lane = lanes.get(key);
        const pad = vChain[v].length * (FRAME_PAD + (horizontal ? FRAME_TITLE : 0));
        lane.vertices.push(v);
        lane.min = Math.min(lane.min, coord[v] - vCross(v) / 2 - pad);
        lane.max = Math.max(lane.max, coord[v] + vCross(v) / 2 + pad);
      }
      let cursor = 0;
      for (const lane of lanes.values()) {
        const shift = cursor - lane.min;
        for (const v of lane.vertices) coord[v] += shift;
        cursor += lane.max - lane.min + NODE_GAP;
      }
    }

    // 6. Layer-axis coordinates: band thickness and gaps (frames, labels).
    const thick = new Float64Array(L);
    for (let i = 0; i < n; i++) thick[layer[i]] = Math.max(thick[layer[i]], alongOf(i));
    const begins = new Int32Array(L + 1); const finishes = new Int32Array(L + 1);
    for (const [, list] of members) {
      let lo = Infinity; let hi = -Infinity;
      for (const i of list) { lo = Math.min(lo, layer[i]); hi = Math.max(hi, layer[i]); }
      if (lo <= hi) { begins[lo]++; finishes[hi]++; }
    }
    const labelRoom = new Float64Array(L);
    for (const e of ledges) {
      const edge = edges[e.ei];
      if (!edge.label || edge.line === 'invisible') continue;
      const box = textBox(edge.label, LABEL_FONT, LABEL_LINE_H);
      const l = vLayer[e.chain[0]];
      labelRoom[l] = Math.max(labelRoom[l], horizontal ? Math.min(220, box.w + 24) : box.h + 10);
    }
    const gap = new Float64Array(L);
    const uStart = new Float64Array(L);
    for (let l = 0; l < L; l++) {
      const titles = dir === 'TB' ? begins[l + 1] : dir === 'BT' ? finishes[l] : 0;
      gap[l] = LAYER_GAP + labelRoom[l] + (begins[l + 1] + finishes[l]) * FRAME_PAD + titles * FRAME_TITLE;
      if (l + 1 < L) uStart[l + 1] = uStart[l] + thick[l] + gap[l];
    }
    const uCenter = (v) => uStart[vLayer[v]] + thick[vLayer[v]] / 2;
    const uBegin = (v) => (vReal[v] >= 0 ? uCenter(v) - alongOf(vReal[v]) / 2 : uStart[vLayer[v]]);
    const uEnd = (v) => (vReal[v] >= 0 ? uCenter(v) + alongOf(vReal[v]) / 2 : uStart[vLayer[v]] + thick[vLayer[v]]);
    const toXY = (u, c) => (dir === 'TB' ? { x: c, y: u } : dir === 'BT' ? { x: c, y: -u } : dir === 'LR' ? { x: u, y: c } : { x: -u, y: c });

    const boxes = nodes.map((node, i) => {
      const p = toXY(uCenter(i), coord[i]);
      return { x: p.x - size[i].w / 2, y: p.y - size[i].h / 2, w: size[i].w, h: size[i].h };
    });

    // 7. Subgraph boxes, innermost first.
    const subBoxes = new Map();
    const depthOf = (sid) => ancestry(sid).length;
    const order = [...subById.keys()].sort((a, b) => depthOf(b) - depthOf(a));
    for (const sid of order) {
      const s = subById.get(sid);
      const parts = [];
      for (const id of Array.isArray(s.nodes) ? s.nodes : []) if (index.has(str(id)) && subOfNode.get(str(id)) === sid) parts.push(boxes[index.get(str(id))]);
      for (const [cid, box] of subBoxes) { const c = subById.get(cid); if (c && str(c.parent) === sid && c !== s) parts.push(box); }
      if (!parts.length) continue;
      const x0 = Math.min(...parts.map((b) => b.x)); const y0 = Math.min(...parts.map((b) => b.y));
      const x1 = Math.max(...parts.map((b) => b.x + b.w)); const y1 = Math.max(...parts.map((b) => b.y + b.h));
      const box = { x: x0 - FRAME_PAD, y: y0 - FRAME_PAD - FRAME_TITLE, w: x1 - x0 + 2 * FRAME_PAD, h: y1 - y0 + 2 * FRAME_PAD + FRAME_TITLE };
      const minW = textWidth(cleanLabel(s.title), LABEL_FONT) + 2 * FRAME_PAD;
      if (box.w < minW) { box.x -= (minW - box.w) / 2; box.w = minW; }
      subBoxes.set(sid, box);
    }

    // 8. Routes: through the dummies, orthogonal between layers.
    const routes = edges.map(() => null);
    const shapeOf = (i) => str(nodes[i].shape);
    for (const e of ledges) {
      const edge = edges[e.ei];
      if (edge.line === 'invisible') continue;
      const chain = e.chain;
      const uv = [[uEnd(chain[0]), coord[chain[0]]]];
      let labelUV = null;
      for (let k = 0; k < chain.length - 1; k++) {
        const l = vLayer[chain[k]];
        const mid = uStart[l] + thick[l] + (gap[l] - labelRoom[l]) / 2;
        const nextV = chain[k + 1];
        uv.push([mid, coord[chain[k]]], [mid, coord[nextV]]);
        if (!k) labelUV = [(mid + uBegin(nextV)) / 2, coord[nextV]];
        if (k + 1 < chain.length - 1) uv.push([uBegin(nextV), coord[nextV]], [uEnd(nextV), coord[nextV]]);
      }
      uv.push([uBegin(chain[chain.length - 1]), coord[chain[chain.length - 1]]]);
      let points = uv.map(([u, c]) => toXY(u, c));
      if (e.rev) points.reverse();
      points = simplify(points);
      const src = resolve(edge.from); const dst = resolve(edge.to);
      if (index.has(str(edge.from)) && points.length >= 2) {
        const side = nearestSide(boxes[src], points[0]);
        const inset = sideInset(shapeOf(src), side, boxes[src].w, boxes[src].h);
        if (inset) points[0].x += side === 'left' ? inset : -inset;
      }
      if (index.has(str(edge.to)) && points.length >= 2) {
        const last = points[points.length - 1];
        const side = nearestSide(boxes[dst], last);
        const inset = sideInset(shapeOf(dst), side, boxes[dst].w, boxes[dst].h);
        if (inset) last.x += side === 'left' ? inset : -inset;
      }
      if (!index.has(str(edge.from)) || !index.has(str(edge.to))) continue; // routed below
      routes[e.ei] = { points, label: edge.label ? (labelUV ? toXY(labelUV[0], labelUV[1]) : midOfRoute(points)) : null };
    }
    const boxOf = (id) => (index.has(str(id)) ? boxes[index.get(str(id))] : subBoxes.get(str(id)) || null);
    edges.forEach((edge, ei) => {
      if (routes[ei] || !isObject(edge) || edge.line === 'invisible') return;
      const a = boxOf(edge.from); const b = boxOf(edge.to);
      if (!a || !b) return;
      const points = a === b ? selfLoop(a) : boxRoute(a, b, horizontal);
      routes[ei] = { points, label: edge.label ? (a === b ? { x: a.x + a.w + 30, y: a.y + a.h / 2 } : midOfRoute(points)) : null };
    });

    // 9. Everything shifted to start at (0, 0).
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const grow = (x0, y0, x1, y1) => { minX = Math.min(minX, x0); minY = Math.min(minY, y0); maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1); };
    for (const b of boxes) grow(b.x, b.y, b.x + b.w, b.y + b.h);
    for (const b of subBoxes.values()) grow(b.x, b.y, b.x + b.w, b.y + b.h);
    edges.forEach((edge, ei) => {
      const route = routes[ei];
      if (!route) return;
      for (const p of route.points) grow(p.x, p.y, p.x, p.y);
      if (route.label) {
        const t = textBox(edge.label, LABEL_FONT, LABEL_LINE_H);
        grow(route.label.x - t.w / 2 - 6, route.label.y - t.h / 2 - 4, route.label.x + t.w / 2 + 6, route.label.y + t.h / 2 + 4);
      }
    });
    if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
    const shift = (p) => { p.x = r1(p.x - minX); p.y = r1(p.y - minY); };
    const positions = Object.create(null);
    nodes.forEach((node, i) => {
      const b = boxes[i]; shift(b);
      if (!(str(node.id) in positions)) positions[str(node.id)] = b;
    });
    const subgraphs = Object.create(null);
    for (const [sid, b] of subBoxes) { shift(b); b.w = r1(b.w); b.h = r1(b.h); subgraphs[sid] = b; }
    for (const route of routes) {
      if (!route) continue;
      route.points.forEach(shift);
      if (route.label) shift(route.label);
    }
    return { type: 'flowchart', direction: dir, positions, subgraphs, routes, width: r1(maxX - minX), height: r1(maxY - minY), error: null };
  }

  // Mind map: a horizontal tree, root in the middle, branches either side.
  function mindSize(node, depth) {
    const font = depth === 0 ? 18 : depth === 1 ? 16 : 14;
    const box = textBox(node.text, font, Math.round(font * 1.35));
    let w = Math.max(depth === 0 ? 100 : 60, Math.ceil(box.w + (depth === 0 ? 44 : 28)));
    let h = Math.ceil(box.h + (depth === 0 ? 28 : 16));
    const shape = node.shape;
    if (shape === 'circle') { const d = Math.max(w, h, Math.ceil(Math.hypot(box.w, box.h) + 24)); w = d; h = d; }
    else if (shape === 'bang' || shape === 'cloud') { w += 28; h += 20; }
    else if (shape === 'hexagon') w += 24;
    return { w, h, font };
  }

  function layoutMindmap(graph) {
    const items = [];
    const tree = isObject(graph.tree) ? graph.tree : null;
    if (!tree) return { type: 'mindmap', items, positions: Object.create(null), width: 0, height: 0, error: null };
    const build = (node, depth, parent, branch) => {
      const s = mindSize(node, depth);
      const item = { id: `m${items.length}`, node, depth, parent, branch, side: 1, x: 0, y: 0, w: s.w, h: s.h, font: s.font, children: [] };
      items.push(item);
      const kids = depth < 40 && Array.isArray(node.children) ? node.children.filter(isObject) : [];
      kids.forEach((child, i) => { if (items.length < MAX_NODES) item.children.push(build(child, depth + 1, item, depth === 0 ? i : branch)); });
      return item;
    };
    const root = build(tree, 0, null, -1);
    const vgap = (item) => (item.depth === 0 ? 20 : 10);
    const span = (item) => {
      if (item.span !== undefined) return item.span;
      let sum = 0;
      item.children.forEach((c, i) => { sum += span(c) + (i ? vgap(item) : 0); });
      item.span = Math.max(item.h, sum);
      return item.span;
    };
    // Iterative-safe enough: depth is capped at 40.
    for (let i = items.length - 1; i >= 0; i--) span(items[i]);
    const right = []; const left = [];
    const total = root.children.reduce((sum, c) => sum + c.span, 0);
    let acc = 0;
    root.children.forEach((c) => {
      if (!right.length || acc < total / 2) { right.push(c); acc += c.span; } else left.push(c);
    });
    root.x = -root.w / 2; root.y = -root.h / 2;
    const placeKids = (parent, kids, side) => {
      const hgap = parent.depth === 0 ? 60 : 40;
      const height = kids.reduce((sum, c, i) => sum + c.span + (i ? vgap(parent) : 0), 0);
      let top = parent.y + parent.h / 2 - height / 2;
      for (const c of kids) {
        c.side = side;
        c.x = side > 0 ? parent.x + parent.w + hgap : parent.x - hgap - c.w;
        c.y = top + c.span / 2 - c.h / 2;
        top += c.span + vgap(parent);
        placeKids(c, c.children, side);
      }
    };
    placeKids(root, right, 1);
    placeKids(root, left, -1);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const it of items) { minX = Math.min(minX, it.x); minY = Math.min(minY, it.y); maxX = Math.max(maxX, it.x + it.w); maxY = Math.max(maxY, it.y + it.h); }
    const positions = Object.create(null);
    for (const it of items) {
      it.x = r1(it.x - minX); it.y = r1(it.y - minY);
      positions[it.id] = { x: it.x, y: it.y, w: it.w, h: it.h };
    }
    return { type: 'mindmap', items, positions, width: r1(maxX - minX), height: r1(maxY - minY), error: null };
  }

  // Sequence: participants on a row, one lifeline each, messages downward.
  function layoutSequence(graph) {
    const parts = (Array.isArray(graph.participants) ? graph.participants : []).filter(isObject);
    const msgs = (Array.isArray(graph.messages) ? graph.messages : []).filter(isObject);
    const idx = new Map();
    parts.forEach((p, i) => { if (!idx.has(str(p.id))) idx.set(str(p.id), i); });
    const sizes = parts.map((p) => {
      const box = textBox(p.label === undefined ? p.id : p.label, NODE_FONT, LINE_H);
      const w = Math.max(NODE_MIN_W, Math.ceil(box.w + 32));
      const h = p.kind === 'actor' ? 78 + (box.lines.length - 1) * LINE_H : Math.max(NODE_H, box.h + 26);
      return { w, h };
    });
    const topH = Math.max(0, ...sizes.map((s) => s.h));
    const need = new Float64Array(Math.max(0, parts.length - 1));
    const selfRoom = new Float64Array(parts.length);
    for (const m of msgs) {
      const a = idx.get(str(m.from)); const b = idx.get(str(m.to));
      if (a === undefined || b === undefined) continue;
      const lw = textBox(m.label, LABEL_FONT, LABEL_LINE_H).w + 32;
      if (a === b) { selfRoom[a] = Math.max(selfRoom[a], lw + 50); if (a < need.length) need[a] = Math.max(need[a], lw + 60); continue; }
      const lo = Math.min(a, b); const hi = Math.max(a, b);
      for (let g = lo; g < hi; g++) need[g] = Math.max(need[g], lw / (hi - lo));
    }
    const cx = [];
    parts.forEach((p, i) => { cx.push(i ? cx[i - 1] + Math.max((sizes[i - 1].w + sizes[i].w) / 2 + 40, need[i - 1]) : sizes[0].w / 2); });
    const positions = Object.create(null);
    const participants = parts.map((p, i) => {
      const box = { x: r1(cx[i] - sizes[i].w / 2), y: r1(topH - sizes[i].h), w: sizes[i].w, h: sizes[i].h };
      if (!(str(p.id) in positions)) positions[str(p.id)] = box;
      return { id: str(p.id), label: p.label === undefined ? str(p.id) : str(p.label), kind: p.kind === 'actor' ? 'actor' : 'participant', cx: cx[i], ...box };
    });
    let y = topH + 44;
    const messages = [];
    for (const m of msgs) {
      const a = idx.get(str(m.from)); const b = idx.get(str(m.to));
      if (a === undefined || b === undefined) continue;
      const lines = str(m.label).split('\n').length;
      y += (lines - 1) * LABEL_LINE_H;
      messages.push({ from: str(m.from), to: str(m.to), label: str(m.label), line: m.line === 'dotted' ? 'dotted' : 'solid', arrow: str(m.arrow) || 'arrow', y, x1: cx[a], x2: cx[b], self: a === b });
      y += a === b ? 64 : 44;
    }
    const bottom = y - 8;
    let width = 0;
    participants.forEach((p, i) => { width = Math.max(width, p.x + p.w, p.cx + selfRoom[i]); });
    return { type: 'sequence', participants, positions, messages, lifeline: { top: topH, bottom }, width: r1(width), height: r1(bottom + 8), error: null };
  }

  function layout(graph) {
    try {
      const g = typeof graph === 'string' ? parse(graph) : graph;
      if (!isObject(g)) return { positions: Object.create(null), width: 0, height: 0, error: 'Graphe Mermaid invalide.' };
      if (g.error) return { positions: Object.create(null), width: 0, height: 0, error: g.error };
      if (g.type === 'mindmap') return layoutMindmap(g);
      if (g.type === 'sequence') return layoutSequence(g);
      return layoutFlowchart(g);
    } catch (error) {
      return { positions: Object.create(null), width: 0, height: 0, error: `Mise en page impossible : ${failure(error)}` };
    }
  }

  // ============================================================= elements
  const END_STYLE = { arrow: 'arrow', circle: 'circle', cross: 'cross', none: 'none' };

  function flowElements(graph, lay, ox, oy) {
    const elements = [];
    const idOf = new Map();
    const subs = graph.subgraphs.filter((s) => lay.subgraphs[s.id]);
    const depth = (s) => { let d = 0; let cur = s; const seen = new Set(); while (cur && cur.parent && !seen.has(cur.parent) && d < 40) { seen.add(cur.parent); cur = graph.subgraphs.find((x) => x.id === cur.parent); d++; } return d; };
    subs.slice().sort((a, b) => depth(a) - depth(b)).forEach((s) => {
      const b = lay.subgraphs[s.id];
      const el = Board.create('frame', { x: ox + b.x, y: oy + b.y, w: b.w, h: b.h, data: { title: s.title } });
      idOf.set(`s:${s.id}`, el.id);
      elements.push(el);
    });
    for (const node of graph.nodes) {
      const b = lay.positions[node.id];
      if (!b) continue;
      const el = Board.create('shape', {
        x: ox + b.x, y: oy + b.y, w: b.w, h: b.h,
        style: { fill: '#ffffff', stroke: '#1f2937' },
        data: { shape: FLOW_SHAPES.includes(node.shape) ? node.shape : 'rect', text: node.label },
      });
      idOf.set(`n:${node.id}`, el.id);
      elements.push(el);
    }
    const target = (id) => idOf.get(`n:${id}`) || idOf.get(`s:${id}`);
    const boxFor = (id) => lay.positions[id] || lay.subgraphs[id];
    graph.edges.forEach((edge, ei) => {
      if (edge.line === 'invisible') return;
      const from = target(edge.from); const to = target(edge.to);
      if (!from || !to) return;
      const route = lay.routes[ei];
      const fromEnd = { id: from }; const toEnd = { id: to };
      if (from === to) { fromEnd.side = 'right'; toEnd.side = 'top'; }
      else if (route && route.points.length >= 2) {
        fromEnd.side = nearestSide(boxFor(edge.from), route.points[0]);
        toEnd.side = nearestSide(boxFor(edge.to), route.points[route.points.length - 1]);
      }
      elements.push(Board.create('connector', {
        from: fromEnd, to: toEnd,
        style: { color: EDGE_COLOR, path: 'elbow', dash: edge.line === 'dotted' ? 'dashed' : 'solid', width: edge.line === 'thick' ? 4 : 2, start: END_STYLE[edge.start] || 'none', end: END_STYLE[edge.end] || 'none' },
        data: { label: edge.label },
      }));
    });
    return elements;
  }

  function sequenceElements(lay, ox, oy) {
    const elements = [];
    for (const p of lay.participants) {
      elements.push(Board.create('shape', {
        x: ox + p.x, y: oy + p.y, w: p.w, h: p.h,
        style: { fill: '#ffffff', stroke: '#1f2937' },
        data: { shape: p.kind === 'actor' ? 'actor' : 'rect', text: p.label },
      }));
    }
    for (const p of lay.participants) {
      elements.push(Board.create('connector', {
        from: { x: ox + p.cx, y: oy + lay.lifeline.top }, to: { x: ox + p.cx, y: oy + lay.lifeline.bottom },
        style: { color: '#94a3b8', path: 'straight', dash: 'dashed', width: 1.5, start: 'none', end: 'none' },
      }));
    }
    for (const m of lay.messages) {
      const end = m.arrow === 'both' ? 'arrow' : END_STYLE[m.arrow] || 'arrow';
      elements.push(Board.create('connector', {
        from: { x: ox + m.x1, y: oy + m.y }, to: m.self ? { x: ox + m.x1 + 48, y: oy + m.y + 24 } : { x: ox + m.x2, y: oy + m.y },
        style: { color: EDGE_COLOR, path: 'straight', dash: m.line === 'dotted' ? 'dashed' : 'solid', width: 2, start: m.arrow === 'both' ? 'arrow' : 'none', end },
        data: { label: m.label },
      }));
    }
    return elements;
  }

  function toElements(source, origin = { x: 0, y: 0 }) {
    try {
      const graph = parse(source);
      if (graph.error) return { elements: [], error: graph.error };
      const ox = num(isObject(origin) ? origin.x : 0); const oy = num(isObject(origin) ? origin.y : 0);
      const lay = layout(graph);
      if (lay.error) return { elements: [], error: lay.error };
      if (graph.type === 'mindmap') {
        const plain = (node, depth) => ({ text: str(node.text), children: depth < 40 ? (node.children || []).map((child) => plain(child, depth + 1)) : [] });
        const el = Board.create('mindmap', { x: ox, y: oy, w: Math.max(120, Math.ceil(lay.width)), h: Math.max(60, Math.ceil(lay.height)), data: { root: plain(graph.tree, 0) } });
        return { elements: [el], error: null };
      }
      if (graph.type === 'sequence') return { elements: sequenceElements(lay, ox, oy), error: null };
      return { elements: flowElements(graph, lay, ox, oy), error: null };
    } catch (error) {
      return { elements: [], error: `Conversion Mermaid impossible : ${failure(error)}` };
    }
  }

  // ================================================================== SVG
  let svgCounter = 0;
  const pt = (p) => `${r1(p.x)} ${r1(p.y)}`;

  // A polyline with rounded corners.
  function roundedPath(points, radius = 8) {
    if (points.length < 2) return '';
    let d = `M ${pt(points[0])}`;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i - 1]; const c = points[i]; const q = points[i + 1];
      const d1 = Math.hypot(c.x - p.x, c.y - p.y); const d2 = Math.hypot(q.x - c.x, q.y - c.y);
      const rr = Math.min(radius, d1 / 2, d2 / 2);
      if (!d1 || !d2 || rr < 0.5) { d += ` L ${pt(c)}`; continue; }
      const a = { x: c.x + ((p.x - c.x) * rr) / d1, y: c.y + ((p.y - c.y) * rr) / d1 };
      const b = { x: c.x + ((q.x - c.x) * rr) / d2, y: c.y + ((q.y - c.y) * rr) / d2 };
      d += ` L ${pt(a)} Q ${pt(c)} ${pt(b)}`;
    }
    return `${d} L ${pt(points[points.length - 1])}`;
  }

  function textSvg(text, cx, cy, size, color, extra = '') {
    const lines = str(text).split('\n');
    const lh = Math.round(size * 1.35);
    const top = cy - ((lines.length - 1) * lh) / 2;
    const spans = lines.map((line, i) => `<tspan x="${r1(cx)}" y="${r1(top + i * lh)}">${esc(line) || ' '}</tspan>`).join('');
    return `<text text-anchor="middle" dominant-baseline="central" font-size="${size}" fill="${color}"${extra}>${spans}</text>`;
  }

  function shapeSvg(shape, b, fill, stroke, sw = 2) {
    const { x, y, w, h } = b;
    const a = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"`;
    const poly = (pts) => `<polygon points="${pts.map((p) => `${r1(p[0])},${r1(p[1])}`).join(' ')}" ${a}/>`;
    const rect = (rx) => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(rx)}" ${a}/>`;
    const s = slant(w, h);
    switch (shape) {
      case 'roundrect': case 'round': return rect(Math.min(14, h / 3));
      case 'stadium': return rect(h / 2);
      case 'subroutine': return `${rect(2)}<path d="M ${r1(x + 9)} ${r1(y)} V ${r1(y + h)} M ${r1(x + w - 9)} ${r1(y)} V ${r1(y + h)}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
      case 'cylinder': {
        const rx = w / 2; const ry = Math.min(14, h * 0.15);
        return `<path d="M ${r1(x)} ${r1(y + ry)} V ${r1(y + h - ry)} A ${r1(rx)} ${r1(ry)} 0 0 0 ${r1(x + w)} ${r1(y + h - ry)} V ${r1(y + ry)} A ${r1(rx)} ${r1(ry)} 0 0 0 ${r1(x)} ${r1(y + ry)} Z" ${a}/>`
          + `<path d="M ${r1(x)} ${r1(y + ry)} A ${r1(rx)} ${r1(ry)} 0 0 0 ${r1(x + w)} ${r1(y + ry)}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
      }
      case 'circle': return `<circle cx="${r1(x + w / 2)}" cy="${r1(y + h / 2)}" r="${r1(Math.min(w, h) / 2)}" ${a}/>`;
      case 'double-circle': {
        const rr = Math.min(w, h) / 2;
        return `<circle cx="${r1(x + w / 2)}" cy="${r1(y + h / 2)}" r="${r1(rr)}" ${a}/><circle cx="${r1(x + w / 2)}" cy="${r1(y + h / 2)}" r="${r1(rr - 5)}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
      }
      case 'diamond': return poly([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]]);
      case 'hexagon': { const m = Math.min(24, w / 4, h / 2); return poly([[x + m, y], [x + w - m, y], [x + w, y + h / 2], [x + w - m, y + h], [x + m, y + h], [x, y + h / 2]]); }
      case 'parallelogram': return poly([[x + s, y], [x + w, y], [x + w - s, y + h], [x, y + h]]);
      case 'parallelogram-alt': return poly([[x, y], [x + w - s, y], [x + w, y + h], [x + s, y + h]]);
      case 'trapezoid': return poly([[x + s, y], [x + w - s, y], [x + w, y + h], [x, y + h]]);
      case 'trapezoid-alt': return poly([[x, y], [x + w, y], [x + w - s, y + h], [x + s, y + h]]);
      case 'asymmetric': return poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x + s, y + h / 2]]);
      case 'hexagon-mind': return poly([[x + 12, y], [x + w - 12, y], [x + w, y + h / 2], [x + w - 12, y + h], [x + 12, y + h], [x, y + h / 2]]);
      case 'bang': {
        const cx = x + w / 2; const cy = y + h / 2; const pts = [];
        for (let i = 0; i < 24; i++) { const ang = (i / 24) * Math.PI * 2; const k = i % 2 ? 0.84 : 1; pts.push([cx + Math.cos(ang) * (w / 2) * k, cy + Math.sin(ang) * (h / 2) * k]); }
        return poly(pts);
      }
      case 'cloud': {
        const nx = Math.max(2, Math.round(w / 34)); const ny = Math.max(1, Math.round(h / 30));
        const ix = x + 6; const iy = y + 6; const iw = w - 12; const ih = h - 12;
        const pts = [];
        for (let i = 0; i < nx; i++) pts.push([ix + (iw * i) / nx, iy]);
        for (let i = 0; i < ny; i++) pts.push([ix + iw, iy + (ih * i) / ny]);
        for (let i = 0; i < nx; i++) pts.push([ix + iw - (iw * i) / nx, iy + ih]);
        for (let i = 0; i < ny; i++) pts.push([ix, iy + ih - (ih * i) / ny]);
        let d = `M ${r1(pts[0][0])} ${r1(pts[0][1])}`;
        for (let i = 1; i <= pts.length; i++) {
          const p = pts[i % pts.length]; const q = pts[i - 1];
          const rr = Math.max(4, Math.hypot(p[0] - q[0], p[1] - q[1]) / 2);
          d += ` A ${r1(rr)} ${r1(rr)} 0 0 1 ${r1(p[0])} ${r1(p[1])}`;
        }
        return `<path d="${d} Z" ${a}/>`;
      }
      case 'actor': {
        const cx = x + w / 2;
        return `<g fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"><circle cx="${r1(cx)}" cy="${r1(y + 11)}" r="9" fill="${fill}"/><path d="M ${r1(cx)} ${r1(y + 20)} V ${r1(y + 40)} M ${r1(cx - 14)} ${r1(y + 27)} H ${r1(cx + 14)} M ${r1(cx)} ${r1(y + 40)} L ${r1(cx - 12)} ${r1(y + 54)} M ${r1(cx)} ${r1(y + 40)} L ${r1(cx + 12)} ${r1(y + 54)}"/></g>`;
      }
      default: return rect(3);
    }
  }

  function markersSvg(prefix, color) {
    return `<defs>`
      + `<marker id="${prefix}-arrow" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M 0 0.5 L 10 5 L 0 9.5 Z" fill="${color}"/></marker>`
      + `<marker id="${prefix}-circle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><circle cx="5" cy="5" r="4" fill="${color}"/></marker>`
      + `<marker id="${prefix}-cross" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M 1.5 1.5 L 8.5 8.5 M 8.5 1.5 L 1.5 8.5" stroke="${color}" stroke-width="2" fill="none"/></marker>`
      + `</defs>`;
  }
  const markerAttr = (prefix, which, kind) => (kind && kind !== 'none' && MARKS_SVG.has(kind) ? ` marker-${which}="url(#${prefix}-${kind})"` : '');
  const MARKS_SVG = new Set(['arrow', 'circle', 'cross']);

  function labelSvg(text, at, theme) {
    const box = textBox(text, LABEL_FONT, LABEL_LINE_H);
    const w = box.w + 12; const h = box.h + 6;
    return `<g><rect x="${r1(at.x - w / 2)}" y="${r1(at.y - h / 2)}" width="${r1(w)}" height="${r1(h)}" rx="4" fill="${theme.labelBg}" fill-opacity="0.92"/>${textSvg(text, at.x, at.y, LABEL_FONT, theme.text)}</g>`;
  }

  function wrapSvg(width, height, inner, label) {
    const w = Math.max(1, Math.ceil(width)); const h = Math.max(1, Math.ceil(height));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
  }

  function flowSvg(graph, lay, theme, prefix) {
    const parts = [];
    const ox = MARGIN; const oy = MARGIN;
    const move = (b) => ({ x: b.x + ox, y: b.y + oy, w: b.w, h: b.h });
    const depth = (s) => { let d = 0; let cur = s; const seen = new Set(); while (cur && cur.parent && !seen.has(cur.parent) && d < 40) { seen.add(cur.parent); cur = graph.subgraphs.find((x) => x.id === cur.parent); d++; } return d; };
    graph.subgraphs.filter((s) => lay.subgraphs[s.id]).sort((a, b) => depth(a) - depth(b)).forEach((s) => {
      const b = move(lay.subgraphs[s.id]);
      parts.push(`<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.w)}" height="${r1(b.h)}" rx="8" fill="${theme.frameFill}" stroke="${theme.frameStroke}" stroke-width="1.5"/>`);
      if (s.title) parts.push(`<text x="${r1(b.x + 12)}" y="${r1(b.y + 19)}" font-size="14" font-weight="600" fill="${theme.muted}">${esc(s.title.replace(/\n/g, ' '))}</text>`);
    });
    const labels = [];
    graph.edges.forEach((edge, ei) => {
      const route = lay.routes[ei];
      if (!route || route.points.length < 2) return;
      const points = route.points.map((p) => ({ x: p.x + ox, y: p.y + oy }));
      const dash = edge.line === 'dotted' ? ' stroke-dasharray="6 5"' : '';
      const width = edge.line === 'thick' ? 3.5 : 2;
      parts.push(`<path d="${roundedPath(points)}" fill="none" stroke="${theme.edge}" stroke-width="${width}"${dash} stroke-linecap="round" stroke-linejoin="round"${markerAttr(prefix, 'start', edge.start)}${markerAttr(prefix, 'end', edge.end)}/>`);
      if (edge.label && route.label) labels.push(labelSvg(edge.label, { x: route.label.x + ox, y: route.label.y + oy }, theme));
    });
    for (const node of graph.nodes) {
      const raw = lay.positions[node.id];
      if (!raw) continue;
      const b = move(raw);
      parts.push(shapeSvg(node.shape, b, theme.fill, theme.stroke));
      const dy = node.shape === 'cylinder' ? Math.min(14, b.h * 0.15) / 2 : 0;
      parts.push(textSvg(node.label, b.x + b.w / 2, b.y + b.h / 2 + dy, NODE_FONT, theme.text));
    }
    return { inner: markersSvg(prefix, theme.edge) + parts.join('') + labels.join(''), width: lay.width + 2 * MARGIN, height: lay.height + 2 * MARGIN };
  }

  function mindSvg(lay, theme) {
    const ox = MARGIN; const oy = MARGIN;
    const branches = []; const nodes = [];
    for (const it of lay.items) {
      const color = it.depth === 0 ? BRANCH_COLORS[0] : BRANCH_COLORS[it.branch % BRANCH_COLORS.length];
      const b = { x: it.x + ox, y: it.y + oy, w: it.w, h: it.h };
      if (it.parent) {
        const p = it.parent;
        const px = (it.side > 0 ? p.x + p.w : p.x) + ox; const py = p.y + p.h / 2 + oy;
        const cx = it.side > 0 ? b.x : b.x + b.w; const cy = b.y + b.h / 2;
        const mx = (px + cx) / 2;
        branches.push(`<path d="M ${r1(px)} ${r1(py)} C ${r1(mx)} ${r1(py)} ${r1(mx)} ${r1(cy)} ${r1(cx)} ${r1(cy)}" fill="none" stroke="${color}" stroke-width="${it.depth === 1 ? 3 : 2}" stroke-linecap="round"/>`);
      }
      const shape = it.node.shape;
      if (it.depth === 0) {
        nodes.push(shapeSvg(shape === 'default' ? 'roundrect' : shape === 'hexagon' ? 'hexagon-mind' : shape === 'rect' ? 'rect' : shape, b, color, color));
        nodes.push(textSvg(it.node.text, b.x + b.w / 2, b.y + b.h / 2, it.font, '#ffffff', ' font-weight="600"'));
      } else {
        if (shape === 'default') nodes.push(`<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.w)}" height="${r1(b.h)}" rx="8" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-width="1.5"/>`);
        else nodes.push(shapeSvg(shape === 'hexagon' ? 'hexagon-mind' : shape, b, theme.fill, color));
        nodes.push(textSvg(it.node.text, b.x + b.w / 2, b.y + b.h / 2, it.font, theme.text));
      }
    }
    return { inner: branches.join('') + nodes.join(''), width: lay.width + 2 * MARGIN, height: lay.height + 2 * MARGIN };
  }

  function sequenceSvg(lay, theme, prefix) {
    const ox = MARGIN; const oy = MARGIN;
    const parts = [];
    for (const p of lay.participants) {
      parts.push(`<path d="M ${r1(p.cx + ox)} ${r1(lay.lifeline.top + oy)} V ${r1(lay.lifeline.bottom + oy)}" stroke="${theme.lifeline}" stroke-width="1.5" stroke-dasharray="5 5"/>`);
    }
    for (const p of lay.participants) {
      const b = { x: p.x + ox, y: p.y + oy, w: p.w, h: p.h };
      if (p.kind === 'actor') {
        parts.push(shapeSvg('actor', b, theme.fill, theme.stroke));
        parts.push(textSvg(p.label, b.x + b.w / 2, b.y + 56 + (b.h - 56) / 2, NODE_FONT, theme.text));
      } else {
        parts.push(shapeSvg('rect', b, theme.fill, theme.stroke));
        parts.push(textSvg(p.label, b.x + b.w / 2, b.y + b.h / 2, NODE_FONT, theme.text));
      }
    }
    for (const m of lay.messages) {
      const y = m.y + oy; const x1 = m.x1 + ox; const x2 = m.x2 + ox;
      const dash = m.line === 'dotted' ? ' stroke-dasharray="6 5"' : '';
      const end = m.arrow === 'both' ? 'arrow' : m.arrow;
      const start = m.arrow === 'both' ? 'arrow' : 'none';
      const d = m.self ? `M ${r1(x1)} ${r1(y)} H ${r1(x1 + 40)} V ${r1(y + 26)} H ${r1(x1 + 2)}` : `M ${r1(x1)} ${r1(y)} H ${r1(x2)}`;
      parts.push(`<path d="${d}" fill="none" stroke="${theme.edge}" stroke-width="2"${dash} stroke-linejoin="round"${markerAttr(prefix, 'start', start)}${markerAttr(prefix, 'end', end)}/>`);
      if (m.label) {
        const lines = m.label.split('\n');
        const cx = m.self ? x1 + 8 : (x1 + x2) / 2;
        const anchor = m.self ? 'start' : 'middle';
        const spans = lines.map((line, i) => `<tspan x="${r1(cx)}" y="${r1(y - 8 - (lines.length - 1 - i) * LABEL_LINE_H)}">${esc(line) || ' '}</tspan>`).join('');
        parts.push(`<text text-anchor="${anchor}" font-size="${LABEL_FONT}" fill="${theme.text}">${spans}</text>`);
      }
    }
    return { inner: markersSvg(prefix, theme.edge) + parts.join(''), width: lay.width + 2 * MARGIN, height: lay.height + 2 * MARGIN };
  }

  function errorSvg(message, theme) {
    const text = str(message).slice(0, 160);
    const w = Math.max(240, Math.min(720, textWidth(text, LABEL_FONT) + 40)); const h = 64;
    const inner = `<rect x="1" y="1" width="${r1(w - 2)}" height="${h - 2}" rx="8" fill="${theme.fill}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="6 4"/>`
      + `<text x="${r1(w / 2)}" y="${h / 2}" text-anchor="middle" dominant-baseline="central" font-size="${LABEL_FONT}" fill="${theme.text}">${esc(text)}</text>`;
    return { svg: wrapSvg(w, h, inner, text), width: Math.ceil(w), height: h, error: str(message) };
  }

  function toSvg(source, options = { dark: false }) {
    const theme = isObject(options) && options.dark ? THEMES.dark : THEMES.light;
    try {
      const graph = parse(source);
      if (graph.error) return errorSvg(graph.error, theme);
      const lay = layout(graph);
      if (lay.error) return errorSvg(lay.error, theme);
      svgCounter = (svgCounter + 1) % 1e9;
      const prefix = `opm${svgCounter.toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
      const out = graph.type === 'mindmap' ? mindSvg(lay, theme) : graph.type === 'sequence' ? sequenceSvg(lay, theme, prefix) : flowSvg(graph, lay, theme, prefix);
      const width = Math.ceil(out.width); const height = Math.ceil(out.height);
      const name = graph.type === 'mindmap' ? 'Carte mentale Mermaid' : graph.type === 'sequence' ? 'Diagramme de séquence Mermaid' : 'Organigramme Mermaid';
      return { svg: wrapSvg(width, height, out.inner, name), width, height, error: null };
    } catch (error) {
      return errorSvg(`Rendu Mermaid impossible : ${failure(error)}`, theme);
    }
  }

  return { parse, layout, toElements, toSvg, cleanLabel, nodeSize, FLOW_SHAPES };
});
