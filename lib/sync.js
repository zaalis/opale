'use strict';

// Two-way synchronisation of a vault with its folder in Google Drive.
//
// Each run compares three states of every file: the local disk, Drive, and the
// version both sides shared at the end of the previous run (kept in
// .opale/sync.json). A side that differs from that shared version changed:
//   one side changed         → copy it to the other side
//   both changed, same bytes → nothing to do
//   both changed (a note)    → three-way merge when the edits do not touch
//   otherwise                → keep this computer's version in place and save
//                              the other one next to it as a conflict copy
//   deleted on one side      → deleted on the other, unless it was edited
//                              there meanwhile (then the edit comes back)
// Deletions go to the vault's bin locally and to Drive's bin remotely, and the
// shared versions of notes are kept so a merge is always possible.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const Meta = require('../shared/meta.js');
const { cleanRelative, VaultError, CONFIG_DIR } = require('./vault.js');
const { merge3 } = require('./merge.js');

const STATE_FILE = 'sync.json';
const BASE_DIR = 'sync-base';
const MAX_MERGE_BYTES = 2 * 1024 * 1024;
const CONCURRENCY = 4;
const MASS_DELETE_MIN = 10;
const MASS_DELETE_SHARE = 0.3;

const md5 = (buffer) => crypto.createHash('md5').update(buffer).digest('hex');
const lower = (value) => value.toLowerCase();
const mtimeOf = (stat) => Math.round(stat.mtimeMs);
const isNote = (rel) => Meta.kindOf(rel) === 'note';
const pad = (value) => String(value).padStart(2, '0');

function deviceName() { return (os.hostname() || 'Ordinateur').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 40) || 'Ordinateur'; }

function emptyState() { return { version: 1, link: null, enabled: true, files: {}, folders: {}, conflicts: [], lastSync: 0 }; }

// Run `jobs` with at most `limit` of them at once.
async function pool(jobs, limit, run) {
  let next = 0;
  const worker = async () => { while (next < jobs.length) { const job = jobs[next++]; await run(job); } };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
}

// ------------------------------------------------------------------ engine
class SyncEngine {
  constructor(vault, drive, options = {}) {
    this.vault = vault; this.drive = drive;
    this.device = options.device || deviceName();
    this.onProgress = options.onProgress || (() => {});
    this.guard = options.guard || ((fn) => fn());
    this.state = this.load();
  }

  // ----------------------------------------------------------- persistence
  load() {
    const stored = this.vault._readConfig(STATE_FILE, null);
    const state = { ...emptyState(), ...(stored && typeof stored === 'object' ? stored : {}) };
    for (const key of ['files', 'folders']) if (!state[key] || typeof state[key] !== 'object') state[key] = {};
    if (!Array.isArray(state.conflicts)) state.conflicts = [];
    return state;
  }
  save() { this.vault._writeConfig(STATE_FILE, this.state); }

  _baseDir() { return path.join(this.vault.root, CONFIG_DIR, BASE_DIR); }
  _baseText(hash) { try { return fs.readFileSync(path.join(this._baseDir(), `${hash}.md`), 'utf8'); } catch { return null; } }
  _keepBase(rel, hash, buffer) {
    if (!isNote(rel) || buffer.length > MAX_MERGE_BYTES) return;
    const file = path.join(this._baseDir(), `${hash}.md`);
    if (fs.existsSync(file)) return;
    fs.mkdirSync(this._baseDir(), { recursive: true });
    fs.writeFileSync(file, buffer);
  }
  _collectBases() {
    const wanted = new Set(Object.values(this.state.files).map((entry) => `${entry.hash}.md`));
    try { for (const name of fs.readdirSync(this._baseDir())) if (!wanted.has(name)) fs.rmSync(path.join(this._baseDir(), name), { force: true }); } catch {}
  }

  // --------------------------------------------------------------- linking
  link(info) {
    this.state = { ...emptyState(), link: { vaultId: info.vaultId, folderId: info.folderId, name: info.name, account: info.account || '' }, enabled: true };
    try { fs.rmSync(this._baseDir(), { recursive: true, force: true }); } catch {}
    this.save();
  }
  unlink() {
    this.state = emptyState();
    try { fs.rmSync(this._baseDir(), { recursive: true, force: true }); } catch {}
    this.save();
  }

  // ------------------------------------------------------------- snapshots
  _local() {
    const files = new Map();
    for (const rel of this.vault.files.keys()) {
      let stat; try { stat = fs.statSync(this.vault.abs(rel)); } catch { continue; }
      if (stat.isFile()) files.set(lower(rel), { path: rel, mtime: mtimeOf(stat), size: stat.size });
    }
    const folders = new Map([...this.vault.folders].map((rel) => [lower(rel), rel]));
    return { files, folders };
  }

  async _remote() {
    const { vaultId, folderId } = this.state.link;
    const items = await this.drive.list(vaultId);
    // No vault folder means it was deleted from Drive, or another Google
    // account is connected: an empty listing must not read as “delete all”.
    if (!items.some((item) => item.id === folderId)) throw new VaultError('Le dossier Google Drive de ce coffre est introuvable (supprimé, dans la corbeille de Drive, ou autre compte Google). Rien n’a été modifié. Restaurez-le ou déliez puis reliez ce coffre.', 409, 'remote-missing');
    const byId = new Map(items.map((item) => [item.id, item]));
    const memo = new Map([[folderId, '']]);
    const pathOf = (id, depth = 0) => {
      if (memo.has(id)) return memo.get(id);
      const item = byId.get(id);
      if (!item || !item.folder || depth > 64) return null;
      const parent = pathOf(item.parents[0], depth + 1);
      const result = parent === null ? null : safeJoin(parent, item.name);
      memo.set(id, result);
      return result;
    };
    const files = new Map(); const folders = new Map(); const skipped = [];
    for (const item of items) {
      if (item.id === folderId) continue;
      if (item.folder) { const rel = pathOf(item.id); if (rel) folders.set(lower(rel), { path: rel, id: item.id }); continue; }
      const parent = pathOf(item.parents[0]);
      const rel = parent === null ? null : safeJoin(parent, item.name);
      // Google Docs have no bytes to copy; odd names cannot exist on Windows.
      if (!rel || !item.md5) { skipped.push(item.name); continue; }
      const key = lower(rel); const known = files.get(key);
      // Two Drive files with one name: follow the most recent.
      if (known && known.modified >= item.modified) continue;
      files.set(key, { path: rel, id: item.id, md5: item.md5, size: item.size, modified: item.modified, device: item.device, parentId: item.parents[0] });
    }
    return { files, folders, skipped };
  }

  _localHash(entry, base) {
    if (base && base.mtime === entry.mtime && base.size === entry.size) return base.hash;
    if (entry.hash) return entry.hash;
    entry.hash = md5(fs.readFileSync(this.vault.abs(entry.path)));
    return entry.hash;
  }

  // ------------------------------------------------------------------ plan
  plan(local, remote) {
    const base = this.state.files;
    const keys = new Set([...local.files.keys(), ...remote.files.keys(), ...Object.keys(base)]);
    const actions = [];
    for (const key of keys) {
      const L = local.files.get(key); const R = remote.files.get(key); const B = base[key];
      if (L && R) {
        const lHash = this._localHash(L, B);
        if (lHash === R.md5) { actions.push({ type: 'record', key, L, R, hash: lHash }); continue; }
        const lChanged = !B || lHash !== B.hash; const rChanged = !B || R.md5 !== B.hash;
        if (lChanged && !rChanged) actions.push({ type: 'upload', key, L, R });
        else if (!lChanged && rChanged) actions.push({ type: 'download', key, L, R });
        else actions.push({ type: 'conflict', key, L, R, B });
      } else if (L) {
        if (!B) actions.push({ type: 'upload', key, L });
        else if (this._localHash(L, B) !== B.hash) actions.push({ type: 'upload', key, L }); // edited here, deleted there: keep the edit
        else actions.push({ type: 'delete-local', key, L, B });
      } else if (R) {
        if (!B) actions.push({ type: 'download', key, R });
        else if (R.md5 !== B.hash) actions.push({ type: 'download', key, R }); // edited there, deleted here: keep the edit
        else actions.push({ type: 'delete-remote', key, R, B });
      } else actions.push({ type: 'forget', key });
    }
    // A delete and a create of the same bytes is a rename or a move: move the
    // file instead of copying it again (keeps Drive's version history too).
    const pair = (newType, oldType, hashOf, moveType) => {
      const olds = new Map();
      for (const action of actions) if (action.type === oldType) { const list = olds.get(action.B.hash) || []; list.push(action); olds.set(action.B.hash, list); }
      for (const action of actions) {
        if (action.type !== newType || action.R && action.L) continue;
        const hash = hashOf(action);
        const list = hash && olds.get(hash);
        if (!list || !list.length) continue;
        const old = list.shift();
        old.type = 'skip';
        action.type = moveType; action.from = old;
      }
    };
    pair('upload', 'delete-remote', (action) => (action.L && !action.R ? this._localHash(action.L, null) : null), 'move-remote');
    pair('download', 'delete-local', (action) => (action.R && !action.L ? action.R.md5 : null), 'move-local');
    return actions.filter((action) => action.type !== 'skip');
  }

  // ------------------------------------------------------------------- run
  async run(options = {}) {
    if (!this.state.link) throw new VaultError('Ce coffre n’est relié à aucun dossier Google Drive.', 409, 'not-linked');
    const remote = await this._remote();
    const local = this._local();
    const actions = this.plan(local, remote);
    // Losing most of one side at once is far more often an accident (a folder
    // emptied by mistake, a restored backup) than a wish: ask first.
    if (!options.force) {
      for (const [type, total, where] of [['delete-local', local.files.size, 'sur cet ordinateur (ils ont disparu de Google Drive)'], ['delete-remote', remote.files.size, 'dans Google Drive (ils ont disparu de cet ordinateur)']]) {
        const count = actions.filter((action) => action.type === type).length;
        if (count >= MASS_DELETE_MIN && count > total * MASS_DELETE_SHARE) {
          throw new VaultError(`Cette synchronisation supprimerait ${count} fichiers sur ${total} ${where}. Elle est suspendue : vérifiez, puis confirmez si c’est voulu.`, 409, 'mass-delete');
        }
      }
    }
    const summary = { uploaded: 0, downloaded: 0, deleted: 0, moved: 0, merged: [], conflicts: [], errors: [], skipped: remote.skipped };
    const transfers = actions.filter((action) => ['upload', 'download', 'conflict'].includes(action.type));
    const weight = (action) => (action.type === 'upload' ? action.L.size : action.type === 'download' ? action.R.size : action.L.size + action.R.size);
    const progress = { totalFiles: transfers.length, doneFiles: 0, totalBytes: transfers.reduce((sum, action) => sum + weight(action), 0), doneBytes: 0 };
    this.onProgress({ ...progress });
    const advance = (bytes) => { progress.doneFiles++; progress.doneBytes += bytes; this.onProgress({ ...progress }); };

    this.remoteFolders = new Map([...remote.folders].map(([key, value]) => [key, value.id]));
    this.creating = new Map();
    const remoteAlive = new Set(remote.files.keys());

    const order = { 'move-remote': 0, 'move-local': 0, upload: 1, download: 1, conflict: 1, record: 1, 'delete-remote': 2, 'delete-local': 2, forget: 2 };
    const phases = [0, 1, 2].map((phase) => actions.filter((action) => order[action.type] === phase));
    for (const phase of phases) {
      await pool(phase, CONCURRENCY, async (action) => {
        try { await this._apply(action, summary, remoteAlive, advance); }
        catch (error) {
          if (error.code === 'auth' || error.code === 'offline') throw error;
          summary.errors.push(`${(action.L || action.R || { path: action.key }).path} : ${error.message}`);
        }
      });
    }
    await this._syncFolders(remote, remoteAlive, summary);
    this.state.lastSync = Date.now();
    this.state.conflicts = this.state.conflicts.filter((item) => this.vault.files.has(item.copy));
    this.save();
    this._collectBases();
    return summary;
  }

  _record(rel, hash, id, buffer) {
    let stat = null; try { stat = fs.statSync(this.vault.abs(rel)); } catch {}
    this.state.files[lower(rel)] = { path: rel, hash, id, mtime: stat ? mtimeOf(stat) : 0, size: stat ? stat.size : 0 };
    if (buffer) this._keepBase(rel, hash, buffer);
  }

  // The file must not have changed since it was examined: a save made while
  // the run was busy is left for the next run instead of being overwritten.
  _unchanged(entry) {
    try { const stat = fs.statSync(this.vault.abs(entry.path)); return mtimeOf(stat) === entry.mtime && stat.size === entry.size; } catch { return false; }
  }

  _writeLocal(rel, buffer) {
    return this.guard(() => this.vault.writeBinary(rel, buffer));
  }

  async _apply(action, summary, remoteAlive, advance) {
    const { key } = action;
    switch (action.type) {
      case 'record': {
        const buffer = isNote(action.L.path) ? fs.readFileSync(this.vault.abs(action.L.path)) : null;
        this._record(action.L.path, action.hash, action.R.id, buffer);
        return;
      }
      case 'forget': delete this.state.files[key]; return;
      case 'upload': {
        const buffer = fs.readFileSync(this.vault.abs(action.L.path));
        const result = await this._upload(action.L.path, buffer, action.R && action.R.id);
        remoteAlive.add(key);
        this._record(action.L.path, md5(buffer), result.id, buffer);
        summary.uploaded++; advance(buffer.length);
        return;
      }
      case 'download': {
        const buffer = await this.drive.download(action.R.id);
        if (action.L && !this._unchanged(action.L)) { advance(0); return; }
        const rel = action.L ? action.L.path : action.R.path;
        if (!action.L && this.vault.exists(rel)) { advance(0); return; } // appeared meanwhile: next run decides
        this._writeLocal(rel, buffer);
        this._record(this.vault.canonical(rel), md5(buffer), action.R.id, buffer);
        summary.downloaded++; advance(buffer.length);
        return;
      }
      case 'conflict': return this._conflict(action, summary, remoteAlive, advance);
      case 'delete-local': {
        if (!this._unchanged(action.L)) return;
        const mode = this.vault.settings.trash === 'permanent' ? 'local' : this.vault.settings.trash;
        this.guard(() => this.vault.remove(action.L.path, { mode }));
        delete this.state.files[key]; summary.deleted++;
        return;
      }
      case 'delete-remote': {
        await this.drive.trash(action.R.id);
        remoteAlive.delete(key);
        delete this.state.files[key]; summary.deleted++;
        return;
      }
      case 'move-remote': {
        const target = action.L.path; const old = action.from;
        const parentId = await this._remoteFolder(Meta.dirName(target));
        const result = await this.drive.move(old.R.id, { name: Meta.baseName(target), addParent: parentId, removeParent: old.R.parentId });
        remoteAlive.delete(old.key); remoteAlive.add(key);
        delete this.state.files[old.key];
        this._record(target, old.B.hash, result.id, isNote(target) ? fs.readFileSync(this.vault.abs(target)) : null);
        summary.moved++;
        return;
      }
      case 'move-local': {
        const old = action.from;
        if (!this._unchanged(old.L) || this.vault.exists(action.R.path)) return;
        this.guard(() => this.vault.rename(old.L.path, action.R.path, { updateLinks: false }));
        delete this.state.files[old.key];
        const rel = this.vault.canonical(action.R.path);
        this._record(rel, action.R.md5, action.R.id, isNote(rel) ? fs.readFileSync(this.vault.abs(rel)) : null);
        summary.moved++;
        return;
      }
      default:
    }
  }

  async _conflict(action, summary, remoteAlive, advance) {
    const { L, R, B, key } = action;
    const theirs = await this.drive.download(R.id);
    if (!this._unchanged(L)) { advance(0); return; }
    const mine = fs.readFileSync(this.vault.abs(L.path));
    const theirHash = md5(theirs);
    // Downloaded bytes may already match (the Drive listing was a moment old).
    if (md5(mine) === theirHash) { this._record(L.path, theirHash, R.id, mine); advance(theirs.length); return; }
    const baseText = B && isNote(L.path) ? this._baseText(B.hash) : null;
    if (baseText !== null && mine.length <= MAX_MERGE_BYTES && theirs.length <= MAX_MERGE_BYTES) {
      const merged = merge3(baseText, mine.toString('utf8'), theirs.toString('utf8'));
      if (merged !== null) {
        const buffer = Buffer.from(merged, 'utf8');
        this._writeLocal(L.path, buffer);
        const result = await this._upload(L.path, buffer, R.id);
        this._record(L.path, md5(buffer), result.id, buffer);
        summary.merged.push(L.path); advance(theirs.length + mine.length);
        return;
      }
    }
    // Keep both: this computer's version stays in place, the other one is
    // saved next to it and travels to every computer like any other file.
    const copy = this.vault.uniquePath(Meta.dirName(L.path), conflictStem(L.path, R.device), Meta.extOf(L.path));
    this._writeLocal(copy, theirs);
    const copied = await this._upload(copy, theirs, null);
    remoteAlive.add(lower(copy));
    this._record(copy, theirHash, copied.id, theirs);
    const result = await this._upload(L.path, mine, R.id);
    this._record(L.path, md5(mine), result.id, mine);
    const entry = { path: L.path, copy, device: R.device || 'un autre ordinateur', at: Date.now() };
    this.state.conflicts = [...this.state.conflicts.filter((item) => lower(item.path) !== key), entry];
    summary.conflicts.push(entry); advance(theirs.length + mine.length);
  }

  async _upload(rel, buffer, id) {
    const { vaultId } = this.state.link;
    if (id) return this.drive.upload({ id, vaultId, data: buffer, device: this.device });
    const parentId = await this._remoteFolder(Meta.dirName(rel));
    return this.drive.upload({ name: Meta.baseName(rel), parentId, vaultId, device: this.device, data: buffer });
  }

  // Drive folder id for a vault folder, created (with its parents) if needed.
  // Concurrent uploads into one new folder share the same creation.
  _remoteFolder(rel) {
    if (!rel) return Promise.resolve(this.state.link.folderId);
    const key = lower(rel);
    if (this.remoteFolders.has(key)) return Promise.resolve(this.remoteFolders.get(key));
    if (!this.creating.has(key)) {
      this.creating.set(key, (async () => {
        const parentId = await this._remoteFolder(Meta.dirName(rel));
        const folder = await this.drive.createFolder(Meta.baseName(rel), parentId, this.state.link.vaultId);
        this.remoteFolders.set(key, folder.id);
        return folder.id;
      })());
    }
    return this.creating.get(key);
  }

  // Folders, empty ones included. A folder is removed only once empty.
  async _syncFolders(remote, remoteAlive, summary) {
    const localFolders = new Map([...this.vault.folders].map((rel) => [lower(rel), rel]));
    const base = this.state.folders;
    // Deepest first: a parent is only found empty once its children are gone.
    const keys = [...new Set([...localFolders.keys(), ...remote.folders.keys(), ...Object.keys(base)])].sort((a, b) => b.length - a.length);
    const localHas = (key) => [...this.vault.files.keys()].some((file) => lower(file).startsWith(`${key}/`)) || [...this.vault.folders].some((folder) => lower(folder).startsWith(`${key}/`));
    const remoteHas = (key) => [...remoteAlive].some((file) => file.startsWith(`${key}/`)) || [...this.remoteFolders.keys()].some((folder) => folder.startsWith(`${key}/`));
    const next = {};
    for (const key of keys) {
      const here = localFolders.get(key); const there = remote.folders.get(key) || (this.remoteFolders.has(key) ? { id: this.remoteFolders.get(key), path: here } : null);
      try {
        if (here && there) next[key] = here;
        else if (here) {
          if (base[key] && !localHas(key)) { this.guard(() => this.vault.remove(here, { mode: 'local' })); continue; }
          await this._remoteFolder(here); next[key] = here;
        } else if (there) {
          if (base[key] && !remoteHas(key)) { await this.drive.trash(there.id); this.remoteFolders.delete(key); continue; }
          this.guard(() => this.vault.createFolder(there.path)); next[key] = there.path;
        }
      } catch (error) {
        if (error.code === 'auth' || error.code === 'offline') throw error;
        summary.errors.push(`${here || (there && there.path) || key} : ${error.message}`);
      }
    }
    this.state.folders = next;
  }
}

// ----------------------------------------------------------------- service
// Keeps the open vault in step: a run shortly after each local change, one
// every `interval` to pick up the other computers' changes, one at a time.
class SyncService extends EventEmitter {
  constructor({ account, drive, device, interval = 30000, delay = 4000 }) {
    super();
    this.account = account; this.drive = drive; this.device = device || deviceName();
    this.interval = interval; this.delay = delay;
    this.vault = null; this.engine = null;
    this.running = null; this.again = false; this.applying = 0;
    this.timer = null; this.poll = null;
    this.phase = 'idle'; this.progress = null; this.error = ''; this.errorCode = ''; this.last = null;
  }

  attach(vault) {
    this.detach();
    this.vault = vault;
    this.engine = new SyncEngine(vault, this.drive, {
      device: this.device,
      onProgress: (progress) => { this.progress = progress; this._emit(true); },
      guard: (fn) => { this.applying++; try { return fn(); } finally { this.applying--; } },
    });
    vault.on('change', () => { if (!this.applying) this.schedule(); });
    this._startPoll();
    this.phase = 'idle'; this.error = ''; this.errorCode = ''; this.progress = null;
    this.schedule(1500);
    this._emit();
  }

  _startPoll() {
    clearInterval(this.poll);
    this.poll = setInterval(() => this.schedule(0), this.interval);
    if (this.poll.unref) this.poll.unref();
  }

  detach() {
    clearTimeout(this.timer); clearInterval(this.poll);
    this.timer = null; this.poll = null;
    this.vault = null; this.engine = null;
  }

  get active() { return !!(this.engine && this.engine.state.link && this.engine.state.enabled && this.account.connected); }

  schedule(delay = this.delay) {
    if (!this.active) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.syncNow().catch(() => {}); }, delay);
    if (this.timer.unref) this.timer.unref();
  }

  async syncNow(options = {}) {
    if (!this.active) return null;
    if (this.running) { this.again = true; return this.running; }
    const engine = this.engine;
    this.phase = 'checking'; this.progress = null; this._emit();
    this.running = (async () => {
      try {
        const summary = await engine.run(options);
        if (engine !== this.engine) return summary;
        if (!this.poll) this._startPoll();
        this.last = summary; this.error = summary.errors.length ? summary.errors[0] : ''; this.errorCode = summary.errors.length ? 'partial' : '';
        this.phase = 'idle'; this.progress = null;
        this._emit(false, summary);
        return summary;
      } catch (error) {
        if (engine !== this.engine) return null;
        this.phase = error.code === 'offline' ? 'offline' : 'error';
        // Waits for the user's answer instead of asking again every 30 seconds.
        if (error.code === 'mass-delete' || error.code === 'remote-missing') { clearInterval(this.poll); this.poll = null; }
        this.error = error.message || String(error); this.errorCode = error.code || 'error'; this.progress = null;
        this._emit();
        throw error;
      } finally {
        this.running = null;
        if (this.again) { this.again = false; this.schedule(300); }
      }
    })();
    return this.running;
  }

  status() {
    const state = this.engine ? this.engine.state : null;
    return {
      account: this.account.info(), device: this.device,
      linked: !!(state && state.link), link: state && state.link, enabled: !!(state && state.enabled),
      phase: this.phase, progress: this.progress, error: this.error, errorCode: this.errorCode,
      lastSync: state ? state.lastSync : 0, conflicts: state ? state.conflicts : [],
      files: state ? Object.keys(state.files).length : 0,
    };
  }

  _emit(progressOnly, summary) {
    if (progressOnly) {
      // At most a few progress frames a second.
      const now = Date.now();
      if (this.progress && this.progress.doneFiles < this.progress.totalFiles && now - (this._lastFrame || 0) < 150) return;
      this._lastFrame = now;
      this.phase = this.progress && this.progress.totalFiles ? 'syncing' : 'checking';
    }
    this.emit('status', { ...this.status(), ...(summary ? { summary: { merged: summary.merged, conflicts: summary.conflicts, uploaded: summary.uploaded, downloaded: summary.downloaded, deleted: summary.deleted, moved: summary.moved } } : {}) });
  }

  _need() { if (!this.engine) throw new VaultError('Aucun coffre ouvert.', 409, 'no-vault'); return this.engine; }

  async link(vaultId) {
    const engine = this._need();
    let info;
    if (vaultId) {
      info = (await this.drive.vaults()).find((item) => item.vaultId === vaultId);
      if (!info) throw new VaultError('Ce coffre n’existe plus dans Google Drive.', 404, 'missing');
    } else info = await this.drive.createVault(this.vault.name);
    engine.link({ ...info, account: this.account.email });
    this.error = ''; this.errorCode = ''; this.phase = 'idle';
    this._emit();
    this.schedule(0);
    return this.status();
  }

  unlink() {
    const engine = this._need();
    clearTimeout(this.timer);
    engine.unlink();
    this.error = ''; this.errorCode = ''; this.phase = 'idle'; this.progress = null;
    this._emit();
    return this.status();
  }

  setEnabled(enabled) {
    const engine = this._need();
    engine.state.enabled = !!enabled; engine.save();
    if (enabled) this.schedule(0); else clearTimeout(this.timer);
    this._emit();
    return this.status();
  }

  // keep: 'mine' (drop the copy), 'theirs' (the copy replaces the note), 'both' (keep both files).
  resolve(rel, keep) {
    const engine = this._need();
    const entry = engine.state.conflicts.find((item) => item.path === rel);
    if (!entry) throw new VaultError('Ce conflit est déjà réglé.', 404, 'missing');
    const vault = this.vault;
    if (keep === 'theirs' && vault.files.has(entry.copy)) {
      vault.writeBinary(entry.path, fs.readFileSync(vault.abs(entry.copy)));
      vault.remove(entry.copy, { mode: 'local' });
    } else if (keep === 'mine' && vault.files.has(entry.copy)) vault.remove(entry.copy, { mode: 'local' });
    engine.state.conflicts = engine.state.conflicts.filter((item) => item !== entry);
    engine.save();
    this._emit();
    return this.status();
  }
}

function safeJoin(parent, name) {
  try { const rel = cleanRelative(Meta.joinPath(parent, name)); return rel; } catch { return null; }
}

function conflictStem(rel, device) {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}h${pad(now.getMinutes())}`;
  const ext = Meta.extOf(rel);
  const name = Meta.baseName(rel);
  const stem = ext ? name.slice(0, -(ext.length + 1)) : name;
  return `${stem} (conflit ${device || 'autre ordinateur'} ${stamp})`;
}

module.exports = { SyncEngine, SyncService, deviceName, md5, STATE_FILE };
