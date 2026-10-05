'use strict';
// Run with NODE_PATH pointing to a Playwright installation, or install it locally.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
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
    const toolButtons = page.locator('.board-tools button[data-tool]');
    assert.equal(await toolButtons.count(), 11);
    const glyphs = await toolButtons.locator('svg').evaluateAll((icons) => icons.map((icon) => {
      if (!icon.children.length || icon.getAttribute('aria-hidden') !== 'true') throw new Error('Missing or unlabelled toolbar glyph');
      return icon.innerHTML;
    }));
    assert.equal(new Set(glyphs).size, 11, 'Every tool has a distinct glyph');
    for (let i = 0; i < 11; i++) {
      const control = toolButtons.nth(i); const tool = await control.getAttribute('data-tool');
      assert.ok(await control.getAttribute('aria-label'));
      await control.click();
      assert.equal(await control.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => window.__testApp.workspace.activeView.input.tool), tool);
      assert.equal(await page.locator('.board-tools [aria-pressed="true"]').count(), 1);
    }
    await page.locator('.board-tools [data-tool="select"]').click();
    if (process.env.OPALE_TEST_ARTIFACTS) {
      fs.mkdirSync(process.env.OPALE_TEST_ARTIFACTS, { recursive: true });
      const originalTheme = await page.locator('html').getAttribute('data-theme');
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
        await page.locator('.board-tools').screenshot({ path: path.join(process.env.OPALE_TEST_ARTIFACTS, `toolbar-${theme}.png`) });
      }
      await page.evaluate((value) => { if (value === null) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', value); }, originalTheme);
    }
    console.log('PASS 11 distinct toolbar icons, accessible labels and tool selection');
    const stage = await page.locator('.board-stage').boundingBox();
    await page.getByRole('button', { name: 'Pense-bête (N)', exact: true }).click();
    await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.locator('.b-editor').fill('Première idée');
    await page.keyboard.press(`${primaryModifier}+Enter`);
    await page.waitForFunction(() => { const v = window.__testApp.workspace.activeView; return !v.dirty && !v.saving && v.doc.elements.length === 1 && v.doc.elements[0].data.text === 'Première idée'; });
    const boardPath = await page.evaluate(async () => (await import('/js/core.js')).app.workspace.activeView.path);
    const read = () => Board.parse(fs.readFileSync(path.join(vault, boardPath), 'utf8')).doc;
    assert.equal(read().elements[0].data.text, 'Première idée');
    await page.keyboard.press(`${primaryModifier}+z`);
    await page.waitForFunction(() => window.__testApp.workspace.activeView.doc.elements[0].data.text === '');
    await page.keyboard.press(`${primaryModifier}+y`);
    await page.waitForFunction(() => window.__testApp.workspace.activeView.doc.elements[0].data.text === 'Première idée');
    console.log('PASS sticky creation, text edit, autosave, undo, redo');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByRole('button', { name: 'Formes', exact: true }).click();
    assert.ok(await page.locator('.board-library-item').count() > 10);
    await page.locator('.board-library-item').first().click();
    await page.waitForSelector('.k-shape');
    await page.locator('.b-editor').fill('Forme');
    await page.keyboard.press(`${primaryModifier}+Enter`);
    await page.getByRole('button', { name: 'Sélection (V)', exact: true }).click();
    const shape = await page.locator('.k-shape').boundingBox();
    await page.mouse.move(shape.x + shape.width / 2, shape.y + shape.height / 2);
    await page.mouse.down(); await page.mouse.move(shape.x + shape.width / 2 + 120, shape.y + shape.height / 2 + 80, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(() => window.__testApp.workspace.activeView.ui.selection.hidden);
    assert.equal(await page.locator('.board-guide, .board-marquee, .b-drag-ghost').count(), 0);
    // Cancelling a move rolls back geometry and removes every temporary aid.
    const cancelBox = await page.locator('.k-shape').boundingBox();
    const beforeMove = await page.evaluate(() => { const el = window.__testApp.workspace.activeView.doc.elements.find((el) => el.kind === 'shape'); return { x: el.x, y: el.y }; });
    await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2);
    await page.mouse.down(); await page.mouse.move(cancelBox.x + cancelBox.width / 2 + 70, cancelBox.y + cancelBox.height / 2 + 40, { steps: 4 });
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => { const el = window.__testApp.workspace.activeView.doc.elements.find((el) => el.kind === 'shape'); return { x: el.x, y: el.y }; }), beforeMove);
    assert.equal(await page.locator('.board-guide, .board-marquee, .b-drag-ghost, .is-moving').count(), 0);
    // Native file/path/library drops must finish without selection handles.
    await page.evaluate(() => {
      const v = window.__testApp.workspace.activeView; const r = v.stage.getBoundingClientRect();
      const data = new DataTransfer(); data.setData('text/x-opale-path', 'Idée.md');
      v.stage.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data, clientX: r.left + 70, clientY: r.top + 100 }));
      const module = new DataTransfer(); module.setData('application/x-opale-board', JSON.stringify({ kind: 'emoji', data: { char: '🎯' } }));
      v.stage.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: module, clientX: r.left + 200, clientY: r.top + 100 }));
      const file = new DataTransfer(); file.items.add(new File(['flowchart LR\n X-->Y'], 'drop.mmd', { type: 'text/plain' }));
      v.stage.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: file }));
      v.stage.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: file, clientX: r.left + 400, clientY: r.top + 100 }));
    });
    await page.waitForFunction(() => { const v = window.__testApp.workspace.activeView; return v.doc.elements.some((el) => el.kind === 'note') && v.doc.elements.some((el) => el.kind === 'emoji') && v.doc.elements.filter((el) => el.kind === 'shape').length >= 3 && v.ui.selection.hidden; });
    assert.equal(await page.locator('.board-selection:visible, .board-guide, .board-marquee, .b-drag-ghost, .is-dropping').count(), 0);
    // Page cleanup also runs when another view consumes the drop or on dragend.
    await page.evaluate(() => {
      const data = new DataTransfer(); data.items.add(new File(['x'], 'test.png', { type: 'image/png' }));
      document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: data }));
      document.body.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
    });
    assert.equal(await page.locator('.is-dropping, .is-dropping-note').count(), 0);
    console.log('PASS completed drag has no handles; Escape, native drops and global dragend clean up');
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
    // Test MCP against both the source server and the packaged executable.
    const mcpCheck = await page.evaluate(async () => {
      const { api } = await import('/js/core.js'); const connection = await api('/api/connection');
      const call = async (name, args) => {
        const response = await fetch('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
        const reply = await response.json(); if (reply.result.isError) throw new Error(reply.result.content[0].text); return JSON.parse(reply.result.content[0].text);
      };
      const icons = await call('board_catalog', { library: 'icon' });
      const added = await call('add_to_board', { path: 'Assistant', items: [{ kind: 'poll', x: 100, y: 200, data: { question: 'Choix', options: [{ text: 'A' }] } }, { kind: 'icon', data: icons.entries[0].data }] });
      const read = await call('read_board', { path: added.path });
      await call('edit_board', { path: added.path, base_mtime: read.mtime, updates: [{ id: added.ids[0], x: 450, data: { question: 'Modifiée' } }] });
      const imported = await call('import_to_board', { path: added.path, format: 'mermaid', source: 'flowchart LR\n A-->B' });
      return { icons: icons.count, imported: imported.ids.length, read: await call('read_board', { path: added.path }) };
    });
    assert.ok(mcpCheck.icons >= 240 && mcpCheck.imported >= 3);
    assert.equal(mcpCheck.read.elements.find((el) => el.kind === 'poll').data.question, 'Modifiée');
    assert.equal(mcpCheck.read.elements.find((el) => el.kind === 'poll').x, 450);
    console.log('PASS MCP libraries, module placement, editing and Mermaid import in running server');
    await page.evaluate(() => window.__testApp.workspace.openPath('Idée.md'));
    await page.waitForFunction(() => window.__testApp.workspace.activeNote && window.__testApp.workspace.activeNote.loaded);
    await page.evaluate(() => {
      const note = window.__testApp.workspace.activeNote; const r = note.body.getBoundingClientRect();
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer(); transfer.items.add(new File([png], 'dropped.png', { type: 'image/png' }));
      note.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
      note.body.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: r.left + 80, clientY: r.top + 80 }));
      note.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: r.left + 80, clientY: r.top + 80 }));
    });
    await page.waitForFunction(() => window.__testApp.workspace.activeNote.content.includes('dropped.png'));
    assert.equal(await page.locator('.is-dropping, .is-dropping-note, .img-drop-caret').count(), 0);
    const image = page.locator('.note-view:visible .markdown img').first();
    await image.waitFor(); const imageBox = await image.boundingBox();
    await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2);
    await page.mouse.down(); await page.mouse.move(imageBox.x + imageBox.width / 2 + 80, imageBox.y + imageBox.height / 2 + 60, { steps: 4 });
    await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up();
    assert.equal(await page.locator('.img-ghost, .img-drop-caret, .is-dragging-image').count(), 0);
    await page.evaluate(() => {
      const tree = document.querySelector('.tree'); const data = new DataTransfer(); data.setData('application/x-opale-path', 'Idée.md');
      tree.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
      tree.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
    });
    assert.equal(await page.locator('.drop-target').count(), 0);
    console.log('PASS note image drop/move cancellation and explorer dragend leave no ghost or marker');
    assert.deepEqual(errors, []);
    console.log('PASS tab switching, workspace restore, no JavaScript errors');
  } finally {
    if (browser) await browser.close();
    await server.close(); fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
