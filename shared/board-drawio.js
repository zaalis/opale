// Opale — moodboards: import of draw.io (diagrams.net) files. A ".drawio"
// file is XML: <mxfile> holds one <diagram> per page, and each page is an
// <mxGraphModel> (sometimes compressed: base64 of deflate-raw of the
// URI-encoded XML). Cells become board elements: vertices turn into shapes,
// texts and frames, edges into connectors. No DOMParser: a small tolerant XML
// reader below works the same in Node and in the browser. Nothing here
// throws on bad input; problems come back as `{ error }` or `warnings`.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./board.js'));
  else root.OpaleBoardDrawio = factory(root.OpaleBoard);
})(typeof self !== 'undefined' ? self : this, function (Board) {
  'use strict';

  const NOT_DRAWIO = 'Ce fichier n’est pas un diagramme draw.io.';
  const MAX_CELLS = 50000;
  const MAX_INFLATED = 64 * 1024 * 1024;
  const PAGE_GAP = 200;
  const PAGE_PAD = 40;

  const str = (value) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value));
  const num = (value, fallback) => {
    const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
    return Number.isFinite(n) ? n : fallback;
  };

  // ------------------------------------------------------------ entities
  const XML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' };
  const HTML_ENTITIES = {
    ...XML_ENTITIES, nbsp: ' ', laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', euro: '€', copy: '©', reg: '®', deg: '°', middot: '·', bull: '•',
  };

  function decodeEntities(text, table = XML_ENTITIES) {
    if (text.indexOf('&') < 0) return text;
    return text.replace(/&(#[xX][0-9a-fA-F]{1,8}|#[0-9]{1,10}|[a-zA-Z][a-zA-Z0-9]{0,15});/g, (match, body) => {
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
        return String.fromCodePoint(code);
      }
      return Object.prototype.hasOwnProperty.call(table, body) ? table[body] : match;
    });
  }

  // ---------------------------------------------------------- XML reader
  // A tolerant reader: elements (name, attributes, child elements, decoded
  // text), with the source offsets of each element so a sub-tree can be cut
  // out of the text as it was. Comments, processing instructions and the
  // doctype are skipped; CDATA becomes text. Unclosed elements end with the
  // input; a stray closing tag is ignored. Only a tag cut off by the end of
  // the input is an error.
  function parseXml(text) {
    const src = str(text);
    const n = src.length;
    const doc = { name: '#document', attrs: Object.create(null), children: [], text: '', start: 0, end: n };
    const stack = [doc];
    let cur = doc;
    let i = 0;
    const addText = (value) => { if (value) cur.text += value; };
    try {
      while (i < n) {
        const lt = src.indexOf('<', i);
        if (lt < 0) { addText(decodeEntities(src.slice(i))); break; }
        if (lt > i) addText(decodeEntities(src.slice(i, lt)));
        if (src.startsWith('<!--', lt)) {
          const end = src.indexOf('-->', lt + 4);
          i = end < 0 ? n : end + 3;
          continue;
        }
        if (src.startsWith('<![CDATA[', lt)) {
          const end = src.indexOf(']]>', lt + 9);
          addText(src.slice(lt + 9, end < 0 ? n : end));
          i = end < 0 ? n : end + 3;
          continue;
        }
        if (src[lt + 1] === '?') {
          const end = src.indexOf('?>', lt + 2);
          i = end < 0 ? n : end + 2;
          continue;
        }
        if (src[lt + 1] === '!') {
          // Doctype or other declaration, possibly with an internal subset.
          let j = lt + 2; let depth = 0; let quote = '';
          for (; j < n; j++) {
            const c = src[j];
            if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === '\'') quote = c;
            else if (c === '[') depth++;
            else if (c === ']') depth = Math.max(0, depth - 1);
            else if (c === '>' && depth === 0) break;
          }
          i = j + 1;
          continue;
        }
        if (src[lt + 1] === '/') {
          const end = src.indexOf('>', lt + 2);
          if (end < 0) return { root: null, error: 'XML invalide : balise fermante non terminée.' };
          const name = src.slice(lt + 2, end).trim();
          for (let k = stack.length - 1; k > 0; k--) {
            if (stack[k].name !== name) continue;
            for (let m = stack.length - 1; m >= k; m--) stack[m].end = end + 1;
            stack.length = k;
            cur = stack[k - 1];
            break;
          }
          i = end + 1;
          continue;
        }
        // Opening tag.
        const nameMatch = /^[A-Za-z_:][-A-Za-z0-9_:.]*/.exec(src.slice(lt + 1, lt + 201));
        if (!nameMatch) { addText('<'); i = lt + 1; continue; }
        const el = { name: nameMatch[0], attrs: Object.create(null), children: [], text: '', start: lt, end: n };
        let j = lt + 1 + nameMatch[0].length;
        let closed = false; let selfClosing = false;
        while (j < n) {
          const c = src[j];
          if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { j++; continue; }
          if (c === '>') { closed = true; j++; break; }
          if (c === '/' && src[j + 1] === '>') { closed = true; selfClosing = true; j += 2; break; }
          if (c === '/') { j++; continue; }
          let k = j;
          while (k < n && !/[\s=/>]/.test(src[k])) k++;
          const attrName = src.slice(j, k);
          j = k;
          while (j < n && /\s/.test(src[j])) j++;
          let value = '';
          if (src[j] === '=') {
            j++;
            while (j < n && /\s/.test(src[j])) j++;
            const q = src[j];
            if (q === '"' || q === '\'') {
              const close = src.indexOf(q, j + 1);
              if (close < 0) return { root: null, error: 'XML invalide : valeur d’attribut non terminée.' };
              value = src.slice(j + 1, close);
              j = close + 1;
            } else {
              let e = j;
              while (e < n && !/[\s>]/.test(src[e]) && !(src[e] === '/' && src[e + 1] === '>')) e++;
              value = src.slice(j, e);
              j = e;
            }
          }
          if (attrName) el.attrs[attrName] = decodeEntities(value);
        }
        if (!closed) return { root: null, error: 'XML invalide : balise non terminée.' };
        cur.children.push(el);
        if (selfClosing) el.end = j;
        else { stack.push(el); cur = el; }
        i = j;
      }
    } catch (error) {
      return { root: null, error: `XML illisible : ${error && error.message ? error.message : error}` };
    }
    return { root: doc, error: null };
  }

  function firstElement(node) { return node && node.children.length ? node.children[0] : null; }
  function childNamed(node, name) { return node ? node.children.find((child) => child.name === name) || null : null; }
  function findDeep(node, name, depth = 0) {
    if (!node || depth > 64) return null;
    if (node.name === name) return node;
    for (const child of node.children) { const hit = findDeep(child, name, depth + 1); if (hit) return hit; }
    return null;
  }

  // ------------------------------------------------------------- decode
  function base64Bytes(text) {
    const clean = text.replace(/\s+/g, '');
    if (!clean || !/^[A-Za-z0-9+/]+=*$/.test(clean)) return null;
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('DecompressionStream indisponible');
    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    const reader = stream.readable.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_INFLATED) { reader.cancel().catch(() => {}); throw new Error('contenu trop volumineux'); }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
    return new TextDecoder('utf-8').decode(out);
  }

  // One <diagram> element -> the XML of its <mxGraphModel>.
  async function diagramXml(diagram, src) {
    const model = findDeep(diagram, 'mxGraphModel');
    if (model) return src.slice(model.start, model.end);
    const content = diagram.text.trim();
    if (!content) return '';
    if (content[0] === '<') return content;
    const bytes = base64Bytes(content);
    if (!bytes) throw new Error('contenu compressé illisible');
    const inflated = await inflateRaw(bytes);
    let xml = inflated;
    try { xml = decodeURIComponent(inflated); } catch { xml = inflated; }
    return xml;
  }

  async function decode(text) {
    const fail = (error) => ({ xml: '', pages: [], error });
    try {
      const src = str(text).replace(/^﻿/, '');
      if (!src.trim() || src.indexOf('<') < 0) return fail(NOT_DRAWIO);
      const { root, error } = parseXml(src);
      if (error) return fail(error);
      const top = firstElement(root);
      if (!top) return fail(NOT_DRAWIO);
      const pages = [];
      if (top.name === 'mxGraphModel') {
        pages.push({ name: 'Page-1', xml: src.slice(top.start, top.end) });
      } else if (top.name === 'mxfile' || top.name === 'diagram') {
        const diagrams = top.name === 'diagram' ? [top] : top.children.filter((child) => child.name === 'diagram');
        if (!diagrams.length) return fail(NOT_DRAWIO);
        for (let index = 0; index < diagrams.length; index++) {
          const diagram = diagrams[index];
          const name = str(diagram.attrs.name).trim() || `Page-${index + 1}`;
          let xml;
          try { xml = await diagramXml(diagram, src); } catch (err) {
            return fail(`Page « ${name} » illisible : ${err && err.message ? err.message : err}`);
          }
          pages.push({ name, xml });
        }
      } else {
        return fail(NOT_DRAWIO);
      }
      return { xml: pages[0].xml, pages, error: null };
    } catch (err) {
      return fail(`Fichier draw.io illisible : ${err && err.message ? err.message : err}`);
    }
  }

  // -------------------------------------------------------------- styles
  // "rounded=1;whiteSpace=wrap;ellipse;" -> { rounded: '1', whiteSpace: 'wrap', ellipse: true, _names: ['ellipse'] }
  function parseStyle(style) {
    const out = Object.create(null);
    out._names = [];
    for (const part of str(style).split(';')) {
      const token = part.trim();
      if (!token) continue;
      const eq = token.indexOf('=');
      if (eq < 0) { out._names.push(token); out[token] = true; } else out[token.slice(0, eq).trim()] = token.slice(eq + 1).trim();
    }
    return out;
  }

  // Label HTML (html=1) -> plain text with newlines.
  function htmlToText(html) {
    let text = str(html);
    text = text.replace(/<(script|style)\b[^]*?<\/\1\s*>/gi, '');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/?(div|p|li|tr|h[1-6]|ul|ol|table)\b[^>]*>/gi, '\n');
    text = text.replace(/<[^>]*>/g, '');
    text = decodeEntities(text, HTML_ENTITIES);
    return text.split('\n').map((line) => line.replace(/[ \t]+$/g, '')).join('\n').replace(/\n{2,}/g, '\n').trim();
  }

  function labelOf(value, style) {
    const text = str(value);
    return style.html === '1' ? htmlToText(text) : text.trim();
  }

  // A draw.io colour -> a board colour, or '' to keep the board default.
  function colorOf(value) {
    const text = str(value).trim();
    if (!text || text === 'default' || text === 'inherit') return '';
    if (text === 'none') return 'transparent';
    return Board.color(text.toLowerCase());
  }

  const SHAPES = {
    rect: 'rect', rectangle: 'rect', label: 'rect', ellipse: 'ellipse', rhombus: 'diamond', triangle: 'triangle',
    hexagon: 'hexagon', cylinder: 'cylinder', cylinder2: 'cylinder', cylinder3: 'cylinder', datastore: 'cylinder',
    parallelogram: 'parallelogram', trapezoid: 'trapezoid', cloud: 'cloud', doubleEllipse: 'double-circle',
    process: 'subroutine', document: 'document', step: 'chevron', note: 'note', note2: 'note', actor: 'actor',
    umlActor: 'actor', card: 'card', callout: 'speech-rect',
  };
  const FLOWCHART = {
    process: 'rect', decision: 'diamond', terminator: 'stadium', data: 'parallelogram', document: 'document',
    database: 'cylinder', predefined_process: 'subroutine', manual_input: 'manual-input', delay: 'delay',
    display: 'display', preparation: 'hexagon', 'off-page_reference': 'off-page', on_page_reference: 'ellipse',
    or: 'or', summing_function: 'summing-junction', start_1: 'ellipse', start_2: 'ellipse', merge_or_storage: 'merge',
    extract_or_measurement: 'triangle', stored_data: 'stored-data', internal_storage: 'internal-storage',
    loop_limit: 'loop-limit', card: 'card', paper_tape: 'punched-tape', sort: 'sort', collate: 'collate',
    'multi-document': 'multi-document',
  };
  const SPECIAL = new Set(['text', 'swimlane', 'group', 'image', 'edgeLabel']);

  // The draw.io shape name of a style ('' when it is a plain rectangle).
  function shapeName(style) {
    if (style.shape && style.shape !== true) return str(style.shape);
    for (const name of style._names) if (SHAPES[name] || SPECIAL.has(name)) return name;
    return '';
  }

  const ARROW_NONE = new Set(['none', '']);
  const ARROW_CIRCLE = new Set(['oval', 'circle', 'circlePlus', 'halfCircle']);
  function arrowOf(value, fallback) {
    if (value === undefined || value === true) return fallback;
    const name = str(value).trim();
    if (ARROW_NONE.has(name)) return 'none';
    if (ARROW_CIRCLE.has(name)) return 'circle';
    if (/^diamond|^ER/.test(name)) return 'diamond';
    return 'arrow';
  }

  // -------------------------------------------------------------- cells
  function readCells(model) {
    const rootNode = childNamed(model, 'root') || model;
    const cells = [];
    const take = (cellNode, wrapper) => {
      const a = cellNode.attrs;
      const id = str(wrapper ? wrapper.attrs.id || a.id : a.id);
      const geoNode = childNamed(cellNode, 'mxGeometry');
      let geo = null;
      if (geoNode) {
        const g = geoNode.attrs;
        geo = { x: num(g.x, 0), y: num(g.y, 0), w: num(g.width, 0), h: num(g.height, 0), relative: g.relative === '1', points: {}, waypoints: [] };
        for (const child of geoNode.children) {
          if (child.name === 'mxPoint' && (child.attrs.as === 'sourcePoint' || child.attrs.as === 'targetPoint')) {
            geo.points[child.attrs.as] = { x: num(child.attrs.x, 0), y: num(child.attrs.y, 0) };
          } else if (child.name === 'Array' && child.attrs.as === 'points') {
            for (const p of child.children) if (p.name === 'mxPoint') geo.waypoints.push({ x: num(p.attrs.x, 0), y: num(p.attrs.y, 0) });
          }
        }
      }
      cells.push({
        id, parent: str(a.parent), value: wrapper ? str(wrapper.attrs.label) : str(a.value), styleText: str(a.style),
        vertex: a.vertex === '1', edge: a.edge === '1', source: str(a.source), target: str(a.target), geo,
      });
    };
    for (const node of rootNode.children) {
      if (node.name === 'mxCell') take(node, null);
      else if (node.name === 'UserObject' || node.name === 'object') {
        const inner = childNamed(node, 'mxCell');
        if (inner) take(inner, node);
      }
      if (cells.length > MAX_CELLS) break;
    }
    return cells;
  }

  function toElements(xml, origin = { x: 0, y: 0 }) {
    const warnings = [];
    const fail = (error) => ({ elements: [], warnings, error });
    try {
      const src = str(xml);
      if (!src.trim()) return fail(NOT_DRAWIO);
      const { root, error } = parseXml(src);
      if (error) return fail(error);
      const model = findDeep(root, 'mxGraphModel');
      if (!model) return fail(NOT_DRAWIO);
      const cells = readCells(model);
      if (cells.length > MAX_CELLS) return fail('Diagramme trop volumineux pour être importé.');
      const byId = new Map();
      for (const cell of cells) if (cell.id && !byId.has(cell.id)) byId.set(cell.id, cell);
      for (const cell of cells) cell.style = parseStyle(cell.styleText);

      // Labels living on an edge belong to that connector.
      const edgeLabels = new Map();
      const isEdgeLabel = (cell) => cell.vertex && byId.has(cell.parent) && byId.get(cell.parent).edge;
      for (const cell of cells) {
        if (!isEdgeLabel(cell)) continue;
        const text = labelOf(cell.value, cell.style);
        if (!text) continue;
        if (!edgeLabels.has(cell.parent)) edgeLabels.set(cell.parent, []);
        edgeLabels.get(cell.parent).push(text);
      }

      // Absolute boxes: geometry is relative to a parent vertex.
      const boxes = new Map();
      const boxOf = (cell, depth = 0) => {
        if (boxes.has(cell.id)) return boxes.get(cell.id);
        const geo = cell.geo || { x: 0, y: 0, w: 120, h: 60, relative: false };
        const parent = byId.get(cell.parent);
        let px = 0; let py = 0;
        let box;
        if (parent && parent.vertex && parent !== cell && depth < 100) {
          const pb = boxOf(parent, depth + 1);
          px = pb.x; py = pb.y;
          box = geo.relative
            ? { x: px + geo.x * pb.w, y: py + geo.y * pb.h, w: geo.w, h: geo.h }
            : { x: px + geo.x, y: py + geo.y, w: geo.w, h: geo.h };
        } else {
          box = { x: geo.x, y: geo.y, w: geo.w, h: geo.h };
        }
        boxes.set(cell.id, box);
        return box;
      };
      const offsetOf = (cell) => {
        const parent = byId.get(cell.parent);
        return parent && parent.vertex ? boxOf(parent) : { x: 0, y: 0 };
      };

      // New ids for every vertex that becomes an element.
      const vertices = cells.filter((cell) => cell.vertex && !isEdgeLabel(cell));
      const newIds = new Map();
      for (const cell of vertices) if (cell.id && !newIds.has(cell.id)) newIds.set(cell.id, Board.newId());

      const parents = new Set(vertices.map((cell) => cell.parent));
      const unknown = new Set();
      const elements = [];
      const emitted = new Set();

      const shapeStyle = (s) => {
        const style = {};
        const fill = colorOf(s.fillColor); if (fill) style.fill = fill;
        const stroke = colorOf(s.strokeColor); if (stroke) style.stroke = stroke;
        style.strokeWidth = Math.max(0, num(s.strokeWidth, 1));
        if (s.dashed === '1') style.dash = 'dashed';
        return style;
      };
      const textStyle = (s, style, defaultAlign) => {
        const fontColor = colorOf(s.fontColor); if (fontColor) style.color = fontColor;
        style.fontSize = Math.max(1, num(s.fontSize, 12));
        style.align = ['left', 'center', 'right'].includes(s.align) ? s.align : defaultAlign;
        const fontStyle = num(s.fontStyle, 0);
        if (fontStyle & 1) style.bold = true;
        if (fontStyle & 2) style.italic = true;
        return style;
      };

      const emitVertex = (cell, depth = 0) => {
        if (emitted.has(cell)) return;
        emitted.add(cell);
        // Containers before their children.
        const parent = byId.get(cell.parent);
        if (parent && parent.vertex && depth < 100 && !emitted.has(parent) && !isEdgeLabel(parent)) emitVertex(parent, depth + 1);
        const s = cell.style;
        const box = boxOf(cell);
        const label = labelOf(cell.value, s);
        const name = shapeName(s);
        const rotation = num(s.rotation, 0);
        const opacity = s.opacity !== undefined ? Math.max(0, Math.min(1, num(s.opacity, 100) / 100)) : undefined;
        const base = { id: newIds.get(cell.id) || Board.newId(), x: box.x, y: box.y, w: box.w, h: box.h, rotation };
        const hasChildren = parents.has(cell.id);
        if (name === 'swimlane' || name === 'group' || s.container === '1') {
          const style = {};
          const fill = colorOf(name === 'swimlane' ? s.swimlaneFillColor : s.fillColor); if (fill) style.fill = fill;
          const stroke = colorOf(s.strokeColor); if (stroke) style.stroke = stroke;
          elements.push(Board.create('frame', { ...base, style, data: { title: label } }));
          return;
        }
        const noBox = s.strokeColor === 'none' && s.fillColor === 'none';
        if (name === 'text' || (noBox && label && !hasChildren && name !== 'image')) {
          const style = textStyle(s, {}, 'center');
          if (opacity !== undefined) style.opacity = opacity;
          elements.push(Board.create('text', { ...base, style, data: { text: label } }));
          return;
        }
        const style = textStyle(s, shapeStyle(s), 'center');
        if (['top', 'middle', 'bottom'].includes(s.verticalAlign)) style.valign = s.verticalAlign;
        if (opacity !== undefined) style.opacity = opacity;
        if (name === 'image') {
          const source = str(s.image === true ? '' : s.image);
          const shown = source.length > 80 ? `${source.slice(0, 77)}…` : source;
          warnings.push(`Image non importée : ${shown || 'image sans source'}`);
          elements.push(Board.create('shape', { ...base, style, data: { shape: 'rect', text: label ? `[image]\n${label}` : '[image]' } }));
          return;
        }
        let shape;
        if (!name) shape = 'rect';
        else if (name.startsWith('mxgraph.flowchart.')) shape = FLOWCHART[name.slice('mxgraph.flowchart.'.length)];
        else shape = SHAPES[name];
        if (!shape) {
          if (!unknown.has(name)) { unknown.add(name); warnings.push(`Forme inconnue remplacée par un rectangle : ${name}`); }
          shape = 'rect';
        }
        if (shape === 'rect' && s.rounded === '1') shape = 'roundrect';
        if (shape === 'ellipse' && s.aspect === 'fixed' && Math.abs(box.w - box.h) <= Math.max(1, 0.02 * Math.max(box.w, box.h))) shape = 'circle';
        elements.push(Board.create('shape', { ...base, style, data: { shape, text: label } }));
      };

      const emitEdge = (cell) => {
        const s = cell.style;
        const geo = cell.geo || { points: {}, waypoints: [] };
        const offset = offsetOf(cell);
        const end = (which) => {
          const ref = which === 'source' ? cell.source : cell.target;
          if (ref && newIds.has(ref)) return { id: newIds.get(ref) };
          const point = geo.points[which === 'source' ? 'sourcePoint' : 'targetPoint']
            || (geo.waypoints.length ? geo.waypoints[which === 'source' ? 0 : geo.waypoints.length - 1] : { x: 0, y: 0 });
          return { x: point.x + offset.x, y: point.y + offset.y };
        };
        const style = {
          path: s.curved === '1' ? 'curve' : (s.edgeStyle && /^(orthogonalEdgeStyle|elbowEdgeStyle|entityRelationEdgeStyle|isometricEdgeStyle)$/.test(s.edgeStyle) ? 'elbow' : 'straight'),
          start: arrowOf(s.startArrow, 'none'),
          end: arrowOf(s.endArrow, 'arrow'),
          width: Math.max(0, num(s.strokeWidth, 1)),
        };
        const stroke = colorOf(s.strokeColor); if (stroke) style.color = stroke;
        if (s.dashed === '1') style.dash = 'dashed';
        const label = [labelOf(cell.value, s), ...(edgeLabels.get(cell.id) || [])].filter(Boolean).join('\n');
        elements.push(Board.create('connector', { id: Board.newId(), style, data: { label }, from: end('source'), to: end('target') }));
      };

      for (const cell of cells) {
        if (cell.vertex && !isEdgeLabel(cell)) emitVertex(cell);
        else if (cell.edge) emitEdge(cell);
      }

      // Move the whole drawing so its top-left lands on `origin`.
      let minX = Infinity; let minY = Infinity;
      for (const el of elements) {
        if (el.kind === 'connector') {
          for (const e of [el.from, el.to]) if (!e.id) { minX = Math.min(minX, e.x); minY = Math.min(minY, e.y); }
        } else {
          const b = Board.bounds(el);
          minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        }
      }
      if (Number.isFinite(minX)) {
        const dx = num(origin && origin.x, 0) - minX; const dy = num(origin && origin.y, 0) - minY;
        for (const el of elements) {
          if (el.kind === 'connector') {
            for (const e of [el.from, el.to]) if (!e.id) { e.x += dx; e.y += dy; }
          } else { el.x += dx; el.y += dy; }
        }
      }
      return { elements, warnings, error: null };
    } catch (err) {
      return fail(`Diagramme draw.io illisible : ${err && err.message ? err.message : err}`);
    }
  }

  // The box around imported elements (connector free ends included).
  function extent(elements) {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const el of elements) {
      const boxes = el.kind === 'connector'
        ? [el.from, el.to].filter((e) => !e.id).map((e) => ({ x: e.x, y: e.y, w: 0, h: 0 }))
        : [Board.bounds(el)];
      for (const b of boxes) {
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
      }
    }
    return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 };
  }

  // decode + toElements. Several pages are laid out side by side, each in a
  // frame named after its page.
  async function importText(text, origin = { x: 0, y: 0 }) {
    try {
      const decoded = await decode(text);
      if (decoded.error) return { elements: [], warnings: [], error: decoded.error };
      const ox = num(origin && origin.x, 0); const oy = num(origin && origin.y, 0);
      if (decoded.pages.length === 1) return toElements(decoded.pages[0].xml, { x: ox, y: oy });
      const elements = []; const warnings = [];
      let cursor = ox;
      for (const page of decoded.pages) {
        const result = toElements(page.xml, { x: cursor + PAGE_PAD, y: oy + PAGE_PAD });
        if (result.error) { warnings.push(`Page « ${page.name} » ignorée : ${result.error}`); continue; }
        for (const warning of result.warnings) warnings.push(`${page.name} : ${warning}`);
        const box = extent(result.elements);
        const w = Math.max(200, box.w + PAGE_PAD * 2); const h = Math.max(140, box.h + PAGE_PAD * 2);
        elements.push(Board.create('frame', { x: cursor, y: oy, w, h, data: { title: page.name } }), ...result.elements);
        cursor += w + PAGE_GAP;
      }
      if (!elements.length) return { elements, warnings, error: warnings[0] || NOT_DRAWIO };
      return { elements, warnings, error: null };
    } catch (err) {
      return { elements: [], warnings: [], error: `Fichier draw.io illisible : ${err && err.message ? err.message : err}` };
    }
  }

  return { decode, toElements, importText, parseXml, parseStyle, htmlToText, decodeEntities };
});
