// Opale — shared projects in the interface: the list of projects, and for
// each open one its replica, its session with the other computers and its
// status. Notes and boards of a shared project open in tabs under the path
// "@shared/<project>/<file>.md|.canvas".
import { api, app, bus, toast } from '../core.js';
import { Mesh } from './mesh.js';

const Crdt = window.OpaleCrdt;
const { Session, Emitter } = window.OpaleCollabSession;
const PREFIX = '@shared/';
const PALETTE = ['#f97316', '#22c55e', '#3b82f6', '#e11d48', '#a855f7', '#14b8a6', '#eab308', '#ec4899', '#0ea5e9', '#84cc16', '#f43f5e', '#8b5cf6'];
const IDLE_AFTER = 60000;

export function colorOf(id) { let hash = 0; for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[hash % PALETTE.length]; }
export const isShared = (path) => typeof path === 'string' && path.startsWith(PREFIX);
export function parsePath(path) {
  const match = /^@shared\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\.(md|canvas)$/.exec(String(path || ''));
  return match ? { project: match[1], file: match[2], kind: match[3] === 'md' ? 'note' : 'board' } : null;
}
export const pathOf = (project, file, kind) => `${PREFIX}${project}/${file}.${kind === 'board' ? 'canvas' : 'md'}`;
export const nameOf = (email) => String(email || '').split('@')[0] || 'Participant';

// ------------------------------------------------------------------ project
export class Project extends Emitter {
  constructor(boot) {
    super();
    this.id = boot.project.projectId;
    this.info = boot.project;
    this.token = boot.token;
    this.network = boot.network;
    this.me = { id: boot.me.id, email: boot.me.email, role: boot.me.role, name: nameOf(boot.me.email), device: boot.me.name, color: colorOf(boot.me.id) };
    this.members = boot.members;
    this.replica = Crdt.Replica.fromState(this.me.id, boot.state);
    this.lastConflict = this.replica.conflicts[this.replica.conflicts.length - 1];
    this.removed = boot.me.role === 'removed';
    this.mesh = new Mesh(this);
    const store = {
      persist: (changes, options) => api('/api/collab/persist', { method: 'POST', body: { project: this.id, token: this.token, changes, local: !!options.local, from: options.from || '' } }).then((result) => result.changes),
      since: (vv) => api('/api/collab/since', { method: 'POST', body: { project: this.id, vv } }),
      acceptState: (state, from) => api('/api/collab/state', { method: 'POST', body: { project: this.id, state, from } }),
      coordinate: (info) => api('/api/collab/coordinate', { method: 'POST', body: { project: this.id, ...info } }),
    };
    this.session = new Session({ replica: this.replica, me: { id: this.me.id, role: this.me.role, email: this.me.email }, store, transport: this.mesh });
    this._files = null;
    this.replica.on((effects, changes, local) => this.onEffects(effects, changes, local));
    this.session.on('presence', (id, data) => this.emit('presence', id, data));
    for (const name of ['status', 'peers', 'coordinator']) this.session.on(name, () => this.changed());
    this.session.on('error', (error) => console.warn('collab', error));
    this.activity = Date.now();
    this.idleTimer = setInterval(() => this.checkIdle(), 5000);
    this.mesh.start();
  }

  get readOnly() { return this.me.role === 'reader' || this.removed; }
  changed() { this.emit('status'); bus.emit('collab-status', this); }

  // ----------------------------------------------------------------- files
  files() { if (!this._files) this._files = Crdt.listFiles(this.replica); return this._files; }
  file(id) { return this.files().find((file) => file.id === id) || null; }
  pathOf(file) { return pathOf(this.id, file.id, file.kind); }
  onEffects(effects, changes, local) {
    if ([...effects.objs].some((obj) => obj.startsWith('F:'))) { this._files = null; this.emit('files'); bus.emit('collab-files', this); }
    this.emit('effects', effects, changes, local);
    const list = this.replica.conflicts;
    const last = list[list.length - 1];
    if (last && last !== this.lastConflict) {
      const fresh = list.slice(list.indexOf(this.lastConflict) + 1);
      this.lastConflict = last;
      this.emit('conflicts', fresh);
    }
    if (!local) this.changed();
  }

  // ----------------------------------------------------------------- edits
  commit(ops, options = {}) {
    if (this.readOnly) { toast(this.removed ? 'Vous n’êtes plus membre de ce projet : il est en lecture seule.' : 'Vous avez un accès en lecture seule à ce projet.'); return null; }
    this.touch();
    try { return this.session.commit(ops, options); }
    catch (error) { toast(error.message, { kind: 'error' }); return null; }
  }
  undo(scope) { this.touch(); return this.readOnly ? null : this.session.undo(scope); }
  redo(scope) { this.touch(); return this.readOnly ? null : this.session.redo(scope); }

  createFile(kind, name, parent = '', text = '') {
    const id = Crdt.newId();
    const ops = Crdt.createFileOps(this.replica, { id, name, parent, kind, text });
    if (!this.commit(ops, { scope: `files:${this.id}` })) return null;
    return id;
  }
  rename(id, name) { const ops = Crdt.renameFileOps(this.replica, id, name); if (ops.length) this.commit(ops, { scope: `files:${this.id}` }); }
  move(id, parent) { const ops = Crdt.moveFileOps(this.replica, id, parent); if (ops.length) this.commit(ops, { scope: `files:${this.id}` }); }
  remove(id) { const ops = Crdt.deleteFileOps(this.replica, id); if (ops.length) this.commit(ops, { scope: `files:${this.id}` }); }
  restore(id) { const ops = Crdt.restoreFileOps(this.replica, id); if (ops.length) this.commit(ops, { scope: `files:${this.id}` }); }
  uniqueName(parent, base, kind) {
    const taken = new Set(this.files().filter((file) => file.parent === parent && (file.kind === 'folder') === (kind === 'folder')).map((file) => file.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 1; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  }

  // -------------------------------------------------------------- presence
  // `doc`: the file being looked at; `data`: what the view wants to show.
  setPresence(doc, data) {
    this.ownPresence = { ...(this.ownPresence || {}), doc, ...data, name: this.me.name, email: this.me.email, color: this.me.color, state: this.idle ? 'idle' : 'active' };
    this.session.setPresence(this.ownPresence);
  }
  touch() {
    this.activity = Date.now();
    if (this.idle) { this.idle = false; if (this.ownPresence) this.setPresence(this.ownPresence.doc, {}); }
  }
  checkIdle() {
    const idle = document.visibilityState === 'hidden' || Date.now() - this.activity > IDLE_AFTER;
    if (idle !== !!this.idle) { this.idle = idle; if (this.ownPresence) this.setPresence(this.ownPresence.doc, {}); }
  }
  // Participants present in the session, with what they show.
  participants() {
    const out = [];
    for (const peer of this.session.connected()) {
      const presence = this.session.presence.get(peer.id) || {};
      out.push({ id: peer.id, email: peer.info.email, name: nameOf(peer.info.email), device: peer.info.name, role: peer.info.role, color: colorOf(peer.id), presence, state: presence.state || 'active' });
    }
    return out;
  }

  // ---------------------------------------------------------------- status
  // The four things people need to know, in the order changes travel.
  status() {
    const session = this.session.status();
    const drive = this.info.drive || {};
    const pendingDrive = Math.max(drive.pending || 0, 0) + session.localPending;
    const local = session.localError ? 'error' : session.localPending ? 'saving' : 'saved';
    const driveOk = drive.state === 'ok' || drive.state === 'idle';
    return {
      local, localError: session.localError,
      peers: session.peers, peersUpToDate: session.upToDate, peersHaveMine: session.peersHaveMine,
      drive: drive.state || 'idle', driveError: drive.error || '', driveSaved: driveOk && pendingDrive === 0, pendingDrive, lastSaved: drive.lastSaved || 0, lastCheckpoint: drive.lastCheckpoint || 0,
      // Made here, sent nowhere yet: lost if this computer dies now.
      onlyHere: pendingDrive > 0 && !session.peersHaveMine,
      coordinator: session.coordinator, isCoordinator: session.isCoordinator, waiting: session.waiting,
    };
  }
  level() {
    const s = this.status();
    if (this.removed) return 'error';
    if (s.local === 'error' || ['auth', 'access', 'error'].includes(s.drive)) return 'error';
    if (s.onlyHere && s.drive === 'offline') return 'warn';
    if (!s.driveSaved) return 'pending';
    return 'ok';
  }
  coordinatorName() {
    const id = this.session.coordinator;
    if (!id) return '';
    if (id === this.me.id) return 'cet ordinateur';
    const peer = this.session.peers.get(id);
    return peer ? `${nameOf(peer.info.email)} (${peer.info.name || 'ordinateur'})` : id;
  }
  memberName(actor) {
    if (actor === this.me.id) return 'vous';
    for (const member of (this.members && this.members.members) || []) if (member.devices.some((device) => device.deviceId === actor)) return nameOf(member.email);
    return 'un autre participant';
  }

  // ------------------------------------------------------- server messages
  async onServer(event) {
    if (event.summary) { this.info = event.summary; }
    switch (event.type) {
      case 'changes': await this.pull(); break;
      case 'signal': this.mesh.onSignal(event.from, event.payload); break;
      case 'acl':
        this.members = event.members;
        this.me.role = event.members.me.role;
        this.session.me.role = this.me.role;
        this.removed = !!event.removed;
        this.mesh.prune();
        if (this.removed) { this.mesh.close(); this.emit('removed'); }
        this.emit('members');
        break;
      default:
    }
    this.changed();
  }
  // Changes the server got from Drive.
  async pull() {
    try {
      const answer = await api('/api/collab/since', { method: 'POST', body: { project: this.id, vv: this.replica.vv } });
      if (answer.state) this.replica.mergeState(answer.state);
      else if (answer.changes && answer.changes.length) this.replica.receive(answer.changes);
    } catch (error) { console.warn(error); }
  }

  async refreshMembers() {
    this.members = await api('/api/collab/members', { method: 'POST', body: { project: this.id } });
    this.emit('members');
    return this.members;
  }

  close() {
    clearInterval(this.idleTimer);
    this.session.close(); this.mesh.close();
    api('/api/collab/close', { method: 'POST', body: { project: this.id } }).catch(() => {});
  }
}

// -------------------------------------------------------------- the client
export const collab = {
  overview: { account: {}, projects: [], network: {} },
  projects: new Map(),
  opening: new Map(),

  async load() {
    try { this.overview = await api('/api/collab'); } catch (error) { console.warn(error); }
    bus.emit('collab-list');
    return this.overview;
  },
  known(id) { return this.overview.projects.some((project) => project.projectId === id); },
  summary(id) { return this.overview.projects.find((project) => project.projectId === id) || null; },

  // Open a project: start the session and join whoever is there.
  open(id) {
    if (this.projects.has(id)) return Promise.resolve(this.projects.get(id));
    if (this.opening.has(id)) return this.opening.get(id);
    const promise = api('/api/collab/open', { method: 'POST', body: { project: id } })
      .then((boot) => { const project = new Project(boot); this.projects.set(id, project); bus.emit('collab-open', project); bus.emit('collab-list'); return project; })
      .finally(() => this.opening.delete(id));
    this.opening.set(id, promise);
    return promise;
  },
  close(id) {
    const project = this.projects.get(id);
    if (!project) return;
    project.close(); this.projects.delete(id);
    bus.emit('collab-list');
  },
  get(id) { return this.projects.get(id) || null; },

  // A path of a shared file: is it there (as far as we can tell now)?
  hasPath(path) {
    const asset = /^@shared\/([A-Za-z0-9_-]+)\/assets\/([A-Za-z0-9_-]+)\/([^/\\]+)$/.exec(String(path || ''));
    if (asset) return this.known(asset[1]);
    const parsed = parsePath(path);
    if (!parsed) return false;
    const project = this.projects.get(parsed.project);
    return project ? !!project.file(parsed.file) : this.known(parsed.project);
  },
  titleOf(path) {
    if (/^@shared\/[^/]+\/assets\//.test(path)) return path.split('/').pop();
    const parsed = parsePath(path);
    const project = parsed && this.projects.get(parsed.project);
    const file = project && project.file(parsed.file);
    return file ? file.display : 'Note partagée';
  },
  // [[Lien]] inside a shared note: resolved within its project.
  resolve(target, source) {
    const parsed = parsePath(source);
    const project = parsed && this.projects.get(parsed.project);
    if (!project) return null;
    if (/^assets\/[A-Za-z0-9_-]{10,200}\/[^/\\]+$/.test(String(target || ''))) return `@shared/${parsed.project}/${target}`;
    const clean = String(target || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\.(md|canvas)$/i, '').toLowerCase();
    if (!clean) return null;
    const files = project.files().filter((file) => file.kind !== 'folder');
    const hit = files.find((file) => file.path.toLowerCase() === clean) || files.find((file) => file.display.toLowerCase() === clean.split('/').pop());
    return hit ? project.pathOf(hit) : null;
  },

  textOf(path) {
    const parsed = parsePath(path);
    const project = parsed && this.projects.get(parsed.project);
    return project ? project.replica.textOf(Crdt.K.note(parsed.file)) : '';
  },
  // [[Lien]] to a note that does not exist yet in a shared project: create it.
  async createLinked(source, name, newTab) {
    const parsed = parsePath(source);
    const project = parsed && this.projects.get(parsed.project);
    if (!project) return null;
    const parts = name.split('/').filter(Boolean);
    const file = project.file(parsed.file);
    const id = project.createFile('note', parts.pop() || 'Sans titre', file ? file.parent : '');
    if (!id) return null;
    return app.workspace.openPath(project.pathOf(project.file(id)), { newTab });
  },

  async onEvent(event) {
    if (event.type === 'list' || event.type === 'account') { await this.load(); return; }
    const summary = event.summary;
    if (summary) { const at = this.overview.projects.findIndex((project) => project.projectId === summary.projectId); if (at >= 0) this.overview.projects[at] = summary; }
    const project = this.projects.get(event.project);
    if (project) await project.onServer(event);
    bus.emit('collab-list');
  },

  closeAll() { for (const id of [...this.projects.keys()]) this.close(id); },
};

// A window that closes says goodbye, so the others do not wait for it.
window.addEventListener('pagehide', () => { for (const project of collab.projects.values()) { project.session.flush(); project.mesh.shutdown(); } });

app.collab = collab;
