// Portable encoders for formats not provided by canvas.toBlob.
const textEncoder = new TextEncoder();
export const FORMATS = [
  ['png', 'PNG · sans perte'], ['jpg', 'JPEG · compact'], ['webp', 'WebP · compact'],
  ['tiff', 'TIFF · sans perte'], ['bmp', 'BMP · non compressé'], ['svg', 'SVG · capture incorporée'], ['pdf', 'PDF · impression'],
];
export const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', tiff: 'image/tiff', bmp: 'image/bmp', svg: 'image/svg+xml', pdf: 'application/pdf' };
export function bitmapBlob(canvas, dpi) {
  const { width: w, height: h } = canvas, stride = Math.ceil(w * 3 / 4) * 4;
  const header = new Uint8Array(54), view = new DataView(header.buffer);
  header.set([66, 77]); view.setUint32(2, 54 + stride * h, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, w, true); view.setInt32(22, h, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true);
  view.setUint32(34, stride * h, true); view.setInt32(38, Math.round(dpi / .0254), true); view.setInt32(42, Math.round(dpi / .0254), true);
  const pixels = canvas.getContext('2d').getImageData(0, 0, w, h).data, output = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const source = (y * w + x) * 4, target = (h - 1 - y) * stride + x * 3;
    output[target] = pixels[source + 2]; output[target + 1] = pixels[source + 1]; output[target + 2] = pixels[source];
  }
  return new Blob([header, output], { type: MIME.bmp });
}
export async function tiffBlob(canvas, dpi) {
  const { width: w, height: h } = canvas;
  const rgba = canvas.getContext('2d').getImageData(0, 0, w, h).data, rgb = new Uint8Array(w * h * 3);
  for (let source = 0, target = 0; source < rgba.length; source += 4) { rgb[target++] = rgba[source]; rgb[target++] = rgba[source + 1]; rgb[target++] = rgba[source + 2]; }
  let pixels = rgb, compression = 1;
  if (typeof CompressionStream === 'function') {
    pixels = new Uint8Array(await new Response(new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()); compression = 8;
  }
  const count = 13, extra = 8 + 2 + count * 12 + 4, offset = extra + 6 + 16;
  const header = new Uint8Array(offset), data = new DataView(header.buffer);
  header.set([73, 73, 42, 0]); data.setUint32(4, 8, true); data.setUint16(8, count, true);
  let index = 10;
  const tag = (id, type, length, value) => { data.setUint16(index, id, true); data.setUint16(index + 2, type, true); data.setUint32(index + 4, length, true); if (type === 3 && length === 1) data.setUint16(index + 8, value, true); else data.setUint32(index + 8, value, true); index += 12; };
  tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 3, extra); tag(259, 3, 1, compression);
  tag(262, 3, 1, 2); tag(273, 4, 1, offset); tag(277, 3, 1, 3); tag(278, 4, 1, h); tag(279, 4, 1, pixels.length);
  tag(282, 5, 1, extra + 6); tag(283, 5, 1, extra + 14); tag(284, 3, 1, 1); tag(296, 3, 1, 2);
  for (let i = 0; i < 3; i++) data.setUint16(extra + i * 2, 8, true);
  data.setUint32(extra + 6, dpi, true); data.setUint32(extra + 10, 1, true); data.setUint32(extra + 14, dpi, true); data.setUint32(extra + 18, 1, true);
  return new Blob([header, pixels], { type: MIME.tiff });
}
export async function svgBlob(canvas, dpi) {
  const png = canvas.toDataURL('image/png');
  return new Blob([textEncoder.encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width / dpi}in" height="${canvas.height / dpi}in" viewBox="0 0 ${canvas.width} ${canvas.height}"><image width="${canvas.width}" height="${canvas.height}" href="${png}"/></svg>`)], { type: MIME.svg });
}
// WebP stores print density in a standard EXIF chunk (TIFF resolution tags).
export async function webpDensity(blob, dpi) {
  const source = new Uint8Array(await blob.arrayBuffer());
  const exif = new Uint8Array(66), data = new DataView(exif.buffer);
  exif.set([73,73,42,0]); data.setUint32(4,8,true); data.setUint16(8,3,true);
  let at = 10;
  for (const [tag, type, value] of [[282,5,50],[283,5,58],[296,3,2]]) {
    data.setUint16(at,tag,true); data.setUint16(at+2,type,true); data.setUint32(at+4,1,true);
    if (type === 3) data.setUint16(at+8,value,true); else data.setUint32(at+8,value,true); at += 12;
  }
  data.setUint32(50,dpi,true); data.setUint32(54,1,true); data.setUint32(58,dpi,true); data.setUint32(62,1,true);
  const chunks = [], original = new DataView(source.buffer); let hasVP8X = false;
  for (let pos = 12; pos < source.length;) {
    const type = String.fromCharCode(...source.subarray(pos,pos+4)), length = original.getUint32(pos+4,true);
    if (type !== 'EXIF') { const chunk = source.slice(pos,pos+8+length+(length%2)); if (type === 'VP8X') { chunk[8] |= 8; hasVP8X = true; } chunks.push(chunk); }
    pos += 8+length+(length%2);
  }
  if (!hasVP8X) {
    const image = await createImageBitmap(blob), vp8x = new Uint8Array(18), v = new DataView(vp8x.buffer);
    vp8x.set([86,80,56,88]); v.setUint32(4,10,true); vp8x[8] = 8;
    for (let i=0;i<3;i++) { vp8x[12+i] = ((image.width-1) >> (8*i)) & 255; vp8x[15+i] = ((image.height-1) >> (8*i)) & 255; }
    image.close(); chunks.unshift(vp8x);
  }
  const head = new Uint8Array(12), h = new DataView(head.buffer); head.set([82,73,70,70,0,0,0,0,87,69,66,80]);
  const exifHead = new Uint8Array([69,88,73,70,66,0,0,0]);
  h.setUint32(4,4+chunks.reduce((sum,chunk)=>sum+chunk.length,0)+8+exif.length,true);
  return new Blob([head,...chunks,exifHead,exif],{ type:MIME.webp });
}
