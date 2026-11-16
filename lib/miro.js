'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const appdata = require('./appdata.js');
const credentials = require('./miro-credentials.js');
const media = require('./miro-media.js');
const { convertBoard, richText, idOf } = require('./miro-convert.js');
const { VaultError, cleanRelative, CONFIG_DIR } = require('./vault.js');

const API = 'https://api.miro.com';
const PENDING_TTL = 15 * 60 * 1000;
const MAX_ITEMS = 10000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const error = (message, status = 502, code = 'miro-api') => new VaultError(message, status, code);

function boardId(value) {
  let id = String(value || '').trim();
  if (/^https?:/i.test(id)) {
    let url; try { url = new URL(id); } catch { throw error('Le lien du tableau Miro est invalide.', 400, 'miro-board'); }
    if (url.protocol !== 'https:' || !['miro.com', 'www.miro.com'].includes(url.hostname) || url.username || url.password) throw error('Collez un lien de tableau provenant de miro.com.', 400, 'miro-board');
    const match = /^\/app\/board\/([^/]+)(?:\/|$)/.exec(url.pathname);
    if (!match) throw error('Ce lien ne désigne pas un tableau Miro. Ouvrez le tableau et copiez son adresse.', 400, 'miro-board');
    try { id = decodeURIComponent(match[1]); } catch { throw error('Le lien du tableau Miro est invalide.', 400, 'miro-board'); }
  }
  if (!/^[A-Za-z0-9_-]{1,126}={0,2}$/.test(id)) throw error('Indiquez un tableau dans la liste, son lien Miro ou son identifiant.', 400, 'miro-board');
  return id;
}

class MiroAccount {
  constructor(options = {}) {
    this.fetch = options.fetch || globalThis.fetch;
    this.file = options.file || path.join(appdata.homeDir(), 'miro.json');
    this.storage = options.storage || credentials;
    this.generation = 0; this.pending = null; this.refreshing = null; this.lastError = '';
    try { this.data = this.storage.load(this.file); }
    catch (e) { this.data = {}; this.lastError = e.message; }
  }
  get configured() { return !!(this.data.clientId && this.data.clientSecret); }
  get connected() { return !!this.data.accessToken; }
  info() { return { configured: this.configured, connected: this.connected, clientId: this.data.clientId || '', userId: this.data.userId || '', teamId: this.data.teamId || '', pending: !!(this.pending && Date.now() - this.pending.at < PENDING_TTL), error: this.lastError }; }
  save() { this.storage.save(this.file, this.data); }
  setClient(body) {
    const id = String(body.clientId || '').trim(); const secret = String(body.clientSecret || '').trim();
    if (!/^\d{1,64}$/.test(id) || !secret || secret.length > 4096 || /\s/.test(secret)) throw error('Renseignez le Client ID numérique et le Client secret de votre application Miro.', 400, 'miro-client');
    const next = { clientId: id, clientSecret: secret };
    // Persist before replacing a working connection.
    this.storage.save(this.file, next); this.data = next; this.pending = null; this.generation++; this.lastError = '';
    return this.info();
  }
  beginAuth(redirectUri) {
    if (!this.configured) throw error('Enregistrez d’abord le Client ID et le Client secret dans le plugin Miro.', 409, 'miro-client');
    const state = crypto.randomBytes(32).toString('hex'); this.pending = { state, redirectUri, at: Date.now(), generation: this.generation }; this.lastError = '';
    return `https://miro.com/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: this.data.clientId, redirect_uri: redirectUri, state })}`;
  }
  async finishAuth(query) {
    const pending = this.pending;
    if (!pending || Date.now() - pending.at > PENDING_TTL) throw error('La demande de connexion Miro a expiré. Cliquez de nouveau sur « Connecter mon compte Miro ».', 400, 'miro-expired');
    const state = String(query.state || '');
    if (!/^[a-f0-9]{64}$/.test(state) || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))) throw error('Cette réponse Miro ne correspond pas à votre demande. Relancez la connexion depuis Opale.', 400, 'miro-state');
    this.pending = null;
    if (query.error) throw error('La connexion a été refusée dans Miro. Vous pouvez réessayer et autoriser l’accès en lecture aux tableaux.', 400, 'miro-denied');
    if (!query.code) throw error('Miro n’a pas transmis le code de connexion. Relancez la connexion.', 400, 'miro-code');
    const tokens = await this._token({ grant_type: 'authorization_code', code: String(query.code), redirect_uri: pending.redirectUri });
    if (pending.generation !== this.generation) throw error('La configuration Miro a changé pendant la connexion. Réessayez.', 409, 'miro-changed');
    this._storeTokens(tokens); this.generation++; this.lastError = ''; return this.info();
  }
  async _token(fields) {
    let response;
    // Miro documents these as query parameters; they are used only server-side.
    const params = new URLSearchParams({ client_id: this.data.clientId, client_secret: this.data.clientSecret, ...fields });
    try { response = await this.fetch(`${API}/v1/oauth/token?${params}`, { method: 'POST', signal: AbortSignal.timeout(30000), redirect: 'error' }); }
    catch { throw error('Miro est injoignable. Vérifiez votre connexion Internet, puis réessayez.', 503, 'miro-offline'); }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || typeof data.access_token !== 'string' || !data.access_token) {
      if (fields.grant_type === 'refresh_token' && [400, 401, 403].includes(response.status)) throw error('L’accès Miro a expiré ou a été retiré. Reconnectez votre compte depuis le plugin.', 401, 'miro-auth');
      throw error('Miro a refusé la connexion. Vérifiez le Client ID, le Client secret et l’adresse de redirection exacte dans les paramètres de votre application Miro.', 401, 'miro-auth');
    }
    if (data.scope && !String(data.scope).split(/[ ,]+/).includes('boards:read')) throw error('L’application Miro n’a pas la permission boards:read. Activez-la dans Miro, puis reconnectez le compte.', 403, 'miro-scope');
    return data;
  }
  _storeTokens(tokens) {
    if (tokens.expires_in !== undefined && (!Number.isFinite(Number(tokens.expires_in)) || Number(tokens.expires_in) < 0)) throw error('Miro a renvoyé une durée de connexion invalide. Relancez la connexion.', 502, 'miro-data');
    const next = { ...this.data, accessToken: tokens.access_token, refreshToken: tokens.refresh_token || this.data.refreshToken || '', until: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 - 60000 : 0, userId: String(tokens.user_id || this.data.userId || ''), teamId: String(tokens.team_id || this.data.teamId || ''), scope: tokens.scope || this.data.scope || '' };
    this.storage.save(this.file, next); this.data = next;
  }
  async accessToken(force = false) {
    if (!this.connected) throw error('Connectez d’abord votre compte Miro dans Paramètres → Plugins → Miro.', 401, 'miro-auth');
    if (!force && (!this.data.until || Date.now() < this.data.until)) return this.data.accessToken;
    if (!this.data.refreshToken) throw error('L’accès Miro a expiré. Reconnectez le compte dans le plugin.', 401, 'miro-auth');
    if (!this.refreshing) {
      const generation = this.generation;
      this.refreshing = this._token({ grant_type: 'refresh_token', refresh_token: this.data.refreshToken }).then((tokens) => {
        if (generation !== this.generation) throw error('La connexion Miro a changé. Réessayez.', 409, 'miro-changed');
        this._storeTokens(tokens); return this.data.accessToken;
      }).finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }
  async request(route, options = {}) {
    if (!route.startsWith('/') || route.startsWith('//')) throw error('Adresse de requête Miro invalide.', 400);
    let renewed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken(); let response;
      try { response = await this.fetch(`${API}${route}`, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000), redirect: 'error' }); }
      catch { throw error('Miro est injoignable ou ne répond pas. Vérifiez Internet puis réessayez.', 503, 'miro-offline'); }
      if (response.status === 401 && !renewed && this.data.refreshToken) { renewed = true; await this.accessToken(true); continue; }
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const delay = Number(response.headers.get('retry-after'));
        await response.arrayBuffer().catch(() => {});
        await sleep(Number.isFinite(delay) && delay > 0 ? Math.min(delay * 1000, 15000) : 500 * 2 ** attempt); continue;
      }
      if (!response.ok) {
        const messages = { 401: 'L’accès Miro a expiré ou a été retiré. Reconnectez votre compte.', 403: 'Miro refuse l’accès. Vérifiez la permission boards:read, l’équipe autorisée et votre accès au tableau.', 404: 'Ce tableau ou cet élément Miro est introuvable. Vérifiez son lien et l’équipe connectée.', 429: 'Miro limite temporairement les demandes. Attendez quelques instants puis réessayez.' };
        throw error(messages[response.status] || `Miro a renvoyé une erreur (HTTP ${response.status}). Réessayez plus tard.`, response.status < 500 ? response.status : 502, response.status === 401 ? 'miro-auth' : 'miro-api');
      }
      const text = await response.text();
      if (text.length > 40 * 1024 * 1024) throw error('La réponse Miro est trop volumineuse pour un import sûr.', 413, 'miro-limit');
      try { return text ? JSON.parse(text) : {}; } catch { throw error('Miro a renvoyé une réponse illisible. Aucun moodboard n’a été créé.', 502, 'miro-data'); }
    }
  }
  async disconnect() {
    const token = this.data.accessToken;
    const next = { clientId: this.data.clientId, clientSecret: this.data.clientSecret };
    this.storage.save(this.file, next); this.data = next; this.pending = null; this.generation++; this.lastError = '';
    if (token) {
      try { const res = await this.fetch(`${API}/v2/oauth/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: token, clientId: next.clientId, clientSecret: next.clientSecret }), signal: AbortSignal.timeout(10000), redirect: 'error' }); if (!res.ok) this.lastError = 'Déconnexion locale effectuée. Retirez aussi l’application depuis Miro si vous souhaitez révoquer son accès.'; }
      catch { this.lastError = 'Déconnexion locale effectuée. Miro étant injoignable, retirez aussi l’application depuis les paramètres Miro pour révoquer son accès.'; }
    }
    return this.info();
  }
}

class MiroService {
  constructor(account, options = {}) { this.account = account; this.download = options.download || media.download; this.running = null; this.job = null; }
  info() { return { account: this.account.info(), import: this.job }; }
  async page(route, cursor) {
    const params = new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}) });
    const result = await this.account.request(`${route}?${params}`);
    if (!result || !Array.isArray(result.data)) throw error('La liste renvoyée par Miro est invalide. Réessayez.', 502, 'miro-data');
    if (result.cursor !== undefined && result.cursor !== null && typeof result.cursor !== 'string') throw error('La pagination renvoyée par Miro est invalide. Import interrompu.', 502, 'miro-pagination');
    return { data: result.data, cursor: typeof result.cursor === 'string' ? result.cursor : '' };
  }
  async listAll(route, progress) {
    const all = []; const cursors = new Set(); let cursor = '';
    do {
      const result = await this.page(route, cursor); all.push(...result.data);
      if (all.length > MAX_ITEMS || cursors.size > 500) throw error('Ce tableau dépasse la limite de 10 000 éléments par import. Importez un tableau plus petit.', 413, 'miro-limit');
      if (progress) progress(all.length);
      cursor = result.cursor;
      if (cursor && cursors.has(cursor)) throw error('Miro a répété une page de résultats. L’import a été arrêté pour éviter un tableau incomplet.', 502, 'miro-pagination');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return all;
  }
  boards(cursor) { return this.page('/v2/boards', cursor); }
  startImport(vault, value, guard = () => true) {
    if (this.running) throw error('Un import Miro est déjà en cours. Attendez sa fin.', 409, 'miro-busy');
    if (!this.account.connected) throw error('Connectez votre compte Miro avant d’importer un tableau.', 401, 'miro-auth');
    const id = boardId(value); const generation = this.account.generation;
    const job = { id: crypto.randomUUID(), phase: 'running', message: 'Lecture du tableau Miro…', done: 0, total: 0, result: null, error: '' }; this.job = job;
    const valid = () => guard() && generation === this.account.generation;
    this.running = this.importBoard(vault, id, valid, (message, done = 0, total = 0) => Object.assign(job, { message, done, total })).then((result) => { Object.assign(job, { phase: 'done', result, message: 'Import terminé.' }); }).catch((e) => {
      Object.assign(job, { phase: 'error', error: e instanceof VaultError ? e.message : 'L’import Miro a échoué pendant l’enregistrement. Vérifiez l’espace disque et les droits du dossier, puis réessayez.', code: e.code || 'miro-import', message: 'Import interrompu.' });
    }).finally(() => { this.running = null; });
    return { jobId: job.id };
  }
  async image(board, item, format) {
    let url = item.data && item.data.imageUrl;
    if (!url) { const full = await this.account.request(`/v2/boards/${encodeURIComponent(board)}/images/${encodeURIComponent(item.id)}`); url = full.data && full.data.imageUrl; }
    let resource; try { resource = new URL(url); } catch { throw error('Miro ne fournit pas de lien téléchargeable pour cette image.', 502, 'miro-image'); }
    // Only authenticated resources belonging to this board can use the token.
    if (resource.origin !== API || !resource.pathname.startsWith(`/v2/boards/${encodeURIComponent(board)}/resources/`) && !resource.pathname.startsWith(`/v2/boards/${board}/resources/`)) throw error('L’adresse de ressource de cette image Miro est inattendue.', 502, 'miro-image');
    resource.searchParams.set('format', format); resource.searchParams.set('redirect', 'false');
    const signed = await this.account.request(resource.pathname + resource.search);
    if (!signed || typeof signed.url !== 'string') throw error('Miro n’a pas fourni le fichier de cette image.', 502, 'miro-image');
    const bytes = await this.download(signed.url); const ext = media.imageExtension(bytes);
    if (!ext) throw error('Le format de l’image n’est pas reconnu; une prévisualisation sera essayée.', 502, 'miro-image');
    return { bytes, ext };
  }
  async importBoard(vault, id, guard, progress) {
    const prefix = `/v2/boards/${encodeURIComponent(id)}`;
    const board = await this.account.request(prefix);
    if (!board || board.id !== id) throw error('La réponse ne correspond pas au tableau demandé.', 502, 'miro-data');
    const items = await this.listAll(`${prefix}/items`, (count) => progress(`${count} éléments lus…`));
    const connectors = await this.listAll(`${prefix}/connectors`, (count) => progress(`${items.length} éléments et ${count} connexions lus…`));
    if (items.length + connectors.length > MAX_ITEMS) throw error('Ce tableau dépasse la limite de 10 000 éléments par import.', 413, 'miro-limit');
    // Refuse a snapshot spanning edits instead of mixing incompatible versions.
    const after = await this.account.request(prefix);
    if (board.modifiedAt && after.modifiedAt && board.modifiedAt !== after.modifiedAt) throw error('Le tableau a changé pendant sa lecture. Attendez la fin des modifications puis réessayez.', 409, 'miro-changed');
    convertBoard(board, items, connectors); // Validate geometry/hierarchy before downloading files.
    const name = richText(board.name || 'Tableau Miro').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 70) || 'Tableau Miro';
    const safeName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `Miro ${name}` : name;
    const folder = vault.uniquePath('Imports Miro', safeName, '');
    const files = []; const assets = new Map(); const imageWarnings = [];
    const images = items.filter((item) => item.type === 'image'); let completed = 0; let bytesTotal = 0;
    const seen = new Set();
    for (const item of images) {
      if (seen.has(item.id)) continue; seen.add(item.id);
      if (!guard()) throw error('Le coffre ou le compte Miro a changé pendant l’import. Aucun fichier n’a été créé.', 409, 'miro-cancelled');
      progress(`Téléchargement des images… ${completed}/${images.length}`, completed, images.length);
      try {
        let image;
        try { image = await this.image(id, item, 'original'); }
        catch (originalError) { image = await this.image(id, item, 'preview'); imageWarnings.push({ id: item.id, type: 'image', message: 'Prévisualisation utilisée : l’image originale était indisponible ou son format non pris en charge.' }); }
        bytesTotal += image.bytes.length;
        if (bytesTotal > 200 * 1024 * 1024) throw error('Les images dépassent la limite de 200 Mo pour cet import.', 413, 'miro-limit');
        const rel = `Images/${idOf(item.id)}.${image.ext}`; files.push({ rel, bytes: image.bytes }); assets.set(item.id, `${folder}/${rel}`);
      } catch (e) { if (e.code === 'miro-limit' || e.code === 'miro-auth') throw e; imageWarnings.push({ id: item.id, type: 'image', message: e instanceof VaultError ? e.message : 'Image indisponible.' }); }
      completed++;
    }
    progress('Validation et enregistrement du moodboard…', completed, images.length);
    const converted = convertBoard(board, items, connectors, assets); const warnings = [...imageWarnings, ...converted.warnings];
    const canvasRel = `${safeName}.canvas`; const source = JSON.stringify({ version: 1, provider: 'miro', importedAt: new Date().toISOString(), board, items, connectors }, null, 2);
    const report = [`# Import Miro — ${safeName}`, '', `Source : ${converted.boardUrl}`, '', `${converted.count} éléments convertis; ${assets.size} images copiées localement.`, '', 'Le fichier .canvas suit JSON Canvas et utilise les extensions Opale pour les éléments avancés. Les images sont des fichiers du coffre. Le tableau Miro reste indépendant de cette copie.', '', 'La profondeur de superposition exacte, les polices spécifiques, les dessins libres, les commentaires et certains widgets ne sont pas tous exposés par l’API Miro. La source JSON contient les données effectivement reçues, pas une sauvegarde complète des fonctions Miro.', '', '## Observations', '', ...(warnings.length ? warnings.map((w) => `- ${w.type} (${w.id}) : ${w.message}`) : ['Aucun remplacement nécessaire parmi les éléments exposés par l’API.']), ''].join('\n');
    files.push({ rel: canvasRel, bytes: Buffer.from(converted.content) }, { rel: 'source-miro.json', bytes: Buffer.from(source) }, { rel: 'Rapport d’import.md', bytes: Buffer.from(report) });
    // Stage under the hidden vault directory and publish the entire folder in
    // one rename. Failures cannot expose half a board or overwrite older notes.
    const configDir = path.join(vault.root, CONFIG_DIR); vault._assertInside(configDir); fs.mkdirSync(configDir, { recursive: true });
    const staging = fs.mkdtempSync(path.join(configDir, 'miro-import-')); let published = false;
    try {
      for (const file of files) { const full = path.join(staging, ...cleanRelative(file.rel).split('/')); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, file.bytes, { flag: 'wx' }); }
      const check = require('../shared/board.js').parse(fs.readFileSync(path.join(staging, canvasRel), 'utf8'));
      if (check.problem) throw error('Le fichier .canvas enregistré est invalide. Import annulé.', 500, 'miro-format');
      if (!guard()) throw error('Le coffre ou le compte Miro a changé pendant l’import. Aucun fichier n’a été créé.', 409, 'miro-cancelled');
      const target = vault.abs(folder); fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(target)) throw error('Le dossier d’import a été créé par un autre programme. Réessayez pour obtenir un nom libre.', 409, 'miro-conflict');
      fs.renameSync(staging, target); published = true;
      vault.scan(); vault._changed({ upserts: files.map((file) => vault.files.get(`${folder}/${file.rel}`)).filter(Boolean) });
      return { path: `${folder}/${canvasRel}`, report: `${folder}/Rapport d’import.md`, source: `${folder}/source-miro.json`, elements: converted.count, images: assets.size, warnings };
    } finally { if (!published) { const resolved = path.resolve(staging); if (path.dirname(resolved) === path.resolve(configDir) && path.basename(resolved).startsWith('miro-import-')) fs.rmSync(resolved, { recursive: true, force: true }); } }
  }
}

module.exports = { MiroAccount, MiroService, boardId };
