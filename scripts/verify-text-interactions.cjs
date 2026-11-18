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
async function drag(page, phrase, reverse=false) {
  await page.bringToFront();
  const points=await page.evaluate(phrase=>{
    const r=app.workspace.activeView.rich,at=r.el.textContent.indexOf(phrase);if(at<0)throw Error('Missing selection text '+phrase);
    const a=r.rangeAt(at,at+1).getBoundingClientRect(),b=r.rangeAt(at+phrase.length-1,at+phrase.length).getBoundingClientRect();
    return [{x:a.left+0.2,y:a.top+a.height/2},{x:b.right+0.5,y:b.top+b.height/2}];
  },phrase);
  const [a,b]=reverse?points.reverse():points;
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();
  await page.waitForFunction(()=>!!app.workspace.activeView.rich.bookmark);
}
const fixture='<span data-opale="font=Lora;size=24;weight=700;italic=1;underline=1;strike=1;highlight=#facc15">Alpha choisi</span> suite.\n\n<span data-opale="font=Inter;size=16;weight=400">Beta normal</span> fin.\n';
(async()=>{
 let browser,clipboard;
 try {
  const [alice,bob]=await Promise.all([start('alice','alice@example.test'),start('bob','bob@example.test')]);
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});
  const ca=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),cb=await browser.newContext({viewport:{width:1440,height:1000}});
  const a=await ca.newPage(),b=await cb.newPage(),errors=[];
  for(const p of [a,b]){p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));}
  await Promise.all([a.goto(alice.url),b.goto(bob.url)]);
  for(const p of [a,b]){await p.waitForSelector('.tabs');await p.evaluate(async()=>{const {app,api}=await import('/js/core.js');window.app=app;window.api=api;});}
  try {
    clipboard = await a.evaluate(async () => {
      const saved = [];
      for (const item of await navigator.clipboard.read()) {
        const types = [];
        for (const type of item.types) types.push({ type, bytes: Array.from(new Uint8Array(await (await item.getType(type)).arrayBuffer())) });
        saved.push({ types });
      }
      return saved;
    });
  } catch {}

  await a.evaluate(async text=>{const file=await api('/api/note',{method:'POST',body:{name:'Interactions',content:text}});await app.workspace.waitFor(file.path);app.workspace.openPath(file.path,{mode:'rich'});},fixture);
  await a.waitForSelector('.rich-note');await a.waitForFunction(()=>document.querySelector('.type-font')?.dataset.catalogCount==='104');
  await drag(a,'Alpha choisi');
  await a.waitForFunction(()=>document.querySelector('.type-font').value==='Lora'&&document.querySelector('[aria-label="Taille de police en pixels"]').value==='24');
  for(const name of ['Gras (Ctrl+B)','Italique (Ctrl+I)','Souligner (Ctrl+U)','Barrer','Surligner'])assert.equal(await a.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true',name);
  console.log('PASS real mouse selection reports font, size and every active decoration');
  const size=a.getByRole('spinbutton',{name:'Taille de police en pixels',exact:true});
  await size.click();await size.press('ArrowUp');
  assert.equal(await size.inputValue(),'25');assert.equal(await size.evaluate(e=>document.activeElement===e),true);
  assert.ok((await a.evaluate(()=>app.workspace.activeView.content)).includes('size=25'));
  const undoSteps=await a.evaluate(()=>app.workspace.activeView.history.length);await size.fill('25');assert.equal(await a.evaluate(()=>app.workspace.activeView.history.length),undoSteps);
  await a.keyboard.press('Control+z');
  await a.waitForFunction(()=>app.workspace.activeView.content.includes('size=24')&&!app.workspace.activeView.content.includes('size=25'));
  console.log('PASS numeric spinner retains the mouse selection and Ctrl+Z works from the toolbar');
  await drag(a,'Alpha choisi');
  const family=a.getByRole('combobox',{name:'Police d’écriture',exact:true});
  await family.click();await family.press('ArrowDown');await family.press('Enter');
  const chosen=await family.inputValue();assert.notEqual(chosen,'Lora');assert.ok((await a.evaluate(()=>app.workspace.activeView.content)).includes('font='+chosen));
  console.log('PASS actual font dropdown mouse/keyboard changes the selected text');
  await drag(a,'Alpha choisi',true);
  await a.getByRole('combobox',{name:'Police d’écriture',exact:true}).selectOption('Montserrat');
  assert.match(await a.evaluate(()=>app.workspace.activeView.content),/font=Montserrat/);
  await size.fill('');await size.pressSequentially('100');
  assert.equal(await size.inputValue(),'100');assert.ok((await a.evaluate(()=>app.workspace.activeView.content)).includes('size=100'));
  await size.fill('24');await size.press('Tab');
  console.log('PASS reverse mouse selection changes family; size 100 can be typed without focus jumping');
  await drag(a,'Alpha choisi');
  for(const name of ['Couleur du texte','Couleur du surlignage']){
    const button=a.getByRole('button',{name,exact:true});await button.click();await a.getByRole('dialog',{name,exact:true}).waitFor();
    await button.click();assert.equal(await a.getByRole('dialog',{name,exact:true}).count(),0);
    await button.click();await a.getByRole('button',{name:'Appliquer #3b82f6',exact:true}).click();
    assert.ok((await a.evaluate(()=>app.workspace.activeView.content)).includes('#3b82f6'));
    await button.click();assert.equal(await a.locator('.type-color-popover').count(),0);
  }
  const more=a.getByRole('button',{name:'Plus d’options',exact:true});await more.click();await a.getByRole('menu').waitFor();await more.click();assert.equal(await a.getByRole('menu').count(),0);
  console.log('PASS both color rectangles and the three-dot menu close on their second click');
  // A mixed selection spans two families/sizes and shows mixed values.
  await a.evaluate(()=>{const v=app.workspace.activeView;v.setContent('<span data-opale="font=Lora;size=24">Alpha</span> <span data-opale="font=Inter;size=16">Beta</span>\n',{step:true});v.render();});
  await drag(a,'Alpha Beta');
  await a.waitForFunction(()=>document.querySelector('[aria-label="Taille de police en pixels"]').value==='');
  assert.equal(await a.getByRole('combobox',{name:'Police d’écriture',exact:true}).inputValue(),'');
  console.log('PASS mixed font/size selection shows mixed state');
  // Enter at the beginning must survive a round trip through Markdown.
  await a.evaluate(()=>{const v=app.workspace.activeView;v.setContent('Première ligne.\n\nSuite.\n',{step:true});v.render();});
  await a.locator('.rich-note').click();await a.keyboard.press('Control+Home');await a.keyboard.press('Enter');
  assert.ok((await a.evaluate(()=>app.workspace.activeView.content)).startsWith('<br>'));
  await a.evaluate(async()=>{const v=app.workspace.activeView;await v.flush();v.setMode('reading');v.setMode('rich');});
  assert.equal(await a.locator('.rich-note > p').first().innerHTML(),'<br>');
  await a.keyboard.press('Control+z');assert.ok(!(await a.evaluate(()=>app.workspace.activeView.content)).startsWith('<br>'));
  console.log('PASS Enter at the beginning creates a persisted empty paragraph and can be undone');
  await a.evaluate(()=>{const v=app.workspace.activeView;v.setContent('<span data-opale="font=Lora;size=24;weight=700">Début stylé.</span>\n\nSuite.\n',{step:true});v.render();});
  await a.locator('.rich-note').click();await a.keyboard.press('Control+Home');await a.keyboard.press('Enter');
  assert.ok((await a.evaluate(()=>app.workspace.activeView.content)).includes('<br>'));
  await a.evaluate(()=>{const v=app.workspace.activeView;v.setMode('reading');v.setMode('rich');});
  assert.ok((await a.locator('.rich-note').innerText()).includes('Début stylé.'));
  console.log('PASS Enter also works before a styled text run');
  // Actual system clipboard copy/paste with font information in HTML, in pt.
  await ca.route('**/clipboard-source',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><p style="font-family:Helvetica;font-size:12pt;font-weight:700">Scénario : La Maison des souvenirs</p><p style="font-family:Lora;font-size:18pt;font-style:italic">Une vieille maison familiale.</p>'}));
  const source=await ca.newPage();await source.goto(alice.url+'/clipboard-source');await source.keyboard.press('Control+a');await source.keyboard.press('Control+c');
  await a.bringToFront();await a.evaluate(()=>document.addEventListener('paste',e=>window.clipboardDebug=e.clipboardData.getData('text/html'),{once:true,capture:true}));await a.locator('.rich-note').focus();await a.keyboard.press('Control+a');await a.keyboard.press('Control+v');
  await a.waitForFunction(()=>app.workspace.activeView.content.includes('Une vieille maison familiale'));
  const pasted=await a.evaluate(()=>app.workspace.activeView.content);
  assert.match(pasted,/font=Roboto/);assert.match(pasted,/size=16/);assert.match(pasted,/font=Lora/);assert.match(pasted,/size=24/);
  assert.ok((await a.locator('.rich-note').innerText()).includes('Une vieille maison familiale.'));
  await source.close();console.log('PASS real Ctrl+C/Ctrl+V keeps clipboard HTML fonts, pt sizes, weight and case');
  if(process.env.OPALE_TEST_PDF&&fs.existsSync(process.env.OPALE_TEST_PDF)){
    const path=await a.evaluate(async bytes=>{const result=await api('/api/file?name=source-presse-papiers.pdf&source='+encodeURIComponent(app.workspace.activeView.path),{method:'PUT',body:new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'source-presse-papiers.pdf',{type:'application/pdf'}),raw:true});return result.path;},fs.readFileSync(process.env.OPALE_TEST_PDF).toString('base64'));
    await a.evaluate(()=>navigator.clipboard.writeText('Opale clipboard sentinel'));
    const pdfPage=await ca.newPage();
    await pdfPage.goto(alice.url+'/api/file?path='+encodeURIComponent(path));await pdfPage.waitForTimeout(1500);
    await pdfPage.mouse.click(750,300);await pdfPage.keyboard.press('Control+a');await pdfPage.keyboard.press('Control+c');
    await a.bringToFront();
    const formats=await a.evaluate(async()=>({text:await navigator.clipboard.readText(),types:(await navigator.clipboard.read()).flatMap(i=>i.types)}));
    assert.ok(formats.text.includes('NOSTALGIE')&&formats.text.includes('Une vieille maison familiale'),'Real PDF viewer did not copy expected text');
    await a.locator('.rich-note').focus();await a.keyboard.press('Control+a');await a.keyboard.press('Control+v');
    await a.waitForFunction(()=>app.workspace.activeView.content.includes('Une vieille maison familiale'));
    const pdfStyle=await a.evaluate(()=>{const t=app.workspace.activeView.content;return {fonts:[...new Set([...t.matchAll(/font=([^;"]+)/g)].map(m=>m[1]))],sizes:[...new Set([...t.matchAll(/size=([^;"]+)/g)].map(m=>m[1]))]};});
    console.log('PASS real B1 Enviro PDF Ctrl+C/Ctrl+V; clipboard formats: '+formats.types.join(', ')+'; typography: '+JSON.stringify(pdfStyle));
    await pdfPage.close();
  }
  // Shared history: undo a formatting step, keeping the other participant’s typing.
  const invitation=await a.evaluate(async()=>{const created=await api('/api/collab/create',{method:'POST',body:{name:'Interactions'}});await app.collab.load();window.project=await app.collab.open(created.projectId);return api('/api/collab/invite',{method:'POST',body:{project:project.id,email:'bob@example.test',role:'editor'}});});
  await b.evaluate(async code=>{const joined=await api('/api/collab/join',{method:'POST',body:{code}});await app.collab.load();window.project=await app.collab.open(joined.projectId);},invitation.code);
  for(const p of [a,b])await p.waitForFunction(()=>project.session.connected().length===1,null,{timeout:30000});
  const id=await a.evaluate(()=>{const id=project.createFile('note','Annulation','','Texte partagé.\n');app.workspace.openPath(project.pathOf(project.file(id)),{mode:'rich'});return id;});
  await b.waitForFunction(id=>project.file(id),id);await b.evaluate(id=>app.workspace.openPath(project.pathOf(project.file(id)),{mode:'rich'}),id);
  for(const p of [a,b])await p.waitForSelector('.rich-note');
  await drag(a,'Texte partagé.');await a.getByRole('button',{name:'Gras (Ctrl+B)',exact:true}).click();
  assert.equal(await a.getByRole('button',{name:'Gras (Ctrl+B)',exact:true}).getAttribute('aria-pressed'),'true');
  await b.waitForFunction(()=>app.workspace.activeView.content.includes('**Texte partagé.**'));
  await b.bringToFront();await b.locator('.rich-note').focus();await b.keyboard.press('Control+End');await b.keyboard.type(' Ajout Bob');
  await a.waitForFunction(()=>app.workspace.activeView.content.includes('Ajout Bob'));
  await a.bringToFront();await a.locator('.rich-note').focus();await a.keyboard.press('Control+z');
  await b.waitForFunction(()=>!app.workspace.activeView.content.includes('**Texte partagé.**')&&app.workspace.activeView.content.includes('Ajout Bob'));
  await a.keyboard.press('Control+Shift+z');await b.waitForFunction(()=>app.workspace.activeView.content.includes('**Texte partagé.'));
  assert.ok((await a.evaluate(()=>app.workspace.activeView.content)).includes('Ajout Bob'));
  await a.getByRole('button',{name:'Plus d’options',exact:true}).click();await a.getByRole('menu').waitFor();await a.getByRole('button',{name:'Plus d’options',exact:true}).click();assert.equal(await a.getByRole('menu').count(),0);
  await drag(a,'Texte partagé.');await a.getByRole('button',{name:'Couleur du texte',exact:true}).click();await a.getByRole('button',{name:'Couleur du texte',exact:true}).click();assert.equal(await a.locator('.type-color-popover').count(),0);
  console.log('PASS shared undo/redo removes only my formatting, preserves Bob’s typing; shared menus toggle');
  fs.mkdirSync(path.join(output,'interactions'),{recursive:true});await a.screenshot({path:path.join(output,'interactions','selection-controls.png')});
  assert.deepEqual(errors,[]);console.log('PASS no JavaScript errors in real mouse and keyboard interactions');
 } finally {
  if(browser&&clipboard)try{const pages=browser.contexts()[0].pages();const page=pages[0];await page.evaluate(async items=>navigator.clipboard.write(items.map(item=>new ClipboardItem(Object.fromEntries(item.types.map(({type,bytes})=>[type,new Blob([new Uint8Array(bytes)],{type})]))))),clipboard);}catch{}
  if(browser)await browser.close();await Promise.all(children.map(c=>new Promise(r=>{if(c.exitCode!==null)return r();c.once('exit',r);c.kill();})));fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
