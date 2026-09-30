// Packs native/icons/mac/icon_<size>.png into native/Opale.icns (PNG-compressed icns).
// Runs anywhere: node native/make-icns.js
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'icons', 'mac');
const png = (size) => fs.readFileSync(path.join(dir, `icon_${size}.png`));
// icns type -> pixel size of the PNG it carries (the @2x variants reuse the next size up).
const entries = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
];
const chunks = entries.map(([type, size]) => {
  const data = png(size);
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([head, data]);
});
const total = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
const header = Buffer.alloc(8);
header.write('icns', 0, 'ascii');
header.writeUInt32BE(total, 4);
const out = path.join(__dirname, 'Opale.icns');
fs.writeFileSync(out, Buffer.concat([header, ...chunks]));
console.log(`Wrote ${out} (${total} bytes)`);
