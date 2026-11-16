'use strict';

// Shared projects: the Drive calls they need. A project is a folder found by
// its id stored in appProperties (never by its name), with two subfolders
// every member may write to (device records and connection set-up), while
// the folder itself is writable only by members allowed to edit.
//
//   <Projet>/                       opale=project, opaleProject=<id>
//     projet.json, acl-*.json      description and signed membership decisions
//     ops-*.json, rel-*.json       small batches of changes
//     snap-*.json                  full checkpoints
//     appareils/                   device-*.json (one per computer)
//     signalisation/               sig-*.json (WebRTC offers and answers)
//
// Every file carries opaleProject=<id> so one query lists the project.
// FakeDrive implements the same calls on a local folder, for tests running
// several instances of Opale on one computer.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GoogleError } = require('../google.js');

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,parents,appProperties,modifiedTime,createdTime,size,trashed,ownedByMe,owners(emailAddress,displayName),lastModifyingUser(emailAddress,displayName)';
const ALL = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
const DRIVE_ROLE = { owner: 'writer', admin: 'writer', editor: 'writer', reader: 'reader' };
const lower = (value) => String(value || '').toLowerCase();

function item(file) {
  const owner = (file.owners || [])[0] || {};
  return {
    id: file.id, name: file.name, folder: file.mimeType === FOLDER, parents: file.parents || [], props: file.appProperties || {},
    modified: Date.parse(file.modifiedTime) || 0, created: Date.parse(file.createdTime) || 0, size: Number(file.size) || 0, trashed: !!file.trashed,
    ownedByMe: !!file.ownedByMe, ownerEmail: lower(owner.emailAddress), ownerName: owner.displayName || '',
    modifierEmail: lower((file.lastModifyingUser || {}).emailAddress), modifierName: (file.lastModifyingUser || {}).displayName || '',
  };
}
const quote = (value) => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

class ProjectDrive {
  constructor(account) { this.account = account; }
  get email() { return lower(this.account.email); }
  async _json(url, options) { return (await this.account.request(url, options)).json(); }

  async query(q) {
    const out = []; let pageToken = '';
    do {
      const params = new URLSearchParams({ q, fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives' });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this._json(`${API}/files?${params}`);
      out.push(...(page.files || []).map(item));
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  async get(id) {
    try { const file = item(await this._json(`${API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}&${ALL}`)); return file.trashed ? null : file; }
    catch (error) { if (error.code === 'missing') return null; throw error; }
  }

  // Opale/Projets partagés in this account's own Drive.
  async projectsRoot() {
    const mine = await this.query("appProperties has { key='opale' and value='projects' } and 'me' in owners and trashed=false");
    if (mine.length) return mine[0].id;
    const roots = await this.query("appProperties has { key='opale' and value='root' } and 'me' in owners and trashed=false");
    const root = roots.length ? roots[0].id : (await this.createFolder('Opale', null, { opale: 'root' })).id;
    return (await this.createFolder('Projets partagés', root, { opale: 'projects' })).id;
  }

  async createFolder(name, parent, props) {
    return item(await this._json(`${API}/files?fields=${encodeURIComponent(FIELDS)}&supportsAllDrives=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}), appProperties: props }) }));
  }

  // Every project folder this account can open, its own or shared with it.
  async projectFolders(projectId) {
    const extra = projectId ? ` and appProperties has { key='opaleProject' and value='${quote(projectId)}' }` : '';
    return this.query(`appProperties has { key='opale' and value='project' }${extra} and mimeType='${FOLDER}' and trashed=false`);
  }

  async list(projectId, since) {
    const after = since ? ` and modifiedTime > '${new Date(since).toISOString()}'` : '';
    return this.query(`appProperties has { key='opaleProject' and value='${quote(projectId)}' } and trashed=false${after}`);
  }

  async createJson(parent, name, props, value) {
    const meta = { name, parents: [parent], appProperties: props, mimeType: 'application/json' };
    return this._upload(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}`, 'POST', meta, value);
  }
  async updateJson(id, value) {
    return this._upload(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}`, 'PATCH', {}, value);
  }
  async _upload(url, method, meta, value) {
    const boundary = `opale${crypto.randomBytes(12).toString('hex')}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`),
      Buffer.from(JSON.stringify(value), 'utf8'), Buffer.from(`\r\n--${boundary}--`)]);
    return item(await this._json(url, { method, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }));
  }
  async readJson(id) {
    const response = await this.account.request(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
    const text = await response.text();
    try { return JSON.parse(text); } catch { throw new GoogleError('Fichier de projet illisible dans Drive.', 502, 'corrupt'); }
  }
  async createBinary(parent, name, props, data) {
    const meta = { name, parents: [parent], appProperties: props, mimeType: 'application/octet-stream' };
    const target = `${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}`;
    const session = await this.account.request(target, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(data.length) }, body: JSON.stringify(meta) });
    const location = session.headers.get('location');
    if (!location) throw new GoogleError('Google Drive n’a pas ouvert de session d’envoi.');
    return item(await this._json(location, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: data }));
  }
  async readBinary(id) {
    const response = await this.account.request(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
    return Buffer.from(await response.arrayBuffer());
  }
  // Only the account that created a file can delete it.
  async remove(id) {
    try { await this.account.request(`${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, { method: 'DELETE' }); }
    catch (error) { if (error.code !== 'missing') throw error; }
  }

  async permissions(folderId) {
    const data = await this._json(`${API}/files/${encodeURIComponent(folderId)}/permissions?supportsAllDrives=true&fields=${encodeURIComponent('permissions(id,emailAddress,role,type)')}`);
    return (data.permissions || []).map((perm) => ({ id: perm.id, email: lower(perm.emailAddress), role: perm.role, type: perm.type }));
  }
  async share(folderId, email, role, message) {
    const params = new URLSearchParams({ supportsAllDrives: 'true', sendNotificationEmail: message ? 'true' : 'false' });
    if (message) params.set('emailMessage', message.slice(0, 1800));
    return this._json(`${API}/files/${encodeURIComponent(folderId)}/permissions?${params}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'user', role, emailAddress: email }) });
  }
  async setRole(folderId, permissionId, role) {
    return this._json(`${API}/files/${encodeURIComponent(folderId)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
  }
  async unshare(folderId, permissionId) {
    try { await this.account.request(`${API}/files/${encodeURIComponent(folderId)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`, { method: 'DELETE' }); }
    catch (error) { if (error.code !== 'missing') throw error; }
  }
}

// --------------------------------------------------------------- simulation
// One folder on disk shared by every simulated account. Access follows
// Drive's rules closely enough for the tests: owners and inherited
// permissions, only owners delete, removed people lose access at once.
class FakeDrive {
  constructor(dir, email) {
    this.dir = dir; this._email = lower(email);
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  }
  get email() { return this._email; }
  _check() {
    if (fs.existsSync(path.join(this.dir, `offline-${this._email}`)) || fs.existsSync(path.join(this.dir, 'offline-all'))) throw new GoogleError('Google Drive est injoignable : simulation de panne.', 503, 'offline');
    if (fs.existsSync(path.join(this.dir, `auth-${this._email}`))) throw new GoogleError('L’accès à Google Drive a expiré ou a été retiré. Reconnectez le compte dans Paramètres → Intégrations.', 401, 'auth');
  }
  _metaFile(id) { return path.join(this.dir, 'files', `${id}.json`); }
  _read(id) { try { return JSON.parse(fs.readFileSync(this._metaFile(id), 'utf8')); } catch { return null; } }
  _write(meta) { const file = this._metaFile(meta.id); const temp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`; fs.writeFileSync(temp, JSON.stringify(meta)); fs.renameSync(temp, file); }
  _all() { return fs.readdirSync(path.join(this.dir, 'files')).filter((name) => name.endsWith('.json')).map((name) => this._read(name.slice(0, -5))).filter(Boolean); }
  _role(meta) {
    let at = meta; let best = ''; let guard = 0;
    const rank = { reader: 1, writer: 2, owner: 3 };
    while (at && guard++ < 50) {
      if (at.owner === this._email) return 'owner';
      for (const perm of at.permissions || []) if (perm.email === this._email && (rank[perm.role] || 0) > (rank[best] || 0)) best = perm.role;
      at = at.parents && at.parents[0] ? this._read(at.parents[0]) : null;
    }
    return best;
  }
  _item(meta) {
    return { id: meta.id, name: meta.name, folder: meta.folder, parents: meta.parents || [], props: meta.props || {}, modified: meta.modified, created: meta.created, size: meta.size || 0, trashed: !!meta.trashed,
      ownedByMe: meta.owner === this._email, ownerEmail: meta.owner, ownerName: meta.owner.split('@')[0], modifierEmail: meta.modifier || meta.owner, modifierName: '' };
  }
  _need(meta, write) {
    const role = meta ? this._role(meta) : '';
    if (!meta || meta.trashed || !role) throw new GoogleError('Google Drive : File not found.', 404, 'missing');
    if (write && role === 'reader') throw new GoogleError('Google Drive : The user does not have sufficient permissions for this file.', 403, 'google');
    return role;
  }
  _new(fields) {
    const now = Date.now();
    const meta = { id: crypto.randomBytes(12).toString('hex'), owner: this._email, modifier: this._email, created: now, modified: now, permissions: [], trashed: false, ...fields };
    this._write(meta);
    return meta;
  }

  async query() { throw new Error('FakeDrive.query n’est pas pris en charge.'); }
  async get(id) { this._check(); const meta = this._read(id); if (!meta || meta.trashed || !this._role(meta)) return null; return this._item(meta); }
  async projectsRoot() {
    this._check();
    const found = this._all().find((meta) => meta.owner === this._email && meta.props && meta.props.opale === 'projects');
    if (found) return found.id;
    return this._new({ name: 'Projets partagés', folder: true, parents: [], props: { opale: 'projects' } }).id;
  }
  async createFolder(name, parent, props) {
    this._check();
    if (parent) this._need(this._read(parent), true);
    return this._item(this._new({ name, folder: true, parents: parent ? [parent] : [], props: props || {} }));
  }
  async projectFolders(projectId) {
    this._check();
    return this._all().filter((meta) => meta.folder && !meta.trashed && meta.props && meta.props.opale === 'project' && (!projectId || meta.props.opaleProject === projectId) && this._role(meta)).map((meta) => this._item(meta));
  }
  async list(projectId, since) {
    this._check();
    return this._all().filter((meta) => !meta.trashed && meta.props && meta.props.opaleProject === projectId && (!since || meta.modified > since) && this._role(meta)).map((meta) => this._item(meta));
  }
  async createJson(parent, name, props, value) {
    this._check();
    this._need(this._read(parent), true);
    const data = Buffer.from(JSON.stringify(value));
    const meta = this._new({ name, folder: false, parents: [parent], props: props || {}, size: data.length });
    fs.writeFileSync(path.join(this.dir, 'data', meta.id), data);
    return this._item(meta);
  }
  async createBinary(parent, name, props, data) {
    this._check(); this._need(this._read(parent), true);
    const meta = this._new({ name, folder: false, parents: [parent], props: props || {}, size: data.length });
    fs.writeFileSync(path.join(this.dir, 'data', meta.id), data);
    return this._item(meta);
  }
  async readBinary(id) {
    this._check(); this._need(this._read(id), false);
    return fs.readFileSync(path.join(this.dir, 'data', id));
  }
  async updateJson(id, value) {
    this._check();
    const meta = this._read(id); this._need(meta, true);
    const data = Buffer.from(JSON.stringify(value));
    fs.writeFileSync(path.join(this.dir, 'data', id), data);
    Object.assign(meta, { modified: Math.max(Date.now(), meta.modified + 1), modifier: this._email, size: data.length });
    this._write(meta);
    return this._item(meta);
  }
  async readJson(id) {
    this._check();
    this._need(this._read(id), false);
    return JSON.parse(fs.readFileSync(path.join(this.dir, 'data', id), 'utf8'));
  }
  async remove(id) {
    this._check();
    const meta = this._read(id);
    if (!meta) return;
    if (meta.owner !== this._email) throw new GoogleError('Google Drive : Only the owner can delete this file.', 403, 'google');
    fs.rmSync(this._metaFile(id), { force: true }); fs.rmSync(path.join(this.dir, 'data', id), { force: true });
  }
  async permissions(folderId) {
    this._check();
    const meta = this._read(folderId); this._need(meta, false);
    return [{ id: `owner-${meta.owner}`, email: meta.owner, role: 'owner', type: 'user' }, ...(meta.permissions || []).map((perm) => ({ ...perm, type: 'user' }))];
  }
  async share(folderId, email, role) {
    this._check();
    const meta = this._read(folderId); this._need(meta, true);
    const target = lower(email);
    meta.permissions = (meta.permissions || []).filter((perm) => perm.email !== target);
    const perm = { id: `perm-${crypto.randomBytes(6).toString('hex')}`, email: target, role };
    meta.permissions.push(perm);
    this._write(meta);
    return perm;
  }
  async setRole(folderId, permissionId, role) {
    this._check();
    const meta = this._read(folderId); this._need(meta, true);
    const perm = (meta.permissions || []).find((entry) => entry.id === permissionId);
    if (!perm) throw new GoogleError('Google Drive : Permission not found.', 404, 'missing');
    perm.role = role; this._write(meta);
    return perm;
  }
  async unshare(folderId, permissionId) {
    this._check();
    const meta = this._read(folderId); if (!meta) return;
    const perm = (meta.permissions || []).find((entry) => entry.id === permissionId);
    // Leaving: anyone may remove their own access.
    if (!(perm && perm.email === this._email)) this._need(meta, true);
    meta.permissions = (meta.permissions || []).filter((entry) => entry.id !== permissionId);
    this._write(meta);
  }
}

module.exports = { ProjectDrive, FakeDrive, DRIVE_ROLE };
