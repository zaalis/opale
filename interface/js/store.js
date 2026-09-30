// Opale — the interface's copy of the vault index. The server owns the truth;
// every change arrives over the event stream and is folded in here.
import { api, bus, Meta } from './core.js';

export const store = {
  files: new Map(),
  folders: [],
  _resolver: null,
  _inbound: null,
  _texts: new Map(),

  async load() {
    const index = await api('/api/index');
    this.files = new Map(index.files.map((entry) => [entry.path, entry]));
    this.folders = index.folders;
    this._invalidate();
  },

  apply(change) {
    for (const path of change.removes || []) { this.files.delete(path); this._texts.delete(path); }
    for (const entry of change.upserts || []) { this.files.set(entry.path, entry); this._texts.delete(entry.path); }
    if (change.folders) this.folders = change.folders;
    this._invalidate();
    bus.emit('index', change);
  },

  _invalidate() { this._resolver = null; this._inbound = null; },

  get resolver() {
    if (!this._resolver) this._resolver = Meta.buildResolver([...this.files.keys()]);
    return this._resolver;
  },
  resolve(target, source) { return this.resolver.resolve(target, source || null); },
  linkText(path) { return this.resolver.linkText(path); },
  has(path) { return this.files.has(path); },
  notes() { return [...this.files.values()].filter((entry) => entry.kind === 'note'); },

  // path -> Set of notes linking to it
  inbound() {
    if (!this._inbound) {
      const map = new Map();
      for (const note of this.notes()) {
        for (const link of note.meta.links) {
          const target = this.resolve(link.target, note.path);
          if (!target || target === note.path) continue;
          if (!map.has(target)) map.set(target, new Set());
          map.get(target).add(note.path);
        }
      }
      this._inbound = map;
    }
    return this._inbound;
  },
  backlinkCount(path) { const set = this.inbound().get(path); return set ? set.size : 0; },

  tags() {
    const counts = new Map();
    for (const note of this.notes()) {
      for (const tag of note.meta.tags) {
        const key = tag.toLowerCase();
        const current = counts.get(key) || { tag, count: 0 };
        current.count++; counts.set(key, current);
      }
    }
    return [...counts.values()];
  },

  // Note text for embeds and hover previews, cached until the file changes.
  async text(path) {
    const entry = this.files.get(path);
    const cached = this._texts.get(path);
    if (cached && entry && cached.mtime === entry.mtime) return cached.content;
    const note = await api(`/api/note?path=${encodeURIComponent(path)}`);
    this._texts.set(path, { mtime: note.mtime, content: note.content });
    return note.content;
  },

  renderContext(sourcePath, extra = {}) {
    return { resolve: (target) => this.resolve(target, sourcePath), fileUrl: (path) => `/api/file?path=${encodeURIComponent(path)}`, sourcePath, ...extra };
  },
};
