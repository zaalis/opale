'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-shared-browser-'));
process.env.OPALE_HOME = path.join(temp, 'home');
process.env.OPALE_FAKE_DRIVE = path.join(temp, 'drive');
process.env.OPALE_FAKE_EMAIL = 'alice@example.test';
process.env.OPALE_KEY_PROTECTION = 'none';
const vault = path.join(temp, 'vault'); fs.mkdirSync(vault);
const { createOpale } = require('../server.js');
function packagedServer(executable) {
  let child;
  return {
    listen: () => new Promise((resolve, reject) => {
      child = require('node:child_process').spawn(path.resolve(executable), ['--port', '0', '--vault', vault], { env: process.env, windowsHide: true });
      let output = ''; const timer = setTimeout(() => reject(new Error('Packaged server did not start')), 15000);
      child.once('error', reject); child.once('exit', code => reject(new Error(`Packaged server exited: ${code}`)));
      child.stdout.on('data', chunk => { output += chunk; const hit = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output); if (hit) { clearTimeout(timer); resolve(Number(hit[1])); } });
    }),
    close: async () => { if (!child || child.exitCode !== null) return; const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done; },
  };
}
(async () => {
  const server = process.env.OPALE_TEST_SERVER ? packagedServer(process.env.OPALE_TEST_SERVER) : createOpale({ port: 0, vaultPath: vault }); let browser;
  try {
    const port = await server.listen();
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage(); const errors = [];
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR:', error.message); });
    page.on('console', message => { if (message.type() === 'error') console.log('BROWSER:', message.text()); });
    page.on('response', response => { if (response.url().includes('download=1')) console.log('DOWNLOAD RESPONSE:', response.status(), response.headers()['content-disposition']); });
    await page.goto(`http://127.0.0.1:${port}`); await page.waitForSelector('.tabs');
    await page.evaluate(async () => {
      const { app, api } = await import('/js/core.js'); window.testApp = app;
      const info = await api('/api/collab/create', { method: 'POST', body: { name: 'Test' } });
      await app.collab.load(); const project = await app.collab.open(info.projectId); window.testProject = project;
      const note = project.files().find(f => f.kind === 'note'); app.workspace.openPath(project.pathOf(note));
    });
    await page.waitForFunction(() => window.testApp.workspace.activeNote?.loaded);
    await page.evaluate(() => {
      const note = window.testApp.workspace.activeNote, rect = note.body.getBoundingClientRect();
      const transfer = new DataTransfer();
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a5kAAAAASUVORK5CYII='), c => c.charCodeAt(0));
      transfer.items.add(new File([bytes], 'photo.png', { type: 'image/png' }));
      note.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 80, clientY: rect.top + 80 }));
    });
    await page.waitForFunction(() => window.testApp.workspace.activeNote.content.includes('photo.png'));
    await page.waitForFunction(() => [...document.querySelectorAll('.note-view img')].some(i => i.complete && i.naturalWidth > 0));
    console.log('PASS shared note image rendered');
    await page.locator('.note-view:visible img.embed-image').first().evaluate(el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200, button: 2 })));
    const imageDownload = page.waitForEvent('download', { timeout: 15000 });
    imageDownload.catch(() => {});
    await page.getByRole('menuitem', { name: 'Télécharger l’image' }).click({ timeout: 3000 });
    assert.equal((await imageDownload).suggestedFilename(), 'photo.png');
    console.log('PASS image download');
    const videoPath = path.join(temp, 'clip.webm');
    require('node:child_process').execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=1:r=10', '-c:v', 'libvpx', '-y', videoPath]);
    const videoBase64 = fs.readFileSync(videoPath).toString('base64');
    await page.evaluate((encoded) => {
      const note = window.testApp.workspace.activeNote, rect = note.body.getBoundingClientRect(), transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], 'clip.webm', { type: 'video/webm' }));
      note.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 120, clientY: rect.top + 120 }));
    }, videoBase64);
    await page.waitForFunction(() => { const v = document.querySelector('.note-view video.embed-video'); return v && v.videoWidth === 32 && v.duration > 0; });
    await page.locator('.note-view video.embed-video').evaluate(v => v.play());
    await page.waitForFunction(() => document.querySelector('.note-view video.embed-video').currentTime > 0.1);
    console.log('PASS note video metadata');
    await page.locator('.note-view:visible video.embed-video').click({ button: 'right' });
    const videoDownload = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Télécharger le fichier' }).click();
    assert.equal((await videoDownload).suggestedFilename(), 'clip.webm');
    console.log('PASS video download');
    await page.evaluate(() => {
      const p = window.testProject; const id = p.createFile('board', 'Tableau');
      window.testApp.workspace.openPath(p.pathOf(p.file(id)));
    });
    await page.waitForFunction(() => window.testApp.workspace.activeView?.shared && window.testApp.workspace.activeView?.type === 'board' && window.testApp.workspace.activeView?.loaded);
    await page.evaluate(() => {
      const stage = document.querySelector('.board-stage'), rect = stage.getBoundingClientRect(), transfer = new DataTransfer();
      transfer.items.add(new File(['bonjour'], 'document.txt', { type: 'text/plain' }));
      stage.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 100, clientY: rect.top + 100 }));
    });
    await page.waitForFunction(() => window.testApp.workspace.activeView.doc.elements.some(e => e.data.file?.endsWith('/document.txt')));
    const result = await page.evaluate(async () => {
      const e = window.testApp.workspace.activeView.doc.elements.find(e => e.data.file?.endsWith('/document.txt'));
      const response = await fetch(`/api/file?path=${encodeURIComponent(e.data.file)}`); return { status: response.status, text: await response.text() };
    });
    assert.deepEqual(result, { status: 200, text: 'bonjour' }); assert.deepEqual(errors, []);
    await page.locator('.board-stage .b-file').first().click({ button: 'right' });
    const fileDownload = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Télécharger le fichier' }).click();
    assert.equal((await fileDownload).suggestedFilename(), 'document.txt');
    console.log('PASS board file download');
    await page.evaluate(() => {
      const stage = document.querySelector('.board-stage'), rect = stage.getBoundingClientRect(), transfer = new DataTransfer();
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a5kAAAAASUVORK5CYII='), c => c.charCodeAt(0));
      transfer.items.add(new File([bytes], 'board-photo.png', { type: 'image/png' }));
      stage.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 350, clientY: rect.top + 250 }));
    });
    await page.waitForFunction(() => { const img = document.querySelector('.board-stage .b-image img'); return img && img.complete && img.naturalWidth > 0; });
    await page.evaluate((encoded) => {
      const stage = document.querySelector('.board-stage'), rect = stage.getBoundingClientRect(), transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], 'board-video.webm', { type: 'video/webm' }));
      stage.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 250, clientY: rect.top + 180 }));
    }, videoBase64);
    await page.waitForFunction(() => { const v = document.querySelector('.board-stage video'); return v && v.videoWidth === 32 && v.duration > 0; });
    await page.locator('.board-stage video').evaluate(v => v.play());
    await page.waitForFunction(() => document.querySelector('.board-stage video').currentTime > 0.1);
    assert.deepEqual(errors, []);
    console.log('PASS image, video and file drops, playback and context-menu downloads');
  } finally { if (browser) await browser.close(); await server.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
