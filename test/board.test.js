'use strict';

// Moodboards: the shared model (JSON Canvas in and out, geometry, drawing)
// and what the server does with ".canvas" files (creation, renames, MCP).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const Board = require('../shared/board.js');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-board-'));
process.env.OPALE_HOME = path.join(temp, 'home');
const vaultRoot = path.join(temp, 'Coffre');
fs.mkdirSync(path.join(vaultRoot, 'Images'), { recursive: true });
fs.writeFileSync(path.join(vaultRoot, 'Images', 'photo.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
fs.writeFileSync(path.join(vaultRoot, 'Idée.md'), '# Idée\nUne idée.\n');

const { createOpale } = require('../server.js');

let app; let base;
const api = (route, options = {}) => fetch(base + route, { ...options, headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
let rpcId = 0;
async function call(name, args = {}) {
  const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) });
  const body = await response.json();
  return { text: body.result.content[0].text, isError: !!body.result.isError };
}

test.before(async () => {
  app = createOpale({ port: 0, vaultPath: vaultRoot, watch: false });
  base = `http://127.0.0.1:${await app.listen()}`;
});
test.after(async () => { await app.close(); fs.rmSync(temp, { recursive: true, force: true }); });

// ------------------------------------------------------------------ model
test('every kind is created valid and survives a round trip through the file', () => {
  const doc = Board.emptyDoc();
  for (const kind of Board.KIND_NAMES) {
    if (kind === 'connector') continue;
    doc.elements.push(Board.create(kind, { x: 10, y: 20, data: kind === 'image' || kind === 'note' || kind === 'file' ? { file: 'Images/photo.png' } : kind === 'link' || kind === 'embed' ? { url: 'https://exemple.fr' } : {} }));
  }
  const [a, b] = doc.elements;
  doc.elements.push(Board.create('connector', { from: { id: a.id, side: 'right' }, to: { id: b.id }, data: { label: 'suite' } }));
  doc.elements.push(Board.create('connector', { from: { x: 0, y: 0 }, to: { x: 100, y: 50 } }));
  doc.elements[0].rotation = 30; doc.elements[1].locked = true; doc.elements[2].reactions = { '👍': 2 };
  const text = Board.serialize(doc);
  const json = JSON.parse(text);
  assert.ok(Array.isArray(json.nodes) && Array.isArray(json.edges));
  assert.equal(json.edges.length, 1, 'an attached connector is a JSON Canvas edge');
  const { doc: back, problem } = Board.parse(text);
  assert.equal(problem, null);
  assert.deepEqual(back.elements.map((el) => el.kind), doc.elements.map((el) => el.kind), 'kinds and z-order are kept');
  for (let i = 0; i < doc.elements.length; i++) {
    const before = doc.elements[i]; const after = back.elements[i];
    assert.equal(after.id, before.id);
    assert.deepEqual(after.data, before.data, `data of ${before.kind}`);
    assert.deepEqual(after.style, before.style, `style of ${before.kind}`);
    assert.equal(after.rotation, before.rotation);
    assert.equal(after.locked, before.locked);
  }
  assert.deepEqual(back.elements[2].reactions, { '👍': 2 });
  assert.equal(Board.serialize(back), text, 'serialising again gives the same bytes');
});

test('an Obsidian canvas opens with its cards, files, links, groups and edges', () => {
  const obsidian = JSON.stringify({
    nodes: [
      { id: 'n1', type: 'text', text: '# Titre\nTexte', x: 0, y: 0, width: 250, height: 60, color: '4' },
      { id: 'n2', type: 'file', file: 'Idée.md', subpath: '#Idée', x: 300, y: 0, width: 400, height: 300 },
      { id: 'n3', type: 'file', file: 'Images/photo.png', x: 0, y: 400, width: 200, height: 200 },
      { id: 'n4', type: 'link', url: 'https://obsidian.md', x: 300, y: 400, width: 300, height: 200 },
      { id: 'g1', type: 'group', label: 'Groupe', x: -50, y: -50, width: 900, height: 700 },
    ],
    edges: [{ id: 'e1', fromNode: 'n1', fromSide: 'right', toNode: 'n2', toSide: 'left', toEnd: 'arrow', label: 'voir' }],
  });
  const { doc, problem } = Board.parse(obsidian);
  assert.equal(problem, null);
  const kinds = Object.fromEntries(doc.elements.map((el) => [el.id, el.kind]));
  assert.deepEqual(kinds, { n1: 'mdcard', n2: 'note', n3: 'image', n4: 'link', g1: 'frame', e1: 'connector' });
  const card = doc.elements.find((el) => el.id === 'n1');
  assert.equal(card.style.fill, Board.PRESETS[4]);
  assert.equal(card.data.text, '# Titre\nTexte');
  assert.equal(doc.elements.find((el) => el.id === 'n2').data.subpath, 'Idée');
  const edge = doc.elements.find((el) => el.id === 'e1');
  assert.deepEqual([edge.from.id, edge.from.side, edge.to.id, edge.to.side, edge.style.end, edge.style.start, edge.data.label], ['n1', 'right', 'n2', 'left', 'arrow', 'none', 'voir']);
  // Written back, an Obsidian reader still finds its own fields.
  const json = JSON.parse(Board.serialize(doc));
  assert.equal(json.nodes.find((node) => node.id === 'n2').file, 'Idée.md');
  assert.equal(json.nodes.find((node) => node.id === 'g1').type, 'group');
  assert.equal(json.edges[0].fromNode, 'n1');
});

test('damaged or hostile files never break the board', () => {
  assert.ok(Board.parse('{ pas du json').problem);
  assert.ok(Board.parse('[1,2]').problem);
  assert.equal(Board.parse('').problem, null);
  const { doc } = Board.parse(JSON.stringify({
    nodes: [
      null, 42, { id: 'a', type: 'text', x: 'NaN', y: Infinity, width: -5, height: 'x', text: 7 },
      { id: 'a', type: 'text', x: 1, y: 1, width: 10, height: 10, opale: { kind: 'table', data: { rows: 'nope' } } },
      { id: 'b', type: 'text', x: 0, y: 0, width: 10, height: 10, opale: { kind: 'stroke', data: { points: [[1, 2], 'x', [NaN, 3], [4, 5, 9]] } } },
      { id: 'c', type: 'text', opale: { kind: 'mindmap', data: { root: { text: 1, children: [null, { text: 'x' }] } } } },
      { id: 'd', type: 'text', opale: { kind: 'unknown-kind' } },
      { id: 'e', type: 'text', color: 'red; background:url(x)', opale: { kind: 'sticky' } },
    ],
    edges: [{ id: 'z', fromNode: 'a', toNode: 'gone' }, { fromNode: '', toNode: 'a' }],
    opale: { layers: 'x', vote: { votes: { a: 2, ghost: 3 } } },
  }));
  const ids = doc.elements.map((el) => el.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids are renamed');
  for (const el of doc.elements) {
    for (const key of ['x', 'y', 'w', 'h', 'rotation']) assert.ok(Number.isFinite(el[key]), `${el.kind}.${key} finite`);
  }
  const table = doc.elements.find((el) => el.kind === 'table');
  assert.deepEqual(table.data.rows, [['']]);
  const stroke = doc.elements.find((el) => el.kind === 'stroke');
  assert.ok(stroke.data.points.every((p) => p.every(Number.isFinite)));
  assert.equal(doc.elements.find((el) => el.id === 'c').data.root.children.length, 1);
  assert.equal(doc.elements.find((el) => el.id === 'd').kind, 'mdcard');
  assert.notEqual(doc.elements.find((el) => el.id === 'e').style.fill, 'red; background:url(x)');
  const edge = doc.elements.find((el) => el.id === 'z');
  assert.equal(edge.to.id, undefined, 'an edge to a missing element keeps a free end');
  assert.deepEqual(doc.vote.votes, { a: 2 });
  assert.equal(doc.layers[0].id, 'base');
});

test('file references are listed and follow a move', () => {
  const doc = Board.emptyDoc();
  doc.elements.push(Board.create('image', { data: { file: 'Images/photo.png' } }), Board.create('note', { data: { file: 'Idée.md' } }), Board.create('usercard', { data: { image: 'Images/photo.png' } }), Board.create('link', { data: { url: 'https://a.b' } }));
  const text = Board.serialize(doc);
  assert.deepEqual(Board.fileRefs(text).sort(), ['Idée.md', 'Images/photo.png']);
  const moved = Board.rewriteFileRefs(text, (ref) => (ref === 'Images/photo.png' ? 'Photos/photo.png' : null));
  assert.equal(moved.changed, 2);
  assert.deepEqual(Board.fileRefs(moved.text).sort(), ['Idée.md', 'Photos/photo.png']);
  assert.equal(Board.rewriteFileRefs(text, () => null).text, text);
  assert.equal(Board.rewriteFileRefs('{oops', () => 'x').changed, 0);
});

test('connector geometry: sides, curves, elbows and free ends stay finite', () => {
  const a = Board.create('shape', { x: 0, y: 0, w: 100, h: 60 });
  const b = Board.create('shape', { x: 400, y: 200, w: 100, h: 60 });
  const lookup = (id) => [a, b].find((el) => el.id === id);
  assert.equal(Board.facingSide(a, Board.center(b)), 'right');
  for (const pathKind of ['straight', 'curve', 'elbow']) {
    const c = Board.create('connector', { from: { id: a.id }, to: { id: b.id }, style: { path: pathKind } });
    const p = Board.connectorPath(c, lookup);
    assert.match(p.d, /^M [\d.-]+ [\d.-]+/);
    assert.ok(!/NaN|Infinity/.test(p.d), pathKind);
    assert.deepEqual([p.a.x, p.a.y], [100, 30], `${pathKind} leaves from the right side`);
    assert.ok(Number.isFinite(p.endAngle) && Number.isFinite(p.mid.x));
    if (pathKind === 'elbow') assert.ok(p.points.every((pt, i) => i === 0 || pt.x === p.points[i - 1].x || pt.y === p.points[i - 1].y), 'elbow segments are horizontal or vertical');
  }
  const free = Board.create('connector', { from: { x: 5, y: 5 }, to: { x: 5, y: 5 } });
  assert.ok(!/NaN/.test(Board.connectorPath(free, lookup).d));
  const rotated = Board.create('shape', { x: 0, y: 0, w: 100, h: 50, rotation: 90 });
  const box = Board.bounds(rotated);
  assert.ok(Math.abs(box.w - 50) < 1e-6 && Math.abs(box.h - 100) < 1e-6);
  assert.ok(Board.distanceToPolyline({ x: 50, y: 10 }, [{ x: 0, y: 0 }, { x: 100, y: 0 }]) === 10);
});

test('drawing: smoothing, outline and fitting a stroke to its box', () => {
  const raw = Array.from({ length: 50 }, (_, i) => [100 + i * 3, 200 + Math.sin(i / 5) * 20, 0.5]);
  const smooth = Board.smoothPoints(raw);
  assert.deepEqual(smooth[0], raw[0]);
  assert.deepEqual(smooth[smooth.length - 1], raw[raw.length - 1].map((v) => Math.round(v * 100) / 100));
  const outline = Board.strokeOutline(smooth, 6);
  assert.match(outline, /^M .* Z$/);
  assert.ok(!/NaN/.test(outline));
  assert.match(Board.strokeOutline([[1, 1, 0.5]], 4), /a 2 2/);
  const el = Board.fitStroke(Board.create('stroke', { data: { points: raw } }));
  assert.ok(el.x > 90 && el.y > 170 && el.w > 140);
  assert.ok(el.data.points.every(([x, y]) => x >= 0 && y >= 0 && x <= el.w && y <= el.h));
});

test('bulk add splits lines and bullets, the plan export lists tasks', () => {
  assert.deepEqual(Board.bulkLines('- un\n* deux\n\n3. trois\n  quatre  '), ['un', 'deux', 'trois', 'quatre']);
  const doc = Board.emptyDoc();
  const a = Board.create('card', { data: { title: 'Maquette', status: 'doing', assignee: 'Bryan', points: '3', tags: ['design'] } });
  const b = Board.create('card', { data: { title: 'Code', status: 'todo', points: '5', due: '2026-10-20' } });
  doc.elements.push(a, b, Board.create('connector', { from: { id: a.id }, to: { id: b.id }, data: { relation: 'dependency' } }));
  const plan = Board.planMarkdown(doc, 'Projet');
  assert.match(plan, /^# Projet/);
  assert.match(plan, /## En cours\n\n- \[ \] Maquette — 👤 Bryan · 3 pts · #design/);
  assert.match(plan, /- \[ \] Code — 📅 2026-10-20 · 5 pts\n {2}- dépend de : Maquette/);
  assert.match(plan, /Total : 8 points/);
});

// ----------------------------------------------------------------- server
test('server: a new moodboard is an empty .canvas file of kind "board"', async () => {
  const created = await (await api('/api/note', { method: 'POST', body: JSON.stringify({ folder: '', ext: 'canvas' }) })).json();
  assert.equal(created.path, 'Moodboard.canvas');
  const again = await (await api('/api/note', { method: 'POST', body: JSON.stringify({ folder: '', ext: 'canvas' }) })).json();
  assert.equal(again.path, 'Moodboard 1.canvas');
  const index = await (await api('/api/index')).json();
  assert.equal(index.files.find((entry) => entry.path === 'Moodboard.canvas').kind, 'board');
  const read = await (await api(`/api/note?path=${encodeURIComponent('Moodboard.canvas')}`)).json();
  const { doc, problem } = Board.parse(read.content);
  assert.equal(problem, null);
  assert.equal(doc.elements.length, 0);
  // Saving with a stale version is refused, like a note.
  const first = await api('/api/note', { method: 'PUT', body: JSON.stringify({ path: 'Moodboard.canvas', content: read.content.replace('"nodes": []', '"nodes": [ ]'), baseMtime: read.mtime }) });
  assert.equal(first.status, 200);
  const stale = await api('/api/note', { method: 'PUT', body: JSON.stringify({ path: 'Moodboard.canvas', content: read.content, baseMtime: read.mtime - 5000 }) });
  assert.equal(stale.status, 409);
});

test('server: moving a picture or a note rewrites the boards that show it', async () => {
  const doc = Board.emptyDoc();
  doc.elements.push(Board.create('image', { data: { file: 'Images/photo.png' } }), Board.create('note', { data: { file: 'Idée.md' } }));
  fs.writeFileSync(path.join(vaultRoot, 'Planche.canvas'), Board.serialize(doc));
  app.vault.scan();
  const links = await (await api(`/api/backlinks?path=${encodeURIComponent('Images/photo.png')}`)).json();
  assert.ok(links.linked.some((item) => item.path === 'Planche.canvas'));
  const moved = await (await api('/api/rename', { method: 'POST', body: JSON.stringify({ from: 'Images', to: 'Photos' }) })).json();
  assert.equal(moved.linksUpdated, 1);
  await (await api('/api/rename', { method: 'POST', body: JSON.stringify({ from: 'Idée.md', to: 'Notes/Idée.md' }) })).json();
  const text = fs.readFileSync(path.join(vaultRoot, 'Planche.canvas'), 'utf8');
  assert.deepEqual(Board.fileRefs(text).sort(), ['Notes/Idée.md', 'Photos/photo.png']);
  assert.equal(Board.parse(text).doc.elements.length, 2);
});

test('MCP: an assistant reads and fills a moodboard', async () => {
  const added = await call('add_to_board', {
    path: 'Atelier',
    items: [
      { kind: 'sticky', text: 'Première idée', color: '#a8e6ff' },
      { kind: 'card', title: 'Tâche', status: 'doing', points: 3 },
      { kind: 'image', file: 'photo.png' },
      { kind: 'mindmap', text: 'Projet', children: [{ text: 'A' }, { text: 'B', children: [{ text: 'B1' }] }] },
      { kind: 'kanban', title: 'Suivi', columns: [{ title: 'À faire', cards: ['x', 'y'] }] },
    ],
    connect: [{ from: 0, to: 1, label: 'mène à' }],
  });
  assert.equal(added.isError, false, added.text);
  const result = JSON.parse(added.text);
  assert.equal(result.path, 'Atelier.canvas');
  assert.equal(result.ids.length, 5);
  const read = JSON.parse((await call('read_board', { path: 'Atelier' })).text);
  assert.equal(read.count, 6);
  assert.ok(read.elements.some((el) => el.kind === 'connector' && el.from === result.ids[0] && el.to === result.ids[1]));
  assert.equal(read.elements.find((el) => el.kind === 'image').text, 'Photos/photo.png');
  // A second call places new items below the first ones, without overlap.
  const more = JSON.parse((await call('add_to_board', { path: 'Atelier.canvas', items: [{ kind: 'text', text: 'Plus bas' }] })).text);
  const after = JSON.parse((await call('read_board', { path: 'Atelier' })).text);
  const low = after.elements.find((el) => el.id === more.ids[0]);
  const others = after.elements.filter((el) => el.kind !== 'connector' && el.id !== low.id);
  assert.ok(others.every((el) => low.y > el.y + el.h), 'new items go under the existing content');
  assert.equal((await call('add_to_board', { path: 'Atelier', items: [{ kind: 'image', file: 'absente.png' }] })).isError, true);
  assert.equal((await call('add_to_board', { path: 'Atelier', items: [{ kind: 'bidule' }] })).isError, true);
  assert.equal((await call('read_board', { path: 'Inconnu' })).isError, true);
  const written = await call('write_board', { path: 'Obsidian', canvas: { nodes: [{ id: 'x', type: 'text', text: 'Salut', x: 0, y: 0, width: 100, height: 50 }], edges: [] } });
  assert.match(written.text, /Moodboard créé : Obsidian\.canvas \(1 éléments\)/);
});

test('MCP: every module can be placed, read in full and edited atomically', async () => {
  const catalog = JSON.parse((await call('board_catalog', {})).text);
  assert.deepEqual(catalog.modules.map((m) => m.kind), Object.keys(Board.KINDS));
  const shapes = JSON.parse((await call('board_catalog', { library: 'shape' })).text);
  assert.ok(shapes.count >= 180);
  assert.ok(shapes.entries.some((el) => el.data.shape === 'rect'));
  const icons = JSON.parse((await call('board_catalog', { library: 'icon' })).text);
  assert.ok(icons.count >= 240);
  const items = catalog.modules.filter((m) => m.kind !== 'connector').map((m, i) => ({ kind: m.kind, x: i * 600 + 0.25, y: -25.5, rotation: 12, style: { opacity: 0.75 }, data: ['image', 'file', 'note'].includes(m.kind) ? { file: m.kind === 'note' ? 'Notes/Idée.md' : 'Photos/photo.png' } : m.kind === 'activity' ? { type: 'quiz', question: 'Question', options: [{ text: 'Oui', correct: true }] } : m.kind === 'flipcard' ? { front: 'A', back: 'B', flipped: true } : {} }));
  const result = await call('add_to_board', { path: 'Complet', items, connect: [{ from: 0, to: 1, label: 'Lien' }] });
  assert.equal(result.isError, false, result.text);
  const added = JSON.parse(result.text);
  let read = JSON.parse((await call('read_board', { path: added.path })).text);
  assert.equal(read.count, Object.keys(Board.KINDS).length);
  assert.equal(read.elements[0].x, 0);
  assert.equal(read.elements[0].rotation, 12);
  assert.equal(read.elements[0].style.opacity, 0.75);
  assert.equal(read.elements.find((el) => el.kind === 'activity').data.type, 'quiz');
  assert.equal(read.elements.find((el) => el.kind === 'flipcard').data.flipped, true);
  const before = app.vault.read(added.path).content;
  const bad = await call('edit_board', { path: added.path, updates: [{ id: added.ids[0], x: 999 }, { id: 'missing', x: 500 }] });
  assert.equal(bad.isError, true);
  assert.equal(app.vault.read(added.path).content, before, 'invalid batch must not partially save');
  const stale = await call('edit_board', { path: added.path, base_mtime: read.mtime - 5000, updates: [{ id: added.ids[0], x: 999 }] });
  assert.equal(stale.isError, true);
  assert.equal(app.vault.read(added.path).content, before);
  const changed = await call('edit_board', { path: added.path, base_mtime: read.mtime, updates: read.elements.filter((el) => el.kind !== 'connector').map((el) => ({ id: el.id, x: el.x + 20, locked: true, group: 'g', style: { opacity: 0.5 }, data: el.data })), settings: { snap: false, privateMode: true }, layers: [{ id: 'custom', name: 'Modules', visible: true, locked: false }], vote: { active: true, perPerson: 4, votes: { [added.ids[0]]: 1 } } });
  assert.equal(changed.isError, false, changed.text);
  read = JSON.parse((await call('read_board', { path: added.path })).text);
  assert.equal(read.elements[0].x, 20);
  assert.equal(read.elements[0].locked, true);
  assert.equal(read.elements[0].group, 'g');
  assert.equal(read.elements[0].layer, 'custom');
  assert.equal(read.settings.snap, false);
  assert.equal(read.vote.perPerson, 4);
  const reordered = await call('edit_board', { path: added.path, order: read.elements.map((el) => el.id).reverse() });
  assert.equal(reordered.isError, false, reordered.text);
  const removed = await call('edit_board', { path: added.path, delete_ids: [added.ids[0]] });
  assert.equal(removed.isError, false, removed.text);
  read = JSON.parse((await call('read_board', { path: added.path })).text);
  assert.equal(read.count, Object.keys(Board.KINDS).length - 2, 'attached connector is removed too');
  assert.equal((await call('add_to_board', { path: 'Notes/Idée.md', items: [{ kind: 'sticky' }] })).isError, true);
  assert.equal((await call('add_to_board', { path: added.path, items: [{ kind: '__proto__' }] })).isError, true);
});

test('MCP: diagram imports become editable modules and preserve errors', async () => {
  const imported = await call('import_to_board', { path: 'Diagrammes', format: 'mermaid', source: 'flowchart LR\n A[Idée] --> B[Projet]', x: 400, y: 200 });
  assert.equal(imported.isError, false, imported.text);
  let read = JSON.parse((await call('read_board', { path: 'Diagrammes' })).text);
  assert.ok(read.elements.some((el) => el.kind === 'connector'));
  const drawio = await call('import_to_board', { path: 'Diagrammes', format: 'drawio', source: '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="draw.io" vertex="1" parent="1"><mxGeometry x="0" y="0" width="160" height="80" as="geometry"/></mxCell></root></mxGraphModel>', x: 900, y: 600 });
  assert.equal(drawio.isError, false, drawio.text);
  read = JSON.parse((await call('read_board', { path: 'Diagrammes' })).text);
  assert.ok(read.elements.some((el) => el.x === 900));
  const before = app.vault.read('Diagrammes.canvas').content;
  assert.equal((await call('import_to_board', { path: 'Diagrammes', format: 'drawio', source: 'cassé' })).isError, true);
  assert.equal(app.vault.read('Diagrammes.canvas').content, before);
});
