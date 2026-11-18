'use strict';

// Shared projects: the keys of this installation. Each project joined gets
// its own Ed25519 key pair, so a grant for one project can never be used for
// another one. Private keys are protected with Windows DPAPI on Windows, and
// with this Mac's profile key (AES-256-GCM) everywhere else.
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Crdt = require('../../shared/collab-crdt.js');

const b64url = (buffer) => Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function protectionMode() {
  const forced = process.env.OPALE_KEY_PROTECTION;
  if (forced === 'none') return 'none';
  return process.platform === 'win32' ? 'dpapi' : 'mac';
}

function dpapi(action, data) {
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$in = [Console]::In.ReadToEnd().Trim()',
    '$bytes = [Convert]::FromBase64String($in)',
    `$out = [System.Security.Cryptography.ProtectedData]::${action}($bytes, [Text.Encoding]::UTF8.GetBytes('Opale shared project key'), [System.Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    '[Console]::Out.Write([Convert]::ToBase64String($out))',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: data.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.status !== 0 || !result.stdout) throw new Error(`Protection Windows indisponible : ${(result.stderr || result.error || '').toString().trim().slice(0, 200)}`);
  return Buffer.from(result.stdout.trim(), 'base64');
}

function seal(privateDer) {
  const mode = protectionMode();
  if (mode === 'dpapi') return { scheme: 'dpapi', data: dpapi('Protect', privateDer).toString('base64') };
  if (mode === 'mac') return { scheme: 'mac-aes-gcm', data: require('../mac-credentials').seal(privateDer) };
  return { scheme: 'plain', data: privateDer.toString('base64') };
}
function unseal(sealed) {
  if (!sealed || !sealed.data) throw new Error('Clé de l’appareil absente.');
  if (sealed.scheme === 'mac-aes-gcm') return require('../mac-credentials').open(sealed.data);
  if (sealed.scheme === 'linux-aes-gcm') throw new Error('Cette clé appartient à un profil Linux. Rejoignez le projet depuis ce Mac.');
  if (sealed.scheme === 'dpapi') return dpapi('Unprotect', Buffer.from(sealed.data, 'base64'));
  return Buffer.from(sealed.data, 'base64');
}

const deviceIdOf = (publicKey) => b64url(crypto.createHash('sha256').update(String(publicKey)).digest()).slice(0, 16);

function generate() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const priv = privateKey.export({ type: 'pkcs8', format: 'der' });
  return { publicKey: pub, deviceId: deviceIdOf(pub), privateDer: priv };
}

class Signer {
  constructor(publicKey, privateDer) {
    this.publicKey = publicKey;
    this.deviceId = deviceIdOf(publicKey);
    this.key = crypto.createPrivateKey({ key: privateDer, format: 'der', type: 'pkcs8' });
  }
  sign(text) { return crypto.sign(null, Buffer.from(String(text), 'utf8'), this.key).toString('base64'); }
  signObject(object) { const out = { ...object }; delete out.sig; return { ...out, sig: this.sign(Crdt.stable(out)) }; }
}

const keyCache = new Map();
function verify(publicKey, text, signature) {
  try {
    let key = keyCache.get(publicKey);
    if (!key) { key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' }); keyCache.set(publicKey, key); }
    return crypto.verify(null, Buffer.from(String(text), 'utf8'), key, Buffer.from(String(signature || ''), 'base64'));
  } catch { return false; }
}
function verifyObject(object, publicKey) {
  if (!object || typeof object.sig !== 'string') return false;
  const body = { ...object }; delete body.sig;
  return verify(publicKey, Crdt.stable(body), object.sig);
}

// The project id is derived from the owner's key: whoever holds the id can
// check that the project's description was written by its real owner.
const projectIdOf = (ownerKey, nonce) => b64url(crypto.createHash('sha256').update(`opale-project|${ownerKey}|${nonce}`).digest()).slice(0, 22);

module.exports = { generate, seal, unseal, Signer, verify, verifyObject, deviceIdOf, projectIdOf, b64url, protectionMode };
