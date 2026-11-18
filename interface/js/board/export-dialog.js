import { FORMATS } from './image-formats.js';
import { h, icon, Meta, openModal, toast } from '../core.js';
import { captureBoard, exportBoard, exportBounds, exportSize } from './export.js';

export function openExportDialog(view, initial = {}) {
  if (view.editing) view.finishEdit(true);
  let box = initial.box || null, bounds;
  try { bounds = box || exportBounds(view); } catch (error) { toast(error.message, { kind: 'error' }); return; }
  let closed = false, timer, revision = 0;
  const option = (value, text) => h('option', { value }, text);
  const select = (label, values, value) => h('select.select', { 'aria-label': label, value }, ...values.map(([v, text]) => option(v, text)));
  const field = (label, input) => h('label.export-field', h('span', label), input);
  const format = select('Format', FORMATS, initial.format || 'png');
  format.value = initial.format || 'png';
  const preset = select('Résolution', [['native', 'Taille du moodboard'], ['1920', 'Full HD · 1 920 px'], ['3840', '4K · 3 840 px'], ['7680', '8K · 7 680 px'], ['custom', 'Personnalisée']], initial.preset || '3840');
  preset.value = initial.preset || '3840';
  const width = h('input.text-input', { type: 'number', min: 1, max: 16384, step: 1, 'aria-label': 'Largeur en pixels' });
  const height = h('input.text-input', { type: 'number', min: 1, max: 16384, step: 1, 'aria-label': 'Hauteur en pixels' });
  const dpi = h('input.text-input', { type: 'number', min: 36, max: 1200, step: 1, value: initial.dpi || 144, 'aria-label': 'Pixels par pouce' });
  const quality = h('input', { type: 'range', min: 50, max: 100, step: 1, value: initial.quality || 95, 'aria-label': 'Qualité de compression' });
  const qualityLabel = h('span', `${quality.value} %`);
  const name = h('input.text-input', { value: initial.name || Meta.stem(view.path), 'aria-label': 'Nom du fichier', maxLength: 160 });
  const preview = h('div.export-preview.media-loading', { role: 'img', 'aria-label': 'Aperçu de la capture du moodboard', 'aria-busy': 'true' });
  const summary = h('p.export-summary', { role: 'status' });
  const error = h('p.field-error', { role: 'alert', hidden: true });
  const area = h('span.export-area', box ? 'Zone personnalisée' : 'Tout le moodboard');
  const capture = h('button.btn.export-crop', { type: 'button' }, h('span', { html: icon('camera', 17), 'aria-hidden': 'true' }), 'Enregistrement personnalisé');
  const all = h('button.btn', { type: 'button' }, 'Tout le moodboard');
  const qualityField = field('Qualité', h('div.export-quality', quality, qualityLabel));
  const controls = h('div.export-controls', field('Nom du fichier', name), field('Format', format), field('Résolution · côté le plus long', preset), h('div.export-dimensions', field('Largeur · px', width), h('span.export-ratio', { title: 'Proportions conservées', 'aria-label': 'Proportions conservées' }, '×'), field('Hauteur · px', height)), field('Densité · pixels par pouce', dpi), qualityField, summary, error);
  const save = h('button.btn.primary', { type: 'button' }, 'Enregistrer sous…');
  const options = () => ({ box, width: Number(width.value), height: Number(height.value), dpi: Number(dpi.value), quality: Number(quality.value) / 100, name: name.value });
  const fail = message => { error.textContent = message; error.hidden = !message; };
  const update = () => {
    fail('');
    qualityField.hidden = !['jpg', 'webp', 'pdf'].includes(format.value);
    try {
      const size = exportSize(bounds, options());
      if (!Number.isInteger(Number(dpi.value)) || Number(dpi.value) < 36 || Number(dpi.value) > 1200) throw new Error('Choisissez une densité entre 36 et 1 200 ppp.');
      if (format.value === 'pdf' && Math.max(size.width, size.height) / Number(dpi.value) > 200) throw new Error('Pour ce PDF, augmentez la densité ou réduisez la résolution : un côté dépasse 508 cm.');
      summary.textContent = `${size.width.toLocaleString('fr-FR')} × ${size.height.toLocaleString('fr-FR')} px · ${(size.width * size.height / 1e6).toFixed(1)} Mpx · ${(size.width / Number(dpi.value) * 2.54).toFixed(1)} × ${(size.height / Number(dpi.value) * 2.54).toFixed(1)} cm`;
      save.disabled = false;
    } catch (problem) { fail(problem.message); save.disabled = true; }
  };
  const setSize = () => {
    const edge = preset.value === 'native' ? Math.max(bounds.w, bounds.h) : Number(preset.value);
    if (preset.value !== 'custom') {
      width.value = Math.max(1, Math.round(edge * bounds.w / Math.max(bounds.w, bounds.h)));
      height.value = Math.max(1, Math.round(edge * bounds.h / Math.max(bounds.w, bounds.h)));
    }
    update();
  };
  const renderPreview = async () => {
    const own = ++revision;
    preview.classList.add('media-loading'); preview.setAttribute('aria-busy', 'true');
    try {
      const scale = Math.min(1, 1000 / Math.max(bounds.w, bounds.h));
      const canvas = await captureBoard(view, { box: bounds, width: Math.max(1, Math.round(bounds.w * scale)), height: Math.max(1, Math.round(bounds.h * scale)) });
      if (closed || own !== revision) return;
      preview.replaceChildren(h('img', { src: canvas.toDataURL(), alt: 'Aperçu du moodboard exporté' }));
    } catch (problem) { if (!closed) { fail(problem.message); save.disabled = true; } }
    finally { if (!closed && own === revision) { preview.classList.remove('media-loading'); preview.setAttribute('aria-busy', 'false'); } }
  };
  const snapshot = () => ({ ...options(), preset: preset.value, format: format.value, quality: Number(quality.value) });
  capture.onclick = async () => {
    const saved = snapshot(); modal.close();
    modal.el.parentElement.style.pointerEvents = 'none';
    const selected = await view.input.captureRegion();
    if (selected && saved.preset === 'custom') saved.height = Math.max(1, Math.round(saved.width * selected.h / selected.w));
    if (view.el.isConnected) openExportDialog(view, { ...saved, box: selected || box });
  };
  all.onclick = () => { box = null; bounds = exportBounds(view); area.textContent = 'Tout le moodboard'; if (preset.value === 'custom') height.value = Math.max(1, Math.round(Number(width.value) * bounds.h / bounds.w)); setSize(); renderPreview(); };
  preset.onchange = setSize;
  width.oninput = () => { preset.value = 'custom'; height.value = Math.max(1, Math.round(Number(width.value) * bounds.h / bounds.w)); update(); };
  height.oninput = () => { preset.value = 'custom'; width.value = Math.max(1, Math.round(Number(height.value) * bounds.w / bounds.h)); update(); };
  format.onchange = dpi.oninput = update;
  quality.oninput = () => { qualityLabel.textContent = `${quality.value} %`; update(); };
  save.onclick = async () => {
    update(); if (save.disabled) return;
    save.disabled = true; save.textContent = 'Préparation…'; controls.setAttribute('aria-busy', 'true');
    try { if (await exportBoard(view, format.value, options())) modal.close(); }
    catch (problem) { fail(problem.message); }
    finally { if (!closed) { save.textContent = 'Enregistrer sous…'; save.disabled = false; controls.setAttribute('aria-busy', 'false'); } }
  };
  const modal = openModal({ title: 'Exporter le moodboard', className: 'modal-board-export', body: h('div', h('div.export-area-bar', area, capture, all), h('div.export-layout', preview, controls)), footer: [h('button.btn', { type: 'button', onClick: () => modal.close() }, 'Annuler'), save], onClose: () => { closed = true; clearTimeout(timer); revision++; } });
  if (initial.width && initial.height && preset.value === 'custom') { width.value = initial.width; height.value = initial.height; update(); } else setSize();
  timer = setTimeout(renderPreview, 0);
  return modal;
}
