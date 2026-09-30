'use strict';

// A vault is a plain folder of Markdown files. This module owns every read and
// write inside it, keeps an in-memory index (links, tags, headings) in step
// with the disk, and reports each change so the interface and the MCP tools
// always describe the same state.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { execFileSync } = require('child_process');
const Meta = require('../shared/meta.js');

const CONFIG_DIR = '.opale';
const TRASH_DIR = '.trash';
const MAX_INDEXED_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const DEFAULT_SETTINGS = Object.freeze({
  theme: 'dark',
  accent: '#fbbf24',
  fontSize: 16,
  readableLineLength: true,
  defaultMode: 'live',
  spellcheck: false,
  showProperties: true,
  newNoteLocation: 'root',
  newNoteFolder: '',
  attachmentLocation: 'folder',
  attachmentFolder: 'Pièces jointes',
  trash: 'local',
  autoUpdateLinks: true,
  explorerSort: 'name-asc',
  dailyFolder: 'Journal',
  dailyFormat: 'YYYY-MM-DD',
  dailyTemplate: '',
  templateFolder: 'Modèles',
  graph: { tags: false, attachments: false, orphans: true, unresolved: true, repel: 60, link: 60, center: 40 },
});

class VaultError extends Error {
  constructor(message, status = 400, code = 'invalid') { super(message); this.status = status; this.code = code; }
}

// Validate a vault-relative path. Hidden segments (".opale", ".git", ".trash")
// are off limits to every caller unless explicitly allowed.
function cleanRelative(input, options = {}) {
  if (typeof input !== 'string') throw new VaultError('Chemin invalide.');
  const raw = input.replace(/\\/g, '/').trim();
  if (/^[a-zA-Z]:/.test(raw) || raw.startsWith('/')) throw new VaultError('Le chemin doit être relatif au coffre.');
  const parts = raw.split('/').filter((part) => part !== '' && part !== '.');
  if (!parts.length) { if (options.allowRoot) return ''; throw new VaultError('Chemin vide.'); }
  for (const part of parts) {
    if (part === '..') throw new VaultError('Le chemin sort du coffre.', 403, 'outside');
    if (/[<>:"|?*\u0000-\u001f]/.test(part)) throw new VaultError(`Caractère interdit dans « ${part} ».`);
    if (/[. ]$/.test(part)) throw new VaultError('Un nom ne peut pas finir par un point ou un espace.');
    if (RESERVED_NAME.test(part)) throw new VaultError(`« ${part} » est un nom réservé par Windows.`);
    if (!options.allowHidden && part.startsWith('.')) throw new VaultError('Les fichiers et dossiers cachés sont réservés à Opale.', 403, 'hidden');
    if (part.length > 240) throw new VaultError('Nom trop long.');
  }
  return parts.join('/');
}

function atomicWrite(file, data) {
  const temp = path.join(path.dirname(file), `.~${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(temp, data);
  try { fs.renameSync(temp, file); }
  catch {
    // The target is held open by another program: write in place instead.
    try { fs.writeFileSync(file, data); } finally { fs.rmSync(temp, { force: true }); }
  }
}

function mtimeOf(stat) { return Math.round(stat.mtimeMs); }

class Vault extends EventEmitter {
  constructor(root) {
    super();
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) throw new VaultError('Le coffre doit être un dossier.');
    this.root = fs.realpathSync(root);
    this.name = path.basename(this.root) || this.root;
    this.files = new Map();
    this.folders = new Set();
    this.texts = new Map();
    this._resolver = null; this._lower = null;
    this._pending = new Set(); this._timer = null; this._watcher = null;
    this.settings = this._loadSettings();
    this.scan();
  }

  // ------------------------------------------------------------ path safety
  abs(rel, options) {
    const clean = cleanRelative(rel, options);
    const full = clean ? path.join(this.root, ...clean.split('/')) : this.root;
    this._assertInside(full);
    return full;
  }

  // Follow the deepest existing ancestor through symlinks and junctions: a
  // link planted inside the vault must not lead a write outside of it.
  _assertInside(full) {
    let probe = full;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    const real = fs.realpathSync(probe);
    const rootKey = this.root.toLowerCase(); const realKey = real.toLowerCase();
    if (realKey !== rootKey && !realKey.startsWith(rootKey + path.sep)) throw new VaultError('Le chemin sort du coffre.', 403, 'outside');
  }

  _lowerMaps() {
    if (!this._lower) {
      const files = new Map(); const folders = new Map();
      for (const key of this.files.keys()) files.set(key.toLowerCase(), key);
      for (const key of this.folders) folders.set(key.toLowerCase(), key);
      this._lower = { files, folders };
    }
    return this._lower;
  }

  // Windows paths are case-insensitive: map a request onto the spelling that
  // is already indexed so one file never ends up under two keys.
  canonical(rel) {
    const maps = this._lowerMaps();
    const lower = rel.toLowerCase();
    if (maps.files.has(lower)) return maps.files.get(lower);
    if (maps.folders.has(lower)) return maps.folders.get(lower);
    const parts = rel.split('/');
    for (let i = parts.length - 1; i > 0; i--) {
      const folder = maps.folders.get(parts.slice(0, i).join('/').toLowerCase());
      if (folder) return `${folder}/${parts.slice(i).join('/')}`;
    }
    return rel;
  }

  get resolver() {
    if (!this._resolver) this._resolver = Meta.buildResolver([...this.files.keys()]);
    return this._resolver;
  }
  resolveLink(target, source) { return this.resolver.resolve(target, source); }

  // Accept an exact path, a path without ".md", or a bare note name.
  locate(reference) {
    const raw = String(reference == null ? '' : reference).replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!raw) return null;
    const maps = this._lowerMaps();
    for (const candidate of [raw, `${raw}.md`]) {
      const hit = maps.files.get(candidate.toLowerCase());
      if (hit) return hit;
    }
    if (maps.folders.has(raw.replace(/\/+$/, '').toLowerCase())) return maps.folders.get(raw.replace(/\/+$/, '').toLowerCase());
    return this.resolver.resolve(raw, null);
  }
  isFolder(rel) { return this._lowerMaps().folders.has(String(rel).toLowerCase()); }

  // ------------------------------------------------------------------ index
  scan() {
    this.files.clear(); this.folders.clear(); this.texts.clear();
    this._walk('', []);
    this._invalidate();
  }

  _walk(rel, added) {
    let entries;
    try { entries = fs.readdirSync(rel ? path.join(this.root, ...rel.split('/')) : this.root, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { this.folders.add(child); this._walk(child, added); }
      else if (entry.isFile()) { const indexed = this._indexFile(child); if (indexed) added.push(indexed); }
    }
  }

  _indexFile(rel, known) {
    const full = path.join(this.root, ...rel.split('/'));
    let stat = known;
    if (!stat) { try { stat = fs.statSync(full); } catch { return null; } }
    const entry = { path: rel, size: stat.size, mtime: mtimeOf(stat), ctime: Math.round(stat.birthtimeMs || stat.ctimeMs), kind: Meta.kindOf(rel) };
    this.texts.delete(rel);
    if (entry.kind === 'note') {
      let text = '';
      if (stat.size <= MAX_INDEXED_BYTES) { try { text = fs.readFileSync(full, 'utf8').replace(/^﻿/, ''); } catch {} }
      this.texts.set(rel, text);
      entry.meta = Meta.extract(text);
    }
    this.files.set(rel, entry);
    return entry;
  }

  _invalidate() { this._resolver = null; this._lower = null; }

  _changed(change) {
    this._invalidate();
    this.emit('change', { upserts: change.upserts || [], removes: change.removes || [], renames: change.renames || [], folders: [...this.folders].sort() });
  }

  snapshot() { return { files: [...this.files.values()], folders: [...this.folders].sort() }; }

  _ensureFolder(rel) {
    if (!rel) return;
    fs.mkdirSync(path.join(this.root, ...rel.split('/')), { recursive: true });
    const parts = rel.split('/');
    for (let i = 1; i <= parts.length; i++) this.folders.add(parts.slice(0, i).join('/'));
  }

  // --------------------------------------------------------- read and write
  read(rel) {
    const clean = this.canonical(cleanRelative(rel));
    const full = this.abs(clean);
    let stat;
    try { stat = fs.statSync(full); } catch { throw new VaultError(`« ${clean} » est introuvable.`, 404, 'missing'); }
    if (stat.isDirectory()) throw new VaultError(`« ${clean} » est un dossier.`, 400, 'folder');
    if (stat.size > MAX_TEXT_BYTES) throw new VaultError('Fichier trop volumineux pour être ouvert comme texte.', 413, 'too-large');
    const content = fs.readFileSync(full, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    return { path: clean, content, mtime: mtimeOf(stat), size: stat.size };
  }

  write(rel, content, options = {}) {
    const clean = this.canonical(cleanRelative(rel));
    const full = this.abs(clean);
    let stat = null;
    try { stat = fs.statSync(full); } catch {}
    if (stat && stat.isDirectory()) throw new VaultError('Un dossier porte déjà ce nom.', 409, 'exists');
    if (stat && options.createOnly) throw new VaultError(`« ${clean} » existe déjà.`, 409, 'exists');
    if (stat && options.baseMtime !== undefined && options.baseMtime !== null && mtimeOf(stat) !== Number(options.baseMtime)) {
      const error = new VaultError('La note a été modifiée en dehors de cet onglet.', 409, 'conflict');
      error.current = this.read(clean);
      throw error;
    }
    this._ensureFolder(Meta.dirName(clean));
    atomicWrite(full, String(content == null ? '' : content));
    const entry = this._indexFile(clean);
    this._changed({ upserts: [entry] });
    return entry;
  }

  writeBinary(rel, buffer) {
    const clean = this.canonical(cleanRelative(rel));
    const full = this.abs(clean);
    this._ensureFolder(Meta.dirName(clean));
    atomicWrite(full, buffer);
    const entry = this._indexFile(clean);
    this._changed({ upserts: [entry] });
    return entry;
  }

  exists(rel) { return fs.existsSync(path.join(this.root, ...rel.split('/'))); }

  // First free "name.ext", "name 1.ext", "name 2.ext"… inside `folder`.
  uniquePath(folder, name, ext) {
    const suffix = ext ? `.${ext}` : '';
    const lower = this._lowerMaps();
    for (let index = 0; index < 10000; index++) {
      const candidate = Meta.joinPath(folder, `${name}${index ? ` ${index}` : ''}${suffix}`);
      const key = candidate.toLowerCase();
      if (!lower.files.has(key) && !lower.folders.has(key) && !this.exists(candidate)) return candidate;
    }
    throw new VaultError('Impossible de trouver un nom libre.');
  }

  createFolder(rel) {
    const clean = this.canonical(cleanRelative(rel));
    const full = this.abs(clean);
    if (fs.existsSync(full) && !fs.statSync(full).isDirectory()) throw new VaultError('Un fichier porte déjà ce nom.', 409, 'exists');
    this._ensureFolder(clean);
    this._changed({});
    return clean;
  }

  newNoteFolder(sourcePath) {
    const mode = this.settings.newNoteLocation;
    if (mode === 'current' && sourcePath) return Meta.dirName(sourcePath);
    if (mode === 'folder' && this.settings.newNoteFolder) return cleanRelative(this.settings.newNoteFolder);
    return '';
  }

  attachmentFolder(sourcePath) {
    const mode = this.settings.attachmentLocation;
    if (mode === 'current' && sourcePath) return Meta.dirName(sourcePath);
    if (mode === 'folder' && this.settings.attachmentFolder) return cleanRelative(this.settings.attachmentFolder);
    return '';
  }

  // ------------------------------------------------------- rename and move
  rename(fromRef, toRef, options = {}) {
    const from = this.canonical(cleanRelative(fromRef));
    // Only the destination's folder is mapped onto its indexed spelling: the
    // last segment is the new name, and may differ from the old one by case.
    const wanted = cleanRelative(toRef);
    const parent = Meta.dirName(wanted);
    const to = Meta.joinPath(parent ? this.canonical(parent) : '', Meta.baseName(wanted));
    const fullFrom = this.abs(from);
    let stat;
    try { stat = fs.statSync(fullFrom); } catch { throw new VaultError(`« ${from} » est introuvable.`, 404, 'missing'); }
    const directory = stat.isDirectory();
    const caseOnly = from.toLowerCase() === to.toLowerCase();
    if (from === to) return { from, to, moved: 0, linksUpdated: 0, notesUpdated: 0 };
    const fullTo = this.abs(to);
    if (!caseOnly && fs.existsSync(fullTo)) throw new VaultError(`« ${to} » existe déjà.`, 409, 'exists');
    if (directory && (to.toLowerCase() + '/').startsWith(from.toLowerCase() + '/') && !caseOnly) throw new VaultError('Un dossier ne peut pas être déplacé dans lui-même.');

    const mapping = new Map();
    if (directory) { for (const file of this.files.keys()) if (file.startsWith(from + '/')) mapping.set(file, to + file.slice(from.length)); }
    else mapping.set(from, to);

    // Plan the link rewrites against the index as it is now: only links that
    // would stop pointing at the same file after the move are touched.
    const plans = [];
    if (options.updateLinks !== false && this.settings.autoUpdateLinks !== false) {
      const before = this.resolver;
      const after = Meta.buildResolver([...this.files.keys()].map((file) => mapping.get(file) || file));
      for (const [file, entry] of this.files) {
        if (entry.kind !== 'note' || !entry.meta.links.length) continue;
        const text = this.texts.get(file);
        if (!text) continue;
        const source = mapping.get(file) || file;
        const result = Meta.rewriteLinks(text, (link) => {
          if (!link.target) return null;
          const resolved = before.resolve(link.target, file);
          if (!resolved) return null;
          const destination = mapping.get(resolved) || resolved;
          if (after.resolve(link.target, source) === destination) return null;
          if (link.style === 'wiki') return after.linkText(destination);
          return path.posix.relative(Meta.dirName(source) || '.', destination);
        });
        if (result.changed) plans.push({ file, text: result.text, count: result.changed });
      }
    }

    this._ensureFolder(Meta.dirName(to));
    fs.renameSync(fullFrom, fullTo);

    const removes = []; const upserts = [];
    for (const [oldPath, newPath] of mapping) {
      this.files.delete(oldPath); this.texts.delete(oldPath); removes.push(oldPath);
      const entry = this._indexFile(newPath);
      if (entry) upserts.push(entry);
    }
    if (directory) {
      for (const folder of [...this.folders]) {
        if (folder === from || folder.startsWith(from + '/')) { this.folders.delete(folder); this.folders.add(to + folder.slice(from.length)); }
      }
    }
    let linksUpdated = 0;
    for (const plan of plans) {
      const target = mapping.get(plan.file) || plan.file;
      atomicWrite(path.join(this.root, ...target.split('/')), plan.text);
      const entry = this._indexFile(target);
      if (entry && !upserts.includes(entry)) upserts.push(entry);
      linksUpdated += plan.count;
    }
    // Re-indexing replaced some entries: report the current object for each path.
    this._changed({
      upserts: [...new Set(upserts.map((entry) => entry.path))].map((file) => this.files.get(file)).filter(Boolean),
      removes: removes.filter((file) => !this.files.has(file)),
      // Lets an open tab follow its note instead of closing on "removed".
      renames: [...(directory ? [[from, to, 'folder']] : []), ...mapping.entries()],
    });
    return { from, to, moved: mapping.size, linksUpdated, notesUpdated: plans.length };
  }

  // ------------------------------------------------------------------ delete
  remove(rel, options = {}) {
    const clean = this.canonical(cleanRelative(rel));
    const full = this.abs(clean);
    let stat;
    try { stat = fs.statSync(full); } catch { throw new VaultError(`« ${clean} » est introuvable.`, 404, 'missing'); }
    const mode = options.permanent ? 'permanent' : (options.mode || this.settings.trash || 'local');
    if (mode === 'permanent') fs.rmSync(full, { recursive: true, force: true });
    else if (mode === 'system' && this._recycle(full, stat.isDirectory())) { /* sent to the recycle bin */ }
    else this._trashLocal(clean, full);

    const removes = [];
    if (stat.isDirectory()) {
      for (const file of [...this.files.keys()]) if (file.startsWith(clean + '/')) { this.files.delete(file); this.texts.delete(file); removes.push(file); }
      for (const folder of [...this.folders]) if (folder === clean || folder.startsWith(clean + '/')) this.folders.delete(folder);
    } else { this.files.delete(clean); this.texts.delete(clean); removes.push(clean); }
    this._changed({ removes });
    return { path: clean, removed: removes.length, mode };
  }

  _trashLocal(rel, full) {
    const base = path.join(this.root, TRASH_DIR);
    let target = path.join(base, ...rel.split('/'));
    if (fs.existsSync(target)) {
      const parsed = path.parse(target);
      target = path.join(parsed.dir, `${parsed.name} ${Date.now()}${parsed.ext}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(full, target);
  }

  _recycle(full, directory) {
    if (process.platform !== 'win32') return false;
    try {
      const call = directory ? 'DeleteDirectory' : 'DeleteFile';
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${call}($env:OPALE_TARGET, 'OnlyErrorDialogs', 'SendToRecycleBin')`],
      { env: { ...process.env, OPALE_TARGET: full }, windowsHide: true, timeout: 20000, stdio: 'ignore' });
      return !fs.existsSync(full);
    } catch { return false; }
  }

  // ---------------------------------------------------------------- queries
  backlinks(rel, options = {}) {
    const target = this.canonical(cleanRelative(rel));
    const linked = [];
    for (const [file, entry] of this.files) {
      if (entry.kind !== 'note' || file === target) continue;
      const hits = entry.meta.links.filter((link) => this.resolver.resolve(link.target, file) === target);
      if (!hits.length) continue;
      const lines = (this.texts.get(file) || '').split(/\r?\n/);
      const seen = new Set(); const items = [];
      for (const hit of hits) {
        if (seen.has(hit.line)) continue;
        seen.add(hit.line);
        items.push({ line: hit.line, text: (lines[hit.line] || '').trim().slice(0, 400) });
      }
      linked.push({ path: file, items });
    }
    linked.sort((a, b) => a.path.localeCompare(b.path));
    const result = { path: target, linked, unlinked: [] };
    if (options.unlinked) result.unlinked = this._unlinkedMentions(target);
    return result;
  }

  _unlinkedMentions(target) {
    const entry = this.files.get(target);
    const names = [Meta.stem(target), ...((entry && entry.meta && entry.meta.aliases) || [])].filter((name) => name.length >= 3);
    if (!names.length) return [];
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
    const out = [];
    for (const [file, other] of this.files) {
      if (other.kind !== 'note' || file === target) continue;
      const text = this.texts.get(file);
      if (!text) continue;
      const lines = text.split(/\r?\n/);
      const masked = Meta.maskLines(lines, Meta.splitFrontmatter(lines.join('\n')).bodyLine);
      const items = [];
      for (let i = 0; i < lines.length && items.length < 20; i++) {
        const plain = masked[i].replace(/!?\[\[[^\]\n]*\]\]/g, ' ').replace(/!?\[[^\]\n]*\]\([^)\n]*\)/g, ' ');
        if (pattern.test(plain)) items.push({ line: i, text: lines[i].trim().slice(0, 400) });
      }
      if (items.length) out.push({ path: file, items });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  outgoing(rel) {
    const source = this.canonical(cleanRelative(rel));
    const entry = this.files.get(source);
    if (!entry || !entry.meta) return [];
    return entry.meta.links.map((link) => ({ target: link.target, subpath: link.subpath, embed: link.embed, line: link.line, path: this.resolver.resolve(link.target, source) }));
  }

  tags() {
    const counts = new Map();
    for (const entry of this.files.values()) {
      if (!entry.meta) continue;
      for (const tag of entry.meta.tags) {
        const key = tag.toLowerCase();
        const current = counts.get(key) || { tag, count: 0 };
        current.count++; counts.set(key, current);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  notesByTag(tag) {
    const wanted = String(tag || '').replace(/^#/, '').toLowerCase();
    const out = [];
    for (const entry of this.files.values()) {
      if (entry.meta && entry.meta.tags.some((value) => { const lower = value.toLowerCase(); return lower === wanted || lower.startsWith(wanted + '/'); })) out.push(entry.path);
    }
    return out.sort();
  }

  // Shape of the vault at a glance: what an assistant needs before tidying.
  overview() {
    const notes = [...this.files.values()].filter((entry) => entry.kind === 'note');
    const inbound = new Map(); const unresolved = new Map();
    for (const note of notes) {
      for (const link of note.meta.links) {
        if (!link.target) continue;
        const resolved = this.resolver.resolve(link.target, note.path);
        if (resolved) { if (resolved !== note.path) inbound.set(resolved, (inbound.get(resolved) || 0) + 1); }
        else unresolved.set(link.target, (unresolved.get(link.target) || 0) + 1);
      }
    }
    const folders = new Map();
    for (const entry of this.files.values()) { const folder = Meta.dirName(entry.path) || '/'; folders.set(folder, (folders.get(folder) || 0) + 1); }
    const hasOutgoing = (note) => note.meta.links.some((link) => link.target && this.resolver.resolve(link.target, note.path));
    return {
      name: this.name, root: this.root,
      notes: notes.length, attachments: this.files.size - notes.length, folders: this.folders.size,
      words: notes.reduce((sum, note) => sum + note.meta.words, 0),
      orphans: notes.filter((note) => !inbound.has(note.path) && !hasOutgoing(note)).map((note) => note.path).sort(),
      mostLinked: [...inbound.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([file, count]) => ({ path: file, backlinks: count })),
      unresolved: [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([target, count]) => ({ target, count })),
      byFolder: [...folders.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([folder, count]) => ({ folder, files: count })),
      recent: notes.slice().sort((a, b) => b.mtime - a.mtime).slice(0, 12).map((note) => note.path),
      tags: this.tags().slice(0, 40),
    };
  }

  // ------------------------------------------------- daily notes, templates
  applyTemplate(text, title, date = new Date()) {
    return String(text || '')
      .replace(/\{\{\s*title\s*\}\}/gi, title)
      .replace(/\{\{\s*date(?::([^}]+))?\s*\}\}/gi, (m, format) => Meta.formatDate(date, (format || 'YYYY-MM-DD').trim()))
      .replace(/\{\{\s*time(?::([^}]+))?\s*\}\}/gi, (m, format) => Meta.formatDate(date, (format || 'HH:mm').trim()));
  }

  dailyPath(date = new Date()) {
    const name = Meta.formatDate(date, this.settings.dailyFormat || 'YYYY-MM-DD');
    return cleanRelative(Meta.joinPath(this.settings.dailyFolder || '', `${name}.md`));
  }

  ensureDaily(date = new Date()) {
    const target = this.canonical(this.dailyPath(date));
    if (this.files.has(target)) return { path: target, created: false };
    let content = '';
    const template = this.settings.dailyTemplate ? this.locate(this.settings.dailyTemplate) : null;
    if (template && this.files.has(template)) content = this.applyTemplate(this.read(template).content, Meta.stem(target), date);
    this.write(target, content, { createOnly: true });
    return { path: target, created: true };
  }

  templates() {
    const folder = (this.settings.templateFolder || '').replace(/\/+$/, '');
    if (!folder) return [];
    const prefix = folder.toLowerCase() + '/';
    return [...this.files.values()].filter((entry) => entry.kind === 'note' && entry.path.toLowerCase().startsWith(prefix)).map((entry) => entry.path).sort();
  }

  // ---------------------------------------------------- vault configuration
  _configFile(name) { return path.join(this.root, CONFIG_DIR, name); }
  _readConfig(name, fallback) {
    try { return JSON.parse(fs.readFileSync(this._configFile(name), 'utf8')); } catch { return fallback; }
  }
  _writeConfig(name, value) {
    fs.mkdirSync(path.join(this.root, CONFIG_DIR), { recursive: true });
    atomicWrite(this._configFile(name), JSON.stringify(value, null, 2));
  }
  _loadSettings() {
    const stored = this._readConfig('app.json', {}) || {};
    return { ...DEFAULT_SETTINGS, ...stored, graph: { ...DEFAULT_SETTINGS.graph, ...(stored.graph || {}) } };
  }
  saveSettings(patch) {
    const next = { ...this.settings };
    for (const [key, value] of Object.entries(patch || {})) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      if (key === 'graph') next.graph = { ...next.graph, ...(value && typeof value === 'object' ? value : {}) };
      else if (typeof value === typeof DEFAULT_SETTINGS[key]) next[key] = value;
    }
    this.settings = next;
    this._writeConfig('app.json', next);
    return next;
  }
  workspace() { return this._readConfig('workspace.json', {}) || {}; }
  saveWorkspace(value) { this._writeConfig('workspace.json', value && typeof value === 'object' ? value : {}); }
  bookmarks() { const list = this._readConfig('bookmarks.json', []); return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []; }
  saveBookmarks(list) { this._writeConfig('bookmarks.json', (Array.isArray(list) ? list : []).filter((item) => typeof item === 'string').slice(0, 500)); }
  snippets() {
    try {
      const folder = path.join(this.root, CONFIG_DIR, 'snippets');
      return fs.readdirSync(folder).filter((name) => name.toLowerCase().endsWith('.css')).sort()
        .map((name) => fs.readFileSync(path.join(folder, name), 'utf8')).join('\n');
    } catch { return ''; }
  }

  // --------------------------------------------------------------- watching
  // Pick up edits made outside Opale (another editor, a sync tool, an agent
  // writing straight to the folder).
  watch() {
    if (this._watcher) return;
    try {
      this._watcher = fs.watch(this.root, { recursive: true }, (event, filename) => {
        if (!filename) return;
        const rel = String(filename).replace(/\\/g, '/');
        if (rel.split('/').some((part) => part.startsWith('.'))) return;
        this._pending.add(rel);
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this._flush(), 150);
      });
      this._watcher.on('error', () => {});
    } catch { this._watcher = null; }
  }

  _flush() {
    const pending = [...this._pending]; this._pending.clear();
    const upserts = []; const removes = []; let touched = false;
    const dropTree = (rel) => {
      for (const file of [...this.files.keys()]) if (file.startsWith(rel + '/')) { this.files.delete(file); this.texts.delete(file); removes.push(file); }
      for (const folder of [...this.folders]) if (folder === rel || folder.startsWith(rel + '/')) { this.folders.delete(folder); touched = true; }
    };
    for (const rel of pending) {
      let stat = null;
      try { stat = fs.statSync(path.join(this.root, ...rel.split('/'))); } catch {}
      if (!stat) {
        if (this.files.has(rel)) { this.files.delete(rel); this.texts.delete(rel); removes.push(rel); }
        dropTree(rel);
      } else if (stat.isDirectory()) {
        if (!this.folders.has(rel)) {
          const parts = rel.split('/');
          for (let i = 1; i <= parts.length; i++) this.folders.add(parts.slice(0, i).join('/'));
          this._walk(rel, upserts); touched = true;
        }
      } else if (stat.isFile()) {
        const known = this.files.get(rel);
        if (known && known.mtime === mtimeOf(stat) && known.size === stat.size) continue;
        const parent = Meta.dirName(rel);
        if (parent && !this.folders.has(parent)) { const parts = parent.split('/'); for (let i = 1; i <= parts.length; i++) this.folders.add(parts.slice(0, i).join('/')); }
        const entry = this._indexFile(rel, stat);
        if (entry) upserts.push(entry);
      }
    }
    if (upserts.length || removes.length || touched) this._changed({ upserts, removes: removes.filter((file) => !this.files.has(file)) });
  }

  close() {
    clearTimeout(this._timer);
    if (this._watcher) { try { this._watcher.close(); } catch {} this._watcher = null; }
    this.removeAllListeners();
  }
}

module.exports = { Vault, VaultError, cleanRelative, DEFAULT_SETTINGS, CONFIG_DIR, TRASH_DIR };
