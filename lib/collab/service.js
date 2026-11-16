'use strict';

// Shared projects: the server side. Keeps each project's copy on this
// computer, its keys and membership, and its Drive folder: uploads this
// computer's changes in small batches, fetches the others', writes common
// checkpoints when asked by the coordinator, and carries the WebRTC set-up
// messages (offers and answers) through the folder. The interface does the
// live editing and talks to the other computers directly.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const appdata = require('../appdata.js');
const Crdt = require('../../shared/collab-crdt.js');
const Board = require('../../shared/board.js');
const identity = require('./identity.js');
const ACL = require('./acl.js');
const { ProjectStore } = require('./store.js');
const { DRIVE_ROLE } = require('./drive.js');
const { VaultError } = require('../vault.js');
const { GoogleError } = require('../google.js');

const { VV, K } = Crdt;
const POLL_MS = Number(process.env.OPALE_COLLAB_POLL_MS) || 3000;
const UPLOAD_DELAY = Number(process.env.OPALE_COLLAB_UPLOAD_MS) || 1500;
const UPLOAD_MAX_WAIT = 6000;
const BATCH_MAX = 400;
const CHECKPOINT_CHANGES = 400;
const CHECKPOINT_AGE = 10 * 60 * 1000;
const ORPHAN_AGE = 8000;
const SIGNAL_TTL = 2 * 60 * 1000;
const NONCE_TTL = 5 * 60 * 1000;
const DEFAULT_STUN = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

class CollabError extends VaultError {}
const lower = ACL.lower;
const random = (bytes = 9) => identity.b64url(crypto.randomBytes(bytes));
const cleanName = (value) => String(value || '').replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

function encodeCode(info) { return `OPALE-${identity.b64url(Buffer.from(JSON.stringify(info)))}`; }
function decodeCode(code) {
  const text = String(code || '').trim().replace(/^OPALE-/i, '');
  try { const info = JSON.parse(Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); if (info && info.p && info.f) return info; } catch {}
  throw new CollabError('Code d’invitation invalide : collez le code complet reçu par e-mail (il commence par « OPALE- »).', 400, 'invalid-code');
}
function describeError(error) {
  const code = error && error.code;
  if (code === 'auth') return { state: 'auth', error: 'Connexion Google expirée : reconnectez le compte dans Paramètres → Intégrations.' };
  if (code === 'offline') return { state: 'offline', error: 'Google Drive est injoignable. Les modifications restent sur cet ordinateur et partent dès le retour du réseau.' };
  if (code === 'missing') return { state: 'access', error: 'Le dossier du projet n’est plus accessible dans Drive (accès retiré ou dossier supprimé).' };
  return { state: 'error', error: error && error.message ? error.message : String(error) };
}

// ======================================================================
class CollabService extends EventEmitter {
  constructor({ account, drive, home, now }) {
    super();
    this.account = account; this.drive = drive;
    this.home = home || appdata.homeDir();
    this.dir = path.join(this.home, 'projects');
    this.settingsFile = path.join(this.home, 'collab.json');
    this.now = now || (() => Date.now());
    this.runtimes = new Map(); this.stores = new Map();
    this.config = appdata.readJson(this.settingsFile, null) || {};
    if (!this.config.installId) { this.config.installId = random(12); this.config.deviceName = os.hostname(); this.saveConfig(); }
  }
  saveConfig() { appdata.writeJson(this.settingsFile, this.config); }

  // --------------------------------------------------------------- settings
  network() {
    const net = this.config.network || {};
    return { stun: Array.isArray(net.stun) && net.stun.length ? net.stun : DEFAULT_STUN, turn: Array.isArray(net.turn) ? net.turn : [], driveOnly: !!net.driveOnly };
  }
  setNetwork(input) {
    const stun = String(input.stun || '').split(/[\s,]+/).map((url) => url.trim()).filter((url) => /^stuns?:/.test(url)).slice(0, 6);
    const turn = (Array.isArray(input.turn) ? input.turn : []).map((server) => ({ urls: String(server.urls || '').trim(), username: String(server.username || ''), credential: String(server.credential || '') }))
      .filter((server) => /^turns?:/.test(server.urls)).slice(0, 4);
    this.config.network = { stun: stun.length ? stun : DEFAULT_STUN, turn, driveOnly: !!input.driveOnly };
    if (typeof input.deviceName === 'string' && input.deviceName.trim()) this.config.deviceName = input.deviceName.trim().slice(0, 60);
    this.saveConfig();
    return this.network();
  }
  get deviceName() { return this.config.deviceName || os.hostname(); }

  // ------------------------------------------------------------- accounts
  accountInfo() {
    const info = this.account.info ? this.account.info() : {};
    return { configured: info.configured !== false, connected: !!this.account.connected, email: lower(this.account.email), sharedScope: !!info.sharedScope };
  }
  requireDrive() {
    const info = this.accountInfo();
    if (!info.connected) throw new GoogleError('Connectez un compte Google (Paramètres → Intégrations) pour utiliser les projets partagés.', 401, 'auth');
    if (!info.sharedScope) throw new GoogleError('Autorisez Opale à ouvrir les dossiers partagés avec vous dans Drive (bouton « Autoriser » des projets partagés).', 409, 'scope');
    return info.email;
  }

  // -------------------------------------------------------------- projects
  store(pid) {
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(String(pid || ''))) throw new CollabError('Projet inconnu.', 404, 'missing');
    if (!this.stores.has(pid)) this.stores.set(pid, new ProjectStore(path.join(this.dir, pid)));
    return this.stores.get(pid);
  }
  ids() {
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch {}
    return names.filter((name) => fs.existsSync(path.join(this.dir, name, 'local.json')));
  }
  runtime(pid) {
    const store = this.store(pid);
    if (!store.exists()) throw new CollabError('Ce projet n’est pas sur cet ordinateur.', 404, 'missing');
    if (!this.runtimes.has(pid)) this.runtimes.set(pid, new ProjectRuntime(this, pid, store));
    return this.runtimes.get(pid);
  }
  overview() {
    return { account: this.accountInfo(), network: this.network(), deviceName: this.deviceName, projects: this.ids().map((pid) => this.runtime(pid).summary()).sort((a, b) => a.name.localeCompare(b.name, 'fr')) };
  }
  event(project, type, data = {}) { this.emit('event', { project, type, ...data }); }

  // Create a project: folder, signed description, this computer's key.
  async create(nameInput) {
    const email = this.requireDrive();
    const name = cleanName(nameInput) || 'Projet partagé';
    const key = identity.generate();
    const nonce = random(16);
    const projectId = identity.projectIdOf(key.publicKey, nonce);
    const store = this.store(projectId);
    const signer = store.createKey(key);
    const genesis = signer.signObject({ v: 1, projectId, name, nonce, created: this.now(), owner: { email, deviceId: key.deviceId, key: key.publicKey, deviceName: this.deviceName } });
    try {
      const root = await this.drive.projectsRoot();
      const folder = await this.drive.createFolder(name, root, { opale: 'project', opaleProject: projectId });
      const devices = await this.drive.createFolder('appareils', folder.id, { opale: 'devices', opaleProject: projectId });
      const signal = await this.drive.createFolder('signalisation', folder.id, { opale: 'signal', opaleProject: projectId });
      await this.drive.createJson(folder.id, 'projet.json', { opaleProject: projectId, opaleKind: 'genesis' }, genesis);
      const record = signer.signObject({ v: 1, projectId, deviceId: key.deviceId, key: key.publicKey, email, name: this.deviceName, t: this.now() });
      await this.drive.createJson(devices.id, `device-${key.deviceId}.json`, { opaleProject: projectId, opaleKind: 'device', opaleDevice: key.deviceId }, record);
      store.writeAcl({ genesis, entries: [], devices: [record] });
      store.writeLocal({ v: 1, projectId, name, folderId: folder.id, devicesFolder: devices.id, signalFolder: signal.id, email, deviceId: key.deviceId, role: 'owner', ownerEmail: email, joinedAt: this.now(), state: 'active' });
    } catch (error) { store.destroy(); this.stores.delete(projectId); throw error; }
    const runtime = this.runtime(projectId);
    runtime.load();
    const noteId = Crdt.newId();
    runtime.author([...Crdt.createFileOps(runtime.replica, { id: noteId, name: 'Bienvenue', kind: 'note', text: `# ${name}\n\nCe projet est partagé : les notes et les moodboards créés ici sont modifiables à plusieurs, en direct.\n` })]);
    runtime.scheduleUpload(0);
    this.event(projectId, 'list');
    return runtime.summary();
  }

  // Projects shared with this account in Drive that are not here yet.
  async discover() {
    this.requireDrive();
    const known = new Set(this.ids());
    const folders = await this.drive.projectFolders();
    const seen = new Set();
    return folders.filter((folder) => folder.props.opaleProject && !known.has(folder.props.opaleProject) && !seen.has(folder.props.opaleProject) && seen.add(folder.props.opaleProject))
      .map((folder) => ({ projectId: folder.props.opaleProject, folderId: folder.id, name: folder.name, ownerEmail: folder.ownerEmail }));
  }

  // Join with a code (or a folder found by discover()). The account must be
  // a member: Drive must let it in, and the membership records must say so.
  async join(input) {
    const email = this.requireDrive();
    const info = input.code ? decodeCode(input.code) : { p: String(input.projectId || ''), f: String(input.folderId || '') };
    const folder = await this.drive.get(info.f).catch((error) => { if (error.code === 'missing') return null; throw error; });
    if (!folder || folder.props.opaleProject !== info.p) throw new CollabError(`Le compte ${email} n’a pas accès à ce projet dans Drive. Vérifiez que l’invitation a été envoyée à cette adresse.`, 403, 'no-access');
    const store = this.store(info.p);
    if (store.exists()) { const runtime = this.runtime(info.p); return runtime.summary(); }
    const files = await this.drive.list(info.p);
    const records = await readAclFiles(this.drive, files, info.p, null);
    if (!records.genesis) throw new CollabError('Ce dossier ne contient pas de projet Opale lisible.', 422, 'invalid');
    const problem = ACL.checkGenesis(records.genesis, info.p);
    if (problem) throw new CollabError(problem, 422, 'invalid');
    const state = ACL.fold(records.genesis, records.entries, records.devices);
    const role = state.role(email);
    if (ACL.RANK[role] < ACL.RANK.reader) throw new CollabError(`Le compte ${email} n’est pas membre de « ${folder.name} ». Demandez une invitation à un administrateur du projet.`, 403, 'not-member');
    const devicesFolder = files.find((file) => file.folder && file.props.opale === 'devices');
    const signalFolder = files.find((file) => file.folder && file.props.opale === 'signal');
    if (!devicesFolder || !signalFolder) throw new CollabError('Le dossier du projet est incomplet dans Drive.', 422, 'invalid');
    const signer = store.createKey();
    try {
      const record = signer.signObject({ v: 1, projectId: info.p, deviceId: signer.deviceId, key: signer.publicKey, email, name: this.deviceName, t: this.now() });
      await this.drive.createJson(devicesFolder.id, `device-${signer.deviceId}.json`, { opaleProject: info.p, opaleKind: 'device', opaleDevice: signer.deviceId }, record);
      store.writeAcl({ genesis: records.genesis, entries: records.entries, devices: [...records.devices, record] });
      store.writeLocal({ v: 1, projectId: info.p, name: records.genesis.name || folder.name, folderId: folder.id, devicesFolder: devicesFolder.id, signalFolder: signalFolder.id, email, deviceId: signer.deviceId, role, ownerEmail: lower(records.genesis.owner.email), joinedAt: this.now(), state: 'active' });
    } catch (error) { store.destroy(); this.stores.delete(info.p); throw error; }
    this.event(info.p, 'list');
    return this.runtime(info.p).summary();
  }

  async exportCopy(pid, target) { return this.runtime(pid).exportCopy(target); }

  closeAll() { for (const runtime of this.runtimes.values()) runtime.stop(); }
}

// Read membership files (description, decisions, devices) from a listing.
async function readAclFiles(drive, files, projectId, cache) {
  const out = { genesis: cache ? cache.genesis : null, entries: cache ? cache.entries.slice() : [], devices: cache ? cache.devices.slice() : [] };
  const entryIds = new Set(out.entries.map((entry) => entry.id));
  const deviceIds = new Map(out.devices.map((device) => [device.deviceId, device]));
  for (const file of files) {
    const kind = file.props.opaleKind;
    if (kind === 'genesis' && !out.genesis) {
      const genesis = await drive.readJson(file.id);
      if (!ACL.checkGenesis(genesis, projectId)) out.genesis = genesis;
    } else if (kind === 'acl' && !entryIds.has(file.name.replace(/^acl-\d+-|\.json$/g, ''))) {
      const entry = await drive.readJson(file.id).catch(() => null);
      if (entry && entry.id && !entryIds.has(entry.id)) { out.entries.push(entry); entryIds.add(entry.id); }
    } else if (kind === 'device' && !deviceIds.has(file.props.opaleDevice)) {
      const record = await drive.readJson(file.id).catch(() => null);
      // A key is pinned: a later file for the same device cannot replace it.
      if (record && !ACL.checkDevice(record, file, projectId) && !deviceIds.has(record.deviceId)) { out.devices.push(record); deviceIds.set(record.deviceId, record); }
    }
  }
  return out;
}

// ======================================================================
class ProjectRuntime {
  constructor(service, pid, store) {
    this.service = service; this.pid = pid; this.store = store;
    this.local = store.readLocal();
    this.replica = null; this.acl = null; this.driveState = null; this.signer = null;
    this.opened = false; this.token = '';
    this.timers = { poll: null, upload: null };
    this.nonces = new Map();
    this.connected = [];
    this.drive = { state: 'idle', error: '', lastSaved: 0, lastPoll: 0, lastCheckpoint: 0 };
    this.uploadFirst = 0; this.uploading = null; this.polling = null;
    this.aclRefreshedAt = 0; this.lastActivity = new Map();
  }
  get me() { return this.local.deviceId; }
  get api() { return this.service.drive; }

  load() {
    if (this.replica) return;
    this.signer = this.store.signer();
    this.acl = this.foldAcl();
    this.replica = this.store.load(this.me);
    this.driveState = this.store.readDrive();
    this.drive.lastCheckpoint = this.driveState.lastCheckpoint || 0;
  }
  foldAcl() {
    const saved = this.store.readAcl();
    if (!saved.genesis) throw new CollabError('Description du projet absente de la copie locale.', 500, 'invalid');
    return ACL.fold(saved.genesis, [...saved.entries, ...(saved.unsent || [])], saved.devices);
  }
  myAccess() { return this.acl.allowed(this.me); }
  role() { const access = this.myAccess(); return access.ok ? access.role : 'removed'; }

  summary() {
    const local = this.local;
    let role = local.role; let members = null;
    if (this.acl) { role = this.role(); members = this.acl.members.filter((member) => member.role !== 'removed').length; }
    const pendingDrive = this.replica ? Math.max(0, (this.replica.vv[this.me] || 0) - ((this.driveState && this.driveState.driveVV[this.me]) || 0)) : 0;
    return { projectId: this.pid, name: local.name, email: local.email, deviceId: this.me, role, ownerEmail: local.ownerEmail, members, open: this.opened, state: local.state || 'active',
      drive: { ...this.drive, pending: pendingDrive }, joinedAt: local.joinedAt };
  }
  setDrive(patch) {
    const before = `${this.drive.state}|${this.drive.error}`;
    Object.assign(this.drive, patch);
    if (`${this.drive.state}|${this.drive.error}` !== before || patch.lastSaved) this.service.event(this.pid, 'status', { summary: this.summary() });
  }

  // ------------------------------------------------------------ lifecycle
  start() {
    this.load();
    if (!this.opened) {
      this.opened = true;
      this.token = random(18);
      this.pollSoon(0);
    }
    return this.token;
  }
  stop() {
    this.opened = false;
    clearTimeout(this.timers.poll); clearTimeout(this.timers.upload);
    this.timers = { poll: null, upload: null };
    if (this.replica) { this.upload().catch(() => {}); }
    this.store.close();
  }
  bootstrap() {
    this.load();
    const access = this.myAccess();
    return {
      project: this.summary(), token: this.token, network: this.service.network(),
      me: { id: this.me, email: this.local.email, role: access.ok ? access.role : 'removed', name: this.service.deviceName },
      state: this.replica.toState(),
      members: this.members(),
    };
  }
  checkToken(token) { if (!this.opened || token !== this.token) throw new CollabError('Ce projet a été ouvert dans une autre fenêtre : rechargez celle-ci.', 409, 'stale-session'); }

  // Attachments are immutable Drive objects, referenced by their Drive id.
  // No reference is returned until the upload has succeeded.
  async putAttachment(name, bytes) {
    this.load();
    if (!this.myAccess().ok || this.role() === 'reader') throw new CollabError('Ce projet est en lecture seule.', 403, 'readonly');
    const safe = String(name || '').replace(/[<>:"|?*\\/\[\]#\u0000-\u001f]/g, '-').replace(/^\.+/, '').replace(/[. ]+$/, '').slice(0, 180) || 'Fichier';
    const file = await this.api.createBinary(this.local.folderId, safe, { opaleProject: this.pid, opaleKind: 'attachment' }, bytes);
    const dir = path.join(this.store.dir, 'attachments');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file.id), bytes);
    return `@shared/${this.pid}/assets/${file.id}/${safe}`;
  }
  async getAttachment(id) {
    this.load();
    if (!this.myAccess().ok) throw new CollabError('Vous n’avez plus accès à ce projet.', 403, 'removed');
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(String(id))) throw new CollabError('Fichier introuvable.', 404, 'missing');
    const dir = path.join(this.store.dir, 'attachments');
    const cached = path.join(dir, id);
    if (fs.existsSync(cached)) return cached;
    const meta = await this.api.get(id);
    if (!meta || meta.props.opaleProject !== this.pid || meta.props.opaleKind !== 'attachment' || !meta.parents.includes(this.local.folderId)) throw new CollabError('Fichier introuvable dans ce projet.', 404, 'missing');
    const bytes = await this.api.readBinary(id);
    fs.mkdirSync(dir, { recursive: true });
    const temp = `${cached}.${random(6)}.tmp`;
    fs.writeFileSync(temp, bytes);
    try { fs.renameSync(temp, cached); } catch (error) { fs.rmSync(temp, { force: true }); if (!fs.existsSync(cached)) throw error; }
    return cached;
  }

  // ------------------------------------------------------------- changes
  // A change made on this computer by the server itself (project creation).
  author(ops) {
    this.load();
    const result = this.replica.local(ops);
    if (!result) return null;
    const signed = { ...result.change, sig: this.signer.sign(Crdt.signedText(result.change)) };
    this.store.append([signed]);
    this.driveState.sinceCheckpoint = (this.driveState.sinceCheckpoint || 0) + 1;
    return signed;
  }

  async persist(changes, { local, from, token }) {
    this.load();
    if (!Array.isArray(changes)) throw new CollabError('Modifications attendues.');
    if (local) {
      this.checkToken(token);
      const access = this.myAccess();
      if (!access.ok) throw new CollabError('Vous n’êtes plus membre de ce projet : vos modifications restent sur cet ordinateur.', 403, 'removed');
      if (access.role === 'reader') throw new CollabError('Accès en lecture seule.', 403, 'read-only');
      const signed = [];
      for (const change of changes) {
        if (!Crdt.validChange(change) || change.a !== this.me) throw new CollabError('Modification locale invalide.', 400, 'invalid');
        const expected = (this.replica.vv[this.me] || 0) + 1 + signed.length;
        if (change.s !== expected) throw new CollabError('Numérotation des modifications incohérente : rechargez la fenêtre.', 409, 'stale-session');
        const clean = { a: change.a, s: change.s, l: change.l, d: change.d, t: change.t, o: change.o };
        signed.push({ ...clean, sig: this.signer.sign(Crdt.signedText(clean)) });
      }
      this.store.append(signed);
      this.replica.receive(signed);
      this.driveState.sinceCheckpoint = (this.driveState.sinceCheckpoint || 0) + signed.length;
      this.scheduleUpload();
      return signed;
    }
    return this.acceptRemote(changes, { from });
  }

  // Changes from another computer or from Drive: kept only when signed by a
  // known device of the project.
  async acceptRemote(changes, { from, viaOwner } = {}) {
    const accepted = []; const fresh = [];
    let refreshed = false;
    for (const change of changes) {
      if (!Crdt.validChange(change)) continue;
      const known = this.store.changes.get(`${change.a}:${change.s}`);
      if (known || this.replica.has(change)) { if (known) accepted.push(known); continue; }
      let problem = this.checkChange(change, from, viaOwner);
      if (problem === 'unknown' && !refreshed) { refreshed = true; await this.refreshAcl(true).catch(() => {}); problem = this.checkChange(change, from, viaOwner); }
      if (problem) continue;
      const clean = { a: change.a, s: change.s, l: change.l, d: change.d, t: change.t, o: change.o, sig: change.sig };
      fresh.push(clean); accepted.push(clean);
      this.lastActivity.set(change.a, this.service.now());
    }
    if (fresh.length) { this.store.append(fresh); this.replica.receive(fresh); this.driveState.sinceCheckpoint = (this.driveState.sinceCheckpoint || 0) + fresh.length; }
    return accepted;
  }
  checkChange(change, from, viaOwner) {
    const device = this.acl.device(change.a);
    if (!device) return 'unknown';
    if (!identity.verify(device.key, Crdt.signedText(change), change.sig)) return 'signature';
    if (viaOwner && viaOwner !== device.email) return 'owner';
    const access = this.acl.allowed(change.a);
    // A removed or revoked computer cannot send anything new itself; what
    // other members relay was made while it was still allowed.
    if (!access.ok && (from === change.a || viaOwner)) return 'revoked';
    if (access.ok && access.role === 'reader') return 'reader';
    return '';
  }

  since(vv) { this.load(); return this.store.since(vv || {}); }

  acceptState(state, from) {
    this.load();
    const peer = from ? this.acl.allowed(from) : { ok: true, role: 'editor' };
    if (!peer.ok || peer.role === 'reader') throw new CollabError('État refusé.', 403, 'forbidden');
    this.replica.mergeState(state);
    this.store.saveState();
    return { vv: this.replica.vv };
  }

  // ---------------------------------------------------------------- Drive
  scheduleUpload(delay = UPLOAD_DELAY) {
    if (!this.uploadFirst) this.uploadFirst = this.service.now();
    clearTimeout(this.timers.upload);
    const wait = Math.max(0, Math.min(delay, this.uploadFirst + UPLOAD_MAX_WAIT - this.service.now()));
    this.timers.upload = setTimeout(() => { this.upload().catch(() => {}); }, wait);
  }

  async upload() {
    if (this.uploading) return this.uploading;
    this.uploading = (async () => {
      this.uploadFirst = 0;
      if (!this.replica || this.role() === 'reader' || !this.myAccess().ok) return;
      for (;;) {
        const from = (this.driveState.driveVV[this.me] || 0) + 1;
        const to = Math.min(this.replica.vv[this.me] || 0, from + BATCH_MAX - 1);
        if (to < from) break;
        const changes = [];
        for (let s = from; s <= to; s++) { const change = this.store.changes.get(`${this.me}:${s}`); if (!change) break; changes.push(change); }
        if (!changes.length) break;
        const last = changes[changes.length - 1].s;
        try {
          await this.api.createJson(this.local.folderId, `ops-${this.me}-${from}-${last}.json`, { opaleProject: this.pid, opaleKind: 'ops', opaleActor: this.me, opaleFrom: String(from), opaleTo: String(last) }, { v: 1, actor: this.me, changes });
        } catch (error) {
          this.setDrive(describeError(error));
          this.scheduleUpload(error.code === 'offline' ? 15000 : 6000);
          return;
        }
        this.driveState.driveVV[this.me] = last;
        this.saveDriveState();
        this.setDrive({ state: 'ok', error: '', lastSaved: this.service.now() });
        this.service.event(this.pid, 'drive', { driveVV: this.driveState.driveVV, summary: this.summary() });
      }
      if (this.store.compact(this.driveState.driveVV)) this.service.event(this.pid, 'compacted');
    })().finally(() => { this.uploading = null; });
    return this.uploading;
  }
  saveDriveState() { this.store.writeDrive(this.driveState); }

  pollSoon(delay = POLL_MS) {
    clearTimeout(this.timers.poll);
    if (!this.opened) return;
    this.timers.poll = setTimeout(() => { this.poll().catch(() => {}).finally(() => { if (this.opened) this.pollSoon(this.drive.state === 'ok' || this.drive.state === 'idle' ? POLL_MS : Math.min(60000, POLL_MS * 5)); }); }, delay);
  }

  // Everything new in the folder: membership, changes, checkpoints, offers.
  async poll() {
    if (this.polling) return this.polling;
    this.polling = (async () => {
      this.load();
      const started = this.service.now();
      let files;
      try {
        // A listing never fails when access is withdrawn: it is just empty.
        if (started - (this.accessCheckedAt || 0) > 30000) {
          if (!await this.api.get(this.local.folderId)) { this.setDrive(describeError({ code: 'missing' })); return; }
          this.accessCheckedAt = started;
        }
        files = await this.api.list(this.pid, this.driveState.lastPoll ? this.driveState.lastPoll - 120000 : 0);
      } catch (error) { this.setDrive(describeError(error)); return; }
      const seen = this.driveState.seen || (this.driveState.seen = {});
      const isNew = (file) => seen[file.id] !== file.modified;
      try {
        if (files.some((file) => ['genesis', 'acl', 'device'].includes(file.props.opaleKind) && isNew(file)) || !this.aclRefreshedAt) await this.refreshAcl(false, files);
        await this.flushAclUnsent();
        let gotData = false;
        // Checkpoints first: batches they cover are then skipped.
        for (const file of files.filter((item) => item.props.opaleKind === 'snapshot' && isNew(item)).sort((a, b) => a.created - b.created)) {
          if (await this.readSnapshot(file)) gotData = true;
          seen[file.id] = file.modified;
        }
        for (const file of files.filter((item) => ['ops', 'relay'].includes(item.props.opaleKind) && isNew(item)).sort((a, b) => a.created - b.created)) {
          const actor = file.props.opaleActor; const to = Number(file.props.opaleTo) || 0;
          if (actor && to) this.driveState.driveVV[actor] = Math.max(this.driveState.driveVV[actor] || 0, to);
          if (actor && (this.replica.vv[actor] || 0) < to) {
            const data = await this.api.readJson(file.id);
            const accepted = await this.acceptRemote(Array.isArray(data && data.changes) ? data.changes : [], { viaOwner: file.props.opaleKind === 'ops' ? file.ownerEmail : '' });
            if (accepted.length) gotData = true;
          }
          seen[file.id] = file.modified;
        }
        for (const file of files.filter((item) => item.props.opaleKind === 'signal')) {
          if (file.ownedByMe) { if (started - file.created > SIGNAL_TTL) this.api.remove(file.id).catch(() => {}); continue; }
          if (file.props.opaleTo !== this.me || !isNew(file) || started - file.modified > SIGNAL_TTL) continue;
          seen[file.id] = file.modified;
          const message = await this.api.readJson(file.id).catch(() => null);
          const device = message && this.acl.device(message.from);
          if (!device || device.email !== file.ownerEmail) continue;
          this.service.event(this.pid, 'signal', { from: message.from, payload: message.payload });
        }
        if (gotData) this.service.event(this.pid, 'changes');
        // Forget ids of files that are gone.
        if (!this.driveState.lastPoll || Object.keys(seen).length > 5000) {
          const present = new Set(files.map((file) => file.id));
          if (!this.driveState.lastPoll) for (const id of Object.keys(seen)) if (!present.has(id)) delete seen[id];
        }
        this.driveState.lastPoll = started;
        this.saveDriveState();
        await this.cleanup(files);
        const wasOk = this.drive.state === 'ok';
        this.setDrive({ state: 'ok', error: '', lastPoll: started });
        if (!wasOk && (this.replica.vv[this.me] || 0) > (this.driveState.driveVV[this.me] || 0)) this.scheduleUpload(0);
      } catch (error) { this.setDrive(describeError(error)); }
    })().finally(() => { this.polling = null; });
    return this.polling;
  }

  async readSnapshot(file) {
    const data = await this.api.readJson(file.id).catch(() => null);
    if (!data || data.v !== 1 || data.projectId !== this.pid || !data.state) return false;
    const device = this.acl.device(data.by);
    if (!device || device.email !== file.ownerEmail) return false;
    const hash = crypto.createHash('sha256').update(Crdt.stable(data.state)).digest('base64');
    if (hash !== data.hash || !identity.verifyObject({ v: data.v, projectId: data.projectId, by: data.by, at: data.at, vv: data.vv, hash: data.hash, sig: data.sig }, device.key)) return false;
    const snaps = this.driveState.snapshots || (this.driveState.snapshots = []);
    if (!snaps.some((snap) => snap.id === file.id)) snaps.push({ id: file.id, vv: data.vv, by: data.by, at: data.at, mine: file.ownedByMe });
    for (const [actor, seq] of Object.entries(data.vv || {})) this.driveState.driveVV[actor] = Math.max(this.driveState.driveVV[actor] || 0, seq);
    if (VV.covers(this.replica.vv, data.vv)) return false;
    this.replica.mergeState(data.state);
    this.store.saveState();
    return true;
  }

  // Each computer deletes its own batches once a checkpoint covers them.
  async cleanup(files) {
    if (this.cleaning || this.role() === 'reader') return;
    const covered = (this.driveState.snapshots || []).reduce((acc, snap) => VV.max(acc, snap.vv || {}), {});
    const mine = files.filter((file) => file.ownedByMe && ['ops', 'relay'].includes(file.props.opaleKind) && (covered[file.props.opaleActor] || 0) >= (Number(file.props.opaleTo) || Infinity));
    const mySnaps = files.filter((file) => file.ownedByMe && file.props.opaleKind === 'snapshot').sort((a, b) => b.created - a.created).slice(2);
    if (!mine.length && !mySnaps.length) return;
    this.cleaning = true;
    try { for (const file of [...mine, ...mySnaps].slice(0, 40)) await this.api.remove(file.id).catch(() => {}); }
    finally { this.cleaning = false; }
  }

  // Asked every few seconds by the computer that coordinates the session.
  async coordinate({ connected }) {
    this.load();
    this.connected = Array.isArray(connected) ? connected.map(String) : [];
    if (this.role() === 'reader' || !this.myAccess().ok) return { skipped: true };
    const now = this.service.now();
    const relayed = [];
    // Changes of computers that left before sending them to Drive.
    for (const [actor, seq] of Object.entries(this.replica.vv)) {
      if (actor === this.me || this.connected.includes(actor)) continue;
      const onDrive = this.driveState.driveVV[actor] || 0;
      if (seq <= onDrive || now - (this.lastActivity.get(actor) || 0) < ORPHAN_AGE) continue;
      const changes = [];
      for (let s = onDrive + 1; s <= seq; s++) { const change = this.store.changes.get(`${actor}:${s}`); if (!change) break; changes.push(change); }
      if (!changes.length) continue;
      const last = changes[changes.length - 1].s;
      try {
        await this.api.createJson(this.local.folderId, `rel-${this.me}-${actor}-${onDrive + 1}-${last}.json`, { opaleProject: this.pid, opaleKind: 'relay', opaleActor: actor, opaleFrom: String(onDrive + 1), opaleTo: String(last) }, { v: 1, actor, relayedBy: this.me, changes });
        this.driveState.driveVV[actor] = last; relayed.push(actor);
      } catch (error) { this.setDrive(describeError(error)); return { error: error.message }; }
    }
    const due = (this.driveState.sinceCheckpoint || 0) >= CHECKPOINT_CHANGES || ((this.driveState.sinceCheckpoint || 0) > 0 && now - (this.driveState.lastCheckpoint || 0) > CHECKPOINT_AGE);
    let checkpoint = false;
    if (due) checkpoint = await this.checkpoint().then(() => true, () => false);
    if (relayed.length) { this.saveDriveState(); this.service.event(this.pid, 'drive', { driveVV: this.driveState.driveVV, summary: this.summary() }); }
    return { relayed, checkpoint };
  }

  // A full checkpoint of the project in Drive.
  async checkpoint() {
    this.load();
    await this.upload();
    const state = this.replica.toState();
    const at = this.service.now();
    const body = { v: 1, projectId: this.pid, by: this.me, at, vv: { ...this.replica.vv }, hash: crypto.createHash('sha256').update(Crdt.stable(state)).digest('base64') };
    const signed = this.signer.signObject(body);
    const file = await this.api.createJson(this.local.folderId, `snap-${this.me}-${at}.json`, { opaleProject: this.pid, opaleKind: 'snapshot' }, { ...signed, state });
    this.driveState.snapshots = [...(this.driveState.snapshots || []), { id: file.id, vv: body.vv, by: this.me, at, mine: true }].slice(-10);
    for (const [actor, seq] of Object.entries(body.vv)) this.driveState.driveVV[actor] = Math.max(this.driveState.driveVV[actor] || 0, seq);
    this.driveState.sinceCheckpoint = 0; this.driveState.lastCheckpoint = at;
    this.saveDriveState();
    this.setDrive({ lastCheckpoint: at, lastSaved: at, state: 'ok', error: '' });
    this.service.event(this.pid, 'drive', { driveVV: this.driveState.driveVV, summary: this.summary() });
    return { at };
  }

  // ------------------------------------------------------------ membership
  async refreshAcl(force, listing) {
    if (force && this.service.now() - this.aclRefreshedAt < 5000) return;
    this.aclRefreshedAt = this.service.now();
    const files = listing || await this.api.list(this.pid);
    const saved = this.store.readAcl();
    const relevant = files.filter((file) => ['genesis', 'acl', 'device'].includes(file.props.opaleKind));
    const merged = await readAclFiles(this.api, relevant, this.pid, saved);
    const before = Crdt.stable({ m: this.acl ? this.acl.members : [], d: this.acl ? this.acl.devices : [] });
    this.store.writeAcl({ ...saved, genesis: saved.genesis || merged.genesis, entries: merged.entries, devices: merged.devices });
    this.acl = this.foldAcl();
    for (const file of relevant) (this.driveState.seen || (this.driveState.seen = {}))[file.id] = file.modified;
    const after = Crdt.stable({ m: this.acl.members, d: this.acl.devices });
    if (before !== after) this.aclChanged();
  }
  aclChanged() {
    const access = this.myAccess();
    const role = access.ok ? access.role : 'removed';
    if (role !== this.local.role || (!access.ok && this.local.state !== 'removed')) {
      this.local = { ...this.local, role, state: access.ok ? 'active' : 'removed' };
      this.store.writeLocal(this.local);
    }
    this.service.event(this.pid, 'acl', { members: this.members(), summary: this.summary(), removed: !access.ok, reason: access.reason || '' });
  }

  members() {
    this.load();
    const me = this.acl.allowed(this.me);
    const myRole = me.ok ? me.role : 'removed';
    const list = this.acl.members.filter((member) => member.role !== 'removed').map((member) => ({
      email: member.email, role: member.role, since: member.since, me: member.email === lower(this.local.email),
      devices: this.acl.devices.filter((device) => device.email === member.email).map((device) => ({ deviceId: device.deviceId, name: device.name, revoked: device.revoked, created: device.created, me: device.deviceId === this.me })),
    }));
    return { me: { email: this.local.email, deviceId: this.me, role: myRole }, canManage: ACL.RANK[myRole] >= ACL.RANK.admin, isOwner: myRole === 'owner', members: list,
      code: encodeCode({ p: this.pid, f: this.local.folderId, n: this.local.name }) };
  }

  async writeEntry(fields) {
    this.load();
    const entry = this.signer.signObject({ v: 1, ...fields, n: this.acl.counter + 1, by: this.me, byKey: this.signer.publicKey, t: this.service.now(), id: random(9) });
    const saved = this.store.readAcl();
    const trial = ACL.fold(saved.genesis, [...saved.entries, ...(saved.unsent || []), entry], saved.devices);
    const rejected = trial.rejected.find((item) => item.id === entry.id);
    if (rejected) throw new CollabError(`Action refusée : ${rejected.reason}.`, 403, 'forbidden');
    saved.unsent = [...(saved.unsent || []), entry];
    this.store.writeAcl(saved);
    this.acl = this.foldAcl();
    await this.flushAclUnsent();
    this.aclChanged();
    return entry;
  }
  async flushAclUnsent() {
    const saved = this.store.readAcl();
    if (!saved.unsent || !saved.unsent.length) return;
    const left = [];
    for (const entry of saved.unsent) {
      try { await this.api.createJson(this.local.folderId, `acl-${entry.n}-${entry.id}.json`, { opaleProject: this.pid, opaleKind: 'acl' }, entry); saved.entries.push(entry); }
      catch (error) { left.push(entry); this.setDrive(describeError(error)); }
    }
    saved.unsent = left;
    this.store.writeAcl(saved);
  }

  async findPermission(folderId, email) { return (await this.api.permissions(folderId)).find((perm) => perm.email === lower(email) && perm.role !== 'owner') || null; }

  async invite(emailInput, role) {
    const email = lower(emailInput);
    if (!ACL.validEmail(email)) throw new CollabError('Adresse e-mail invalide.');
    if (!['admin', 'editor', 'reader'].includes(role)) throw new CollabError('Rôle invalide.');
    const current = this.acl.role(email);
    if (current !== 'removed') throw new CollabError(`${email} est déjà membre du projet.`, 409, 'exists');
    await this.writeEntry({ type: 'member', email, role });
    const code = this.members().code;
    const message = `${this.local.email} vous invite au projet partagé « ${this.local.name} » dans Opale.\n\nDans Opale : Projets partagés → Rejoindre un projet, puis collez ce code :\n${code}`;
    await this.applyPermissions(email, role, message);
    return { code, members: this.members() };
  }
  async applyPermissions(email, role, message) {
    const folders = [[this.local.folderId, DRIVE_ROLE[role]], [this.local.devicesFolder, 'writer'], [this.local.signalFolder, 'writer']];
    for (const [folderId, driveRole] of folders) {
      const existing = await this.findPermission(folderId, email);
      if (existing) { if (existing.role !== driveRole) await this.api.setRole(folderId, existing.id, driveRole); }
      else await this.api.share(folderId, email, driveRole, folderId === this.local.folderId ? message : '');
    }
  }
  async setRole(emailInput, role) {
    const email = lower(emailInput);
    if (!['admin', 'editor', 'reader'].includes(role)) throw new CollabError('Rôle invalide.');
    await this.writeEntry({ type: 'member', email, role });
    await this.applyPermissions(email, role, '');
    return this.members();
  }
  async remove(emailInput) {
    const email = lower(emailInput);
    await this.writeEntry({ type: 'member', email, role: 'removed' });
    const failures = [];
    for (const folderId of [this.local.folderId, this.local.devicesFolder, this.local.signalFolder]) {
      try { const perm = await this.findPermission(folderId, email); if (perm) await this.api.unshare(folderId, perm.id); }
      catch (error) { failures.push(error.message); }
    }
    return { members: this.members(), driveWarning: failures.length ? `Le retrait dans Opale est fait, mais Drive a refusé de retirer l’accès au dossier (${failures[0]}). Seul le propriétaire du dossier peut le faire.` : '' };
  }
  async revokeDevice(deviceId) {
    if (!this.acl.device(deviceId)) throw new CollabError('Appareil inconnu.', 404, 'missing');
    await this.writeEntry({ type: 'revoke', device: String(deviceId) });
    return this.members();
  }
  async leave() {
    this.load();
    if (this.role() === 'owner') throw new CollabError('Le propriétaire ne peut pas quitter son projet.', 409, 'owner');
    try { await this.writeEntry({ type: 'member', email: lower(this.local.email), role: 'removed' }); } catch {}
    for (const folderId of [this.local.signalFolder, this.local.devicesFolder, this.local.folderId]) {
      try { const perm = await this.findPermission(folderId, this.local.email); if (perm) await this.api.unshare(folderId, perm.id); } catch {}
    }
    this.forget(true);
    return { ok: true };
  }
  // Remove the copy from this computer. `all`: the membership as well.
  forget(all) {
    this.stop();
    if (all) { this.store.destroy(); this.service.runtimes.delete(this.pid); this.service.stores.delete(this.pid); }
    else { this.store.dropData(); this.replica = null; this.driveState = null; }
    this.service.event(this.pid, 'list');
  }

  // ------------------------------------------------------------ handshake
  hello() {
    this.load();
    const nonce = random(18);
    const now = this.service.now();
    this.nonces.set(nonce, now);
    for (const [key, at] of this.nonces) if (now - at > NONCE_TTL) this.nonces.delete(key);
    return { deviceId: this.me, key: this.signer.publicKey, email: this.local.email, name: this.service.deviceName, nonce };
  }
  proof({ peer, peerNonce, localFp, remoteFp }) {
    this.load();
    return { sig: this.signer.sign(`opale-collab-v1|${this.pid}|${this.me}|${peer}|${peerNonce}|${localFp}|${remoteFp}`) };
  }
  async verifyPeer({ hello, proof, nonce, localFp, remoteFp }) {
    this.load();
    if (!hello || !proof || !this.nonces.has(nonce)) return { ok: false, reason: 'nonce' };
    this.nonces.delete(nonce);
    let device = this.acl.device(hello.deviceId);
    if (!device) { await this.refreshAcl(true).catch(() => {}); device = this.acl.device(hello.deviceId); }
    if (!device) return { ok: false, reason: 'unknown' };
    if (device.key !== hello.key) return { ok: false, reason: 'key' };
    const access = this.acl.allowed(hello.deviceId);
    if (!access.ok) return { ok: false, reason: access.reason };
    if (!identity.verify(device.key, `opale-collab-v1|${this.pid}|${hello.deviceId}|${this.me}|${nonce}|${remoteFp}|${localFp}`, proof.sig)) return { ok: false, reason: 'signature' };
    this.lastActivity.set(hello.deviceId, this.service.now());
    return { ok: true, member: { id: device.deviceId, email: device.email, role: access.role, name: device.name } };
  }
  allowedDevices() { this.load(); return this.acl.devices.filter((device) => this.acl.allowed(device.deviceId).ok && device.deviceId !== this.me).map((device) => device.deviceId); }

  async signal(to, payload) {
    this.load();
    if (!this.acl.allowed(to).ok) throw new CollabError('Appareil non autorisé.', 403, 'forbidden');
    const file = await this.api.createJson(this.local.signalFolder, `sig-${this.me}-${to}-${random(6)}.json`, { opaleProject: this.pid, opaleKind: 'signal', opaleTo: String(to), opaleFrom: this.me }, { from: this.me, to, payload, t: this.service.now() });
    return { id: file.id };
  }

  // ---------------------------------------------------------------- export
  async exportCopy(target) {
    this.load();
    const root = target || path.join(os.homedir(), 'Documents', 'Opale', 'Projets partagés', cleanName(this.local.name) || this.pid);
    fs.mkdirSync(root, { recursive: true });
    let count = 0; const assets = new Map();
    const collect = (value) => {
      for (const match of String(value || '').matchAll(/(?:@shared\/[A-Za-z0-9_-]+\/)?assets\/([A-Za-z0-9_-]{10,200})\/([^/\\\]\[|#\r\n"']+)/g)) {
        const name = match[2].trim();
        if (name && name !== '.' && name !== '..') assets.set(match[1], name);
      }
    };
    for (const file of Crdt.listFiles(this.replica)) {
      const parts = file.path.split('/').map((part) => cleanName(part) || '_');
      const full = path.join(root, ...parts);
      if (file.kind === 'folder') { fs.mkdirSync(full, { recursive: true }); continue; }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      if (file.kind === 'note') { const text = this.replica.textOf(K.note(file.id)); collect(text); fs.writeFileSync(`${full}.md`, text, 'utf8'); }
      else {
        const doc = Crdt.boardDoc(this.replica, file.id); doc.elements = doc.elements.map((el) => Board.normalize(el));
        for (const el of doc.elements) for (const key of ['file', 'image']) if (typeof el.data[key] === 'string' && el.data[key].startsWith(`@shared/${this.pid}/assets/`)) { collect(el.data[key]); el.data[key] = el.data[key].slice(`@shared/${this.pid}/`.length); }
        fs.writeFileSync(`${full}.canvas`, Board.serialize(doc), 'utf8');
      }
      count++;
    }
    for (const [id, name] of assets) {
      const safe = name.replace(/[<>:"|?*\\/\u0000-\u001f]/g, '-').replace(/[. ]+$/, '');
      if (!safe || safe === '.' || safe === '..') throw new CollabError('Nom de pièce jointe invalide pendant l’export.', 400, 'invalid');
      const dest = path.join(root, 'assets', id, safe); fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(await this.getAttachment(id), dest);
    }
    return { path: root, files: count, attachments: assets.size };
  }
}

module.exports = { CollabService, ProjectRuntime, CollabError, encodeCode, decodeCode };
