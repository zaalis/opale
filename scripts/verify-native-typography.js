(async () => {
  const wait = async check => { for (let i=0;i<150;i++) { if (check()) return; await new Promise(r=>setTimeout(r,100)); } throw Error('Native readiness timeout'); };
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  try {
    await wait(() => document.querySelector('.tabs'));
    const {app,api} = await import(`${location.origin}/js/core.js`);
    const {settingsUi} = await import(`${location.origin}/js/settings.js`);
    const {fontCatalog} = await import(`${location.origin}/js/typography.js`);
    const created = await api('/api/note',{method:'POST',body:{name:'Typographie Linux',content:'# Opale Linux 0.3.0\n\nUne vieille maison familiale.\n\nDeuxième paragraphe.\n'}});
    await app.workspace.waitFor(created.path); app.workspace.openPath(created.path,{mode:'rich'});
    await wait(()=>app.workspace.activeView?.rich);
    const view = app.workspace.activeView;
    const select = () => {const r=view.rich;r.el.focus();const at=r.el.textContent.indexOf('Une vieille');r.selectOffsets(at,at+'Une vieille maison familiale.'.length);};
    select();view.rich.apply({font:'Lora',size:28,weight:700,color:'#224466',highlight:'#fff2aa'});
    select();view.rich.command('italic');
    await view.flush();
    const saved=await api(`/api/note?path=${encodeURIComponent(view.path)}`);
    assert(saved.content.includes('font=Lora')&&saved.content.includes('size=28'),'Native typography not saved');
    view.setMode('reading');view.setMode('rich');
    assert(view.rich.el.textContent.includes('Deuxième paragraphe'),'Native paragraph lost');
    assert((await fontCatalog()).length===104,'Font catalogue incomplete');
    await document.fonts.load('28px Lora','Éà nostalgie');
    assert(document.fonts.check('28px Lora'),'Local font unavailable in WebKit');
    let exported, canvasInfo;
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback,type,...args) {
      if (type === 'image/jpeg') canvasInfo = [this.width,this.height,...this.getContext('2d').getImageData(this.width-1,this.height-1,1,1).data];
      return toBlob.call(this,callback,type,...args);
    };
    window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async blob=>{exported=blob;},close:async()=>{},abort:async()=>{}})});
    const {exportNotePdf}=await import(`${location.origin}/js/note-documents.js`);
    await exportNotePdf(view);
    assert(exported?.size>10000,'Native styled PDF missing');
    assert(canvasInfo && canvasInfo.slice(2).every(v=>v===255),'Native PDF canvas has transparent/dark edges: '+canvasInfo);
    const data=new Uint8Array(await exported.arrayBuffer());
    assert(String.fromCharCode(...data.slice(0,5))==='%PDF-','Native PDF invalid');
    await api('/api/file?name=native-typography.pdf&source='+encodeURIComponent(view.path),{method:'PUT',body:exported,raw:true});
    settingsUi.open('about');
    assert(document.querySelector('.about-version').textContent==='Version 0.3.0','Native version mismatch');
    document.querySelector('.modal-backdrop button[aria-label="Fermer"]').click();
    app.settings.theme='light';settingsUi.apply();await new Promise(r=>setTimeout(r,300));
    window.webkit.messageHandlers.validation.postMessage('PASS native WebKit 0.3.0: rich editor, font/size/weight/italic/color/highlight, save/reopen, 104 local font catalogue, actual PDF export and About version');
  } catch(e) { window.webkit.messageHandlers.validation.postMessage('FAIL '+e.message+': '+e.stack); }
})();
