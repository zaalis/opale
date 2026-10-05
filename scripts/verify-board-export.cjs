'use strict';
// Exercises the actual menu downloads against source or packaged Opale.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-export-'));
process.env.OPALE_HOME = path.join(temp, 'home');
const vault = path.join(temp, 'Coffre'); fs.mkdirSync(vault);
fs.writeFileSync(path.join(vault, 'Image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#0000ff"/></svg>');
const Board = require('../shared/board.js');
const doc = Board.emptyDoc();
doc.layers.push({ id: 'hidden', name: 'Masqué', visible: false, locked: false });
doc.elements.push(
  Board.create('shape', { x: -300, y: -200, w: 200, h: 200, data: { shape: 'rect' }, style: { fill: '#ff0000', stroke: '#ff0000' } }),
  Board.create('image', { x: 200, y: -200, w: 100, h: 100, data: { file: 'Image.svg' } }),
  Board.create('text', { x: -300, y: 100, data: { text: 'Export été — Texte lisible' } }),
  Board.create('sticky', { x: 900, y: 400, rotation: 30, data: { text: 'Hors écran' } }),
  Board.create('shape', { x: 100000, y: 100000, layer: 'hidden' }),
);
doc.elements.push(Board.create('connector', { from: { id: doc.elements[0].id, side: 'right' }, to: { id: doc.elements[3].id, side: 'left' }, data: { label: 'Connexion' } }));
fs.writeFileSync(path.join(vault, 'Export.canvas'), Board.serialize(doc));
let browser; let child;
const server = process.env.OPALE_TEST_SERVER ? {
  listen: () => new Promise((resolve, reject) => {
    child = require('node:child_process').spawn(path.resolve(process.env.OPALE_TEST_SERVER), ['--port', '0', '--vault', vault], { windowsHide: true, env: process.env });
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 15000);
    let output = '';
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
    child.stdout.on('data', (chunk) => { output += chunk; const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
  }),
  close: async () => { if (child && child.exitCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; } },
} : require('../server.js').createOpale({ port: 0, vaultPath: vault });
(async () => {
  const errors = [];
  try {
    const port = await server.listen();
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}`); await page.waitForSelector('.tabs');
    await page.evaluate(async () => { const { app } = await import('/js/core.js'); window.__testApp = app; app.workspace.openPath('Export.canvas'); });
    await page.waitForFunction(() => window.__testApp.workspace.activeView.loaded);
    await page.locator('.b-image img').evaluate((img) => img.decode());
    const original = fs.readFileSync(path.join(vault, 'Export.canvas'), 'utf8');
    const capture = async () => page.evaluate(async () => {
      const v = window.__testApp.workspace.activeView;
      const { captureBoard } = await import('/js/board/export.js');
      const canvas = await captureBoard(v); const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0; let blue = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 240 && data[i + 1] < 20 && data[i + 2] < 20) red++;
        if (data[i] < 20 && data[i + 1] < 20 && data[i + 2] > 240) blue++;
      }
      return { width: canvas.width, height: canvas.height, red, blue, png: canvas.toDataURL() };
    });
    const first = await capture();
    assert.ok(first.width > 2000 && first.width < 4000, 'Entire board exported; hidden distant layer omitted');
    assert.ok(first.red > 100000 && first.blue > 20000, 'Shapes and embedded local images render');
    await page.evaluate(() => { const v = window.__testApp.workspace.activeView; v.camera = { x: 500, y: -600, k: 0.1 }; v.applyCamera(); });
    const second = await capture(); assert.equal(first.png, second.png, 'Export is camera independent');
    const artifacts = process.env.OPALE_TEST_ARTIFACTS || path.join(temp, 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(path.join(artifacts, 'export-preview.png'), Buffer.from(first.png.split(',')[1], 'base64'));
    for (const format of ['jpg', 'pdf']) {
      await page.getByRole('button', { name: 'Options du moodboard', exact: true }).click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByText(`Exporter en ${format.toUpperCase()} (.${format})`, { exact: true }).click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), `Export.${format}`);
      const file = path.join(artifacts, `Export.${format}`); await download.saveAs(file);
      const bytes = fs.readFileSync(file); assert.ok(bytes.length > 10000);
      if (format === 'jpg') assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff');
      else assert.equal(bytes.subarray(0, 8).toString(), '%PDF-1.4');
    }
    // Empty boards fail clearly rather than downloading an invalid file.
    const empty = await page.evaluate(async () => {
      const { captureBoard } = await import('/js/board/export.js'); const v = window.__testApp.workspace.activeView;
      const elements = v.doc.elements; v.doc.elements = [];
      try { await captureBoard(v); return ''; } catch (error) { return error.message; } finally { v.doc.elements = elements; }
    });
    assert.match(empty, /aucun élément visible/);
    assert.equal(fs.readFileSync(path.join(vault, 'Export.canvas'), 'utf8'), original);
    assert.deepEqual(errors, []);
    console.log('PASS PDF/JPG menu downloads; complete board, negative positions, rotation, connectors, local images, hidden layers, camera independence, empty board; source unchanged');
  } finally { if (browser) await browser.close(); await server.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
