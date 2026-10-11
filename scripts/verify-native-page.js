(async () => {
  const wait = async (check) => {
    for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 100)); }
    throw Error('Interface did not become ready');
  };
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  try {
    await wait(() => document.querySelector('.tabs'));
    const { app, api } = await import(`${location.origin}/js/core.js`);
    const { settingsUi } = await import(`${location.origin}/js/settings.js`);
    const drive = await api('/api/drive');
    assert(drive.account.builtin && drive.account.configured, 'Packaged Google client missing');
    assert(!drive.account.connected, 'Unexpected account token in package');
    await app.explorer.newBoard('');
    await wait(() => app.workspace.activeView?.loaded && app.workspace.activeView.type === 'board');
    const view = app.workspace.activeView;
    assert(document.querySelectorAll('.board-tools button[data-tool]').length === 11, 'Toolbar incomplete');
    const Board = window.OpaleBoard;
    view.history.begin('Native test');
    view.add(Board.create('shape', { x: -100, y: -100, w: 200, h: 200, style: { fill: '#ff0000', stroke: '#ff0000' } }));
    view.add(Board.create('sticky', { x: 200, y: 100, data: { text: 'Essai Linux été' } }));
    view.history.commit();
    view.markDirty();
    await view.flush();
    const file = await fetch(`/api/file?path=${encodeURIComponent(view.path)}`);
    const saved = await file.json();
    assert(file.ok && Board.parse(JSON.stringify(saved)).doc.elements.length === 2, JSON.stringify({ status: file.status, saved }));
    assert(!view.unsaved && !view.saving, 'Board failed to save');
    const mermaid = window.OpaleBoardMermaid.toElements('flowchart LR\nA[Linux] --> B[Opale]');
    assert(!mermaid.error && mermaid.elements.length === 3, 'Mermaid import failed');
    assert(typeof DecompressionStream === 'function', 'Drawio decompression unavailable');
    new DecompressionStream('deflate-raw');
    const { captureBoard } = await import(`${location.origin}/js/board/export.js`);
    const canvas = await captureBoard(view);
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 240 && pixels[i + 1] < 20 && pixels[i + 2] < 20) red++;
    assert(red > 10000, `Export lost shape pixels: ${red}`);
    assert(canvas.toDataURL('image/jpeg').startsWith('data:image/jpeg'), 'JPEG export unavailable');
    app.settings.theme = 'light'; settingsUi.apply();
    await new Promise(r => setTimeout(r, 300));
    window.webkit.messageHandlers.validation.postMessage('PASS native WebKit: packaged Drive client, moodboard toolbar, editing/save, Mermaid, Drawio decompression, export pixels/JPEG');
  } catch (error) { window.webkit.messageHandlers.validation.postMessage(`FAIL ${error.message}: ${error.stack || error}`); }
})();
