'use strict';

// Everything in Opale's server that depends on the operating system: where the
// per-user data lives, the folder picker, "show in the file manager", the system
// trash, and where the desktop shell sits next to the server.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync, spawn } = require('child_process');
const { pathToFileURL } = require('url');

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const LINUX = !WIN && !MAC;

// Per-user configuration folder. Mirrors what zaalis IDE looks for, so both
// programs find each other's files.
function configRoot() {
  if (process.env.APPDATA) return process.env.APPDATA;
  if (MAC) return path.join(os.homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

// Key under which two spellings of one path are the same path: Windows and
// macOS volumes ignore case, Linux does not. Accents are compared composed
// (NFC) because macOS hands back file names decomposed.
function pathKey(value) {
  const text = String(value).normalize('NFC');
  return LINUX ? text : text.toLowerCase();
}

const isFile = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };

// Where the desktop shell may sit, given the folder of the server (or of the project).
function shellCandidates(base) {
  if (WIN) return [path.join(base, 'Opale.exe'), path.join(base, 'dist', 'Opale.exe')];
  if (MAC) return [path.join(base, 'Opale'), path.join(base, 'dist', 'Opale.app', 'Contents', 'MacOS', 'Opale')];
  return [path.join(base, 'opale'), path.join(base, 'dist', 'opale')];
}
function findShell(base) { return shellCandidates(base).find(isFile) || null; }

// ------------------------------------------------------------ folder picker
const PICK_TITLE = 'Choisissez le dossier du coffre';

function cancelled(error, stdout) { return error && error.code === 1 && !String(stdout || '').trim(); }
function cleanPicked(text) {
  const picked = String(text || '').trim();
  return picked.length > 1 ? picked.replace(/[\\/]+$/, '') : picked;
}

function pickFolder(base) {
  return new Promise((resolve, reject) => {
    const fail = (error) => reject(Object.assign(new Error(`Sélecteur de dossier indisponible : ${error.message}`), { code: 'picker' }));

    if (WIN) {
      const done = (error, stdout) => (error ? fail(error) : resolve(String(stdout || '').trim()));
      const picker = [path.join(base, 'pickfolder.exe'), path.join(base, 'dist', 'pickfolder.exe')].find(isFile);
      if (picker) return execFile(picker, { timeout: 300000, windowsHide: true }, done);
      const script = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${PICK_TITLE}'; $d.ShowNewFolderButton = $true; $null = $d.ShowDialog(); [Console]::Out.Write($d.SelectedPath)`;
      return execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeout: 300000, windowsHide: true }, done);
    }

    if (MAC) {
      const script = `tell me to activate\ntry\nset chosen to choose folder with prompt "${PICK_TITLE}"\nreturn POSIX path of chosen\non error number -128\nreturn ""\nend try`;
      return execFile('osascript', ['-e', script], { timeout: 300000 }, (error, stdout) => (error ? fail(error) : resolve(cleanPicked(stdout))));
    }

    // Linux: Opale's own GTK helper (it speaks to the desktop portal), then what the desktop brings.
    const candidates = [
      [path.join(base, 'opale-pickfolder'), []],
      [path.join(base, 'dist', 'opale-pickfolder'), []],
      ['zenity', ['--file-selection', '--directory', `--title=${PICK_TITLE}`]],
      ['kdialog', ['--getexistingdirectory', os.homedir(), '--title', PICK_TITLE]],
      ['yad', ['--file', '--directory', `--title=${PICK_TITLE}`]],
    ];
    const attempt = (index) => {
      if (index >= candidates.length) return fail(new Error('installez zenity ou kdialog.'));
      const [command, args] = candidates[index];
      if (path.isAbsolute(command) && !isFile(command)) return attempt(index + 1);
      execFile(command, args, { timeout: 300000 }, (error, stdout) => {
        if (error && error.code === 'ENOENT') return attempt(index + 1);
        if (cancelled(error, stdout)) return resolve('');
        return error ? fail(error) : resolve(cleanPicked(stdout));
      });
    };
    attempt(0);
  });
}

// ------------------------------------------------------ file manager reveal
function detached(command, args) {
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

// Show `full` in Finder / Explorer / the desktop's file manager; with `select`
// the item itself is highlighted in its folder instead of being opened.
function reveal(full, select) {
  if (WIN) return detached('explorer.exe', select ? [`/select,${full}`] : [full]);
  if (MAC) return detached('open', select ? ['-R', full] : [full]);
  const parent = select ? path.dirname(full) : full;
  if (!select) return detached('xdg-open', [parent]);
  // Most Linux file managers implement org.freedesktop.FileManager1: it selects the file.
  execFile('gdbus', ['call', '--session', '--dest', 'org.freedesktop.FileManager1', '--object-path', '/org/freedesktop/FileManager1',
    '--method', 'org.freedesktop.FileManager1.ShowItems', `['${pathToFileURL(full).href}']`, ''], { timeout: 5000 }, (error) => {
    if (error) detached('xdg-open', [parent]);
  });
}

// Open a web address in the user's browser (only when there is no desktop shell).
function openUrl(url, homeDir) {
  if (MAC) return detached('open', [url]);
  if (LINUX) return detached('xdg-open', [url]);
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const edge = roots.map((root) => path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(isFile);
  if (edge) return detached(edge, [`--app=${url}`, `--user-data-dir=${path.join(homeDir, 'Fenetre')}`, '--no-first-run', '--no-default-browser-check']);
  spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

// ------------------------------------------------------------- system trash
const pad = (value) => String(value).padStart(2, '0');

// The freedesktop.org trash of the user's home volume (what "gio trash" does).
// Files on another volume are left to the caller, which falls back to the vault's own trash.
function freedesktopTrash(full) {
  try {
    const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    const files = path.join(dataHome, 'Trash', 'files');
    const info = path.join(dataHome, 'Trash', 'info');
    fs.mkdirSync(files, { recursive: true, mode: 0o700 });
    fs.mkdirSync(info, { recursive: true, mode: 0o700 });
    const now = new Date();
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const encoded = full.split('/').map(encodeURIComponent).join('/');
    const body = `[Trash Info]\nPath=${encoded}\nDeletionDate=${stamp}\n`;
    const parsed = path.parse(full);
    for (let index = 0; index < 1000; index++) {
      const name = index ? `${parsed.name}.${index}${parsed.ext}` : parsed.base;
      const infoFile = path.join(info, `${name}.trashinfo`);
      const target = path.join(files, name);
      if (fs.existsSync(target)) continue;
      try { fs.writeFileSync(infoFile, body, { flag: 'wx' }); } catch (error) { if (error.code === 'EEXIST') continue; throw error; }
      try { fs.renameSync(full, target); return true; } catch { fs.rmSync(infoFile, { force: true }); return false; }
    }
    return false;
  } catch { return false; }
}

// Send a file or folder to the system trash. Returns false when that was not possible.
function trash(full, directory) {
  try {
    if (WIN) {
      const call = directory ? 'DeleteDirectory' : 'DeleteFile';
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${call}($env:OPALE_TARGET, 'OnlyErrorDialogs', 'SendToRecycleBin')`],
      { env: { ...process.env, OPALE_TARGET: full }, windowsHide: true, timeout: 20000, stdio: 'ignore' });
      return !fs.existsSync(full);
    }
    if (MAC) {
      // Through Finder, so "Put Back" works. The first use asks for permission to control Finder.
      try {
        execFileSync('osascript', ['-e', 'on run argv', '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', '-e', 'end run', full],
          { timeout: 20000, stdio: 'ignore' });
      } catch {}
      if (!fs.existsSync(full)) return true;
      // Permission refused (or Finder busy): Foundation's own trash, which needs none.
      execFileSync('osascript', ['-l', 'JavaScript', '-e', 'function run(argv) { ObjC.import("Foundation"); $.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(argv[0]), null, null); }', full],
        { timeout: 20000, stdio: 'ignore' });
      return !fs.existsSync(full);
    }
    try {
      execFileSync('gio', ['trash', '--', full], { timeout: 20000, stdio: 'ignore' });
      if (!fs.existsSync(full)) return true;
    } catch {}
    return freedesktopTrash(full);
  } catch { return false; }
}

module.exports = { WIN, MAC, LINUX, configRoot, pathKey, isFile, findShell, shellCandidates, pickFolder, reveal, openUrl, trash, freedesktopTrash };
