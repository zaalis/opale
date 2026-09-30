// Opale — graph of the vault: notes are nodes, links are edges, laid out by a
// small force simulation and drawn on a canvas. Also used, centred on one
// note, as the "local graph" of the right panel.
import { api, app, bus, debounce, h, iconButton, Meta } from './core.js';
import { store } from './store.js';

const CELL = 280;

export class GraphView {
  constructor(options = {}) {
    this.type = 'graph';
    this.local = !!options.local;
    this.center = options.center || '';
    this.nodes = []; this.edges = []; this.byId = new Map();
    this.view = { x: 0, y: 0, k: this.local ? 0.9 : 0.8 };
    this.alpha = 1; this.hover = null; this.drag = null; this.frame = 0; this.filter = '';
    this.size = { width: 0, height: 0 }; this.fitted = false;
    this.canvas = h('canvas.graph-canvas', { tabIndex: 0, 'aria-label': 'Graphe des notes' });
    this.context = this.canvas.getContext('2d');
    this.el = h(`div.view.graph-view${this.local ? '.local' : ''}`);
    if (!this.local) {
      const back = iconButton('back', 'Précédent (Alt+←)', () => app.workspace.back());
      const forward = iconButton('forward', 'Suivant (Alt+→)', () => app.workspace.forward());
      this.count = h('span.graph-count');
      this.header = h('div.view-header', h('div.view-nav', back, forward), h('div.view-crumbs', h('span.crumb.current', 'Graphe'), this.count), h('div.view-actions', iconButton('locate', 'Recentrer le graphe', () => { this.moved = false; this.fit(); })));
      this.header.update = () => { back.disabled = !app.workspace.canGo(-1); forward.disabled = !app.workspace.canGo(1); };
      this.el.append(this.header);
    }
    this.stage = h('div.graph-stage', this.canvas);
    if (!this.local) this.stage.append(this.controls());
    this.el.append(this.stage);
    this.bind();
    this.rebuildSoon = debounce(() => this.rebuild(), 200);
    this.off = [bus.on('index', () => this.rebuildSoon()), bus.on('settings', () => { this.readColours(); this.rebuild(); }), bus.on('active-view', () => this.draw())];
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.stage);
    this.rebuild();
  }

  updateHeader() { if (this.header) this.header.update(); }
  onShow() { this.resize(); this.kick(0.3); }

  controls() {
    const settings = () => app.settings.graph || {};
    const save = debounce(() => api('/api/settings', { method: 'PUT', body: { graph: app.settings.graph } }).catch(() => {}), 400);
    const change = (key, value, reheat) => { app.settings.graph = { ...settings(), [key]: value }; save(); this.rebuild(); if (reheat) this.kick(0.6); };
    const toggle = (key, label) => {
      const input = h('input', { type: 'checkbox', checked: !!settings()[key], onChange: () => change(key, input.checked, true) });
      return h('label.graph-toggle', input, h('span', label));
    };
    const slider = (key, label) => {
      const input = h('input', { type: 'range', min: '0', max: '100', value: String(settings()[key] ?? 50), 'aria-label': label, onInput: () => change(key, Number(input.value), true) });
      return h('label.graph-slider', h('span', label), input);
    };
    const filter = h('input.text-input.small', { type: 'search', placeholder: 'Filtrer les notes…', 'aria-label': 'Filtrer le graphe', onInput: () => { this.filter = filter.value.trim().toLowerCase(); this.rebuild(); } });
    const panel = h('div.graph-controls',
      h('div.graph-controls-title', 'Filtres'), filter,
      toggle('tags', 'Étiquettes'), toggle('attachments', 'Pièces jointes'), toggle('unresolved', 'Notes non créées'), toggle('orphans', 'Notes orphelines'),
      h('div.graph-controls-title', 'Forces'), slider('repel', 'Répulsion'), slider('link', 'Distance des liens'), slider('center', 'Gravité'));
    const wrap = h('div.graph-controls-wrap');
    const button = iconButton('settings', 'Réglages du graphe', () => wrap.classList.toggle('open'), '.graph-controls-toggle');
    wrap.append(button, panel);
    return wrap;
  }

  readColours() {
    const style = getComputedStyle(this.el);
    const get = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    this.colours = {
      node: get('--graph-node', '#9a97ab'), active: get('--accent', '#8b7cf6'), tag: get('--graph-tag', '#34d399'),
      attachment: get('--graph-attachment', '#f59e0b'), unresolved: get('--graph-unresolved', '#5b586a'),
      line: get('--graph-line', 'rgba(150,150,170,.22)'), text: get('--text-1', '#c9c6d6'), dim: get('--graph-dim', 'rgba(150,150,170,.12)'),
    };
  }

  // ------------------------------------------------------------------ data
  rebuild() {
    const options = app.settings.graph || {};
    const previous = this.byId;
    const nodes = new Map(); const edges = new Map();
    const add = (id, label, kind, path) => {
      if (!nodes.has(id)) nodes.set(id, { id, label, kind, path, degree: 0, x: 0, y: 0, vx: 0, vy: 0, fresh: true });
      return nodes.get(id);
    };
    const connect = (a, b) => {
      if (a === b) return;
      const key = a < b ? `${a}\n${b}` : `${b}\n${a}`;
      if (!edges.has(key)) edges.set(key, { a, b });
    };
    for (const note of store.notes()) {
      add(note.path, Meta.stem(note.path), 'note', note.path);
      for (const link of note.meta.links) {
        if (!link.target) continue;
        const target = store.resolve(link.target, note.path);
        if (target) {
          const kind = Meta.kindOf(target) === 'note' ? 'note' : 'attachment';
          if (kind === 'attachment' && !options.attachments) continue;
          add(target, kind === 'note' ? Meta.stem(target) : Meta.baseName(target), kind, target);
          connect(note.path, target);
        } else if (options.unresolved) {
          const id = `?${link.target.toLowerCase()}`;
          add(id, Meta.baseName(link.target), 'unresolved', link.target);
          connect(note.path, id);
        }
      }
      if (options.tags) for (const tag of note.meta.tags) { add(`#${tag.toLowerCase()}`, `#${tag}`, 'tag', tag); connect(note.path, `#${tag.toLowerCase()}`); }
    }
    let keep = new Set(nodes.keys());
    if (this.local) {
      keep = new Set(this.center && nodes.has(this.center) ? [this.center] : []);
      for (const edge of edges.values()) { if (edge.a === this.center) keep.add(edge.b); if (edge.b === this.center) keep.add(edge.a); }
    } else if (this.filter) {
      keep = new Set([...nodes.values()].filter((node) => node.label.toLowerCase().includes(this.filter)).map((node) => node.id));
    }
    const kept = [...edges.values()].filter((edge) => keep.has(edge.a) && keep.has(edge.b));
    for (const edge of kept) { nodes.get(edge.a).degree++; nodes.get(edge.b).degree++; }
    if (!this.local && !options.orphans) for (const id of [...keep]) if (!nodes.get(id).degree) keep.delete(id);

    this.nodes = [...keep].map((id) => nodes.get(id));
    this.byId = new Map(this.nodes.map((node) => [node.id, node]));
    this.edges = kept.map((edge) => ({ a: this.byId.get(edge.a), b: this.byId.get(edge.b) })).filter((edge) => edge.a && edge.b);
    this.neighbours = new Map(this.nodes.map((node) => [node.id, new Set()]));
    for (const edge of this.edges) { this.neighbours.get(edge.a.id).add(edge.b.id); this.neighbours.get(edge.b.id).add(edge.a.id); }

    // Keep known nodes where they were; drop new ones next to a neighbour.
    const spread = Math.sqrt(this.nodes.length + 1) * 46;
    let added = 0;
    for (const node of this.nodes) {
      const old = previous.get(node.id);
      if (old) { node.x = old.x; node.y = old.y; node.vx = old.vx; node.vy = old.vy; node.fresh = false; continue; }
      added++;
      const anchor = [...this.neighbours.get(node.id)].map((id) => previous.get(id)).find(Boolean);
      const angle = Math.random() * Math.PI * 2; const radius = anchor ? 40 : Math.sqrt(Math.random()) * spread;
      node.x = (anchor ? anchor.x : 0) + Math.cos(angle) * radius; node.y = (anchor ? anchor.y : 0) + Math.sin(angle) * radius;
    }
    if (this.count) this.count.textContent = `${this.nodes.filter((node) => node.kind === 'note').length} notes · ${this.edges.length} liens`;
    if (!this.colours) this.readColours();
    this.kick(added ? Math.min(1, 0.25 + added / Math.max(8, this.nodes.length)) : 0.05);
  }

  setCenter(path) {
    if (path === this.center) return;
    this.center = path; this.byId = new Map(); this.fitted = false; this.settled = false; this.moved = false;
    this.rebuild();
  }

  // ------------------------------------------------------------ simulation
  kick(alpha) { this.alpha = Math.max(this.alpha, alpha); if (!this.frame) this.frame = requestAnimationFrame(() => this.tick()); }

  tick() {
    this.frame = 0;
    if (!this.el.isConnected) return;
    if (!this.canvas.offsetParent) return; // hidden tab: resume on show
    if (this.alpha > 0.004) { this.step(); this.alpha *= 0.985; }
    this.draw();
    // Frame the graph once it has spread out, and again when it settles,
    // unless the user has already moved the view themselves.
    if (!this.moved && this.nodes.length && ((!this.fitted && this.alpha < 0.35) || (!this.settled && this.alpha < 0.03))) { this.settled = this.alpha < 0.03; this.fit(); }
    if (this.alpha > 0.004 || this.drag) this.frame = requestAnimationFrame(() => this.tick());
  }

  step() {
    const options = app.settings.graph || {};
    const repel = 1500 + (options.repel ?? 60) * 130;
    const length = 60 + (options.link ?? 60) * 2.6;
    const gravity = 0.0006 + (options.center ?? 40) * 0.00006;
    const alpha = this.alpha;
    const grid = new Map();
    for (const node of this.nodes) {
      const key = `${Math.floor(node.x / CELL)},${Math.floor(node.y / CELL)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(node);
    }
    for (const node of this.nodes) {
      const cx = Math.floor(node.x / CELL); const cy = Math.floor(node.y / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const cell = grid.get(`${gx},${gy}`);
        if (!cell) continue;
        for (const other of cell) {
          if (other === node) continue;
          let dx = node.x - other.x; let dy = node.y - other.y;
          let distance2 = dx * dx + dy * dy;
          if (distance2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; distance2 = 1; }
          if (distance2 > CELL * CELL) continue;
          const force = (repel / distance2) * alpha;
          const distance = Math.sqrt(distance2);
          node.vx += (dx / distance) * force; node.vy += (dy / distance) * force;
        }
      }
      node.vx -= node.x * gravity * alpha * 10; node.vy -= node.y * gravity * alpha * 10;
    }
    for (const edge of this.edges) {
      const dx = edge.b.x - edge.a.x; const dy = edge.b.y - edge.a.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const pull = ((distance - length) / distance) * 0.06 * alpha;
      edge.a.vx += dx * pull; edge.a.vy += dy * pull; edge.b.vx -= dx * pull; edge.b.vy -= dy * pull;
    }
    for (const node of this.nodes) {
      if (this.drag && this.drag.node === node) { node.vx = 0; node.vy = 0; continue; }
      node.vx *= 0.82; node.vy *= 0.82;
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > 30) { node.vx *= 30 / speed; node.vy *= 30 / speed; }
      node.x += node.vx; node.y += node.vy;
    }
  }

  // --------------------------------------------------------------- drawing
  resize() {
    const rect = this.stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = window.devicePixelRatio || 1;
    this.size = { width: rect.width, height: rect.height };
    this.canvas.width = Math.round(rect.width * ratio); this.canvas.height = Math.round(rect.height * ratio);
    this.canvas.style.width = `${rect.width}px`; this.canvas.style.height = `${rect.height}px`;
    if (this.fitted && !this.moved) this.fit(); else this.draw();
    if (!this.fitted) this.kick(0.05);
  }

  radius(node) { return (node.kind === 'tag' ? 4 : 4.5) + Math.sqrt(node.degree) * 1.6; }

  fit() {
    if (!this.nodes.length || !this.size.width) return;
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const node of this.nodes) { minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x); minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y); }
    const width = Math.max(maxX - minX, 120); const height = Math.max(maxY - minY, 120);
    const k = Math.max(0.12, Math.min(1.7, Math.min((this.size.width - 140) / width, (this.size.height - 140) / height)));
    this.view = { k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k };
    this.fitted = true;
    this.draw();
  }

  draw() {
    const context = this.context; const { width, height } = this.size;
    if (!width || !this.colours) return;
    const ratio = window.devicePixelRatio || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.translate(width / 2 + this.view.x, height / 2 + this.view.y);
    context.scale(this.view.k, this.view.k);
    const focus = this.hover || (this.drag && this.drag.node) || null;
    const near = focus ? this.neighbours.get(focus.id) : null;
    const lit = (node) => !focus || node === focus || near.has(node.id);
    const activeNote = app.workspace && app.workspace.activeNote ? app.workspace.activeNote.path : this.center;

    context.lineWidth = 1 / this.view.k;
    for (const edge of this.edges) {
      const strong = focus && (edge.a === focus || edge.b === focus);
      context.strokeStyle = strong ? this.colours.active : focus ? this.colours.dim : this.colours.line;
      context.beginPath(); context.moveTo(edge.a.x, edge.a.y); context.lineTo(edge.b.x, edge.b.y); context.stroke();
    }
    for (const node of this.nodes) {
      const colour = node.path === activeNote && node.kind === 'note' ? this.colours.active : node.kind === 'tag' ? this.colours.tag : node.kind === 'attachment' ? this.colours.attachment : node.kind === 'unresolved' ? this.colours.unresolved : this.colours.node;
      context.globalAlpha = lit(node) ? 1 : 0.18;
      context.fillStyle = node === focus ? this.colours.active : colour;
      context.beginPath(); context.arc(node.x, node.y, this.radius(node), 0, Math.PI * 2); context.fill();
    }
    // Labels appear as you zoom in; the hovered node and its neighbours always show theirs.
    const labelAlpha = this.local ? 1 : Math.max(0, Math.min(1, (this.view.k - 0.45) / 0.45));
    context.font = `${12 / this.view.k}px "Segoe UI", system-ui, sans-serif`;
    context.textAlign = 'center'; context.textBaseline = 'top';
    context.fillStyle = this.colours.text;
    for (const node of this.nodes) {
      const shown = focus ? lit(node) : labelAlpha > 0.02;
      if (!shown) continue;
      context.globalAlpha = focus ? 1 : labelAlpha;
      const label = node.label.length > 34 ? `${node.label.slice(0, 32)}…` : node.label;
      context.fillText(label, node.x, node.y + this.radius(node) + 3 / this.view.k);
    }
    context.globalAlpha = 1;
  }

  // ----------------------------------------------------------- interaction
  toWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left - this.size.width / 2 - this.view.x) / this.view.k, y: (event.clientY - rect.top - this.size.height / 2 - this.view.y) / this.view.k };
  }
  nodeAt(point) {
    let best = null; let bestDistance = Infinity;
    for (const node of this.nodes) {
      const distance = Math.hypot(node.x - point.x, node.y - point.y);
      if (distance <= this.radius(node) + 5 / this.view.k && distance < bestDistance) { best = node; bestDistance = distance; }
    }
    return best;
  }

  open(node, newTab) {
    if (node.kind === 'tag') return app.panels.searchFor(`tag:#${node.path}`);
    if (node.kind === 'unresolved') return app.workspace.openLink({ target: node.path, source: '', newTab });
    return app.workspace.openPath(node.path, { newTab });
  }

  bind() {
    const canvas = this.canvas;
    canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 0 && event.button !== 1) return;
      const point = this.toWorld(event);
      const node = this.nodeAt(point);
      this.drag = { node, startX: event.clientX, startY: event.clientY, viewX: this.view.x, viewY: this.view.y, moved: false, button: event.button };
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      const move = (moveEvent) => {
        const dx = moveEvent.clientX - this.drag.startX; const dy = moveEvent.clientY - this.drag.startY;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
        if (this.drag.node) { const world = this.toWorld(moveEvent); this.drag.node.x = world.x; this.drag.node.y = world.y; this.kick(0.3); }
        else { this.view.x = this.drag.viewX + dx; this.view.y = this.drag.viewY + dy; this.moved = true; this.draw(); }
      };
      const up = (upEvent) => {
        window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
        const drag = this.drag; this.drag = null;
        if (drag && drag.node && !drag.moved) this.open(drag.node, upEvent.ctrlKey || upEvent.metaKey || drag.button === 1);
        canvas.style.cursor = '';
        this.kick(0.02);
      };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    });
    canvas.addEventListener('mousemove', (event) => {
      if (this.drag) return;
      const node = this.nodeAt(this.toWorld(event));
      if (node !== this.hover) { this.hover = node; canvas.style.cursor = node ? 'pointer' : ''; canvas.title = node ? node.label : ''; this.draw(); }
    });
    canvas.addEventListener('mouseleave', () => { if (this.hover) { this.hover = null; this.draw(); } });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left - this.size.width / 2; const py = event.clientY - rect.top - this.size.height / 2;
      const k = Math.max(0.08, Math.min(4, this.view.k * Math.exp(-event.deltaY * 0.0015)));
      // Zoom around the pointer.
      this.view.x = px - ((px - this.view.x) / this.view.k) * k; this.view.y = py - ((py - this.view.y) / this.view.k) * k; this.view.k = k;
      this.moved = true;
      this.draw();
    }, { passive: false });
    canvas.addEventListener('dblclick', (event) => { if (!this.nodeAt(this.toWorld(event))) { this.moved = false; this.fit(); } });
  }

  destroy() {
    cancelAnimationFrame(this.frame); this.frame = 0;
    this.observer.disconnect();
    for (const off of this.off) off();
    this.rebuildSoon.cancel();
  }
}
