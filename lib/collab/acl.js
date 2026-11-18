'use strict';

// Shared projects: who is a member, with which role, on which computers.
//
// Three kinds of records, all kept as small files in the project's Drive
// folder and cached on each computer:
//   genesis  the project description, signed by its owner. The project id is
//            derived from the owner's key, so it cannot be swapped.
//   entries  signed decisions: "email X has role R" or "device D is revoked".
//            Each is valid only if its signer was allowed to take it when it
//            comes in the agreed order (counter, then id).
//   devices  "this key belongs to a computer of email X". Trusted only when
//            Google says the file was created and last modified by X, so a
//            member cannot register a key in someone else's name.
const identity = require('./identity.js');

const ROLES = ['owner', 'admin', 'editor', 'reader'];
const RANK = { owner: 4, admin: 3, editor: 2, reader: 1, removed: 0 };
const ROLE_NAMES = { owner: 'Propriétaire', admin: 'Administrateur', editor: 'Éditeur', reader: 'Lecteur', removed: 'Retiré' };
const lower = (value) => String(value || '').trim().toLowerCase();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));

function checkGenesis(genesis, projectId) {
  if (!genesis || genesis.v !== 1 || !genesis.owner || !genesis.owner.key) return 'Description du projet absente ou illisible.';
  if (identity.projectIdOf(genesis.owner.key, genesis.nonce) !== genesis.projectId) return 'La description du projet ne correspond pas à son identifiant.';
  if (projectId && genesis.projectId !== projectId) return 'Ce dossier contient un autre projet.';
  if (identity.deviceIdOf(genesis.owner.key) !== genesis.owner.deviceId) return 'Appareil du propriétaire incohérent.';
  if (!identity.verifyObject(genesis, genesis.owner.key)) return 'Signature du propriétaire invalide.';
  return '';
}

// A device record with what Drive says about its file. `pinned`: keys already
// trusted on this computer (a key never changes for a device id).
function checkDevice(record, meta, projectId) {
  if (!record || record.v !== 1 || record.projectId !== projectId || !record.key) return 'illisible';
  if (identity.deviceIdOf(record.key) !== record.deviceId) return 'identifiant incohérent';
  if (!identity.verifyObject(record, record.key)) return 'signature invalide';
  const email = lower(record.email);
  if (!meta) return 'sans propriétaire Drive';
  const owner = lower(meta.ownerEmail); const modifier = lower(meta.modifierEmail || meta.ownerEmail);
  if (owner !== email || modifier !== email) return 'créé ou modifié par un autre compte';
  return '';
}

// Fold everything into the current membership. Deterministic: every computer
// with the same records reaches the same result.
function fold(genesis, entries, devices) {
  const ownerEmail = lower(genesis.owner.email);
  const members = new Map([[ownerEmail, { email: ownerEmail, role: 'owner', since: genesis.created || 0, by: genesis.owner.deviceId, name: genesis.owner.name || '' }]]);
  const deviceMap = new Map();
  deviceMap.set(genesis.owner.deviceId, { deviceId: genesis.owner.deviceId, key: genesis.owner.key, email: ownerEmail, name: genesis.owner.deviceName || '', revoked: false, created: genesis.created || 0 });
  for (const device of devices || []) {
    if (!device || deviceMap.has(device.deviceId)) continue;
    deviceMap.set(device.deviceId, { deviceId: device.deviceId, key: device.key, email: lower(device.email), name: String(device.name || ''), revoked: false, created: device.t || 0 });
  }
  const byKey = new Map([...deviceMap.values()].map((device) => [device.key, device]));
  const sorted = [...(entries || [])].filter((entry) => entry && Number.isInteger(entry.n)).sort((a, b) => a.n - b.n || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const applied = []; const rejected = [];
  for (const entry of sorted) {
    const signer = byKey.get(entry.byKey);
    const reason = (() => {
      if (!signer || signer.deviceId !== entry.by) return 'signataire inconnu';
      if (signer.revoked) return 'appareil révoqué';
      if (!identity.verifyObject(entry, entry.byKey)) return 'signature invalide';
      const self = members.get(signer.email);
      const role = self ? self.role : 'removed';
      if (RANK[role] < RANK.reader) return 'signataire non membre';
      if (entry.type === 'member') {
        const target = lower(entry.email);
        if (!validEmail(target) || !(entry.role in RANK) || entry.role === 'owner') return 'rôle invalide';
        const current = members.get(target);
        const currentRole = current ? current.role : 'removed';
        if (currentRole === 'owner') return 'le propriétaire ne peut pas être modifié';
        if (target === signer.email && entry.role === 'removed') return '';
        if (role === 'owner') return '';
        if (role === 'admin' && RANK[currentRole] <= RANK.editor && RANK[entry.role] <= RANK.editor) return '';
        return 'droits insuffisants';
      }
      if (entry.type === 'revoke') {
        const device = deviceMap.get(entry.device);
        if (!device) return 'appareil inconnu';
        if (device.email === signer.email) return '';
        const targetRole = members.has(device.email) ? members.get(device.email).role : 'removed';
        if (RANK[targetRole] >= RANK.admin && role !== 'owner') return 'droits insuffisants';
        return RANK[role] >= RANK.admin ? '' : 'droits insuffisants';
      }
      return 'type inconnu';
    })();
    if (reason) { rejected.push({ id: entry.id, reason }); continue; }
    applied.push(entry);
    if (entry.type === 'member') {
      const target = lower(entry.email);
      members.set(target, { email: target, role: entry.role, since: entry.t || 0, by: entry.by, name: (members.get(target) || {}).name || '' });
    } else if (entry.type === 'revoke') deviceMap.get(entry.device).revoked = true;
  }
  const counter = sorted.reduce((max, entry) => Math.max(max, entry.n), 0);
  return {
    ownerEmail, counter, applied, rejected,
    members: [...members.values()],
    devices: [...deviceMap.values()],
    role(email) { const member = members.get(lower(email)); return member ? member.role : 'removed'; },
    device(id) { return deviceMap.get(id) || null; },
    // May this device take part now? → { ok, email, role, reason }
    allowed(id) {
      const device = deviceMap.get(id);
      if (!device) return { ok: false, reason: 'unknown' };
      if (device.revoked) return { ok: false, reason: 'revoked', email: device.email };
      const role = this.role(device.email);
      if (RANK[role] < RANK.reader) return { ok: false, reason: 'removed', email: device.email };
      return { ok: true, email: device.email, role, name: device.name };
    },
  };
}

module.exports = { ROLES, RANK, ROLE_NAMES, checkGenesis, checkDevice, fold, lower, validEmail };
