'use strict';
// Shared projects, server side: several "computers" (each its own data
// folder and Google account) on one simulated Drive.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.OPALE_KEY_PROTECTION = 'none';
const Crdt = require('../shared/collab-crdt.js');
const { CollabService } = require('../lib/collab/service.js');
const { FakeDrive } = require('../lib/collab/drive.js');

function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-collab-'));
  const driveDir = path.join(root, 'drive');
  const computers = [];
  const computer = (name, email) => {
    const account = { connected: true, email, info: () => ({ connected: true, email, sharedScope: true }) };
    const service = new CollabService({ account, drive: new FakeDrive(driveDir, email), home: path.join(root, name) });
    const events = [];
    service.on('event', (event) => events.push(event));
    computers.push(service);
    return { service, events, email };
  };
  const done = () => { for (const c of computers) c.closeAll(); fs.rmSync(root, { recursive: true, force: true }); };
  return { computer, done, driveDir };
}

// Make a change the way the interface does: build it on a replica, then persist.
async function edit(runtime, token, mutate) {
  const replica = Crdt.Replica.fromState(runtime.me, runtime.replica.toState());
  const result = replica.local(mutate(replica));
  return runtime.persist([result.change], { local: true, token });
}
const noteOf = (runtime) => Crdt.listFiles(runtime.replica).find((file) => file.kind === 'note');

test('shared attachments reach another member and respect project permissions', async () => {
  const w = world();
  try {
    const alice = w.computer('alice', 'alice@example.test');
    const bob = w.computer('bob', 'bob@example.test');
    const pid = (await alice.service.create('Pièces jointes')).projectId;
    const ra = alice.service.runtime(pid); ra.start();
    const invite = await ra.invite('bob@example.test', 'editor');
    await bob.service.join({ code: invite.code });
    const rb = bob.service.runtime(pid); rb.start(); await rb.poll();
    const content = Buffer.from([0, 255, 20, 43, 19]);
    const sharedPath = await ra.putAttachment('image test.png', content);
    const id = sharedPath.split('/')[3];
    assert.deepEqual(fs.readFileSync(await rb.getAttachment(id)), content);
    const note = noteOf(ra).id;
    await edit(ra, ra.token, r => Crdt.textOps(r, Crdt.K.note(note), `![[assets/${id}/image test.png]]`));
    const exported = path.join(ra.store.dir, 'export-test');
    const result = await ra.exportCopy(exported);
    assert.equal(result.attachments, 1);
    assert.deepEqual(fs.readFileSync(path.join(exported, 'assets', id, 'image test.png')), content);
    // The local cache is available on a temporary Drive outage.
    fs.writeFileSync(path.join(w.driveDir, 'offline-bob@example.test'), '');
    assert.deepEqual(fs.readFileSync(await rb.getAttachment(id)), content);
    await assert.rejects(rb.putAttachment('offline.txt', content));
    fs.rmSync(path.join(w.driveDir, 'offline-bob@example.test'));
    await ra.setRole('bob@example.test', 'reader'); await rb.poll();
    await assert.rejects(rb.putAttachment('refused.txt', content), /lecture seule/);
    const other = (await alice.service.create('Autre projet')).projectId;
    const otherRuntime = alice.service.runtime(other); otherRuntime.start();
    await assert.rejects(otherRuntime.getAttachment(id), /introuvable/);
    await assert.rejects(rb.getAttachment('../../local.json'), /introuvable/);
  } finally { w.done(); }
});

test('create, invite, join, edit, and access limited to members', async () => {
  const w = world();
  try {
    const alice = w.computer('alice', 'alice@example.test');
    const bob = w.computer('bob', 'bob@example.test');
    const carol = w.computer('carol', 'carol@example.test');
    const created = await alice.service.create('Atelier');
    const pid = created.projectId;
    const ra = alice.service.runtime(pid);
    const tokenA = ra.start();
    await ra.upload();

    // Not invited: neither discovery nor the code works.
    assert.deepEqual(await bob.service.discover(), []);
    const code = ra.members().code;
    await assert.rejects(bob.service.join({ code }), /n’a pas accès/);

    const invited = await ra.invite('bob@example.test', 'editor');
    assert.equal(invited.code, code);
    const found = await bob.service.discover();
    assert.equal(found.length, 1); assert.equal(found[0].name, 'Atelier');
    await bob.service.join({ code });
    const rb = bob.service.runtime(pid);
    const tokenB = rb.start();
    await rb.poll();
    assert.equal(rb.replica.textOf(Crdt.K.note(noteOf(rb).id)).startsWith('# Atelier'), true);
    assert.equal(rb.role(), 'editor');

    // Bob edits; Alice receives it from Drive.
    const note = noteOf(rb).id;
    await edit(rb, tokenB, (r) => Crdt.textOps(r, Crdt.K.note(note), `${r.textOf(Crdt.K.note(note))}Bob était là.\n`));
    await rb.upload();
    await ra.poll();
    assert.ok(ra.replica.textOf(Crdt.K.note(note)).includes('Bob était là.'));
    assert.ok(alice.events.some((event) => event.type === 'changes'));

    // Carol, not a member, cannot read the project folder.
    await assert.rejects(carol.service.join({ code }), /n’a pas accès/);

    // Peer handshake: Bob proves his key to Alice.
    const helloA = ra.hello(); const helloB = rb.hello();
    const proofB = rb.proof({ peer: ra.me, peerNonce: helloA.nonce, localFp: 'FB', remoteFp: 'FA' });
    const verdict = await ra.verifyPeer({ hello: helloB, proof: proofB, nonce: helloA.nonce, localFp: 'FA', remoteFp: 'FB' });
    assert.equal(verdict.ok, true); assert.equal(verdict.member.email, 'bob@example.test');
    // Replaying the proof fails (one-time nonce), as does a swapped fingerprint.
    assert.equal((await ra.verifyPeer({ hello: helloB, proof: proofB, nonce: helloA.nonce, localFp: 'FA', remoteFp: 'FB' })).ok, false);
    const helloA2 = ra.hello();
    assert.equal((await ra.verifyPeer({ hello: helloB, proof: rb.proof({ peer: ra.me, peerNonce: helloA2.nonce, localFp: 'FB', remoteFp: 'FX' }), nonce: helloA2.nonce, localFp: 'FA', remoteFp: 'FB' })).ok, false);

    // Readers cannot write.
    await ra.setRole('bob@example.test', 'reader');
    await rb.poll();
    assert.equal(rb.role(), 'reader');
    await assert.rejects(edit(rb, tokenB, (r) => Crdt.textOps(r, Crdt.K.note(note), 'x')), /lecture seule/);

    // Removal: Opale and Drive both refuse Bob from now on.
    await ra.setRole('bob@example.test', 'editor');
    const removed = await ra.remove('bob@example.test');
    assert.equal(removed.driveWarning, '');
    rb.accessCheckedAt = 0; // access is checked every 30 s
    await rb.poll();
    assert.equal(rb.drive.state, 'access');
    const helloA3 = ra.hello(); const helloB3 = rb.hello();
    const refused = await ra.verifyPeer({ hello: helloB3, proof: rb.proof({ peer: ra.me, peerNonce: helloA3.nonce, localFp: 'FB', remoteFp: 'FA' }), nonce: helloA3.nonce, localFp: 'FA', remoteFp: 'FB' });
    assert.equal(refused.ok, false); assert.equal(refused.reason, 'removed');
    // His local copy is still his (a removal cannot erase it), but changes he
    // sends himself are refused.
    const stale = rb.replica.local(Crdt.textOps(rb.replica, Crdt.K.note(note), 'tentative'));
    const signed = { ...stale.change, sig: rb.signer.sign(Crdt.signedText(stale.change)) };
    assert.deepEqual(await ra.acceptRemote([signed], { from: rb.me }), []);
    void tokenA;
  } finally { w.done(); }
});

test('the coordinator saves the changes of a computer that left, and a checkpoint lets newcomers start from Drive', async () => {
  const w = world();
  try {
    const alice = w.computer('alice', 'alice@example.test');
    const bob = w.computer('bob', 'bob@example.test');
    const pid = (await alice.service.create('Équipe')).projectId;
    const ra = alice.service.runtime(pid); const tokenA = ra.start();
    await ra.invite('bob@example.test', 'editor');
    await bob.service.join({ code: ra.members().code });
    const rb = bob.service.runtime(pid); const tokenB = rb.start();
    await ra.upload(); await rb.poll();
    const note = noteOf(rb).id;
    // Bob edits and Alice receives it over the network, then Bob's computer
    // goes off before sending anything to Drive.
    const signed = await edit(rb, tokenB, (r) => Crdt.textOps(r, Crdt.K.note(note), 'Seulement chez Bob et Alice'));
    clearTimeout(rb.timers.upload); rb.opened = false;
    await ra.acceptRemote(signed, { from: rb.me });
    ra.lastActivity.set(rb.me, Date.now() - 60000);
    const result = await ra.coordinate({ connected: [] });
    assert.deepEqual(result.relayed, [rb.me]);
    const cp = await ra.checkpoint();
    assert.ok(cp.at);
    // Everyone closed. Bob's computer comes back with an empty copy: it
    // starts again from Drive.
    rb.forget(false);
    const back = bob.service.runtime(pid); back.start();
    await back.poll();
    assert.equal(back.replica.textOf(Crdt.K.note(note)), 'Seulement chez Bob et Alice');
    void tokenA;
  } finally { w.done(); }
});

test('Drive outage and expired Google sign-in are reported, and changes wait', async () => {
  const w = world();
  try {
    const alice = w.computer('alice', 'alice@example.test');
    const pid = (await alice.service.create('Panne')).projectId;
    const ra = alice.service.runtime(pid); const token = ra.start();
    await ra.upload(); await ra.poll();
    fs.writeFileSync(path.join(w.driveDir, 'offline-alice@example.test'), '');
    const note = noteOf(ra).id;
    await edit(ra, token, (r) => Crdt.textOps(r, Crdt.K.note(note), 'pendant la panne'));
    await ra.upload();
    assert.equal(ra.drive.state, 'offline');
    assert.equal(ra.summary().drive.pending, 1);
    fs.rmSync(path.join(w.driveDir, 'offline-alice@example.test'));
    fs.writeFileSync(path.join(w.driveDir, 'auth-alice@example.test'), '');
    await ra.poll();
    assert.equal(ra.drive.state, 'auth');
    fs.rmSync(path.join(w.driveDir, 'auth-alice@example.test'));
    await ra.poll(); await ra.upload();
    assert.equal(ra.drive.state, 'ok');
    assert.equal(ra.summary().drive.pending, 0);
  } finally { w.done(); }
});

test('membership decisions need the right role and cannot be forged', async () => {
  const w = world();
  try {
    const alice = w.computer('alice', 'alice@example.test');
    const bob = w.computer('bob', 'bob@example.test');
    const pid = (await alice.service.create('Droits')).projectId;
    const ra = alice.service.runtime(pid); ra.start();
    await ra.invite('bob@example.test', 'editor');
    await bob.service.join({ code: ra.members().code });
    const rb = bob.service.runtime(pid); rb.start(); await rb.poll();
    await assert.rejects(rb.invite('mallory@example.test', 'admin'), /refusée/);
    await assert.rejects(rb.remove('alice@example.test'), /refusée/);
    // A device record written in someone else's name is not trusted: Bob
    // registers a key claiming to be Alice's second computer.
    const fake = require('../lib/collab/identity.js').generate();
    const { Signer } = require('../lib/collab/identity.js');
    const signer = new Signer(fake.publicKey, fake.privateDer);
    const record = signer.signObject({ v: 1, projectId: pid, deviceId: fake.deviceId, key: fake.publicKey, email: 'alice@example.test', name: 'faux', t: Date.now() });
    await bob.service.drive.createJson(rb.local.devicesFolder, `device-${fake.deviceId}.json`, { opaleProject: pid, opaleKind: 'device', opaleDevice: fake.deviceId }, record);
    await ra.refreshAcl(false);
    assert.equal(ra.acl.device(fake.deviceId), null);
    // Bob leaves; the owner cannot.
    await assert.rejects(ra.leave(), /propriétaire/);
    await rb.leave();
    await ra.refreshAcl(false);
    assert.equal(ra.acl.role('bob@example.test'), 'removed');
    assert.equal(bob.service.ids().length, 0);
  } finally { w.done(); }
});


test('staged attachments return locally while Drive is offline and resume after restart', async () => {
  const w = world();
  try {
    const alice = w.computer('stage-alice', 'alice@example.test');
    const bob = w.computer('stage-bob', 'bob@example.test');
    const pid = (await alice.service.create('Immédiat')).projectId;
    const ra = alice.service.runtime(pid); ra.start();
    const invite = await ra.invite('bob@example.test', 'editor');
    await bob.service.join({ code: invite.code });
    const rb = bob.service.runtime(pid); rb.start();
    fs.writeFileSync(path.join(w.driveDir, 'offline-alice@example.test'), '');
    const bytes = Buffer.from('Bonjour <script>aucune exécution</script>');
    const reference = await ra.stageAttachment('texte.txt', bytes);
    const id = reference.split('/')[3];
    assert.match(id, /^sha256-[a-f0-9]{64}$/);
    assert.deepEqual(fs.readFileSync(await ra.getAttachment(id)), bytes);
    await ra.flushAttachments();
    assert.equal(ra.pendingAttachments().length, 1);
    assert.ok(ra.summary().drive.pending >= 1);
    // A direct transfer needs no Drive access and is hash-verified.
    assert.throws(() => rb.cacheAttachment(id, Buffer.from('tampered')), /corrompue/);
    rb.cacheAttachment(id, bytes);
    assert.deepEqual(fs.readFileSync(await rb.getAttachment(id, { cacheOnly: true })), bytes);
    alice.service.closeAll();
    const restarted = w.computer('stage-alice', 'alice@example.test');
    const resumed = restarted.service.runtime(pid); resumed.load();
    assert.equal(resumed.pendingAttachments().length, 1);
    fs.rmSync(path.join(w.driveDir, 'offline-alice@example.test'));
    await resumed.flushAttachments();
    assert.equal(resumed.pendingAttachments().length, 0);
    const driveFiles = await resumed.api.list(pid);
    assert.equal(driveFiles.filter(f => f.props.opaleAsset === id).length, 1);
    // A different computer retrieves by the immutable address from Drive.
    fs.rmSync(path.join(rb.store.dir, 'attachments', id));
    assert.deepEqual(fs.readFileSync(await rb.getAttachment(id)), bytes);
    await resumed.setRole('bob@example.test', 'reader'); await rb.poll();
    await assert.rejects(rb.stageAttachment('forbidden.txt', bytes), /lecture seule/);
  } finally { w.done(); }
});

test('attachments staged during an active upload all drain without duplicate Drive objects', async () => {
  const w = world();
  try {
    const alice = w.computer('parallel', 'alice@example.test');
    const pid = (await alice.service.create('Uploads')).projectId;
    const runtime = alice.service.runtime(pid); runtime.load();
    const realCreate = runtime.api.createBinary.bind(runtime.api);
    let release, entered;
    const reached = new Promise(resolve => { entered = resolve; });
    const hold = new Promise(resolve => { release = resolve; });
    runtime.api.createBinary = async (...args) => { entered(); await hold; return realCreate(...args); };
    const first = await runtime.stageAttachment('un.txt', Buffer.from('one'));
    const upload = runtime.flushAttachments();
    await reached;
    const second = await runtime.stageAttachment('deux.txt', Buffer.from('two'));
    assert.notEqual(first, second);
    assert.equal(runtime.pendingAttachments().length, 2);
    release(); await upload;
    assert.equal(runtime.pendingAttachments().length, 0);
    assert.equal((await runtime.api.list(pid)).filter(f => f.props.opaleKind === 'attachment').length, 2);
  } finally { w.done(); }
});
