'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const platform = require('../lib/platform.js');
const appdata = require('../lib/appdata.js');
const { Vault } = require('../lib/vault.js');
const Meta = require('../shared/meta.js');

test('Linux configuration ignores inherited Windows APPDATA', { skip: !platform.LINUX }, () => {
  const saved = { ...process.env };
  try {
    delete process.env.OPALE_HOME;
    process.env.APPDATA = 'C:\\Users\\user\\AppData\\Roaming';
    process.env.XDG_CONFIG_HOME = '/tmp/opale-config';
    assert.equal(appdata.homeDir(), '/tmp/opale-config/Opale');
    assert.equal(appdata.files().google, '/tmp/opale-config/Opale/google.json');
  } finally { process.env = saved; }
});

test('Linux packaged shell is found under its installed name', { skip: !platform.LINUX }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-shell-'));
  try {
    fs.writeFileSync(path.join(root, 'Opale'), 'shell');
    assert.equal(platform.findShell(root), path.join(root, 'Opale'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Linux vaults with names differing only in case remain independent', { skip: !platform.LINUX }, () => {
  const config = { vaults: [] };
  appdata.rememberVault(config, '/tmp/Notes');
  appdata.rememberVault(config, '/tmp/notes');
  assert.equal(config.vaults.length, 2);
  appdata.forgetVault(config, '/tmp/notes');
  assert.deepEqual(config.vaults.map(v => v.path), ['/tmp/Notes']);
});

test('Linux rejects a symlink escaping into a sibling with different case', { skip: !platform.LINUX }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-sandbox-'));
  const inside = path.join(root, 'Vault'), outside = path.join(root, 'vault');
  fs.mkdirSync(inside); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(inside, 'escape'));
  const vault = new Vault(inside);
  try {
    assert.throws(() => vault.write('escape/secret.md', 'outside'), /sort du coffre/);
    assert.equal(fs.existsSync(path.join(outside, 'secret.md')), false);
  } finally { vault.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('exact link spelling resolves two Linux files with different case', () => {
  const resolver = Meta.buildResolver(['Note.md', 'note.md']);
  assert.equal(resolver.resolve('Note', null), 'Note.md');
  assert.equal(resolver.resolve('note', null), 'note.md');
});

test('OAuth opens the Linux system browser and falls back to the WSL host', { skip: !platform.LINUX }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-browser-launch-'));
  const saved = { ...process.env };
  try {
    process.env.PATH = temp;
    const output = path.join(temp, 'url');
    process.env.OPALE_TEST_URL_FILE = output;
    fs.writeFileSync(path.join(temp, 'xdg-open'), '#!/bin/sh\nprintf "%s" "$1" > "$OPALE_TEST_URL_FILE"\n', { mode: 0o755 });
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?state=a&scope=b';
    await platform.openExternal(url);
    assert.equal(fs.readFileSync(output, 'utf8'), url);
    fs.writeFileSync(path.join(temp, 'xdg-open'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
    delete process.env.WSL_DISTRO_NAME;
    await assert.rejects(platform.openExternal(url), /navigateur système/);
    process.env.WSL_DISTRO_NAME = 'Ubuntu';
    fs.writeFileSync(path.join(temp, 'rundll32.exe'), '#!/bin/sh\nprintf "%s" "$2" > "$OPALE_TEST_URL_FILE"\n', { mode: 0o755 });
    await platform.openExternal(url);
    assert.equal(fs.readFileSync(output, 'utf8'), url);
  } finally { process.env = saved; fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Drive reports browser launch failure without leaving a pending login', { skip: !platform.LINUX }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-oauth-route-'));
  const saved = { ...process.env };
  let app;
  try {
    process.env.OPALE_HOME = path.join(temp, 'home');
    process.env.PATH = temp;
    delete process.env.WSL_DISTRO_NAME;
    fs.writeFileSync(path.join(temp, 'xdg-open'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
    const { GoogleAccount } = require('../lib/google.js');
    const google = new GoogleAccount({ builtin: { clientId: 'test.apps.googleusercontent.com' }, file: path.join(temp, 'google.json') });
    app = require('../server.js').createOpale({ port: 0, google });
    const port = await app.listen();
    const result = await fetch(`http://127.0.0.1:${port}/api/drive/connect`, {
      method: 'POST', headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(result.status, 503);
    assert.equal((await result.json()).code, 'browser');
    assert.equal(google.info().pending, false);
  } finally {
    if (app) await app.close();
    process.env = saved;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
