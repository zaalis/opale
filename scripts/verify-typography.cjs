'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-type-'));
const children = [], output = path.resolve('artifacts/typography'); fs.mkdirSync(output, { recursive: true });
async function start(name, email) {
  const vault = path.join(temp, name, 'vault'); fs.mkdirSync(vault, { recursive: true });
  const fixture = '---\nprojet: Typographie\n---\n\n# Nostalgie\n\nUne vieille maison familiale est restée inhabitée.\n\nChaque pièce raconte une histoire.\n\n```js\nconsole.log("conserver");\n```\n';
  fs.writeFileSync(path.join(vault, 'Typographie.md'), fixture);
  const child = spawn(process.env.OPALE_TEST_SERVER || process.execPath, [...(process.env.OPALE_TEST_SERVER ? [] : [path.resolve('server.js')]), '--port', '0', '--vault', vault], { windowsHide: true, env: { ...process.env, OPALE_HOME: path.join(temp, name, 'home'), OPALE_FAKE_DRIVE: path.join(temp, 'drive'), OPALE_FAKE_EMAIL: email, OPALE_KEY_PROTECTION: 'none', OPALE_COLLAB_POLL_MS: '200' } });
  children.push(child);
  const url = await new Promise((resolve, reject) => {
    let text = ''; const timer = setTimeout(() => reject(Error('Startup timeout')), 20000);
    child.on('error', reject); child.stderr.on('data', d => process.stderr.write(d));
    child.stdout.on('data', d => { text += d; const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(text); if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); } });
  }); return { url, vault, fixture };
}
(async () => {
  let browser;
  try {
    const [alice, bob] = await Promise.all([start('alice', 'alice@example.test'), start('bob', 'bob@example.test')]);
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
    const ca = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), cb = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const a = await ca.newPage(), b = await cb.newPage(), errors = [];
    for (const page of [a, b]) { page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message)); }
    await Promise.all([a.goto(alice.url), b.goto(bob.url)]);
    for (const page of [a, b]) {
      await page.waitForSelector('.tabs');
      await page.evaluate(async () => { const { app, api } = await import('/js/core.js'); window.app = app; window.api = api; });
    }
    await a.evaluate(() => app.workspace.openPath('Typographie.md', { mode: 'rich' }));
    await a.waitForSelector('.rich-note');
    assert.equal(await a.evaluate(() => app.workspace.activeView.content), alice.fixture);
    await a.waitForFunction(() => document.querySelector('.type-font')?.dataset.catalogCount === '104');
    await a.evaluate(() => { const r = app.workspace.activeView.rich; r.el.focus(); const at = r.el.textContent.indexOf('Une vieille'); r.selectOffsets(at, at + 'Une vieille maison familiale'.length); });
    await a.getByRole('combobox', { name: 'Police d’écriture', exact: true }).selectOption('EB Garamond');
    assert.match(await a.evaluate(() => app.workspace.activeView.content), /font=EB Garamond/);
    await a.getByRole('spinbutton', { name: 'Taille de police en pixels', exact: true }).fill('28');
    await a.getByRole('spinbutton', { name: 'Taille de police en pixels', exact: true }).press('Tab');
    await a.getByRole('combobox', { name: 'Épaisseur de police', exact: true }).selectOption('700');
    await a.evaluate(() => app.workspace.activeView.flush());
    const saved = fs.readFileSync(path.join(alice.vault, 'Typographie.md'), 'utf8');
    assert.match(saved, /font=EB Garamond/); assert.match(saved, /size=28/); assert.match(saved, /weight=700/);
    assert.ok(saved.includes('---\nprojet: Typographie\n---')); assert.ok(saved.includes('```js\nconsole.log("conserver");\n```'));
    await a.evaluate(() => { const v = app.workspace.activeView; v.setMode('reading'); v.setMode('rich'); });
    const computed = await a.locator('.rich-note span[data-opale]').last().evaluate(el => ({ font: getComputedStyle(el).fontFamily, size: getComputedStyle(el).fontSize }));
    assert.match(computed.font, /EB Garamond/); assert.equal(computed.size, '28px');
    console.log('PASS local font/size/weight persist through save and reopen; code/properties unchanged');
    await a.evaluate(() => { const r = app.workspace.activeView.rich; r.el.focus(); const at = r.el.textContent.indexOf('Une vieille'); r.selectOffsets(at, at + 'Une vieille maison familiale'.length); });
    await a.getByRole('button', { name: 'Gras (Ctrl+B)', exact: true }).click();
    await a.evaluate(() => { const v = app.workspace.activeView; v.setMode('reading'); v.setMode('rich'); });
    assert.equal(await a.locator('.rich-note span[data-opale]').last().evaluate(el => getComputedStyle(el).fontWeight), '400');
    console.log('PASS explicit font weight can be toggled back to normal and survives reopen');
    await a.evaluate(() => { const v = app.workspace.activeView; const r = v.rich; r.el.focus(); const at = r.el.textContent.indexOf('Nostalgie'); r.selectOffsets(at, at + 'Nostalgie'.length); v.typebar.update(); });
    assert.equal(await a.getByRole('button', { name: 'Gras (Ctrl+B)', exact: true }).getAttribute('aria-pressed'), 'false', 'a heading is not the bold button');
    await a.evaluate(() => { const r = app.workspace.activeView.rich; r.el.focus(); const at = r.el.textContent.indexOf('Chaque'); r.selectOffsets(at, at + 'Chaque'.length); });
    await a.getByRole('button', { name: 'Gras (Ctrl+B)', exact: true }).click();
    assert.equal(await a.getByRole('button', { name: 'Gras (Ctrl+B)', exact: true }).getAttribute('aria-pressed'), 'true');
    await a.getByRole('tab', { name: 'Fichiers' }).click();
    assert.equal(await a.getByRole('button', { name: 'Gras (Ctrl+B)', exact: true }).getAttribute('aria-pressed'), 'false', 'bold releases after the selection leaves');
    await a.locator('.inline-title').click();
    await a.getByRole('combobox', { name: 'Police d’écriture', exact: true }).selectOption('Lora');
    await a.getByRole('button', { name: 'Gras (Ctrl+B)', exact: true }).click();
    const titled = await a.evaluate(() => ({ text: app.workspace.activeView.content, font: getComputedStyle(app.workspace.activeView.titleEl).fontFamily, weight: getComputedStyle(app.workspace.activeView.titleEl).fontWeight, pressed: document.querySelector('[aria-label="Gras (Ctrl+B)"]').getAttribute('aria-pressed') }));
    assert.match(titled.text, /opale-titre:[^\n]*font=Lora/);
    assert.match(titled.text, /weight=400/);
    assert.match(titled.font, /Lora/);
    assert.equal(titled.weight, '400');
    assert.equal(titled.pressed, 'false');
    await a.locator('.rich-note').click();
    await a.keyboard.press('Control+End');
    await a.keyboard.type('X');
    await a.keyboard.press('Backspace');
    assert.match(await a.evaluate(() => app.workspace.activeView.content), /font=Lora/, 'title style survives the next edit in the page');
    await a.locator('.inline-title').click();
    await a.getByRole('button', { name: 'Retirer la mise en forme', exact: true }).click();
    assert.ok(!(await a.evaluate(() => app.workspace.activeView.content)).includes('opale-titre'));
    console.log('PASS title typography applies, persists, and bold releases outside the selection');
    for (const [label, property, expected] of [['Italique (Ctrl+I)','fontStyle','italic'],['Souligner (Ctrl+U)','textDecorationLine','underline'],['Barrer','textDecorationLine','line-through']]) {
      for (const enabled of [true, false]) {
        await a.evaluate(() => { const r = app.workspace.activeView.rich; r.el.focus(); const at = r.el.textContent.indexOf('Une vieille'); r.selectOffsets(at, at + 'Une vieille maison familiale'.length); });
        await a.getByRole('button', { name: label, exact: true }).click();
        await a.evaluate(() => { const v = app.workspace.activeView; v.setMode('reading'); v.setMode('rich'); });
        const value = await a.evaluate(property => { const walker = document.createTreeWalker(app.workspace.activeView.rich.el, NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) if (n.textContent.includes('Une vieille maison familiale')) return getComputedStyle(n.parentElement)[property]; }, property);
        assert.equal(value.includes(expected), enabled, label + ' toggle');
      }
    }
    console.log('PASS italic, underline and strike toggle on/off and survive reopen');
    await a.evaluate(() => { const r = app.workspace.activeView.rich; r.el.focus(); const at = r.el.textContent.indexOf('Une vieille'); r.selectOffsets(at, at + 'Une vieille maison familiale'.length); r.apply({highlight:'#facc15',color:'#224466'}); });
    await a.getByRole('button', { name: 'Retirer la mise en forme', exact: true }).click();
    await a.evaluate(() => { const v = app.workspace.activeView; v.setMode('reading'); v.setMode('rich'); });
    assert.ok(!(await a.evaluate(() => app.workspace.activeView.content)).includes('highlight='));
    console.log('PASS highlight/color and removing formatting preserve the text');
    for (const align of ['center','right']) {
      await a.evaluate(() => { const r = app.workspace.activeView.rich; r.el.focus(); const at = r.el.textContent.indexOf('Une vieille'); r.selectOffsets(at,at+4); });
      await a.getByRole('combobox',{name:'Alignement du texte',exact:true}).selectOption(align);
      await a.getByRole('combobox',{name:'Interligne',exact:true}).selectOption('2');
      await a.evaluate(() => {const v=app.workspace.activeView;v.setMode('reading');v.setMode('rich');});
      assert.ok((await a.evaluate(()=>app.workspace.activeView.content)).includes('align='+align));
      assert.ok((await a.evaluate(()=>app.workspace.activeView.content)).includes('leading=2'));
    }
    console.log('PASS alignment and line spacing persist and can be changed again');




    await a.bringToFront(); await a.locator('.rich-note').focus(); await a.keyboard.press('Control+a'); await a.keyboard.press('Backspace');
    assert.equal((await a.evaluate(() => app.workspace.activeView.content)).trim(), '');
    await a.keyboard.press('Control+z');
    assert.match(await a.evaluate(() => app.workspace.activeView.content), /maison familiale/);
    console.log('PASS Ctrl+A deletes across every paragraph; undo restores the document');
    const copy = '01 — NOSTALGIE\n\nScénario : La Maison des souvenirs\n\nUne vieille maison familiale est restée inhabitée pendant près de trente ans.';
    await a.locator('.rich-note').focus(); await a.keyboard.press('Control+a');
    await a.evaluate(text => { const data = new DataTransfer(); data.setData('text/plain', text); document.querySelector('.rich-note').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }, copy);
    const pasted = await a.locator('.rich-note').innerText();
    assert.ok(pasted.includes('Une vieille maison familiale')); assert.ok(!pasted.includes('UNE VIEILLE'));
    assert.ok(await a.locator('.rich-note p').count() >= 2);
    await a.evaluate(() => {
      const r = app.workspace.activeView.rich; r.selectOffsets(0, 2);
      r.insertHTML('<span style="font-family:Inter;font-size:24px;font-weight:700;color:#224466" onclick="window.evil=1">Essai</span><img src=x onerror="window.evil=2"><script>window.evil=3</script>');
    });
    assert.equal(await a.evaluate(() => window.evil), undefined);
    assert.match(await a.evaluate(() => app.workspace.activeView.content), /size=24/);
    console.log('PASS PDF-like multiline paste preserves case; rich paste keeps supported styles and removes executable HTML');
    await a.evaluate(async () => {
      const r = app.workspace.activeView.rich; r.el.focus(); r.selectOffsets(r.el.textContent.length);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 24; canvas.getContext('2d').fillRect(0,0,24,24);
      const blob = await new Promise(resolve => canvas.toBlob(resolve));
      const data = new DataTransfer(); data.items.add(new File([blob],'image-collee.png',{type:'image/png'}));
      r.el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    });
    await a.waitForFunction(() => app.workspace.activeView.content.includes('image-collee.png'));
    await a.evaluate(() => { const v = app.workspace.activeView; v.setMode('reading'); v.setMode('rich'); });
    await a.waitForFunction(() => [...document.querySelectorAll('.rich-note img')].some(img=>img.complete&&img.naturalWidth===24));
    console.log('PASS pasted image remains a local attachment after save/reopen');

    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([600, 800]);
    page.drawText('NOSTALGIE', { x: 50, y: 740, size: 18, font }); page.drawText('Une vieille maison familiale', { x: 50, y: 700, size: 12, font });
    const pdfBytes = process.env.OPALE_TEST_PDF ? fs.readFileSync(process.env.OPALE_TEST_PDF) : await pdf.save();
    const imported = await a.evaluate(async bytes => { const { pdfToMarkdown } = await import('/js/note-documents.js'); return pdfToMarkdown(Uint8Array.from(atob(bytes), c => c.charCodeAt(0))); }, Buffer.from(pdfBytes).toString('base64'));
    assert.match(imported, /NOSTALGIE/); assert.match(imported, /Une vieille maison familiale/); assert.ok(!imported.includes('&#39;'));
    await a.evaluate(text => { const v = app.workspace.activeView; v.setContent(text, { step: true }); v.render(); }, imported);
    console.log('PASS PDF extraction retains uppercase title, lowercase body and editable font sizes');
    // All external requests are refused; all 64 families must still load.
    await ca.route('**/*', route => new URL(route.request().url()).origin === alice.url || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    const fonts = await a.evaluate(async () => { const { fontCatalog } = await import('/js/typography.js'); const list = await fontCatalog(); for (const f of list) { await document.fonts.load(`18px "${f.name}"`, 'Éà nostalgie'); if (!document.fonts.check(`18px "${f.name}"`)) throw Error('Font not loaded ' + f.name); } return list.length; });
    assert.equal(fonts, 104); console.log('PASS all 104 Google Fonts load with external network blocked');
    await a.evaluate(() => { window.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async blob => { window.pdfResult = await blob.arrayBuffer(); }, close: async () => {}, abort: async () => {} }) }); });
    await a.getByRole('button', { name: 'Plus d’options', exact: true }).click();
    await a.getByRole('menuitem', { name: 'Exporter en PDF…' }).click();
    await a.waitForFunction(() => window.pdfResult?.byteLength > 1000, null, { timeout: 120000 });
    const exportBytes = Buffer.from(await a.evaluate(() => Array.from(new Uint8Array(window.pdfResult))));
    const exported = await PDFDocument.load(exportBytes); assert.ok(exported.getPageCount() >= 1);
    fs.writeFileSync(path.join(output, 'note-0.3.0.pdf'), exportBytes);
    await a.screenshot({ path: path.join(output, 'notes-typography.png') });
    console.log(`PASS actual styled PDF saved (${exported.getPageCount()} pages)`);
    const notePath = await a.evaluate(() => app.workspace.activeView.path);
    const boardPath = await a.evaluate(async () => { const result = await api('/api/note',{method:'POST',body:{name:'PDF pages',ext:'canvas'}}); await app.workspace.waitFor(result.path);app.workspace.openPath(result.path);return result.path; });
    await a.waitForFunction(() => app.workspace.activeView?.type === 'board' && app.workspace.activeView.loaded);
    const importedPages = await a.evaluate(async bytes => {
      const view=app.workspace.activeView; const {importPresentation}=await import('/js/board/document-import.js');
      const ids=await importPresentation(view.ui,new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'document.pdf',{type:'application/pdf'}),{x:100,y:100});
      return ids.length;
    },Buffer.from(pdfBytes).toString('base64'));
    assert.ok(importedPages>=1);
    await a.evaluate(path=>app.workspace.openPath(path,{mode:'rich'}),notePath);
    await a.waitForSelector('.rich-note');
    console.log('PASS existing PDF page import completes and releases the PDF worker');
    // Independent profiles, real WebRTC, simulated Drive only for membership.
    const invitation = await a.evaluate(async () => {
      const created = await api('/api/collab/create', { method: 'POST', body: { name: 'Typographie 0.3.0' } });
      await app.collab.load(); window.project = await app.collab.open(created.projectId);
      return api('/api/collab/invite', { method: 'POST', body: { project: project.id, email: 'bob@example.test', role: 'editor' } });
    });
    await b.evaluate(async code => { const joined = await api('/api/collab/join', { method: 'POST', body: { code } }); await app.collab.load(); window.project = await app.collab.open(joined.projectId); }, invitation.code);
    for (const page of [a, b]) await page.waitForFunction(() => project.session.connected().length === 1, null, { timeout: 30000 });
    const id = await a.evaluate(() => { const id = project.createFile('note', 'Texte partagé', '', 'Premier paragraphe.\n\nDeuxième paragraphe.\n'); app.workspace.openPath(project.pathOf(project.file(id)), { mode: 'rich' }); return id; });
    await b.waitForFunction(id => project.file(id), id); await b.evaluate(id => app.workspace.openPath(project.pathOf(project.file(id)), { mode: 'rich' }), id);
    for (const page of [a, b]) await page.waitForSelector('.rich-note');
    await a.evaluate(() => { const r = app.workspace.activeView.rich; r.el.focus(); r.selectOffsets(0, 7); r.apply({ font: 'Lora', size: 30, weight: 700, highlight: '#facc15' }); });
    await b.waitForFunction(() => app.workspace.activeView.content.includes('font=Lora') && app.workspace.activeView.content.includes('size=30'));
    assert.match(await b.locator('.rich-note').innerText(), /Deuxième/);
    const box = await a.locator('.rich-note').boundingBox(); await a.mouse.move(box.x + 150, box.y + 50);
    await b.waitForSelector('.collab-pointer');
    console.log('PASS formatted text and mouse pointer reach another participant over WebRTC');
    await b.locator('.rich-note').focus(); await b.keyboard.press('Control+End'); await b.keyboard.type(' Ajout Bob');
    await a.waitForFunction(() => app.workspace.activeView.content.includes('Ajout Bob'));
    await a.locator('.rich-note').focus(); await a.keyboard.press('Control+a'); await a.keyboard.press('Backspace');
    await b.waitForFunction(() => app.workspace.activeView.content.trim() === '');
    await a.keyboard.press('Control+z'); await b.waitForFunction(() => app.workspace.activeView.content.includes('Ajout Bob'));
    console.log('PASS shared delete-all and personal undo converge without dropping the other participant’s text');
    const sharedPdfNote = await a.evaluate(async bytes => {
      const result = await api('/api/file?name=texte-source.pdf&source='+encodeURIComponent(app.workspace.activeView.path),{method:'PUT',body:new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'texte-source.pdf',{type:'application/pdf'}),raw:true});
      const {editablePdfCopy}=await import('/js/note-documents.js');await editablePdfCopy(result.path);
      return app.workspace.activeView.path;
    }, Buffer.from(pdfBytes).toString('base64'));
    assert.ok(sharedPdfNote.startsWith('@shared/'));
    await a.waitForFunction(() => app.workspace.activeView.content.includes('NOSTALGIE'));
    console.log('PASS PDF attachment creates an editable note inside its shared project');

    await a.setViewportSize({ width: 520, height: 900 });
    await a.evaluate(() => { for (const side of ['left', 'right']) if (app.layout.sides[side].open) app.layout.toggle(side); });
    await a.waitForTimeout(350);
    await a.screenshot({ path: path.join(output, 'notes-typography-mobile.png') });
    assert.deepEqual(errors, []); console.log('PASS no browser JavaScript errors');
  } finally {
    if (browser) await browser.close();
    await Promise.all(children.map(c => new Promise(resolve => { if (c.exitCode !== null) return resolve(); c.once('exit', resolve); c.kill(); })));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
