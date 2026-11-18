import { api, app, fileUrl, h, Markdown, Meta, reportError, toast } from './core.js';
import { store } from './store.js';
import { fontCatalog } from './typography.js';
import { decorate } from './renderer.js';

const Type = window.OpaleTypography;
const dataUrl = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
export async function embeddedFontCss(root) {
  const used = new Set();
  for (const node of [root, ...root.querySelectorAll('*')]) for (const name of getComputedStyle(node).fontFamily.split(',')) used.add(name.replace(/["']/g, '').trim());
  const fonts = (await fontCatalog()).filter(f => used.has(f.name));
  const rules = [];
  for (const font of fonts) for (const face of font.faces) {
    const response = await fetch('/assets/fonts/' + face.file); if (!response.ok) throw Error('Police manquante : ' + font.name);
    const url = await dataUrl(await response.blob());
    rules.push(`@font-face{font-family:'${font.name}';src:url('${url}') format('${face.format || 'truetype'}');font-weight:${face.weight};font-style:${face.italic ? 'italic' : 'normal'};}`);
  }
  return rules.join('\n');
}

// Every output page contains a high-resolution rendering with its local fonts
// embedded into the SVG snapshot. The PDF is independent of installed fonts.
export async function exportNotePdf(view) {
  if (view.active) view.commitActive();
  let handle;
  const titleName = view.fileName ? view.fileName() : Meta.stem(view.path);
  const name = `${String(titleName).replace(/[<>:"|?*\\/]/g, '-') || 'Note'}.pdf`;
  if (window.showSaveFilePicker) {
    try { handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Document PDF', accept: { 'application/pdf': ['.pdf'] } }] }); }
    catch (e) { if (e.name === 'AbortError') return; throw e; }
  }
  const stage = h('div.note-pdf-stage');
  stage.style.cssText = "position:fixed;left:-12000px;top:0;width:690px;padding:0;background:white;color:#17202b;--text-0:#17202b;--text-1:#364152;--text-2:#586174;--text-3:#727986;--bg-1:#f7f7fa;--bg-2:white;--bg-3:#f0f0f4;font-family:'Inter',sans-serif;--font-text:'Inter',sans-serif;--font-size:16px;--border:#dddde4;--border-strong:#c5c5ce;";
  const note = h('div.markdown', { html: Markdown.render(view.content, store.renderContext(view.path)) });
  const title = h('h1', { style: "font-family:'Inter',sans-serif;font-size:28px;margin:0 0 24px;color:#17202b" }, view.fileName ? view.fileName() : Meta.stem(view.path));
  stage.append(title, note); document.body.append(stage);
  decorate(note);
  try {
    for (let wait = 0; stage.querySelector('.embed-note[data-embed-state=loading]') && wait < 150; wait++) await new Promise(r => setTimeout(r, 50));
    if (stage.querySelector('.embed-note[data-embed-state=loading]')) throw Error('Une note intégrée est encore en cours de chargement. Réessayez après son ouverture.');
    await document.fonts.ready;
    for (const img of stage.querySelectorAll('img')) await img.decode().catch(() => {});
    const fonts = await embeddedFontCss(stage);
    const height = Math.ceil(stage.scrollHeight);
    if (height > 200000) throw Error('Cette note est trop longue pour cet export PDF. Scindez-la en plusieurs notes.');
    const clone = stage.cloneNode(true);
    for (const image of clone.querySelectorAll('img')) {
      if (!image.src.startsWith('data:')) {
        const response = await fetch(image.src); if (!response.ok) throw Error('Image indisponible pour cet export.');
        image.src = await dataUrl(await response.blob());
      }
      image.removeAttribute('srcset'); image.removeAttribute('loading');
    }
    for (const media of clone.querySelectorAll('audio,video,iframe')) media.replaceWith(h('p', media.getAttribute('src') || 'Média intégré'));
    const cssResponse = await fetch('/css/markdown.css'); if (!cssResponse.ok) throw Error('Styles de document indisponibles.');
    const documentCss = (await cssResponse.text()).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    // Computed logical insets otherwise keep the off-screen capture origin,
    // even after changing the physical left/top properties.
    for (const property of ['inset-inline-start','inset-inline-end','inset-block-start','inset-block-end','inset','left','right','top','bottom']) clone.style.removeProperty(property);
    clone.style.position = 'relative'; clone.style.left = '0'; clone.style.top = '0';
    clone.querySelectorAll('.code-tools,.broken-dot').forEach(n => n.remove());
    const { PDFDocument } = await import('/vendor/pdf-lib/pdf-lib.mjs');
    const pdf = await PDFDocument.create(); pdf.setTitle(titleName); pdf.setCreator('Opale 0.3.0');
    const pageW = 794, pageH = 1123, margin = 52, contentH = pageH - 2 * margin;
    const bounds = stage.getBoundingClientRect(), lineRects = [];
    const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT); let textNode;
    while ((textNode = walker.nextNode())) {
      const range = document.createRange(); range.selectNodeContents(textNode);
      for (const r of range.getClientRects()) if (r.height) lineRects.push({ top: r.top - bounds.top, bottom: r.bottom - bounds.top });
    }
    for (const image of stage.querySelectorAll('img')) { const r = image.getBoundingClientRect(); if (r.height <= contentH) lineRects.push({ top: r.top - bounds.top, bottom: r.bottom - bounds.top }); }
    for (let y = 0; y < Math.max(height, 1);) {
      let next = Math.min(height, y + contentH);
      for (const r of lineRects) if (r.top < next && r.bottom > next && r.top > y + 40) next = Math.min(next, Math.floor(r.top));
      if (next <= y) next = y + contentH;
      const root = h('div', { style: `position:relative;width:${pageW}px;height:${pageH}px;background:white;overflow:hidden;` });
      const inner = clone.cloneNode(true); inner.style.position = 'absolute'; inner.style.left = `${margin}px`; inner.style.top = `${margin - y}px`;
      const viewport = h('div', { style: `position:absolute;left:0;top:${margin}px;width:${pageW}px;height:${Math.min(contentH, next - y)}px;overflow:hidden;` });
      inner.style.top = `${-y}px`; viewport.append(inner); root.append(viewport);
      const markup = new XMLSerializer().serializeToString(root);
      // Keep SVG layout at CSS size: WebKit does not scale foreignObject
      // consistently through a larger SVG viewport. Scale explicitly on canvas.
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}" height="${pageH}" viewBox="0 0 ${pageW} ${pageH}"><style>${fonts}\n${documentCss}</style><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
      const img = new Image(); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = pageW * 2; canvas.height = pageH * 2;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
      const image = await pdf.embedJpg(await blob.arrayBuffer()); const page = pdf.addPage([595.28, 841.89]);
      page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 }); canvas.width = canvas.height = 1;
      y = next;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const blob = new Blob([await pdf.save()], { type: 'application/pdf' });
    if (handle) { const writer = await handle.createWritable(); try { await writer.write(blob); await writer.close(); } catch (e) { await writer.abort().catch(() => {}); throw e; } }
    else { const url = URL.createObjectURL(blob); const link = h('a', { href: url, download: name }); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
    toast('PDF enregistré avec la mise en forme de la note.');
  } finally { stage.remove(); }
}

let pdfLibrary;
async function pdfjs() {
  return pdfLibrary ||= import('/vendor/pdfjs/pdf.mjs').then(lib => { lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs'; return lib; });
}
export async function pdfToMarkdown(bytes, progress = () => {}) {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: bytes, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/', isEvalSupported: false, fontExtraProperties: true });
  task.onPassword = () => { task.destroy().catch(() => {}); };
  let pdf;
  try {
    pdf = await task.promise;
    if (pdf.numPages > 300) throw Error('Import limité à 300 pages par document.');
    const pages = [], catalog = await fontCatalog();
    for (let n = 1; n <= pdf.numPages; n++) {
      progress(n, pdf.numPages);
      const page = await pdf.getPage(n), content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 0.1 }), canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      canvas.width = canvas.height = 1;
      const lines = []; let line;
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue;
        const size = Math.max(8, Math.min(144, Math.round(Math.hypot(item.transform[2], item.transform[3]) * 96 / 72)));
        const y = item.transform[5], x = item.transform[4];
        if (!line || Math.abs(line.y - y) > Math.max(2, size * 0.3)) { line = { y, size, items: [], end: x }; lines.push(line); }
        const style = content.styles[item.fontName] || {};
        const face = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : null;
        const family = [face?.name, face?.systemFontInfo?.css, style.fontFamily].filter(Boolean).join(' ');
        const serif = /serif|times|garamond|baskerville/i.test(family) && !/sans/i.test(family);
        const compact = family.replace(/[^a-z]/gi, '').toLowerCase();
        const match = catalog.find(f => compact.includes(f.name.replace(/[^a-z]/gi, '').toLowerCase()));
        const font = match?.name || (/mono|courier/i.test(family) ? 'Roboto Mono' : serif ? 'Libre Baskerville' : 'Roboto');
        const gap = line.items.length && x - line.end > size * 0.1 && !/\s$/.test(line.items.at(-1)) && !/^\s/.test(item.str) ? ' ' : '';
        const text = item.str.replace(/\\/g, '\\\\').replace(/([*_`\[\]~=$<>])/g, '\\$1');
        const token = Type.encode({ font, size, weight: face?.black ? 900 : face?.bold || /bold|black|heavy/i.test(item.fontName + family) ? 700 : 400, italic: face?.italic || /italic|oblique/i.test(item.fontName + family) ? 1 : undefined });
        line.items.push(gap + `<span data-opale="${token}">${text}</span>`); line.end = x + item.width;
      }
      let pageText = '';
      for (let i = 0; i < lines.length; i++) {
        const current = lines[i], previous = lines[i - 1];
        const separate = previous && (Math.abs(previous.y - current.y) > Math.max(previous.size, current.size) * 0.75 * 1.55 || Math.abs(previous.size - current.size) > 2);
        pageText += (i ? separate ? '\n\n' : '\n' : '') + current.items.join('');
      }
      pages.push(pageText);
      page.cleanup(); await new Promise(resolve => setTimeout(resolve, 0));
    }
    const text = pages.join('\n\n---\n\n');
    if (!text.trim()) throw Error('Ce PDF ne contient pas de texte extractible. Un PDF scanné nécessite une reconnaissance de caractères.');
    return text + '\n';
  } finally { await task.destroy().catch(() => {}); }
}

export async function pickPdf(view) {
  const input = h('input', { type: 'file', accept: '.pdf,application/pdf' });
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    try {
      const text = await pdfToMarkdown(new Uint8Array(await file.arrayBuffer()), (n, total) => { if (n === 1) toast(`Extraction de ${total} pages…`); });
      if (view.project?.readOnly || !view.el.isConnected) return;
      if (view.mode !== 'rich') view.setMode('rich');
      view.insertText(text); toast('Texte PDF importé. Les polices sont adaptées aux familles locales.');
    } catch (e) { reportError(e); }
  };
  input.click();
}
export async function editablePdfCopy(path) {
  const { collab, parsePath } = await import('./collab/client.js');
  const parsed = parsePath(path), assetProject = /^@shared\/([A-Za-z0-9_-]+)\/assets\//.exec(path)?.[1];
  const projectId = parsed?.project || assetProject;
  const project = projectId ? await collab.open(projectId) : null;
  if (project?.readOnly) throw Error('Votre rôle ne permet pas de créer une note dans ce projet.');
  const response = await fetch(fileUrl(path)); if (!response.ok) throw Error('Impossible de lire ce PDF.');
  toast('Extraction du texte du PDF…');
  const text = await pdfToMarkdown(new Uint8Array(await response.arrayBuffer()));
  let target;
  if (project) {
    const id = project.createFile('note', Meta.stem(path.split('/').pop()) + ' — texte', '', text);
    target = project.pathOf(project.file(id));
  } else {
    const created = await api('/api/note', { method: 'POST', body: { folder: Meta.dirName(path), name: Meta.stem(path) + ' — texte', content: text } });
    target = created.path; await app.workspace.waitFor(target);
  }
  app.workspace.openPath(target, { mode: 'rich' });
  toast('Copie modifiable créée ; le PDF original est conservé.');
}
