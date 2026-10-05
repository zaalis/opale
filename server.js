#!/usr/bin/env node
'use strict';

// Opale — local server. Serves the interface, the vault API it talks to, and
// the MCP endpoint an assistant connects to. Listens on 127.0.0.1 only.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const appdata = require('./lib/appdata.js');
const platform = require('./lib/platform.js');
const { Vault, VaultError, cleanRelative } = require('./lib/vault.js');
const { search } = require('./lib/search.js');
const mcp = require('./lib/mcp.js');
const starter = require('./lib/starter.js');
const Meta = require('./shared/meta.js');
const Board = require('./shared/board.js');

const VERSION = require('./package.json').version;
const DEFAULT_PORT = 27184;
const STATIC_ROOTS = { '/shared/': path.join(__dirname, 'shared'), '/': path.join(__dirname, 'interface') };
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2',
};
// Vault files served inline. Anything else is sent as a download: a note
// folder can contain HTML, and it must never run with this origin's rights.
const INLINE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', ogv: 'video/ogg',
  pdf: 'application/pdf',
};
const MAX_JSON_BYTES = 40 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

function safeEqual(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new VaultError('Requête trop volumineuse.', 413, 'too-large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const body = await readBody(req, MAX_JSON_BYTES);
  if (!body.length) return {};
  try { const value = JSON.parse(body.toString('utf8')); return value && typeof value === 'object' ? value : {}; }
  catch { throw new VaultError('JSON invalide.'); }
}

function createOpale(options = {}) {
  const config = appdata.loadConfig();
  appdata.saveConfig(config);
  const uiToken = crypto.randomBytes(24).toString('hex');
  const clients = new Set();
  const agent = { client: '', connectedAt: 0, lastSeen: 0, calls: 0, lastTool: '' };
  const state = { vault: null, port: 0, activeNote: '', pendingOpen: '', hadClient: false, exitTimer: null };

  // ---------------------------------------------------------------- events
  function broadcast(type, payload) {
    const frame = `event: ${type}\ndata: ${JSON.stringify(payload === undefined ? {} : payload)}\n\n`;
    for (const res of clients) { try { res.write(frame); } catch {} }
  }
  const agentPayload = () => ({ ...agent, active: agent.lastSeen > 0 && Date.now() - agent.lastSeen < 10 * 60 * 1000 });

  // ----------------------------------------------------------------- vault
  function instanceInfo() {
    const url = `http://127.0.0.1:${state.port}`;
    return { app: 'opale', version: VERSION, pid: process.pid, port: state.port, url, mcp: `${url}/mcp`, token: config.token,
      vault: state.vault ? { name: state.vault.name, path: state.vault.root } : null, startedAt: state.startedAt };
  }
  function publishInstance() { if (state.port) { try { appdata.writeInstance(instanceInfo()); } catch {} } }

  function openVault(root) {
    const next = new Vault(root);
    if (state.vault) state.vault.close();
    state.vault = next; state.activeNote = '';
    next.on('change', (change) => broadcast('fs', change));
    if (options.watch !== false) next.watch();
    appdata.rememberVault(config, next.root);
    appdata.saveConfig(config);
    publishInstance();
    broadcast('vault', { name: next.name, path: next.root });
    return next;
  }
  function closeVault() {
    if (state.vault) state.vault.close();
    state.vault = null; state.activeNote = '';
    config.lastVault = ''; appdata.saveConfig(config);
    publishInstance();
    broadcast('vault', null);
  }
  function needVault() {
    if (!state.vault) throw new VaultError('Aucun coffre ouvert.', 409, 'no-vault');
    return state.vault;
  }

  function statePayload() {
    const vault = state.vault;
    const pendingOpen = state.pendingOpen; state.pendingOpen = '';
    return {
      version: VERSION,
      platform: process.platform,
      vault: vault ? { name: vault.name, path: vault.root } : null,
      vaults: config.vaults.map((item) => ({ ...item, exists: fs.existsSync(item.path) })),
      settings: vault ? vault.settings : null,
      workspace: vault ? vault.workspace() : null,
      bookmarks: vault ? vault.bookmarks() : [],
      snippets: vault ? vault.snippets() : '',
      agent: agentPayload(),
      defaultVaultParent: path.join(os.homedir(), 'Documents', 'Opale'),
      pendingOpen,
    };
  }

  const mcpApp = {
    version: VERSION,
    get vault() { return state.vault; },
    seen(tool) { agent.lastSeen = Date.now(); agent.calls++; agent.lastTool = tool; broadcast('agent', agentPayload()); },
    activity(info) { broadcast('activity', { ...info, at: Date.now() }); },
    activeNote() { return state.activeNote; },
    openInUi(file) { if (clients.size) { broadcast('open-note', { path: file }); return true; } state.pendingOpen = file; return false; },
  };

  // ------------------------------------------------------------- responses
  function send(res, status, body, headers = {}) {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(data);
  }
  function sendError(res, error) {
    if (res.headersSent) { try { res.end(); } catch {} return; }
    const known = error instanceof VaultError;
    const status = known ? error.status : error && error.code === 'ENOENT' ? 404 : 500;
    send(res, status, { error: known || status === 404 ? (error.message || 'Introuvable.') : `Erreur interne : ${error && error.message ? error.message : error}`, code: known ? error.code : 'internal', ...(known && error.current ? { current: error.current } : {}) });
  }

  // ---------------------------------------------------------------- static
  function serveStatic(req, res, pathname) {
    let file = null;
    for (const [prefix, root] of Object.entries(STATIC_ROOTS)) {
      if (!pathname.startsWith(prefix)) continue;
      const relative = pathname.slice(prefix.length) || 'index.html';
      const candidate = path.normalize(path.join(root, relative));
      if (candidate !== root && !candidate.startsWith(root + path.sep)) break;
      file = candidate; break;
    }
    const type = file && STATIC_TYPES[path.extname(file).toLowerCase()];
    if (!file || !type || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'Introuvable.' });
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
    // The interface authenticates with this cookie. SameSite=Strict keeps
    // other websites from riding on it; HttpOnly keeps page scripts from it.
    if (path.basename(file) === 'index.html') headers['Set-Cookie'] = `opale_ui=${uiToken}; HttpOnly; SameSite=Strict; Path=/`;
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  }

  function serveVaultFile(req, res, rel) {
    const vault = needVault();
    const clean = vault.canonical(cleanRelative(rel));
    const full = vault.abs(clean);
    const stat = fs.statSync(full);
    if (!stat.isFile()) throw new VaultError('Fichier introuvable.', 404, 'missing');
    const ext = Meta.extOf(clean);
    const type = INLINE_TYPES[ext];
    const headers = {
      'Content-Type': type || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'Last-Modified': stat.mtime.toUTCString(),
      'Content-Disposition': `${type ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(Meta.baseName(clean))}`,
    };
    // An SVG opened on its own is a document: keep its scripts from running.
    if (ext !== 'pdf') headers['Content-Security-Policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
      let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
      end = Math.min(end, stat.size - 1);
      if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(full, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    fs.createReadStream(full).pipe(res);
  }

  // ---------------------------------------------------------- folder picker
  function pickFolder() {
    const base = process.pkg ? path.dirname(process.execPath) : __dirname;
    return platform.pickFolder(base).catch((error) => { throw new VaultError(error.message, 500, 'picker'); });
  }

  // ------------------------------------------------------------ API routes
  const routes = {
    'GET /api/state': () => statePayload(),
    'GET /api/index': () => needVault().snapshot(),

    'POST /api/vault/open': async (ctx) => {
      const root = String((await ctx.json()).path || '').trim();
      if (!root || !path.isAbsolute(root)) throw new VaultError('Indiquez le chemin complet du dossier.');
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new VaultError('Ce dossier est introuvable.', 404, 'missing');
      openVault(root);
      return statePayload();
    },
    'POST /api/vault/create': async (ctx) => {
      const body = await ctx.json();
      const name = cleanRelative(String(body.name || '').trim());
      if (name.includes('/')) throw new VaultError('Le nom du coffre ne peut pas contenir de « / ».');
      const parent = String(body.parent || '').trim() || path.join(os.homedir(), 'Documents', 'Opale');
      if (!path.isAbsolute(parent)) throw new VaultError('Indiquez le chemin complet de l’emplacement.');
      const root = path.join(parent, name);
      if (fs.existsSync(root) && fs.readdirSync(root).length) throw new VaultError('Ce dossier existe déjà et n’est pas vide : ouvrez-le comme coffre.', 409, 'exists');
      fs.mkdirSync(root, { recursive: true });
      for (const [file, content] of Object.entries(starter.NOTES)) {
        const target = path.join(root, ...file.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf8');
      }
      openVault(root);
      return statePayload();
    },
    'POST /api/vault/close': () => { closeVault(); return statePayload(); },
    'POST /api/vault/forget': async (ctx) => {
      appdata.forgetVault(config, String((await ctx.json()).path || ''));
      appdata.saveConfig(config);
      return statePayload();
    },
    'POST /api/pick-folder': async () => { const folder = await pickFolder(); return folder ? { path: folder } : { cancelled: true }; },

    'GET /api/note': (ctx) => needVault().read(ctx.query.get('path') || ''),
    'PUT /api/note': async (ctx) => {
      const body = await ctx.json();
      const entry = needVault().write(String(body.path || ''), body.content, { baseMtime: body.baseMtime, createOnly: body.createOnly === true });
      return { path: entry.path, mtime: entry.mtime, size: entry.size };
    },
    // Create a note with a free name ("Sans titre", "Sans titre 1"…).
    'POST /api/note': async (ctx) => {
      const body = await ctx.json(); const vault = needVault();
      const folder = typeof body.folder === 'string' ? cleanRelative(body.folder, { allowRoot: true }) : vault.newNoteFolder(body.source);
      // `ext: 'canvas'` creates a moodboard instead of a note.
      const ext = body.ext === 'canvas' ? 'canvas' : 'md';
      const name = String(body.name || (ext === 'canvas' ? 'Moodboard' : 'Sans titre')).replace(/\.(md|canvas)$/i, '');
      const target = body.exact ? Meta.joinPath(folder, `${name}.${ext}`) : vault.uniquePath(folder, name, ext);
      const content = typeof body.content === 'string' ? body.content : ext === 'canvas' ? Board.serialize(Board.emptyDoc()) : '';
      const entry = vault.write(target, content, { createOnly: true });
      return { path: entry.path, mtime: entry.mtime };
    },
    'POST /api/folder': async (ctx) => {
      const body = await ctx.json(); const vault = needVault();
      const target = body.path ? String(body.path) : vault.uniquePath(cleanRelative(String(body.folder || ''), { allowRoot: true }), 'Nouveau dossier', '');
      return { path: vault.createFolder(target) };
    },
    'POST /api/rename': async (ctx) => { const body = await ctx.json(); return needVault().rename(String(body.from || ''), String(body.to || '')); },
    'POST /api/delete': async (ctx) => { const body = await ctx.json(); return needVault().remove(String(body.path || ''), { permanent: body.permanent === true }); },

    'GET /api/file': (ctx) => { serveVaultFile(ctx.req, ctx.res, ctx.query.get('path') || ''); return undefined; },
    // Attachment upload (paste or drop): raw bytes in the body.
    'PUT /api/file': async (ctx) => {
      const vault = needVault();
      const name = cleanRelative(String(ctx.query.get('name') || 'Fichier'));
      if (name.includes('/')) throw new VaultError('Nom de fichier invalide.');
      const requestedFolder = ctx.query.get('folder');
      const folder = requestedFolder === null || requestedFolder === ''
        ? vault.attachmentFolder(ctx.query.get('source') || '')
        : cleanRelative(requestedFolder, { allowRoot: true });
      const ext = Meta.extOf(name);
      const target = vault.uniquePath(folder, ext ? name.slice(0, -(ext.length + 1)) : name, ext);
      const entry = vault.writeBinary(target, await readBody(ctx.req, MAX_UPLOAD_BYTES));
      return { path: entry.path };
    },

    'GET /api/search': (ctx) => search(needVault(), ctx.query.get('q') || '', { limit: Number(ctx.query.get('limit')) || 100 }),
    'GET /api/backlinks': (ctx) => needVault().backlinks(ctx.query.get('path') || '', { unlinked: ctx.query.get('unlinked') === '1' }),
    'GET /api/templates': () => ({ templates: needVault().templates() }),
    'POST /api/daily': async (ctx) => {
      const body = await ctx.json();
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body.date || ''));
      return needVault().ensureDaily(match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date());
    },
    'POST /api/template': async (ctx) => {
      const body = await ctx.json(); const vault = needVault();
      return { content: vault.applyTemplate(vault.read(String(body.path || '')).content, String(body.title || '')) };
    },

    'PUT /api/settings': async (ctx) => ({ settings: needVault().saveSettings(await ctx.json()) }),
    'PUT /api/workspace': async (ctx) => { needVault().saveWorkspace(await ctx.json()); return { ok: true }; },
    'PUT /api/bookmarks': async (ctx) => { const vault = needVault(); vault.saveBookmarks((await ctx.json()).bookmarks); return { bookmarks: vault.bookmarks() }; },
    'POST /api/active': async (ctx) => { state.activeNote = String((await ctx.json()).path || ''); return { ok: true }; },

    'POST /api/reveal': async (ctx) => {
      const vault = needVault();
      const rel = String((await ctx.json()).path || '');
      const full = rel ? vault.abs(vault.canonical(cleanRelative(rel))) : vault.root;
      platform.reveal(full, !!rel);
      return { ok: true };
    },

    'GET /api/connection': () => ({ endpoint: `http://127.0.0.1:${state.port}/mcp`, token: config.token, agent: agentPayload(), tools: mcp.TOOLS.map((tool) => ({ name: tool.name, description: tool.description })) }),
    'POST /api/connection/rotate': () => {
      config.token = crypto.randomBytes(32).toString('hex');
      appdata.saveConfig(config); publishInstance();
      agent.client = ''; agent.connectedAt = 0; agent.lastSeen = 0;
      broadcast('agent', agentPayload());
      return { endpoint: `http://127.0.0.1:${state.port}/mcp`, token: config.token, agent: agentPayload() };
    },
    // Called by a connecting program (zaalis IDE) so the window can say who is there.
    'POST /api/agent/hello': async (ctx) => {
      if (!ctx.bearer) throw new VaultError('Jeton requis.', 401, 'unauthorized');
      const body = await ctx.json();
      agent.client = String(body.client || 'Assistant').slice(0, 60); agent.connectedAt = Date.now(); agent.lastSeen = Date.now();
      broadcast('agent', agentPayload());
      broadcast('activity', { tool: 'connect', client: agent.client, at: Date.now() });
      return { ok: true, vault: state.vault ? { name: state.vault.name, path: state.vault.root } : null, tools: mcp.TOOLS.map((tool) => tool.name) };
    },
    'POST /api/agent/bye': (ctx) => {
      if (!ctx.bearer) throw new VaultError('Jeton requis.', 401, 'unauthorized');
      agent.client = ''; agent.connectedAt = 0; agent.lastSeen = 0;
      broadcast('agent', agentPayload());
      return { ok: true };
    },
  };

  function serveEvents(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: hello\ndata: ${JSON.stringify({ version: VERSION })}\n\n`);
    clients.add(res); state.hadClient = true;
    clearTimeout(state.exitTimer);
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => {
      clearInterval(beat); clients.delete(res);
      // Started only to back a window: leave once that window is gone.
      if (options.exitWithUi && state.hadClient && !clients.size) {
        clearTimeout(state.exitTimer);
        state.exitTimer = setTimeout(() => { if (!clients.size) app.close().then(() => process.exit(0)); }, 8000);
      }
    });
  }

  // -------------------------------------------------------------- dispatch
  async function handle(req, res) {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return send(res, 403, { error: 'Accès local uniquement.' });
    // A page on another site can point a hostname at 127.0.0.1 (DNS
    // rebinding); only the literal loopback names are served.
    const host = String(req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${state.port}` && host !== `localhost:${state.port}`) return send(res, 403, { error: 'Hôte refusé.' });

    const url = new URL(req.url, `http://${host}`);
    const pathname = decodeURIComponent(url.pathname);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    const origin = req.headers.origin;
    const ownOrigin = !origin || origin === `http://127.0.0.1:${state.port}` || origin === `http://localhost:${state.port}`;
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const hasBearer = !!bearer && safeEqual(bearer, config.token);

    if (pathname === '/api/ping') return send(res, 200, { app: 'opale', version: VERSION });

    if (pathname === '/mcp') {
      if (!ownOrigin) return send(res, 403, { error: 'Origine refusée.' });
      if (!hasBearer) return send(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Jeton Opale invalide ou absent.' } }, { 'WWW-Authenticate': 'Bearer' });
      if (req.method === 'DELETE') return send(res, 200, {});
      if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu.' }, { Allow: 'POST, DELETE' });
      let payload;
      try { payload = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString('utf8')); }
      catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalide.' } }); }
      const session = String(req.headers['mcp-session-id'] || '') || crypto.randomUUID();
      const batch = Array.isArray(payload);
      const replies = (await Promise.all((batch ? payload : [payload]).map((message) => mcp.handleMessage(message, mcpApp)))).filter(Boolean);
      // Notifications have no JSON-RPC reply; an empty object keeps clients
      // that always parse the body working.
      if (!replies.length) return send(res, 202, {}, { 'Mcp-Session-Id': session });
      return send(res, 200, batch ? replies : replies[0], { 'Mcp-Session-Id': session });
    }

    if (pathname.startsWith('/api/')) {
      const cookie = /(?:^|;\s*)opale_ui=([a-f0-9]+)/.exec(String(req.headers.cookie || ''));
      const hasCookie = !!cookie && safeEqual(cookie[1], uiToken);
      if (!hasBearer && !hasCookie) return send(res, 401, { error: 'Authentification requise.', code: 'unauthorized' });
      if (!ownOrigin) return send(res, 403, { error: 'Origine refusée.' });
      // Cookie-authenticated writes must carry a header no plain form or
      // cross-site request can set.
      if (!hasBearer && req.method !== 'GET' && req.headers['x-opale'] !== '1') return send(res, 403, { error: 'En-tête X-Opale requis.' });
      if (pathname === '/api/events' && req.method === 'GET') return serveEvents(req, res);
      const route = routes[`${req.method} ${pathname}`];
      if (!route) return send(res, 404, { error: 'Route inconnue.' });
      let parsed = null;
      const result = await route({ req, res, query: url.searchParams, bearer: hasBearer, json: async () => (parsed || (parsed = await readJson(req))) });
      if (result !== undefined && !res.headersSent) send(res, 200, result);
      return undefined;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Méthode refusée.' });
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https: http:",
      "media-src 'self' blob: https:", "font-src 'self' data:", "connect-src 'self'", "frame-src 'self' https:", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
    ].join('; '));
    return serveStatic(req, res, pathname);
  }

  const server = http.createServer((req, res) => { handle(req, res).catch((error) => sendError(res, error)); });

  function listenOn(port, attempts) {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener('listening', onListening);
        if (error.code === 'EADDRINUSE' && attempts > 0) resolve(listenOn(port + 1, attempts - 1)); else reject(error);
      };
      const onListening = () => { server.removeListener('error', onError); resolve(server.address().port); };
      server.once('error', onError); server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
  }

  const app = {
    config, state,
    get port() { return state.port; },
    get token() { return config.token; },
    get uiToken() { return uiToken; },
    get vault() { return state.vault; },
    openVault, closeVault,
    async listen() {
      const wanted = options.port !== undefined ? Number(options.port) : Number(process.env.OPALE_PORT) || DEFAULT_PORT;
      state.port = await listenOn(wanted, wanted === 0 ? 0 : 20);
      state.startedAt = Date.now();
      const initial = options.vaultPath || config.lastVault;
      if (initial && fs.existsSync(initial)) { try { openVault(initial); } catch {} }
      publishInstance();
      return state.port;
    },
    close() {
      return new Promise((resolve) => {
        clearTimeout(state.exitTimer);
        for (const res of clients) { try { res.end(); } catch {} }
        clients.clear();
        if (state.vault) { state.vault.close(); state.vault = null; }
        appdata.clearInstance();
        server.close(() => resolve());
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      });
    },
  };
  return app;
}

// ------------------------------------------------------------------ launch
function ping(port, timeout = 900) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(body).app === 'opale'); } catch { resolve(false); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function runningInstance() {
  const info = appdata.readJson(appdata.files().instance, null);
  if (!info || info.pid === process.pid || !appdata.pidAlive(info.pid)) return null;
  return (await ping(info.port)) ? info : null;
}

// How another program can start Opale again. Prefers the desktop shell.
function launchCommand() {
  const base = process.pkg ? path.dirname(process.execPath) : __dirname;
  const shell = process.env.OPALE_SHELL_EXE || platform.findShell(base);
  if (shell && fs.existsSync(shell)) return { file: shell, args: [], cwd: path.dirname(shell) };
  if (process.pkg) return { file: process.execPath, args: ['--window'], cwd: base };
  return { file: process.execPath, args: [path.join(__dirname, 'server.js'), '--window'], cwd: __dirname };
}

// The desktop shell, when it has been built and did not start this process.
function shellExe() {
  if (process.env.OPALE_SHELL_EXE) return null;
  const base = process.pkg ? path.dirname(process.execPath) : __dirname;
  return platform.findShell(base);
}

function openWindow(url) {
  const shell = shellExe();
  if (shell) { try { spawn(shell, [], { cwd: path.dirname(shell), detached: true, stdio: 'ignore' }).unref(); return; } catch {} }
  try { platform.openUrl(url, appdata.homeDir()); } catch {}
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
  const wantsWindow = flag('--window');

  const existing = await runningInstance();
  if (existing) {
    process.stdout.write(`Opale est déjà lancé : ${existing.url}\n`);
    if (wantsWindow) openWindow(existing.url);
    return;
  }
  // With the desktop shell available, let it own the server: closing its
  // window then stops everything, exactly as when it is started directly.
  if (wantsWindow && shellExe()) { openWindow(''); return; }
  const app = createOpale({ port: value('--port'), vaultPath: value('--vault'), exitWithUi: wantsWindow && !process.env.OPALE_SHELL_EXE });
  const port = await app.listen();
  appdata.writeInstall({ app: 'opale', version: VERSION, launch: launchCommand(), updatedAt: Date.now() });
  const url = `http://127.0.0.1:${port}`;
  process.stdout.write(`Opale ${VERSION} — ${url}\n`);
  if (wantsWindow) openWindow(url);

  const stop = () => { app.close().finally(() => process.exit(0)); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('SIGHUP', stop);
  const parent = Number(process.env.OPALE_PARENT_PID);
  if (parent > 0) setInterval(() => { if (!appdata.pidAlive(parent)) stop(); }, 2000).unref();
  process.on('exit', () => appdata.clearInstance());
}

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`Opale n'a pas pu démarrer : ${error.message || error}\n`); process.exit(1); });
}

module.exports = { createOpale, runningInstance, VERSION, DEFAULT_PORT };
