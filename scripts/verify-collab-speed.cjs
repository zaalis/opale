'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-live-check-'));
const children = [];
async function start(name, email) {
  const vault = path.join(temp, name, 'vault'); fs.mkdirSync(vault, { recursive: true });
  const executable = process.env.OPALE_TEST_SERVER || process.execPath;
  const args = process.env.OPALE_TEST_SERVER ? [] : [path.resolve('server.js')];
  const child = spawn(executable, [...args, '--port', '0', '--vault', vault], { windowsHide: true, env: { ...process.env, OPALE_HOME: path.join(temp, name, 'home'), OPALE_FAKE_DRIVE: path.join(temp, 'drive'), OPALE_FAKE_EMAIL: email, OPALE_KEY_PROTECTION: 'none', OPALE_COLLAB_POLL_MS: '200' } });
  children.push(child);
  return new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('Server startup timeout')), 15000);
    child.on('error', reject); child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.stdout.on('data', chunk => { output += chunk; const hit = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output); if (hit) { clearTimeout(timer); resolve(`http://127.0.0.1:${hit[1]}`); } });
  });
}
(async () => {
  let browser;
  try {
    const [aUrl, bUrl] = await Promise.all([start('alice', 'alice@example.test'), start('bob', 'bob@example.test')]);
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const ca = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), cb = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const a = await ca.newPage(), b = await cb.newPage();
    const errors = []; for (const page of [a, b]) { page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message)); }
    await Promise.all([a.goto(aUrl), b.goto(bUrl)]);
    for (const page of [a, b]) await page.waitForSelector('.tabs');
    const invitation = await a.evaluate(async () => {
      const { app, api } = await import('/js/core.js'); window.app = app; window.api = api;
      const created = await api('/api/collab/create', { method: 'POST', body: { name: 'Temps réel' } });
      await app.collab.load(); window.project = await app.collab.open(created.projectId);
      return api('/api/collab/invite', { method: 'POST', body: { project: project.id, email: 'bob@example.test', role: 'editor' } });
    });
    await b.evaluate(async code => {
      const { app, api } = await import('/js/core.js'); window.app = app; window.api = api;
      const joined = await api('/api/collab/join', { method: 'POST', body: { code } });
      await app.collab.load(); window.project = await app.collab.open(joined.projectId);
    }, invitation.code);
    await Promise.all([a.waitForFunction(() => project.session.connected().length === 1, null, { timeout: 30000 }), b.waitForFunction(() => project.session.connected().length === 1, null, { timeout: 30000 })]);
    console.log('PASS authenticated WebRTC between two independent Opale servers');
    const board = await a.evaluate(async () => {
      const id = project.createFile('board', 'Rapide');
      app.workspace.openPath(project.pathOf(project.file(id)));
      return id;
    });
    await b.waitForFunction(id => project.file(id), board);
    await b.evaluate(id => app.workspace.openPath(project.pathOf(project.file(id))), board);
    for (const page of [a,b]) await page.waitForFunction(() => app.workspace.activeView?.loaded && app.workspace.activeView.type === 'board');
    fs.writeFileSync(path.join(temp, 'drive', 'offline-all'), '');
    await a.evaluate(() => { const view = app.workspace.activeView; const el = window.OpaleBoard.create('text', { x: 100, y: 100, data: { text: 'Début' } }); view.change(() => view.add(el)); window.textId = el.id; });
    await b.waitForFunction(() => app.workspace.activeView.doc.elements.some(el => el.kind === 'text'));
    await a.evaluate(() => { const v = app.workspace.activeView; v.editField(v.byId.get(window.textId), 'text'); });
    const started = Date.now();
    await a.locator('.b-editor').fill('Bonjour en direct');
    await b.waitForFunction(() => app.workspace.activeView.doc.elements.some(el => el.data.text === 'Bonjour en direct'));
    console.log(`PASS typed text delivered without Drive in ${Date.now() - started} ms`);
    // A frame repaint must preserve the live textarea and its typed value.
    await a.evaluate(() => { const v = app.workspace.activeView; v.redrawAll(); v.paint(); });
    assert.equal(await a.locator('.b-editor').inputValue(), 'Bonjour en direct');
    const stage = await a.locator('.board-stage').boundingBox();
    await a.mouse.click(stage.x + stage.width - 80, stage.y + 200);
    await a.waitForFunction(() => !app.workspace.activeView.editing && !app.workspace.activeView.selection.size);
    await a.locator('.b-editor').waitFor({ state: 'detached' });
    await a.mouse.dblclick(stage.x + stage.width - 90, stage.y + 250);
    assert.equal(await a.evaluate(() => app.workspace.activeView.doc.elements.filter(el => el.kind === 'text').length), 1);
    await a.locator('.board-stage').focus();
    const focusStyle = await a.locator('.board-stage').evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow }));
    assert.equal(focusStyle.outline, 'none'); assert.equal(focusStyle.shadow, 'none');
    console.log('PASS editor survives repaint; click-away removes selection; blank double-click creates no text; no canvas focus ring');
    // Explicit text creation, then leaving it empty, must leave no placeholder.
    await a.evaluate(() => app.workspace.activeView.input.setTool('text'));
    await a.mouse.click(stage.x + stage.width - 120, stage.y + 330);
    await a.locator('.b-editor').waitFor();
    await a.mouse.click(stage.x + stage.width - 90, stage.y + 410);
    await a.locator('.b-editor').waitFor({ state: 'detached' });
    assert.equal(await a.evaluate(() => app.workspace.activeView.doc.elements.filter(el => el.kind === 'text').length), 1);
    console.log('PASS leaving a new empty text block removes the placeholder');
    await a.route('**/api/file?name=*', async route => { await new Promise(resolve => setTimeout(resolve, 400)); await route.continue(); });
    const preview = await a.evaluate(() => {
      const v = app.workspace.activeView;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(256, 256);
      for (let i = 0; i < pixels.data.length; i += 4) { pixels.data[i] = i % 251; pixels.data[i+1] = Math.random() * 255; pixels.data[i+2] = i % 123; pixels.data[i+3] = 255; }
      ctx.putImageData(pixels, 0, 0);
      const bytes = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), c => c.charCodeAt(0));
      window.dropPromise = v.ui.dropFiles([new File([bytes], 'instant.png', { type: 'image/png' })], { x: 450, y: 160 });
      return { visible: !!document.querySelector('.board-import-preview'), size: bytes.length };
    });
    assert.equal(preview.visible, true); assert.ok(preview.size > 24 * 1024);
    await a.evaluate(() => window.dropPromise);
    await b.waitForFunction(() => [...document.querySelectorAll('.b-image img')].some(img => img.complete && img.naturalWidth === 256), null, { timeout: 15000 });
    assert.equal(fs.readdirSync(path.join(temp, 'drive', 'files')).map(f => JSON.parse(fs.readFileSync(path.join(temp, 'drive', 'files', f)))).filter(f => f.appProperties?.opaleKind === 'attachment' || f.props?.opaleKind === 'attachment').length, 0);
    console.log(`PASS immediate drop preview and multi-chunk peer image (${preview.size} bytes) while Drive is offline`);
    const imageId = await a.evaluate(() => app.workspace.activeView.doc.elements.find(el => el.kind === 'image').id);
    await a.evaluate(id => { const v = app.workspace.activeView, el = v.byId.get(id); v.history.begin('move'); v.history.capture(el); el.x += 80; el.w += 40; v.sync([id]); }, imageId);
    await b.waitForFunction(id => app.workspace.activeView.nodes.get(id)?.style.transform.includes('scale('), imageId);
    assert.equal(await b.evaluate(id => app.workspace.activeView.byId.get(id).x, imageId), 450);
    await a.evaluate(() => { const v = app.workspace.activeView; v.history.commit(); v.markDirty(); v.sync(); });
    await b.waitForFunction(id => app.workspace.activeView.byId.get(id).x === 530 && !app.workspace.activeView.nodes.get(id)?.style.transform.includes('scale('), imageId);
    console.log('PASS remote image moves/resizes live before the final transaction is committed');
    // The pending skeleton is visible for an image whose bytes have not arrived.
    await b.evaluate(() => { const v = app.workspace.activeView; const missing = `@shared/${project.id}/assets/sha256-${'a'.repeat(64)}/pending.png`; v.change(() => v.add(window.OpaleBoard.create('image', { x: 800, y: 200, data: { file: missing } }))); });
    await b.waitForSelector('.b-image.media-loading');
    assert.equal(await b.locator('.b-image.media-loading').evaluate(el => getComputedStyle(el).animationName), 'media-shimmer');
    await b.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await b.locator('.b-image.media-loading').evaluate(el => getComputedStyle(el).animationName), 'none');
    console.log('PASS shimmer skeleton and reduced-motion support');
    const txtPath = await a.evaluate(async () => {
      const result = await api(`/api/file?name=lecture.txt&source=${encodeURIComponent(app.workspace.activeView.path)}`, { method: 'PUT', body: new File(['Bonjour <script>window.injected=true</script> éà'], 'lecture.txt', { type: 'text/plain' }), raw: true });
      app.workspace.openPath(result.path, { newTab: true }); return result.path;
    });
    await a.waitForFunction(() => document.querySelector('.file-text')?.textContent.includes('éà'));
    assert.equal(await a.evaluate(() => window.injected), undefined);
    assert.ok((await a.locator('.file-text').textContent()).includes('<script>'));
    console.log('PASS shared .txt opens as literal UTF-8 text without executing HTML');
    fs.rmSync(path.join(temp, 'drive', 'offline-all'));
    // Preserve a reproducible screenshot outside the disposable test profile.
    const output = path.resolve('artifacts'); fs.mkdirSync(output, { recursive: true });
    await b.evaluate(() => app.workspace.activeView.zoomToFit(false));
    await b.screenshot({ path: path.join(output, 'collab-loading-check.png') });
    assert.deepEqual(errors, []);
    console.log('PASS no browser JavaScript errors');
  } finally {
    if (browser) await browser.close();
    await Promise.all(children.map(child => new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill(); })));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
