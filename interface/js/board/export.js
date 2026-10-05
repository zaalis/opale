// Local visual exports. Capture the whole visible board, independent of its camera.
import { Meta } from '../core.js';
import { hasShell, tellShell } from '../platform.js';
const Board = window.OpaleBoard;
const encoder = new TextEncoder();

function blobData(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Impossible de lire une image du moodboard.'));
    reader.readAsDataURL(blob);
  });
}

async function copyVisual(source) {
  const clone = source.cloneNode(false);
  const computed = getComputedStyle(source);
  for (const property of computed) clone.style.setProperty(property, computed.getPropertyValue(property));
  clone.style.animation = 'none'; clone.style.transition = 'none';
  // No executable attributes or remote documents in the exported snapshot.
  for (const attribute of [...clone.attributes]) if (/^on/i.test(attribute.name)) clone.removeAttribute(attribute.name);
  if (source instanceof HTMLImageElement) {
    const url = source.currentSrc || source.src;
    if (!url.startsWith('data:')) {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Impossible de charger une image pour l’export.');
      clone.src = await blobData(await response.blob());
    }
    clone.removeAttribute('srcset'); clone.removeAttribute('loading');
  } else if (source instanceof HTMLIFrameElement || source instanceof HTMLVideoElement) {
    const placeholder = document.createElement('div');
    placeholder.style.cssText = clone.style.cssText;
    placeholder.style.display = 'flex'; placeholder.style.alignItems = 'center';
    placeholder.style.justifyContent = 'center'; placeholder.style.padding = '16px';
    placeholder.style.overflowWrap = 'anywhere';
    placeholder.textContent = source.getAttribute('src') || 'Vidéo';
    return placeholder;
  } else if (source instanceof HTMLInputElement) {
    clone.setAttribute('value', source.value);
    if (source.checked) clone.setAttribute('checked', ''); else clone.removeAttribute('checked');
  } else if (source instanceof HTMLTextAreaElement) {
    clone.textContent = source.value; return clone;
  }
  for (const child of source.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      if (!['SCRIPT', 'STYLE'].includes(child.tagName)) clone.append(await copyVisual(child));
    } else if (child.nodeType === Node.TEXT_NODE) clone.append(child.cloneNode());
  }
  if (source instanceof HTMLSelectElement) [...clone.options].forEach((option, i) => {
    if (i === source.selectedIndex) option.setAttribute('selected', ''); else option.removeAttribute('selected');
  });
  return clone;
}

// The whole board as self-contained markup (computed styles inline, pictures as
// data URLs), with its size in CSS pixels and the resolution to render it at.
export async function snapshotBoard(view) {
  if (view.editing) view.finishEdit(true);
  if (view.frame) { cancelAnimationFrame(view.frame); view.paint(); }
  await document.fonts.ready;
  const visible = view.doc.elements.filter((el) => view.layer(el.layer)?.visible !== false);
  if (!visible.length) throw new Error('Le moodboard ne contient aucun élément visible à exporter.');
  const box = Board.union(visible.map((el) => {
    if (el.kind !== 'connector') return Board.bounds(el, view.lookup);
    const points = Board.connectorPath(el, view.lookup).points;
    const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }));
  const margin = 48;
  const width = Math.ceil(box.w + margin * 2); const height = Math.ceil(box.h + margin * 2);
  // Bound memory usage for very large infinite boards while preserving proportions.
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(24000000 / (width * height)));
  const root = document.createElement('div');
  const background = getComputedStyle(view.stage).backgroundColor;
  root.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${background};`;
  const world = document.createElement('div');
  world.style.cssText = `position:absolute;left:${margin - box.x}px;top:${margin - box.y}px;width:0;height:0;`;
  root.append(world);
  for (const el of visible) {
    const source = view.nodes.get(el.id);
    if (!source) continue;
    const clone = await copyVisual(source);
    if (source.classList.contains('is-selected')) clone.style.filter = 'none';
    clone.querySelectorAll('.b-mini, .b-flip-btn, .broken-dot').forEach((node) => node.remove());
    if (view.doc.settings.privateMode) clone.querySelectorAll('.b-sticky-text').forEach((node) => { node.style.filter = 'blur(7px)'; });
    world.append(clone);
  }
  return { markup: new XMLSerializer().serializeToString(root), width, height, scale, background };
}

export async function captureBoard(view) {
  const { markup, width, height, scale, background } = await snapshotBoard(view);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Impossible de préparer l’export du moodboard.');
  context.fillStyle = background; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return canvas;
}

// A single-page PDF with an RGB JPEG XObject (ISO 32000-1, DCTDecode).
export function jpegPdf(jpeg, width, height) {
  const pageScale = Math.min(0.5, 14400 / width, 14400 / height);
  const w = Number((width * pageScale).toFixed(3)); const h = Number((height * pageScale).toFixed(3));
  const chunks = []; const offsets = [0]; let length = 0;
  const append = (value) => { const bytes = typeof value === 'string' ? encoder.encode(value) : value; chunks.push(bytes); length += bytes.length; };
  const object = (id, value) => { offsets[id] = length; append(`${id} 0 obj\n${value}\nendobj\n`); };
  append('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  append(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  append(jpeg); append('\nendstream\nendobj\n');
  const commands = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
  object(5, `<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}endstream`);
  const xref = length;
  append('xref\n0 6\n0000000000 65535 f \n');
  for (const offset of offsets.slice(1)) append(`${String(offset).padStart(10, '0')} 00000 n \n`);
  append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

// macOS: WebKit marks a canvas that drew an SVG <foreignObject> as unreadable, so
// the native shell renders the snapshot itself (vector PDF, or JPEG) and saves it.
const pending = new Map();
let nextExport = 0;
window.opaleExportDone = (id, error) => {
  const done = pending.get(id);
  if (!done) return;
  pending.delete(id);
  if (error) done.reject(new Error(error)); else done.resolve();
};

async function exportNative(view, format) {
  const snapshot = await snapshotBoard(view);
  const id = ++nextExport;
  const finished = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  tellShell({ type: 'exportBoard', id, format, name: `${Meta.stem(view.path)}.${format}`, ...snapshot });
  return finished;
}

export async function exportBoard(view, format) {
  if (!['pdf', 'jpg'].includes(format)) throw new Error('Format d’export inconnu.');
  if (hasShell()) return exportNative(view, format);
  const canvas = await captureBoard(view);
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  if (!jpeg) throw new Error('Impossible de générer l’image du moodboard.');
  const blob = format === 'jpg' ? jpeg : jpegPdf(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url;
  link.download = `${Meta.stem(view.path)}.${format}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
