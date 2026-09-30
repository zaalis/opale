'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-test-'));
process.env.OPALE_HOME = path.join(temp, 'home');
const vaultRoot = path.join(temp, 'Coffre');
fs.mkdirSync(path.join(vaultRoot, 'Projets'), { recursive: true });
fs.mkdirSync(path.join(vaultRoot, '.git'), { recursive: true });
fs.writeFileSync(path.join(vaultRoot, '.git', 'config'), 'secret');
fs.writeFileSync(path.join(vaultRoot, 'Accueil.md'), '# Accueil\nVoir [[Idée]] et [[Projets/Plan|le plan]]. #départ\n');
fs.writeFileSync(path.join(vaultRoot, 'Idée.md'), '---\ntags: [idée]\n---\nUne idée liée à [[Accueil]].\nAccueil est aussi cité sans lien : Plan.\n');
fs.writeFileSync(path.join(vaultRoot, 'Projets', 'Plan.md'), '# Plan\n- [ ] étape\n[md](../Idée.md)\n');

const { createOpale } = require('../server.js');
const appdata = require('../lib/appdata.js');
const { Vault, VaultError } = require('../lib/vault.js');
const { search } = require('../lib/search.js');

test('application data locations follow each desktop convention', () => {
  const saved = process.env.OPALE_HOME;
  delete process.env.OPALE_HOME;
  try {
    assert.equal(appdata.homeDir('darwin'), path.join(os.homedir(), 'Library', 'Application Support', 'Opale'));
    assert.equal(appdata.homeDir('linux'), path.join(os.homedir(), '.config', 'Opale'));
  } finally { process.env.OPALE_HOME = saved; }
});

let app; let base;
const api = (route, options = {}) => fetch(base + route, { ...options, headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
let rpcId = 0;
async function rpc(method, params, token = app.token) {
  const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  return { status: response.status, body: await response.json().catch(() => null), session: response.headers.get('mcp-session-id') };
}
async function call(name, args = {}) {
  const { body } = await rpc('tools/call', { name, arguments: args });
  return { text: body.result.content[0].text, isError: !!body.result.isError };
}

test.before(async () => {
  app = createOpale({ port: 0, vaultPath: vaultRoot, watch: false });
  base = `http://127.0.0.1:${await app.listen()}`;
});
test.after(async () => { await app.close(); fs.rmSync(temp, { recursive: true, force: true }); });

test('instance file advertises the running server', () => {
  const info = appdata.readJson(appdata.files().instance, null);
  assert.equal(info.app, 'opale');
  assert.equal(info.port, app.port);
  assert.equal(info.token, app.token);
  assert.equal(info.mcp, `${base}/mcp`);
  assert.equal(info.vault.name, 'Coffre');
});

test('API refuses callers without the cookie or the token', async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  assert.equal((await fetch(`${base}/api/state`, { headers: { Authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await api('/api/state', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(`${base}/api/ping`)).status, 200);
});

test('cookie session needs the X-Opale header for writes', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  const cookie = home.headers.get('set-cookie').split(';')[0];
  assert.match(home.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await fetch(`${base}/api/state`, { headers: { cookie } })).status, 200);
  const body = JSON.stringify({ path: 'x.md', content: 'x' });
  assert.equal((await fetch(`${base}/api/note`, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body })).status, 403);
  assert.equal((await fetch(`${base}/api/note`, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json', 'X-Opale': '1' }, body })).status, 200);
  assert.equal((await api('/api/delete', { method: 'POST', body: JSON.stringify({ path: 'x.md', permanent: true }) })).status, 200);
});

test('index exposes notes with their metadata and hides dot folders', async () => {
  const index = await (await api('/api/index')).json();
  assert.deepEqual(index.files.map((file) => file.path).sort(), ['Accueil.md', 'Idée.md', 'Projets/Plan.md']);
  assert.deepEqual(index.folders, ['Projets']);
  const home = index.files.find((file) => file.path === 'Accueil.md');
  assert.deepEqual(home.meta.tags, ['départ']);
  assert.equal(home.meta.links.length, 2);
});

test('paths cannot leave the vault or reach hidden folders', async () => {
  for (const bad of ['../dehors.md', '..\\dehors.md', 'C:/Windows/win.ini', '/etc/passwd', '.git/config', 'Projets/../../x.md', 'a/.opale/app.json']) {
    const response = await api(`/api/note?path=${encodeURIComponent(bad)}`);
    assert.ok([400, 403].includes(response.status), `${bad} -> ${response.status}`);
    const write = await api('/api/note', { method: 'PUT', body: JSON.stringify({ path: bad, content: 'x' }) });
    assert.ok([400, 403].includes(write.status), `write ${bad} -> ${write.status}`);
  }
  assert.ok(!fs.existsSync(path.join(temp, 'dehors.md')));
  assert.equal((await call('read_note', { path: '.git/config' })).isError, true);
  assert.equal((await call('write_note', { path: '../evade', content: 'x' })).isError, true);
});

test('write detects an edit made elsewhere', async () => {
  const note = await (await api('/api/note?path=Accueil.md')).json();
  const stale = await api('/api/note', { method: 'PUT', body: JSON.stringify({ path: 'Accueil.md', content: 'perdu', baseMtime: note.mtime - 5000 }) });
  assert.equal(stale.status, 409);
  const body = await stale.json();
  assert.equal(body.code, 'conflict');
  assert.equal(body.current.content, note.content);
  assert.equal((await api('/api/note', { method: 'PUT', body: JSON.stringify({ path: 'Accueil.md', content: note.content, baseMtime: note.mtime }) })).status, 200);
});

test('backlinks: linked and unlinked mentions', async () => {
  const result = await (await api('/api/backlinks?path=Accueil.md&unlinked=1')).json();
  assert.deepEqual(result.linked.map((group) => group.path), ['Idée.md']);
  assert.equal(result.linked[0].items[0].line, 3);
  assert.deepEqual(result.unlinked.map((group) => [group.path, group.items[0].line]), [['Idée.md', 4]]);
});

test('search: words, phrase, negation, tag, path, regex', () => {
  const vault = app.vault;
  const paths = (query) => search(vault, query).results.map((result) => result.path).sort();
  assert.deepEqual(paths('idée'), ['Accueil.md', 'Idée.md', 'Projets/Plan.md']);
  assert.deepEqual(paths('"idée liée"'), ['Idée.md']);
  assert.deepEqual(paths('idée -liée'), ['Accueil.md', 'Projets/Plan.md']);
  assert.deepEqual(paths('tag:#idée'), ['Idée.md']);
  assert.deepEqual(paths('path:Projets'), ['Projets/Plan.md']);
  assert.deepEqual(paths('file:plan OR tag:départ'), ['Accueil.md', 'Projets/Plan.md']);
  assert.deepEqual(paths('/\\[ \\] \\S+/'), ['Projets/Plan.md']);
  const hit = search(vault, 'étape').results[0];
  assert.deepEqual([hit.matches[0].line, hit.matches[0].ranges], [1, [[6, 11]]]);
});

test('MCP: handshake, notifications and tool list', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.serverInfo.name, 'opale');
  assert.ok(init.session);
  const notified = await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) });
  assert.equal(notified.status, 202);
  assert.deepEqual(await notified.json(), {}, 'the body must stay parseable for clients that always read JSON');
  const list = await rpc('tools/list', {});
  const names = list.body.result.tools.map((tool) => tool.name);
  for (const name of ['vault_info', 'list_files', 'read_note', 'write_note', 'append_to_note', 'edit_note', 'set_properties', 'create_folder', 'move', 'move_many', 'delete', 'search', 'get_backlinks', 'get_links', 'list_tags', 'find_by_tag', 'daily_note', 'open_note', 'get_active_note']) assert.ok(names.includes(name), name);
  assert.equal((await rpc('nope', {})).body.error.code, -32601);
});

test('MCP: an assistant can read, write, edit and reorganise the vault', async () => {
  assert.match((await call('read_note', { path: 'idée' })).text, /^Chemin : Idée\.md · \d+ mots · étiquettes : #idée\n\n---\ntags: \[idée\]/);
  assert.match((await call('list_files', {})).text, /Projets\/\nAccueil\.md\nIdée\.md/);

  assert.equal((await call('write_note', { path: 'Boîte/Nouvelle', content: '# Nouvelle\nLien vers [[Idée]].' })).text, 'Note créée : Boîte/Nouvelle.md');
  assert.equal(fs.readFileSync(path.join(vaultRoot, 'Boîte', 'Nouvelle.md'), 'utf8'), '# Nouvelle\nLien vers [[Idée]].');
  assert.equal((await call('write_note', { path: 'Boîte/Nouvelle', content: 'x', overwrite: false })).isError, true);

  await call('append_to_note', { path: 'Boîte/Nouvelle', content: '- ajout', heading: 'Nouvelle' });
  await call('append_to_note', { path: 'Boîte/Nouvelle', content: 'fin' });
  assert.equal(fs.readFileSync(path.join(vaultRoot, 'Boîte', 'Nouvelle.md'), 'utf8'), '# Nouvelle\nLien vers [[Idée]].\n- ajout\nfin\n');

  assert.equal((await call('edit_note', { path: 'Boîte/Nouvelle.md', find: 'absent', replace: 'x' })).isError, true);
  assert.equal((await call('edit_note', { path: 'Boîte/Nouvelle.md', find: '- ajout', replace: '- ajout $& modifié' })).text, '1 remplacement(s) dans Boîte/Nouvelle.md');
  assert.match(fs.readFileSync(path.join(vaultRoot, 'Boîte', 'Nouvelle.md'), 'utf8'), /- ajout \$& modifié/);

  await call('set_properties', { path: 'Boîte/Nouvelle', properties: { tags: ['tri', 'ia'], statut: 'brouillon' } });
  assert.match(fs.readFileSync(path.join(vaultRoot, 'Boîte', 'Nouvelle.md'), 'utf8'), /^---\ntags:\n {2}- tri\n {2}- ia\nstatut: brouillon\n---\n# Nouvelle/);
  assert.match((await call('find_by_tag', { tag: 'tri' })).text, /Boîte\/Nouvelle\.md/);

  // Renaming rewrites every link that pointed at the note, in both styles.
  const moved = await call('move', { from: 'Idée', to: 'Projets/Grande idée' });
  assert.match(moved.text, /^Déplacé : Idée\.md → Projets\/Grande idée\.md \(3 lien\(s\) mis à jour dans 3 note\(s\)\)$/);
  assert.match(fs.readFileSync(path.join(vaultRoot, 'Accueil.md'), 'utf8'), /Voir \[\[Grande idée\]\] et \[\[Projets\/Plan\|le plan\]\]/);
  assert.match(fs.readFileSync(path.join(vaultRoot, 'Projets', 'Plan.md'), 'utf8'), /\[md\]\(Grande%20idée\.md\)/);
  assert.match(fs.readFileSync(path.join(vaultRoot, 'Boîte', 'Nouvelle.md'), 'utf8'), /\[\[Grande idée\]\]/);
  assert.match((await call('get_backlinks', { path: 'Grande idée' })).text, /Rétroliens vers Projets\/Grande idée\.md : 3 note\(s\)/);

  // Moving a folder leaves alone the links that still reach the same note…
  const many = await call('move_many', { moves: [{ from: 'Projets', to: 'Archives/Projets' }, { from: 'Inconnu', to: 'x' }] });
  assert.match(many.text, /^1\/2 déplacement\(s\) effectué\(s\)\nOK {2}Projets → Archives\/Projets/);
  assert.match(many.text, /ÉCHEC {2}Inconnu → x/);
  assert.ok(fs.existsSync(path.join(vaultRoot, 'Archives', 'Projets', 'Plan.md')));
  assert.match(fs.readFileSync(path.join(vaultRoot, 'Accueil.md'), 'utf8'), /\[\[Grande idée\]\] et \[\[Projets\/Plan\|le plan\]\]/);
  assert.equal(app.vault.resolveLink('Projets/Plan', 'Accueil.md'), 'Archives/Projets/Plan.md');
  // …and rewrites the ones a rename would have broken.
  assert.match((await call('move', { from: 'Archives/Projets', to: 'Archives/Chantiers' })).text, /\(1 lien\(s\) mis à jour dans 1 note\(s\)\)$/);
  assert.match(fs.readFileSync(path.join(vaultRoot, 'Accueil.md'), 'utf8'), /\[\[Grande idée\]\] et \[\[Plan\|le plan\]\]/);
  await call('move', { from: 'Archives/Chantiers', to: 'Archives/Projets' });

  const removed = await call('delete', { path: 'Boîte/Nouvelle' });
  assert.equal(removed.text, 'Mis à la corbeille : Boîte/Nouvelle.md');
  assert.ok(fs.existsSync(path.join(vaultRoot, '.trash', 'Boîte', 'Nouvelle.md')));
  assert.equal((await call('read_note', { path: 'Boîte/Nouvelle' })).isError, true);

  const info = JSON.parse((await call('vault_info')).text);
  assert.equal(info.notes, 3);
  assert.deepEqual(info.mostLinked[0], { path: 'Archives/Projets/Grande idée.md', backlinks: 2 });
});

test('MCP: daily note, active note and open request', async () => {
  const daily = await call('daily_note', { date: '2026-09-30', append: '- relevé' });
  assert.match(daily.text, /^Note quotidienne : Journal\/2026-09-30\.md \(créée\)\n\n- relevé\n$/);
  assert.match((await call('get_active_note')).text, /Aucune note/);
  await api('/api/active', { method: 'POST', body: JSON.stringify({ path: 'Accueil.md' }) });
  assert.match((await call('get_active_note')).text, /^Note active : Accueil\.md\n\n# Accueil/);
  assert.match((await call('open_note', { path: 'Accueil' })).text, /s’ouvrira au prochain lancement/);
  assert.equal((await (await api('/api/state')).json()).pendingOpen, 'Accueil.md');
});

test('vault files: inline types only, sandboxed, no traversal', async () => {
  fs.writeFileSync(path.join(vaultRoot, 'page.html'), '<script>1</script>');
  fs.writeFileSync(path.join(vaultRoot, 'dessin.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  app.vault.scan();
  const html = await api('/api/file?path=page.html');
  assert.equal(html.headers.get('content-type'), 'application/octet-stream');
  assert.match(html.headers.get('content-disposition'), /^attachment/);
  const svg = await api('/api/file?path=dessin.svg');
  assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
  assert.match(svg.headers.get('content-security-policy'), /^sandbox/);
  assert.equal((await api('/api/file?path=' + encodeURIComponent('../home/opale.json'))).status, 403);
  const upload = await api('/api/file?name=photo.png&source=Accueil.md', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from([1, 2, 3]) });
  assert.deepEqual(await upload.json(), { path: 'Pièces jointes/photo.png' });
  const again = await api('/api/file?name=photo.png', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from([4]) });
  assert.deepEqual(await again.json(), { path: 'Pièces jointes/photo 1.png' });

  await api('/api/folder', { method: 'POST', body: JSON.stringify({ path: 'Illustrations' }) });
  const direct = await api('/api/file?name=opale.webp&folder=Illustrations', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from([5]) });
  assert.deepEqual(await direct.json(), { path: 'Illustrations/opale.webp' });
  assert.equal(fs.readFileSync(path.join(vaultRoot, 'Illustrations', 'opale.webp'))[0], 5);
  assert.equal((await api('/api/file?name=sortie.png&folder=..', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from([1]) })).status, 403);
});

test('watcher picks up files written behind Opale’s back', async () => {
  const root = path.join(temp, 'Surveillé');
  fs.mkdirSync(root);
  const vault = new Vault(root);
  const changes = [];
  vault.on('change', (change) => changes.push(change));
  vault.watch();
  fs.mkdirSync(path.join(root, 'Sous'));
  fs.writeFileSync(path.join(root, 'Sous', 'Externe.md'), 'Bonjour #vu');
  for (let i = 0; i < 60 && !vault.files.has('Sous/Externe.md'); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(vault.files.get('Sous/Externe.md').meta.tags, ['vu']);
  assert.ok(vault.folders.has('Sous'));
  fs.rmSync(path.join(root, 'Sous'), { recursive: true });
  for (let i = 0; i < 60 && vault.files.size; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(vault.files.size, 0);
  assert.ok(!vault.folders.has('Sous'));
  assert.ok(changes.length >= 2);
  vault.close();
});

test(process.platform === 'linux' ? 'Linux keeps paths distinct by case' : 'case-insensitive paths map onto the indexed spelling', () => {
  const vault = app.vault;
  const entry = vault.write('accueil.md', '# Accueil\n');
  if (process.platform === 'linux') {
    assert.equal(entry.path, 'accueil.md');
    assert.ok(vault.files.has('Accueil.md') && vault.files.has('accueil.md'));
    assert.equal(vault.read('Accueil.md').path, 'Accueil.md');
    assert.equal(vault.read('accueil.md').path, 'accueil.md');
    return;
  }
  assert.equal(entry.path, 'Accueil.md');
  assert.equal([...vault.files.keys()].filter((file) => file.toLowerCase() === 'accueil.md').length, 1);
  assert.throws(() => vault.rename('Accueil.md', 'Archives/Projets/Plan.md'), VaultError);
  assert.equal(vault.rename('Accueil.md', 'ACCUEIL.md').to, 'ACCUEIL.md');
  assert.ok(vault.files.has('ACCUEIL.md') && !vault.files.has('Accueil.md'));
});

test('vaults can be created, switched, closed and forgotten', async () => {
  const parent = path.join(temp, 'coffres');
  const created = await (await api('/api/vault/create', { method: 'POST', body: JSON.stringify({ name: 'Nouveau', parent }) })).json();
  assert.equal(created.vault.name, 'Nouveau');
  assert.ok(fs.existsSync(path.join(parent, 'Nouveau', 'Bienvenue.md')));
  const index = await (await api('/api/index')).json();
  assert.ok(index.files.some((file) => file.path === 'Guide/Liens et rétroliens.md'));
  assert.equal(appdata.readJson(appdata.files().instance, null).vault.name, 'Nouveau');
  // The starter notes link to each other: nothing is left dangling but the deliberate example.
  assert.deepEqual(app.vault.overview().unresolved.map((item) => item.target), ['Une idée à écrire plus tard']);

  assert.equal((await api('/api/vault/create', { method: 'POST', body: JSON.stringify({ name: 'Nouveau', parent }) })).status, 409);
  assert.equal((await api('/api/vault/create', { method: 'POST', body: JSON.stringify({ name: '../evade', parent }) })).status, 403);
  assert.equal((await api('/api/vault/open', { method: 'POST', body: JSON.stringify({ path: 'relatif' }) })).status, 400);

  const reopened = await (await api('/api/vault/open', { method: 'POST', body: JSON.stringify({ path: vaultRoot }) })).json();
  assert.equal(reopened.vault.name, 'Coffre');
  assert.deepEqual(reopened.vaults.map((vault) => vault.name), ['Coffre', 'Nouveau']);
  const forgotten = await (await api('/api/vault/forget', { method: 'POST', body: JSON.stringify({ path: path.join(parent, 'Nouveau') }) })).json();
  assert.deepEqual(forgotten.vaults.map((vault) => vault.name), ['Coffre']);
  assert.ok(fs.existsSync(path.join(parent, 'Nouveau', 'Bienvenue.md')), 'forgetting a vault never deletes it');

  const closed = await (await api('/api/vault/close', { method: 'POST', body: '{}' })).json();
  assert.equal(closed.vault, null);
  assert.equal((await api('/api/index')).status, 409);
  assert.match((await call('vault_info')).text, /Aucun coffre n’est ouvert/);
  await api('/api/vault/open', { method: 'POST', body: JSON.stringify({ path: vaultRoot }) });
});
