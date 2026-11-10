'use strict';

// Shared projects: the copy kept on this computer, in
// %APPDATA%\Opale\projects\<project id>\
//   local.json    this computer's membership: Drive folder, account, role
//   key.json      the project key of this computer (private part protected)
//   acl.json      membership records seen so far (never forgotten)
//   state.json    a compacted state of the project
//   changes.log   every change since, one JSON per line, flushed to disk
//   drive.json    what is known to be in Drive
// Nothing here gives access by itself: the key is checked by the other
// members against the membership records, and Drive checks its own rights.
const fs = require('fs');
const path = require('path');
const appdata = require('../appdata.js');
const Crdt = require('../../shared/collab-crdt.js');
const identity = require('./identity.js');

const COMPACT_AT = 3000;

class ProjectStore {
  constructor(dir) {
    this.dir = dir;
    this.files = {
      local: path.join(dir, 'local.json'), key: path.join(dir, 'key.json'), acl: path.join(dir, 'acl.json'),
      state: path.join(dir, 'state.json'), log: path.join(dir, 'changes.log'), drive: path.join(dir, 'drive.json'),
    };
    this.changes = new Map();
    this.replica = null;
    this.fd = null;
    this._signer = null;
  }

  exists() { return fs.existsSync(this.files.local); }
  readLocal() { return appdata.readJson(this.files.local, null); }
  writeLocal(local) { appdata.writeJson(this.files.local, local); }

  // ------------------------------------------------------------------ key
  createKey(generated) {
    const key = generated || identity.generate();
    appdata.writeJson(this.files.key, { v: 1, publicKey: key.publicKey, deviceId: key.deviceId, private: identity.seal(key.privateDer), created: Date.now() });
    this._signer = new identity.Signer(key.publicKey, key.privateDer);
    return this._signer;
  }
  signer() {
    if (this._signer) return this._signer;
    const saved = appdata.readJson(this.files.key, null);
    if (!saved) throw new Error('La clé de cet ordinateur pour ce projet est absente.');
    this._signer = new identity.Signer(saved.publicKey, identity.unseal(saved.private));
    return this._signer;
  }
  publicKey() { const saved = appdata.readJson(this.files.key, null); return saved ? { publicKey: saved.publicKey, deviceId: saved.deviceId } : null; }

  // ------------------------------------------------------------------ acl
  readAcl() { return appdata.readJson(this.files.acl, null) || { genesis: null, entries: [], devices: [] }; }
  writeAcl(acl) { appdata.writeJson(this.files.acl, acl); }

  readDrive() { return appdata.readJson(this.files.drive, null) || { driveVV: {}, seen: {}, lastPoll: 0, snapshots: [], uploaded: [], lastCheckpoint: 0, sinceCheckpoint: 0 }; }
  writeDrive(state) { appdata.writeJson(this.files.drive, state); }

  // -------------------------------------------------------------- changes
  load(actor) {
    const saved = appdata.readJson(this.files.state, null);
    this.replica = Crdt.Replica.fromState(actor, saved && saved.state);
    this.changes.clear();
    let text = '';
    try { text = fs.readFileSync(this.files.log, 'utf8'); } catch {}
    const list = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { list.push(JSON.parse(line)); } catch { /* a line cut by a crash */ }
    }
    for (const change of list) this.changes.set(`${change.a}:${change.s}`, change);
    this.replica.receive(list);
    return this.replica;
  }

  append(changes) {
    if (!changes.length) return;
    if (this.fd === null) { fs.mkdirSync(this.dir, { recursive: true }); this.fd = fs.openSync(this.files.log, 'a'); }
    fs.writeSync(this.fd, changes.map((change) => JSON.stringify(change)).join('\n') + '\n');
    try { fs.fdatasyncSync(this.fd); } catch {}
    for (const change of changes) this.changes.set(`${change.a}:${change.s}`, change);
  }

  // What a computer that has `vv` lacks: changes, or the whole state when
  // some of them were compacted away.
  since(vv) {
    const out = [];
    for (const [actor, seq] of Object.entries(this.replica.vv)) {
      const from = (vv[actor] || 0) + 1;
      for (let s = from; s <= seq; s++) {
        const change = this.changes.get(`${actor}:${s}`);
        if (!change) return { state: this.replica.toState() };
        out.push(change);
      }
    }
    return { changes: out.sort((a, b) => a.l - b.l || (a.a < b.a ? -1 : 1)) };
  }

  // Keep the log short: what Drive already has is folded into state.json.
  compact(driveVV, force = false) {
    if (!force && this.changes.size < COMPACT_AT) return false;
    appdata.writeJson(this.files.state, { v: 1, state: this.replica.toState(), at: Date.now() });
    const keep = [...this.changes.values()].filter((change) => (driveVV[change.a] || 0) < change.s);
    this.close();
    const temp = `${this.files.log}.tmp`;
    fs.writeFileSync(temp, keep.map((change) => JSON.stringify(change)).join('\n') + (keep.length ? '\n' : ''));
    fs.renameSync(temp, this.files.log);
    this.changes = new Map(keep.map((change) => [`${change.a}:${change.s}`, change]));
    return true;
  }
  saveState() { appdata.writeJson(this.files.state, { v: 1, state: this.replica.toState(), at: Date.now() }); }

  close() { if (this.fd !== null) { try { fs.closeSync(this.fd); } catch {} this.fd = null; } }

  // The local copy goes; the membership (local.json, key.json) stays.
  dropData() {
    this.close();
    for (const name of ['state', 'log', 'drive']) fs.rmSync(this.files[name], { force: true });
    this.changes.clear(); this.replica = null;
  }
  destroy() { this.close(); fs.rmSync(this.dir, { recursive: true, force: true }); }
}

module.exports = { ProjectStore };
