// Opale — the pointer, the pen and the keyboard on a moodboard: tools,
// selection, moving with alignment guides, resizing and rotating, lines that
// stick to what they join, drawing, panning and zooming, shortcuts,
// clipboard and drag and drop.
import { app, isTextInput, toast, topModal } from '../core.js';
import { WIDGETS } from './widgets.js';
import { place } from './render.js';

const Board = window.OpaleBoard;
const DRAG = 4;
const SNAP = 6;
const CREATES = new Set(['text', 'sticky', 'shape', 'frame', 'connector', 'pen', 'highlighter', 'eraser', 'comment', 'card', 'mdcard', 'grid']);
const KEEP_ASPECT = new Set(['image', 'emoji', 'sticker', 'icon', 'stroke', 'comment', 'usercard']);
export const TOOL_KEYS = { v: 'select', h: 'hand', t: 'text', n: 'sticky', s: 'shape', r: 'shape', o: 'shape', l: 'connector', p: 'pen', e: 'eraser', f: 'frame', c: 'comment', k: 'card' };

const MARK = 'application/x-opale-board';

export class Input {
  constructor(view) {
    this.view = view;
    this.tool = 'select';
    this.options = { shape: 'rect', sticky: Board.STICKY_COLORS[0], frame: null, penColor: '#1f2937', penWidth: 4, highlighterColor: '#facc15', highlighterWidth: 18, connectorPath: 'curve', connectorEnd: 'arrow', eraserSize: 14 };
    this.space = false;
    this.clipboard = null;
    const stage = view.stage;
    this.handlers = [
      [stage, 'pointerdown', (e) => this.down(e)],
      [stage, 'pointermove', (e) => this.hover(e)],
      [stage, 'wheel', (e) => this.wheel(e), { passive: false }],
      [stage, 'dblclick', (e) => this.dblclick(e)],
      [stage, 'contextmenu', (e) => this.contextmenu(e)],
      [stage, 'dragover', (e) => this.dragover(e)],
      [stage, 'drop', (e) => this.drop(e)],
      [document, 'keydown', (e) => this.keydown(e)],
      [document, 'keyup', (e) => { if (e.key === ' ') { this.space = false; this.cursor(); } }],
      [document, 'paste', (e) => this.paste(e)],
      [document, 'copy', (e) => this.copy(e, false)],
      [document, 'cut', (e) => this.copy(e, true)],
      [window, 'blur', () => { this.space = false; }],
    ];
    for (const [target, type, fn, options] of this.handlers) target.addEventListener(type, fn, options);
  }
  destroy() { for (const [target, type, fn, options] of this.handlers) target.removeEventListener(type, fn, options); if (this.stop) this.stop(); }

  get active() { return app.workspace.activeView === this.view && this.view.loaded && !this.view.el.hidden; }
  // Keys and clipboard belong to the board unless something else has the focus.
  ownsKeys() {
    if (!this.active || topModal()) return false;
    const focus = document.activeElement;
    if (focus && focus !== document.body && !this.view.stage.contains(focus)) return false;
    return !isTextInput(focus);
  }

  setTool(tool, options = {}) {
    Object.assign(this.options, options);
    this.tool = tool;
    if (tool !== 'select' && this.view.editing) this.view.finishEdit(true);
    this.cursor();
    this.view.ui.updateTools();
  }
  cursor() {
    const stage = this.view.stage;
    stage.dataset.tool = this.space ? 'hand' : this.tool;
  }

  // ------------------------------------------------------------- pointer
  elementAt(target) {
    const node = target && target.closest && target.closest('.b-el');
    if (!node || !this.view.world.contains(node)) return null;
    return this.view.byId.get(node.dataset.id) || null;
  }

  down(event) {
    const view = this.view;
    if (!view.loaded) return;
    if (event.target.closest('.board-ui, .b-editor, .b-note-editor')) return;
    view.stage.focus({ preventScroll: true });
    if (view.editing && !event.target.closest('.b-editor')) view.finishEdit(true);
    const handle = event.target.closest('[data-handle]');
    if (handle && event.button === 0) { event.preventDefault(); this.handle(event, handle.dataset.handle); return; }
    if (event.button === 1 || (event.button === 0 && (this.space || this.tool === 'hand'))) { event.preventDefault(); this.pan(event); return; }
    if (event.button !== 0) return;
    if (CREATES.has(this.tool) && !view.readOnly) { event.preventDefault(); this.create(event); return; }
    const el = this.elementAt(event.target);
    if (el) {
      const node = view.nodeOf(el.id);
      const action = event.target.closest('[data-action]');
      if (action && node.contains(action)) { event.preventDefault(); event.stopPropagation(); this.action(el, action, event); return; }
      if (view.interacting === el.id) return;
      const grab = event.target.closest('[data-grab]');
      const kind = WIDGETS[el.kind];
      if (grab && node.contains(grab) && kind && kind.grabs && !el.locked && !view.readOnly) {
        const [name, ...args] = grab.dataset.grab.split(':');
        if (kind.grabs[name]) { event.preventDefault(); if (!view.selection.has(el.id)) view.select([el.id]); kind.grabs[name](view, el, args, event, grab); return; }
      }
      // A mind map remembers which idea was clicked (for Tab and Enter).
      const topic = event.target.closest('[data-topic]');
      if (el.kind === 'mindmap' && topic) { view.widgetFocus = { id: el.id, node: topic.dataset.topic }; view.redraw(el); }
      event.preventDefault();
      if (view.doc.vote && view.doc.vote.active && el.kind !== 'connector') { this.vote(el, event); return; }
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        if (view.selection.has(el.id)) { const next = new Set(view.selection); next.delete(el.id); view.select(next); }
        else view.select([el.id], true);
        return;
      }
      if (!view.selection.has(el.id)) view.select([el.id]);
      this.move(event, el);
      return;
    }
    event.preventDefault();
    if (event.altKey) this.lasso(event); else this.marquee(event);
  }

  // Follow the pointer until it is released. `move(e)` and `up(e, moved)`.
  track(event, move, up, options = {}) {
    const view = this.view;
    const startX = event.clientX; const startY = event.clientY;
    let moved = false; let last = event;
    const target = view.stage;
    try { target.setPointerCapture(event.pointerId); } catch {}
    const onMove = (e) => {
      if (e.pointerId !== event.pointerId) return;
      last = e;
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < (options.threshold ?? DRAG)) return;
      moved = true;
      move(e);
      if (options.edgePan) this.edgePan(e);
    };
    const finish = (e, cancelled) => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(this.edgeFrame); this.edgeFrame = 0;
      try { target.releasePointerCapture(event.pointerId); } catch {}
      this.stop = null;
      up(e || last, moved, cancelled);
    };
    const onUp = (e) => { if (e.pointerId === event.pointerId) finish(e, false); };
    const onCancel = (e) => { if (e.pointerId === event.pointerId) finish(e, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(last, true); } };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey, true);
    this.stop = () => finish(last, true);
  }

  // Near the edge of the board while dragging, the view scrolls.
  edgePan(e) {
    this.edgePoint = { x: e.clientX, y: e.clientY };
    if (this.edgeFrame) return;
    const step = () => {
      const r = this.view.stageRect(); const p = this.edgePoint; const m = 36;
      const dx = p.x < r.left + m ? (r.left + m - p.x) / 3 : p.x > r.right - m ? -(p.x - r.right + m) / 3 : 0;
      const dy = p.y < r.top + m ? (r.top + m - p.y) / 3 : p.y > r.bottom - m ? -(p.y - r.bottom + m) / 3 : 0;
      if (!dx && !dy) { this.edgeFrame = 0; return; }
      const c = this.view.camera;
      this.view.setCamera(c.x + dx, c.y + dy, c.k);
      this.view.stage.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y, pointerId: this.edgePointer || 1, bubbles: true }));
      this.edgeFrame = requestAnimationFrame(step);
    };
    this.edgeFrame = requestAnimationFrame(step);
  }

  pan(event) {
    const view = this.view; const start = { ...view.camera };
    view.stage.classList.add('is-panning');
    this.track(event, (e) => view.setCamera(start.x + e.clientX - event.clientX, start.y + e.clientY - event.clientY, start.k), () => view.stage.classList.remove('is-panning'), { threshold: 0 });
  }

  // ------------------------------------------------------------- moving
  move(event, first) {
    const view = this.view;
    const start = view.toWorld(event.clientX, event.clientY);
    let items = null; let guides = [];
    const begin = (duplicate) => {
      let moving = view.selected.filter((el) => !el.locked && !view.layer(el.layer).locked);
      if (duplicate) moving = this.duplicate(moving, 0, false);
      // A frame carries what lies inside it.
      const ids = new Set(moving.map((el) => el.id));
      for (const frame of moving.filter((el) => el.kind === 'frame' || el.kind === 'grid')) {
        const box = Board.bounds(frame);
        for (const el of view.doc.elements) {
          if (ids.has(el.id) || el.locked || el.kind === 'connector') continue;
          const c = Board.center(Board.bounds(el));
          if (c.x > box.x && c.x < box.x + box.w && c.y > box.y && c.y < box.y + box.h && el !== frame) { ids.add(el.id); moving.push(el); }
        }
      }
      // Lines whose ends are both free move along; attached ones follow by themselves.
      view.history.begin('move');
      items = moving.map((el) => { view.history.capture(el); return { el, x: el.x, y: el.y, from: el.from && { ...el.from }, to: el.to && { ...el.to } }; });
      const box = Board.union(moving.filter((el) => el.kind !== 'connector').map((el) => Board.bounds(el, view.lookup)));
      this.moveBox = box;
      this.snapTargets = view.doc.elements.filter((el) => !ids.has(el.id) && el.kind !== 'connector' && el.kind !== 'stroke' && !view.layer(el.layer).visible === false).map((el) => Board.bounds(el, view.lookup));
      view.stage.classList.add('is-moving');
    };
    this.track(event, (e) => {
      if (!items) begin(e.altKey && !view.readOnly);
      const p = view.toWorld(e.clientX, e.clientY);
      let dx = p.x - start.x; let dy = p.y - start.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      guides = [];
      if (this.moveBox && view.doc.settings.snap && !e.ctrlKey) ({ dx, dy, guides } = this.snap(this.moveBox, dx, dy));
      for (const item of items) {
        const el = item.el;
        if (el.kind === 'connector') {
          if (!el.from.id) { el.from.x = item.from.x + dx; el.from.y = item.from.y + dy; }
          if (!el.to.id) { el.to.x = item.to.x + dx; el.to.y = item.to.y + dy; }
        } else { el.x = item.x + dx; el.y = item.y + dy; }
        view.dirtyIds.add(el.id);
      }
      view.sync([]);
      view.ui.showGuides(guides);
    }, (e, moved, cancelled) => {
      view.stage.classList.remove('is-moving');
      view.ui.showGuides([]);
      if (!items) {
        // A click on an element of a group already selected picks it alone.
        if (!moved && first && first.group && view.selection.size > 1 && !e.shiftKey) view.select([first.id]);
        return;
      }
      if (cancelled) { view.history.cancel(); view.reindex(); view.sync(); return; }
      if (view.history.commit()) { view.markDirty(); view.ui.updateHistory(); }
    }, { edgePan: true });
  }

  // Align the moving box with the edges and centres of other elements.
  snap(box, dx, dy) {
    const k = this.view.camera.k; const limit = SNAP / k;
    const xs = [box.x + dx, box.x + dx + box.w / 2, box.x + dx + box.w];
    const ys = [box.y + dy, box.y + dy + box.h / 2, box.y + dy + box.h];
    let bestX = null; let bestY = null;
    const view = this.view; const visible = view.toWorld(view.stageRect().left, view.stageRect().top);
    const r = view.stageRect(); const far = { x: visible.x, y: visible.y, w: r.width / k, h: r.height / k };
    for (const other of this.snapTargets) {
      if (!Board.intersects(other, { x: far.x - 200, y: far.y - 200, w: far.w + 400, h: far.h + 400 })) continue;
      const ox = [other.x, other.x + other.w / 2, other.x + other.w]; const oy = [other.y, other.y + other.h / 2, other.y + other.h];
      for (const a of xs) for (const b of ox) { const d = b - a; if (Math.abs(d) <= limit && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: b, other }; }
      for (const a of ys) for (const b of oy) { const d = b - a; if (Math.abs(d) <= limit && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: b, other }; }
    }
    const guides = [];
    if (bestX) { dx += bestX.d; const top = Math.min(box.y + dy, bestX.other.y); const bottom = Math.max(box.y + dy + box.h, bestX.other.y + bestX.other.h); guides.push({ x1: bestX.at, y1: top, x2: bestX.at, y2: bottom }); }
    if (bestY) { dy += bestY.d; const left = Math.min(box.x + dx, bestY.other.x); const right = Math.max(box.x + dx + box.w, bestY.other.x + bestY.other.w); guides.push({ x1: left, y1: bestY.at, x2: right, y2: bestY.at }); }
    return { dx, dy, guides };
  }

  // ------------------------------------------------------ marquee, lasso
  marquee(event) {
    const view = this.view;
    const before = event.shiftKey ? new Set(view.selection) : new Set();
    const start = view.toWorld(event.clientX, event.clientY);
    this.track(event, (e) => {
      const p = view.toWorld(e.clientX, e.clientY);
      const box = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      view.ui.showMarquee(box);
      const hits = view.doc.elements.filter((el) => this.selectable(el) && ((el.kind === 'frame' || el.kind === 'grid') ? Board.contains(box, Board.bounds(el)) : Board.intersects(box, Board.bounds(el, view.lookup))));
      view.select([...before, ...hits.map((el) => el.id)]);
    }, (e, moved) => {
      view.ui.showMarquee(null);
      if (!moved && !event.shiftKey) { view.clearSelection(); if (view.widgetFocus) { const el = view.byId.get(view.widgetFocus.id); view.widgetFocus = null; if (el) view.redraw(el); } }
    }, { edgePan: true });
  }

  lasso(event) {
    const view = this.view;
    const points = [view.toWorld(event.clientX, event.clientY)];
    this.track(event, (e) => {
      points.push(view.toWorld(e.clientX, e.clientY));
      view.ui.showLasso(points);
    }, () => {
      view.ui.showLasso(null);
      const inside = (p) => {
        let hit = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[i]; const b = points[j];
          if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
        }
        return hit;
      };
      if (points.length > 2) view.select(view.doc.elements.filter((el) => this.selectable(el) && inside(Board.center(Board.bounds(el, view.lookup)))).map((el) => el.id), event.shiftKey);
    });
  }

  selectable(el) { const layer = this.view.layer(el.layer); return layer.visible && !layer.locked; }

  // ------------------------------------------------------------ handles
  handle(event, name) {
    const view = this.view;
    if (view.readOnly) return;
    if (name === 'rotate') return this.rotate(event);
    if (name === 'from' || name === 'to') return this.dragEnd(event, view.selected[0], name);
    if (name.startsWith('quick-')) return this.quickConnect(event, name.slice(6));
    return this.resize(event, name);
  }

  resize(event, dir) {
    const view = this.view;
    const elements = view.selected.filter((el) => !el.locked && el.kind !== 'connector');
    if (!elements.length) return;
    const sx = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0;
    const sy = dir.includes('s') ? 1 : dir.includes('n') ? -1 : 0;
    view.history.begin('resize');
    const origins = elements.map((el) => { view.history.capture(el); return { el, x: el.x, y: el.y, w: el.w, h: el.h, font: el.style.fontSize, points: el.kind === 'stroke' ? el.data.points.map((p) => p.slice()) : null }; });
    const single = elements.length === 1 ? elements[0] : null;
    const group = Board.union(elements.map((el) => Board.bounds(el)));
    this.track(event, (e) => {
      const p = view.toWorld(e.clientX, e.clientY); const s = view.toWorld(event.clientX, event.clientY);
      let dx = p.x - s.x; let dy = p.y - s.y;
      if (single) {
        const o = origins[0]; const angle = (single.rotation * Math.PI) / 180;
        const lx = dx * Math.cos(-angle) - dy * Math.sin(-angle); const ly = dx * Math.sin(-angle) + dy * Math.cos(-angle);
        let w = Math.max(12, o.w + sx * lx); let hgt = Math.max(12, o.h + sy * ly);
        const aspect = KEEP_ASPECT.has(single.kind) !== e.shiftKey;
        if (aspect && sx && sy) { const scale = Math.max(w / o.w, hgt / o.h); w = o.w * scale; hgt = o.h * scale; }
        else if (aspect && sx && !sy && KEEP_ASPECT.has(single.kind)) hgt = (o.h * w) / o.w;
        else if (aspect && sy && !sx && KEEP_ASPECT.has(single.kind)) w = (o.w * hgt) / o.h;
        const c0 = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
        const anchor = Board.rotatePoint({ x: c0.x - (sx * o.w) / 2, y: c0.y - (sy * o.h) / 2 }, c0, single.rotation);
        const toCenter = Board.rotatePoint({ x: (sx * w) / 2, y: (sy * hgt) / 2 }, { x: 0, y: 0 }, single.rotation);
        const cx = (sx ? anchor.x : c0.x) + (sx ? toCenter.x : 0) + (sx ? 0 : (sy ? toCenter.x : 0));
        const cy = (sy ? anchor.y : c0.y) + (sy ? toCenter.y : 0) + (sy ? 0 : (sx ? toCenter.y : 0));
        if (!sx) w = o.w; if (!sy && !(aspect && KEEP_ASPECT.has(single.kind))) hgt = sy ? hgt : (aspect && KEEP_ASPECT.has(single.kind) ? hgt : o.h);
        const center = sx && sy ? { x: anchor.x + toCenter.x, y: anchor.y + toCenter.y } : { x: cx, y: cy };
        single.w = w; single.h = hgt; single.x = center.x - w / 2; single.y = center.y - hgt / 2;
        this.scaleContent(single, o, w / o.w, hgt / o.h, !!(sx && sy));
      } else {
        if (e.shiftKey === false && sx && sy) { const scale = Math.max((group.w + sx * dx) / group.w, (group.h + sy * dy) / group.h); dx = sx * (scale - 1) * group.w; dy = sy * (scale - 1) * group.h; }
        const fx = sx ? Math.max(0.05, (group.w + sx * dx) / group.w) : 1; const fy = sy ? Math.max(0.05, (group.h + sy * dy) / group.h) : 1;
        const ax = sx > 0 ? group.x : group.x + group.w; const ay = sy > 0 ? group.y : group.y + group.h;
        for (const o of origins) {
          const el = o.el;
          el.x = sx ? ax + (o.x - ax) * fx : o.x; el.y = sy ? ay + (o.y - ay) * fy : o.y;
          el.w = Math.max(4, o.w * fx); el.h = Math.max(4, o.h * fy);
          this.scaleContent(el, o, fx, fy, true);
        }
      }
      for (const o of origins) view.dirtyIds.add(o.el.id);
      view.sync([]);
    }, (e, moved, cancelled) => {
      if (cancelled) { view.history.cancel(); view.reindex(); view.sync(); return; }
      for (const o of origins) { const node = view.nodeOf(o.el.id); if (node) node.renderKey = null; Board.normalize(o.el); }
      view.sync(origins.map((o) => o.el.id));
      if (view.history.commit()) { view.markDirty(); view.ui.updateHistory(); }
    });
  }

  // Text grows with its box when pulled by a corner; drawings scale.
  scaleContent(el, o, fx, fy, corner) {
    if (el.kind === 'stroke' && o.points) el.data.points = o.points.map((p) => [p[0] * fx, p[1] * fy, p[2]]);
    if (el.kind === 'text' && corner && o.font) el.style.fontSize = Math.max(6, Math.round(o.font * Math.min(fx, fy) * 10) / 10);
  }

  rotate(event) {
    const view = this.view;
    const elements = view.selected.filter((el) => !el.locked && el.kind !== 'connector');
    if (!elements.length) return;
    const box = Board.union(elements.map((el) => Board.bounds(el)));
    const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const s = view.toWorld(event.clientX, event.clientY);
    const a0 = Math.atan2(s.y - c.y, s.x - c.x);
    view.history.begin('rotate');
    const origins = elements.map((el) => { view.history.capture(el); return { el, rotation: el.rotation, center: Board.center(el) }; });
    this.track(event, (e) => {
      const p = view.toWorld(e.clientX, e.clientY);
      let delta = ((Math.atan2(p.y - c.y, p.x - c.x) - a0) * 180) / Math.PI;
      if (elements.length === 1) {
        let angle = origins[0].rotation + delta;
        angle = e.shiftKey ? Math.round(angle / 15) * 15 : (Math.abs(((angle % 90) + 90) % 90) < 3 || Math.abs(((angle % 90) + 90) % 90) > 87 ? Math.round(angle / 90) * 90 : angle);
        delta = angle - origins[0].rotation;
      } else if (e.shiftKey) delta = Math.round(delta / 15) * 15;
      for (const o of origins) {
        const el = o.el;
        el.rotation = ((o.rotation + delta) % 360 + 360) % 360;
        const moved = Board.rotatePoint(o.center, c, delta);
        el.x = moved.x - el.w / 2; el.y = moved.y - el.h / 2;
        view.dirtyIds.add(el.id);
      }
      view.sync([]);
      view.ui.showAngle(e, origins[0].el.rotation);
    }, (e, moved, cancelled) => {
      view.ui.showAngle(null);
      if (cancelled) { view.history.cancel(); view.reindex(); view.sync(); return; }
      if (view.history.commit()) { view.markDirty(); view.ui.updateHistory(); }
    });
  }

  // What a line end lands on: an element (and a side when close to one).
  attachAt(clientX, clientY, exclude) {
    const view = this.view;
    const hits = document.elementsFromPoint(clientX, clientY);
    for (const hit of hits) {
      const el = this.elementAt(hit);
      if (!el || el.kind === 'connector' || el.kind === 'stroke' || el.id === exclude || !this.selectable(el)) continue;
      if ((el.kind === 'frame' || el.kind === 'grid') && !hit.closest('.b-frame-title')) continue;
      const p = view.toWorld(clientX, clientY);
      let side = null; let best = 18 / view.camera.k;
      for (const name of Board.SIDES) { const sp = Board.sidePoint(el, name); const d = Math.hypot(sp.x - p.x, sp.y - p.y); if (d < best) { best = d; side = name; } }
      return { id: el.id, side };
    }
    return null;
  }

  dragEnd(event, connector, which) {
    const view = this.view;
    if (!connector) return;
    view.history.begin('connect');
    view.history.capture(connector);
    this.track(event, (e) => {
      const at = this.attachAt(e.clientX, e.clientY, null);
      const p = view.toWorld(e.clientX, e.clientY);
      connector[which] = at ? { id: at.id, ...(at.side ? { side: at.side } : {}), x: p.x, y: p.y } : { x: p.x, y: p.y };
      view.ui.showAnchors(at ? view.byId.get(at.id) : null, at && at.side);
      view.sync([connector.id]);
    }, (e, moved, cancelled) => {
      view.ui.showAnchors(null);
      if (cancelled) { view.history.cancel(); view.reindex(); view.sync(); return; }
      if (view.history.commit()) { view.markDirty(); view.ui.updateHistory(); }
    }, { edgePan: true });
  }

  // The small arrows around a selected element: drag to draw a line from
  // it, click to add a copy on that side, already joined.
  quickConnect(event, side) {
    const view = this.view; const source = view.selected[0];
    if (!source) return;
    const start = Board.sidePoint(source, side);
    let connector = null;
    this.track(event, (e) => {
      const p = view.toWorld(e.clientX, e.clientY);
      if (!connector) {
        view.history.begin('connect');
        connector = view.add(Board.create('connector', { from: { id: source.id, side }, to: { x: p.x, y: p.y }, style: { path: this.options.connectorPath, end: this.options.connectorEnd } }));
      }
      const at = this.attachAt(e.clientX, e.clientY, source.id);
      connector.to = at ? { id: at.id, ...(at.side ? { side: at.side } : {}), x: p.x, y: p.y } : { x: p.x, y: p.y };
      view.ui.showAnchors(at ? view.byId.get(at.id) : null, at && at.side);
      view.sync([connector.id]);
    }, (e, moved, cancelled) => {
      view.ui.showAnchors(null);
      if (connector) {
        if (cancelled) { view.history.cancel(); view.reindex(); view.sync(); return; }
        if (!connector.to.id) {
          // Released on nothing: a new element of the same kind appears there, joined.
          const p = view.toWorld(e.clientX, e.clientY);
          const copy = Board.create(source.kind, { style: Board.clone(source.style), data: source.kind === 'shape' ? { shape: source.data.shape, text: '' } : source.kind === 'sticky' ? { text: '' } : Board.clone(KIND_DATA(source)), w: source.w, h: source.h });
          copy.x = p.x - (side === 'left' ? copy.w : side === 'right' ? 0 : copy.w / 2);
          copy.y = p.y - (side === 'top' ? copy.h : side === 'bottom' ? 0 : copy.h / 2);
          view.add(copy);
          connector.to = { id: copy.id };
          view.select([copy.id]);
        }
        if (view.history.commit()) { view.markDirty(); view.ui.updateHistory(); }
        return;
      }
      // A click: a copy on that side, joined.
      view.change(() => {
        const gap = 80;
        const copy = Board.create(source.kind, { style: Board.clone(source.style), data: source.kind === 'shape' ? { shape: source.data.shape, text: '' } : source.kind === 'sticky' ? { text: '' } : Board.clone(KIND_DATA(source)), w: source.w, h: source.h });
        copy.x = source.x + (side === 'right' ? source.w + gap : side === 'left' ? -source.w - gap : 0);
        copy.y = source.y + (side === 'bottom' ? source.h + gap : side === 'top' ? -source.h - gap : 0);
        view.add(copy);
        view.add(Board.create('connector', { from: { id: source.id }, to: { id: copy.id }, style: { path: this.options.connectorPath, end: this.options.connectorEnd } }));
        view.select([copy.id]);
        view.ui.revealIfNeeded(Board.bounds(copy));
      });
      void start;
    });
  }

  // ------------------------------------------------------------ creating
  create(event) {
    const view = this.view; const tool = this.tool;
    const start = view.toWorld(event.clientX, event.clientY);
    if (tool === 'pen' || tool === 'highlighter') return this.draw(event);
    if (tool === 'eraser') return this.erase(event);
    if (tool === 'connector') return this.connect(event);
    const kind = tool;
    let el = null;
    const make = () => {
      view.history.begin('create');
      const props = { x: start.x, y: start.y };
      if (kind === 'shape') props.data = { shape: this.options.shape, text: '' };
      if (kind === 'sticky') props.style = { fill: this.options.sticky };
      if (kind === 'frame' && this.options.frame) { props.w = this.options.frame.w; props.h = this.options.frame.h; props.data = { title: this.options.frame.title || 'Cadre' }; }
      el = Board.create(kind, props);
      if (kind === 'frame' || kind === 'grid') view.add(el, 0); else view.add(el);
      return el;
    };
    this.track(event, (e) => {
      if (!el) { make(); el.w = 1; el.h = 1; }
      const p = view.toWorld(e.clientX, e.clientY);
      let w = Math.abs(p.x - start.x); let hgt = Math.abs(p.y - start.y);
      if (e.shiftKey || kind === 'sticky') { const m = Math.max(w, hgt); w = m; hgt = m; }
      el.x = Math.min(start.x, start.x + Math.sign(p.x - start.x) * w); el.y = Math.min(start.y, start.y + Math.sign(p.y - start.y) * hgt);
      el.w = Math.max(1, w); el.h = kind === 'text' ? 44 : Math.max(1, hgt);
      view.sync([el.id]);
    }, (e, moved, cancelled) => {
      if (cancelled) { if (el) { view.history.cancel(); view.reindex(); view.sync(); } return; }
      if (!el) {
        make();
        // A click: default size, centred on the pointer (text starts there).
        if (kind !== 'text') { el.x = start.x - el.w / 2; el.y = start.y - el.h / 2; } else el.y = start.y - 22;
      } else if (el.w < 24 || el.h < 24) {
        const spec = Board.KINDS[kind];
        el.w = Math.max(el.w, kind === 'text' ? 260 : spec.w); el.h = kind === 'text' ? 44 : Math.max(el.h, spec.h);
      }
      if (view.history.commit()) { view.markDirty(); view.ui.updateHistory(); }
      view.select([el.id]);
      view.sync([el.id]);
      this.setTool('select');
      if (['text', 'sticky', 'mdcard'].includes(kind)) view.editField(el, 'text', { keepEmpty: kind !== 'text' });
      else if (kind === 'frame' || kind === 'grid') view.editField(el, 'title');
      else if (kind === 'card') view.editField(el, 'title');
      else if (kind === 'comment') view.openThread(el);
    });
  }

  connect(event) {
    const view = this.view;
    const from = this.attachAt(event.clientX, event.clientY, null);
    const p0 = view.toWorld(event.clientX, event.clientY);
    let el = null;
    this.track(event, (e) => {
      const p = view.toWorld(e.clientX, e.clientY);
      if (!el) {
        view.history.begin('connect');
        el = view.add(Board.create('connector', { from: from ? { id: from.id, ...(from.side ? { side: from.side } : {}) } : { x: p0.x, y: p0.y }, to: { x: p.x, y: p.y }, style: { path: this.options.connectorPath, end: this.options.connectorEnd } }));
      }
      const at = this.attachAt(e.clientX, e.clientY, from && from.id);
      el.to = at ? { id: at.id, ...(at.side ? { side: at.side } : {}), x: p.x, y: p.y } : { x: p.x, y: p.y };
      view.ui.showAnchors(at ? view.byId.get(at.id) : null, at && at.side);
      view.sync([el.id]);
    }, (e, moved, cancelled) => {
      view.ui.showAnchors(null);
      if (!el) return;
      if (cancelled) { view.history.cancel(); view.reindex(); view.sync(); return; }
      if (view.history.commit()) { view.markDirty(); view.ui.updateHistory(); }
      view.select([el.id]);
      this.setTool('select');
    }, { edgePan: true });
  }

  // Hand-drawn lines: every pointer sample (pen pressure included) is kept,
  // drawn live, then smoothed into a stroke element.
  draw(event) {
    const view = this.view; const highlighter = this.tool === 'highlighter';
    const color = highlighter ? this.options.highlighterColor : this.options.penColor;
    const width = highlighter ? this.options.highlighterWidth : this.options.penWidth;
    const pressure = (e) => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5);
    const points = [[...Object.values(view.toWorld(event.clientX, event.clientY)), pressure(event)]];
    const live = view.ui.liveStroke(color, width, highlighter);
    const redraw = () => live.update(Board.strokeOutline(points, width));
    redraw();
    this.track(event, (e) => {
      const samples = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const sample of samples.length ? samples : [e]) { const p = view.toWorld(sample.clientX, sample.clientY); points.push([p.x, p.y, pressure(sample)]); }
      if (e.shiftKey && points.length > 2) points.splice(1, points.length - 2);
      redraw();
    }, (e, moved, cancelled) => {
      live.remove();
      if (cancelled || !points.length) return;
      const smooth = Board.smoothPoints(points, 1.2 / view.camera.k);
      view.change(() => {
        const el = Board.fitStroke(Board.create('stroke', { style: { color, width, tool: highlighter ? 'highlighter' : 'pen' }, data: { points: smooth } }));
        view.add(el);
      });
    }, { threshold: 0 });
  }

  // The eraser removes whole drawings it passes over.
  erase(event) {
    const view = this.view; const erased = new Set();
    const at = (e) => {
      const p = view.toWorld(e.clientX, e.clientY); const r = this.options.eraserSize / view.camera.k;
      for (const el of view.doc.elements) {
        if (el.kind !== 'stroke' || erased.has(el.id) || el.locked || !this.selectable(el)) continue;
        if (!Board.intersects({ x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 }, Board.bounds(el))) continue;
        const local = el.data.points.map(([x, y]) => ({ x: el.x + x, y: el.y + y }));
        if (Board.distanceToPolyline(p, local) <= r + el.style.width / 2) { erased.add(el.id); const node = view.nodeOf(el.id); if (node) node.classList.add('is-erasing'); }
      }
      view.ui.showEraser(e);
    };
    at(event);
    this.track(event, at, (e, moved, cancelled) => {
      view.ui.showEraser(null);
      for (const id of erased) { const node = view.nodeOf(id); if (node) node.classList.remove('is-erasing'); }
      if (!cancelled && erased.size) view.change(() => view.remove([...erased]));
    }, { threshold: 0 });
  }

  // ------------------------------------------------------- widget drags
  dragWithin(event, source, handlers) {
    const view = this.view;
    let ghost = null; let target = null;
    this.track(event, (e) => {
      if (!ghost) {
        const r = source.getBoundingClientRect();
        ghost = source.cloneNode(true);
        ghost.classList.add('b-drag-ghost');
        Object.assign(ghost.style, { width: `${r.width / view.camera.k}px`, transform: `scale(${view.camera.k}) rotate(-2deg)`, left: `${r.left}px`, top: `${r.top}px` });
        ghost.offset = { x: event.clientX - r.left, y: event.clientY - r.top };
        document.body.append(ghost);
        source.classList.add('is-dragged');
      }
      ghost.style.left = `${e.clientX - ghost.offset.x}px`; ghost.style.top = `${e.clientY - ghost.offset.y}px`;
      target = handlers.target(e.clientX, e.clientY);
      view.ui.showDropLine(target && target.line);
    }, (e, moved, cancelled) => {
      view.ui.showDropLine(null);
      if (ghost) ghost.remove();
      source.classList.remove('is-dragged');
      if (!moved) { const el = view.byId.get(source.closest('.b-el').dataset.id); if (el && source.dataset.edit && view.selection.has(el.id)) view.editField(el, source.dataset.edit); return; }
      if (!cancelled && target) handlers.drop(target);
    });
    return true;
  }

  dragValue(event, compute, apply, el) {
    const view = this.view;
    let started = false;
    this.track(event, (e) => {
      if (!started) { started = true; view.history.begin('widget'); view.history.capture(view.byId.get(el.id) || el); }
      apply(compute(e.clientX, e.clientY));
      view.redraw(el);
    }, (e, moved, cancelled) => {
      if (!started) { const part = event.target.closest('[data-edit]'); if (part && view.selection.has(el.id)) view.editField(el, part.dataset.edit); return; }
      if (cancelled) { view.history.cancel(); view.reindex(); view.sync(); return; }
      Board.normalize(el);
      if (view.history.commit()) { view.markDirty(); view.ui.updateHistory(); }
      view.redraw(el);
    });
    return true;
  }

  // ------------------------------------------------------------ actions
  action(el, button, event) {
    const view = this.view;
    const [name, ...args] = button.dataset.action.split(':');
    if (name === 'repair') { view.select([el.id]); view.ui.repair(el); return; }
    if (name === 'open') { view.ui.openElement(el); return; }
    if (name === 'copy') { navigator.clipboard.writeText(el.data.code || '').then(() => toast('Code copié')); return; }
    if (name === 'react') { const emoji = args.join(':'); view.mutate(el, (d, live) => { live.reactions = { ...(live.reactions || {}) }; live.reactions[emoji] = (live.reactions[emoji] || 0) + 1; }); return; }
    if (view.readOnly) return;
    const kind = WIDGETS[el.kind];
    if (kind && kind.actions && kind.actions[name]) {
      if (!view.selection.has(el.id) && !event.shiftKey) view.select([el.id]);
      kind.actions[name](view, el, args, event, button);
    }
  }

  vote(el, event) {
    const view = this.view; const vote = view.doc.vote;
    const used = Object.values(vote.votes).reduce((a, b) => a + b, 0);
    if (event.altKey || event.button === 2) {
      if (!vote.votes[el.id]) return;
      view.setMeta((doc) => { doc.vote.votes[el.id]--; if (!doc.vote.votes[el.id]) delete doc.vote.votes[el.id]; });
      return;
    }
    if (used >= vote.perPerson) { toast(`Plus de vote disponible (${vote.perPerson} au total). Alt+clic retire un vote.`); return; }
    view.setMeta((doc) => { doc.vote.votes[el.id] = (doc.vote.votes[el.id] || 0) + 1; });
  }

  // ----------------------------------------------------------- hovering
  hover(event) {
    if (event.buttons) return;
    const view = this.view;
    if (this.tool === 'connector') {
      const at = this.attachAt(event.clientX, event.clientY, null);
      view.ui.showAnchors(at ? view.byId.get(at.id) : null, at && at.side);
    }
    if (this.tool === 'eraser') view.ui.showEraser(event);
  }

  wheel(event) {
    const view = this.view;
    if (event.target.closest('.board-ui')) return;
    const inside = event.target.closest('.b-mdcard-inner, .b-note-content, .b-code-body, .b-kcol-cards, .b-answers, .b-note-editor');
    if (inside && !event.ctrlKey && inside.scrollHeight > inside.clientHeight + 1 && view.selection.size === 1) return;
    event.preventDefault();
    const c = view.camera;
    // A pinch on a touchpad, or Ctrl + wheel: zoom where the pointer is.
    // A mouse wheel zooms too (as in Miro); a touchpad's two-finger scroll pans.
    const mouseWheel = event.deltaMode === 1 || (event.deltaX === 0 && Math.abs(event.deltaY) >= 50 && Number.isInteger(event.deltaY));
    if (event.ctrlKey || (mouseWheel && !event.shiftKey)) {
      const unit = event.deltaMode === 1 ? 33 : 1;
      const factor = Math.exp((-event.deltaY * unit) * (event.ctrlKey && !mouseWheel ? 0.01 : 0.0018));
      const goal = Math.max(0.05, Math.min(8, (this.zoomGoal && this.zoomGoal.until > performance.now() ? this.zoomGoal.k : c.k) * factor));
      this.zoomGoal = { k: goal, until: performance.now() + 180 };
      view.zoomAt(event.clientX, event.clientY, goal, mouseWheel);
      return;
    }
    const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
    const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
    view.setCamera(c.x - dx, c.y - dy, c.k);
  }

  dblclick(event) {
    const view = this.view;
    if (event.target.closest('.board-ui, .b-editor')) return;
    const el = this.elementAt(event.target);
    if (el) {
      if (event.target.closest('[data-action]')) return;
      if (el.locked) { toast('Élément verrouillé : déverrouillez-le pour le modifier (Ctrl+L).'); return; }
      view.select([el.id]);
      view.editElement(el, event.target);
      return;
    }
    if (view.readOnly) return;
    // A double-click on the empty board writes a text there.
    const p = view.toWorld(event.clientX, event.clientY);
    const text = view.change(() => view.add(Board.create('text', { x: p.x, y: p.y - 22 })));
    view.select([text.id]);
    view.editField(text, 'text');
  }

  contextmenu(event) {
    if (event.target.closest('.board-ui, .b-editor')) return;
    event.preventDefault();
    const view = this.view;
    const el = this.elementAt(event.target);
    if (el && view.doc.vote && view.doc.vote.active) { this.vote(el, { altKey: true }); return; }
    if (el && !view.selection.has(el.id)) view.select([el.id]);
    view.ui.contextMenu(event, el);
  }

  // ------------------------------------------------------------ keyboard
  keydown(event) {
    if (!this.ownsKeys() || event.defaultPrevented || event.isComposing) return;
    const view = this.view;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const focus = view.widgetFocus && view.byId.get(view.widgetFocus.id);
    if (focus && WIDGETS[focus.kind] && WIDGETS[focus.kind].key && !ctrl && WIDGETS[focus.kind].key(view, focus, event)) return;
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    if (event.key === ' ' && !ctrl) { if (!this.space) { this.space = true; this.cursor(); } handled(); return; }
    if (ctrl && key === 'z' && !event.shiftKey) { handled(); view.undo(); return; }
    if (ctrl && (key === 'y' || (key === 'z' && event.shiftKey))) { handled(); view.redo(); return; }
    if (ctrl && key === 'a') { handled(); view.select(view.doc.elements.filter((el) => this.selectable(el)).map((el) => el.id)); return; }
    if (ctrl && key === 'd') { handled(); if (view.selection.size) view.change(() => { const copies = this.duplicate(view.selected, 24, true); view.select(copies.map((el) => el.id)); }); return; }
    if (ctrl && key === 'g') { handled(); view.ui.group(!event.shiftKey); return; }
    if (ctrl && key === 'l') { handled(); view.ui.toggleLock(); return; }
    if (ctrl && (key === ']' || key === '[')) { handled(); view.ui.order(key === ']' ? (event.shiftKey ? 'front' : 'up') : (event.shiftKey ? 'back' : 'down')); return; }
    if (ctrl && (key === '=' || key === '+')) { handled(); view.zoomBy(1.25); return; }
    if (ctrl && key === '-') { handled(); view.zoomBy(0.8); return; }
    if (ctrl && key === '0') { handled(); view.zoomAt(view.stageRect().left + view.stageRect().width / 2, view.stageRect().top + view.stageRect().height / 2, 1, true); return; }
    if (ctrl || event.altKey) return;
    if (event.shiftKey && key === '!' || (event.shiftKey && event.code === 'Digit1')) { handled(); view.zoomToFit(); return; }
    if (event.shiftKey && (event.code === 'Digit2')) { handled(); view.zoomToSelection(); return; }
    if (event.key === 'Escape') {
      handled();
      if (this.tool !== 'select') this.setTool('select');
      else if (view.interacting) { const el = view.byId.get(view.interacting); view.interacting = null; if (el) view.redraw(el); }
      else view.clearSelection();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && view.selection.size) {
      handled();
      const ids = view.selected.filter((el) => !el.locked).map((el) => el.id);
      if (ids.length) view.change(() => view.remove(ids));
      else toast('Éléments verrouillés : déverrouillez-les pour les supprimer.');
      return;
    }
    if (event.key.startsWith('Arrow') && view.selection.size) {
      handled();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      view.change(() => { for (const el of view.selected) { if (el.locked) continue; view.touch(el); if (el.kind === 'connector') { if (!el.from.id) { el.from.x += dx; el.from.y += dy; } if (!el.to.id) { el.to.x += dx; el.to.y += dy; } } else { el.x += dx; el.y += dy; } } });
      return;
    }
    if ((event.key === 'Enter' || event.key === 'F2') && view.selection.size === 1) { handled(); view.editElement(view.selected[0]); return; }
    // Typing on one selected sticky, shape or text replaces its text.
    if (event.key.length === 1 && view.selection.size === 1 && ['sticky', 'shape', 'text', 'mdcard'].includes(view.selected[0].kind) && !view.selected[0].locked) {
      handled();
      view.editField(view.selected[0], 'text', { initial: event.key });
      return;
    }
    const tool = TOOL_KEYS[key];
    if (tool && !event.shiftKey) {
      handled();
      if (key === 'o') this.setTool('shape', { shape: 'ellipse' });
      else if (key === 'r') this.setTool('shape', { shape: 'rect' });
      else this.setTool(tool);
    }
  }

  // ----------------------------------------------------------- clipboard
  // Copies of `elements` (and the lines between them), offset by `shift`.
  duplicate(elements, shift, select) {
    const view = this.view;
    const ids = new Set(elements.map((el) => el.id));
    const links = view.doc.elements.filter((el) => el.kind === 'connector' && !ids.has(el.id) && ids.has(el.from.id) && ids.has(el.to.id));
    const copies = this.instantiate([...elements, ...links].map((el) => Board.clone(el)), shift, shift);
    if (select) view.select(copies.map((el) => el.id));
    return copies;
  }

  // Add copies of serialised elements, with new ids, offset by (dx, dy).
  instantiate(list, dx, dy) {
    const view = this.view;
    const map = new Map(); const groups = new Map();
    for (const item of list) map.set(item.id, Board.newId());
    const out = [];
    for (const item of list) {
      const el = Board.create(item.kind, { ...item, id: map.get(item.id) });
      if (el.group) { if (!groups.has(el.group)) groups.set(el.group, Board.newId()); el.group = groups.get(el.group); }
      if (!view.doc.layers.some((layer) => layer.id === el.layer)) el.layer = 'base';
      if (el.kind === 'connector') {
        for (const end of [el.from, el.to]) {
          if (end.id && map.has(end.id)) end.id = map.get(end.id);
          else if (end.id) { const target = view.byId.get(end.id); if (!target) delete end.id; }
          if (!end.id) { end.x += dx; end.y += dy; }
        }
      } else { el.x += dx; el.y += dy; }
      out.push(el);
    }
    // Frames go under the rest.
    for (const el of out.filter((item) => item.kind === 'frame' || item.kind === 'grid')) view.add(el, 0);
    for (const el of out.filter((item) => item.kind !== 'frame' && item.kind !== 'grid')) view.add(el);
    return out;
  }

  copy(event, cut) {
    if (!this.ownsKeys() || !this.view.selection.size) return;
    const view = this.view;
    const elements = view.selected;
    const ids = new Set(elements.map((el) => el.id));
    const links = view.doc.elements.filter((el) => el.kind === 'connector' && !ids.has(el.id) && ids.has(el.from.id) && ids.has(el.to.id));
    const payload = { opaleBoard: 1, elements: [...elements, ...links].map((el) => Board.clone(el)) };
    this.clipboard = payload;
    event.preventDefault();
    event.clipboardData.setData('text/plain', JSON.stringify(payload));
    event.clipboardData.setData(MARK, JSON.stringify(payload));
    if (cut) view.change(() => view.remove([...ids].filter((id) => !view.byId.get(id).locked)));
    toast(cut ? 'Coupé' : `${payload.elements.length} élément${payload.elements.length > 1 ? 's' : ''} copié${payload.elements.length > 1 ? 's' : ''}`);
  }

  paste(event) {
    if (!this.ownsKeys() || this.view.readOnly) return;
    const view = this.view;
    const data = event.clipboardData;
    if (!data) return;
    event.preventDefault();
    const files = [...data.files];
    if (files.length) { view.ui.dropFiles(files, this.pointerWorld()); return; }
    let payload = null;
    const raw = data.getData(MARK) || data.getData('text/plain');
    try { const parsed = JSON.parse(raw); if (parsed && parsed.opaleBoard && Array.isArray(parsed.elements)) payload = parsed; } catch {}
    if (payload) {
      const box = Board.union(payload.elements.filter((el) => el.kind !== 'connector').map((el) => Board.bounds(Board.create(el.kind, el))));
      const at = this.pointerWorld();
      const dx = box ? at.x - (box.x + box.w / 2) : 24; const dy = box ? at.y - (box.y + box.h / 2) : 24;
      view.change(() => { const copies = this.instantiate(payload.elements, dx, dy); view.select(copies.map((el) => el.id)); });
      return;
    }
    const text = data.getData('text/plain').trim();
    if (!text) return;
    view.ui.pasteText(text, this.pointerWorld());
  }

  pointerWorld() {
    const view = this.view; const p = this.lastPointer;
    const r = view.stageRect();
    if (p && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) return view.toWorld(p.x, p.y);
    return view.viewCenter();
  }

  // --------------------------------------------------------- drag & drop
  dragover(event) {
    const types = [...(event.dataTransfer ? event.dataTransfer.types : [])];
    if (types.includes('Files') || types.includes(MARK) || types.includes('text/x-opale-path') || types.includes('application/x-opale-path')) {
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
    }
  }
  drop(event) {
    const view = this.view;
    const at = view.toWorld(event.clientX, event.clientY);
    const transfer = event.dataTransfer;
    if (!transfer || view.readOnly) return;
    const item = transfer.getData(MARK);
    if (item) {
      event.preventDefault(); event.stopPropagation();
      try { const parsed = JSON.parse(item); if (parsed.opaleBoard && Array.isArray(parsed.elements)) { const elements = view.change(() => this.instantiate(parsed.elements, at.x, at.y)); view.select(elements.map((el) => el.id)); } else if (Board.KINDS[parsed.kind]) view.ui.placeItem(parsed, at); } catch { toast('Élément déposé illisible.'); }
      return;
    }
    const path = transfer.getData('text/x-opale-path') || transfer.getData('application/x-opale-path');
    if (path) { event.preventDefault(); event.stopPropagation(); view.ui.addVaultFiles(path.split('\n').filter(Boolean), at); return; }
    const files = [...transfer.files];
    if (files.length) { event.preventDefault(); event.stopPropagation(); view.ui.dropFiles(files, at); }
  }
}

// What a copy of an element keeps of its content.
function KIND_DATA(el) {
  const data = Board.clone(el.data);
  if ('text' in data) data.text = '';
  return data;
}
export { MARK, place };
