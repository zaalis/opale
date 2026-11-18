'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-export-docs-'));
process.env.OPALE_HOME = path.join(temp, 'home'); process.env.OPALE_FAKE_DRIVE = path.join(temp, 'drive');
process.env.OPALE_FAKE_EMAIL = 'alice@example.test'; process.env.OPALE_KEY_PROTECTION = 'none';
const vault = path.join(temp, 'vault'); fs.mkdirSync(vault);
const output = path.resolve('artifacts/export-documents'); fs.mkdirSync(output, { recursive: true });
const Board = require('../shared/board.js');
const board = Board.emptyDoc(); board.elements.push(Board.create('shape', { x: 0, y: 0, w: 400, h: 225, style: { fill: '#2453bb' }, data: { shape: 'rect', text: 'Capture 4K / 8K' } }));
fs.writeFileSync(path.join(vault, 'Qualité.canvas'), Board.serialize(board));
let child;
const server = process.env.OPALE_TEST_SERVER ? {
  listen: () => new Promise((resolve, reject) => {
    child = spawn(path.resolve(process.env.OPALE_TEST_SERVER), ['--port','0','--vault',vault], { windowsHide: true, env: process.env });
    const timer = setTimeout(() => reject(new Error('Startup timeout')),15000); let text = '';
    child.on('error', reject); child.stderr.on('data', x=>process.stderr.write(x));
    child.stdout.on('data', chunk => { text += chunk; const hit = /http:\/\/127\.0\.0\.1:(\d+)/.exec(text); if (hit) { clearTimeout(timer); resolve(Number(hit[1])); } });
  }), close: async () => { if (!child || child.exitCode !== null) return; const exit = new Promise(resolve=>child.once('exit',resolve)); child.kill(); await exit; },
} : require('../server.js').createOpale({ port:0, vaultPath:vault });
(async()=>{
  let browser;
  try {
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    for(let i=1;i<=100;i++) { const page = pdf.addPage([640,360]); page.drawRectangle({x:0,y:0,width:640,height:360,color:rgb(i/110,.2,.6)}); page.drawText(`Page ${i}`, {x:40,y:180,size:40,font,color:rgb(1,1,1)}); }
    const pdfBytes = await pdf.save(); fs.writeFileSync(path.join(temp,'100-pages.pdf'),pdfBytes);
    const pptFile = path.join(temp,'6-slides.pptx');
    const PptxGenJS=require('pptxgenjs'),presentation=new PptxGenJS();presentation.layout='LAYOUT_WIDE';
    for(let i=1;i<=6;i++){const slide=presentation.addSlide();slide.addText(`Diapositive ${i}`,{x:1,y:1,w:8,h:1,fontSize:32});}
    await presentation.writeFile({fileName:pptFile});
    const port=await server.listen(); browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});
    const context=await browser.newContext({viewport:{width:1440,height:1000}}), page=await context.newPage();
    page.setDefaultTimeout(15000); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{ window.showSaveFilePicker=undefined; });
    await page.goto(`http://127.0.0.1:${port}`); await page.waitForSelector('.tabs');
    await page.evaluate(async()=>{const {app,api}=await import('/js/core.js');window.app=app;window.api=api; app.workspace.openPath('Qualité.canvas');});
    await page.waitForFunction(()=>app.workspace.activeView.loaded);
    await page.getByRole('button',{name:'Capture et export du moodboard',exact:true}).click();
    await page.waitForSelector('.export-preview img');
    assert.equal(await page.getByRole('combobox',{name:'Format',exact:true}).locator('option').count(),7);
    await page.getByRole('combobox',{name:'Résolution',exact:true}).selectOption('7680');
    assert.equal(await page.getByRole('spinbutton',{name:'Largeur en pixels'}).inputValue(),'7680');
    await page.getByRole('spinbutton',{name:'Pixels par pouce'}).fill('300');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.modal-board-export')).opacity==='1' && getComputedStyle(document.querySelector('.modal-board-export').parentElement).opacity==='1');
    await page.screenshot({path:path.join(output,'export-dialog.png')});
    // Actual high resolution generation, independent of the small preview.
    const high = await page.evaluate(async()=>{ const {captureBoard}=await import('/js/board/export.js');const c=await captureBoard(app.workspace.activeView,{width:7680});return {width:c.width,height:c.height}; });
    assert.equal(high.width,7680); assert.ok(high.height>4000);
    console.log(`PASS preview and real 8K capture: ${high.width} x ${high.height}`);
    for(const format of ['png','jpg','webp','tiff','bmp','svg','pdf']) {
      await page.getByRole('combobox',{name:'Format',exact:true}).selectOption(format);
      await page.getByRole('spinbutton',{name:'Largeur en pixels'}).fill('800');
      const downloadPromise=page.waitForEvent('download');
      await page.getByRole('button',{name:'Enregistrer sous…',exact:true}).click();
      const download=await downloadPromise; await download.saveAs(path.join(output,`capture.${format}`));
      assert.equal(download.suggestedFilename(),`Qualité.${format}`);
      await page.locator('.modal-board-export').waitFor({state:'detached'});
      await page.getByRole('button',{name:'Capture et export du moodboard',exact:true}).click(); await page.waitForSelector('.export-preview img');
      await page.getByRole('spinbutton',{name:'Pixels par pouce'}).fill('300');
    }
    console.log('PASS actual PNG, JPEG, WebP, TIFF, BMP, SVG and PDF files saved');
    // Verify File System Access receives the exact chosen file and bytes.
    await page.evaluate(()=>{window.savedFile=null;window.showSaveFilePicker=async options=>({createWritable:async()=>({write:async blob=>{window.savedFile={name:options.suggestedName,type:blob.type,size:blob.size};},close:async()=>{},abort:async()=>{}})});});
    await page.getByRole('combobox',{name:'Format',exact:true}).selectOption('tiff'); await page.getByRole('spinbutton',{name:'Largeur en pixels'}).fill('320');
    await page.getByRole('button',{name:'Enregistrer sous…',exact:true}).click();
    await page.waitForFunction(()=>window.savedFile?.size>0); assert.equal(await page.evaluate(()=>savedFile.type),'image/tiff');
    await page.locator('.modal-board-export').waitFor({state:'detached'});
    console.log('PASS save-location picker writes the selected format to the selected handle');
    // Region selection via real pointer events must not change the document.
    const original=await page.evaluate(()=>JSON.stringify(app.workspace.activeView.doc));
    await page.getByRole('button',{name:'Capture et export du moodboard',exact:true}).click(); await page.getByRole('button',{name:'Enregistrement personnalisé',exact:true}).click();
    await page.waitForSelector('.board-capture-hint');
    const rect=await page.locator('.board-stage').boundingBox();
    await page.mouse.move(rect.x+140,rect.y+150);await page.mouse.down();await page.mouse.move(rect.x+500,rect.y+380,{steps:12});await page.mouse.up();
    await page.waitForFunction(()=>document.querySelector('.modal-board-export .export-area')?.textContent==='Zone personnalisée'); await page.waitForSelector('.export-preview img');
    assert.equal(await page.evaluate(()=>JSON.stringify(app.workspace.activeView.doc)),original);
    await page.getByRole('button',{name:'Annuler',exact:true}).click();
    await page.locator('.modal-board-export').waitFor({state:'detached'});
    console.log('PASS custom capture selects a precise rectangle without modifying the board');
    const importDoc=async(name,bytes)=>page.evaluate(async({name,bytes})=>{
      const view=app.workspace.activeView; await view.ui.dropFiles([new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],name)],{x:100,y:600});
      return view.doc.elements.filter(el=>el.data.alt?.startsWith(name)).map(el=>({x:el.x,y:el.y,w:el.w,alt:el.data.alt,file:el.data.file}));
    },{name,bytes:Buffer.from(bytes).toString('base64')});
    const pages=await importDoc('100-pages.pdf',pdfBytes);
    assert.equal(pages.length,100);assert.equal(new Set(pages.map(p=>p.y)).size,1);assert.ok(pages.every((p,i)=>!i||p.x>pages[i-1].x+pages[i-1].w));assert.ok(pages.at(-1).alt.includes('100 / 100'));
    console.log('PASS all 100 PDF pages imported in one horizontal row without wrapping');
    const slides=await importDoc('6-slides.pptx',fs.readFileSync(pptFile));assert.equal(slides.length,6);assert.equal(new Set(slides.map(p=>p.y)).size,1);
    console.log('PASS real PowerPoint conversion imports all six slides horizontally');
    await page.evaluate(async()=>{const info=await api('/api/collab/create',{method:'POST',body:{name:'Documents partagés'}});await app.collab.load();window.project=await app.collab.open(info.projectId);const id=project.createFile('board','Présentation');app.workspace.openPath(project.pathOf(project.file(id)));});
    await page.waitForFunction(()=>app.workspace.activeView.shared&&app.workspace.activeView.loaded);
    const shared=await importDoc('100-pages.pdf',pdfBytes);
    assert.equal(shared.length,100);assert.ok(shared.every(p=>p.file.startsWith('@shared/')));
    const sharedSlides=await importDoc('collab.pptx',fs.readFileSync(pptFile));assert.equal(sharedSlides.length,6);assert.ok(sharedSlides.every(p=>p.file.startsWith('@shared/')));
    console.log('PASS PDF and PowerPoint pages use shared attachments in a collaborative board');
    const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a5kAAAAASUVORK5CYII=','base64');
    await page.route('**/api/link-icon?*',route=>route.fulfill({contentType:'image/png',body:image}));
    await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Destination</h1>'}));
    await page.evaluate(()=>{const v=app.workspace.activeView;v.ui.pasteText('https://example.com/article',{x:0,y:0});v.zoomToBox({x:0,y:0,w:360,h:160},false);});
    await page.waitForSelector('.b-link-favicon'); const popup=page.waitForEvent('popup');await page.locator('a.b-link-title').click();const opened=await popup;await opened.waitForLoadState();assert.equal(opened.url(),'https://example.com/article');await opened.close();
    console.log('PASS pasted link has a favicon and opens directly in a separate browser tab');
    await page.getByRole('button',{name:'Capture et export du moodboard',exact:true}).click();await page.waitForSelector('.export-preview img');
    assert.ok((await page.locator('.export-summary').textContent()).includes('px'));await page.waitForFunction(()=>getComputedStyle(document.querySelector('.modal-board-export')).opacity==='1');await page.screenshot({path:path.join(output,'shared-export.png')});
    assert.deepEqual(errors,[]);console.log('PASS personal and collaborative export UI; no JavaScript errors');
  } finally {if(browser)await browser.close();await server.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
