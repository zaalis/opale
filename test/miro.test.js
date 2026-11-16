'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-miro-test-'));
process.env.OPALE_HOME = path.join(temp, 'home');
const { MiroAccount, MiroService, boardId } = require('../lib/miro.js');
const { convertBoard, richText, idOf } = require('../lib/miro-convert.js');
const credentials = require('../lib/miro-credentials.js');
const media = require('../lib/miro-media.js');
const { Vault } = require('../lib/vault.js');
const Board = require('../shared/board.js');
const { createOpale } = require('../server.js');
const board = { id: 'uXjV123=', name: 'Ambiance été', modifiedAt: '2026-10-12T00:00:00Z' };
const item = (id, type, props = {}) => ({ id, type, position: { x: 0, y: 0, relativeTo: 'canvas_center', origin: 'center' }, geometry: { width: 200, height: 100, rotation: 0 }, ...props });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4q8AAAAASUVORK5CYII=', 'base64');
function account(fetch, connected = true) {
  const data = { clientId: '123456', clientSecret: 'test-secret', ...(connected ? { accessToken: 'private-token', refreshToken: 'refresh-token', userId: 'user', teamId: 'team' } : {}) };
  return new MiroAccount({ fetch, storage: { load: () => ({ ...data }), save: () => {} } });
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function fixture(items, connectors = [], overrides = {}) {
  const requests = [];
  const miro = account(async (address, options) => {
    const url = new URL(address); requests.push({ url, options });
    if (overrides[url.pathname]) return overrides[url.pathname](url, options);
    if (url.pathname === '/v1/oauth/token') return json({ access_token: 'private-token', refresh_token: 'refresh-token', scope: 'boards:read', team_id: 'team', user_id: 'user', expires_in: 3599 });
    if (url.pathname === '/v2/oauth/revoke') return new Response(null, { status: 204 });
    if (url.pathname === '/v2/boards') return json({ data: [board] });
    if (url.pathname.endsWith('/items')) return json({ data: items });
    if (url.pathname.endsWith('/connectors')) return json({ data: connectors });
    if (url.pathname.includes('/resources/')) return json({ url: 'https://cdn.example/image.png' });
    return json(board);
  });
  return { miro, requests };
}
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

test('Miro links, large IDs, and parent coordinates survive JSON Canvas conversion', () => {
  assert.equal(boardId('https://miro.com/app/board/uXjV123%3D/?share=1'), board.id);
  assert.throws(() => boardId('https://example.com/app/board/a/'), /miro.com/);
  const frame = item('frame', 'frame', { geometry: { width: 800, height: 600 }, data: { title: 'Palette' } });
  const sticky = item('3458764555555555555', 'sticky_note', { parent: { id: 'frame' }, position: { relativeTo: 'parent_top_left', x: 100, y: 80 }, data: { content: '<p><strong>Été</strong><br>Bleu &amp; sable</p>' }, style: { fillColor: 'light_blue' } });
  const image = item('image', 'image');
  const connector = { id: 'connector', type: 'connector', shape: 'straight', startItem: { id: sticky.id, position: { x: '100%', y: '50%' } }, endItem: { id: image.id }, captions: [{ content: 'inspiration' }] };
  const result = convertBoard(board, [sticky, image, frame], [connector], new Map([['image', 'Imports Miro/Été/Images/image.png']]));
  const doc = Board.parse(result.content).doc;
  assert.equal(doc.elements.length, 4);
  const converted = doc.elements.find((el) => el.id === idOf(sticky.id));
  assert.equal(converted.x, -400); assert.equal(converted.y, -270);
  assert.equal(converted.style.fill, '#a6ccf5'); assert.match(converted.data.text, /\*\*Été\*\*/);
  assert.deepEqual(Board.fileRefs(result.content), ['Imports Miro/Été/Images/image.png']);
  assert.equal(doc.elements.find((el) => el.kind === 'connector').from.id, idOf(sticky.id));
  assert.equal(result.warnings.length, 0);
});
test('unsupported items/images/connectors are visible placeholders with warnings', () => {
  const result = convertBoard(board, [item('unknown', 'drawing'), item('image', 'image'), item('shape', 'shape', { data: { shape: 'unsupported' } })], [{ id: 'line', type: 'connector' }]);
  assert.equal(result.count, 4); assert.equal(result.warnings.length, 4);
  assert.match(result.content, /Ouvrir l’élément dans Miro/);
  assert.equal(Board.parse(result.content).problem, null);
});
test('conversion refuses missing parents, cycles, corrupt and changing identities', () => {
  assert.throws(() => convertBoard(board, [{ id: 3458764555555, type: 'text' }]), /identifiant/);
  assert.throws(() => convertBoard(board, [item('x', 'text'), item('x', 'shape')]), /changé/);
  const child = item('child', 'text', { parent: { id: 'absent' }, position: { relativeTo: 'parent_top_left' } });
  assert.throws(() => convertBoard(board, [child]), /parent absent/);
  child.parent.id = 'child'; assert.throws(() => convertBoard(board, [child]), /hiérarchie/);
});
test('rich text preserves formatting but rejects scripts and dangerous links', () => {
  const text = richText('<script>alert(1)</script><a href="javascript:alert(1)">Test</a><img src=x onerror=alert(1)><b>Texte</b>&lt;iframe&gt;');
  assert.equal(text, 'Test**Texte**&lt;iframe&gt;');
  assert.match(richText('<a href="https://example.com/a(b)">Lien</a>'), /https:\/\/example.com\/a%28b%29/);
});
test('OAuth state is single use, validates unicode, and exposes no secrets', async () => {
  const { miro, requests } = fixture([]); miro.data.accessToken = '';
  const url = new URL(miro.beginAuth('http://127.0.0.1:27184/oauth/miro'));
  await assert.rejects(miro.finishAuth({ state: 'é'.repeat(64), code: 'code' }), /correspond pas/);
  const query = { state: url.searchParams.get('state'), code: 'code' };
  await miro.finishAuth(query);
  assert.equal(miro.connected, true);
  assert.equal(requests[0].url.searchParams.get('redirect_uri'), 'http://127.0.0.1:27184/oauth/miro');
  assert.doesNotMatch(JSON.stringify(miro.info()), /private-token|test-secret|refresh-token/);
  await assert.rejects(miro.finishAuth(query), /expiré/);
  await miro.disconnect();
  const revoke = requests.find((r) => r.url.pathname === '/v2/oauth/revoke');
  assert.deepEqual(JSON.parse(revoke.options.body), { accessToken: 'private-token', clientId: '123456', clientSecret: 'test-secret' });
  assert.equal(miro.connected, false);
});
test('expired tokens refresh only once for concurrent requests', async () => {
  let refresh = 0;
  const miro = account(async (address) => { if (new URL(address).pathname === '/v1/oauth/token') { refresh++; await new Promise((r) => setTimeout(r, 10)); return json({ access_token: 'new-token', expires_in: 3600 }); } return json({}); });
  miro.data.until = 1;
  await Promise.all([miro.request('/v2/boards'), miro.request('/v2/boards')]);
  assert.equal(refresh, 1); assert.equal(miro.data.accessToken, 'new-token');
});
test('pagination stops repeated cursors instead of publishing incomplete boards', async () => {
  const service = new MiroService(account(async () => json({ data: [], cursor: 'same' })));
  await assert.rejects(service.listAll('/v2/boards/x/items'), /répété/);
});
test('imports commit board, images, source and report together and never overwrite', async () => {
  const root = path.join(temp, 'successful'); fs.mkdirSync(root); const vault = new Vault(root);
  const items = [item('image', 'image', { data: { imageUrl: 'https://api.miro.com/v2/boards/uXjV123=/resources/image' } }), item('sticky', 'sticky_note', { data: { content: 'Couleurs' } })];
  const { miro, requests } = fixture(items);
  const service = new MiroService(miro, { download: async () => png });
  const first = await service.importBoard(vault, board.id, () => true, () => {});
  assert.equal(first.images, 1); assert.equal(first.warnings.length, 0);
  assert.equal(Board.parse(vault.read(first.path).content).problem, null);
  for (const ref of Board.fileRefs(vault.read(first.path).content)) assert.deepEqual(fs.readFileSync(vault.abs(ref)), png);
  assert.ok(fs.existsSync(vault.abs(first.report))); assert.ok(fs.existsSync(vault.abs(first.source)));
  const second = await service.importBoard(vault, board.id, () => true, () => {});
  assert.notEqual(first.path, second.path); assert.ok(fs.existsSync(vault.abs(first.path)));
  assert.equal(requests.find((r) => r.url.pathname.includes('/resources/')).url.searchParams.get('redirect'), 'false');
  assert.deepEqual(fs.readdirSync(path.join(root, '.opale')).filter((f) => f.startsWith('miro-import-')), []);
  vault.close();
});
test('failed images use previews or explicit placeholders; account cancellation leaves no import', async () => {
  const root = path.join(temp, 'failures'); fs.mkdirSync(root); const vault = new Vault(root);
  const { miro } = fixture([item('image', 'image', { data: { imageUrl: 'https://api.miro.com/v2/boards/uXjV123=/resources/image' } })]);
  const service = new MiroService(miro, { download: async () => { throw new Error('CDN failure'); } });
  const result = await service.importBoard(vault, board.id, () => true, () => {});
  assert.equal(result.images, 0); assert.ok(result.warnings.length > 0);
  assert.equal(Board.parse(vault.read(result.path).content).doc.elements[0].kind, 'mdcard');
  const before = [...vault.files.keys()];
  await assert.rejects(service.importBoard(vault, board.id, () => false, () => {}), /changé/);
  assert.deepEqual([...vault.files.keys()], before);
  vault.close();
});
test('Windows protects credentials outside the vault and malformed media is rejected', () => {
  const file = path.join(temp, 'credentials.json'); const data = { clientId: '123', clientSecret: 'never-display-me', accessToken: 'test-token' };
  credentials.save(file, data); assert.deepEqual(credentials.load(file), data);
  if (process.platform === 'win32') assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /never-display-me|test-token/);
  fs.writeFileSync(file, '{invalid'); assert.throws(() => credentials.load(file), /illisibles/);
  assert.equal(media.imageExtension(png), 'png'); assert.equal(media.imageExtension(Buffer.from('<html>')), '');
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.1.1', '192.168.1.1', '::1', '::ffff:127.0.0.1']) assert.equal(media.publicAddress(ip), false);
  assert.equal(media.publicAddress('8.8.8.8'), true);
});
test('Miro routes enforce local API auth and return clear import errors', async () => {
  const root = path.join(temp, 'server'); fs.mkdirSync(root);
  const { miro } = fixture([item('text', 'text', { data: { content: 'Bonjour' } })]);
  let launched;
  const app = createOpale({ port: 0, vaultPath: root, watch: false, miro, openExternal: (url) => { launched = url; } });
  const base = `http://127.0.0.1:${await app.listen()}`;
  const call = (route, method = 'GET', body) => fetch(base + route, { method, headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await fetch(base + '/api/miro')).status, 401);
    const status = await (await call('/api/miro')).json(); assert.equal(status.redirectUri, base + '/oauth/miro');
    assert.equal((await (await call('/api/miro/boards')).json()).data[0].id, board.id);
    await call('/api/miro/connect', 'POST', {}); assert.equal(new URL(launched).origin, 'https://miro.com');
    const state = new URL(launched).searchParams.get('state');
    assert.match(await (await fetch(`${base}/oauth/miro?state=${state}&code=code`)).text(), /réussie/);
    const bad = await call('/api/miro/import', 'POST', { board: 'https://example.com/invalid' });
    assert.equal(bad.status, 400); assert.equal((await bad.json()).code, 'miro-board');
    await call('/api/miro/import', 'POST', { board: board.id }); await app.miroService.running;
    assert.equal((await (await call('/api/miro')).json()).import.phase, 'done');
  } finally { await app.close(); }
});
