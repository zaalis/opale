// Chrome may provide an image file, or only HTML and a URL.
export function droppedImageUrl(transfer) {
  if (!transfer) return '';
  const html = transfer.getData('text/html');
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const src = doc.querySelector('img[src]')?.getAttribute('src') || '';
    if (/^https:\/\//i.test(src)) return src;
  }
  const url = (transfer.getData('text/uri-list') || '').split(/\r?\n/).find((line) => line && !line.startsWith('#')) || '';
  return /^https:\/\//i.test(url) && /\.(png|jpe?g|gif|webp)(?:[?#]|$)/i.test(url) ? url : '';
}
export function mayDropImage(transfer) {
  const types = [...(transfer?.types || [])];
  return types.includes('Files') || types.includes('text/html') || types.includes('text/uri-list');
}
