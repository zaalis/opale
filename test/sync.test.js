'use strict';

// Two computers sharing one vault through an in-memory stand-in for Drive.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { Vault } = require('../lib/vault.js');
const { SyncEngine } = require('../lib/sync.js');
const { merge3 } = require('../lib/merge.js');

class FakeDrive {
  constructor() { this.items = new Map(); this.next = 1; this.calls = []; }
  _id() { return `id${this.next++}`; }
  _add(item) { this.items.set(item.id, { trashed: false, md5: '', size: 0, modified: Date.now(), device: '', ...item }); return this.view(item.id); }
  view(id) { const item = this.items.get(id); return { id, name: item.name, parents: [item.parent], folder: !!item.folder, md5: item.md5, size: item.size, modified: item.modified, device: item.device }; }
  async createVault(name) { const vaultId = crypto.randomUUID(); const folder = this._add({ id: this._id(), name, parent: 'root', folder: true, vaultId }); return { vaultId, folderId: folder.id, name }; }
  async list(vaultId) { return [...this.items.values()].filter((item) => item.vaultId === vaultId && !item.trashed).map((item) => this.view(item.id)); }
  async createFolder(name, parentId, vaultId) { this.calls.push('folder'); return this._add({ id: this._id(), name, parent: parentId, folder: true, vaultId }); }
  async upload({ id, name, parentId, vaultId, device, data }) {
    this.calls.push(id ? 'update' : 'create');
    const md5 = crypto.createHash('md5').update(data).digest('hex');
    if (id) { Object.assign(this.items.get(id), { data: Buffer.from(data), md5, size: data.length, device, modified: Date.now() }); return this.view(id); }
    return this._add({ id: this._id(), name, parent: parentId, vaultId, device, data: Buffer.from(data), md5, size: data.length });
  }
  async download(id) { this.calls.push('download'); return Buffer.from(this.items.get(id).data); }
  async move(id, { name, addParent }) { this.calls.push('move'); const item = this.items.get(id); if (name) item.name = name; if (addParent) item.parent = addParent; return this.view(id); }
  async trash(id) { this.calls.push('trash'); this.items.get(id).trashed = true; for (const item of this.items.values()) if (item.parent === id) item.trashed = true; }
  // Edits made straight in Drive (or by a third computer).
  byPath(vaultId, folderId, rel) {
    let parent = folderId;
    const parts = rel.split('/');
    for (let i = 0; i < parts.length; i++) {
      const hit = [...this.items.values()].find((item) => !item.trashed && item.vaultId === vaultId && item.parent === parent && item.name === parts[i]);
      if (!hit) return null;
      if (i === parts.length - 1) return hit;
      parent = hit.id;
    }
    return null;
  }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-sync-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

let counter = 0;
function computer(name, files = {}) {
  const root = path.join(temp, `${name}-${++counter}`);
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); }
  return new Vault(root);
}
const read = (vault, rel) => fs.readFileSync(path.join(vault.root, ...rel.split('/')), 'utf8');
const exists = (vault, rel) => fs.existsSync(path.join(vault.root, ...rel.split('/')));
// mtime has a millisecond resolution: make sure an edit is seen as one.
function edit(vault, rel, content) {
  const full = path.join(vault.root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  const later = new Date(Date.now() + 5000 + Math.random() * 1000);
  fs.utimesSync(full, later, later);
  vault.scan();
}

async function pair(files = {}) {
  const drive = new FakeDrive();
  const desk = computer('fixe', files); const laptop = computer('portable');
  const deskSync = new SyncEngine(desk, drive, { device: 'PC-FIXE' });
  const info = await drive.createVault('Notes');
  deskSync.link(info);
  await deskSync.run();
  const laptopSync = new SyncEngine(laptop, drive, { device: 'PC-PORTABLE' });
  laptopSync.link(info);
  await laptopSync.run();
  return { drive, desk, laptop, deskSync, laptopSync, info };
}

test('merge3 combines edits to different lines and refuses overlapping ones', () => {
  const base = 'titre\nun\ndeux\ntrois\nquatre\ncinq';
  assert.equal(merge3(base, 'titre\nUN\ndeux\ntrois\nquatre\ncinq', 'titre\nun\ndeux\ntrois\nquatre\nCINQ'), 'titre\nUN\ndeux\ntrois\nquatre\nCINQ');
  assert.equal(merge3(base, base + '\nfin A', 'début B\n' + base), 'début B\n' + base + '\nfin A');
  assert.equal(merge3(base, 'titre\nUN\ndeux\ntrois\nquatre\ncinq', 'titre\nUn !\ndeux\ntrois\nquatre\ncinq'), null);
  assert.equal(merge3(base, 'titre\nX\ndeux\ntrois\nquatre\ncinq', 'titre\nX\ndeux\ntrois\nquatre\ncinq'), 'titre\nX\ndeux\ntrois\nquatre\ncinq');
  assert.equal(merge3('a\nb', 'a\nb', 'a\nb\nc'), 'a\nb\nc');
});

test('a second computer receives the whole vault, folders included', async () => {
  const { laptop, drive } = await pair({ 'Accueil.md': '# Accueil', 'Projets/Plan.md': 'plan', 'Pièces jointes/photo.png': Buffer.from([1, 2, 3]) });
  assert.equal(read(laptop, 'Accueil.md'), '# Accueil');
  assert.equal(read(laptop, 'Projets/Plan.md'), 'plan');
  assert.deepEqual([...fs.readFileSync(path.join(laptop.root, 'Pièces jointes', 'photo.png'))], [1, 2, 3]);
  assert.ok(!drive.calls.includes('update'));
});

test('Linux Drive sync preserves files differing only in case', { skip: process.platform !== 'linux' }, async () => {
  const { laptop } = await pair({ 'Note.md': 'Uppercase', 'note.md': 'Lowercase' });
  assert.equal(read(laptop, 'Note.md'), 'Uppercase');
  assert.equal(read(laptop, 'note.md'), 'Lowercase');
});

test('an edit travels one way, then back', async () => {
  const { desk, laptop, deskSync, laptopSync } = await pair({ 'Note.md': 'v1' });
  edit(laptop, 'Note.md', 'v2 depuis le portable');
  await laptopSync.run(); await deskSync.run();
  assert.equal(read(desk, 'Note.md'), 'v2 depuis le portable');
  edit(desk, 'Note.md', 'v3 depuis le fixe');
  await deskSync.run(); await laptopSync.run();
  assert.equal(read(laptop, 'Note.md'), 'v3 depuis le fixe');
});

test('a quiet run transfers nothing', async () => {
  const { drive, deskSync, laptopSync } = await pair({ 'A.md': 'a', 'Dossier/B.md': 'b' });
  drive.calls.length = 0;
  await deskSync.run(); await laptopSync.run();
  assert.deepEqual(drive.calls, []);
});

test('edits to different parts of one note on both computers are merged', async () => {
  const { desk, laptop, deskSync, laptopSync } = await pair({ 'Journal.md': '# Journal\n\nMatin : rien\n\nMidi : rien\n\nSoir : rien\n' });
  edit(desk, 'Journal.md', '# Journal\n\nMatin : café\n\nMidi : rien\n\nSoir : rien\n');
  edit(laptop, 'Journal.md', '# Journal\n\nMatin : rien\n\nMidi : rien\n\nSoir : cinéma\n');
  await deskSync.run();
  const summary = await laptopSync.run();
  assert.deepEqual(summary.merged, ['Journal.md']);
  await deskSync.run();
  const expected = '# Journal\n\nMatin : café\n\nMidi : rien\n\nSoir : cinéma\n';
  assert.equal(read(laptop, 'Journal.md'), expected);
  assert.equal(read(desk, 'Journal.md'), expected);
});

test('the same line changed on both computers keeps both versions', async () => {
  const { desk, laptop, deskSync, laptopSync } = await pair({ 'Idée.md': 'une idée' });
  edit(desk, 'Idée.md', 'idée du fixe');
  edit(laptop, 'Idée.md', 'idée du portable');
  await deskSync.run();
  const summary = await laptopSync.run();
  assert.equal(summary.conflicts.length, 1);
  const copy = summary.conflicts[0].copy;
  assert.match(copy, /^Idée \(conflit PC-FIXE \d{4}-\d\d-\d\d \d\dh\d\d\)\.md$/);
  assert.equal(read(laptop, 'Idée.md'), 'idée du portable');
  assert.equal(read(laptop, copy), 'idée du fixe');
  assert.equal(laptopSync.state.conflicts.length, 1);
  await deskSync.run();
  // Every computer ends up with the same two files.
  assert.equal(read(desk, 'Idée.md'), 'idée du portable');
  assert.equal(read(desk, copy), 'idée du fixe');
});

test('deletions follow, but an edit made meanwhile wins over a deletion', async () => {
  const { drive, desk, laptop, deskSync, laptopSync } = await pair({ 'Vieux.md': 'à jeter', 'Gardé.md': 'g' });
  desk.remove('Vieux.md');
  await deskSync.run(); await laptopSync.run();
  assert.equal(exists(laptop, 'Vieux.md'), false);
  assert.equal(exists(laptop, '.trash/Vieux.md'), true, 'goes to the vault bin, not lost');
  desk.remove('Gardé.md');
  edit(laptop, 'Gardé.md', 'modifié sur le portable');
  await deskSync.run(); await laptopSync.run(); await deskSync.run();
  assert.equal(read(desk, 'Gardé.md'), 'modifié sur le portable');
  assert.ok(drive.calls.includes('trash'));
});

test('a rename moves the Drive file instead of uploading it again', async () => {
  const { drive, desk, laptop, deskSync, laptopSync } = await pair({ 'Brouillon.md': 'contenu assez long', 'Autre.md': 'x' });
  desk.rename('Brouillon.md', 'Archives/Final.md');
  drive.calls.length = 0;
  await deskSync.run();
  assert.ok(drive.calls.includes('move'));
  assert.ok(!drive.calls.includes('create'));
  drive.calls.length = 0;
  await laptopSync.run();
  assert.ok(!drive.calls.includes('download'), 'the laptop renames its own copy');
  assert.equal(read(laptop, 'Archives/Final.md'), 'contenu assez long');
  assert.equal(exists(laptop, 'Brouillon.md'), false);
});

test('a file changed directly in Drive comes down', async () => {
  const { drive, laptop, laptopSync, info } = await pair({ 'Liste.md': 'pain' });
  const item = drive.byPath(info.vaultId, info.folderId, 'Liste.md');
  await drive.upload({ id: item.id, data: Buffer.from('pain\nlait'), device: 'téléphone' });
  await laptopSync.run();
  assert.equal(read(laptop, 'Liste.md'), 'pain\nlait');
});

test('linking a vault that already has notes merges both sides without losing any', async () => {
  const drive = new FakeDrive();
  const desk = computer('fixe', { 'Commun.md': 'version fixe', 'Fixe.md': 'f' });
  const laptop = computer('portable', { 'Commun.md': 'version portable', 'Portable.md': 'p' });
  const info = await drive.createVault('Notes');
  const deskSync = new SyncEngine(desk, drive, { device: 'PC-FIXE' }); deskSync.link(info); await deskSync.run();
  const laptopSync = new SyncEngine(laptop, drive, { device: 'PC-PORTABLE' }); laptopSync.link(info);
  const summary = await laptopSync.run();
  await deskSync.run();
  assert.equal(summary.conflicts.length, 1);
  for (const vault of [desk, laptop]) {
    assert.equal(read(vault, 'Fixe.md'), 'f');
    assert.equal(read(vault, 'Portable.md'), 'p');
    assert.equal(read(vault, 'Commun.md'), 'version portable');
    assert.equal(read(vault, summary.conflicts[0].copy), 'version fixe');
  }
});

test('empty folders are created and removed on the other computer', async () => {
  const { desk, laptop, deskSync, laptopSync } = await pair({ 'A.md': 'a' });
  desk.createFolder('Vide/Sous-dossier');
  await deskSync.run(); await laptopSync.run();
  assert.ok(fs.statSync(path.join(laptop.root, 'Vide', 'Sous-dossier')).isDirectory());
  desk.remove('Vide');
  await deskSync.run(); await laptopSync.run();
  assert.equal(exists(laptop, 'Vide'), false);
});

test('Opale’s own folders never leave the computer', async () => {
  const { drive, desk, deskSync, info } = await pair({ 'A.md': 'a' });
  desk.saveSettings({ theme: 'light' });
  desk.remove('A.md');
  await deskSync.run();
  const names = (await drive.list(info.vaultId)).map((item) => item.name);
  assert.ok(!names.some((name) => name.startsWith('.')));
});

test('a vanished Drive folder stops the run without touching any file', async () => {
  const { drive, laptop, laptopSync, info } = await pair({ 'A.md': 'a', 'B.md': 'b' });
  await drive.trash(info.folderId);
  await assert.rejects(laptopSync.run(), (error) => error.code === 'remote-missing');
  assert.equal(read(laptop, 'A.md'), 'a');
  assert.equal(read(laptop, 'B.md'), 'b');
});

test('deleting most of a vault at once waits for confirmation', async () => {
  const files = {};
  for (let i = 0; i < 20; i++) files[`Note ${i}.md`] = `contenu ${i}`;
  const { desk, laptop, deskSync, laptopSync } = await pair(files);
  for (let i = 0; i < 15; i++) desk.remove(`Note ${i}.md`);
  await assert.rejects(deskSync.run(), (error) => error.code === 'mass-delete');
  await laptopSync.run();
  assert.equal(read(laptop, 'Note 3.md'), 'contenu 3', 'nothing left Drive meanwhile');
  await deskSync.run({ force: true });
  // The other computer asks too before applying them.
  await assert.rejects(laptopSync.run(), (error) => error.code === 'mass-delete');
  await laptopSync.run({ force: true });
  assert.equal(exists(laptop, 'Note 3.md'), false);
  assert.equal(read(laptop, 'Note 17.md'), 'contenu 17');
});
