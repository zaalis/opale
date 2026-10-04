// Opale — what typing in a note does beyond inserting characters: list
// continuation, bracket pairing, formatting shortcuts, link and tag
// completion, pasted and dropped attachments. Used by both the source editor
// and the block being edited in the live view.
import { api, app, fuzzy, h, highlighted, Meta, reportError } from './core.js';
import { store } from './store.js';

// Replace [from, to) and tell listeners, as if the user had typed it.
export function replaceRange(textarea, from, to, text, selectFrom, selectTo) {
  textarea.setRangeText(text, from, to, 'end');
  const start = selectFrom === undefined ? from + text.length : selectFrom;
  textarea.setSelectionRange(start, selectTo === undefined ? start : selectTo);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function lineBounds(value, position) {
  const start = value.lastIndexOf('\n', position - 1) + 1;
  const next = value.indexOf('\n', position);
  return { start, end: next < 0 ? value.length : next };
}

// ---------------------------------------------------------------- formatting
const WRAPS = { bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'], highlight: ['==', '=='], code: ['`', '`'], comment: ['%%', '%%'] };

export function toggleWrap(textarea, left, right = left) {
  const { selectionStart: from, selectionEnd: to, value } = textarea;
  const selected = value.slice(from, to);
  if (value.slice(from - left.length, from) === left && value.slice(to, to + right.length) === right) {
    textarea.setRangeText(selected, from - left.length, to + right.length, 'preserve');
    textarea.setSelectionRange(from - left.length, to - left.length);
  } else if (selected.length >= left.length + right.length && selected.startsWith(left) && selected.endsWith(right)) {
    const inner = selected.slice(left.length, selected.length - right.length);
    textarea.setRangeText(inner, from, to, 'preserve');
    textarea.setSelectionRange(from, from + inner.length);
  } else {
    textarea.setRangeText(left + selected + right, from, to, 'preserve');
    textarea.setSelectionRange(from + left.length, to + left.length);
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertLink(textarea) {
  const { selectionStart: from, selectionEnd: to, value } = textarea;
  const selected = value.slice(from, to);
  if (/^https?:\/\/\S+$/.test(selected)) replaceRange(textarea, from, to, `[](${selected})`, from + 1);
  else replaceRange(textarea, from, to, `[${selected}]()`, from + selected.length + 3);
}

// Prefix handling for the lines touched by the selection.
function eachLine(textarea, change) {
  const { selectionStart, selectionEnd, value } = textarea;
  const from = lineBounds(value, selectionStart).start;
  const to = lineBounds(value, Math.max(selectionStart, selectionEnd - (selectionEnd > selectionStart && value[selectionEnd - 1] === '\n' ? 1 : 0))).end;
  const lines = value.slice(from, to).split('\n');
  const next = lines.map(change);
  const text = next.join('\n');
  const firstDelta = next[0].length - lines[0].length;
  textarea.setRangeText(text, from, to, 'preserve');
  if (selectionStart === selectionEnd) {
    const caret = Math.max(from, selectionStart + firstDelta);
    textarea.setSelectionRange(caret, caret);
  } else textarea.setSelectionRange(Math.max(from, selectionStart + firstDelta), from + text.length);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function setHeading(textarea, level) {
  eachLine(textarea, (line) => {
    const stripped = line.replace(/^ {0,3}#{1,6}\s+/, '');
    return level ? `${'#'.repeat(level)} ${stripped}` : stripped;
  });
}
function toggleList(textarea, marker) {
  eachLine(textarea, (line) => {
    const match = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?(.*)$/.exec(line);
    const indent = match ? match[1] : /^\s*/.exec(line)[0];
    const body = match ? match[2] : line.slice(indent.length);
    if (match && line.slice(indent.length).startsWith(marker)) return indent + body;
    return `${indent}${marker}${body}`;
  });
}
function toggleTask(textarea) {
  eachLine(textarea, (line) => {
    const task = /^(\s*(?:[-*+]|\d+[.)])\s+)\[(.)\](\s.*)?$/.exec(line);
    if (task) return `${task[1]}[${task[2] === ' ' ? 'x' : ' '}]${task[3] || ' '}`;
    const item = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/.exec(line);
    if (item) return `${item[1]}[ ] ${item[2]}`;
    const indent = /^\s*/.exec(line)[0];
    return `${indent}- [ ] ${line.slice(indent.length)}`;
  });
}
function indentLines(textarea, outdent) {
  eachLine(textarea, (line) => (outdent ? line.replace(/^(\t| {1,4})/, '') : `\t${line}`));
}

export const FORMATS = {
  bold: (textarea) => toggleWrap(textarea, ...WRAPS.bold),
  italic: (textarea) => toggleWrap(textarea, ...WRAPS.italic),
  strike: (textarea) => toggleWrap(textarea, ...WRAPS.strike),
  highlight: (textarea) => toggleWrap(textarea, ...WRAPS.highlight),
  code: (textarea) => toggleWrap(textarea, ...WRAPS.code),
  comment: (textarea) => toggleWrap(textarea, ...WRAPS.comment),
  link: insertLink,
  wikilink: (textarea) => { const { selectionStart: from, selectionEnd: to, value } = textarea; replaceRange(textarea, from, to, `[[${value.slice(from, to)}]]`, from + 2, to + 2); },
  task: toggleTask,
  bullet: (textarea) => toggleList(textarea, '- '),
  numbered: (textarea) => toggleList(textarea, '1. '),
  quote: (textarea) => toggleList(textarea, '> '),
  h1: (textarea) => setHeading(textarea, 1), h2: (textarea) => setHeading(textarea, 2), h3: (textarea) => setHeading(textarea, 3),
  h4: (textarea) => setHeading(textarea, 4), h5: (textarea) => setHeading(textarea, 5), h6: (textarea) => setHeading(textarea, 6),
  paragraph: (textarea) => setHeading(textarea, 0),
  indent: (textarea) => indentLines(textarea, false),
  outdent: (textarea) => indentLines(textarea, true),
};

// ------------------------------------------------------------------- typing
const PAIRS = { '[': ']', '(': ')', '{': '}' };
const WRAP_KEYS = { '*': '*', _: '_', '`': '`', '=': '=', '~': '~', '"': '"', $: '$', '[': ']', '(': ')', '{': '}' };

function handleEnter(textarea) {
  const { selectionStart: position, selectionEnd, value } = textarea;
  if (position !== selectionEnd) return false;
  const { start, end } = lineBounds(value, position);
  const line = value.slice(start, end);
  const item = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[.\]\s+)?(.*)$/.exec(line);
  if (item) {
    const [, indent, marker, number, delimiter, gap, task, body] = item;
    if (!body.trim() && position === end) {
      // Enter on an empty item leaves the list, one level at a time.
      const outdented = indent.replace(/(\t| {1,4})$/, '');
      replaceRange(textarea, start, end, indent ? `${outdented}${marker}${gap}${task || ''}` : '');
      return true;
    }
    if (position < start + indent.length + marker.length + gap.length) return false;
    const next = number ? `${Number(number) + 1}${delimiter}` : marker;
    replaceRange(textarea, position, position, `\n${indent}${next}${gap}${task ? '[ ] ' : ''}`);
    return true;
  }
  const quote = /^(\s*(?:>\s?)+)(.*)$/.exec(line);
  if (quote) {
    if (!quote[2].trim() && position === end) { replaceRange(textarea, start, end, ''); return true; }
    replaceRange(textarea, position, position, `\n${quote[1]}`);
    return true;
  }
  return false;
}

function handleChar(textarea, key) {
  const { selectionStart: from, selectionEnd: to, value } = textarea;
  if (from !== to && WRAP_KEYS[key]) {
    textarea.setRangeText(key + value.slice(from, to) + WRAP_KEYS[key], from, to, 'preserve');
    textarea.setSelectionRange(from + 1, to + 1);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  if (from !== to) return false;
  const next = value[from] || '';
  if ((key === ']' || key === ')' || key === '}') && next === key) { textarea.setSelectionRange(from + 1, from + 1); return true; }
  if (PAIRS[key] && !/[\p{L}\p{N}]/u.test(next)) { replaceRange(textarea, from, from, key + PAIRS[key], from + 1); return true; }
  return false;
}

function handleBackspace(textarea) {
  const { selectionStart: from, selectionEnd: to, value } = textarea;
  if (from !== to || from === 0) return false;
  const before = value[from - 1];
  if (PAIRS[before] && value[from] === PAIRS[before]) { replaceRange(textarea, from - 1, from + 1, ''); return true; }
  return false;
}

// -------------------------------------------------------------- attachments
// `targetFolder` is deliberately optional: note attachments follow the vault
// setting, whereas an image created from the file explorer belongs exactly in
// the folder the user selected.
export async function uploadFile(file, sourcePath, targetFolder = '') {
  let name = file.name && file.name !== 'image.png' ? file.name : '';
  if (!name) {
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png';
    name = `Image collée ${Meta.formatDate(new Date(), 'YYYYMMDDHHmmss')}.${ext}`;
  }
  name = name.replace(/[<>:"|?*\\/\u0000-\u001f]/g, '-').replace(/^\.+/, '').replace(/[. ]+$/, '') || 'Fichier';
  const result = await api(`/api/file?name=${encodeURIComponent(name)}&source=${encodeURIComponent(sourcePath || '')}&folder=${encodeURIComponent(targetFolder || '')}`, { method: 'PUT', body: file, raw: true });
  return result.path;
}

// Width of a picture as it was taken, read before it is sent so that a small
// image is never blown up to the default size.
function naturalWidth(file) {
  return new Promise((resolve) => {
    if (!file || typeof Image === 'undefined') { resolve(0); return; }
    const url = URL.createObjectURL(file); const img = new Image();
    let settled = false;
    const done = (value) => { if (settled) return; settled = true; URL.revokeObjectURL(url); resolve(value); };
    img.onload = () => done(img.naturalWidth || 0);
    img.onerror = () => done(0);
    setTimeout(() => done(0), 4000);
    img.src = url;
  });
}

// What to write in the note for an uploaded file. An image gets the preset
// width (Settings → Files), or its own width when it is smaller.
export async function embedFor(path, file) {
  const kind = Meta.kindOf(path); const name = Meta.baseName(path);
  if (!['image', 'audio', 'video', 'pdf'].includes(kind)) return `[[${name}]]`;
  if (kind !== 'image') return `![[${name}]]`;
  const preset = Number(app.settings.imageWidth ?? 400) || 0;
  if (!preset) return `![[${name}]]`;
  const natural = await naturalWidth(file);
  return `![[${name}|${natural ? Math.min(natural, preset) : preset}]]`;
}

async function insertFiles(textarea, files, sourcePath) {
  for (const file of files) {
    try {
      const path = await uploadFile(file, sourcePath);
      const embed = await embedFor(path, file);
      // In the line where the caret is, spaced from the words around it.
      const { selectionStart: from, selectionEnd: to, value } = textarea;
      const left = from > 0 && !/\s/.test(value[from - 1]) ? ' ' : '';
      const right = to < value.length && !/\s/.test(value[to]) ? ' ' : '';
      replaceRange(textarea, from, to, left + embed + right);
    } catch (error) { reportError(error); }
  }
}

// ----------------------------------------------------------------- suggest
// Pixel position of a character inside a textarea, measured on a mirror.
export function caretPoint(textarea, position) {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'boxSizing', 'tabSize', 'textIndent', 'wordSpacing']) mirror.style[property] = style[property];
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: `${textarea.clientWidth}px`, top: '0', left: '-9999px' });
  mirror.textContent = textarea.value.slice(0, position);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.append(marker);
  document.body.append(mirror);
  const rect = textarea.getBoundingClientRect();
  const point = { x: rect.left + marker.offsetLeft - textarea.scrollLeft, y: rect.top + marker.offsetTop - textarea.scrollTop, height: parseFloat(style.lineHeight) || marker.offsetHeight };
  mirror.remove();
  return point;
}

const suggest = { el: null, items: [], index: 0, textarea: null, apply: null };

function closeSuggest() {
  if (suggest.el) { suggest.el.remove(); suggest.el = null; }
  suggest.items = []; suggest.textarea = null;
}

function renderSuggest() {
  const list = suggest.el;
  list.replaceChildren(...suggest.items.map((item, index) => {
    const row = h(`div.suggest-item${index === suggest.index ? '.active' : ''}`, { role: 'option', onMousedown: (event) => { event.preventDefault(); suggest.index = index; acceptSuggest(); } },
      h('span.suggest-title', item.ranges ? highlighted(item.label, item.ranges) : item.label), item.detail ? h('span.suggest-detail', item.detail) : null);
    return row;
  }));
  const active = list.querySelector('.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function acceptSuggest() {
  const item = suggest.items[suggest.index]; const textarea = suggest.textarea;
  if (!item || !textarea) return;
  const apply = suggest.apply;
  closeSuggest();
  apply(item);
  textarea.focus();
}

function showSuggest(textarea, anchor, items, apply) {
  if (!items.length) return closeSuggest();
  if (!suggest.el) { suggest.el = h('div.suggest', { role: 'listbox' }); document.body.append(suggest.el); }
  if (suggest.textarea !== textarea || suggest.items.length !== items.length) suggest.index = 0;
  suggest.index = Math.min(suggest.index, items.length - 1);
  suggest.items = items; suggest.textarea = textarea; suggest.apply = apply;
  renderSuggest();
  const point = caretPoint(textarea, anchor);
  const rect = suggest.el.getBoundingClientRect();
  const below = point.y + point.height + 4;
  suggest.el.style.left = `${Math.max(8, Math.min(point.x, window.innerWidth - rect.width - 8))}px`;
  suggest.el.style.top = `${below + rect.height > window.innerHeight - 8 ? Math.max(8, point.y - rect.height - 4) : below}px`;
}

function updateSuggest(textarea) {
  const { selectionStart: position, selectionEnd, value } = textarea;
  if (position !== selectionEnd) return closeSuggest();
  const { start } = lineBounds(value, position);
  const before = value.slice(start, position);

  const open = before.lastIndexOf('[[');
  if (open >= 0 && before.indexOf(']]', open) < 0) {
    const query = before.slice(open + 2);
    if (query.includes('|')) return closeSuggest();
    const from = start + open;
    const closing = value.slice(position, position + 2) === ']]' ? 2 : 0;
    const insert = (target) => replaceRange(textarea, from, position + closing, `[[${target}]]`);
    const hash = query.indexOf('#');
    if (hash >= 0) {
      // "[[Note#" completes with the headings of that note.
      const note = store.resolve(query.slice(0, hash), textarea.dataset.notePath);
      const entry = note && store.files.get(note);
      const wanted = query.slice(hash + 1);
      const headings = ((entry && entry.meta && entry.meta.headings) || [])
        .map((heading) => ({ heading, match: fuzzy(wanted, heading.text) })).filter((item) => item.match)
        .sort((a, b) => b.match.score - a.match.score).slice(0, 12)
        .map((item) => ({ label: item.heading.text, ranges: item.match.ranges, detail: `H${item.heading.level}`, target: `${query.slice(0, hash)}#${item.heading.text}` }));
      return showSuggest(textarea, from, headings, (item) => insert(item.target));
    }
    const candidates = [];
    for (const entry of store.files.values()) {
      const name = entry.kind === 'note' ? Meta.stem(entry.path) : Meta.baseName(entry.path);
      const match = fuzzy(query, name);
      if (match) candidates.push({ label: name, ranges: match.ranges, detail: Meta.dirName(entry.path), score: match.score + (entry.kind === 'note' ? 50 : 0), target: store.linkText(entry.path) });
      for (const alias of (entry.meta && entry.meta.aliases) || []) {
        const aliasMatch = fuzzy(query, alias);
        if (aliasMatch) candidates.push({ label: alias, ranges: aliasMatch.ranges, detail: `alias de ${name}`, score: aliasMatch.score, target: `${store.linkText(entry.path)}|${alias}` });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const items = candidates.slice(0, 12);
    if (query.trim() && !items.some((item) => item.label.toLowerCase() === query.trim().toLowerCase())) items.push({ label: query.trim(), detail: 'Nouvelle note', target: query.trim() });
    return showSuggest(textarea, from, items, (item) => insert(item.target));
  }

  const tag = /(^|\s)#([\p{L}\p{N}_\-\/]+)$/u.exec(before);
  if (tag) {
    const query = tag[2]; const from = position - query.length - 1;
    const items = store.tags().map((item) => ({ item, match: fuzzy(query, item.tag) })).filter((entry) => entry.match && entry.item.tag.toLowerCase() !== query.toLowerCase())
      .sort((a, b) => (b.match.score + b.item.count) - (a.match.score + a.item.count)).slice(0, 10)
      .map((entry) => ({ label: `#${entry.item.tag}`, detail: String(entry.item.count), tag: entry.item.tag }));
    return showSuggest(textarea, from, items, (item) => replaceRange(textarea, from, position, `#${item.tag} `));
  }
  return closeSuggest();
}

function suggestKey(event) {
  if (!suggest.el) return false;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    suggest.index = (suggest.index + (event.key === 'ArrowDown' ? 1 : suggest.items.length - 1)) % suggest.items.length;
    renderSuggest(); return true;
  }
  if (event.key === 'Enter' || event.key === 'Tab') { acceptSuggest(); return true; }
  if (event.key === 'Escape') { closeSuggest(); return true; }
  return false;
}

// ------------------------------------------------------------------ attach
const HOTKEYS = { b: 'bold', i: 'italic', k: 'link', l: 'task' };

export function attachEditing(textarea, notePath) {
  textarea.dataset.notePath = notePath || '';
  textarea.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (suggestKey(event)) { event.preventDefault(); event.stopPropagation(); return; }
    // AltGr reports as Ctrl+Alt on Windows: shortcuts need Ctrl without Alt.
    const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey;
    if (shortcut) {
      const key = event.key.toLowerCase();
      if (!event.shiftKey && HOTKEYS[key]) { event.preventDefault(); FORMATS[HOTKEYS[key]](textarea); return; }
      if (event.shiftKey && key === 'x') { event.preventDefault(); FORMATS.strike(textarea); return; }
      if (event.shiftKey && key === 'h') { event.preventDefault(); FORMATS.highlight(textarea); return; }
      if (key === ']') { event.preventDefault(); FORMATS.indent(textarea); return; }
      if (key === '[') { event.preventDefault(); FORMATS.outdent(textarea); return; }
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) { if (handleEnter(textarea)) event.preventDefault(); return; }
    if (event.key === 'Tab') {
      event.preventDefault();
      const { selectionStart, selectionEnd, value } = textarea;
      const line = value.slice(lineBounds(value, selectionStart).start, lineBounds(value, selectionStart).end);
      if (event.shiftKey) FORMATS.outdent(textarea);
      else if (selectionStart !== selectionEnd || /^\s*([-*+]|\d+[.)])\s/.test(line)) FORMATS.indent(textarea);
      else replaceRange(textarea, selectionStart, selectionEnd, '\t');
      return;
    }
    if (event.key === 'Backspace') { if (handleBackspace(textarea)) event.preventDefault(); return; }
    if (event.key.length === 1 && handleChar(textarea, event.key)) event.preventDefault();
  });
  textarea.addEventListener('input', () => updateSuggest(textarea));
  textarea.addEventListener('click', () => closeSuggest());
  textarea.addEventListener('blur', () => setTimeout(() => { if (suggest.textarea === textarea) closeSuggest(); }, 120));
  textarea.addEventListener('paste', (event) => {
    const data = event.clipboardData;
    if (!data) return;
    const files = [...data.files];
    if (files.length) { event.preventDefault(); insertFiles(textarea, files, textarea.dataset.notePath); return; }
    const text = data.getData('text/plain');
    const { selectionStart: from, selectionEnd: to, value } = textarea;
    if (from !== to && /^https?:\/\/\S+$/.test(text.trim()) && !/^https?:\/\//.test(value.slice(from, to))) {
      event.preventDefault();
      replaceRange(textarea, from, to, `[${value.slice(from, to)}](${text.trim()})`);
    }
  });
  textarea.addEventListener('dragover', (event) => { if (event.dataTransfer && [...event.dataTransfer.types].includes('Files')) event.preventDefault(); });
  textarea.addEventListener('drop', (event) => {
    const files = event.dataTransfer ? [...event.dataTransfer.files] : [];
    if (!files.length) return;
    event.preventDefault();
    insertFiles(textarea, files, textarea.dataset.notePath);
  });
}

export { closeSuggest };
