'use strict';
// Mock Miro remotely, exercise the real local server and browser UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-miro-browser-'));
process.env.OPALE_HOME = path.join(temp, 'home');
const { MiroAccount } = require('../lib/miro.js');
const { createOpale } = require('../server.js');
const Board = require('../shared/board.js');
const root = path.join(temp, 'Coffre'); fs.mkdirSync(root);
const board = { id: 'uXjV123=', name: 'Moodboard Miro', modifiedAt: '2026-10-12T00:00:00Z' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4q8AAAAASUVORK5CYII=', 'base64');
let launch = ''; let denyBoard = false;
const miro = new MiroAccount({ storage: { load: () => ({}), save: () => {} }, fetch: async (address) => {
  const url = new URL(address);
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.pathname === '/v1/oauth/token') return json({ access_token: 'private-token', refresh_token: 'refresh', scope: 'boards:read', user_id: '123', team_id: '456' });
  if (url.pathname === '/v2/oauth/revoke') return new Response(null, { status: 204 });
  if (url.pathname === '/v2/boards') return json({ data: [board] });
  if (denyBoard) return json({}, 403);
  if (url.pathname.endsWith('/items')) return json({ data: [
    { id: 'frame', type: 'frame', position: { x: 0, y: 0 }, geometry: { width: 800, height: 500 }, data: { title: 'Inspiration' } },
    { id: 'sticky', type: 'sticky_note', position: { x: -150, y: 0 }, geometry: { width: 200, height: 200 }, data: { content: '<b>Ambiance été</b><br>Bleu, lumière et sable' }, style: { fillColor: 'light_blue' } },
    { id: 'image', type: 'image', position: { x: 150, y: 0 }, geometry: { width: 200, height: 200 }, data: { imageUrl: 'https://api.miro.com/v2/boards/uXjV123=/resources/image' } },
  ] });
  if (url.pathname.endsWith('/connectors')) return json({ data: [{ id: 'connector', type: 'connector', startItem: { id: 'sticky' }, endItem: { id: 'image' }, shape: 'straight' }] });
  if (url.pathname.includes('/resources/')) return json({ url: 'https://cdn.example/image.png' });
  return json(board);
} });
(async () => {
  const app = createOpale({ port: 0, vaultPath: root, watch: false, miro, miroOptions: { download: async () => png }, openExternal: (url) => { launch = url; } });
  let browser; const errors = []; const artifacts = process.env.OPALE_QA_DIR;
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  try {
    const base = `http://127.0.0.1:${await app.listen()}`;
    browser = await chromium.launch({ ...(process.platform==='win32'?{...(process.platform==='win32'?{channel:'chrome'}:{})}:{}), headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base); await page.waitForSelector('.tabs');
    await page.evaluate(async () => { const { app } = await import('/js/core.js'); window.__testApp = app; app.settings_ui.open('plugins'); });
    assert.equal(await page.getByRole('button', { name: 'Miro — importer des moodboards', exact: true }).count(), 1);
    if (artifacts) await page.screenshot({ path: path.join(artifacts, 'miro-plugins.png') });
    await page.getByRole('button', { name: 'Miro — importer des moodboards', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#miro-redirect').value.includes('/oauth/miro'));
    assert.equal(await page.locator('#miro-redirect').inputValue(), base + '/oauth/miro');
    assert.equal(await page.getByRole('button', { name: 'Connecter mon compte Miro', exact: true }).isDisabled(), true);
    await page.getByLabel('Client ID', { exact: true }).fill('123456');
    await page.getByLabel('Client secret', { exact: true }).fill('client-secret-test');
    await page.getByRole('button', { name: 'Enregistrer la configuration', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#miro-client-secret').value);
    if (artifacts) await page.screenshot({ path: path.join(artifacts, 'miro-config.png') });
    await page.getByRole('button', { name: 'Connecter mon compte Miro', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.miro-status').textContent.includes('Autorisation en cours'));
    const authState = new URL(launch).searchParams.get('state');
    await fetch(`${base}/oauth/miro?state=${authState}&code=mock-code`);
    await page.waitForFunction(() => document.querySelector('.miro-status').textContent.includes('Compte Miro connecté'));
    await page.waitForFunction(() => document.querySelector('#miro-board-list').options.length === 2);
    await page.getByLabel('Tableaux accessibles', { exact: true }).selectOption(board.id);
    if (artifacts) await page.screenshot({ path: path.join(artifacts, 'miro-connected.png') });
    await page.getByRole('button', { name: 'Importer dans ce coffre', exact: true }).click();
    await page.getByRole('dialog', { name: 'Import Miro terminé', exact: true }).waitFor();
    assert.equal(app.miroService.job.result.elements, 4);
    const result = app.miroService.job.result;
    const canvas = fs.readFileSync(app.vault.abs(result.path), 'utf8');
    assert.equal(Board.parse(canvas).problem, null);
    for (const file of Board.fileRefs(canvas)) assert.ok(fs.existsSync(app.vault.abs(file)));
    await page.getByRole('button', { name: 'Ouvrir le moodboard', exact: true }).click();
    await page.locator('.modal-settings').waitFor({ state: 'detached' });
    await page.waitForSelector('.board-stage');
    await page.waitForFunction(() => window.__testApp.workspace.activeView.loaded);
    assert.equal(await page.evaluate(() => window.__testApp.workspace.activeView.doc.elements.length), 4);
    await page.waitForFunction(() => [...document.querySelectorAll('.board-stage img')].every((img) => img.complete && img.naturalWidth > 0));
    if (artifacts) await page.screenshot({ path: path.join(artifacts, 'miro-imported.png') });
    console.log('PASS plugin card, credentials, OAuth callback, board listing, atomic import and rendered local image');

    // Open an imported report and validate a denied board shows a small modal.
    denyBoard = true;
    await page.evaluate(() => window.__testApp.settings_ui.open('plugins'));
    await page.getByRole('button', { name: 'Miro — importer des moodboards', exact: true }).click();
    await page.getByRole('button', { name: 'Consulter le dernier import', exact: true }).waitFor();
    await page.getByLabel('Lien ou identifiant du tableau', { exact: true }).fill('https://miro.com/app/board/uXjV123=/');
    await page.getByRole('button', { name: 'Importer dans ce coffre', exact: true }).click();
    const failure = page.getByRole('dialog', { name: 'Miro — opération impossible', exact: true });
    await failure.waitFor(); assert.match(await failure.innerText(), /boards:read.*équipe/);
    await page.waitForFunction(() => [...document.querySelectorAll('.modal-backdrop.is-visible .modal-miro-message')].length > 0);
    if (artifacts) await page.screenshot({ path: path.join(artifacts, 'miro-error.png') });
    await failure.getByRole('button', { name: 'Compris', exact: true }).click();
    await failure.waitFor({ state: 'detached' });
    await page.evaluate(() => { window.__testApp.settings.theme = 'light'; window.__testApp.settings_ui.apply(); });
    if (artifacts) await page.screenshot({ path: path.join(artifacts, 'miro-light.png') });
    console.log('PASS denied-board error dialog, retry access and light theme');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close(); await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
