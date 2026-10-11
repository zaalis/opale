'use strict';

// Google account and Google Drive access, for synchronising vaults.
//
// Sign-in uses the flow Google prescribes for desktop applications: the
// system browser shows Google's page, then Google sends the browser back to
// this server on 127.0.0.1 with a one-time code (PKCE protects the exchange).
// Only the `drive.file` scope is requested: Opale sees the files it created,
// nothing else in the user's Drive.
const crypto = require('crypto');
const appdata = require('./appdata.js');
const { VaultError } = require('./vault.js');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'];
const FOLDER_TYPE = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,mimeType,parents,md5Checksum,size,createdTime,modifiedTime,appProperties,trashed';
const SIMPLE_UPLOAD_LIMIT = 5 * 1024 * 1024;
const PENDING_TTL = 15 * 60 * 1000;

// The application's own Google client, filled in once by the developer in
// google-client.json and shipped inside the executable. Users never see it.
// For an installed application Google does not treat the secret as secret.
function builtinClient() {
  try { const client = require('./google-client.json'); return client && /\.apps\.googleusercontent\.com$/.test(client.clientId || '') ? { clientId: client.clientId, clientSecret: client.clientSecret || '' } : null; }
  catch { return null; }
}

class GoogleError extends VaultError {
  constructor(message, status = 502, code = 'google') { super(message, status, code); }
}

const base64url = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const vaultNameKey = (name) => String(name || '').normalize('NFC').toLowerCase();

// The client file Google Cloud Console lets you download ("installed" for a
// desktop client, "web" otherwise), or the two values typed by hand.
function parseClient(input) {
  let value = input;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw new GoogleError('Ce fichier n’est pas un JSON de client OAuth Google.', 400, 'invalid'); } }
  const block = value && (value.installed || value.web || value);
  const clientId = String((block && (block.client_id || block.clientId)) || '').trim();
  const clientSecret = String((block && (block.client_secret || block.clientSecret)) || '').trim();
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) throw new GoogleError('Identifiant client invalide : il se termine par « .apps.googleusercontent.com ».', 400, 'invalid');
  return { clientId, clientSecret };
}

// ----------------------------------------------------------------- account
class GoogleAccount {
  constructor(options = {}) {
    this.fetch = options.fetch || ((...args) => globalThis.fetch(...args));
    this.file = options.file || appdata.files().google;
    this.data = appdata.readJson(this.file, {}) || {};
    // A client set by hand (advanced) wins over the one built into the app.
    this.builtin = options.builtin === undefined ? builtinClient() : options.builtin;
    if (!this.data.clientId && process.env.OPALE_GOOGLE_CLIENT_ID) {
      this.data.clientId = process.env.OPALE_GOOGLE_CLIENT_ID;
      this.data.clientSecret = process.env.OPALE_GOOGLE_CLIENT_SECRET || '';
    }
    if (!this.data.clientId && this.builtin) { this.data.clientId = this.builtin.clientId; this.data.clientSecret = this.builtin.clientSecret; this.usingBuiltin = true; }
    this.pending = null;
    this.access = null;
    this.refreshing = null;
  }

  save() {
    // The built-in client is never written to disk: updating the app updates it.
    const data = { ...this.data };
    if (this.usingBuiltin) { delete data.clientId; delete data.clientSecret; }
    appdata.writeJson(this.file, data);
  }
  get configured() { return !!this.data.clientId; }
  get connected() { return !!this.data.refreshToken; }
  get email() { return this.data.email || ''; }

  info() {
    return { configured: this.configured, connected: this.connected, email: this.email, connectedAt: this.data.connectedAt || 0,
      clientId: this.data.clientId || '', builtin: !!this.usingBuiltin, pending: !!(this.pending && Date.now() - this.pending.at < PENDING_TTL), error: this.lastError || '' };
  }

  setClient(input) {
    const { clientId, clientSecret } = parseClient(input);
    this.usingBuiltin = false;
    // Tokens belong to the client that issued them.
    if (clientId !== this.data.clientId) { delete this.data.refreshToken; delete this.data.email; this.access = null; }
    this.data.clientId = clientId; this.data.clientSecret = clientSecret;
    this.save();
  }

  beginAuth(redirectUri) {
    if (!this.configured) throw new GoogleError('Renseignez d’abord l’identifiant client Google.', 409, 'no-client');
    const verifier = base64url(crypto.randomBytes(48));
    const state = base64url(crypto.randomBytes(24));
    this.pending = { state, verifier, redirectUri, at: Date.now() };
    this.lastError = '';
    const params = new URLSearchParams({
      client_id: this.data.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
      code_challenge: base64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      access_type: 'offline', prompt: 'consent', state,
    });
    return `${AUTH_URL}?${params}`;
  }

  // The browser came back from Google with `code` and `state`.
  async finishAuth(query) {
    const pending = this.pending;
    if (!pending || Date.now() - pending.at > PENDING_TTL) throw new GoogleError('Cette demande de connexion a expiré. Recommencez depuis Opale.', 400, 'expired');
    if (!query.state || query.state !== pending.state) throw new GoogleError('Réponse de Google inattendue (état différent).', 400, 'state');
    if (query.error) { this.pending = null; throw new GoogleError(query.error === 'access_denied' ? 'Connexion refusée dans Google.' : `Google a refusé la connexion : ${query.error}`, 400, 'denied'); }
    this.pending = null;
    const tokens = await this._token({ grant_type: 'authorization_code', code: String(query.code || ''), redirect_uri: pending.redirectUri, code_verifier: pending.verifier });
    if (!tokens.refresh_token) throw new GoogleError('Google n’a pas fourni de jeton durable. Retirez l’accès d’Opale dans votre compte Google puis reconnectez-vous.', 502, 'no-refresh');
    this.data.refreshToken = tokens.refresh_token;
    this.data.email = emailOf(tokens.id_token) || '';
    this.data.connectedAt = Date.now();
    this.access = { token: tokens.access_token, until: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 - 60000 };
    this.save();
    return this.info();
  }

  async disconnect() {
    const token = this.data.refreshToken;
    delete this.data.refreshToken; delete this.data.email; delete this.data.connectedAt;
    this.access = null;
    this.save();
    if (token) { try { await this.fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' }); } catch {} }
  }

  async _token(fields) {
    const body = new URLSearchParams({ client_id: this.data.clientId, ...(this.data.clientSecret ? { client_secret: this.data.clientSecret } : {}), ...fields });
    let response;
    try { response = await this.fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }); }
    catch (error) { throw new GoogleError(`Google est injoignable : ${error.message}`, 503, 'offline'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.error === 'invalid_grant') {
        // Revoked, expired (7 days while the consent screen is in "Testing"), or password changed.
        delete this.data.refreshToken; this.access = null; this.save();
        throw new GoogleError('L’accès à Google Drive a expiré ou a été retiré. Reconnectez le compte dans Paramètres → Intégrations.', 401, 'auth');
      }
      throw new GoogleError(`Google a refusé la demande : ${data.error_description || data.error || response.status}`, 502, 'google');
    }
    return data;
  }

  async accessToken(force) {
    if (!this.connected) throw new GoogleError('Aucun compte Google connecté.', 401, 'auth');
    if (!force && this.access && Date.now() < this.access.until) return this.access.token;
    if (!this.refreshing) {
      this.refreshing = this._token({ grant_type: 'refresh_token', refresh_token: this.data.refreshToken })
        .then((tokens) => { this.access = { token: tokens.access_token, until: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 - 60000 }; return this.access.token; })
        .finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  // An authenticated call, retried on expiry, rate limits and server errors.
  async request(url, options = {}) {
    let attempt = 0; let renewed = false;
    for (;;) {
      const token = await this.accessToken();
      let response;
      try { response = await this.fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } }); }
      catch (error) {
        if (++attempt > 3) throw new GoogleError(`Google Drive est injoignable : ${error.message}`, 503, 'offline');
        await sleep(500 * 2 ** attempt); continue;
      }
      if (response.status === 401 && !renewed) { renewed = true; this.access = null; continue; }
      const retry = response.status === 429 || response.status >= 500 || (response.status === 403 && await isRateLimit(response.clone()));
      if (retry && ++attempt <= 4) { await sleep(Math.min(16000, 700 * 2 ** attempt) + Math.random() * 400); continue; }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = (data.error && (data.error.message || data.error)) || `HTTP ${response.status}`;
        throw new GoogleError(`Google Drive : ${message}`, response.status === 404 ? 404 : 502, response.status === 404 ? 'missing' : 'google');
      }
      return response;
    }
  }
}

async function isRateLimit(response) {
  const data = await response.json().catch(() => ({}));
  const reasons = ((data.error && data.error.errors) || []).map((item) => item.reason);
  return reasons.some((reason) => /rateLimitExceeded|userRateLimitExceeded/.test(reason));
}

function emailOf(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64').toString('utf8')).email || ''; } catch { return ''; }
}

// ------------------------------------------------------------------- drive
// Opale's folder layout in Drive:
//   Opale/                    appProperties { opale: 'root' }
//     <vault name>/           appProperties { opale: 'vault', opaleVault: <id> }
//       … the vault's folders and files, each tagged { opaleVault: <id> }
// Tags let one query list a whole vault, whatever its depth.
class DriveClient {
  constructor(account) { this.account = account; }

  async _json(url, options) { return (await this.account.request(url, options)).json(); }

  async _query(q) {
    const out = []; let pageToken = '';
    do {
      const params = new URLSearchParams({ q, fields: `nextPageToken,files(${FILE_FIELDS})`, pageSize: '1000', spaces: 'drive' });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this._json(`${API}/files?${params}`);
      out.push(...(page.files || []));
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  static item(file) {
    const props = file.appProperties || {};
    return { id: file.id, name: file.name, parents: file.parents || [], folder: file.mimeType === FOLDER_TYPE,
      md5: file.md5Checksum || '', size: Number(file.size) || 0, modified: Date.parse(file.modifiedTime) || 0, device: props.opaleDevice || '' };
  }

  async list(vaultId) {
    return (await this._query(`appProperties has { key='opaleVault' and value='${vaultId}' } and trashed=false`)).map(DriveClient.item);
  }

  async vaults() {
    const found = await this._query("appProperties has { key='opale' and value='vault' } and trashed=false");
    return found.map((file) => ({ vaultId: (file.appProperties || {}).opaleVault, folderId: file.id, name: file.name,
      created: Date.parse(file.createdTime) || Number.MAX_SAFE_INTEGER, modified: Date.parse(file.modifiedTime) || 0 }))
      .filter((item) => item.vaultId).sort((a, b) => a.name.localeCompare(b.name) || a.created - b.created);
  }

  async folder(id) {
    try { const file = await this._json(`${API}/files/${encodeURIComponent(id)}?fields=${FILE_FIELDS}`); return file.trashed ? null : DriveClient.item(file); }
    catch (error) { if (error.code === 'missing') return null; throw error; }
  }

  async _root() {
    const found = await this._query("appProperties has { key='opale' and value='root' } and trashed=false");
    if (found.length) return found[0].id;
    return (await this._create({ name: 'Opale', mimeType: FOLDER_TYPE, appProperties: { opale: 'root' } })).id;
  }

  async createVault(name) {
    // Re-linking a local vault should reuse its existing Drive folder. Prefer
    // the oldest same-named folder if earlier versions already made duplicates.
    const existing = (await this.vaults()).find((item) => vaultNameKey(item.name) === vaultNameKey(name));
    if (existing) return existing;
    const root = await this._root();
    const vaultId = crypto.randomUUID();
    const folder = await this._create({ name, mimeType: FOLDER_TYPE, parents: [root], appProperties: { opale: 'vault', opaleVault: vaultId } });
    return { vaultId, folderId: folder.id, name };
  }

  async _create(meta) {
    return this._json(`${API}/files?fields=${FILE_FIELDS}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) });
  }

  async createFolder(name, parentId, vaultId) {
    return DriveClient.item(await this._create({ name, mimeType: FOLDER_TYPE, parents: [parentId], appProperties: { opaleVault: vaultId } }));
  }

  // New file when `id` is absent, new content for an existing file otherwise.
  async upload({ id, name, parentId, vaultId, device, data }) {
    // Keep the vault tag on PATCH: list() relies on it to find this file next
    // time, otherwise a later edit may look like a new file and POST a copy.
    const meta = id ? { appProperties: { ...(vaultId ? { opaleVault: vaultId } : {}), opaleDevice: device } } : { name, parents: [parentId], appProperties: { opaleVault: vaultId, opaleDevice: device } };
    const target = id ? `${UPLOAD}/files/${encodeURIComponent(id)}` : `${UPLOAD}/files`;
    const method = id ? 'PATCH' : 'POST';
    if (data.length <= SIMPLE_UPLOAD_LIMIT) {
      const boundary = `opale${crypto.randomBytes(12).toString('hex')}`;
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
        data, Buffer.from(`\r\n--${boundary}--`)]);
      return DriveClient.item(await this._json(`${target}?uploadType=multipart&fields=${FILE_FIELDS}`, { method, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }));
    }
    const session = await this.account.request(`${target}?uploadType=resumable&fields=${FILE_FIELDS}`, {
      method, headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(data.length) }, body: JSON.stringify(meta) });
    const location = session.headers.get('location');
    if (!location) throw new GoogleError('Google Drive n’a pas ouvert de session d’envoi.');
    return DriveClient.item(await this._json(location, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: data }));
  }

  async download(id) {
    const response = await this.account.request(`${API}/files/${encodeURIComponent(id)}?alt=media`);
    return Buffer.from(await response.arrayBuffer());
  }

  async move(id, { name, addParent, removeParent }) {
    const params = new URLSearchParams({ fields: FILE_FIELDS });
    if (addParent && addParent !== removeParent) { params.set('addParents', addParent); params.set('removeParents', removeParent); }
    return DriveClient.item(await this._json(`${API}/files/${encodeURIComponent(id)}?${params}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(name ? { name } : {}) }));
  }

  // Drive's bin keeps it for 30 days.
  async trash(id) {
    await this._json(`${API}/files/${encodeURIComponent(id)}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  }
}

module.exports = { builtinClient, GoogleAccount, DriveClient, GoogleError, parseClient, SCOPES };
