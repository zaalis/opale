'use strict';

const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const { VaultError } = require('./vault.js');

function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b)));
  }
  return net.isIP(address) === 6 && /^[23]/.test(address) && !address.toLowerCase().startsWith('2001:db8:');
}

// Signed resource URLs can point to a CDN. Resolve once, pin the public IP,
// validate each redirect, and never forward a Miro Bearer token to a CDN.
async function download(url, redirects = 0, maxBytes = 20 * 1024 * 1024) {
  let target;
  try { target = new URL(url); } catch { throw new VaultError('L’image possède une adresse invalide.', 502, 'miro-image'); }
  if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443') || redirects > 4) throw new VaultError('L’adresse de cette image ne permet pas un téléchargement sûr.', 502, 'miro-image');
  const host = target.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try { addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true }); }
  catch { throw new VaultError('Le serveur de l’image est introuvable.', 502, 'miro-image'); }
  if (!addresses.length || addresses.some((entry) => !publicAddress(entry.address))) throw new VaultError('Miro a fourni une adresse d’image privée ou locale; téléchargement refusé.', 502, 'miro-image');
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const req = https.get(target, { family: pinned.family, autoSelectFamily: false, lookup: (_host, _options, cb) => cb(null, pinned.address, pinned.family), headers: { Accept: 'image/*' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location; res.resume();
        if (!location) { reject(new VaultError('La redirection de l’image est invalide.', 502, 'miro-image')); return; }
        try { resolve(download(new URL(location, target).href, redirects + 1, maxBytes)); }
        catch { reject(new VaultError('La redirection de l’image est invalide.', 502, 'miro-image')); }
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new VaultError(`L’image n’est pas disponible (HTTP ${res.statusCode}).`, 502, 'miro-image')); return; }
      if (Number(res.headers['content-length']) > maxBytes) { res.destroy(); reject(new VaultError('L’image dépasse la limite de 20 Mo.', 413, 'miro-image')); return; }
      let size = 0; const chunks = [];
      res.on('data', (chunk) => { size += chunk.length; if (size > maxBytes) { res.destroy(); reject(new VaultError('L’image dépasse la limite de 20 Mo.', 413, 'miro-image')); } else chunks.push(chunk); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => reject(new VaultError('Le téléchargement de l’image a été interrompu.', 502, 'miro-image')));
    });
    const timer = setTimeout(() => req.destroy(new Error('timeout')), 30000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', () => reject(new VaultError('Le serveur de l’image est injoignable ou trop lent.', 503, 'miro-image')));
  });
}

function imageExtension(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return '';
}

module.exports = { download, imageExtension, publicAddress };
