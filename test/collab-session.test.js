'use strict';
// Several computers on a simulated network: links can be cut, messages are
// delivered late, out of order or twice; a clock is advanced by hand.
const test = require('node:test');
const assert = require('node:assert/strict');
const Crdt = require('../shared/collab-crdt.js');
const { Session } = require('../shared/collab-session.js');

function fakeClock() {
  let now = 1000; let next = 1; const timers = new Map();
  return {
    now: () => now,
    set: (fn, ms) => { const id = next++; timers.set(id, { fn, at: now + ms }); return id; },
    clear: (id) => timers.delete(id),
    every: (fn, ms) => { const id = next++; timers.set(id, { fn, at: now + ms, every: ms }); return id; },
    stop: (id) => timers.delete(id),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await settle();
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        now = Math.max(now, timer.at);
        if (timer.every) timer.at += timer.every; else timers.delete(id);
        timer.fn();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}
async function settle() { for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve)); }

// Network: the order of delivery is shuffled and some messages repeated.
function network(clock) {
  const nodes = new Map(); const links = new Set();
  const key = (a, b) => [a, b].sort().join('|');
  let seed = 5; const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const net = {
    nodes,
    transport(id) {
      return {
        send(to, message) {
          if (!links.has(key(id, to))) return;
          const copy = JSON.parse(JSON.stringify(message));
          const deliver = () => { const node = nodes.get(to); if (node && links.has(key(id, to))) node.session.message(id, copy); };
          clock.set(deliver, 5 + Math.floor(rand() * 40));
          if (rand() < 0.15) clock.set(deliver, 50 + Math.floor(rand() * 40));
        },
        close(to) { net.cut(id, to); },
      };
    },
    link(a, b) {
      if (links.has(key(a, b))) return;
      links.add(key(a, b));
      const na = nodes.get(a); const nb = nodes.get(b);
      na.session.peerOpen({ id: b, role: nb.role }); nb.session.peerOpen({ id: a, role: na.role });
    },
    cut(a, b) {
      if (!links.delete(key(a, b))) return;
      const na = nodes.get(a); const nb = nodes.get(b);
      if (na) na.session.peerClosed(b); if (nb) nb.session.peerClosed(a);
    },
  };
  return net;
}

// The local store of one computer: all changes it has kept.
function memoryStore(id, coordinated) {
  const log = new Map();
  return {
    log,
    async persist(changes) { const out = []; for (const change of changes) { const k = `${change.a}:${change.s}`; if (!log.has(k)) log.set(k, { ...change, sig: 'ok' }); out.push(log.get(k)); } return out; },
    async since(vv) { return { changes: [...log.values()].filter((change) => (vv[change.a] || 0) < change.s).sort((a, b) => a.l - b.l) }; },
    async acceptState() {},
    async coordinate(info) { coordinated.push({ by: id, ...info }); },
  };
}

function computer(net, clock, id, role = 'editor', coordinated = []) {
  const replica = new Crdt.Replica(id);
  const store = memoryStore(id, coordinated);
  const session = new Session({ replica, me: { id, role }, store, transport: net.transport(id), clock });
  const node = { id, role, replica, store, session };
  net.nodes.set(id, node);
  return node;
}
const type = (node, text) => node.session.commit(Crdt.textOps(node.replica, 'T:n', text), { scope: 'n', merge: true });
const textOf = (node) => node.replica.textOf('T:n');

test('three computers edit together and converge', async () => {
  const clock = fakeClock(); const net = network(clock);
  const [a, b, c] = ['aaaa', 'bbbb', 'cccc'].map((id) => computer(net, clock, id));
  net.link('aaaa', 'bbbb'); net.link('bbbb', 'cccc'); net.link('aaaa', 'cccc');
  type(a, 'Bonjour');
  await clock.advance(300);
  type(b, `${textOf(b)} à tous`);
  type(c, `Oui. ${textOf(c)}`);
  await clock.advance(500);
  assert.equal(textOf(a), textOf(b)); assert.equal(textOf(b), textOf(c));
  assert.ok(textOf(a).includes('à tous') && textOf(a).startsWith('Oui.'), textOf(a));
  await clock.advance(2500);
  assert.equal(a.session.status().upToDate, true);
  assert.equal(a.session.coordinator, 'aaaa');
});

test('a computer connected through another one still receives everything', async () => {
  const clock = fakeClock(); const net = network(clock);
  const [a, , c] = ['aaaa', 'bbbb', 'cccc'].map((id) => computer(net, clock, id));
  net.link('aaaa', 'bbbb'); net.link('bbbb', 'cccc');
  await clock.advance(2100);
  type(a, 'relais');
  await clock.advance(400);
  assert.equal(textOf(c), 'relais');
  a.session.setPresence({ doc: 'n', cursor: 3 });
  await clock.advance(200);
  assert.equal(c.session.presence.get('aaaa').cursor, 3);
});

test('the coordinator leaves: another computer takes over', async () => {
  const clock = fakeClock(); const net = network(clock); const coordinated = [];
  const [a, b, c] = ['aaaa', 'bbbb', 'cccc'].map((id) => computer(net, clock, id, 'editor', coordinated));
  net.link('aaaa', 'bbbb'); net.link('bbbb', 'cccc'); net.link('aaaa', 'cccc');
  await clock.advance(16000);
  assert.ok(coordinated.every((call) => call.by === 'aaaa') && coordinated.length > 0);
  // A disappears without a word (crash): links stay "up" but nothing comes.
  a.session.close();
  net.nodes.delete('aaaa');
  coordinated.length = 0;
  await clock.advance(30000);
  assert.equal(b.session.coordinator, 'bbbb'); assert.equal(c.session.coordinator, 'bbbb');
  assert.ok(coordinated.length > 0 && coordinated.every((call) => call.by === 'bbbb'));
  assert.deepEqual(coordinated[coordinated.length - 1].connected, ['cccc']);
});

test('two groups cut apart keep working and merge when they meet again', async () => {
  const clock = fakeClock(); const net = network(clock);
  const [a, b, c, d] = ['aaaa', 'bbbb', 'cccc', 'dddd'].map((id) => computer(net, clock, id));
  const ids = ['aaaa', 'bbbb', 'cccc', 'dddd'];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) net.link(ids[i], ids[j]);
  type(a, 'Plan : lundi mardi');
  await clock.advance(500);
  net.cut('aaaa', 'cccc'); net.cut('aaaa', 'dddd'); net.cut('bbbb', 'cccc'); net.cut('bbbb', 'dddd');
  type(a, textOf(a).replace('lundi', 'lundi (réunion)'));
  type(c, textOf(c).replace('mardi', 'mardi (bilan)'));
  type(d, `${textOf(d)} mercredi`);
  await clock.advance(1000);
  assert.equal(c.session.coordinator, 'cccc');
  assert.equal(a.session.coordinator, 'aaaa');
  assert.notEqual(textOf(a), textOf(c));
  net.link('aaaa', 'cccc'); net.link('bbbb', 'dddd');
  await clock.advance(3000);
  const all = [a, b, c, d].map(textOf);
  assert.equal(new Set(all).size, 1, all.join(' | '));
  for (const part of ['(réunion)', '(bilan)', 'mercredi']) assert.ok(all[0].includes(part), all[0]);
});

test('undo in a session leaves the others’ edits alone', async () => {
  const clock = fakeClock(); const net = network(clock);
  const [a, b] = ['aaaa', 'bbbb'].map((id) => computer(net, clock, id));
  net.link('aaaa', 'bbbb');
  type(a, 'texte');
  await clock.advance(300); a.session.seal('n');
  type(b, `${textOf(b)} de B`);
  await clock.advance(300);
  type(a, `A: ${textOf(a)}`);
  await clock.advance(300);
  a.session.undo('n');
  await clock.advance(300);
  assert.equal(textOf(a), 'texte de B'); assert.equal(textOf(b), 'texte de B');
  a.session.redo('n');
  await clock.advance(300);
  assert.equal(textOf(b), 'A: texte de B');
});

test('a reader cannot change the project', () => {
  const clock = fakeClock(); const net = network(clock);
  const reader = computer(net, clock, 'rrrr', 'reader');
  assert.throws(() => type(reader, 'x'), /lecture seule/);
});

test('a computer that was off catches up from a peer', async () => {
  const clock = fakeClock(); const net = network(clock);
  const [a, b] = ['aaaa', 'bbbb'].map((id) => computer(net, clock, id));
  for (let i = 0; i < 25; i++) type(a, `${textOf(a)}${i % 10}`);
  await clock.advance(200);
  net.link('aaaa', 'bbbb');
  await clock.advance(800);
  assert.equal(textOf(b), textOf(a));
  assert.equal(b.store.log.size, a.store.log.size);
});
