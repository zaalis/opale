'use strict';
// Run with NODE_PATH pointing to a Playwright installation, or install it locally.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-browser-'));
process.env.OPALE_HOME = path.join(temp, 'home');
const vault = path.join(temp, 'Coffre'); fs.mkdirSync(vault);
fs.writeFileSync(path.join(vault, 'Idée.md'), '# Idée\nUne note de référence.\n');
const { createOpale } = require('../server.js');
const Board = require('../shared/board.js');
function packagedServer(executable) {
  let child;
  return {
    listen: () => new Promise((resolve, reject) => {
      child = require('node:child_process').spawn(path.resolve(executable), ['--port', '0', '--vault', vault], { env: process.env, windowsHide: true });
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Packaged server did not start in 15 seconds')), 15000);
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Packaged server exited (${code})`)); });
      child.stdout.on('data', (chunk) => { output += chunk; const hit = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output); if (hit) { clearTimeout(timeout); resolve(Number(hit[1])); } });
      child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    }),
    close: async () => { if (!child || child.exitCode !== null) return; const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; },
  };
}

(async () => {
  const server = process.env.OPALE_TEST_SERVER ? packagedServer(process.env.OPALE_TEST_SERVER) : createOpale({ port: 0, vaultPath: vault });
  let browser;
  const errors = [];
  try {
    const port = await server.listen();
    browser = await chromium.launch({ headless: true, channel: process.env.OPALE_TEST_BROWSER || 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForSelector('.tabs');
    await page.evaluate(async () => { const { app } = await import('/js/core.js'); window.__testApp = app; await app.explorer.newBoard(''); });
    await page.waitForSelector('.board-stage');
    await page.waitForFunction(() => window.__testApp.workspace.activeView.loaded);
    const stage = await page.locator('.board-stage').boundingBox();
    await page.getByRole('button', { name: 'Pense-bête (N)', exact: true }).click();
    await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.locator('.b-editor').fill('Première idée');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => { const v = window.__testApp.workspace.activeView; return !v.dirty && !v.saving && v.doc.elements.length === 1 && v.doc.elements[0].data.text === 'Première idée'; });
    const boardPath = await page.evaluate(async () => (await import('/js/core.js')).app.workspace.activeView.path);
    const read = () => Board.parse(fs.readFileSync(path.join(vault, boardPath), 'utf8')).doc;
    assert.equal(read().elements[0].data.text, 'Première idée');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.__testApp.workspace.activeView.doc.elements[0].data.text === '');
    await page.keyboard.press('Control+y');
    await page.waitForFunction(() => window.__testApp.workspace.activeView.doc.elements[0].data.text === 'Première idée');
    console.log('PASS sticky creation, text edit, autosave, undo, redo');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByRole('button', { name: 'Formes', exact: true }).click();
    assert.ok(await page.locator('.board-library-item').count() > 10);
    await page.locator('.board-library-item').first().click();
    await page.waitForSelector('.k-shape');
    const shape = await page.locator('.k-shape').boundingBox();
    await page.mouse.move(shape.x + shape.width / 2, shape.y + shape.height / 2);
    await page.mouse.down(); await page.mouse.move(shape.x + shape.width / 2 + 120, shape.y + shape.height / 2 + 80, { steps: 8 }); await page.mouse.up();
    await page.evaluate(async () => { const { app } = await import('/js/core.js'); const v = app.workspace.activeView; v.ui.importMermaid('flowchart LR\n A[Idée] --> B[Prototype]', { x: -300, y: 300 }); v.zoomToFit(false); });
    await page.waitForSelector('.k-connector');
    console.log('PASS shape library, pointer drag, Mermaid import and connectors');
    await page.evaluate(async () => {
      const { app } = await import('/js/core.js'); const v = app.workspace.activeView;
      const result = await window.OpaleBoardDrawio.importText('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="draw.io" vertex="1" parent="1"><mxGeometry x="0" y="0" width="160" height="80" as="geometry"/></mxCell></root></mxGraphModel>', { x: 400, y: 300 });
      if (result.error) throw new Error(result.error); v.ui.importResult(result);
      for (const [i, kind] of Object.keys(window.OpaleBoard.KINDS).filter((kind) => !['connector', 'stroke'].includes(kind)).entries()) {
        v.ui.placeItem({ kind, data: kind === 'mermaid' ? { source: 'flowchart LR\n A-->B' } : kind === 'note' ? { file: 'Idée.md' } : {}, x: 0 }, { x: (i % 5) * 600 - 1200, y: Math.floor(i / 5) * 650 + 700 });
      }
      v.clearSelection(); v.zoomToFit(false); await v.flush();
    });
    await page.waitForTimeout(700);
    assert.ok(read().elements.length >= 30);
    assert.equal(await page.locator('.b-mermaid-error').count(), 0);
    console.log('PASS draw.io import, rendering all kinds, file persistence');
    // Verify tab lifecycle and reload.
    await page.evaluate(async () => { const { app } = await import('/js/core.js'); const v = app.workspace.activeView; v.zoomToBox({ x: -350, y: -150, w: 1000, h: 850 }, false); });
    await page.evaluate(async () => { const { app } = await import('/js/core.js'); app.workspace.newTab(); });
    assert.equal(await page.locator('.board-view:visible').count(), 0);
    await page.evaluate(async (p) => { const { app } = await import('/js/core.js'); app.workspace.openPath(p); await app.workspace.flushAll(); app.workspace.persistNow(); }, boardPath);
    await page.waitForTimeout(200); await page.reload();
    await page.waitForSelector('.board-stage');
    await page.evaluate(async () => { window.__testApp = (await import('/js/core.js')).app; });
    await page.waitForFunction(() => window.__testApp.workspace.activeView.loaded);
    assert.ok(await page.locator('.b-el').count() >= 30);
    // Disk changes must not silently overwrite an edit in progress.
    await page.evaluate(() => { const v = window.__testApp.workspace.activeView; v.change(() => { const el = v.doc.elements.find((el) => el.kind === 'sticky'); v.touch(el); el.data.text = 'Modification locale'; }); clearTimeout(v.saveTimer); });
    const external = read(); external.elements.find((el) => el.kind === 'sticky').data.text = 'Version disque';
    fs.writeFileSync(path.join(vault, boardPath), Board.serialize(external));
    await page.evaluate(() => window.__testApp.workspace.activeView.externalChange());
    await page.waitForFunction(() => window.__testApp.workspace.activeView.conflict);
    assert.equal(read().elements.find((el) => el.kind === 'sticky').data.text, 'Version disque');
    await page.getByRole('button', { name: 'Charger la version du disque', exact: true }).click();
    await page.waitForFunction(() => !window.__testApp.workspace.activeView.conflict);
    assert.equal(await page.evaluate(() => window.__testApp.workspace.activeView.doc.elements.find((el) => el.kind === 'sticky').data.text), 'Version disque');
    console.log('PASS external edit conflict, explicit disk version recovery');
    // Failed saves retry later, without an immediate unbounded request loop.
    let attempts = 0;
    await page.route('**/api/note', async (route) => { if (route.request().method() === 'PUT') { attempts++; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Test indisponible"}' }); } else await route.continue(); });
    await page.evaluate(() => { const v = window.__testApp.workspace.activeView; const el = v.doc.elements.find((el) => el.kind === 'sticky'); v.mutate(el, (d) => { d.text = 'Après une panne'; }); return v.save(); });
    await page.waitForTimeout(500); assert.equal(attempts, 1);
    assert.equal(await page.evaluate(() => window.__testApp.workspace.activeView.unsaved), true);
    await page.unroute('**/api/note'); await page.evaluate(() => window.__testApp.workspace.activeView.flush());
    assert.equal(read().elements.find((el) => el.kind === 'sticky').data.text, 'Après une panne');
    console.log('PASS failed-save backoff, unsaved content retained, recovery');
    await page.evaluate(async () => { const { api } = await import('/js/core.js'); const p = await api('/api/note', { method: 'POST', body: { name: 'Endommagé', ext: 'canvas', content: '{cassé' } }); await window.__testApp.workspace.waitFor(p.path); window.__testApp.workspace.openPath(p.path); });
    await page.waitForFunction(() => window.__testApp.workspace.activeView.loaded && window.__testApp.workspace.activeView.readOnly);
    await page.evaluate(() => { const v = window.__testApp.workspace.activeView; v.ui.placeItem({ kind: 'sticky' }); v.undo(); return v.flush(); });
    assert.equal(fs.readFileSync(path.join(vault, 'Endommagé.canvas'), 'utf8'), '{cassé');
    console.log('PASS damaged canvas stays read-only and byte-for-byte intact');
    assert.deepEqual(errors, []);
    console.log('PASS tab switching, workspace restore, no JavaScript errors');
  } finally {
    if (browser) await browser.close();
    await server.close(); fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
