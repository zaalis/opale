'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { VaultError } = require('./vault.js');
let queue = Promise.resolve();
function convertPresentation(bytes, extension) {
  const task = queue.then(async () => {
    if (!['ppt', 'pptx'].includes(extension)) throw new VaultError('Format PowerPoint non pris en charge.', 400, 'invalid');
    if (process.platform !== 'win32') throw new VaultError('La conversion PowerPoint nécessite Windows et PowerPoint. Importez une version PDF sur cet appareil.', 422, 'converter-unavailable');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opale-presentation-'));
    try {
      const input = path.join(dir, `presentation.${extension}`), output = path.join(dir, 'presentation.pdf');
      const script = path.join(dir, 'convert.ps1');
      fs.writeFileSync(input, bytes);
      fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, '..', 'native', 'convert-presentation.ps1')));
      await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputPath', input, '-OutputPath', output], { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => error ? reject(new VaultError(String(stderr || 'PowerPoint n’a pas pu convertir cette présentation. Déposez une version PDF.').trim(), 422, 'presentation-conversion')) : resolve()));
      return fs.readFileSync(output);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  queue = task.catch(() => {});
  return task;
}
module.exports = { convertPresentation };
