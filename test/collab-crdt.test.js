'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Crdt = require('../shared/collab-crdt.js');

const { Replica, K, textOps } = Crdt;

function shuffle(list, seed) {
  const out = list.slice(); let state = seed;
  for (let i = out.length - 1; i > 0; i--) { state = (state * 1103515245 + 12345) % 2147483648; const j = state % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function edit(replica, key, next) { const done = replica.local(textOps(replica, key, next)); return done && done.change; }

test('concurrent typing at the same place converges in any arrival order', () => {
  const a = new Replica('aaaa'); const b = new Replica('bbbb'); const c = new Replica('cccc');
  const base = edit(a, 'T:n', 'Bonjour le monde');
  b.receive([base]); c.receive([base]);
  const ca = edit(a, 'T:n', 'Bonjour tout le monde');
  const cb = edit(b, 'T:n', 'Bonjour le vaste monde');
  const cc = edit(c, 'T:n', 'Bonjour le monde !');
  a.receive([cb, cc]); b.receive([cc, ca]); c.receive([ca, cb]);
  for (let seed = 1; seed < 6; seed++) {
    const d = new Replica('dddd');
    d.receive(shuffle([base, ca, cb, cc], seed));
    assert.equal(d.textOf('T:n'), a.textOf('T:n'));
  }
  assert.equal(a.textOf('T:n'), b.textOf('T:n'));
  assert.equal(b.textOf('T:n'), c.textOf('T:n'));
  const text = a.textOf('T:n');
  for (const part of ['tout', 'vaste', '!']) assert.ok(text.includes(part), text);
});

test('changes wait for what they depend on, duplicates are ignored', () => {
  const a = new Replica('aaaa'); const b = new Replica('bbbb');
  const c1 = edit(a, 'T:n', 'abc');
  const c2 = edit(a, 'T:n', 'abcdef');
  b.receive([c2]);
  assert.equal(b.textOf('T:n'), '');
  assert.deepEqual(b.missing(), { aaaa: 1 });
  b.receive([c1, c1, c2]);
  assert.equal(b.textOf('T:n'), 'abcdef');
  assert.equal(b.pending.size, 0);
});

test('undo takes back only my own edit', () => {
  const a = new Replica('aaaa'); const b = new Replica('bbbb');
  const base = edit(a, 'T:n', 'un deux trois'); b.receive([base]);
  const mine = a.local(textOps(a, 'T:n', 'un deux trois quatre'));
  const theirs = edit(b, 'T:n', 'zéro un deux trois');
  a.receive([theirs]); b.receive([mine.change]);
  assert.equal(a.textOf('T:n'), 'zéro un deux trois quatre');
  const undo = a.local(a.inverse(mine.undo));
  b.receive([undo.change]);
  assert.equal(a.textOf('T:n'), 'zéro un deux trois');
  assert.equal(b.textOf('T:n'), 'zéro un deux trois');
  // Redo puts it back; my undo of a deletion does not resurrect theirs.
  a.local(a.inverse(undo.undo));
  assert.equal(a.textOf('T:n'), 'zéro un deux trois quatre');
  const del = a.local(textOps(a, 'T:n', 'zéro trois quatre'));
  const del2 = edit(b, 'T:n', 'zéro un trois');
  a.receive([del2]);
  a.local(a.inverse(del.undo));
  assert.ok(!a.textOf('T:n').includes('deux'), 'B deleted "deux" too: it stays deleted');
});

test('concurrent writes to one field are reported, never silently lost', () => {
  const a = new Replica('aaaa'); const b = new Replica('bbbb');
  const create = a.local([...Crdt.elementOps(a, 'f', 'e1', null, { kind: 'sticky', x: 0, y: 0, w: 100, h: 100, data: { text: 'Idée' }, style: {} })]).change;
  b.receive([create]);
  const moveA = a.local(Crdt.elementOps(a, 'f', 'e1', Crdt.boardElement(a, 'f', 'e1'), { ...Crdt.boardElement(a, 'f', 'e1'), x: 50 })).change;
  const moveB = b.local(Crdt.elementOps(b, 'f', 'e1', Crdt.boardElement(b, 'f', 'e1'), { ...Crdt.boardElement(b, 'f', 'e1'), x: 80 })).change;
  a.receive([moveB]); b.receive([moveA]);
  assert.equal(Crdt.boardElement(a, 'f', 'e1').x, Crdt.boardElement(b, 'f', 'e1').x);
  assert.equal(a.conflicts.length, 1);
  assert.equal(b.conflicts.length, 1);
  const kept = a.conflicts[0];
  assert.deepEqual([kept.win.v, kept.lose.v].sort(), [50, 80]);
});

test('a deletion during someone else’s edit keeps their edit for a restore', () => {
  const a = new Replica('aaaa'); const b = new Replica('bbbb');
  const create = a.local(Crdt.elementOps(a, 'f', 'e1', null, { kind: 'sticky', x: 0, y: 0, w: 100, h: 100, data: { text: 'Idée' }, style: {} })).change;
  b.receive([create]);
  const before = Crdt.boardElement(b, 'f', 'e1');
  const typed = b.local(Crdt.elementOps(b, 'f', 'e1', before, { ...before, data: { ...before.data, text: 'Idée précise' } })).change;
  const removed = a.local(Crdt.elementOps(a, 'f', 'e1', Crdt.boardElement(a, 'f', 'e1'), null));
  a.receive([typed]); b.receive([removed.change]);
  assert.equal(Crdt.boardElement(a, 'f', 'e1'), null);
  assert.equal(Crdt.boardElement(b, 'f', 'e1'), null);
  a.local(a.inverse(removed.undo));
  assert.equal(Crdt.boardElement(a, 'f', 'e1').data.text, 'Idée précise');
});

test('board texts merge characters typed in the same card', () => {
  const a = new Replica('aaaa'); const b = new Replica('bbbb');
  const create = a.local(Crdt.elementOps(a, 'f', 'e1', null, { kind: 'sticky', x: 0, y: 0, w: 1, h: 1, data: { text: 'liste' }, style: {} })).change;
  b.receive([create]);
  const ea = Crdt.boardElement(a, 'f', 'e1'); const eb = Crdt.boardElement(b, 'f', 'e1');
  const ca = a.local(Crdt.elementOps(a, 'f', 'e1', ea, { ...ea, data: { text: 'ma liste' } })).change;
  const cb = b.local(Crdt.elementOps(b, 'f', 'e1', eb, { ...eb, data: { text: 'liste courte' } })).change;
  a.receive([cb]); b.receive([ca]);
  assert.equal(Crdt.boardElement(a, 'f', 'e1').data.text, 'ma liste courte');
  assert.equal(Crdt.boardElement(b, 'f', 'e1').data.text, 'ma liste courte');
});

test('stacking order changes as few elements as possible', () => {
  const a = new Replica('aaaa');
  const doc = { elements: ['a', 'b', 'c', 'd'].map((id) => ({ id, kind: 'shape', x: 0, y: 0, w: 1, h: 1, data: {}, style: {} })), layers: [], settings: {}, vote: null };
  a.local(Crdt.boardDocOps(a, 'f', doc));
  assert.deepEqual(Crdt.boardIds(a, 'f'), ['a', 'b', 'c', 'd']);
  const ops = Crdt.orderOps(a, 'f', ['a', 'c', 'd', 'b']);
  assert.equal(ops.length, 1);
  a.local(ops);
  assert.deepEqual(Crdt.boardIds(a, 'f'), ['a', 'c', 'd', 'b']);
});

test('saved states merge in any order and keep accepting changes', () => {
  const a = new Replica('aaaa'); const b = new Replica('bbbb');
  const base = edit(a, 'T:n', 'abc'); b.receive([base]);
  a.local(Crdt.createFileOps(a, { id: 'n', name: 'Note', kind: 'note' }));
  edit(a, 'T:n', 'abcX');
  edit(b, 'T:n', 'Yabc');
  const merged = Replica.fromState('cccc', a.toState());
  merged.mergeState(b.toState());
  const other = Replica.fromState('dddd', b.toState());
  other.mergeState(a.toState());
  assert.equal(merged.textOf('T:n'), other.textOf('T:n'));
  assert.equal(merged.textOf('T:n'), 'YabcX');
  assert.deepEqual(merged.vv, { aaaa: 3, bbbb: 1 });
  const later = a.local(textOps(a, 'T:n', 'abcXZ')).change;
  merged.receive([later]);
  assert.ok(merged.textOf('T:n').endsWith('XZ'));
  // A deletion survives a state round trip.
  const c = Replica.fromState('eeee', merged.toState());
  c.local(textOps(c, 'T:n', 'YaXZ'));
  const d = Replica.fromState('ffff', c.toState());
  assert.equal(d.textOf('T:n'), 'YaXZ');
  assert.equal(Crdt.listFiles(d).length, 1);
});

test('the file tree survives concurrent moves and deleted folders', () => {
  const a = new Replica('aaaa'); const b = new Replica('bbbb');
  const c0 = a.local([...Crdt.createFileOps(a, { id: 'd1', name: 'Un', kind: 'folder' }), ...Crdt.createFileOps(a, { id: 'd2', name: 'Deux', kind: 'folder' })]).change;
  b.receive([c0]);
  const ma = a.local(Crdt.moveFileOps(a, 'd1', 'd2')).change;
  const mb = b.local(Crdt.moveFileOps(b, 'd2', 'd1')).change;
  a.receive([mb]); b.receive([ma]);
  const paths = (r) => Crdt.listFiles(r).map((f) => f.path).sort();
  assert.deepEqual(paths(a), paths(b));
  assert.equal(paths(a).length, 2);
  // A note created in a folder deleted at the same time stays visible.
  const note = a.local(Crdt.createFileOps(a, { id: 'n1', name: 'Plan', parent: 'd1', kind: 'note', text: 'x' })).change;
  const gone = b.local(Crdt.deleteFileOps(b, 'd1')).change;
  a.receive([gone]); b.receive([note]);
  assert.ok(Crdt.listFiles(a).some((f) => f.id === 'n1'));
  assert.deepEqual(paths(a), paths(b));
  // Two notes with one name are both shown.
  const x = a.local(Crdt.createFileOps(a, { id: 'x', name: 'Idée', kind: 'note' })).change;
  const y = b.local(Crdt.createFileOps(b, { id: 'y', name: 'Idée', kind: 'note' })).change;
  a.receive([y]); b.receive([x]);
  assert.deepEqual(Crdt.listFiles(a).filter((f) => f.name === 'Idée').map((f) => f.display).sort(), ['Idée', 'Idée (2)']);
});

test('random concurrent editing converges (fuzz)', () => {
  const actors = ['aaaa', 'bbbb', 'cccc'];
  const replicas = actors.map((actor) => new Replica(actor));
  const all = [];
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let round = 0; round < 40; round++) {
    const made = [];
    for (const replica of replicas) {
      const text = replica.textOf('T:n');
      const at = rand(text.length + 1);
      const next = rand(3) === 0 && text.length ? text.slice(0, at) + text.slice(at + 1 + rand(3)) : text.slice(0, at) + 'xyz'[rand(3)] + text.slice(at);
      const change = edit(replica, 'T:n', next);
      if (change) made.push(change);
    }
    all.push(...made);
    // Each replica hears a random part of what happened, in random order.
    for (const replica of replicas) replica.receive(shuffle(all.filter(() => rand(2) === 0), rand(1000) + 1));
  }
  for (const replica of replicas) replica.receive(shuffle(all, 3));
  const texts = replicas.map((replica) => replica.textOf('T:n'));
  assert.equal(new Set(texts).size, 1, texts.join(' | '));
  const fresh = new Replica('zzzz'); fresh.receive(shuffle(all, 11));
  assert.equal(fresh.textOf('T:n'), texts[0]);
});
