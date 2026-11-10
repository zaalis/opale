// Opale for Android tablets. The same workspace as the desktop interface —
// ribbon, side panels, tabs, live preview, moodboards, graph — laid out for
// touch. Files are stored through window.OpaleNative (VaultBridge.kt); in a
// plain browser a localStorage fallback keeps the page usable for testing.
(() => {
'use strict';
const scr = document.getElementById('app');
const picker = document.getElementById('picker');

// ------------------------------------------------------------------ icons
const I = {
'board-select':'<path d="m5 3 14 10-7 1-3 7Z"/>',
'board-hand':'<path d="M8 12V6a1.5 1.5 0 0 1 3 0v5V4a1.5 1.5 0 0 1 3 0v7V6a1.5 1.5 0 0 1 3 0v6V9a1.5 1.5 0 0 1 3 0v6c0 4-2.5 6-6 6h-1c-2 0-3.5-1-4.5-2.5L5 14a1.6 1.6 0 0 1 2.5-2Z"/>',
'board-text':'<path d="M5 7V4h14v3M12 4v16M8 20h8"/>',
'board-sticky':'<path d="M14 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9Z"/><path d="M14 21v-5a2 2 0 0 1 2-2h5M7 8h10M7 12h5"/>',
'board-shape':'<rect x="3" y="3" width="9" height="9" rx="2"/><circle cx="16" cy="16" r="5"/>',
'board-connector':'<circle cx="5" cy="18" r="2"/><path d="M7 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h5m-4-3 4 3-4 3"/>',
'board-pen':'<path d="m12 3 7 7-4 9-7 2-5-5 2-7Z"/><path d="m12 3 3-2 7 7-3 2M4 20l6-6"/><circle cx="12" cy="12" r="2"/>',
'board-highlighter':'<path d="M8 3h8v8l-2 3h-4l-2-3Z"/><path d="M8 8h8M10 14v4l4-2v-2"/><path d="M5 21h14" stroke-width="3"/>',
'board-eraser':'<path d="m4 12 8-8a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3l-7 7H9l-5-5a2 2 0 0 1 0-3ZM8 8l10 10M14 20h7"/>',
'board-frame':'<path d="M7 3v18M17 3v18M3 7h18M3 17h18"/>',
'board-comment':'<path d="M21 11a8 8 0 0 1-8 8H8l-5 3V11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"/><path d="M7 9h10M7 13h7"/>',
files:'<path d="M4 5a2 2 0 0 1 2-2h4l2 3h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>',
file:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
'file-plus':'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M12 12v6M9 15h6"/>',
'folder-plus':'<path d="M4 5a2 2 0 0 1 2-2h4l2 3h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M12 10v6M9 13h6"/>',
search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
bookmark:'<path d="M6 4h12v17l-6-4-6 4Z"/>',
tag:'<path d="M3 12V4h8l10 10-8 8Z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
graph:'<circle cx="6" cy="7" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="12" cy="17" r="2.8"/><path d="m7.6 8.8 3 5.8M16.6 8 13.6 14.5M8.4 6.8l7.2-.6"/>',
calendar:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
template:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 9v11"/>',
command:'<path d="m6 8 4 4-4 4M13 16h5"/><rect x="3" y="4" width="18" height="16" rx="2"/>',
settings:'<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.2-1.3L14 3h-4l-.4 2.4a7 7 0 0 0-2.2 1.3l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .9.1 1.3l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.2 1.3L10 21h4l.4-2.4a7 7 0 0 0 2.2-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3Z"/>',
vault:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5V7M12 17v-1.5M15.5 12H17M7 12h1.5"/>',
plus:'<path d="M12 5v14M5 12h14"/>', x:'<path d="M18 6 6 18M6 6l12 12"/>', check:'<path d="M20 6 9 17l-5-5"/>',
'chevron-right':'<path d="m9 6 6 6-6 6"/>', 'chevron-down':'<path d="m6 9 6 6 6-6"/>',
back:'<path d="M19 12H5M11 6l-6 6 6 6"/>', forward:'<path d="M5 12h14M13 6l6 6-6 6"/>',
book:'<path d="M4 5a2 2 0 0 1 2-2h6v16H6a2 2 0 0 0-2 2Z"/><path d="M20 5a2 2 0 0 0-2-2h-6v16h6a2 2 0 0 1 2 2Z"/>',
pencil:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
more:'<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
'link-in':'<path d="M9 7H6a5 5 0 0 0 0 10h3M15 7h3a5 5 0 0 1 0 10h-3M8 12h8"/>',
'link-out':'<path d="M14 5h5v5M19 5l-8 8"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>',
outline:'<path d="M4 6h16M8 12h12M12 18h8"/>',
'sidebar-left':'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
'sidebar-right':'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
sort:'<path d="M4 7h10M4 12h7M4 17h4M17 6v12M14 15l3 3 3-3"/>',
collapse:'<path d="m7 9 5-5 5 5M7 15l5 5 5-5"/>',
locate:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
dice:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h.01M15 15h.01M15 9h.01M9 15h.01M12 12h.01"/>',
image:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 18 5-5 3 3 3-3 3 3"/>',
pin:'<path d="M9 4h6l-1 6 3 3H7l3-3ZM12 13v7"/>',
'cloud-off':'<path d="M9 6.3A6 6 0 0 1 17.8 10.6 3.8 3.8 0 0 1 19.6 17M15 18H7a4.5 4.5 0 0 1-1.8-8.6M3 3l18 18"/>',
users:'<circle cx="9" cy="8" r="3.2"/><path d="M3 19a6 6 0 0 1 12 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 19a6 6 0 0 0-2.5-4.9"/>',
};
const ic = (n, s = 18) => `<svg class="icon" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || ''}</svg>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ib = (n, t, a, x = '', c = '') => `<button type="button" class="ib ${c}" title="${esc(t)}" aria-label="${esc(t)}" data-act="${a}" ${x}>${ic(n)}</button>`;
const $ = (s, r = scr) => r.querySelector(s);
const stem = (p) => p.split('/').pop().replace(/\.[^.]+$/, '');
const extOf = (p) => { const m = p.match(/\.([^./]+)$/); return m ? m[1].toLowerCase() : ''; };
const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const SHARED = '.partages';
const shared = (p) => p.startsWith(SHARED + '/');
const projectOf = (p) => p.split('/')[1];
const hidden = (p) => p.split('/').some((x) => x.startsWith('.'));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BAD = /[\\/:*?"<>|#^\[\]]/;
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const typeOf = (p) => { const e = extOf(p); return e === 'md' ? 'note' : e === 'board' ? 'board' : /^(png|jpe?g|gif|webp|bmp|svg)$/.test(e) ? 'image' : 'other'; };
const ILLU = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420"><rect width="640" height="420" fill="#2b3a55"/><rect y="250" width="640" height="170" fill="#3d2f2a"/><circle cx="500" cy="110" r="46" fill="#fbbf24"/><path d="M0 260 160 120 300 250 420 160 640 270V420H0Z" fill="#1f2a40"/><rect x="80" y="290" width="200" height="16" rx="4" fill="#8b6b4a"/><rect x="100" y="306" width="10" height="70" fill="#6b5038"/><rect x="250" y="306" width="10" height="70" fill="#6b5038"/><rect x="380" y="200" width="150" height="110" rx="6" fill="#ecebf3"/><rect x="392" y="212" width="126" height="86" fill="#a78bfa"/></svg>';
const ILLU_URL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ILLU);

// ---------------------------------------------------------------- storage
const FB = {
  db(v) { try { return JSON.parse(localStorage.getItem('opale-fb:' + v) || '{"files":{},"folders":[]}'); } catch (_) { return { files: {}, folders: [] }; } },
  put(v, d) { try { localStorage.setItem('opale-fb:' + v, JSON.stringify(d)); return true; } catch (_) { return false; } },
  vaults() { try { return localStorage.getItem('opale-fb-vaults') || '[]'; } catch (_) { return '[]'; } },
  createVault(n) { const a = JSON.parse(this.vaults()); if (!a.includes(n)) a.push(n); try { localStorage.setItem('opale-fb-vaults', JSON.stringify(a)); } catch (_) {} return true; },
  vaultPath(n) { return 'Stockage du navigateur / ' + n; },
  load(v) { const d = this.db(v); return JSON.stringify({ files: Object.entries(d.files).map(([p, f]) => ({ p, t: typeOf(p), x: f.x })), folders: d.folders }); },
  write(v, p, x) { const d = this.db(v); d.files[p] = { x }; return this.put(v, d); },
  writeBase64(v, p, b) { const d = this.db(v); d.files[p] = { b }; return this.put(v, d); },
  remove(v, p) { const d = this.db(v); delete d.files[p]; return this.put(v, d); },
  move(v, a, b) { const d = this.db(v); if (d.files[b] || !d.files[a]) return false; d.files[b] = d.files[a]; delete d.files[a]; return this.put(v, d); },
  mkdir(v, p) { const d = this.db(v); if (!d.folders.includes(p)) d.folders.push(p); return this.put(v, d); },
  dataUrl(v, p) { const f = this.db(v).files[p]; return f && f.b ? `data:image/${extOf(p) === 'png' ? 'png' : 'jpeg'};base64,${f.b}` : ''; },
  getState() { try { return localStorage.getItem('opale-fb-state') || ''; } catch (_) { return ''; } },
  setState(s) { try { localStorage.setItem('opale-fb-state', s); } catch (_) {} },
  setDark() {},
  savePdf() { return false; },
};
const OS = window.OpaleNative || FB;
const NATIVE = !!window.OpaleNative;

// ------------------------------------------------------------------ state
const S = {
  orient: 'land', theme: 'dark', accent: '#fbbf24', fs: 16, readable: true, spell: true, vault: 'Opale',
  left: { open: true, tab: 'files', w: 260 }, right: { open: true, tab: 'backlinks', w: 280 }, landOpen: { left: true, right: true },
  tabs: [], active: null, expanded: new Set(), selF: '', bookmarks: [], search: '', modes: {}, tagSort: 'count', sort: 'az',
  collab: true, proj: {}, projects: [], graph: { tags: false, names: true, size: 1, ctl: false }, saving: false, per: {},
};
let tid = 1;
const FILES = new Map();
const FOLDERS = new Set();
const opening = new Set();
const imgCache = new Map();

const isNote = (p) => FILES.get(p)?.type === 'note';
const linksOf = (t) => [...t.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((m) => m[1].trim());
const strip = (t) => t.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
const tagsOf = (t) => [...new Set([...strip(t).matchAll(/(^|\s)#([\p{L}\w-]+)/gu)].map((m) => m[2]))];
function resolve(n) { n = n.toLowerCase(); for (const [p, f] of FILES) if ((f.type === 'note' || f.type === 'board') && stem(p).toLowerCase() === n) return p; return null; }
function backlinks(p) { const out = []; const s = stem(p).toLowerCase(); for (const [q, f] of FILES) { if (q === p || f.type !== 'note') continue; const ls = f.text.split('\n').filter((l) => linksOf(l).some((x) => x.toLowerCase() === s)); if (ls.length) out.push([q, ls]); } return out; }
const words = (t) => (t.match(/\S+/g) || []).length;
function imgUrl(p) { if (!imgCache.has(p)) imgCache.set(p, OS.dataUrl(S.vault, p) || ''); return imgCache.get(p); }

function newBoardData() { return { tool: 'select', sel: [], grid: true, cam: { x: 120, y: 120, k: 1 }, undo: [], redo: [], nid: 1, els: [] }; }
function parseBoard(text, path) {
  const B = newBoardData(); B.path = path;
  try {
    const d = JSON.parse(text || '{}');
    if (Array.isArray(d.els)) B.els = d.els;
    if (d.cam && Number.isFinite(d.cam.k)) B.cam = d.cam;
    if (typeof d.grid === 'boolean') B.grid = d.grid;
    B.nid = Math.max(Number(d.nid) || 1, ...B.els.map((e) => (Number(e.id) || 0) + 1), 1);
  } catch (_) { B.unreadable = true; }
  return B;
}
const boardJSON = (B) => JSON.stringify({ opale: 'board', version: 1, grid: B.grid, cam: B.cam, nid: B.nid, els: B.els });

// Writes are grouped and sent shortly after the last change.
const pending = new Set();
let flushT = 0;
function queueWrite(p) { pending.add(p); clearTimeout(flushT); flushT = setTimeout(flush, 400); }
function flush() {
  clearTimeout(flushT);
  for (const p of pending) {
    const f = FILES.get(p); if (!f) continue;
    if (f.type === 'board' && f.board.unreadable) continue;
    const text = f.type === 'board' ? boardJSON(f.board) : f.text;
    if (!OS.write(S.vault, p, text)) toast(`Impossible d’enregistrer « ${stem(p)} ».`, true);
  }
  pending.clear();
  if (S.saving) { S.saving = false; renderStatus(); }
}

let stateT = 0;
function saveState() { clearTimeout(stateT); stateT = setTimeout(saveStateNow, 300); }
function saveStateNow() {
  clearTimeout(stateT);
  S.per[S.vault] = {
    tabs: S.tabs.map((t) => ({ hist: t.hist, i: t.i })), active: S.tabs.findIndex((t) => t.id === S.active),
    bookmarks: S.bookmarks, expanded: [...S.expanded], modes: S.modes, collab: S.collab, proj: S.proj,
  };
  const land = S.orient === 'land' ? { left: S.left.open, right: S.right.open } : S.landOpen;
  OS.setState(JSON.stringify({
    v: 1, vault: S.vault, theme: S.theme, accent: S.accent, fs: S.fs, readable: S.readable, spell: S.spell,
    left: { tab: S.left.tab, w: S.orient === 'land' ? S.left.w : 260, open: land.left },
    right: { tab: S.right.tab, w: S.orient === 'land' ? S.right.w : 280, open: land.right },
    sort: S.sort, tagSort: S.tagSort, graph: { tags: S.graph.tags, names: S.graph.names, size: S.graph.size }, per: S.per,
  }));
}
window.opaleFlush = () => { flush(); saveStateNow(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) window.opaleFlush(); });
window.addEventListener('pagehide', () => window.opaleFlush());

function loadVault() {
  FILES.clear(); FOLDERS.clear(); imgCache.clear(); POS.clear(); GK = '';
  let data = { files: [], folders: [] };
  try { data = JSON.parse(OS.load(S.vault)); } catch (_) {}
  for (const f of data.files) {
    if (f.t === 'note') FILES.set(f.p, { type: 'note', text: f.x || '' });
    else if (f.t === 'board') FILES.set(f.p, { type: 'board', board: parseBoard(f.x, f.p) });
    else FILES.set(f.p, { type: f.t === 'image' ? 'image' : 'other' });
  }
  for (const d of data.folders) FOLDERS.add(d);
  S.projects = [...FOLDERS].filter((d) => new RegExp(`^\\${SHARED}/[^/]+$`).test(d)).map((d) => d.split('/')[1]).sort((a, b) => a.localeCompare(b));
  const per = S.per[S.vault] || {};
  S.bookmarks = (per.bookmarks || []).filter((p) => FILES.has(p));
  S.expanded = new Set(per.expanded || []);
  S.modes = per.modes || {};
  S.collab = per.collab !== false;
  S.proj = per.proj || {};
  S.selF = ''; S.search = '';
  S.tabs = [];
  for (const t of per.tabs || []) {
    const hist = (t.hist || []).filter((e) => e === 'graph' || e === 'empty' || FILES.has(e));
    if (hist.length) S.tabs.push({ id: tid++, hist, i: clamp(t.i || 0, 0, hist.length - 1) });
  }
  const a = S.tabs[per.active] || S.tabs[0];
  S.active = a ? a.id : null;
}

// -------------------------------------------------------- first launch
const today = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const longDate = (d) => { const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1); };
async function seedDemo() {
  const yesterday = new Date(today.getTime() - 864e5);
  const notes = {
    'Bienvenue.md': ['# Bienvenue dans Opale', 'Opale est votre coffre de notes **local**, reliées par des liens.', '', '## Pour commencer', '- [x] Créer votre premier coffre', '- [ ] Lire [[Refonte site]]', '- [ ] Ouvrir le [[Moodboard marque]]', '> Astuce : touchez une ligne pour la modifier.', '', '## Ressources', 'Voir [[Typographie]] et [[Palette couleurs]]. #guide'],
    'Projets/Refonte site.md': ['# Refonte site', 'Objectif : livrer la nouvelle version avant fin novembre. #projet #web', '', '## Étapes', '- [x] Audit de l’existant', '- [ ] Maquettes tablette', '- [ ] Intégration', '', '## Références', 'S’appuyer sur [[Palette couleurs]] et [[Typographie]].', 'Inspiration dans [[Moodboard marque]].', '```', 'npm run build', '```'],
    [`Journal/${iso(yesterday)}.md`]: [`# ${longDate(yesterday)}`, '- Point avec l’équipe sur [[Brief client]]', '- Valider la [[Palette couleurs]] #journal'],
    'Ressources/Typographie.md': ['# Typographie', 'Titres en **Inter**, texte en Source Serif. #design', '', '## Échelle', '- H1 : 32 px', '- H2 : 24 px', '- Texte : 16 px', '', 'Lié à [[Refonte site]].'],
    'Ressources/Palette couleurs.md': ['# Palette couleurs', 'Ambre `#fbbf24` comme accent. #design', '', '## Tons', '- Fond : `#131218`', '- Texte : `#ecebf3`', '', 'Utilisée dans [[Refonte site]] et [[Charte graphique]].'],
    [`${SHARED}/Studio Zaalis/Brief client.md`]: ['# Brief client', 'Le client veut la même app sur tablette. #projet', '', '## Livrables', '- [ ] Maquette tablette Android', '- [ ] Recette sur [[Refonte site]]'],
  };
  for (const [p, lines] of Object.entries(notes)) OS.write(S.vault, p, lines.join('\n'));
  let atelier = '';
  try {
    const img = new Image(); img.src = ILLU_URL; await img.decode();
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 840;
    cv.getContext('2d').drawImage(img, 0, 0, 1280, 840);
    if (OS.writeBase64(S.vault, 'Ressources/Atelier.jpg', cv.toDataURL('image/jpeg', 0.9).split(',')[1])) atelier = 'Ressources/Atelier.jpg';
  } catch (_) {}
  const board = { opale: 'board', version: 1, grid: true, cam: { x: 60, y: 70, k: 0.8 }, nid: 20, els: [
    { id: 1, type: 'frame', x: -30, y: -30, w: 740, h: 470, text: 'Ambiance générale' },
    { id: 2, type: 'text', x: 0, y: 0, w: 380, h: 40, text: 'Marque Opale' },
    { id: 3, type: 'sticky', x: 0, y: 70, w: 180, h: 150, color: '#fde68a', text: 'Calme, précis, chaleureux' },
    { id: 4, type: 'sticky', x: 200, y: 70, w: 180, h: 150, color: '#bbf7d0', text: 'Accent ambre sur fond nuit' },
    { id: 5, type: 'img', x: 400, y: 60, w: 280, h: 180, text: 'Atelier.jpg', src: atelier },
    { id: 6, type: 'shape', x: 20, y: 270, w: 160, h: 100, color: '#a78bfa', shape: 'ellipse', text: 'Logo' },
    { id: 7, type: 'card', x: 240, y: 265, w: 220, h: 110, title: 'Typographie', text: 'Titres Inter · texte Source Serif' },
    { id: 8, type: 'conn', pts: [[180, 320], [238, 320]], color: '#9390a3' },
    { id: 9, type: 'comment', x: 480, y: 290, w: 200, h: 64, text: 'Garder l’ambre comme accent ?' },
  ] };
  OS.write(S.vault, 'Projets/Moodboard marque.board', JSON.stringify(board));
  S.per[S.vault] = { tabs: [{ hist: ['Bienvenue.md'], i: 0 }, { hist: ['Projets/Refonte site.md'], i: 0 }, { hist: ['Projets/Moodboard marque.board'], i: 0 }], active: 0,
    bookmarks: ['Bienvenue.md', 'Projets/Refonte site.md'], expanded: ['Projets', 'Ressources'], modes: {}, collab: true, proj: { 'Studio Zaalis': true } };
}

// ------------------------------------------------------------ navigation
const icon = (e) => e === 'graph' ? 'graph' : e === 'empty' ? 'file' : ({ board: 'template', image: 'image' }[FILES.get(e)?.type] || 'file');
const titleOf = (e) => e === 'graph' ? 'Graphe' : e === 'empty' ? 'Nouvel onglet' : stem(e);
const tab = () => S.tabs.find((t) => t.id === S.active) || null;
const cur = () => { const t = tab(); return t ? t.hist[t.i] : null; };
const curNote = () => { const c = cur(); return c && isNote(c) ? c : null; };
const curFile = () => { const c = cur(); return c && FILES.has(c) && (FILES.get(c).type === 'note' || FILES.get(c).type === 'board') ? c : null; };
function newTab(e = 'empty') { const t = { id: tid++, hist: [e], i: 0 }; S.tabs.push(t); S.active = t.id; opening.add(t.id); return t; }
function open(p, o = {}) {
  if (!S.tabs.length || o.newTab) newTab(p);
  else { const t = tab(); if (t.hist[t.i] !== p) { t.hist = t.hist.slice(0, t.i + 1); t.hist.push(p); t.i++; } }
  if (S.orient === 'port') { S.left.open = false; S.right.open = false; }
  refresh();
}
function go(d) { const t = tab(); if (!t) return; const n = t.i + d; if (n < 0 || n >= t.hist.length) return; t.i = n; refresh(); }
const canGo = (d) => { const t = tab(); return !!t && t.i + d >= 0 && t.i + d < t.hist.length; };
function closeTab(id) {
  const el = $(`.tab[data-id="${id}"]`);
  const done = () => {
    const i = S.tabs.findIndex((t) => t.id === id); if (i < 0) return;
    S.tabs.splice(i, 1);
    if (S.active === id) { const n = S.tabs[Math.min(i, S.tabs.length - 1)]; S.active = n ? n.id : null; }
    refresh();
  };
  if (!el || RM.matches) { done(); return; }
  if (el.classList.contains('is-closing')) return;
  el.classList.add('is-closing');
  const w = el.getBoundingClientRect().width;
  const a = el.animate([{ maxWidth: `${w}px`, minWidth: `${w}px`, opacity: 1 }, { maxWidth: '0px', minWidth: '0px', opacity: 0, paddingLeft: '0px', paddingRight: '0px' }], { duration: 190, easing: 'cubic-bezier(.4, 0, .2, 1)' });
  a.onfinish = done; a.oncancel = done;
}

// -------------------------------------------------------------- markdown
function inline(t) {
  let s = esc(t);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => { const ok = resolve(a.trim()); return `<a class="il${ok ? '' : ' un'}" data-act="link" data-n="${a.trim()}">${b || a}</a>${ok ? '' : '<span class="bdot" aria-hidden="true"></span>'}`; });
  return s.replace(/(^|\s)#([\p{L}\w-]+)/gu, '$1<a class="tg" data-act="tag" data-t="$2">#$2</a>');
}
function renderLines(ls) {
  let code = false;
  return ls.map((l, i) => {
    let h; let c = 'ln'; let m;
    if (/^```/.test(l)) { code = !code; h = esc(l); c += ' cf'; }
    else if (code) { h = esc(l) || '&nbsp;'; c += ' cd'; }
    else if ((m = l.match(/^(#{1,3}) (.*)/))) h = `<span class="h${m[1].length}">${inline(m[2])}</span>`;
    else if ((m = l.match(/^- \[( |x)\] ?(.*)/))) h = `<span class="task${m[1] === 'x' ? ' done' : ''}"><input type="checkbox" data-act="check" data-i="${i}" ${m[1] === 'x' ? 'checked' : ''}><span>${inline(m[2]) || '&nbsp;'}</span></span>`;
    else if ((m = l.match(/^- (.*)/))) h = `<span class="bul">${inline(m[1]) || '&nbsp;'}</span>`;
    else if ((m = l.match(/^> ?(.*)/))) h = `<span class="bq">${inline(m[1]) || '&nbsp;'}</span>`;
    else h = l.trim() ? inline(l) : '&nbsp;';
    return `<div class="${c}" data-i="${i}">${h}</div>`;
  }).join('');
}

// ----------------------------------------------------------------- frame
function measure() {
  const port = innerWidth < 1000;
  const next = port ? 'port' : 'land';
  if (next === S.orient) return false;
  if (next === 'port') { S.landOpen = { left: S.left.open, right: S.right.open }; S.left.open = false; S.right.open = false; }
  else { S.left.open = S.landOpen.left; S.right.open = S.landOpen.right; }
  S.orient = next;
  return true;
}
function frame() {
  scr.className = 'scr' + (S.orient === 'port' ? ' port' : '') + (S.theme === 'light' ? ' light' : '') + (S.readable ? ' readable' : '');
  scr.style.setProperty('--acc', S.accent);
  scr.style.setProperty('--fs', S.fs + 'px');
  document.body.style.background = S.theme === 'light' ? '#e9e8ef' : '#131218';
  const drawer = Math.min(320, innerWidth - 90);
  for (const k of ['left', 'right']) {
    const el = $(k === 'left' ? '.side.l' : '.side.r');
    el.style.setProperty('--w', (S.orient === 'port' ? drawer : S[k].w) + 'px');
    el.classList.toggle('closed', !S[k].open);
    $(k === 'left' ? '.rz.l' : '.rz.r').classList.toggle('closed', !S[k].open);
  }
  $('.scrim').classList.toggle('on', S.orient === 'port' && (S.left.open || S.right.open));
  $('[data-act="tleft"]').classList.toggle('on', S.left.open);
  $('[data-act="tright"]').classList.toggle('on', S.right.open);
  saveState();
}
function build() {
  scr.innerHTML = `<div class="app"><div class="ws"><nav class="ribbon" aria-label="Actions rapides">${ib('sidebar-left', 'Afficher ou masquer le panneau gauche', 'tleft')}${ib('search', 'Ouvrir une note (Ctrl+O)', 'switcher')}${ib('graph', 'Graphe (Ctrl+G)', 'graph')}${ib('calendar', 'Note du jour', 'daily')}${ib('template', 'Insérer un modèle', 'template')}${ib('dice', 'Note au hasard', 'random')}${ib('command', 'Palette de commandes (Ctrl+P)', 'palette')}</nav>
<aside class="side l"></aside><div class="rz l" data-side="left"></div><main class="main"><div class="tabbar"><div class="tabs" role="tablist"></div>${ib('plus', 'Nouvel onglet (Ctrl+T)', 'newtab')}<div class="tsp"></div>${ib('sidebar-right', 'Afficher ou masquer le panneau droit', 'tright')}</div><div class="views"></div></main><div class="rz r" data-side="right"></div><aside class="side r"></aside><div class="scrim" data-act="scrim"></div></div><footer class="stb"></footer></div>
<div class="ovl"></div><div class="toasts" aria-live="polite"></div>`;
}
function refresh() { frame(); renderLeft(); renderRight(); renderTabs(); renderView(); renderStatus(); }

// ----------------------------------------------------------- left panel
const LT = [['files', 'files', 'Fichiers'], ['search', 'search', 'Rechercher (Ctrl+Maj+F)'], ['bookmarks', 'bookmark', 'Signets'], ['tags', 'tag', 'Étiquettes']];
const RT = [['backlinks', 'link-in', 'Rétroliens'], ['outgoing', 'link-out', 'Liens sortants'], ['outline', 'outline', 'Plan de la note'], ['graph', 'graph', 'Graphe local']];
const stabs = (side, list) => `<div class="stabs" role="tablist">${list.map(([k, i, t]) => ib(i, t, 'stab', `data-side="${side}" data-k="${k}" role="tab" aria-selected="${S[side].tab === k}"`, S[side].tab === k ? 'on' : '')).join('')}</div>`;
function renderLeft() {
  const el = $('.side.l');
  el.innerHTML = stabs('left', LT) + `<div class="sbody">${leftPane()}</div><div class="vfoot"><button type="button" class="vsw" data-act="vault" title="Changer de coffre">${ic('vault', 16)}<span>${esc(S.vault)}</span></button>${ib('settings', 'Paramètres (Ctrl+,)', 'settings')}</div>`;
  if (S.left.tab === 'search') renderResults();
  saveState();
}
function leftPane() {
  const t = S.left.tab;
  if (t === 'files') return `<div class="ptool">${ib('file-plus', 'Nouvelle note (Ctrl+N)', 'newnote')}${ib('template', 'Nouveau moodboard', 'newboard')}${ib('image', 'Ajouter une image au dossier sélectionné', 'addimg')}${ib('folder-plus', 'Nouveau dossier', 'newfolder')}${ib('sort', 'Ordre de tri', 'sort')}${ib('collapse', 'Tout replier', 'collapseall')}${ib('locate', 'Afficher la note active', 'locate')}</div><div class="pscroll" role="tree">${treeHtml() || '<div class="pempty">Ce coffre est vide. Créez une note avec le bouton ci-dessus.</div>'}</div>${collabHtml()}`;
  if (t === 'search') return `<div class="ptool" style="padding:8px 10px 4px"><input class="tin" type="search" data-in="search" placeholder="Rechercher…" value="${esc(S.search)}" style="height:40px" enterkeyhint="search"></div><div class="pinfo" id="sinfo"></div><div class="pscroll" id="sres"></div>`;
  if (t === 'bookmarks') return `<div class="ptool">${ib('plus', 'Ajouter la note active aux signets', 'bmadd')}</div><div class="pscroll">${S.bookmarks.length ? S.bookmarks.map((p) => `<div class="row${cur() === p ? ' act' : ''}" data-act="open" data-p="${esc(p)}" style="padding-left:10px"><span class="chev">${ic('bookmark', 14)}</span><span class="rname">${esc(stem(p))}</span><button type="button" class="tx" data-act="bmdel" data-p="${esc(p)}" aria-label="Retirer des signets">${ic('x', 13)}</button></div>`).join('') : '<div class="pempty">Aucun signet. Ajoutez la note active avec le bouton +.</div>'}</div>`;
  const cnt = {};
  for (const [, f] of FILES) if (f.type === 'note') for (const g of tagsOf(f.text)) cnt[g] = (cnt[g] || 0) + 1;
  const tags = Object.entries(cnt).sort((a, b) => S.tagSort === 'count' ? b[1] - a[1] || a[0].localeCompare(b[0]) : a[0].localeCompare(b[0]));
  return `<div class="ptool">${ib('sort', S.tagSort === 'count' ? 'Trier par nom' : 'Trier par nombre', 'tagsort')}</div><div class="pscroll">${tags.map(([g, n]) => `<div class="trow" data-act="tag" data-t="${esc(g)}"><span class="tn">#${esc(g)}</span><span class="cnt">${n}</span></div>`).join('') || '<div class="pempty">Aucune étiquette.</div>'}</div>`;
}
function treeHtml() {
  const rootN = { f: new Map(), files: [] };
  const add = (dir) => { let n = rootN; let acc = ''; if (!dir) return n; for (const part of dir.split('/')) { acc = acc ? acc + '/' + part : part; if (!n.f.has(part)) n.f.set(part, { path: acc, f: new Map(), files: [] }); n = n.f.get(part); } return n; };
  for (const d of FOLDERS) if (!hidden(d)) add(d);
  for (const p of FILES.keys()) if (!hidden(p)) add(dirOf(p)).files.push(p);
  const active = cur();
  const walk = (n, d) => {
    let h = '';
    for (const [name, c] of [...n.f].sort((a, b) => a[0].localeCompare(b[0]))) {
      const o = S.expanded.has(c.path);
      h += `<div class="row fold${S.selF === c.path ? ' selF' : ''}" data-act="folder" data-p="${esc(c.path)}" style="padding-left:${6 + d * 16}px" role="treeitem" aria-expanded="${o}"><span class="chev">${ic(o ? 'chevron-down' : 'chevron-right', 14)}</span><span class="rname">${esc(name)}</span></div>`;
      if (o) h += walk(c, d + 1);
    }
    const fs = n.files.slice().sort((a, b) => stem(a).localeCompare(stem(b)));
    if (S.sort === 'za') fs.reverse();
    for (const p of fs) { const e = extOf(p); h += `<div class="row${active === p ? ' act' : ''}" data-act="open" data-p="${esc(p)}" style="padding-left:${24 + d * 16}px" role="treeitem"><span class="rname">${esc(stem(p))}</span>${e !== 'md' ? `<span class="ext">${esc(e)}</span>` : ''}</div>`; }
    return h;
  };
  return walk(rootN, 0);
}
function collabHtml() {
  const items = S.projects.map((pr) => {
    const o = S.proj[pr] !== false;
    const fs = [...FILES.keys()].filter((p) => p.startsWith(`${SHARED}/${pr}/`)).sort((a, b) => stem(a).localeCompare(stem(b)));
    return `<div class="row fold" data-act="proj" data-n="${esc(pr)}" style="padding-left:6px"><span class="chev">${ic(o ? 'chevron-down' : 'chevron-right', 14)}</span><span class="rname">${esc(pr)}</span>${ib('file-plus', 'Nouvelle note dans ce projet', 'pnew', `data-n="${esc(pr)}"`)}</div>` +
      (o ? (fs.map((p) => `<div class="row${cur() === p ? ' act' : ''}" data-act="open" data-p="${esc(p)}" style="padding-left:24px"><span class="rname">${esc(stem(p))}</span>${extOf(p) !== 'md' ? `<span class="ext">${esc(extOf(p))}</span>` : ''}</div>`).join('') || '<div class="pempty" style="padding-left:24px">Aucun fichier pour l’instant.</div>') : '');
  }).join('');
  return `<section class="csec"><div class="chead"><button type="button" class="ctog" data-act="collab" aria-expanded="${S.collab}"><span class="chev">${ic(S.collab ? 'chevron-down' : 'chevron-right', 14)}</span><span>Projets partagés</span><span class="cnt">${S.projects.length}</span></button>${ib('plus', 'Créer un projet partagé', 'cadd')}</div>${S.collab ? items : ''}</section>`;
}
function renderResults() {
  const box = $('#sres'); const info = $('#sinfo'); if (!box) return;
  const q = S.search.trim();
  if (!q) { info.textContent = ''; box.innerHTML = `<div class="htitle">Options de recherche</div>${[['path:', 'Chercher dans le chemin'], ['file:', 'Chercher dans le nom'], ['tag:', 'Chercher une étiquette'], ['line:', 'Chercher par ligne']].map(([o, d]) => `<div class="hrow" data-act="sop" data-o="${o}"><code>${o}</code><span>${d}</span></div>`).join('')}`; return; }
  const m = q.match(/^(path|file|tag|line):(.*)$/); const op = m ? m[1] : 'line'; const term = (m ? m[2] : q).trim().toLowerCase().replace(/^#/, ''); const res = [];
  for (const [p, f] of FILES) {
    if (f.type !== 'note' && op !== 'file' && op !== 'path') continue;
    const t = f.type === 'note' ? f.text : ''; let ok = false; let lines = [];
    if (op === 'path') ok = p.toLowerCase().includes(term);
    else if (op === 'file') ok = stem(p).toLowerCase().includes(term);
    else if (op === 'tag') { ok = tagsOf(t).some((g) => g.toLowerCase() === term); lines = t.split('\n').filter((l) => l.toLowerCase().includes('#' + term)); }
    else { lines = t.split('\n').filter((l) => l.toLowerCase().includes(term)); ok = lines.length > 0 || stem(p).toLowerCase().includes(term); }
    if (ok && term) res.push([p, lines]);
  }
  const hl = (s) => { const e = esc(s); const tt = esc(term); const i = e.toLowerCase().indexOf(tt); return !tt || i < 0 ? e : e.slice(0, i) + '<mark>' + e.slice(i, i + tt.length) + '</mark>' + e.slice(i + tt.length); };
  info.textContent = res.length ? `${res.length} fichier${res.length > 1 ? 's' : ''}` : 'Aucun résultat.';
  box.innerHTML = res.map(([p, ls]) => `<div class="rfile" data-act="open" data-p="${esc(p)}">${ic(icon(p), 15)}<span>${esc(stem(p))}</span>${ls.length ? `<span class="cnt">${ls.length}</span>` : ''}</div>${ls.slice(0, 4).map((l) => `<div class="rline" data-act="open" data-p="${esc(p)}">${hl(l)}</div>`).join('')}`).join('');
}

// ---------------------------------------------------------- right panel
function renderRight() {
  const el = $('.side.r'); const p = curFile(); const t = S.right.tab; let body = '';
  if (t === 'graph') body = '<div class="lgraph"><canvas id="lcv"></canvas></div>';
  else if (!p || (t !== 'backlinks' && !isNote(p))) body = '<div class="pempty">Aucune note active.</div>';
  else if (t === 'backlinks') { const b = backlinks(p); body = `<div class="pinfo">${b.length} rétrolien${b.length > 1 ? 's' : ''}</div><div class="pscroll">${b.map(([q, ls]) => `<div class="rfile" data-act="open" data-p="${esc(q)}">${ic('file', 15)}<span>${esc(stem(q))}</span><span class="cnt">${ls.length}</span></div>${ls.map((l) => `<div class="rline" data-act="open" data-p="${esc(q)}">${inline(l)}</div>`).join('')}`).join('') || '<div class="pempty">Aucune note ne pointe vers celle-ci.</div>'}</div>`; }
  else if (t === 'outgoing') { const ls = [...new Set(linksOf(FILES.get(p).text))]; body = `<div class="pinfo">${ls.length} lien${ls.length > 1 ? 's' : ''} sortant${ls.length > 1 ? 's' : ''}</div><div class="pscroll">${ls.map((n) => { const r = resolve(n); return `<div class="rfile${r ? '' : ' un'}" data-act="link" data-n="${esc(n)}">${ic(r ? icon(r) : 'file', 15)}<span>${esc(n)}</span>${r ? '' : '<span class="cnt">à créer</span>'}</div>`; }).join('') || '<div class="pempty">Aucun lien.</div>'}</div>`; }
  else { const hs = FILES.get(p).text.split('\n').map((l, i) => [l.match(/^(#{1,3}) (.*)/), i]).filter((x) => x[0]); body = `<div class="pscroll" style="padding-top:8px">${hs.map(([m, i]) => `<div class="orow l${m[1].length}" data-act="heading" data-i="${i}" style="padding-left:${8 + (m[1].length - 1) * 16}px">${esc(m[2])}</div>`).join('') || '<div class="pempty">Aucun titre dans cette note.</div>'}</div>`; }
  el.innerHTML = stabs('right', RT) + `<div class="sbody">${body}</div>`;
  if (t === 'graph') requestAnimationFrame(() => { const cv = $('#lcv'); if (cv) { drawGraph(cv, curFile(), true); graphPointer(cv, true); } });
  saveState();
}

// ------------------------------------------------------------------- tabs
function renderTabs() {
  const bar = $('.tabs');
  bar.innerHTML = S.tabs.map((t) => { const e = t.hist[t.i]; return `<div class="tab${t.id === S.active ? ' on' : ''}${opening.has(t.id) && !RM.matches ? ' is-opening' : ''}" data-act="tab" data-id="${t.id}" role="tab" aria-selected="${t.id === S.active}" title="${esc(titleOf(e))}"><span class="tico">${ic(icon(e), 15)}</span><span class="ttl">${esc(titleOf(e))}</span><button type="button" class="tx" data-act="tclose" data-id="${t.id}" aria-label="Fermer l’onglet">${ic('x', 13)}</button></div>`; }).join('');
  opening.clear();
  const a = $('.tab.on');
  if (a) { const l = a.offsetLeft; const r = l + a.offsetWidth; if (l < bar.scrollLeft) bar.scrollLeft = l - 10; else if (r > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = r - bar.clientWidth + 10; }
}
// A long press lifts a tab; it then follows the finger and the others slide aside, as on the desktop.
function setupTabDrag() {
  const bar = $('.tabs'); let lp = null; let drag = null;
  bar.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.tab'); if (!t || e.target.closest('.tx') || S.tabs.length < 2) return;
    const start = () => {
      const els = [...bar.querySelectorAll('.tab')]; const from = els.indexOf(t); if (from < 0) return;
      drag = { id: +t.dataset.id, el: t, els, rects: els.map((x) => x.getBoundingClientRect()), from, to: from, x0: e.clientX };
      t.classList.add('is-dragging'); bar.classList.add('is-sorting');
      try { bar.setPointerCapture(e.pointerId); } catch (_) {}
      if (navigator.vibrate) navigator.vibrate(8);
    };
    lp = { x0: e.clientX, y0: e.clientY, start, mouse: e.pointerType === 'mouse' };
    if (!lp.mouse) lp.timer = setTimeout(() => { if (lp) { lp.start(); lp = null; } }, 300);
  });
  bar.addEventListener('pointermove', (e) => {
    if (lp) { const dx = e.clientX - lp.x0; const dy = e.clientY - lp.y0; if (lp.mouse && Math.abs(dx) > 6) { lp.start(); lp = null; } else if (!lp.mouse && Math.hypot(dx, dy) > 8) { clearTimeout(lp.timer); lp = null; } }
    if (!drag) return;
    const dx = e.clientX - drag.x0; drag.el.style.transform = `translateX(${dx}px)`;
    const r = drag.rects[drag.from]; const mid = r.left + r.width / 2 + dx; let to = drag.from;
    drag.rects.forEach((q, i) => { if (i < drag.from && mid < q.left + q.width / 2) to = Math.min(to, i); if (i > drag.from && mid > q.left + q.width / 2) to = Math.max(to, i); });
    drag.to = to; const w = r.width + 2;
    drag.els.forEach((el, i) => { if (el === drag.el) return; let s = 0; if (drag.from < to && i > drag.from && i <= to) s = -w; if (drag.from > to && i >= to && i < drag.from) s = w; el.style.transform = s ? `translateX(${s}px)` : ''; });
  });
  const end = () => {
    if (lp) { clearTimeout(lp.timer); lp = null; }
    if (!drag) return;
    const d = drag; drag = null;
    const before = d.el.getBoundingClientRect();
    const [m] = S.tabs.splice(d.from, 1); S.tabs.splice(d.to, 0, m);
    bar.classList.remove('is-sorting'); renderTabs(); saveState();
    const nel = bar.querySelector(`.tab[data-id="${d.id}"]`);
    if (nel && !RM.matches) { const after = nel.getBoundingClientRect(); nel.animate([{ transform: `translateX(${before.left - after.left}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2, .8, .2, 1)' }); }
    suppressClick = Date.now();
  };
  bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
  bar.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
}
let suppressClick = 0;

// ------------------------------------------------------------------ views
const header = (crumbs, acts) => `<div class="vh"><div class="vnav">${ib('back', 'Précédent', 'back', canGo(-1) ? '' : 'disabled')}${ib('forward', 'Suivant', 'fwd', canGo(1) ? '' : 'disabled')}</div><div class="crumbs">${crumbs}</div><div class="vact">${acts}</div></div>`;
function crumbsOf(p) {
  if (shared(p)) return `<span class="crumb">${esc(projectOf(p))}</span><span class="csep">/</span><span class="crumb cur">${esc(stem(p))}</span>`;
  const parts = dirOf(p) ? dirOf(p).split('/') : [];
  return parts.map((x, i) => `<button type="button" class="crumb" data-act="reveal" data-p="${esc(parts.slice(0, i + 1).join('/'))}">${esc(x)}</button><span class="csep">/</span>`).join('') + `<span class="crumb cur">${esc(stem(p))}</span>`;
}
function renderView() {
  const v = $('.views'); const e = cur();
  if (!e || e === 'empty') {
    v.innerHTML = `<div class="view">${e ? header('<span class="crumb cur">Nouvel onglet</span>', '') : ''}<div class="empty"><p style="margin:0 0 10px">${e ? 'Aucun fichier ouvert' : 'Aucun onglet ouvert'}</p><button type="button" class="ea" data-act="newnote">Créer une note <span class="kbd">Ctrl+N</span></button><button type="button" class="ea" data-act="switcher">Aller au fichier <span class="kbd">Ctrl+O</span></button>${e ? '<button type="button" class="ea" data-act="closecur">Fermer l’onglet <span class="kbd">Ctrl+W</span></button>' : ''}</div></div>`;
    return;
  }
  if (e === 'graph') {
    const d = gData();
    v.innerHTML = `<div class="view">${header(`<span class="crumb cur">Graphe</span><span class="gcount">${d.nodes.length} nœuds · ${d.edges.length} liens</span>`, ib('locate', 'Recentrer le graphe', 'grecenter'))}<div class="gstage"><canvas id="gcv"></canvas><div class="gwrap">${ib('settings', 'Réglages du graphe', 'gctl')}${S.graph.ctl ? `<div class="gctl"><div class="gt">Filtres</div><div class="gline"><span>Étiquettes</span><button type="button" class="sw${S.graph.tags ? ' on' : ''}" data-act="gtags" aria-label="Étiquettes" aria-pressed="${S.graph.tags}"></button></div><div class="gline"><span>Noms des nœuds</span><button type="button" class="sw${S.graph.names ? ' on' : ''}" data-act="gnames" aria-label="Noms des nœuds" aria-pressed="${S.graph.names}"></button></div><div class="gt">Affichage</div><label style="display:flex;flex-direction:column;gap:4px;color:var(--t2)">Taille des nœuds<input type="range" min="0.5" max="2" step="0.1" value="${S.graph.size}" data-in="gsize"></label></div>` : ''}</div></div></div>`;
    requestAnimationFrame(() => { const cv = $('#gcv'); if (cv) { drawGraph(cv, null, false); graphPointer(cv, false); } });
    return;
  }
  const f = FILES.get(e);
  if (!f) { v.innerHTML = '<div class="view"><div class="empty">Fichier introuvable.</div></div>'; return; }
  if (f.type === 'image') { const url = imgUrl(e); v.innerHTML = `<div class="view">${header(crumbsOf(e), ib('more', 'Plus d’options', 'fmore'))}<div class="fstage">${url ? `<img class="fimg" src="${url}" alt="${esc(stem(e))}">` : '<div class="empty">Image illisible.</div>'}</div></div>`; return; }
  if (f.type === 'other') { v.innerHTML = `<div class="view">${header(crumbsOf(e), ib('more', 'Plus d’options', 'fmore'))}<div class="empty"><p>Opale n’affiche pas les fichiers « .${esc(extOf(e) || '?')} ».</p><p style="color:var(--t3);font-size:13px">Il se trouve dans le dossier du coffre : ${esc(OS.vaultPath(S.vault))}/${esc(e)}</p></div></div>`; return; }
  if (f.type === 'board') { renderBoard(e); return; }
  const mode = S.modes[e] || 'live';
  v.innerHTML = `<div class="view">${header(crumbsOf(e), ib(mode === 'reading' ? 'pencil' : 'book', mode === 'reading' ? 'Modifier (Ctrl+E)' : 'Lecture (Ctrl+E)', 'mode') + ib('more', 'Plus d’options', 'nmore'))}<div class="nscroll"><div class="nsizer"><div class="ititle" data-title ${mode === 'live' ? 'contenteditable="true"' : ''} spellcheck="false" enterkeyhint="next">${esc(stem(e))}</div><div class="nbody ${mode}">${renderLines(f.text.split('\n'))}</div></div></div></div>`;
}
function refreshBody() { const p = curNote(); const b = $('.nbody'); if (p && b) b.innerHTML = renderLines(FILES.get(p).text.split('\n')); }

let sideT = 0;
function setText(p, t) {
  FILES.get(p).text = t; S.saving = true; renderStatus(); queueWrite(p);
  clearTimeout(sideT); sideT = setTimeout(() => { renderRight(); if (S.left.tab === 'tags') renderLeft(); }, 350);
}
// Live preview: the touched line shows its Markdown in a field; every other line stays rendered.
function editLine(i, caret) {
  const p = curNote(); if (!p || (S.modes[p] || 'live') !== 'live') return;
  const ln = $(`.nbody .ln[data-i="${i}"]`); if (!ln) return;
  const inp = document.createElement('input');
  inp.className = 'lnin'; inp.value = FILES.get(p).text.split('\n')[i] ?? ''; inp.spellcheck = S.spell; inp.setAttribute('enterkeyhint', 'enter');
  ln.replaceChildren(inp); ln.classList.add('editing'); inp.focus();
  const c = caret == null ? inp.value.length : caret; inp.setSelectionRange(c, c);
  const lines = () => FILES.get(p).text.split('\n');
  const commit = () => {
    if (inp._d) return; inp._d = true;
    const ls = lines(); ls[i] = inp.value; setText(p, ls.join('\n'));
    if (curNote() !== p || !ln.isConnected) return;
    const tmp = document.createElement('div'); tmp.innerHTML = renderLines(ls);
    const nl = tmp.querySelector(`[data-i="${i}"]`); const body = $('.nbody');
    if (nl && body && tmp.querySelectorAll('.cf').length === body.querySelectorAll('.cf').length) { ln.className = nl.className; ln.innerHTML = nl.innerHTML; } else refreshBody();
  };
  const merge = () => { const ls = lines(); inp._d = true; const pl = ls[i - 1].length; ls[i - 1] += inp.value; ls.splice(i, 1); setText(p, ls.join('\n')); refreshBody(); editLine(i - 1, pl); };
  const split = () => {
    inp._d = true; const ls = lines(); const v = inp.value; const pos = inp.selectionStart;
    let a = v.slice(0, pos); const b = v.slice(pos); const m = a.match(/^(- \[[ x]\] |- )/); let pre = '';
    if (m && !b) { if (a === m[1]) a = ''; else pre = m[1].startsWith('- [') ? '- [ ] ' : '- '; }
    ls.splice(i, 1, a, pre + b); setText(p, ls.join('\n')); refreshBody(); editLine(i + 1, pre.length);
  };
  inp.addEventListener('blur', commit);
  inp.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'deleteContentBackward' && inp.selectionStart === 0 && inp.selectionEnd === 0 && i > 0) { e.preventDefault(); merge(); }
    else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') { e.preventDefault(); split(); }
  });
  inp.addEventListener('keydown', (e) => {
    const ls = lines();
    if (e.key === 'Enter') { e.preventDefault(); split(); }
    else if (e.key === 'Backspace' && inp.selectionStart === 0 && inp.selectionEnd === 0 && i > 0) { e.preventDefault(); merge(); }
    else if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); commit(); editLine(i - 1); }
    else if (e.key === 'ArrowDown' && i < ls.length - 1) { e.preventDefault(); commit(); editLine(i + 1); }
    else if (e.key === 'Escape') inp.blur();
  });
}

// ------------------------------------------------------------ status bar
function renderStatus() {
  const p = curNote(); const sb = $('.stb'); if (!sb) return;
  let h = '<div style="flex:1"></div>';
  h += `<button type="button" class="sti muted" data-act="syncinfo" title="Synchronisation">${ic('cloud-off', 15)}Local</button>`;
  if (p) {
    const t = FILES.get(p).text; const b = backlinks(p).reduce((a, x) => a + x[1].length, 0); const w = words(t); const mode = S.modes[p] || 'live';
    h += `<span class="sti">${S.saving ? 'Enregistrement…' : 'Enregistré'}</span><button type="button" class="sti" data-act="showbl">${b} rétrolien${b > 1 ? 's' : ''}</button><span class="sti">${w} mot${w > 1 ? 's' : ''} · ${t.length} caractère${t.length > 1 ? 's' : ''}</span><button type="button" class="sti" data-act="mode">${mode === 'reading' ? 'Lecture' : 'Aperçu en direct'}</button>`;
  }
  sb.innerHTML = h;
}

// ------------------------------------------------- toasts, menus, windows
function toast(m, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.setAttribute('role', 'status'); t.textContent = m;
  $('.toasts').append(t); requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 200); }, err ? 4200 : 2800);
}
let MF = [];
function closeMenu() { const m = $('.ovl .menu'); if (m) m.remove(); }
function menu(e, items) {
  closeMenu(); MF = [];
  const r = scr.getBoundingClientRect(); const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it) => { if (it === '-') return '<div class="msep"></div>'; MF.push(it[2]); return `<button type="button" class="mi${it[3] ? ' dng' : ''}" data-act="mi" data-k="${MF.length - 1}" role="menuitem"><span style="width:18px;display:flex;justify-content:center">${it[1] ? ic(it[1], 16) : ''}</span>${esc(it[0])}</button>`; }).join('');
  $('.ovl').append(m);
  let x = e.clientX - r.left; let y = e.clientY - r.top + 6;
  x = clamp(x, 8, scr.offsetWidth - m.offsetWidth - 8); y = clamp(y, 8, scr.offsetHeight - m.offsetHeight - 8);
  m.style.left = x + 'px'; m.style.top = y + 'px';
}
function modal(title, body, cls = '', mount) {
  closeMenu(); const o = $('.ovl');
  o.querySelectorAll('.mbd').forEach((x) => x.remove());
  const d = document.createElement('div'); d.className = 'mbd';
  d.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title || 'Fenêtre')}">${title ? `<div class="mh"><h3>${esc(title)}</h3>${ib('x', 'Fermer', 'mclose')}</div>` : ''}${body}</div>`;
  o.append(d); requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('is-visible')));
  if (mount) mount(d);
  return d;
}
function closeModal() { $('.ovl').querySelectorAll('.mbd:not(.closing)').forEach((x) => { x.classList.add('closing'); x.classList.remove('is-visible'); setTimeout(() => x.remove(), 230); }); }
const openModalEl = () => $('.ovl .mbd:not(.closing)');
let PO = null; let CO = null;
const nameErr = (v) => !v ? 'Saisissez un nom.' : BAD.test(v) ? 'Ce nom contient un caractère interdit.' : v.startsWith('.') ? 'Le nom ne peut pas commencer par un point.' : '';
function prompt2(title, label, val, ok, check) {
  modal(title, `<div class="mb"><label style="display:block;color:var(--t2);font-size:13px;margin-bottom:6px">${esc(label)}</label><input class="tin" data-in="prompt" value="${esc(val)}" enterkeyhint="done"><p class="ferr" hidden></p></div><div class="mf"><button type="button" class="btn" data-act="mclose">Annuler</button><button type="button" class="btn pri" data-act="pok">Valider</button></div>`, '', (d) => {
    const i = d.querySelector('input'); setTimeout(() => { i.focus(); i.select(); }, 60);
    PO = () => { const v = i.value.trim(); const err = nameErr(v) || (check ? check(v) : ''); const pe = d.querySelector('.ferr'); if (err) { pe.textContent = err; pe.hidden = false; return; } PO = null; closeModal(); ok(v); };
  });
}
function confirm2(title, msg, label, fn) { CO = fn; modal(title, `<div class="mb"><p style="margin:0;color:var(--t1);line-height:1.55">${esc(msg)}</p></div><div class="mf"><button type="button" class="btn" data-act="mclose">Annuler</button><button type="button" class="btn dng" data-act="cok">${esc(label)}</button></div>`); }

// ---------------------------------------------------------- file actions
function targetFolder() { if (S.selF) return S.selF; const c = curFile(); return c && !shared(c) ? dirOf(c) : ''; }
function uniq(dir, base, ext) { let n = 0; let p; do { p = (dir ? dir + '/' : '') + base + (n ? ' ' + n : '') + '.' + ext; n++; } while (FILES.has(p)); return p; }
function expandTo(p) { let a = ''; for (const x of dirOf(p).split('/')) { if (!x) continue; a = a ? a + '/' + x : x; S.expanded.add(a); } }
function createNote(p, text = '') {
  if (!OS.write(S.vault, p, text)) { toast('Impossible de créer la note.', true); return false; }
  FILES.set(p, { type: 'note', text }); GK = ''; return true;
}
function newNote(dir) {
  const p = uniq(dir == null ? targetFolder() : dir, 'Sans titre', 'md');
  if (!createNote(p)) return;
  S.modes[p] = 'live'; if (dirOf(p) && !shared(p)) expandTo(p); open(p);
  setTimeout(() => { const t = $('[data-title]'); if (t) { t.focus(); const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }, 40);
}
function newBoard() {
  const p = uniq(targetFolder(), 'Moodboard', 'board'); const B = newBoardData(); B.path = p;
  if (!OS.write(S.vault, p, boardJSON(B))) { toast('Impossible de créer le moodboard.', true); return; }
  FILES.set(p, { type: 'board', board: B }); GK = ''; if (dirOf(p)) expandTo(p); open(p); toast('Moodboard créé');
}
function rename(p, name) {
  const np = (dirOf(p) ? dirOf(p) + '/' : '') + name + '.' + extOf(p);
  if (np === p) return;
  if (FILES.has(np)) { toast('Ce nom est déjà pris.', true); refresh(); return; }
  flush();
  if (!OS.move(S.vault, p, np)) { toast('Impossible de renommer le fichier.', true); refresh(); return; }
  const old = stem(p); const m = new Map();
  for (const [k, v] of FILES) m.set(k === p ? np : k, v);
  FILES.clear(); for (const [k, v] of m) FILES.set(k, v);
  const f = FILES.get(np); if (f.type === 'board') f.board.path = np;
  if (imgCache.has(p)) { imgCache.set(np, imgCache.get(p)); imgCache.delete(p); }
  if (f.type === 'note' || f.type === 'board') {
    const re = new RegExp('\\[\\[' + old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\]\\]|\\|)', 'gi');
    for (const [k, g] of FILES) if (g.type === 'note' && re.test(g.text)) { re.lastIndex = 0; g.text = g.text.replace(re, (mm, end) => '[[' + name + end); queueWrite(k); }
  }
  for (const [, g] of FILES) if (g.type === 'board') { let ch = false; for (const el of g.board.els) if (el.src === p) { el.src = np; ch = true; } if (ch) queueWrite(g.board.path); }
  for (const t of S.tabs) t.hist = t.hist.map((x) => x === p ? np : x);
  S.bookmarks = S.bookmarks.map((x) => x === p ? np : x);
  if (S.modes[p]) { S.modes[np] = S.modes[p]; delete S.modes[p]; }
  if (POS.has(p)) { POS.set(np, POS.get(p)); POS.delete(p); }
  GK = ''; refresh();
}
function del(p) {
  confirm2('Supprimer le fichier', `« ${stem(p)} » sera déplacé dans la corbeille du coffre (.trash).`, 'Supprimer', () => {
    pending.delete(p);
    if (!OS.remove(S.vault, p)) { toast('Impossible de supprimer le fichier.', true); return; }
    FILES.delete(p); imgCache.delete(p);
    for (const t of S.tabs) { const h = t.hist.filter((x) => x !== p); t.hist = h.length ? h : ['empty']; t.i = Math.min(t.i, t.hist.length - 1); }
    S.bookmarks = S.bookmarks.filter((x) => x !== p); GK = ''; refresh(); toast('Déplacé dans la corbeille');
  });
}
function fileMenu(p, e) {
  const bm = S.bookmarks.includes(p); const note = isNote(p) || FILES.get(p)?.type === 'board';
  menu(e, [['Ouvrir dans un nouvel onglet', 'plus', () => open(p, { newTab: true })], ...(note ? [[bm ? 'Retirer des signets' : 'Ajouter aux signets', 'bookmark', () => toggleBm(p)]] : []), '-',
    ['Renommer…', 'pencil', () => prompt2('Renommer', 'Nouveau nom', stem(p), (v) => rename(p, v))], ['Supprimer', 'trash', () => del(p), true]]);
}
function toggleBm(p) { if (S.bookmarks.includes(p)) { S.bookmarks = S.bookmarks.filter((x) => x !== p); toast('Retiré des signets'); } else { S.bookmarks.push(p); toast('Ajouté aux signets'); } renderLeft(); }
function daily() {
  const p = `Journal/${iso(new Date())}.md`;
  if (!FILES.has(p) && !createNote(p, `# ${longDate(new Date())}\n- `)) return;
  S.expanded.add('Journal'); open(p);
}
function randomNote() { const ns = [...FILES.keys()].filter(isNote); if (!ns.length) { toast('Aucune note dans ce coffre.', true); return; } open(ns[Math.floor(Math.random() * ns.length)]); }
function insertTemplate() {
  const p = curNote(); if (!p) { toast('Ouvrez d’abord une note.', true); return; }
  if ((S.modes[p] || 'live') === 'reading') S.modes[p] = 'live';
  const t = FILES.get(p).text; const d = new Date().toLocaleDateString('fr-FR');
  setText(p, (t ? t + '\n' : '') + [`## Réunion du ${d}`, '- Participants : ', '- Décisions : ', '- [ ] Prochaine étape'].join('\n'));
  renderView(); toast('Modèle « Réunion » inséré');
}
function toggleMode() { const p = curNote(); if (!p) return; S.modes[p] = (S.modes[p] || 'live') === 'live' ? 'reading' : 'live'; renderView(); renderStatus(); saveState(); }
function showSide(s, k) {
  if (k) S[s].tab = k; S[s].open = true;
  if (S.orient === 'port') S[s === 'left' ? 'right' : 'left'].open = false;
  frame(); if (s === 'left') renderLeft(); else renderRight(); relayout();
  if (k === 'search') setTimeout(() => { const i = $('[data-in="search"]'); if (i) i.focus(); }, 60);
}
function toggleSide(s) { S[s].open = !S[s].open; if (S.orient === 'port' && S[s].open) S[s === 'left' ? 'right' : 'left'].open = false; frame(); relayout(); }
function relayout() { setTimeout(() => { redrawGraphs(); const B = curBoard(); if (B) applyCam(B); }, 260); }
function reveal(p) { S.left.tab = 'files'; S.left.open = true; if (S.orient === 'port') S.right.open = false; if (FILES.has(p)) expandTo(p); else { expandTo(p + '/x'); S.selF = p; } frame(); renderLeft(); relayout(); }
function searchFor(q) { S.search = q; showSide('left', 'search'); }
function setTheme(t) { S.theme = t; frame(); OS.setDark(t === 'dark'); relayout(); const B = curBoard(); if (B) bRender(B); }
function addImages(files) {
  const dir = targetFolder(); let first = null; let n = 0; const list = [...files].filter((f) => /^image\//.test(f.type));
  if (!list.length) return;
  list.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result); const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, url.startsWith('data:image/png') ? 'png' : 'jpg'])[1].toLowerCase();
      const base = file.name.replace(/\.[^.]+$/, '').replace(BAD, '-').replace(/^\.+/, '') || 'Image';
      const p = uniq(dir, base, ext);
      if (OS.writeBase64(S.vault, p, url.split(',')[1])) { FILES.set(p, { type: 'image' }); imgCache.set(p, url); if (!first) first = p; } else toast(`Impossible d’ajouter « ${file.name} ».`, true);
      if (++n === list.length) { if (dirOf(first || '')) expandTo(first); renderLeft(); if (first) toast(list.length > 1 ? `${list.length} images ajoutées` : `« ${stem(first)} » ajoutée`); }
    };
    reader.onerror = () => { toast(`Impossible de lire « ${file.name} ».`, true); n++; };
    reader.readAsDataURL(file);
  });
}
picker.addEventListener('change', () => { const files = picker.files; if (files && files.length) addImages(files); picker.value = ''; });

// ------------------------------------------------- palette and switcher
const CMDS = [['Créer une nouvelle note', 'Ctrl+N', () => newNote()], ['Créer un moodboard', '', newBoard], ['Ouvrir une note', 'Ctrl+O', () => pickerOpen('sw')], ['Ouvrir le graphe', 'Ctrl+G', () => open('graph')], ['Ouvrir la note du jour', '', daily], ['Ouvrir une note au hasard', '', randomNote], ['Insérer un modèle', '', insertTemplate], ['Basculer lecture / édition', 'Ctrl+E', toggleMode], ['Rechercher dans le coffre', 'Ctrl+Maj+F', () => showSide('left', 'search')], ['Afficher ou masquer le panneau gauche', '', () => toggleSide('left')], ['Afficher ou masquer le panneau droit', '', () => toggleSide('right')], ['Ajouter la note active aux signets', '', () => { const p = curFile(); if (p) { if (!S.bookmarks.includes(p)) toggleBm(p); } else toast('Aucune note active.', true); }], ['Changer de thème', '', () => setTheme(S.theme === 'dark' ? 'light' : 'dark')], ['Changer de coffre', '', () => vaultModal()], ['Ouvrir les paramètres', 'Ctrl+,', () => settings()]];
let PK = { kind: '', q: '', sel: 0, items: [] };
function pickerOpen(kind) {
  PK = { kind, q: '', sel: 0, items: [] };
  modal('', `<div class="picker"><input class="tin" data-in="pick" placeholder="${kind === 'pal' ? 'Tapez une commande…' : 'Trouver ou créer une note…'}" enterkeyhint="go"><div class="plist" role="listbox"></div><div class="pfoot"><span>↑↓ naviguer</span><span>↵ ${kind === 'pal' ? 'exécuter' : 'ouvrir'}</span><span>échap fermer</span></div></div>`, '', (d) => { setTimeout(() => d.querySelector('input').focus(), 60); pickRender(); });
}
function pickRender() {
  const q = PK.q.trim().toLowerCase(); let it;
  if (PK.kind === 'pal') it = CMDS.filter((c) => c[0].toLowerCase().includes(q)).map((c) => ({ l: c[0], d: c[1], run: c[2] }));
  else {
    it = [...FILES.keys()].filter((p) => (FILES.get(p).type === 'note' || FILES.get(p).type === 'board') && (stem(p) + ' ' + p).toLowerCase().includes(q)).sort((a, b) => stem(a).localeCompare(stem(b))).map((p) => ({ l: stem(p), d: shared(p) ? projectOf(p) : dirOf(p), run: () => open(p) }));
    if (q && !it.some((x) => x.l.toLowerCase() === q)) { const n = PK.q.trim(); it.push({ l: `Créer « ${n} »`, d: 'Nouvelle note', run: () => { const err = nameErr(n); if (err) { toast(err, true); return; } const p = uniq('', n, 'md'); if (createNote(p)) open(p); } }); }
  }
  PK.items = it; PK.sel = clamp(PK.sel, 0, Math.max(0, it.length - 1));
  const l = $('.ovl .mbd:not(.closing) .plist'); if (!l) return;
  l.innerHTML = it.map((x, i) => `<div class="pitem${i === PK.sel ? ' on' : ''}" data-act="pick" data-k="${i}" role="option">${esc(x.l)}<span class="pd">${esc(x.d || '')}</span></div>`).join('') || '<div class="pempty">Aucun résultat.</div>';
}
function pickRun(i) { const x = PK.items[i]; closeModal(); if (x) x.run(); }

// --------------------------------------------------------------- vaults
function vaultModal() {
  let list = []; try { list = JSON.parse(OS.vaults()); } catch (_) {}
  modal('Coffres', `<div class="mb"><div class="vlist">${list.map((v) => `<button type="button" class="vitem${S.vault === v ? ' cur' : ''}" data-act="vpick" data-v="${esc(v)}"><b>${esc(v)}</b><small>${esc(OS.vaultPath(v))}</small></button>`).join('')}</div></div><div class="mf"><button type="button" class="btn pri" data-act="vnew">Créer un coffre</button></div>`);
}
function switchVault(name) {
  if (name === S.vault) return;
  window.opaleFlush();
  S.vault = name; loadVault(); refresh(); toast(`Coffre « ${name} » ouvert`);
}

// ------------------------------------------------------------- settings
let SET = 'appearance';
function settings(sec) { SET = sec || 'appearance'; modal('', `<div class="sets"><nav class="snav"></nav><div class="smain"><div class="shead"><h3></h3>${ib('x', 'Fermer', 'mclose')}</div><div class="spane"></div></div></div>`, 'wide', () => setRender()); }
function setRender() {
  const m = openModalEl(); if (!m || !$('.snav', m)) return;
  const secs = [['editor', 'Éditeur'], ['appearance', 'Apparence'], ['vault', 'Coffre'], ['sync', 'Synchronisation'], ['about', 'À propos']];
  $('.snav', m).innerHTML = secs.map(([k, l]) => `<button type="button" class="sni${k === SET ? ' on' : ''}" data-act="setsec" data-k="${k}">${l}</button>`).join('');
  $('.shead h3', m).textContent = secs.find((s) => s[0] === SET)[1];
  const row = (l, h, c) => `<div class="set"><div><div class="sl">${l}</div>${h ? `<div class="sh">${h}</div>` : ''}</div><div class="sc">${c}</div></div>`;
  const sw = (on, act) => `<button type="button" class="sw${on ? ' on' : ''}" data-act="${act}" aria-pressed="${on}"></button>`;
  let h = '';
  if (SET === 'editor') h = row('Vérification orthographique', 'Souligne les fautes pendant la saisie.', sw(S.spell, 'sspell')) + row('Largeur de lecture limitée', 'Garde les lignes à une longueur confortable.', sw(S.readable, 'sread'));
  else if (SET === 'appearance') h = row('Thème', 'Sombre ou clair.', `<div class="seg">${['dark', 'light'].map((t) => `<button type="button" class="${S.theme === t ? 'on' : ''}" data-act="stheme" data-t="${t}">${t === 'dark' ? 'Sombre' : 'Clair'}</button>`).join('')}</div>`) + row('Couleur d’accent', 'Liens, sélection et boutons principaux.', ['#fbbf24', '#a78bfa', '#60a5fa', '#34d399', '#f472b6', '#f87171'].map((c) => `<button type="button" class="accb${S.accent === c ? ' on' : ''}" data-act="sacc" data-c="${c}" style="background:${c}" aria-label="Accent ${c}"></button>`).join('')) + row('Taille du texte', `<span id="fsv">${S.fs} px</span>`, `<input type="range" min="14" max="20" step="1" value="${S.fs}" data-in="sfs" style="width:180px">`);
  else if (SET === 'vault') h = row('Coffre ouvert', esc(S.vault), '<button type="button" class="btn sm" data-act="vault">Changer de coffre</button>') + `<p class="snote">Les notes sont de simples fichiers Markdown rangés dans ce dossier de la tablette. Vous pouvez les copier par câble USB :<br><code>${esc(OS.vaultPath(S.vault))}</code></p><p class="snote">Les fichiers supprimés sont déplacés dans le dossier <code>.trash</code> du coffre.</p>`;
  else if (SET === 'sync') h = `<div class="cstat">${ic('cloud-off', 18)}Synchronisation Google Drive non reliée sur la tablette</div><p class="snote">Vos notes sont enregistrées sur l’appareil. La synchronisation avec Google Drive de la version ordinateur n’est pas encore disponible dans l’application Android.</p>`;
  else h = `<div style="padding-top:10px"><div style="font-size:26px;font-weight:700;color:var(--t0)">Opale</div><div style="color:var(--t3);margin-bottom:8px">Version 1.0 · tablette Android</div></div>`;
  $('.spane', m).innerHTML = h;
}

// ------------------------------------------------------------------ graph
const POS = new Map(); let GK = ''; const SIM = { d: null, left: 0 }; let simRAF = 0;
function hash(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
function gData() {
  const nodes = []; const edges = []; const idx = new Map(); const seen = new Set();
  const add = (id, label, kind) => { if (!idx.has(id)) { idx.set(id, nodes.length); nodes.push({ id, label, kind }); } };
  for (const [p, f] of FILES) if (f.type === 'note' || f.type === 'board') add(p, stem(p), f.type);
  for (const [p, f] of FILES) if (f.type === 'note') {
    for (const l of linksOf(f.text)) { const t = resolve(l) || '?' + l.toLowerCase(); if (!idx.has(t)) add(t, l, 'un'); const k = p + '>' + t; if (t !== p && !seen.has(k)) { seen.add(k); edges.push([p, t]); } }
    if (S.graph.tags) for (const g of tagsOf(f.text)) { add('#' + g, '#' + g, 'tag'); edges.push([p, '#' + g]); }
  }
  return { nodes, edges };
}
// New nodes settle into place over a few frames instead of appearing already laid out.
function layout(d) {
  const key = d.nodes.map((n) => n.id).join('|'); if (key === GK) return; GK = key;
  for (const n of d.nodes) if (!POS.has(n.id)) { const a = hash(n.id) % 360 * Math.PI / 180; const r = 60 + hash(n.id + 'r') % 140; POS.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r }); }
  SIM.d = d; SIM.left = 220;
  if (RM.matches) { step(220); SIM.left = 0; return; }
  if (!simRAF) simRAF = requestAnimationFrame(simTick);
}
function step(n) {
  const d = SIM.d; if (!d) return;
  const P = d.nodes.map((x) => POS.get(x.id)); const ix = new Map(d.nodes.map((x, i) => [x.id, i]));
  for (let it = 0; it < n; it++) {
    const F = P.map(() => ({ x: 0, y: 0 }));
    for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) { let dx = P[a].x - P[b].x; let dy = P[a].y - P[b].y; const d2 = dx * dx + dy * dy || 0.01; const dd = Math.sqrt(d2); const f = 2600 / d2; dx /= dd; dy /= dd; F[a].x += dx * f; F[a].y += dy * f; F[b].x -= dx * f; F[b].y -= dy * f; }
    for (const [s, t] of d.edges) { const a = ix.get(s); const b = ix.get(t); if (a == null || b == null) continue; const dx = P[b].x - P[a].x; const dy = P[b].y - P[a].y; const dd = Math.hypot(dx, dy) || 0.01; const f = (dd - 90) * 0.05; F[a].x += dx / dd * f; F[a].y += dy / dd * f; F[b].x -= dx / dd * f; F[b].y -= dy / dd * f; }
    P.forEach((p, i) => { if (p.pinned) return; F[i].x -= p.x * 0.01; F[i].y -= p.y * 0.01; const m = Math.min(1, 10 / (Math.hypot(F[i].x, F[i].y) || 1)); p.x += F[i].x * m; p.y += F[i].y * m; });
  }
}
function simTick() { simRAF = 0; if (SIM.left <= 0) return; const n = Math.min(6, SIM.left); step(n); SIM.left -= n; redrawGraphs(); if (SIM.left > 0) simRAF = requestAnimationFrame(simTick); }
function redrawGraphs() { const g = $('#gcv'); if (g) drawGraph(g, null, false, !!g._drag); const l = $('#lcv'); if (l) drawGraph(l, curFile(), true, !!l._drag); }
function drawGraph(cv, center, local, keep) {
  const d = gData(); layout(d); let N = d.nodes; let E = d.edges;
  const cw = cv.clientWidth; const ch = cv.clientHeight; if (!cw || !ch) return;
  const dpr = Math.min(3, window.devicePixelRatio || 1); cv.width = cw * dpr; cv.height = ch * dpr;
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cs = getComputedStyle(scr); const col = (n) => cs.getPropertyValue(n).trim();
  if (local) {
    if (!center || !N.some((n) => n.id === center)) { c.fillStyle = col('--t3'); c.font = '13px Roboto, system-ui'; c.textAlign = 'center'; c.fillText('Aucune note active.', cw / 2, ch / 2); cv._g = null; return; }
    const nb = new Set([center]); E.forEach(([s, t]) => { if (s === center) nb.add(t); if (t === center) nb.add(s); });
    N = N.filter((n) => nb.has(n.id)); E = E.filter(([s, t]) => nb.has(s) && nb.has(t));
  }
  if (!N.length) { cv._g = null; return; }
  let T = keep && cv._g ? cv._g.T : null;
  if (!T) {
    let x0 = 1e9; let y0 = 1e9; let x1 = -1e9; let y1 = -1e9;
    for (const n of N) { const p = POS.get(n.id); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const k = Math.min((cw - 90) / ((x1 - x0) || 1), (ch - 90) / ((y1 - y0) || 1), local ? 1.5 : 1.3);
    T = { k, ox: cw / 2 - (x0 + x1) / 2 * k, oy: ch / 2 - (y0 + y1) / 2 * k };
  }
  const deg = {}; E.forEach(([s, t]) => { deg[s] = (deg[s] || 0) + 1; deg[t] = (deg[t] || 0) + 1; });
  const sp = (id) => { const p = POS.get(id); return [p.x * T.k + T.ox, p.y * T.k + T.oy]; };
  c.strokeStyle = col('--gl'); c.lineWidth = 1; c.beginPath();
  for (const [s, t] of E) { const a = sp(s); const b = sp(t); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
  c.stroke();
  const pts = []; const act = center || curFile();
  for (const n of N) {
    const [x, y] = sp(n.id); const r = (4 + Math.sqrt(deg[n.id] || 0) * 1.8) * S.graph.size;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = n.id === act ? col('--acc') : n.kind === 'tag' ? col('--gt') : n.kind === 'un' ? col('--gu') : col('--gn'); c.fill();
    pts.push({ id: n.id, kind: n.kind, label: n.label, x, y, r });
    if (S.graph.names || local) { c.fillStyle = n.id === act ? col('--t0') : col('--t2'); c.font = '12px Roboto, system-ui'; c.textAlign = 'center'; c.fillText(n.label, x, y + r + 14); }
  }
  cv._g = { T, pts };
}
function graphPointer(cv, local) {
  let dr = null;
  const at = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.onpointerdown = (e) => {
    if (!cv._g) return; const { x, y } = at(e); let best = null; let bd = 1e9;
    for (const p of cv._g.pts) { const d = Math.hypot(p.x - x, p.y - y); if (d < p.r + 12 && d < bd) { bd = d; best = p; } }
    if (!best) return; dr = { p: best, x, y, moved: false }; cv._drag = true; cv.setPointerCapture(e.pointerId);
  };
  cv.onpointermove = (e) => {
    if (!dr) return; const { x, y } = at(e);
    if (Math.hypot(x - dr.x, y - dr.y) > 5) dr.moved = true; if (!dr.moved) return;
    const T = cv._g.T; const o = POS.get(dr.p.id); o.x = (x - T.ox) / T.k; o.y = (y - T.oy) / T.k; o.pinned = true;
    drawGraph(cv, local ? curFile() : null, local, true);
  };
  cv.onpointerup = () => {
    if (!dr) return; const p = dr.p; const m = dr.moved; dr = null; cv._drag = false;
    const o = POS.get(p.id); if (o) delete o.pinned;
    if (m) { SIM.left = Math.max(SIM.left, 60); if (!simRAF && !RM.matches) simRAF = requestAnimationFrame(simTick); return; }
    if (p.kind === 'tag') searchFor('tag:' + p.label); else if (p.kind === 'un') createFromLink(p.label); else open(p.id);
  };
  cv.onpointercancel = () => { dr = null; cv._drag = false; };
}
function createFromLink(n) { const err = nameErr(n); if (err) { toast(err, true); return; } const p = uniq('', n, 'md'); if (createNote(p)) { open(p); toast(`Note « ${n} » créée`); } }

// -------------------------------------------------------------- moodboard
const NAMES = { text: 'Texte', sticky: 'Pense-bête', shape: 'Forme', frame: 'Cadre', comment: 'Commentaire', card: 'Carte', img: 'Image', stroke: 'Dessin', hl: 'Surlignage', conn: 'Flèche', note: 'Note du coffre' };
const TOOLS = [['select', 'Sélection (V)'], ['hand', 'Déplacer la vue (H)'], ['text', 'Texte (T)'], ['sticky', 'Pense-bête (N)'], ['shape', 'Forme (S)'], ['connector', 'Flèche (L)'], ['pen', 'Stylo (P)'], ['highlighter', 'Surligneur'], ['eraser', 'Gomme (E)'], ['frame', 'Cadre (F)'], ['comment', 'Commentaire (C)']];
const DEFAULTS = { text: { w: 240, h: 40, text: 'Texte' }, sticky: { w: 180, h: 150, color: '#fde68a', text: 'Nouvelle idée' }, shape: { w: 160, h: 100, color: '#60a5fa', shape: 'rect', text: '' }, frame: { w: 420, h: 300, text: 'Cadre' }, comment: { w: 200, h: 60, text: 'Commentaire' } };
const curBoard = () => { const c = cur(); return c && FILES.get(c)?.type === 'board' ? FILES.get(c).board : null; };
const getEl = (B, id) => B.els.find((x) => x.id === id);
let freshId = 0;
function pushU(B) { B.undo.push(JSON.stringify(B.els)); if (B.undo.length > 80) B.undo.shift(); B.redo = []; saved(B); }
function saved(B) {
  B.unreadable = false; queueWrite(B.path);
  const s = $('.bsave'); if (s) s.textContent = 'Enregistrement…';
  clearTimeout(B.st); B.st = setTimeout(() => { const s2 = $('.bsave'); if (s2) s2.textContent = 'Enregistré'; }, 700);
}
function camSaved(B) { if (!B.unreadable) queueWrite(B.path); }
function renderBoard(p) {
  const B = FILES.get(p).board;
  $('.views').innerHTML = `<div class="view">${header(crumbsOf(p), ib('back', 'Annuler (Ctrl+Z)', 'bundo') + ib('forward', 'Rétablir (Ctrl+Y)', 'bredo') + '<button type="button" class="btn sm" data-act="bimport">Importer</button><button type="button" class="btn sm" data-act="blayers">Calques</button>' + ib('more', 'Options du moodboard', 'bmore'))}
<div class="bstage${B.grid ? '' : ' nogrid'}" tabindex="0" aria-label="Moodboard"><div class="bworld"><div class="bels"></div><svg class="bprev"></svg></div>
<div class="bui bzoom">${ib('collapse', 'Tout afficher', 'bfit')}<button type="button" class="btn sm" data-act="bzo" aria-label="Dézoomer">−</button><button type="button" class="btn sm bzl" data-act="bz1">100 %</button><button type="button" class="btn sm" data-act="bzi" aria-label="Zoomer">+</button><span class="bsave" role="status">${B.unreadable ? 'Fichier illisible' : 'Enregistré'}</span></div>
<div class="bui binsp" hidden></div>
<div class="bui btools" role="toolbar" aria-label="Outils du moodboard">${TOOLS.map(([t, l]) => ib('board-' + t, l, 'btool', `data-t="${t}"`)).join('')}<button type="button" class="btn sm" data-act="blib">Ajouter</button></div></div></div>`;
  bRender(B); boardPointer(B);
}
function strokeBox(el) { const pad = el.type === 'hl' ? 12 : 8; let x0 = 1e9; let y0 = 1e9; let x1 = -1e9; let y1 = -1e9; for (const [x, y] of el.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 }; }
function strokePath(el, b) {
  let d = el.pts.map(([x, y], i) => (i ? 'L' : 'M') + (x - b.x).toFixed(1) + ' ' + (y - b.y).toFixed(1)).join('');
  if (el.type === 'conn' && el.pts.length > 1) {
    const a = el.pts[el.pts.length - 2]; const c = el.pts[el.pts.length - 1]; const ang = Math.atan2(c[1] - a[1], c[0] - a[0]); const hx = c[0] - b.x; const hy = c[1] - b.y;
    d += `M${(hx - 12 * Math.cos(ang - 0.45)).toFixed(1)} ${(hy - 12 * Math.sin(ang - 0.45)).toFixed(1)}L${hx.toFixed(1)} ${hy.toFixed(1)}L${(hx - 12 * Math.cos(ang + 0.45)).toFixed(1)} ${(hy - 12 * Math.sin(ang + 0.45)).toFixed(1)}`;
  }
  return d;
}
const strokeColor = (el) => el.color || (S.theme === 'light' ? '#1c1b23' : '#ecebf3');
function elHtml(el, B) {
  const sel = B.sel.includes(el.id); const cl = `be ${el.type}${sel ? ' sel' : ''}${el.locked ? ' locked' : ''}${el.id === freshId && !RM.matches ? ' is-new' : ''}`;
  if (el.pts) { const b = strokeBox(el); const d = strokePath(el, b); const w = el.type === 'hl' ? 14 : el.type === 'conn' ? 2 : 3; return `<div class="${cl} strk" data-id="${el.id}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><svg width="${b.w}" height="${b.h}" style="overflow:visible;display:block"><path class="hit" d="${d}" stroke="transparent" stroke-width="18" fill="none"/><path d="${d}" stroke="${esc(strokeColor(el))}" stroke-opacity="${el.type === 'hl' ? 0.4 : 1}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`; }
  const st = `left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px`;
  const hd = sel && B.sel.length === 1 && !el.locked ? '<div class="bh" data-h="1"></div>' : '';
  const t = `<div class="bt">${esc(el.text || '')}</div>`;
  if (el.type === 'sticky') return `<div class="${cl}" data-id="${el.id}" style="${st};background:${esc(el.color)}">${t}${hd}</div>`;
  if (el.type === 'shape') return `<div class="${cl}" data-id="${el.id}" style="${st};border-color:${esc(el.color)};background:color-mix(in srgb,${esc(el.color)} 18%,transparent);border-radius:${el.shape === 'ellipse' ? '50%' : '10px'}">${t}${hd}</div>`;
  if (el.type === 'card' || el.type === 'note') return `<div class="${cl} card" data-id="${el.id}" style="${st}"><div class="ct">${ic(el.type === 'note' ? 'file' : 'template', 15)}${esc(el.title || '')}</div>${t}${hd}</div>`;
  if (el.type === 'img') { const url = el.src ? imgUrl(el.src) : ''; return `<div class="${cl}" data-id="${el.id}" style="${st}"><img src="${url || ILLU_URL}" alt="" draggable="false">${t}${hd}</div>`; }
  return `<div class="${cl}" data-id="${el.id}" style="${st}">${t}${hd}</div>`;
}
function applyCam(B) {
  const w = $('.bworld'); const st = $('.bstage'); if (!w) return; const c = B.cam;
  w.style.transform = `translate(${c.x}px,${c.y}px) scale(${c.k})`;
  st.style.backgroundSize = `${24 * c.k}px ${24 * c.k}px`; st.style.backgroundPosition = `${c.x}px ${c.y}px`;
  const z = $('.bzl'); if (z) z.textContent = Math.round(c.k * 100) + ' %';
}
function bRender(B) {
  const e = $('.bels'); if (!e) return;
  e.innerHTML = B.els.map((x) => elHtml(x, B)).join(''); freshId = 0; applyCam(B);
  scr.querySelectorAll('.btools [data-t]').forEach((b) => { b.classList.toggle('on', b.dataset.t === B.tool); b.setAttribute('aria-pressed', b.dataset.t === B.tool); });
  $('[data-act="bundo"]').disabled = !B.undo.length; $('[data-act="bredo"]').disabled = !B.redo.length;
  $('.bstage').classList.toggle('nogrid', !B.grid);
  const ins = $('.binsp'); const sel = B.sel.map((id) => getEl(B, id)).filter(Boolean);
  if (!sel.length) { ins.hidden = true; return; }
  const wasHidden = ins.hidden; ins.hidden = false;
  if (!wasHidden) ins.style.animation = 'none';
  const one = sel[0]; const lk = sel.every((x) => x.locked);
  const colorable = ['sticky', 'shape', 'stroke', 'hl', 'conn'].includes(one.type);
  const pal = one.type === 'sticky' ? ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa'] : ['#a78bfa', '#60a5fa', '#34d399', '#f87171', '#fbbf24'];
  ins.innerHTML = `<span class="bname">${sel.length > 1 ? sel.length + ' éléments' : NAMES[one.type] || 'Élément'}</span>${colorable ? pal.map((c) => `<button type="button" class="swc${one.color === c ? ' on' : ''}" data-act="bcolor" data-c="${c}" style="background:${c}" aria-label="Couleur ${c}"></button>`).join('') : ''}${!one.pts ? '<button type="button" class="btn sm" data-act="bedit">Modifier</button>' : ''}${ib('copy', 'Dupliquer', 'bdup')}${ib('pin', lk ? 'Déverrouiller' : 'Verrouiller', 'block', '', lk ? 'on' : '')}${ib('trash', 'Supprimer la sélection', 'bdel')}`;
  if (wasHidden) ins.style.animation = '';
}
function editEl(B, id) {
  const el = getEl(B, id); if (!el || el.pts || el.locked) return;
  const d = $(`.be[data-id="${id}"] .bt`); if (!d) return;
  d.contentEditable = 'true'; d.focus();
  const r = document.createRange(); r.selectNodeContents(d); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  d.addEventListener('blur', () => { const v = d.innerText.trim(); if (v !== (el.text || '')) { pushU(B); el.text = v; } bRender(B); }, { once: true });
  d.addEventListener('keydown', (e) => { if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && el.type === 'text')) { e.preventDefault(); d.blur(); } });
}
function addEl(B, o) { pushU(B); const el = { id: B.nid++, ...o }; if (el.type === 'frame') B.els.unshift(el); else B.els.push(el); B.sel = [el.id]; B.tool = 'select'; freshId = el.id; bRender(B); return el; }
function viewCenter(B) { const st = $('.bstage'); return { x: (st.clientWidth / 2 - B.cam.x) / B.cam.k, y: (st.clientHeight / 2 - B.cam.y) / B.cam.k }; }
function zoomAt(B, f, px, py, instant) {
  const st = $('.bstage'); if (px == null) { px = st.clientWidth / 2; py = st.clientHeight / 2; }
  const k = clamp(B.cam.k * f, 0.2, 4); const wx = (px - B.cam.x) / B.cam.k; const wy = (py - B.cam.y) / B.cam.k;
  animateCam(B, { k, x: px - wx * k, y: py - wy * k }, instant);
}
// Zoom buttons glide to the new view, as on the desktop board.
function animateCam(B, to, instant) {
  cancelAnimationFrame(B.camRaf);
  if (instant || RM.matches) { B.cam = to; applyCam(B); camSaved(B); return; }
  const from = { ...B.cam }; const t0 = performance.now(); const dur = 220;
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - t, 3);
    B.cam = { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }; applyCam(B);
    if (t < 1) B.camRaf = requestAnimationFrame(tick); else camSaved(B);
  };
  B.camRaf = requestAnimationFrame(tick);
}
function fitAll(B) {
  const st = $('.bstage');
  if (!B.els.length) { animateCam(B, { x: st.clientWidth / 2, y: st.clientHeight / 2, k: 1 }); return; }
  let x0 = 1e9; let y0 = 1e9; let x1 = -1e9; let y1 = -1e9;
  for (const e of B.els) { const b = e.pts ? strokeBox(e) : e; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y - 28); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  const k = clamp(Math.min((st.clientWidth - 80) / (x1 - x0), (st.clientHeight - 180) / (y1 - y0)), 0.2, 2);
  animateCam(B, { k, x: st.clientWidth / 2 - (x0 + x1) / 2 * k, y: (st.clientHeight - 60) / 2 - (y0 + y1) / 2 * k });
}
function boardPointer(B) {
  const st = $('.bstage'); const prev = $('.bprev'); const P = new Map(); let g = null; let pinch = null;
  const loc = (e) => { const r = st.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const toW = (p) => ({ x: (p.x - B.cam.x) / B.cam.k, y: (p.y - B.cam.y) / B.cam.k });
  const erase = (e) => {
    const t = document.elementFromPoint(e.clientX, e.clientY); const be = t && t.closest && t.closest('.be'); if (!be || !st.contains(be)) return;
    const id = +be.dataset.id; const el = getEl(B, id); if (!el || el.locked) return;
    if (!g.pushed) { pushU(B); g.pushed = true; } else saved(B);
    B.els = B.els.filter((x) => x.id !== id); B.sel = B.sel.filter((x) => x !== id); bRender(B);
  };
  st.addEventListener('wheel', (e) => { e.preventDefault(); const p = loc(e); zoomAt(B, e.deltaY < 0 ? 1.1 : 1 / 1.1, p.x, p.y, true); }, { passive: false });
  st.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.bui') || e.target.isContentEditable) return;
    closeMenu(); cancelAnimationFrame(B.camRaf);
    const p = loc(e); P.set(e.pointerId, p);
    if (P.size === 2) { const [a, b] = [...P.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: B.cam.k, cx: B.cam.x, cy: B.cam.y, m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; prev.innerHTML = ''; g = null; return; }
    const w = toW(p); const tool = B.tool; const hit = e.target.closest('.be'); const hd = e.target.closest('[data-h]');
    if (tool === 'select') {
      if (hd && B.sel.length === 1) { const el = getEl(B, B.sel[0]); g = { t: 'resize', el, w0: el.w, h0: el.h, p0: w, pushed: false }; }
      else if (hit) {
        const id = +hit.dataset.id; const now = Date.now();
        if (B.lt && B.lt.id === id && now - B.lt.t < 380) { B.lt = null; P.delete(e.pointerId); editEl(B, id); return; }
        B.lt = { id, t: now }; if (!B.sel.includes(id)) B.sel = [id];
        g = { t: 'move', p0: w, orig: B.sel.map((i) => getEl(B, i)).filter((x) => x && !x.locked).map((x) => ({ x, ox: x.x, oy: x.y, pts: x.pts ? x.pts.map((q) => [...q]) : null })), moved: false };
        bRender(B);
      } else { B.sel = []; g = { t: 'pan', p0: p, c0: { ...B.cam } }; bRender(B); }
    } else if (tool === 'hand') g = { t: 'pan', p0: p, c0: { ...B.cam } };
    else if (tool === 'pen' || tool === 'highlighter' || tool === 'connector') g = { t: 'draw', tool, pts: [[w.x, w.y]] };
    else if (tool === 'eraser') { g = { t: 'erase', pushed: false }; erase(e); }
    else {
      P.delete(e.pointerId); const D = DEFAULTS[tool];
      const el = addEl(B, { type: tool, x: Math.round(w.x - D.w / 2), y: Math.round(w.y - D.h / 2), ...D });
      if (tool !== 'shape' && tool !== 'frame') setTimeout(() => editEl(B, el.id), 20);
      return;
    }
    if (g) try { st.setPointerCapture(e.pointerId); } catch (_) {}
  });
  st.addEventListener('pointermove', (e) => {
    if (!P.has(e.pointerId)) return; const p = loc(e); P.set(e.pointerId, p);
    if (pinch && P.size >= 2) {
      const [a, b] = [...P.values()]; const k = clamp(pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, 0.2, 4); const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const wx = (pinch.m.x - pinch.cx) / pinch.k; const wy = (pinch.m.y - pinch.cy) / pinch.k; B.cam = { k, x: m.x - wx * k, y: m.y - wy * k }; applyCam(B); return;
    }
    if (!g) return; const w = toW(p);
    if (g.t === 'pan') { B.cam.x = g.c0.x + p.x - g.p0.x; B.cam.y = g.c0.y + p.y - g.p0.y; applyCam(B); }
    else if (g.t === 'move') {
      const dx = w.x - g.p0.x; const dy = w.y - g.p0.y;
      if (!g.moved) { if (Math.hypot(dx, dy) * B.cam.k < 4 || !g.orig.length) return; pushU(B); g.moved = true; B.lt = null; }
      for (const o of g.orig) { if (o.pts) o.x.pts = o.pts.map(([x, y]) => [x + dx, y + dy]); else { o.x.x = Math.round(o.ox + dx); o.x.y = Math.round(o.oy + dy); } }
      bRender(B);
    } else if (g.t === 'resize') { if (!g.pushed) { pushU(B); g.pushed = true; } g.el.w = Math.max(40, Math.round(g.w0 + w.x - g.p0.x)); g.el.h = Math.max(30, Math.round(g.h0 + w.y - g.p0.y)); bRender(B); }
    else if (g.t === 'draw') {
      if (g.tool === 'connector') g.pts = [g.pts[0], [w.x, w.y]]; else g.pts.push([w.x, w.y]);
      const tmp = { type: g.tool === 'highlighter' ? 'hl' : g.tool === 'connector' ? 'conn' : 'stroke', pts: g.pts }; const d = strokePath(tmp, { x: 0, y: 0 });
      prev.innerHTML = `<path d="${d}" stroke="${g.tool === 'highlighter' ? '#fbbf24' : 'currentColor'}" stroke-opacity="${g.tool === 'highlighter' ? 0.4 : 1}" stroke-width="${g.tool === 'highlighter' ? 14 : g.tool === 'connector' ? 2 : 3}" fill="none" stroke-linecap="round" stroke-linejoin="round" style="color:var(--t0)"/>`;
    } else if (g.t === 'erase') erase(e);
  });
  const up = (e) => {
    P.delete(e.pointerId);
    if (pinch && P.size < 2) { pinch = null; camSaved(B); }
    if (!g) return;
    if (g.t === 'pan') camSaved(B);
    if (g.t === 'draw') {
      prev.innerHTML = ''; const n = g.pts.length; const len = n > 1 ? Math.hypot(g.pts[n - 1][0] - g.pts[0][0], g.pts[n - 1][1] - g.pts[0][1]) : 0;
      if (n > 1 && (g.tool !== 'connector' || len > 12)) {
        const tl = g.tool;
        addEl(B, { type: tl === 'highlighter' ? 'hl' : tl === 'connector' ? 'conn' : 'stroke', pts: g.pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]), color: tl === 'highlighter' ? '#fbbf24' : tl === 'connector' ? '#9390a3' : (S.theme === 'light' ? '#1c1b23' : '#ecebf3') });
        B.tool = tl; B.sel = []; bRender(B);
      }
    }
    g = null;
  };
  st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
}
let LIB = null;
function libModal(B) {
  const items = [['sticky', 'Pense-bête', 'board-sticky'], ['text', 'Texte', 'board-text'], ['shape', 'Forme', 'board-shape'], ['frame', 'Cadre', 'board-frame'], ['comment', 'Commentaire', 'board-comment'], ['card', 'Carte Markdown', 'template'], ['card', 'Tâche', 'check'], ['card', 'Kanban', 'outline'], ['card', 'Tableau', 'template'], ['card', 'Code', 'command'], ['card', 'Sondage', 'graph'], ['card', 'Planning', 'calendar']];
  LIB = (k) => { const [t, l] = items[k]; const c = viewCenter(B); const D = t === 'card' ? { w: 220, h: 110, title: l, text: 'Touchez deux fois pour modifier' } : DEFAULTS[t]; addEl(B, { type: t, x: Math.round(c.x - D.w / 2), y: Math.round(c.y - D.h / 2), ...D }); toast(`« ${l} » ajouté`); };
  modal('Ajouter au moodboard', `<div class="mb"><div class="lib">${items.map(([, l, i], k) => `<button type="button" class="libi" data-act="libadd" data-k="${k}">${ic(i, 28)}<span>${l}</span></button>`).join('')}</div></div>`, 'wide');
}

// Exports draw the board on a canvas, then save a JPG (or a PDF made from it) in Exports/.
function loadImage(src) { return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function wrapText(c, text, x, y, maxW, lh, maxH, align) {
  const lines = []; for (const para of String(text || '').split('\n')) { let line = ''; for (const word of para.split(/\s+/)) { const tryL = line ? line + ' ' + word : word; if (c.measureText(tryL).width > maxW && line) { lines.push(line); line = word; } else line = tryL; } lines.push(line); }
  const max = Math.max(1, Math.floor(maxH / lh)); c.textAlign = align || 'left';
  lines.slice(0, max).forEach((l, i) => c.fillText(l, x, y + i * lh));
}
async function boardCanvas(B) {
  if (!B.els.length) return null;
  let x0 = 1e9; let y0 = 1e9; let x1 = -1e9; let y1 = -1e9;
  for (const e of B.els) { const b = e.pts ? strokeBox(e) : e; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y - (e.type === 'frame' ? 30 : 0)); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  x0 -= 40; y0 -= 40; x1 += 40; y1 += 40;
  const s = Math.min(2, 2400 / (x1 - x0), 2400 / (y1 - y0));
  const cv = document.createElement('canvas'); cv.width = Math.round((x1 - x0) * s); cv.height = Math.round((y1 - y0) * s);
  const c = cv.getContext('2d'); const cs = getComputedStyle(scr); const col = (n) => cs.getPropertyValue(n).trim();
  c.fillStyle = col('--bg-0'); c.fillRect(0, 0, cv.width, cv.height); c.scale(s, s); c.translate(-x0, -y0); c.textBaseline = 'top';
  const font = (w, px) => `${w} ${px}px Roboto, system-ui, sans-serif`;
  for (const el of B.els) {
    c.save();
    if (el.pts) {
      c.strokeStyle = strokeColor(el); c.globalAlpha = el.type === 'hl' ? 0.4 : 1; c.lineWidth = el.type === 'hl' ? 14 : el.type === 'conn' ? 2 : 3; c.lineCap = 'round'; c.lineJoin = 'round';
      c.stroke(new Path2D(strokePath(el, { x: 0, y: 0 })));
    } else if (el.type === 'frame') {
      c.globalAlpha = 0.55; c.fillStyle = col('--bg-2'); rr(c, el.x, el.y, el.w, el.h, 10); c.fill(); c.globalAlpha = 1; c.strokeStyle = col('--bds'); c.lineWidth = 1.5; c.stroke();
      c.fillStyle = col('--t2'); c.font = font(400, 13); c.fillText(el.text || '', el.x + 2, el.y - 22);
    } else if (el.type === 'sticky') {
      c.fillStyle = el.color; rr(c, el.x, el.y, el.w, el.h, 4); c.fill(); c.fillStyle = '#2a2410'; c.font = font(400, 16); wrapText(c, el.text, el.x + 14, el.y + 14, el.w - 28, 21.6, el.h - 28);
    } else if (el.type === 'text') {
      c.fillStyle = col('--t0'); c.font = font(700, 30); wrapText(c, el.text, el.x, el.y, el.w, 36, el.h + 40);
    } else if (el.type === 'shape') {
      c.beginPath(); if (el.shape === 'ellipse') c.ellipse(el.x + el.w / 2, el.y + el.h / 2, el.w / 2, el.h / 2, 0, 0, Math.PI * 2); else rr(c, el.x, el.y, el.w, el.h, 10);
      c.globalAlpha = 0.18; c.fillStyle = el.color; c.fill(); c.globalAlpha = 1; c.strokeStyle = el.color; c.lineWidth = 2; c.stroke();
      c.fillStyle = col('--t0'); c.font = font(400, 15); wrapText(c, el.text, el.x + el.w / 2, el.y + el.h / 2 - 9, el.w - 16, 20, el.h - 16, 'center');
    } else if (el.type === 'img') {
      const im = await loadImage(el.src ? imgUrl(el.src) || ILLU_URL : ILLU_URL);
      rr(c, el.x, el.y, el.w, el.h, 8); c.clip();
      if (im) { const r = Math.max(el.w / im.width, el.h / im.height); const w = im.width * r; const h = im.height * r; c.drawImage(im, el.x + (el.w - w) / 2, el.y + (el.h - h) / 2, w, h); }
      else { c.fillStyle = col('--bg-3'); c.fillRect(el.x, el.y, el.w, el.h); }
    } else {
      c.fillStyle = col('--bg-2'); rr(c, el.x, el.y, el.w, el.h, el.type === 'comment' ? 14 : 10); c.fill(); c.strokeStyle = col('--bds'); c.lineWidth = 1; c.stroke();
      if (el.type === 'comment') { c.fillStyle = col('--t1'); c.font = font(400, 13); wrapText(c, el.text, el.x + 12, el.y + 10, el.w - 24, 18, el.h - 20); }
      else { c.fillStyle = col('--t0'); c.font = font(600, 14); c.fillText(el.title || '', el.x + 14, el.y + 12); c.fillStyle = col('--t2'); c.font = font(400, 13); wrapText(c, el.text, el.x + 14, el.y + 36, el.w - 28, 18, el.h - 48); }
    }
    c.restore();
  }
  return cv;
}
async function exportBoard(B, kind) {
  const cv = await boardCanvas(B); if (!cv) { toast('Le moodboard est vide.', true); return; }
  const url = cv.toDataURL('image/jpeg', 0.92); const b64 = url.split(',')[1];
  const p = uniq('Exports', stem(B.path), kind === 'pdf' ? 'pdf' : 'jpg');
  const ok = kind === 'pdf' ? OS.savePdf(S.vault, p, b64) : OS.writeBase64(S.vault, p, b64);
  if (!ok) { toast(kind === 'pdf' && !NATIVE ? 'L’export PDF n’existe que dans l’application Android.' : 'L’export a échoué.', true); return; }
  FILES.set(p, { type: kind === 'pdf' ? 'other' : 'image' }); if (kind !== 'pdf') imgCache.set(p, url);
  FOLDERS.add('Exports'); S.expanded.add('Exports'); renderLeft(); toast(`Exporté dans ${p}`);
}

// --------------------------------------------------------------- events
scr.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!e.target.closest('.menu')) closeMenu();
  if (e.target.classList.contains('mbd')) { closeModal(); return; }
  if (t && t.dataset.act === 'tab' && Date.now() - suppressClick < 400) return;
  if (t && scr.contains(t)) { const f = A[t.dataset.act]; if (f) { f(t, e); return; } }
  if (e.target.classList.contains('lnin')) return;
  const ln = e.target.closest('.live .ln'); if (ln) { editLine(+ln.dataset.i); return; }
  const nb = e.target.closest('.live.nbody');
  if (nb && e.target === nb) { const p = curNote(); const ls = FILES.get(p).text.split('\n'); if (ls[ls.length - 1].trim()) { ls.push(''); setText(p, ls.join('\n')); refreshBody(); } editLine(ls.length - 1); }
});
scr.addEventListener('contextmenu', (e) => {
  const r = e.target.closest('.row[data-p]');
  if (r && r.dataset.act === 'open') { e.preventDefault(); fileMenu(r.dataset.p, e); return; }
  if (!e.target.closest('input, [contenteditable="true"]')) e.preventDefault();
});
scr.addEventListener('input', (e) => {
  const t = e.target; const k = t.dataset.in;
  if (k === 'search') { S.search = t.value; renderResults(); }
  else if (k === 'pick') { PK.q = t.value; PK.sel = 0; pickRender(); }
  else if (k === 'prompt') { const pe = t.parentElement.querySelector('.ferr'); if (pe) pe.hidden = true; }
  else if (k === 'gsize') { S.graph.size = +t.value; const g = $('#gcv'); if (g) drawGraph(g, null, false, true); saveState(); }
  else if (k === 'sfs') { S.fs = +t.value; scr.style.setProperty('--fs', S.fs + 'px'); const v = $('#fsv'); if (v) v.textContent = S.fs + ' px'; saveState(); }
});
scr.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.dataset.in === 'pick') { if (e.key === 'ArrowDown') { e.preventDefault(); PK.sel = Math.min(PK.sel + 1, PK.items.length - 1); pickRender(); } else if (e.key === 'ArrowUp') { e.preventDefault(); PK.sel = Math.max(PK.sel - 1, 0); pickRender(); } else if (e.key === 'Enter') { e.preventDefault(); pickRun(PK.sel); } }
  else if (t.dataset.in === 'prompt' && e.key === 'Enter') { e.preventDefault(); if (PO) PO(); }
  else if (t.matches('[data-title]') && e.key === 'Enter') { e.preventDefault(); t.blur(); editLine(0, 0); }
  if (e.key === 'Escape' && openModalEl()) { e.preventDefault(); closeModal(); }
});
scr.addEventListener('beforeinput', (e) => {
  const t = e.target;
  if (t.matches && t.matches('[data-title]') && (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak')) { e.preventDefault(); t.blur(); editLine(0, 0); }
});
scr.addEventListener('focusout', (e) => {
  const t = e.target;
  if (t.matches && t.matches('[data-title]')) {
    const p = curNote(); const v = t.innerText.trim(); if (!p || v === stem(p)) return;
    const err = nameErr(v); if (err) { toast(err, true); t.textContent = stem(p); return; }
    rename(p, v);
  }
});
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  const map = { p: () => pickerOpen('pal'), o: () => pickerOpen('sw'), n: () => newNote(), e: toggleMode, g: () => open('graph'), t: () => { newTab(); refresh(); }, w: () => { if (S.active) closeTab(S.active); }, ',': () => settings() };
  const B = curBoard();
  if (B && !e.target.isContentEditable && e.target.tagName !== 'INPUT') { if (k === 'z') { e.preventDefault(); A.bundo(); return; } if (k === 'y') { e.preventDefault(); A.bredo(); return; } }
  if (e.shiftKey && k === 'f') { e.preventDefault(); showSide('left', 'search'); return; }
  if (map[k]) { e.preventDefault(); map[k](); }
});
// Android back: close what is open, then step back through the tab's history.
window.opaleBack = () => {
  if ($('.ovl .menu')) { closeMenu(); return true; }
  if (openModalEl()) { closeModal(); return true; }
  const ed = document.activeElement;
  if (ed && ed !== document.body && (ed.classList.contains('lnin') || ed.isContentEditable || ed.tagName === 'INPUT')) { ed.blur(); return true; }
  if (S.orient === 'port' && (S.left.open || S.right.open)) { S.left.open = false; S.right.open = false; frame(); return true; }
  if (canGo(-1)) { go(-1); return true; }
  return false;
};
let resizeT = 0;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (measure()) refresh(); else { frame(); relayout(); } }, 120); });

const A = {
  tleft: () => toggleSide('left'), tright: () => toggleSide('right'), scrim: () => { S.left.open = false; S.right.open = false; frame(); },
  switcher: () => pickerOpen('sw'), palette: () => pickerOpen('pal'), graph: () => open('graph'), daily, template: insertTemplate, random: randomNote,
  settings: () => settings(), vault: () => vaultModal(), syncinfo: () => settings('sync'),
  vpick: (t) => { closeModal(); switchVault(t.dataset.v); },
  vnew: () => prompt2('Nouveau coffre', 'Nom du coffre', '', (v) => { if (!OS.createVault(v)) { toast('Impossible de créer le coffre.', true); return; } switchVault(v); }, (v) => { let l = []; try { l = JSON.parse(OS.vaults()); } catch (_) {} return l.includes(v) ? 'Ce coffre existe déjà.' : ''; }),
  stab: (t) => { const s = t.dataset.side; S[s].tab = t.dataset.k; if (s === 'left') renderLeft(); else renderRight(); },
  newnote: () => newNote(), newboard: newBoard,
  addimg: () => picker.click(),
  newfolder: () => prompt2('Nouveau dossier', 'Nom du dossier', 'Nouveau dossier', (v) => { const base = targetFolder(); const p = (base ? base + '/' : '') + v; if (!OS.mkdir(S.vault, p)) { toast('Impossible de créer le dossier.', true); return; } FOLDERS.add(p); if (base) expandTo(p + '/x'); S.selF = p; renderLeft(); }, (v) => { const base = targetFolder(); const p = (base ? base + '/' : '') + v; return FOLDERS.has(p) || [...FILES.keys()].some((k) => k.startsWith(p + '/')) ? 'Ce dossier existe déjà.' : ''; }),
  sort: (t, e) => menu(e, [['Nom (A à Z)', S.sort === 'az' ? 'check' : '', () => { S.sort = 'az'; renderLeft(); }], ['Nom (Z à A)', S.sort === 'za' ? 'check' : '', () => { S.sort = 'za'; renderLeft(); }]]),
  collapseall: () => { S.expanded.clear(); renderLeft(); }, locate: () => { const p = curFile(); if (p && !shared(p)) { expandTo(p); renderLeft(); } },
  folder: (t) => { const p = t.dataset.p; S.selF = p; if (S.expanded.has(p)) S.expanded.delete(p); else S.expanded.add(p); renderLeft(); },
  open: (t) => { S.selF = ''; open(t.dataset.p); },
  collab: () => { S.collab = !S.collab; renderLeft(); }, proj: (t) => { S.proj[t.dataset.n] = S.proj[t.dataset.n] === false; renderLeft(); },
  pnew: (t, e) => { e.stopPropagation(); S.proj[t.dataset.n] = true; newNote(`${SHARED}/${t.dataset.n}`); },
  cadd: () => prompt2('Nouveau projet partagé', 'Nom du projet', '', (v) => { if (!OS.mkdir(S.vault, `${SHARED}/${v}`)) { toast('Impossible de créer le projet.', true); return; } FOLDERS.add(`${SHARED}/${v}`); S.projects.push(v); S.projects.sort((a, b) => a.localeCompare(b)); S.proj[v] = true; S.collab = true; renderLeft(); toast(`Projet « ${v} » créé`); }, (v) => S.projects.includes(v) ? 'Ce projet existe déjà.' : ''),
  bmadd: () => { const p = curFile(); if (!p) { toast('Aucune note active.', true); return; } if (!S.bookmarks.includes(p)) toggleBm(p); }, bmdel: (t, e) => { e.stopPropagation(); toggleBm(t.dataset.p); },
  tagsort: () => { S.tagSort = S.tagSort === 'count' ? 'name' : 'count'; renderLeft(); }, tag: (t) => searchFor('tag:#' + t.dataset.t),
  sop: (t) => { S.search = t.dataset.o; renderLeft(); const i = $('[data-in="search"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } },
  heading: (t) => { const ln = $(`.nbody .ln[data-i="${t.dataset.i}"]`); const sc = $('.nscroll'); if (ln && sc) { sc.scrollTo({ top: ln.offsetTop - 12, behavior: RM.matches ? 'auto' : 'smooth' }); ln.classList.remove('flash'); void ln.offsetWidth; ln.classList.add('flash'); setTimeout(() => ln.classList.remove('flash'), 1400); } if (S.orient === 'port') { S.right.open = false; frame(); } },
  link: (t) => { const n = t.dataset.n; const r = resolve(n); if (r) open(r); else createFromLink(n); },
  check: (t) => { const p = curNote(); if (!p) return; const ls = FILES.get(p).text.split('\n'); const i = +t.dataset.i; ls[i] = ls[i].replace(/^- \[( |x)\]/, (m, c) => c === 'x' ? '- [ ]' : '- [x]'); setText(p, ls.join('\n')); const task = t.closest('.task'); if (task) task.classList.toggle('done', /^- \[x\]/.test(ls[i])); },
  tab: (t) => { S.active = +t.dataset.id; refresh(); }, tclose: (t, e) => { e.stopPropagation(); closeTab(+t.dataset.id); }, newtab: () => { newTab(); refresh(); }, closecur: () => closeTab(S.active),
  back: () => go(-1), fwd: () => go(1), mode: toggleMode, reveal: (t) => reveal(t.dataset.p), showbl: () => showSide('right', 'backlinks'),
  nmore: (t, e) => { const p = curNote(); if (!p) return; const bm = S.bookmarks.includes(p); menu(e, [[bm ? 'Retirer des signets' : 'Ajouter aux signets', 'bookmark', () => toggleBm(p)], ['Afficher dans l’explorateur', 'files', () => { if (!shared(p)) reveal(p); else showSide('left', 'files'); }], ['Ouvrir dans un nouvel onglet', 'plus', () => open(p, { newTab: true })], [(S.modes[p] || 'live') === 'live' ? 'Passer en lecture' : 'Passer en édition', 'book', toggleMode], '-', ['Renommer…', 'pencil', () => prompt2('Renommer', 'Nouveau nom', stem(p), (v) => rename(p, v))], ['Supprimer la note', 'trash', () => del(p), true]]); },
  fmore: (t, e) => { const p = cur(); if (FILES.has(p)) fileMenu(p, e); },
  mi: (t) => { const f = MF[+t.dataset.k]; closeMenu(); if (f) f(); },
  mclose: () => closeModal(), pok: () => { if (PO) PO(); }, cok: () => { closeModal(); const f = CO; CO = null; if (f) f(); },
  pick: (t) => pickRun(+t.dataset.k),
  setsec: (t) => { SET = t.dataset.k; setRender(); }, stheme: (t) => { setTheme(t.dataset.t); setRender(); }, sacc: (t) => { S.accent = t.dataset.c; frame(); setRender(); relayout(); },
  sspell: () => { S.spell = !S.spell; setRender(); saveState(); }, sread: () => { S.readable = !S.readable; frame(); setRender(); },
  grecenter: () => { POS.clear(); GK = ''; const g = $('#gcv'); if (g) drawGraph(g, null, false); },
  gctl: () => { S.graph.ctl = !S.graph.ctl; renderView(); }, gtags: () => { S.graph.tags = !S.graph.tags; renderView(); renderRight(); }, gnames: () => { S.graph.names = !S.graph.names; renderView(); saveState(); },
  btool: (t) => { const B = curBoard(); B.tool = t.dataset.t; if (B.tool !== 'select') B.sel = []; bRender(B); },
  bundo: () => { const B = curBoard(); if (!B || !B.undo.length) return; B.redo.push(JSON.stringify(B.els)); B.els = JSON.parse(B.undo.pop()); B.sel = []; bRender(B); saved(B); },
  bredo: () => { const B = curBoard(); if (!B || !B.redo.length) return; B.undo.push(JSON.stringify(B.els)); B.els = JSON.parse(B.redo.pop()); B.sel = []; bRender(B); saved(B); },
  bzi: () => zoomAt(curBoard(), 1.25), bzo: () => zoomAt(curBoard(), 0.8), bz1: () => { const B = curBoard(); zoomAt(B, 1 / B.cam.k); }, bfit: () => fitAll(curBoard()),
  blib: () => libModal(curBoard()), libadd: (t) => { closeModal(); if (LIB) LIB(+t.dataset.k); },
  bcolor: (t) => { const B = curBoard(); pushU(B); B.sel.forEach((id) => { const x = getEl(B, id); if (x && !x.locked) x.color = t.dataset.c; }); bRender(B); },
  bedit: () => { const B = curBoard(); if (B.sel.length) editEl(B, B.sel[0]); },
  bdup: () => { const B = curBoard(); pushU(B); const ns = []; for (const id of B.sel) { const x = getEl(B, id); if (!x) continue; const c = JSON.parse(JSON.stringify(x)); c.id = B.nid++; c.locked = false; if (c.pts) c.pts = c.pts.map(([a, b]) => [a + 32, b + 32]); else { c.x += 32; c.y += 32; } B.els.push(c); ns.push(c.id); freshId = c.id; } B.sel = ns; bRender(B); },
  block: () => { const B = curBoard(); pushU(B); const lk = B.sel.every((id) => getEl(B, id)?.locked); B.sel.forEach((id) => { const x = getEl(B, id); if (x) x.locked = !lk; }); bRender(B); toast(lk ? 'Déverrouillé' : 'Verrouillé'); },
  bdel: () => { const B = curBoard(); const ids = B.sel.filter((id) => !getEl(B, id)?.locked); if (!ids.length) { toast('La sélection est verrouillée.', true); return; } pushU(B); B.els = B.els.filter((x) => !ids.includes(x.id)); B.sel = []; bRender(B); },
  bimport: () => { const fs = [...FILES.keys()].filter((p) => { const f = FILES.get(p); return f.type === 'note' || f.type === 'image'; }).sort((a, b) => stem(a).localeCompare(stem(b))); modal('Importer depuis le coffre', `<div class="mb"><div class="vlist">${fs.map((p) => `<button type="button" class="vitem" data-act="bimp" data-p="${esc(p)}"><b>${esc(stem(p))}</b><small>${FILES.get(p).type === 'image' ? 'Image' : 'Note'} · ${esc(shared(p) ? projectOf(p) : dirOf(p) || 'Racine du coffre')}</small></button>`).join('') || '<div class="pempty">Aucune note ni image dans ce coffre.</div>'}</div></div>`); },
  bimp: (t) => { closeModal(); const B = curBoard(); const p = t.dataset.p; const f = FILES.get(p); const c = viewCenter(B); if (f.type === 'image') addEl(B, { type: 'img', x: Math.round(c.x - 140), y: Math.round(c.y - 90), w: 280, h: 180, text: p.split('/').pop(), src: p }); else { const ex = f.text.split('\n').filter((l) => l.trim() && !/^#/.test(l))[0] || ''; addEl(B, { type: 'note', x: Math.round(c.x - 120), y: Math.round(c.y - 60), w: 240, h: 120, title: stem(p), text: ex.replace(/[[\]*`#]/g, '') }); } toast('Importé dans le moodboard'); },
  blayers: () => { const B = curBoard(); modal('Calques', `<div class="mb">${B.els.slice().reverse().map((x) => `<div class="layer"><span>${esc(NAMES[x.type] || 'Élément')}${x.text || x.title ? ' · ' + esc((x.title || x.text).slice(0, 40)) : ''}</span>${x.locked ? ic('pin', 15) : ''}<button type="button" class="btn sm" data-act="lsel" data-id="${x.id}">Sélectionner</button></div>`).join('') || '<div class="pempty">Le moodboard est vide.</div>'}</div>`); },
  lsel: (t) => { closeModal(); const B = curBoard(); B.sel = [+t.dataset.id]; B.tool = 'select'; bRender(B); },
  bmore: (t, e) => { const B = curBoard(); menu(e, [['Tout afficher', 'collapse', () => fitAll(B)], [B.grid ? 'Masquer la grille' : 'Afficher la grille', 'template', () => { B.grid = !B.grid; saved(B); bRender(B); }], '-', ['Exporter en PDF', 'file', () => exportBoard(B, 'pdf')], ['Exporter en JPG', 'image', () => exportBoard(B, 'jpg')]]); },
};

// Side panels are resized by dragging their edge, in landscape.
function setupResizers() {
  scr.querySelectorAll('.rz').forEach((h) => h.addEventListener('pointerdown', (e) => {
    const side = h.dataset.side; const x0 = e.clientX; const w0 = S[side].w;
    h.classList.add('drag'); document.body.classList.add('resizing'); h.setPointerCapture(e.pointerId);
    let raf = 0; let x = x0;
    const paint = () => { raf = 0; S[side].w = clamp(Math.round(w0 + (x - x0) * (side === 'left' ? 1 : -1)), 200, 460); $(side === 'left' ? '.side.l' : '.side.r').style.setProperty('--w', S[side].w + 'px'); };
    const mv = (ev) => { x = ev.clientX; if (!raf) raf = requestAnimationFrame(paint); };
    const upf = () => { if (raf) { cancelAnimationFrame(raf); paint(); } h.classList.remove('drag'); document.body.classList.remove('resizing'); h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', upf); h.removeEventListener('pointercancel', upf); saveState(); relayout(); };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', upf); h.addEventListener('pointercancel', upf);
  }));
}

// ------------------------------------------------------------------ start
async function start() {
  let saved = null; try { saved = JSON.parse(OS.getState() || 'null'); } catch (_) {}
  if (saved) {
    for (const k of ['theme', 'accent', 'fs', 'readable', 'spell', 'sort', 'tagSort']) if (saved[k] != null) S[k] = saved[k];
    if (saved.left) Object.assign(S.left, saved.left);
    if (saved.right) Object.assign(S.right, saved.right);
    if (saved.graph) Object.assign(S.graph, saved.graph);
    S.per = saved.per || {};
  }
  S.landOpen = { left: S.left.open, right: S.right.open };
  let vaults = []; try { vaults = JSON.parse(OS.vaults()); } catch (_) {}
  if (!vaults.length) { OS.createVault('Opale'); S.vault = 'Opale'; await seedDemo(); }
  else S.vault = saved && vaults.includes(saved.vault) ? saved.vault : vaults[0];
  build(); setupTabDrag(); setupResizers();
  S.orient = innerWidth < 1000 ? 'port' : 'land';
  if (S.orient === 'port') { S.left.open = false; S.right.open = false; }
  OS.setDark(S.theme === 'dark');
  loadVault(); refresh();
}
start().catch((err) => { scr.innerHTML = `<div class="boot">Opale n’a pas pu démarrer : ${esc(err && err.message || err)}</div>`; });
})();
