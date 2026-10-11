'use strict';

// Google sign-in and Drive requests, against a scripted stand-in for Google.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { GoogleAccount, DriveClient, parseClient } = require('../lib/google.js');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-google-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

const CLIENT = { installed: { client_id: '42-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-secret' } };
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const idToken = (email) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`;

function account(handler) {
  const calls = [];
  const fetch = async (url, options = {}) => { calls.push({ url: String(url), options }); return handler(String(url), options, calls); };
  const google = new GoogleAccount({ fetch, file: path.join(temp, `google-${crypto.randomUUID()}.json`) });
  google.setClient(JSON.stringify(CLIENT));
  return { google, calls };
}

test('the client file from Google Cloud Console is understood', () => {
  assert.deepEqual(parseClient(JSON.stringify(CLIENT)), { clientId: '42-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret' });
  assert.throws(() => parseClient('{"installed":{"client_id":"nope"}}'), /Identifiant client invalide/);
  assert.throws(() => parseClient('pas du json'), /JSON/);
});

test('sign-in uses PKCE, a loopback address and checks the returned state', async () => {
  const { google, calls } = account((url, options) => {
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('code'), 'le-code');
    assert.equal(body.get('redirect_uri'), 'http://127.0.0.1:27184/oauth/google');
    // The verifier matches the challenge sent to the browser.
    const challenge = crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url');
    assert.equal(challenge, google.__challenge);
    return json(200, { access_token: 'acc', refresh_token: 'ref', expires_in: 3600, id_token: idToken('moi@example.com') });
  });
  const url = new URL(google.beginAuth('http://127.0.0.1:27184/oauth/google'));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.match(url.searchParams.get('scope'), /auth\/drive\.file/);
  assert.doesNotMatch(url.searchParams.get('scope'), /auth\/drive(\s|$)/, 'never the full Drive scope');
  google.__challenge = url.searchParams.get('code_challenge');

  await assert.rejects(google.finishAuth({ state: 'autre', code: 'le-code' }), /état différent/);
  assert.equal(calls.length, 0);
  const info = await google.finishAuth({ state: url.searchParams.get('state'), code: 'le-code' });
  assert.equal(info.connected, true);
  assert.equal(info.email, 'moi@example.com');
  // A state value works only once.
  await assert.rejects(google.finishAuth({ state: url.searchParams.get('state'), code: 'le-code' }), /expiré/);
  const saved = JSON.parse(fs.readFileSync(google.file, 'utf8'));
  assert.equal(saved.refreshToken, 'ref');
});

test('an expired access token is renewed; a revoked one disconnects the account', async () => {
  let refreshes = 0; let revoked = false;
  const { google } = account((url, options) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      if (revoked) return json(400, { error: 'invalid_grant' });
      refreshes++; return json(200, { access_token: `acc${refreshes}`, expires_in: 3600 });
    }
    if (options.headers.Authorization === 'Bearer acc1') return json(401, { error: { message: 'expired' } });
    return json(200, { files: [] });
  });
  google.data.refreshToken = 'ref'; google.save();
  const drive = new DriveClient(google);
  assert.deepEqual(await drive.list('v'), []);
  assert.equal(refreshes, 2);
  revoked = true; google.access = null;
  await assert.rejects(drive.list('v'), (error) => error.code === 'auth');
  assert.equal(google.connected, false);
});

test('rate limits are retried', async () => {
  let attempts = 0;
  const { google } = account((url) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json(200, { access_token: 'acc', expires_in: 3600 });
    attempts++;
    return attempts < 2 ? json(429, { error: { message: 'slow down' } }) : json(200, { files: [] });
  });
  google.data.refreshToken = 'ref';
  await new DriveClient(google).list('v');
  assert.equal(attempts, 2);
});

test('Drive requests: listing by vault tag, multipart upload, trash', async () => {
  const seen = [];
  const { google } = account((url, options) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json(200, { access_token: 'acc', expires_in: 3600 });
    seen.push({ url, options });
    if (options.method === 'POST' && url.includes('/upload/')) return json(200, { id: 'f1', name: 'Note.md', mimeType: 'text/markdown', parents: ['p'], md5Checksum: 'abc', size: '5' });
    if (options.method === 'PATCH') return json(200, { id: 'f1' });
    return json(200, { files: [{ id: 'f1', name: 'Note.md', mimeType: 'text/markdown', parents: ['p'], md5Checksum: 'abc', size: '5', appProperties: { opaleVault: 'v', opaleDevice: 'PC' } }] });
  });
  google.data.refreshToken = 'ref';
  const drive = new DriveClient(google);
  const [item] = await drive.list('v');
  assert.deepEqual({ id: item.id, md5: item.md5, size: item.size, device: item.device, folder: item.folder }, { id: 'f1', md5: 'abc', size: 5, device: 'PC', folder: false });
  assert.match(new URL(seen[0].url).searchParams.get('q'), /appProperties has \{ key='opaleVault' and value='v' \} and trashed=false/);
  const uploaded = await drive.upload({ name: 'Note.md', parentId: 'p', vaultId: 'v', device: 'PC', data: Buffer.from('hello') });
  assert.equal(uploaded.id, 'f1');
  const upload = seen[1];
  assert.match(upload.url, /uploadType=multipart/);
  assert.match(upload.options.headers['Content-Type'], /^multipart\/related; boundary=/);
  const body = upload.options.body.toString();
  assert.match(body, /"parents":\["p"\]/);
  assert.match(body, /"opaleVault":"v"/);
  assert.match(body, /hello/);
  await drive.trash('f1');
  assert.deepEqual(JSON.parse(seen[2].options.body), { trashed: true });
});

test('the client built into the app is used, never stored, and overridable', () => {
  const file = path.join(temp, `builtin-${crypto.randomUUID()}.json`);
  const builtin = { clientId: 'app-1.apps.googleusercontent.com', clientSecret: 'GOCSPX-app' };
  const google = new GoogleAccount({ fetch: async () => json(200, {}), file, builtin });
  assert.equal(google.configured, true);
  assert.equal(google.info().builtin, true);
  google.data.refreshToken = 'ref'; google.save();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { refreshToken: 'ref' });
  google.setClient(JSON.stringify(CLIENT));
  assert.equal(google.info().builtin, false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).clientId, CLIENT.installed.client_id);
  assert.equal(new GoogleAccount({ file: path.join(temp, 'none.json'), builtin: null }).configured, false);
});
