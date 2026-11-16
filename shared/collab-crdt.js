// Opale — shared projects: the replicated document model. The same code runs
// in the interface (where people edit) and in the server (which keeps the
// local copy and the Drive copy). Nothing here talks to the network.
//
// A project is one replica holding three kinds of data:
//   - texts: a sequence of characters, each with a permanent identifier
//     `lamport@actor` (RGA). Inserting names the character to the left;
//     concurrent insertions at the same place are ordered by identifier, so
//     every computer ends with the same text whatever the arrival order.
//     Deleting marks a character; the mark is per participant so that one
//     person's undo never brings back what someone else deleted.
//   - registers: one value per (object, field), last writer wins by
//     (lamport, actor). A write remembers the version it replaced, so two
//     writes made without seeing each other are reported as a conflict
//     instead of disappearing silently.
//   - the version vector: for each actor (one per computer and project), the
//     number of its changes already applied.
//
// A change = { a: actor, s: seq, l: first lamport, d: dependencies (version
// vector of the author when it was made), t: time, o: [operations] }.
// A change is applied only after the author's previous change and its
// dependencies: changes may arrive in any order, twice, or long after.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OpaleCrdt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SEP = '\u0001';
  const MAX_CONFLICTS = 200;
  const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
  const TEXT_FIELDS = new Set(['text', 'label', 'title', 'code', 'description', 'source', 'question', 'front', 'back', 'notes']);
  const TEXT_MARK = '$text';

  function cmp(al, aa, bl, ba) {
    if (al !== bl) return al < bl ? -1 : 1;
    return aa < ba ? -1 : aa > ba ? 1 : 0;
  }
  const idOf = (l, a) => `${l}@${a}`;
  function splitId(id) { const at = id.indexOf('@'); return [Number(id.slice(0, at)), id.slice(at + 1)]; }
  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  // JSON with sorted keys: two equal values always give the same text.
  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value === undefined ? null : value);
  }
  const same = (a, b) => stable(a) === stable(b);
  function newId() {
    const bytes = new Uint8Array(9);
    (globalThis.crypto || require('crypto').webcrypto).getRandomValues(bytes);
    return Date.now().toString(36).slice(-6) + [...bytes].map((byte) => (byte % 36).toString(36)).join('');
  }
  const opCost = (op) => (op.k === 'ins' ? op.s.length : 1);

  // ------------------------------------------------------------------ texts
  class Text {
    constructor() { this.items = []; this.byId = new Map(); this.cache = null; }

    toString() {
      if (this.cache === null) { let out = ''; for (const item of this.items) if (!item.x) out += item.c; this.cache = out; }
      return this.cache;
    }
    visibleItems() { return this.items.filter((item) => !item.x); }

    // Insert `s` (one character per lamport tick) after the character `o`.
    integrate(l, a, s, o) {
      const items = this.items;
      let origin = o;
      let at = -1;
      for (let i = 0; i < s.length; i++) {
        const id = idOf(l + i, a);
        if (this.byId.has(id)) { origin = id; at = -1; continue; }
        let idx;
        if (!origin) idx = 0;
        else if (at >= 0 && items[at] && items[at].id === origin) idx = at + 1;
        else {
          const item = this.byId.get(origin);
          // A missing origin cannot happen with causal delivery; if a damaged
          // change names one, every computer puts the text at the start alike.
          idx = item ? items.indexOf(item) + 1 : 0;
        }
        while (idx < items.length && cmp(items[idx].l, items[idx].a, l + i, a) > 0) idx++;
        const item = { id, l: l + i, a, c: s[i], o: origin || null, d: null, x: false };
        items.splice(idx, 0, item);
        this.byId.set(id, item);
        origin = id; at = idx;
      }
      this.cache = null;
    }

    // `on`: deleted by `actor` (true) or its own deletion undone (false).
    mark(id, actor, on, l) {
      const item = this.byId.get(id);
      if (!item) return false;
      const marks = item.d || (item.d = {});
      const current = marks[actor];
      if (current && current[1] >= l) return false;
      marks[actor] = [on ? 1 : 0, l];
      const was = item.x;
      item.x = Object.values(marks).some((entry) => entry[0] === 1);
      if (was !== item.x) this.cache = null;
      return true;
    }

    // Caret positions that survive other people's edits: the identifier of
    // the character just left of the caret ('' at the start).
    anchorAt(index) {
      if (index <= 0) return '';
      let seen = 0;
      for (const item of this.items) { if (item.x) continue; seen++; if (seen === index) return item.id; }
      const last = this.visibleItems().pop();
      return last ? last.id : '';
    }
    indexOfAnchor(anchor) {
      if (!anchor) return 0;
      const target = this.byId.get(anchor);
      if (!target) return null;
      let count = 0;
      for (const item of this.items) { if (!item.x) count++; if (item === target) return count; }
      return count;
    }

    // Consecutive characters typed in one go are stored as one run.
    runs() {
      const out = []; let run = null; let last = null;
      for (const item of this.items) {
        const marks = item.d && Object.keys(item.d).length ? item.d : 0;
        if (run && item.a === run[1] && item.l === last.l + 1 && item.o === last.id && same(marks, run[4] || 0)) { run[2] += item.c; last = item; continue; }
        run = [item.l, item.a, item.c, item.o, marks]; out.push(run); last = item;
      }
      return out.map((entry) => (entry[4] ? entry : entry.slice(0, 4)));
    }
  }

  // ------------------------------------------------------------- validation
  function validOp(op) {
    if (!op || typeof op !== 'object') return false;
    if (op.k === 'reg') return typeof op.o === 'string' && typeof op.f === 'string' && op.o.length < 300 && op.f.length < 120 && !FORBIDDEN.has(op.f) && (op.p === null || op.p === undefined || (Array.isArray(op.p) && op.p.length === 2));
    if (op.k === 'ins') return typeof op.x === 'string' && typeof op.s === 'string' && op.s.length > 0 && op.s.length <= 2000000 && (op.r === null || op.r === undefined || typeof op.r === 'string');
    if (op.k === 'del' || op.k === 'und') return typeof op.x === 'string' && Array.isArray(op.i) && op.i.every((id) => typeof id === 'string');
    return false;
  }
  function validChange(change) {
    return !!change && typeof change === 'object' && typeof change.a === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(change.a)
      && Number.isInteger(change.s) && change.s >= 1 && Number.isInteger(change.l) && change.l >= 1
      && change.d && typeof change.d === 'object' && Object.entries(change.d).every(([key, value]) => /^[A-Za-z0-9_-]{4,64}$/.test(key) && Number.isInteger(value) && value >= 0)
      && Array.isArray(change.o) && change.o.length > 0 && change.o.every(validOp);
  }
  // What the signature covers: the change without its signature.
  function signedText(change) {
    return stable({ a: change.a, s: change.s, l: change.l, d: change.d, t: change.t, o: change.o });
  }

  const effectsNew = () => ({ texts: new Set(), objs: new Set() });

  // ---------------------------------------------------------------- replica
  class Replica {
    constructor(actor) {
      this.actor = actor || '';
      this.vv = {}; this.lamport = 0;
      this.texts = new Map(); this.regs = new Map(); this.objs = new Map();
      this.pending = new Map();
      this.conflicts = [];
      this.listeners = new Set();
    }

    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    _emit(effects, changes, local) { for (const fn of [...this.listeners]) { try { fn(effects, changes, local); } catch (error) { if (typeof console !== 'undefined') console.error(error); } } }

    text(key) { return this.texts.get(key) || null; }
    textOf(key) { const text = this.texts.get(key); return text ? text.toString() : ''; }
    _text(key) { let text = this.texts.get(key); if (!text) { text = new Text(); this.texts.set(key, text); } return text; }
    reg(obj, field) { return this.regs.get(obj + SEP + field) || null; }
    get(obj, field) { const reg = this.reg(obj, field); return reg && 'v' in reg ? reg.v : undefined; }
    fields(obj) {
      const names = this.objs.get(obj);
      if (!names) return null;
      const out = {};
      for (const field of names) { const reg = this.regs.get(obj + SEP + field); if (reg && 'v' in reg) out[field] = reg.v; }
      return out;
    }
    objects(prefix) { const out = []; for (const obj of this.objs.keys()) if (obj.startsWith(prefix)) out.push(obj); return out; }

    has(change) { return (this.vv[change.a] || 0) >= change.s; }
    ready(change) {
      if ((this.vv[change.a] || 0) !== change.s - 1) return false;
      for (const [actor, seq] of Object.entries(change.d || {})) if (actor !== change.a && (this.vv[actor] || 0) < seq) return false;
      return true;
    }
    // Changes waiting for an earlier one: what to ask other computers for.
    missing() {
      const want = {};
      for (const change of this.pending.values()) {
        if ((this.vv[change.a] || 0) < change.s - 1) want[change.a] = Math.max(want[change.a] || 0, change.s - 1);
        for (const [actor, seq] of Object.entries(change.d || {})) if ((this.vv[actor] || 0) < seq) want[actor] = Math.max(want[actor] || 0, seq);
      }
      return want;
    }

    // Changes from elsewhere. Returns the ones applied now (in order).
    receive(list) {
      for (const change of list || []) {
        if (!validChange(change) || this.has(change)) continue;
        this.pending.set(`${change.a}:${change.s}`, change);
      }
      const applied = []; const effects = effectsNew();
      let progress = true;
      while (progress && this.pending.size) {
        progress = false;
        const queue = [...this.pending.values()].sort((x, y) => x.l - y.l || x.s - y.s);
        for (const change of queue) {
          const key = `${change.a}:${change.s}`;
          if (this.has(change)) { this.pending.delete(key); continue; }
          if (!this.ready(change)) continue;
          this.pending.delete(key);
          this._apply(change, effects);
          applied.push(change); progress = true;
        }
      }
      if (applied.length) this._emit(effects, applied, false);
      return applied;
    }

    // A change made here. Returns it, with what undo needs to know.
    local(ops) {
      const list = (ops || []).filter(Boolean);
      if (!list.length) return null;
      const deps = {};
      for (const [actor, seq] of Object.entries(this.vv)) if (actor !== this.actor && seq > 0) deps[actor] = seq;
      const change = { a: this.actor, s: (this.vv[this.actor] || 0) + 1, l: this.lamport + 1, d: deps, t: Date.now(), o: list };
      if (!validChange(change)) throw new Error('Modification invalide.');
      const undo = this._undoInfo(change);
      const effects = effectsNew();
      this._apply(change, effects);
      this._emit(effects, [change], true);
      return { change, undo };
    }

    _apply(change, effects) {
      let l = change.l;
      for (const op of change.o) {
        if (op.k === 'reg') this._reg(op, l, change, effects);
        else if (op.k === 'ins') { this._text(op.x).integrate(l, change.a, op.s, op.r || null); effects.texts.add(op.x); }
        else { const text = this._text(op.x); for (const id of op.i) text.mark(id, change.a, op.k === 'del', l); effects.texts.add(op.x); }
        l += opCost(op);
      }
      this.lamport = Math.max(this.lamport, l - 1);
      this.vv[change.a] = change.s;
    }

    _reg(op, l, change, effects) {
      const key = op.o + SEP + op.f;
      const current = this.regs.get(key);
      const next = { l, a: change.a, p: op.p || null };
      if ('v' in op) next.v = op.v;
      if (current) {
        if (current.l === l && current.a === change.a) return;
        const sequential = op.p && op.p[0] === current.l && op.p[1] === current.a;
        const wins = cmp(l, change.a, current.l, current.a) > 0;
        if (!sequential) this._conflict(op.o, op.f, wins ? next : current, wins ? current : next, change);
        if (!wins) return;
      }
      this.regs.set(key, next);
      let names = this.objs.get(op.o);
      if (!names) { names = new Set(); this.objs.set(op.o, names); }
      names.add(op.f);
      effects.objs.add(op.o);
    }

    _conflict(obj, field, win, lose, change) {
      // Two writes of the same value are not a disagreement.
      if (same(win.v, lose.v)) return;
      this.conflicts.push({ obj, field, win: { v: clone(win.v), a: win.a, l: win.l }, lose: { v: clone(lose.v), a: lose.a, l: lose.l }, t: change.t || 0 });
      if (this.conflicts.length > MAX_CONFLICTS) this.conflicts.splice(0, this.conflicts.length - MAX_CONFLICTS);
    }

    // ------------------------------------------------------------- undo
    _undoInfo(change) {
      let l = change.l; const entries = [];
      for (const op of change.o) {
        if (op.k === 'reg') {
          const current = this.regs.get(op.o + SEP + op.f);
          entries.push({ k: 'reg', o: op.o, f: op.f, l, a: change.a, prev: current && 'v' in current ? { v: clone(current.v) } : null });
        } else if (op.k === 'ins') {
          const ids = []; for (let i = 0; i < op.s.length; i++) ids.push(idOf(l + i, change.a));
          entries.push({ k: 'ins', x: op.x, i: ids });
        } else entries.push({ k: op.k, x: op.x, i: op.i.slice() });
        l += opCost(op);
      }
      return entries;
    }

    // Operations that take back `entries` (one participant's own change),
    // leaving untouched what someone else has changed since.
    inverse(entries) {
      const ops = [];
      const created = new Set(entries.filter((entry) => entry.k === 'reg' && entry.f === '_del' && !entry.prev).map((entry) => entry.o));
      const mine = (item) => !!(item && item.d && item.d[this.actor] && item.d[this.actor][0] === 1);
      for (const entry of entries.slice().reverse()) {
        if (entry.k === 'reg') {
          // Undoing a creation only hides the object: what others added to it stays.
          if (created.has(entry.o) && entry.f !== '_del') continue;
          const current = this.regs.get(entry.o + SEP + entry.f);
          if (!current || current.l !== entry.l || current.a !== entry.a) continue;
          const op = { k: 'reg', o: entry.o, f: entry.f, p: [current.l, current.a] };
          if (entry.prev) op.v = clone(entry.prev.v);
          ops.push(op);
        } else {
          const text = this.texts.get(entry.x);
          if (!text) continue;
          if (entry.k === 'ins' || entry.k === 'und') {
            const ids = entry.i.filter((id) => { const item = text.byId.get(id); return item && !mine(item); });
            if (ids.length) ops.push({ k: 'del', x: entry.x, i: ids });
          } else {
            const ids = entry.i.filter((id) => mine(text.byId.get(id)));
            if (ids.length) ops.push({ k: 'und', x: entry.x, i: ids });
          }
        }
      }
      return ops;
    }

    // ----------------------------------------------------------- snapshots
    toState() {
      const regs = [];
      for (const [key, reg] of this.regs) {
        const at = key.indexOf(SEP);
        const row = [key.slice(0, at), key.slice(at + 1), reg.l, reg.a, reg.p || 0];
        if ('v' in reg) row.push(reg.v);
        regs.push(row);
      }
      const texts = [];
      for (const [key, text] of this.texts) texts.push([key, text.runs()]);
      return { v: 1, vv: { ...this.vv }, lamport: this.lamport, regs, texts };
    }

    // Merge a saved state (state-based: any order, any number of times).
    mergeState(state) {
      if (!state || state.v !== 1) throw new Error('Point de sauvegarde illisible.');
      const effects = effectsNew();
      for (const row of state.regs || []) {
        const [obj, field, l, a, p] = row;
        if (typeof obj !== 'string' || typeof field !== 'string' || FORBIDDEN.has(field)) continue;
        const key = obj + SEP + field;
        const current = this.regs.get(key);
        if (current && cmp(current.l, current.a, l, a) >= 0) continue;
        const next = { l, a, p: p || null };
        if (row.length > 5) next.v = row[5];
        this.regs.set(key, next);
        let names = this.objs.get(obj);
        if (!names) { names = new Set(); this.objs.set(obj, names); }
        names.add(field);
        effects.objs.add(obj);
      }
      for (const [key, runs] of state.texts || []) {
        const text = this._text(key);
        effects.texts.add(key);
        if (!text.items.length) {
          // Fast path: a saved text is already in document order.
          for (const [l, a, s, o, marks] of runs) {
            for (let i = 0; i < s.length; i++) {
              const item = { id: idOf(l + i, a), l: l + i, a, c: s[i], o: i ? idOf(l + i - 1, a) : (o || null), d: marks ? clone(marks) : null, x: false };
              if (item.d) item.x = Object.values(item.d).some((entry) => entry[0] === 1);
              text.items.push(item); text.byId.set(item.id, item);
            }
          }
          text.cache = null;
          continue;
        }
        for (const [l, a, s, o, marks] of runs) {
          text.integrate(l, a, s, o || null);
          if (marks) for (let i = 0; i < s.length; i++) for (const [actor, [on, at]] of Object.entries(marks)) text.mark(idOf(l + i, a), actor, on === 1, at);
        }
      }
      for (const [actor, seq] of Object.entries(state.vv || {})) this.vv[actor] = Math.max(this.vv[actor] || 0, seq);
      this.lamport = Math.max(this.lamport, state.lamport || 0);
      this._emit(effects, [], false);
      if (this.pending.size) this.receive([]);
    }

    static fromState(actor, state) { const replica = new Replica(actor); if (state) replica.mergeState(state); return replica; }
  }

  // Version vectors.
  const VV = {
    covers(big, small) { for (const [actor, seq] of Object.entries(small || {})) if ((big[actor] || 0) < seq) return false; return true; },
    max(a, b) { const out = { ...a }; for (const [actor, seq] of Object.entries(b || {})) out[actor] = Math.max(out[actor] || 0, seq); return out; },
    min(a, b) { const out = {}; for (const actor of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) out[actor] = Math.min((a || {})[actor] || 0, (b || {})[actor] || 0); return out; },
    total(vv) { return Object.values(vv || {}).reduce((sum, seq) => sum + seq, 0); },
  };

  // ============================================================== the model
  // Object keys:
  //   F:<file>                a note, board or folder: name, parent, kind, _del
  //   T:<file>                a note's text
  //   E:<file>:<element>      a board element: geometry, kind, z, d.<data>, s.<style>, _del
  //   T:<file>:<element>:<f>  the text of a board element's field
  //   M:<file>                a board's layers, settings and vote
  const K = {
    file: (id) => `F:${id}`, note: (id) => `T:${id}`, meta: (file) => `M:${file}`,
    el: (file, id) => `E:${file}:${id}`, elText: (file, id, field) => `T:${file}:${id}:${field}`,
  };
  const prevOf = (replica, obj, field) => { const reg = replica.reg(obj, field); return reg ? [reg.l, reg.a] : null; };
  const setOp = (replica, obj, field, value) => {
    const op = { k: 'reg', o: obj, f: field, p: prevOf(replica, obj, field) };
    if (value !== undefined) op.v = clone(value);
    return op;
  };

  // Text edits: what changed between the replica's text and `next`. Typing,
  // pasting and cutting all touch one stretch, found by common prefix/suffix.
  function textOps(replica, key, next) {
    const text = replica.text(key);
    const prev = text ? text.toString() : '';
    next = String(next == null ? '' : next);
    if (prev === next) return [];
    const max = Math.min(prev.length, next.length);
    let start = 0;
    while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
    let tail = 0;
    while (tail < max - start && prev.charCodeAt(prev.length - 1 - tail) === next.charCodeAt(next.length - 1 - tail)) tail++;
    const ops = [];
    const visible = text ? text.visibleItems() : [];
    if (prev.length - tail > start) ops.push({ k: 'del', x: key, i: visible.slice(start, prev.length - tail).map((item) => item.id) });
    const inserted = next.slice(start, next.length - tail);
    if (inserted) ops.push({ k: 'ins', x: key, r: start > 0 ? visible[start - 1].id : null, s: inserted });
    return ops;
  }

  // ----------------------------------------------------------------- files
  const KINDS = ['note', 'board', 'folder'];
  function fileRecord(replica, obj) {
    const fields = replica.fields(obj);
    if (!fields || fields._del !== false || !KINDS.includes(fields.kind)) return null;
    return { id: obj.slice(2), name: String(fields.name || 'Sans titre'), parent: String(fields.parent || ''), kind: fields.kind };
  }
  // The tree as people see it: every live file with its folder path. A file
  // whose folder was deleted meanwhile, or two folders moved into each other
  // at the same time, are shown at the top rather than lost.
  function listFiles(replica) {
    const byId = new Map();
    for (const obj of replica.objects('F:')) { const record = fileRecord(replica, obj); if (record) byId.set(record.id, record); }
    const parentOf = (record) => {
      const parent = byId.get(record.parent);
      return parent && parent.kind === 'folder' ? parent.id : '';
    };
    for (const record of byId.values()) {
      const seen = new Set([record.id]);
      let at = parentOf(record);
      while (at) {
        if (seen.has(at)) { record.parent = ''; break; }
        seen.add(at);
        at = parentOf(byId.get(at));
      }
      if (record.parent && !parentOf(record)) record.parent = '';
    }
    // Same name in the same folder: the later one shows a number.
    const groups = new Map();
    for (const record of byId.values()) {
      const key = `${record.parent}\u0000${record.kind === 'folder' ? 'd' : 'f'}\u0000${record.name.toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => { const ra = replica.reg(K.file(a.id), '_del'); const rb = replica.reg(K.file(b.id), '_del'); return cmp(ra.l, ra.a, rb.l, rb.a); });
      group.forEach((record, index) => { record.display = index ? `${record.name} (${index + 1})` : record.name; });
    }
    const pathOf = (record) => {
      const parts = [record.display];
      let at = record.parent; let guard = 0;
      while (at && guard++ < 200) { const parent = byId.get(at); if (!parent) break; parts.unshift(parent.display); at = parent.parent; }
      return parts.join('/');
    };
    for (const record of byId.values()) record.path = pathOf(record);
    return [...byId.values()].sort((a, b) => a.path.localeCompare(b.path, 'fr', { numeric: true, sensitivity: 'base' }));
  }

  function createFileOps(replica, { id, name, parent = '', kind, text = '' }) {
    const obj = K.file(id);
    const ops = [setOp(replica, obj, 'kind', kind), setOp(replica, obj, 'name', name), setOp(replica, obj, 'parent', parent), setOp(replica, obj, '_del', false)];
    if (kind === 'note' && text) ops.push(...textOps(replica, K.note(id), text));
    return ops;
  }
  function renameFileOps(replica, id, name) { return replica.get(K.file(id), 'name') === name ? [] : [setOp(replica, K.file(id), 'name', name)]; }
  function moveFileOps(replica, id, parent) { return replica.get(K.file(id), 'parent') === parent ? [] : [setOp(replica, K.file(id), 'parent', parent)]; }
  function deleteFileOps(replica, id) {
    const ops = [];
    const all = listFiles(replica);
    const doomed = new Set([id]);
    let grew = true;
    while (grew) { grew = false; for (const record of all) if (!doomed.has(record.id) && doomed.has(record.parent)) { doomed.add(record.id); grew = true; } }
    for (const target of doomed) if (replica.get(K.file(target), '_del') === false) ops.push(setOp(replica, K.file(target), '_del', true));
    return ops;
  }
  function restoreFileOps(replica, id) { return replica.get(K.file(id), '_del') === true ? [setOp(replica, K.file(id), '_del', false)] : []; }

  // ---------------------------------------------------------------- boards
  function flatten(el) {
    const out = {};
    for (const [key, value] of Object.entries(el || {})) if (key !== 'id' && key !== 'data' && key !== 'style' && value !== undefined) out[key] = value;
    for (const [key, value] of Object.entries((el && el.data) || {})) if (value !== undefined) out[`d.${key}`] = value;
    for (const [key, value] of Object.entries((el && el.style) || {})) if (value !== undefined) out[`s.${key}`] = value;
    return out;
  }
  const isTextField = (field, value) => field.startsWith('d.') && TEXT_FIELDS.has(field.slice(2)) && typeof value === 'string';

  function boardElement(replica, file, id) {
    const obj = K.el(file, id);
    const fields = replica.fields(obj);
    if (!fields || fields._del !== false || typeof fields.kind !== 'string') return null;
    const el = { id, data: {}, style: {} };
    for (const [field, value] of Object.entries(fields)) {
      if (field === '_del' || field === 'z') continue;
      if (field.startsWith('d.')) {
        const name = field.slice(2);
        el.data[name] = value && typeof value === 'object' && value[TEXT_MARK] ? replica.textOf(K.elText(file, id, name)) : clone(value);
      } else if (field.startsWith('s.')) el.style[field.slice(2)] = clone(value);
      else el[field] = clone(value);
    }
    return el;
  }
  const zOf = (replica, file, id) => { const z = replica.get(K.el(file, id), 'z'); return typeof z === 'number' && Number.isFinite(z) ? z : 0; };
  function boardIds(replica, file) {
    const prefix = `E:${file}:`;
    const ids = [];
    for (const obj of replica.objects(prefix)) if (replica.get(obj, '_del') === false) ids.push(obj.slice(prefix.length));
    return ids.sort((a, b) => zOf(replica, file, a) - zOf(replica, file, b) || (a < b ? -1 : a > b ? 1 : 0));
  }
  function boardDoc(replica, file) {
    const meta = replica.fields(K.meta(file)) || {};
    const elements = boardIds(replica, file).map((id) => boardElement(replica, file, id)).filter(Boolean);
    return {
      elements,
      layers: Array.isArray(meta.layers) && meta.layers.length ? clone(meta.layers) : [{ id: 'base', name: 'Calque 1', visible: true, locked: false }],
      settings: meta.settings && typeof meta.settings === 'object' ? clone(meta.settings) : { grid: 'dots', snap: true, privateMode: false },
      vote: meta.vote === undefined ? null : clone(meta.vote),
    };
  }

  // One element went from `before` to `after` (either may be null) here.
  // Only the fields this person changed are written, so a field someone
  // else changed meanwhile is not put back.
  function elementOps(replica, file, id, before, after) {
    const obj = K.el(file, id);
    const exists = replica.get(obj, '_del') === false;
    if (!after) return exists ? [setOp(replica, obj, '_del', true)] : [];
    const ops = [];
    const old = before ? flatten(before) : {};
    const next = flatten(after);
    const fresh = !exists && !before;
    for (const field of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (FORBIDDEN.has(field)) continue;
      const value = next[field];
      if (!fresh && field in old && field in next && same(old[field], value)) continue;
      if (isTextField(field, value)) {
        const current = replica.get(obj, field);
        if (!(current && typeof current === 'object' && current[TEXT_MARK])) ops.push(setOp(replica, obj, field, { [TEXT_MARK]: 1 }));
        const key = K.elText(file, id, field.slice(2));
        const shared = replica.textOf(key);
        // Typed elsewhere meanwhile: keep their text and apply this edit to it.
        const target = !fresh && typeof old[field] === 'string' && old[field] !== shared ? rebase(old[field], value, shared) : value;
        ops.push(...textOps(replica, key, target));
      } else if (!(field in next)) ops.push(setOp(replica, obj, field, undefined));
      else ops.push(setOp(replica, obj, field, value));
    }
    if (!exists) ops.push(setOp(replica, obj, '_del', false));
    return ops;
  }
  // Apply the edit before → after to `base`, when the edit's stretch is still
  // recognisable there; otherwise the edited text wins.
  function rebase(before, after, base) {
    let start = 0; const max = Math.min(before.length, after.length);
    while (start < max && before[start] === after[start]) start++;
    let tail = 0;
    while (tail < max - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
    const head = before.slice(0, start); const end = before.slice(before.length - tail);
    if (base.startsWith(head) && base.endsWith(end) && base.length >= head.length + end.length) return head + after.slice(start, after.length - tail) + end;
    const at = base.indexOf(head);
    if (head && at >= 0) { const rest = base.slice(at + head.length); const cut = end ? rest.indexOf(end) : rest.length; if (cut >= 0) return base.slice(0, at) + head + after.slice(start, after.length - tail) + rest.slice(cut); }
    return after;
  }

  // New stacking values for `order` (ids bottom to top), changing as few
  // elements as possible (those outside a longest increasing run).
  function orderOps(replica, file, order) {
    const zs = order.map((id) => { const z = replica.get(K.el(file, id), 'z'); return typeof z === 'number' && Number.isFinite(z) ? z : null; });
    const n = zs.length;
    const keep = new Array(n).fill(false);
    // Longest strictly increasing subsequence over defined values.
    const tails = []; const tailIdx = []; const prev = new Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      if (zs[i] === null) continue;
      let lo = 0; let hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < zs[i]) lo = mid + 1; else hi = mid; }
      tails[lo] = zs[i]; tailIdx[lo] = i; prev[i] = lo ? tailIdx[lo - 1] : -1;
    }
    for (let i = tails.length ? tailIdx[tails.length - 1] : -1; i >= 0; i = prev[i]) keep[i] = true;
    const values = zs.slice();
    let needFull = false;
    for (let i = 0; i < n; i++) {
      if (keep[i]) continue;
      const left = i > 0 ? values[i - 1] : null;
      let right = null;
      for (let j = i + 1; j < n; j++) if (keep[j]) { right = values[j]; break; }
      let z;
      if (left === null && right === null) z = 0;
      else if (left === null) z = right - 1;
      else if (right === null) z = left + 1;
      else z = (left + right) / 2;
      if ((left !== null && !(z > left)) || (right !== null && !(z < right)) || (left !== null && right !== null && right - left < 1e-9)) { needFull = true; break; }
      values[i] = z;
    }
    if (needFull) for (let i = 0; i < n; i++) values[i] = i;
    const ops = [];
    for (let i = 0; i < n; i++) if (values[i] !== zs[i]) ops.push(setOp(replica, K.el(file, order[i]), 'z', values[i]));
    return ops;
  }

  function metaOps(replica, file, before, after) {
    const ops = [];
    for (const field of ['layers', 'settings', 'vote']) {
      const value = after[field] === undefined ? null : after[field];
      if (before && same(before[field] === undefined ? null : before[field], value)) continue;
      if (!same(replica.get(K.meta(file), field), value)) ops.push(setOp(replica, K.meta(file), field, value));
    }
    return ops;
  }

  // A whole board written at once (a new board, an imported file).
  function boardDocOps(replica, file, doc) {
    const ops = [];
    for (const el of doc.elements || []) ops.push(...elementOps(replica, file, el.id, null, el));
    const order = (doc.elements || []).map((el) => el.id);
    ops.push(...metaOps(replica, file, null, doc));
    // Stacking: bottom to top as listed.
    order.forEach((id, index) => ops.push({ k: 'reg', o: K.el(file, id), f: 'z', p: null, v: index }));
    return ops;
  }

  // Undo history for one participant and one document.
  class UndoStack {
    constructor(limit = 300) { this.undo = []; this.redo = []; this.limit = limit; this.lastAt = 0; }
    // `merge`: typing in quick succession is one step.
    push(entries, merge = false) {
      if (!entries || !entries.length) return;
      const now = Date.now();
      const top = this.undo[this.undo.length - 1];
      if (merge && top && top.merge && now - this.lastAt < 700) top.entries.push(...entries);
      else this.undo.push({ entries: entries.slice(), merge });
      if (this.undo.length > this.limit) this.undo.shift();
      this.redo = [];
      this.lastAt = now;
    }
    seal() { const top = this.undo[this.undo.length - 1]; if (top) top.merge = false; }
    canUndo() { return this.undo.length > 0; }
    canRedo() { return this.redo.length > 0; }
  }

  return {
    Text, Replica, UndoStack, VV, K, TEXT_FIELDS, TEXT_MARK,
    cmp, idOf, splitId, clone, stable, same, newId, validChange, signedText,
    textOps, listFiles, fileRecord, createFileOps, renameFileOps, moveFileOps, deleteFileOps, restoreFileOps,
    flatten, boardElement, boardIds, boardDoc, elementOps, orderOps, metaOps, boardDocOps, rebase,
  };
});
