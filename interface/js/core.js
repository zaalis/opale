// Opale — shared building blocks of the interface: DOM helpers, icons, the
// server API, a small event bus, toasts, dialogs and menus.
export const Meta = window.OpaleMeta;
export const Markdown = window.OpaleMarkdown;

// Modules register themselves here (app.workspace, app.explorer…) so they can
// call each other without importing each other.
export const app = { settings: {}, vault: null, bookmarks: [], agent: {} };

// ------------------------------------------------------------------- icons
const ICONS = {
  files: '<path d="M4 5a2 2 0 0 1 2-2h4l2 3h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  'file-plus': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M12 12v6M9 15h6"/>',
  'folder-plus': '<path d="M4 5a2 2 0 0 1 2-2h4l2 3h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M12 10v6M9 13h6"/>',
  folder: '<path d="M4 5a2 2 0 0 1 2-2h4l2 3h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4Z"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8Z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  graph: '<circle cx="6" cy="7" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="12" cy="17" r="2.8"/><path d="m7.6 8.8 3 5.8M16.6 8 13.6 14.5M8.4 6.8l7.2-.6"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  template: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 9v11"/>',
  command: '<path d="m6 8 4 4-4 4M13 16h5"/><rect x="3" y="4" width="18" height="16" rx="2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.2-1.3L14 3h-4l-.4 2.4a7 7 0 0 0-2.2 1.3l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .9.1 1.3l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.2 1.3L10 21h4l.4-2.4a7 7 0 0 0 2.2-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3Z"/>',
  vault: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5V7M12 17v-1.5M15.5 12H17M7 12h1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  forward: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h6v16H6a2 2 0 0 0-2 2Z"/><path d="M20 5a2 2 0 0 0-2-2h-6v16h6a2 2 0 0 1 2 2Z"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  code: '<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  'link-in': '<path d="M9 7H6a5 5 0 0 0 0 10h3M15 7h3a5 5 0 0 1 0 10h-3M8 12h8"/>',
  'link-out': '<path d="M14 5h5v5M19 5l-8 8"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>',
  outline: '<path d="M4 6h16M8 12h12M12 18h8"/>',
  'sidebar-left': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  'sidebar-right': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  sort: '<path d="M4 7h10M4 12h7M4 17h4M17 6v12M14 15l3 3 3-3"/>',
  collapse: '<path d="m7 9 5-5 5 5M7 15l5 5 5-5"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h.01M15 15h.01M15 9h.01M9 15h.01M12 12h.01"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7Z"/>',
  external: '<path d="M14 5h5v5M19 5l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 18 5-5 3 3 3-3 3 3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3ZM12 13v7"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/>',
};
export function icon(name, size = 18) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// --------------------------------------------------------------------- DOM
// h('button.btn.primary', { title: 'x', onClick: fn }, 'Label')
export function h(spec, attrs, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null) continue;
    // `false` must be applied, not skipped: spellcheck and draggable default to on.
    if (value === false) { if (key in el && typeof el[key] === 'boolean') el[key] = false; continue; }
    if (key === 'html') el.innerHTML = value;
    else if (key === 'class') el.className = `${el.className} ${value}`.trim();
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && key !== 'list') { try { el[key] = value; } catch { el.setAttribute(key, value); } }
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}
function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}
export function iconButton(name, title, onClick, extra = '') {
  return h(`button.icon-btn${extra}`, { type: 'button', title, 'aria-label': title, html: icon(name), onClick });
}
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export function debounce(fn, delay) {
  let timer = null;
  const wrapped = (...args) => { clearTimeout(timer); timer = setTimeout(() => { timer = null; fn(...args); }, delay); };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; };
  wrapped.flush = (...args) => { if (timer) { clearTimeout(timer); timer = null; fn(...args); } };
  return wrapped;
}

// --------------------------------------------------------------------- bus
const listeners = new Map();
export const bus = {
  on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
  emit(name, payload) { for (const fn of [...(listeners.get(name) || [])]) { try { fn(payload); } catch (error) { console.error(error); } } },
};

// --------------------------------------------------------------------- API
export async function api(route, options = {}) {
  const { method = 'GET', body, raw, keepalive } = options;
  const headers = { 'X-Opale': '1' };
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  const response = await fetch(route, { method, headers, keepalive: !!keepalive, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Erreur ${response.status}`);
    error.status = response.status; error.code = data.code; error.data = data;
    throw error;
  }
  return data;
}
export const fileUrl = (path) => `/api/file?path=${encodeURIComponent(path)}`;

// ------------------------------------------------------------------- toasts
export function toast(message, options = {}) {
  let stack = $('#toasts');
  if (!stack) { stack = h('div', { id: 'toasts' }); document.body.append(stack); }
  const el = h(`div.toast${options.kind ? '.' + options.kind : ''}`, { role: 'status' }, h('span.toast-text', message));
  let timer = null;
  const close = () => { clearTimeout(timer); el.classList.remove('show'); setTimeout(() => el.remove(), 180); };
  if (options.action) el.append(h('button.toast-action', { type: 'button', onClick: () => { close(); options.action.run(); } }, options.action.label));
  stack.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  timer = setTimeout(close, options.duration || (options.action ? 9000 : 4200));
  return close;
}
export function reportError(error) {
  console.error(error);
  toast(error && error.message ? error.message : String(error), { kind: 'error' });
}

// ------------------------------------------------------------------- modals
const modalStack = [];
export function openModal({ title, body, className = '', onClose, footer }) {
  const previous = document.activeElement;
  const dialog = h(`div.modal ${className}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Fenêtre' });
  const backdrop = h('div.modal-backdrop', { onMousedown: (event) => { if (event.target === backdrop) handle.close(); } }, dialog);
  const handle = {
    el: dialog,
    close(result) {
      const at = modalStack.indexOf(handle);
      if (at < 0) return;
      modalStack.splice(at, 1);
      backdrop.classList.remove('is-visible');
      setTimeout(() => backdrop.remove(), 230);
      if (previous && document.contains(previous)) { try { previous.focus({ preventScroll: true }); } catch {} }
      if (onClose) onClose(result);
    },
  };
  if (title) dialog.append(h('div.modal-header', h('h2', title), iconButton('x', 'Fermer', () => handle.close())));
  dialog.append(h('div.modal-body', body));
  if (footer) dialog.append(h('div.modal-footer', footer));
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('is-visible'));
  modalStack.push(handle);
  return handle;
}
export function topModal() { return modalStack[modalStack.length - 1] || null; }

export function promptText({ title, label, value = '', placeholder = '', confirm = 'Valider', validate }) {
  return new Promise((resolve) => {
    let done = false;
    const error = h('p.field-error', { hidden: true });
    const input = h('input.text-input', { type: 'text', value, placeholder, spellcheck: false, 'aria-label': label || title });
    const submit = () => {
      const text = input.value.trim();
      const problem = validate ? validate(text) : (text ? '' : 'Ce champ est requis.');
      if (problem) { error.textContent = problem; error.hidden = false; return; }
      done = true; modal.close(); resolve(text);
    };
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
    const modal = openModal({
      title, className: 'modal-small',
      body: h('div.form', label ? h('label.field-label', label) : null, input, error),
      footer: [h('button.btn', { type: 'button', onClick: () => modal.close() }, 'Annuler'), h('button.btn.primary', { type: 'button', onClick: submit }, confirm)],
      onClose: () => { if (!done) resolve(null); },
    });
    input.focus();
    const dot = value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : value.length);
  });
}

export function confirmDialog({ title, message, confirm = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const ok = h(`button.btn${danger ? '.danger' : '.primary'}`, { type: 'button', onClick: () => { answer = true; modal.close(); } }, confirm);
    const modal = openModal({
      title, className: 'modal-small', body: h('p.modal-text', message),
      footer: [h('button.btn', { type: 'button', onClick: () => modal.close() }, 'Annuler'), ok],
      onClose: () => resolve(answer),
    });
    ok.focus();
  });
}

// -------------------------------------------------------------------- menus
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
// items: { label, icon, run, danger, checked, disabled, hint } or 'separator'
export function showMenu(x, y, items) {
  closeMenu();
  const menu = h('div.menu', { role: 'menu' });
  for (const item of items.filter(Boolean)) {
    if (item === 'separator') { menu.append(h('div.menu-separator')); continue; }
    menu.append(h(`button.menu-item${item.danger ? '.danger' : ''}`, {
      type: 'button', role: 'menuitem', disabled: !!item.disabled,
      onClick: () => { closeMenu(); item.run(); },
    }, h('span.menu-icon', { html: item.checked ? icon('check', 15) : item.icon ? icon(item.icon, 15) : '' }), h('span.menu-label', item.label), item.hint ? h('span.menu-hint', item.hint) : null));
  }
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - rect.width - 6))}px`;
  menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - rect.height - 6))}px`;
  openMenu = menu;
  const first = menu.querySelector('.menu-item:not(:disabled)');
  if (first) first.focus({ preventScroll: true });
  return menu;
}
document.addEventListener('mousedown', (event) => { if (openMenu && !openMenu.contains(event.target)) closeMenu(); }, true);
document.addEventListener('keydown', (event) => {
  if (!openMenu) return;
  if (event.key === 'Escape') { event.stopPropagation(); closeMenu(); return; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const items = $$('.menu-item:not(:disabled)', openMenu);
    const at = items.indexOf(document.activeElement);
    items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  }
}, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

// -------------------------------------------------------------------- fuzzy
// Subsequence match that favours runs and word starts. Returns null when the
// query letters do not all appear in order.
export function fuzzy(query, text) {
  const needle = query.toLowerCase(); const hay = text.toLowerCase();
  if (!needle) return { score: 0, ranges: [] };
  const direct = hay.indexOf(needle);
  if (direct >= 0) {
    const boundary = direct === 0 || /[\s/\-_.]/.test(hay[direct - 1]);
    return { score: 1000 - direct + (boundary ? 200 : 0) - (hay.length - needle.length) * 0.1, ranges: [[direct, direct + needle.length]] };
  }
  let score = 0; let at = 0; let run = 0; const ranges = [];
  for (const ch of needle) {
    if (ch === ' ') continue;
    const found = hay.indexOf(ch, at);
    if (found < 0) return null;
    const boundary = found === 0 || /[\s/\-_.]/.test(hay[found - 1]);
    run = found === at && ranges.length ? run + 1 : 0;
    score += 10 + run * 8 + (boundary ? 12 : 0) - Math.min(found - at, 20) * 0.5;
    if (ranges.length && ranges[ranges.length - 1][1] === found) ranges[ranges.length - 1][1] = found + 1; else ranges.push([found, found + 1]);
    at = found + 1;
  }
  return { score: score - hay.length * 0.05, ranges };
}
export function highlighted(text, ranges) {
  const fragment = document.createDocumentFragment();
  let at = 0;
  for (const [from, to] of ranges || []) {
    if (from > at) fragment.append(text.slice(at, from));
    fragment.append(h('mark.match', text.slice(from, to)));
    at = to;
  }
  if (at < text.length) fragment.append(text.slice(at));
  return fragment;
}

export function noteTitle(path) { return Meta.kindOf(path) === 'note' ? Meta.stem(path) : Meta.baseName(path); }
export function isTextInput(element) {
  return !!element && (element.tagName === 'TEXTAREA' || (element.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range', 'color'].includes(element.type)) || element.isContentEditable);
}
