// Opale — shared projects: direct connections between the computers that
// have a project open (WebRTC data channels, encrypted by DTLS).
//
// Finding each other: there is no server of ours. A computer that opens a
// project leaves a small "knock" file for each other device of the project
// in the project's Drive folder "signalisation"; whoever has the project open
// sees it at their next Drive check (a few seconds) and answers. The offer
// and the answer (network addresses and keys of the connection) travel the
// same way, one file each. The Opale server of each computer only reads files
// written by member accounts, and only for devices of the project.
//
// Getting through: addresses are found with STUN (Google's public servers by
// default, configurable); networks that block direct connections need a TURN
// relay, which the user can set. When no connection is possible, changes
// still go through Drive, only more slowly, and presence is not shared.
//
// Trust: once the channel is open, each side proves it holds the key of its
// device by signing both computers' DTLS fingerprints and a fresh nonce from
// the other side; the other checks the key against the membership records
// (current role, device not revoked). Nothing is exchanged before that.
import { api } from '../core.js';

const CHUNK = 60000;
const GATHER_TIMEOUT = 4000;
const CONNECT_TIMEOUT = 45000;
const RETRY = [4000, 15000, 60000, 180000];
const REKNOCK = 120000;

const fingerprintOf = (sdp) => { const match = /a=fingerprint:\S+ ([0-9A-Fa-f:]+)/.exec(sdp || ''); return match ? match[1].toUpperCase() : ''; };

export class Mesh {
  constructor(project) {
    this.project = project;
    this.links = new Map();   // device id → link
    this.retries = new Map(); // device id → { count, timer }
    this.closed = false;
    this.knocked = new Map(); // device id → time of our last knock
    this.chunks = new Map();
    this.state = { lastError: '', attempts: 0 };
  }
  get session() { return this.project.session; }
  get net() { return this.project.network || {}; }
  get enabled() { return typeof RTCPeerConnection === 'function' && !this.net.driveOnly; }

  // Devices we may connect to: members' devices, not revoked, not ours.
  devices() {
    const out = [];
    for (const member of (this.project.members && this.project.members.members) || []) {
      for (const device of member.devices) if (!device.revoked && !device.me && device.deviceId !== this.project.me.id) out.push({ id: device.deviceId, email: member.email, role: member.role });
    }
    return out;
  }

  start() {
    if (!this.enabled || this.project.removed) return;
    for (const device of this.devices()) this.knock(device.id);
    this.reknockTimer = setInterval(() => this.reknock(), REKNOCK);
  }
  // From time to time, knock again on devices we could not reach (a network
  // that came back, a missed knock).
  reknock() {
    if (this.closed) return;
    const now = Date.now();
    for (const device of this.devices()) {
      const link = this.links.get(device.id);
      if (link) continue;
      if (now - (this.knocked.get(device.id) || 0) >= REKNOCK && !this.retries.get(device.id)?.timer) this.knock(device.id);
    }
  }
  knock(id, reply = false) {
    this.knocked.set(id, Date.now());
    this.signal(id, { k: 'knock', reply, at: Date.now() });
  }
  signal(id, payload) {
    return api('/api/collab/signal', { method: 'POST', body: { project: this.project.id, to: id, payload } })
      .catch((error) => { this.state.lastError = error.message; });
  }
  // Remove links to devices no longer allowed.
  prune() {
    const allowed = new Set(this.devices().map((device) => device.id));
    for (const id of [...this.links.keys()]) if (!allowed.has(id)) this.drop(id, 'removed');
  }

  // ------------------------------------------------------------ signalling
  async onSignal(from, payload) {
    if (this.closed || !this.enabled || !payload || typeof payload !== 'object') return;
    if (!this.devices().some((device) => device.id === from)) return;
    const me = this.project.me.id;
    switch (payload.k) {
      case 'knock': {
        const link = this.links.get(from);
        if (link && link.ready) return; // already connected
        if (link) this.drop(from, 'restart');
        // The lower id makes the offer, so two computers knocking at the
        // same time do not create two connections.
        if (me < from) this.offer(from);
        else if (!payload.reply) this.knock(from, true);
        break;
      }
      case 'offer': {
        if (me < from) { const link = this.links.get(from); if (link && link.role === 'offer') return; }
        if (this.links.has(from)) this.drop(from, 'restart');
        await this.answer(from, payload.sdp, payload.id);
        break;
      }
      case 'answer': {
        const link = this.links.get(from);
        if (!link || link.role !== 'offer' || link.id !== payload.id || link.pc.signalingState !== 'have-local-offer') return;
        try { await link.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp }); link.remoteFp = fingerprintOf(payload.sdp); }
        catch (error) { this.fail(from, error); }
        break;
      }
      case 'bye': this.drop(from, 'bye'); break;
      default:
    }
  }

  iceServers() {
    const servers = [];
    if (this.net.stun && this.net.stun.length) servers.push({ urls: this.net.stun });
    for (const turn of this.net.turn || []) servers.push({ urls: turn.urls, username: turn.username, credential: turn.credential });
    return servers;
  }
  newLink(id, role, linkId) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers() });
    const link = { id: linkId, peer: id, role, pc, channel: null, ready: false, verified: null, theyReady: false, hello: null, theirHello: null, localFp: '', remoteFp: '', started: Date.now() };
    this.links.set(id, link);
    this.state.attempts++;
    link.timeout = setTimeout(() => { if (!link.ready) this.fail(id, new Error('délai de connexion dépassé')); }, CONNECT_TIMEOUT);
    pc.onconnectionstatechange = () => {
      if (this.links.get(id) !== link) return;
      if (['failed', 'closed'].includes(pc.connectionState)) this.fail(id, new Error(`connexion ${pc.connectionState === 'failed' ? 'impossible' : 'fermée'}`));
      else if (pc.connectionState === 'disconnected') link.lostAt = Date.now();
    };
    return link;
  }
  // Wait for the network addresses, so that one file carries them all.
  gathered(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { pc.removeEventListener('icegatheringstatechange', check); clearTimeout(timer); resolve(); };
      const check = () => { if (pc.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(done, GATHER_TIMEOUT);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }
  async offer(id) {
    const link = this.newLink(id, 'offer', Math.random().toString(36).slice(2, 10));
    try {
      this.wire(link, link.pc.createDataChannel('opale', { ordered: true }));
      await link.pc.setLocalDescription(await link.pc.createOffer());
      await this.gathered(link.pc);
      if (this.links.get(id) !== link) return;
      link.localFp = fingerprintOf(link.pc.localDescription.sdp);
      await this.signal(id, { k: 'offer', id: link.id, sdp: link.pc.localDescription.sdp });
    } catch (error) { this.fail(id, error); }
  }
  async answer(id, sdp, linkId) {
    const link = this.newLink(id, 'answer', linkId);
    link.pc.ondatachannel = (event) => this.wire(link, event.channel);
    try {
      await link.pc.setRemoteDescription({ type: 'offer', sdp });
      link.remoteFp = fingerprintOf(sdp);
      await link.pc.setLocalDescription(await link.pc.createAnswer());
      await this.gathered(link.pc);
      if (this.links.get(id) !== link) return;
      link.localFp = fingerprintOf(link.pc.localDescription.sdp);
      await this.signal(id, { k: 'answer', id: link.id, sdp: link.pc.localDescription.sdp });
    } catch (error) { this.fail(id, error); }
  }

  // ------------------------------------------------------------- the channel
  wire(link, channel) {
    link.channel = channel;
    channel.onopen = () => this.authenticate(link);
    channel.onclose = () => { if (this.links.get(link.peer) === link) this.fail(link.peer, new Error('canal fermé')); };
    channel.onmessage = (event) => this.receive(link, event.data);
  }
  raw(link, data) {
    const text = JSON.stringify(data);
    if (!link.channel || link.channel.readyState !== 'open') throw new Error('canal fermé');
    if (text.length <= CHUNK) { link.channel.send(text); return; }
    const id = Math.random().toString(36).slice(2, 10);
    const count = Math.ceil(text.length / CHUNK);
    for (let i = 0; i < count; i++) link.channel.send(JSON.stringify({ k: 'part', id, i, n: count, d: text.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }
  receive(link, text) {
    let data;
    try { data = JSON.parse(text); } catch { return; }
    if (data.k === 'part') {
      const key = `${link.peer}:${data.id}`;
      const parts = this.chunks.get(key) || [];
      parts[data.i] = data.d;
      this.chunks.set(key, parts);
      if (parts.filter((part) => part !== undefined).length < data.n) return;
      this.chunks.delete(key);
      try { data = JSON.parse(parts.join('')); } catch { return; }
    }
    this.handle(link, data);
  }
  async authenticate(link) {
    try {
      if (!link.localFp) link.localFp = fingerprintOf(link.pc.localDescription && link.pc.localDescription.sdp);
      if (!link.remoteFp) link.remoteFp = fingerprintOf(link.pc.remoteDescription && link.pc.remoteDescription.sdp);
      link.hello = await api('/api/collab/hello', { method: 'POST', body: { project: this.project.id } });
      this.raw(link, { k: 'a1', hello: link.hello });
      if (link.theirHello) await this.prove(link);
    } catch (error) { this.fail(link.peer, error); }
  }
  async prove(link) {
    const proof = await api('/api/collab/proof', { method: 'POST', body: { project: this.project.id, peer: link.peer, peerNonce: link.theirHello.nonce, localFp: link.localFp, remoteFp: link.remoteFp } });
    this.raw(link, { k: 'a2', proof });
  }
  async handle(link, data) {
    if (this.links.get(link.peer) !== link) return;
    try {
      switch (data.k) {
        case 'a1':
          if (!data.hello || data.hello.deviceId !== link.peer) throw new Error('identité inattendue');
          link.theirHello = data.hello;
          if (link.hello) await this.prove(link);
          break;
        case 'a2': {
          if (!link.theirHello || !link.hello) return;
          const verdict = await api('/api/collab/verify', { method: 'POST', body: { project: this.project.id, hello: link.theirHello, proof: data.proof, nonce: link.hello.nonce, localFp: link.localFp, remoteFp: link.remoteFp } });
          if (!verdict.ok) { this.raw(link, { k: 'no', reason: verdict.reason }); throw new Error(`appareil refusé (${verdict.reason})`); }
          link.verified = verdict.member;
          this.raw(link, { k: 'ok' });
          this.maybeOpen(link);
          break;
        }
        case 'ok': link.theyReady = true; this.maybeOpen(link); break;
        case 'no': throw new Error(`cet ordinateur a été refusé (${data.reason})`);
        case 'asset-get': if (link.ready) this.project.assets.send(link, data.id).catch(() => {}); break;
        case 'asset-part': if (link.ready) this.project.assets.receive(link, data).catch(() => {}); break;
        case 'm': if (link.ready) this.session.message(link.peer, data.m); break;
        case 'bye': this.drop(link.peer, 'bye'); break;
        default:
      }
    } catch (error) { this.fail(link.peer, error); }
  }
  maybeOpen(link) {
    if (link.ready || !link.verified || !link.theyReady) return;
    link.ready = true;
    clearTimeout(link.timeout);
    this.retries.delete(link.peer);
    link.path = 'direct';
    this.describePath(link);
    this.session.peerOpen({ id: link.peer, email: link.verified.email, role: link.verified.role, name: link.verified.name || link.theirHello.name });
    this.project.changed();
  }
  // Direct or through a relay: shown in the status details.
  async describePath(link) {
    try {
      const stats = await link.pc.getStats();
      let pair = null;
      stats.forEach((report) => { if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') pair = report; });
      const local = pair && stats.get(pair.localCandidateId);
      const remote = pair && stats.get(pair.remoteCandidateId);
      if (local && remote) link.path = local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'relay' : local.candidateType === 'host' && remote.candidateType === 'host' ? 'local' : 'direct';
      this.project.changed();
    } catch {}
  }

  // --------------------------------------------------- what the session sees
  send(id, message) {
    const link = this.links.get(id);
    if (!link || !link.ready) throw new Error('pas connecté');
    this.raw(link, { k: 'm', m: message });
  }
  close(id) {
    if (id === undefined) { this.shutdown(); return; }
    this.drop(id, 'timeout');
    this.scheduleRetry(id);
  }

  // ----------------------------------------------------------- tear-down
  drop(id, reason) {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    clearTimeout(link.timeout);
    try { link.channel && link.channel.close(); } catch {}
    try { link.pc.close(); } catch {}
    if (link.ready) this.session.peerClosed(id);
    void reason;
    this.project.changed();
  }
  fail(id, error) {
    const link = this.links.get(id);
    if (!link) return;
    this.state.lastError = `${error && error.message ? error.message : error}`;
    const wasReady = link.ready;
    this.drop(id, 'error');
    // A connection that worked and broke: the other computer may still be
    // there (network change), so try again; one that never worked: wait.
    this.scheduleRetry(id, wasReady);
  }
  scheduleRetry(id, soon = false) {
    if (this.closed || !this.devices().some((device) => device.id === id)) return;
    const entry = this.retries.get(id) || { count: 0, timer: null };
    clearTimeout(entry.timer);
    const delay = soon ? RETRY[0] : RETRY[Math.min(entry.count, RETRY.length - 1)];
    entry.count++;
    entry.timer = setTimeout(() => { entry.timer = null; if (!this.links.has(id) && !this.closed) this.knock(id); }, delay);
    this.retries.set(id, entry);
  }
  shutdown() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.reknockTimer);
    for (const entry of this.retries.values()) clearTimeout(entry.timer);
    for (const id of [...this.links.keys()]) {
      const link = this.links.get(id);
      if (link && link.ready) { try { this.raw(link, { k: 'bye' }); } catch {} }
      this.drop(id, 'close');
    }
  }

  // For the status details.
  describe() {
    const out = [];
    for (const [id, link] of this.links) out.push({ id, state: link.ready ? 'connected' : 'connecting', path: link.path || '', since: link.started });
    return { enabled: this.enabled, links: out, lastError: this.state.lastError, turn: (this.net.turn || []).length > 0 };
  }
}
