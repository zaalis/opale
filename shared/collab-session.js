// Opale — shared projects: one open project on one computer, talking to the
// other computers that have it open. Independent of the network underneath
// (WebRTC in the application, an in-memory network in the tests).
//
//   transport  send(peer, message), close(peer); calls session.peerOpen(info),
//              session.peerClosed(id) and session.message(id, message) once a
//              peer is authenticated.
//   store      persist(changes, { local, from }) → the changes accepted
//              (signed when local), since(vv) → { changes } or { state },
//              acceptState(state, from), coordinate({ connected }) (only
//              called on the coordinator).
//
// Messages between computers:
//   hi / hb   who I am connected to, what I have (version vector), who I
//             think coordinates; sent on connection and every two seconds
//   ch        changes; relayed to those not connected to their author
//   st        a full state, when a computer is too far behind for changes
//   p         presence (cursor, selection, gesture…), never stored
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./collab-crdt.js'));
  else root.OpaleCollabSession = factory(root.OpaleCrdt);
})(typeof self !== 'undefined' ? self : this, function (Crdt) {
  'use strict';
  const { VV } = Crdt;

  const HEARTBEAT = 2000;
  const PEER_TIMEOUT = 9000;
  const COORDINATE_EVERY = 15000;
  const RESYNC_GAP = 2500;

  class Emitter {
    constructor() { this._handlers = new Map(); }
    on(name, fn) { if (!this._handlers.has(name)) this._handlers.set(name, new Set()); this._handlers.get(name).add(fn); return () => this._handlers.get(name).delete(fn); }
    emit(name, ...args) { for (const fn of [...(this._handlers.get(name) || [])]) { try { fn(...args); } catch (error) { if (typeof console !== 'undefined') console.error(error); } } }
  }

  class Session extends Emitter {
    constructor({ replica, me, store, transport, clock }) {
      super();
      this.replica = replica; this.me = me; this.store = store; this.transport = transport;
      this.clock = clock || { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id), every: (fn, ms) => setInterval(fn, ms), stop: (id) => clearInterval(id) };
      this.peers = new Map();
      this.queue = []; this.persisting = null; this.chain = Promise.resolve();
      this.localError = ''; this.unsavedLocal = 0;
      this.undoStacks = new Map();
      this.presence = new Map();
      this.coordinator = me.role === 'reader' ? '' : me.id;
      this.lastCoordinate = 0;
      this.closed = false;
      this.timer = this.clock.every(() => this.tick(), HEARTBEAT);
    }

    get readOnly() { return this.me.role === 'reader'; }
    connected() { return [...this.peers.values()].filter((peer) => peer.open); }

    // ------------------------------------------------------------ editing
    // A change made here: applied at once, saved on this computer, then sent.
    commit(ops, options = {}) {
      if (this.closed) throw new Error('Projet fermé.');
      if (this.readOnly) throw Object.assign(new Error('Vous avez un accès en lecture seule à ce projet.'), { code: 'read-only' });
      const result = this.replica.local(ops);
      if (!result) return null;
      if (options.scope && !options.noUndo) this.stack(options.scope).push(result.undo, !!options.merge);
      this.queue.push(result.change);
      this.unsavedLocal++;
      this.flush();
      return result.change;
    }
    stack(scope) { let stack = this.undoStacks.get(scope); if (!stack) { stack = new Crdt.UndoStack(); this.undoStacks.set(scope, stack); } return stack; }
    seal(scope) { if (this.undoStacks.has(scope)) this.undoStacks.get(scope).seal(); }

    // Undo this participant's last step in `scope`. Steps entirely overtaken
    // by other people's later edits are skipped.
    undo(scope) { return this._travel(scope, 'undo', 'redo'); }
    redo(scope) { return this._travel(scope, 'redo', 'undo'); }
    _travel(scope, from, to) {
      const stack = this.stack(scope);
      while (stack[from].length) {
        const step = stack[from].pop();
        const ops = this.replica.inverse(step.entries);
        if (!ops.length) continue;
        const result = this.replica.local(ops);
        stack[to].push({ entries: result.undo, merge: false });
        this.queue.push(result.change); this.unsavedLocal++;
        this.flush();
        return result.change;
      }
      return null;
    }

    flush() {
      if (this.persisting || !this.queue.length || this.closed) return this.persisting || Promise.resolve();
      const batch = this.queue.splice(0, this.queue.length);
      this.persisting = this._serial(() => this.store.persist(batch, { local: true }))
        .then((signed) => {
          this.localError = '';
          this.unsavedLocal = Math.max(0, this.unsavedLocal - batch.length);
          this.broadcast({ t: 'ch', c: signed });
          for (const peer of this.connected()) peer.vv = peer.vv || {};
          this.emit('status');
        })
        .catch((error) => {
          // Not saved: keep the changes first in line and retry.
          this.queue.unshift(...batch);
          this.localError = error && error.message ? error.message : String(error);
          this.emit('status');
          return new Promise((resolve) => this.clock.set(resolve, 1500));
        })
        .finally(() => { this.persisting = null; if (this.queue.length && !this.closed) this.flush(); });
      return this.persisting;
    }
    _serial(task) { const run = this.chain.then(task, task); this.chain = run.catch(() => {}); return run; }

    // --------------------------------------------------------------- peers
    peerOpen(info) {
      const existing = this.peers.get(info.id);
      const peer = existing || { id: info.id, vv: {}, links: [], lastSeen: 0, lastSync: 0, coord: '' };
      Object.assign(peer, { info, open: true, lastSeen: this.clock.now(), lastSync: 0 });
      this.peers.set(info.id, peer);
      this.send(peer.id, this.hello('hi'));
      // A newcomer sees at once where this person is.
      if (this.ownPresence) this.send(peer.id, { t: 'p', o: this.me.id, d: this.ownPresence });
      this.elect();
      this.emit('peers');
      this.emit('status');
    }
    peerClosed(id) {
      const peer = this.peers.get(id);
      if (!peer) return;
      peer.open = false;
      this.presence.delete(id);
      this.elect();
      this.emit('presence', id, null);
      this.emit('peers');
      this.emit('status');
    }
    hello(type) {
      return { t: type, vv: { ...this.replica.vv }, links: this.connected().map((peer) => peer.id), coord: this.coordinator, at: this.clock.now() };
    }
    send(id, message) { try { this.transport.send(id, message); } catch {} }
    broadcast(message, except) { for (const peer of this.connected()) if (peer.id !== except) this.send(peer.id, message); }

    async message(id, message) {
      const peer = this.peers.get(id);
      if (!peer || !peer.open || this.closed || !message || typeof message !== 'object') return;
      peer.lastSeen = this.clock.now();
      switch (message.t) {
        case 'hi': case 'hb':
          if (message.vv && typeof message.vv === 'object') peer.vv = VV.max(peer.vv || {}, message.vv);
          peer.links = Array.isArray(message.links) ? message.links.slice(0, 200) : [];
          peer.coord = String(message.coord || '');
          this.sendMissing(peer, message.t === 'hi');
          this.emit('status');
          break;
        case 'ch': await this.receiveChanges(peer, Array.isArray(message.c) ? message.c : []); break;
        case 'st': await this.receiveState(peer, message.state); break;
        case 'p': this.receivePresence(peer, message); break;
        default:
      }
    }

    // Send a peer what it lacks, as changes (or a state when they are gone).
    async sendMissing(peer, force) {
      if (VV.covers(peer.vv || {}, this.replica.vv)) return;
      const now = this.clock.now();
      if (!force && now - peer.lastSync < RESYNC_GAP) return;
      peer.lastSync = now;
      let answer;
      try { answer = await this.store.since(peer.vv || {}); } catch { return; }
      if (!peer.open) return;
      if (answer.state) this.send(peer.id, { t: 'st', state: answer.state });
      else if (answer.changes && answer.changes.length) this.send(peer.id, { t: 'ch', c: answer.changes });
    }

    async receiveChanges(peer, list) {
      const fresh = list.filter((change) => change && typeof change === 'object' && !this.replica.has(change) && !this.replica.pending.has(`${change.a}:${change.s}`));
      for (const change of list) if (change && change.a) peer.vv[change.a] = Math.max(peer.vv[change.a] || 0, Number(change.s) || 0);
      if (!fresh.length) return;
      let accepted;
      try { accepted = await this._serial(() => this.store.persist(fresh, { local: false, from: peer.id })); }
      catch (error) { this.emit('error', error); return; }
      const applied = this.replica.receive(accepted);
      if (applied.length) {
        // Relay to computers that are not connected to the author.
        for (const other of this.connected()) {
          if (other.id === peer.id) continue;
          const wanted = applied.filter((change) => change.a !== other.id && !other.links.includes(change.a) && (other.vv[change.a] || 0) < change.s);
          if (wanted.length) this.send(other.id, { t: 'ch', c: wanted });
        }
        this.emit('remote', applied);
      }
      if (this.replica.pending.size) { peer.lastSync = 0; this.send(peer.id, this.hello('hb')); }
      this.emit('status');
    }

    async receiveState(peer, state) {
      if (!state || typeof state !== 'object' || (peer.info && peer.info.role === 'reader')) return;
      try { await this._serial(() => this.store.acceptState(state, peer.id)); } catch (error) { this.emit('error', error); return; }
      this.replica.mergeState(state);
      this.emit('remote', []);
      this.emit('status');
    }

    // ------------------------------------------------------------ presence
    // `data` is whatever the views need (cursor, selection, gesture, viewport).
    setPresence(data) {
      this.ownPresence = { ...data, at: this.clock.now() };
      this.broadcast({ t: 'p', o: this.me.id, d: this.ownPresence });
    }
    receivePresence(peer, message) {
      const origin = String(message.o || peer.id);
      if (origin === this.me.id || !message.d || typeof message.d !== 'object') return;
      // Relay once to those who cannot hear the origin directly.
      if (origin === peer.id) for (const other of this.connected()) if (other.id !== peer.id && !other.links.includes(origin)) this.send(other.id, { t: 'p', o: origin, d: message.d });
      const info = origin === peer.id ? peer.info : (this.peers.get(origin) || {}).info;
      this.presence.set(origin, { ...message.d, id: origin, info: info || { id: origin }, seen: this.clock.now() });
      this.emit('presence', origin, this.presence.get(origin));
    }

    // ---------------------------------------------------------- the clock
    // The coordinator writes to Drive: only computers allowed to edit qualify.
    elect() {
      const able = (role) => role !== 'reader';
      const ids = [...(able(this.me.role) ? [this.me.id] : []), ...this.connected().filter((peer) => able(peer.info && peer.info.role)).map((peer) => peer.id)].sort();
      const next = ids[0] || '';
      if (next !== this.coordinator) { this.coordinator = next; this.lastCoordinate = 0; this.emit('coordinator', next); }
      return next;
    }
    get isCoordinator() { return this.coordinator === this.me.id; }

    tick() {
      if (this.closed) return;
      const now = this.clock.now();
      for (const peer of this.connected()) {
        if (now - peer.lastSeen > PEER_TIMEOUT) { try { this.transport.close(peer.id); } catch {} this.peerClosed(peer.id); continue; }
        this.send(peer.id, this.hello('hb'));
      }
      for (const [id, entry] of this.presence) if (now - entry.seen > PEER_TIMEOUT && !(this.peers.get(id) || {}).open) { this.presence.delete(id); this.emit('presence', id, null); }
      this.elect();
      if (this.isCoordinator && now - this.lastCoordinate >= COORDINATE_EVERY) {
        this.lastCoordinate = now;
        Promise.resolve(this.store.coordinate({ connected: this.connected().map((peer) => peer.id) })).catch(() => {});
      }
    }

    // What the interface shows next to the project.
    status() {
      const peers = this.connected();
      const mine = { [this.me.id]: this.replica.vv[this.me.id] || 0 };
      const behind = peers.filter((peer) => !VV.covers(peer.vv || {}, this.replica.vv));
      return {
        localPending: this.queue.length + (this.persisting ? 1 : 0), localError: this.localError,
        peers: peers.length, peersBehind: behind.length,
        peersHaveMine: peers.length > 0 && peers.every((peer) => VV.covers(peer.vv || {}, mine)),
        upToDate: peers.length > 0 && behind.length === 0,
        coordinator: this.coordinator, isCoordinator: this.isCoordinator,
        waiting: this.replica.pending.size,
      };
    }

    close() {
      this.closed = true;
      this.clock.stop(this.timer);
      for (const peer of this.peers.values()) peer.open = false;
      this.emit('peers');
    }
  }

  return { Session, Emitter, HEARTBEAT, PEER_TIMEOUT };
});
