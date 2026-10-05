// Opale — undo and redo for a moodboard. Every change runs inside a
// transaction: the first time an element is touched its state before the
// change is kept, and at the end its state after. Undo puts the "before"
// states back, redo the "after" ones. Only what a change touched is copied,
// so a board with thousands of drawings stays light.
const Board = window.OpaleBoard;
const LIMIT = 400;

export class History {
  constructor(view) {
    this.view = view;
    this.undoStack = []; this.redoStack = [];
    this.tx = null;
  }

  get open() { return !!this.tx; }

  begin(label = '') {
    if (this.tx) { this.tx.depth++; return; }
    this.tx = { label, depth: 1, before: new Map(), order: null, meta: null };
  }

  // Call before changing `el` (or before removing it).
  capture(el) {
    if (!this.tx || this.tx.before.has(el.id)) return;
    this.tx.before.set(el.id, Board.clone(el));
  }
  // An element about to be added: it did not exist before.
  captureNew(id) { if (this.tx && !this.tx.before.has(id)) this.tx.before.set(id, null); }
  captureOrder() { if (this.tx && !this.tx.order) this.tx.order = this.view.doc.elements.map((el) => el.id); }
  captureMeta() {
    if (this.tx && !this.tx.meta) this.tx.meta = Board.clone({ layers: this.view.doc.layers, settings: this.view.doc.settings, vote: this.view.doc.vote });
  }

  commit() {
    const tx = this.tx;
    if (!tx) return false;
    if (--tx.depth > 0) return false;
    this.tx = null;
    const doc = this.view.doc;
    const byId = new Map(doc.elements.map((el) => [el.id, el]));
    const after = new Map();
    let changed = false;
    for (const [id, before] of tx.before) {
      const now = byId.get(id) || null;
      const copy = now ? Board.clone(now) : null;
      after.set(id, copy);
      if (JSON.stringify(before) !== JSON.stringify(copy)) changed = true;
    }
    const orderAfter = tx.order ? doc.elements.map((el) => el.id) : null;
    if (tx.order && tx.order.join() !== orderAfter.join()) changed = true;
    const metaAfter = tx.meta ? Board.clone({ layers: doc.layers, settings: doc.settings, vote: doc.vote }) : null;
    if (tx.meta && JSON.stringify(tx.meta) !== JSON.stringify(metaAfter)) changed = true;
    if (!changed) return false;
    this.undoStack.push({ label: tx.label, before: tx.before, after, orderBefore: tx.order, orderAfter, metaBefore: tx.meta, metaAfter });
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }

  // Forget an open transaction, putting everything it touched back.
  cancel() {
    const tx = this.tx;
    if (!tx) return;
    this.tx = null;
    this.apply(tx.before, tx.order, tx.meta);
  }

  // Take back the last step if it only changed `id` (an item just added and
  // left empty), without leaving it to redo.
  dropLast(id) {
    const step = this.undoStack[this.undoStack.length - 1];
    if (!step || step.before.size !== 1 || !step.before.has(id)) return null;
    this.undoStack.pop();
    return this.apply(step.before, step.orderBefore, step.metaBefore);
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    if (this.tx) this.cancel();
    const step = this.undoStack.pop();
    if (!step) return null;
    this.redoStack.push(step);
    return this.apply(step.before, step.orderBefore, step.metaBefore);
  }

  redo() {
    if (this.tx) this.cancel();
    const step = this.redoStack.pop();
    if (!step) return null;
    this.undoStack.push(step);
    return this.apply(step.after, step.orderAfter, step.metaAfter);
  }

  // Put states back: `states` maps id -> element (or null: not there).
  apply(states, order, meta) {
    const doc = this.view.doc;
    const byId = new Map(doc.elements.map((el) => [el.id, el]));
    const touched = new Set();
    for (const [id, state] of states) {
      touched.add(id);
      if (state) byId.set(id, Board.clone(state));
      else byId.delete(id);
    }
    let ids = order ? order.slice() : doc.elements.map((el) => el.id);
    // Elements brought back without a recorded order go where they were last.
    for (const [id, state] of states) if (state && !ids.includes(id)) ids.push(id);
    ids = ids.filter((id) => byId.has(id));
    doc.elements = ids.map((id) => byId.get(id));
    if (meta) { doc.layers = Board.clone(meta.layers); doc.settings = Board.clone(meta.settings); doc.vote = Board.clone(meta.vote); }
    return { ids: [...touched].filter((id) => byId.has(id)), removed: [...touched].filter((id) => !byId.has(id)), meta: !!meta };
  }
}
