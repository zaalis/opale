import { FORMATS, MIME, bitmapBlob, tiffBlob, svgBlob, webpDensity } from './image-formats.js';
// Local visual exports. Capture the whole visible board, independent of its camera.
import { Meta } from '../core.js';
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
    clone.style.visibility = 'visible';
    clone.classList.remove('media-loading', 'is-broken');
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

export function exportBounds(view) {
  const visible = view.doc.elements.filter(el => view.layer(el.layer)?.visible !== false);
  if (!visible.length) throw new Error('Le moodboard ne contient aucun élément visible à exporter.');
  const box = Board.union(visible.map(el => {
    if (el.kind !== 'connector') return Board.bounds(el, view.lookup);
    const points = Board.connectorPath(el, view.lookup).points;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }));
  return { x: box.x - 48, y: box.y - 48, w: Math.ceil(box.w + 96), h: Math.ceil(box.h + 96) };
}
export function exportSize(box, options = {}) {
  let width = Number(options.width), height = Number(options.height);
  if ((options.width !== undefined && (!Number.isInteger(width) || width < 1)) || (options.height !== undefined && (!Number.isInteger(height) || height < 1))) throw new Error('Indiquez des dimensions positives en pixels.');
  if (!width && !height) {
    const scale = Math.min(2, 8192 / box.w, 8192 / box.h, Math.sqrt(24000000 / (box.w * box.h)));
    width = Math.round(box.w * scale); height = Math.round(box.h * scale);
  } else if (!height) height = Math.round(width * box.h / box.w);
  else if (!width) width = Math.round(height * box.w / box.h);
  if (![width, height].every(Number.isInteger) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 64000000)
    throw new Error('Choisissez des dimensions entre 1 et 16 384 pixels, dans la limite de 64 mégapixels.');
  return { width, height };
}
export async function captureBoard(view, options = {}) {
  if (view.editing) view.finishEdit(true);
  if (view.frame) { cancelAnimationFrame(view.frame); view.paint(); }
  await document.fonts.ready;
  const box = options.box || exportBounds(view);
  if (![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w <= 0 || box.h <= 0) throw new Error('Zone de capture invalide.');
  const visible = view.doc.elements.filter(el => {
    if (view.layer(el.layer)?.visible === false) return false;
    if (!options.box) return true;
    const bounds = Board.bounds(el, view.lookup);
    return bounds && bounds.x <= box.x + box.w && bounds.x + bounds.w >= box.x && bounds.y <= box.y + box.h && bounds.y + bounds.h >= box.y;
  });
  const width = box.w, height = box.h;
  const size = exportSize(box, options);
  const canvas = document.createElement('canvas');
  canvas.width = size.width; canvas.height = size.height;
  const root = document.createElement('div');
  const background = getComputedStyle(view.stage).backgroundColor;
  root.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${background};`;
  const world = document.createElement('div');
  world.style.cssText = `position:absolute;left:${-box.x}px;top:${-box.y}px;width:0;height:0;`;
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
  const markup = new XMLSerializer().serializeToString(root);
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
export function jpegPdf(jpeg, width, height, dpi = 144) {
  const pageScale = Math.min(72 / dpi, 14400 / width, 14400 / height);
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

// Set real print density metadata, independently of the pixel dimensions.
export async function withDensity(blob, format, dpi) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (format === 'jpg') {
    if (bytes[2] === 255 && bytes[3] === 224 && String.fromCharCode(...bytes.slice(6, 10)) === 'JFIF') {
      bytes[13] = 1; bytes[14] = dpi >> 8; bytes[15] = dpi & 255; bytes[16] = dpi >> 8; bytes[17] = dpi & 255;
    }
    return new Blob([bytes], { type: 'image/jpeg' });
  }
  if (format !== 'png') return blob;
  const chunk = new Uint8Array(21), data = new DataView(chunk.buffer);
  data.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4);
  const ppm = Math.round(dpi / 0.0254); data.setUint32(8, ppm); data.setUint32(12, ppm); chunk[16] = 1;
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 17)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  data.setUint32(17, (crc ^ 0xffffffff) >>> 0);
  // Replace an existing pHYs chunk instead of writing contradictory densities.
  const parts = [bytes.subarray(0, 8)];
  for (let pos = 8; pos < bytes.length;) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + pos, 4).getUint32(0) + 12;
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    if (type !== 'pHYs') parts.push(bytes.subarray(pos, pos + length));
    if (type === 'IHDR') parts.push(chunk);
    pos += length;
  }
  return new Blob(parts, { type: 'image/png' });
}
export async function exportBoard(view, format, options = {}) {
  if (!FORMATS.some(([id]) => id === format)) throw new Error('Format d’export inconnu.');
  const dpi = Number(options.dpi || 144);
  if (!Number.isInteger(dpi) || dpi < 36 || dpi > 1200) throw new Error('La densité doit être comprise entre 36 et 1 200 ppp.');
  const name = `${(options.name || Meta.stem(view.path)).replace(/[<>:"|?*\\/\u0000-\u001f]/g, '-').replace(/[. ]+$/, '') || 'Moodboard'}.${format}`;
  const mime = MIME[format];
  // Request the destination during the user's click, before asynchronous capture.
  let handle;
  if (typeof window.showSaveFilePicker === 'function' && !window.chrome?.webview) {
    try { handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: format.toUpperCase(), accept: { [mime]: [`.${format}`] } }] }); }
    catch (error) { if (error.name === 'AbortError') return false; throw error; }
  }
  const canvas = await captureBoard(view, options);
  let blob;
  if (format === 'tiff') blob = await tiffBlob(canvas, dpi);
  else if (format === 'bmp') blob = bitmapBlob(canvas, dpi);
  else if (format === 'svg') blob = await svgBlob(canvas, dpi);
  else {
    const raster = format === 'pdf' ? 'jpg' : format;
    const image = await new Promise(resolve => canvas.toBlob(resolve, MIME[raster], Number(options.quality ?? .95)));
    if (!image || image.type !== MIME[raster]) throw new Error('Ce navigateur ne peut pas encoder ce format. Choisissez PNG, JPEG ou TIFF.');
    blob = format === 'pdf' ? jpegPdf(new Uint8Array(await image.arrayBuffer()), canvas.width, canvas.height, dpi) : format === 'webp' ? await webpDensity(image, dpi) : await withDensity(image, format, dpi);
  }
  if (handle) {
    const output = await handle.createWritable();
    try { await output.write(blob); await output.close(); } catch (error) { await output.abort().catch(() => {}); throw error; }
  } else {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return true;
}
