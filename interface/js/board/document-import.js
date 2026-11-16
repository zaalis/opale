// Render every page in order, yielding between pages to keep the UI usable.
import { app, h, Meta } from '../core.js';
import { uploadFile } from '../editing.js';
let pdfLibrary;
async function pdfjs() {
  if (!pdfLibrary) pdfLibrary = import('/vendor/pdfjs/pdf.mjs').then(lib => { lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs'; return lib; });
  return pdfLibrary;
}
export const isPresentation = name => /\.(pdf|pptx|ppt)$/i.test(name);
export async function importPresentation(ui, file, at) {
  const view = ui.view;
  if (view.readOnly) return;
  const status = h('span', 'Préparation du document…');
  const progress = h('progress', { max: 1, value: 0, 'aria-label': 'Import des pages' });
  const cancel = h('button.btn', { type: 'button' }, 'Annuler');
  const panel = h('div.board-ui.board-document-progress', { role: 'status', 'aria-live': 'polite' }, status, progress, cancel);
  view.stage.append(panel);
  const controller = new AbortController(); let cancelled = false, task, pdf, passwordRequired = false;
  const imported = []; const group = window.OpaleBoard.newId();
  cancel.onclick = () => { cancelled = true; controller.abort(); task?.destroy().catch(() => {}); };
  try {
    let data;
    if (/\.pdf$/i.test(file.name)) data = new Uint8Array(await file.arrayBuffer());
    else {
      status.textContent = 'Conversion de la présentation PowerPoint…';
      const response = await fetch(`/api/presentation-pdf?ext=${Meta.extOf(file.name)}&source=${encodeURIComponent(view.path)}`, { method: 'POST', headers: { 'X-Opale': '1' }, body: file, signal: controller.signal });
      if (!response.ok) { const problem = await response.json().catch(() => ({})); throw new Error(problem.error || 'Impossible de convertir cette présentation.'); }
      data = new Uint8Array(await response.arrayBuffer());
    }
    if (cancelled || !view.el.isConnected) return;
    const lib = await pdfjs();
    task = lib.getDocument({ data, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/', isEvalSupported: false });
    task.onPassword = () => { passwordRequired = true; task.destroy().catch(() => {}); };
    pdf = await task.promise;
    progress.max = pdf.numPages;
    const gap = 40, displayHeight = 360;
    let x = at.x;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (cancelled || !view.el.isConnected) break;
      status.textContent = `Page ${pageNumber} sur ${pdf.numPages} · ${file.name}`; progress.value = pageNumber - 1;
      const page = await pdf.getPage(pageNumber), natural = page.getViewport({ scale: 1 });
      // Each page is sharp at ordinary zoom without holding the entire deck in RAM.
      const scale = Math.min(2, 1800 / Math.max(natural.width, natural.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      await page.render({ canvasContext: context, viewport, background: 'rgb(255,255,255)' }).promise;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      canvas.width = canvas.height = 1; page.cleanup();
      if (!blob) throw new Error(`Impossible de rendre la page ${pageNumber}.`);
      if (cancelled || !view.el.isConnected) break;
      const name = `${Meta.stem(file.name)} — page ${String(pageNumber).padStart(3, '0')}.png`;
      const path = await uploadFile(new File([blob], name, { type: 'image/png' }), view.path);
      await app.workspace.waitFor(path);
      if (view.readOnly || !view.el.isConnected) break;
      const width = Math.round(displayHeight * natural.width / natural.height);
      const el = window.OpaleBoard.create('image', { x, y: at.y, w: width, h: displayHeight, group, data: { file: path, alt: `${file.name} · page ${pageNumber} / ${pdf.numPages}` } });
      ui.addElements([el], { select: false }); imported.push(el.id);
      x += width + gap; progress.value = pageNumber;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (cancelled) status.textContent = `${imported.length} pages déjà ajoutées ; import arrêté.`;
    else if (imported.length) status.textContent = `${imported.length} pages alignées horizontalement.`;
    return imported;
  } catch (error) {
    if (!cancelled && error.name !== 'AbortError') throw passwordRequired ? new Error('Ce PDF est protégé par un mot de passe. Déposez une copie déverrouillée.') : error;
  } finally { if (pdf) await pdf.destroy(); else if (task) await task.destroy().catch(() => {}); panel.remove(); }
}
