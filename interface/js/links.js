// Opale — links and embeds seen as whole objects. A picture written in the
// text never shows its Markdown while the text around it is edited: it stands
// as one symbol the caret steps over. A link or a picture whose target is
// missing gets a small red dot; clicking the dot opens a little window to point
// it at the right file.
import { app, fuzzy, h, highlighted, icon, Markdown, Meta, toast } from './core.js';
import { store } from './store.js';
import { keys } from './platform.js';

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const REMOTE = /^(https?:|data:)/i;
function safeDecode(value) { try { return decodeURIComponent(value); } catch { return value; } }
const blank = (match) => ' '.repeat(match.length);

// What stands for an embed in the block being typed in.
export const PICTURE = '\u{1F5BC}';
export const ATTACHMENT = '\u{1F4CE}';

// Code, comments and escaped characters never hold a link: hide them first,
// keeping every offset where it was.
function mask(text) {
  return text
    .replace(/(`+)(?!`)([^]*?[^`])\1(?!`)/g, blank)
    .replace(/%%[^]*?%%/g, blank)
    .replace(/\\[\\`*_{}\[\]()#+\-.!~=<>$%^&"']/g, blank);
}

// Every link written in `text`, in the order the renderer reads them:
// wikilinks and embeds first, then Markdown images, then Markdown links.
//   kind    wikilink | embed | image-md | link-md
//   target  what the renderer resolves (and puts in data-href)
//   local   false for web addresses and other schemes
export function findLinks(text) {
  let masked = mask(text);
  const found = [];
  const take = (pattern, make) => {
    const hits = [];
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(masked))) hits.push(make(match));
    for (const hit of hits) masked = masked.slice(0, hit.start) + ' '.repeat(hit.end - hit.start) + masked.slice(hit.end);
    found.push(...hits);
  };
  take(/(!?)\[\[([^\[\]\n]+?)\]\]/g, (match) => {
    const start = match.index; const end = start + match[0].length;
    const innerStart = start + match[1].length + 2;
    const parsed = Meta.parseWikiInner(text.slice(innerStart, end - 2));
    return { start, end, raw: text.slice(start, end), kind: match[1] ? 'embed' : 'wikilink', target: parsed.target, local: true, targetStart: innerStart, targetEnd: innerStart + parsed.target.length };
  });
  const markdown = (bang) => new RegExp(`${bang ? '!' : ''}\\[([^\\]\\n]*)\\]\\(\\s*<?([^)\\s>]+)>?(?:\\s+"[^"\\n]*")?\\s*\\)`, 'g');
  const urlSpan = (match) => {
    const at = match.index + match[0].indexOf(match[2], match[0].indexOf('](') + 2);
    return { urlStart: at, urlEnd: at + match[2].length, url: match[2] };
  };
  take(markdown(true), (match) => {
    const span = urlSpan(match);
    const local = !SCHEME.test(span.url);
    return { start: match.index, end: match.index + match[0].length, raw: text.slice(match.index, match.index + match[0].length), kind: 'image-md', target: safeDecode(span.url.split('#')[0]), local: local && !REMOTE.test(span.url), ...span };
  });
  take(/\[([^\[\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g, (match) => {
    const span = urlSpan(match);
    const hash = span.url.indexOf('#');
    return { start: match.index, end: match.index + match[0].length, raw: text.slice(match.index, match.index + match[0].length), kind: 'link-md', label: match[1], target: Meta.notePathWithoutExt(safeDecode(hash >= 0 ? span.url.slice(0, hash) : span.url)), local: !SCHEME.test(span.url), ...span };
  });
  return found.sort((a, b) => a.start - b.start);
}

export const isEmbed = (link) => link.kind === 'embed' || link.kind === 'image-md';
export function findEmbeds(text) { return findLinks(text).filter(isEmbed); }

// ------------------------------------------------------- typed text mapping
// The text shown while a block is typed in: each embed becomes one symbol.
// `keepAt` leaves the embed holding the caret as text, so one being written
// by hand ("![[pho…") is not swallowed before it is finished.
export function displayOf(source, notePath, keepAt = -1) {
  const spans = [];
  let text = ''; let from = 0;
  for (const embed of findEmbeds(source)) {
    if (keepAt > embed.start && keepAt < embed.end) continue;
    const path = embed.local ? store.resolve(embed.target, notePath) : null;
    const picture = embed.kind === 'image-md' ? !embed.local || !path || Meta.kindOf(path) === 'image' : !path || Meta.kindOf(path) === 'image' || Meta.kindOf(embed.target) === 'image';
    const symbol = picture ? PICTURE : ATTACHMENT;
    text += source.slice(from, embed.start);
    spans.push({ at: text.length, raw: embed.raw, symbol });
    text += symbol;
    from = embed.end;
  }
  text += source.slice(from);
  return { text, spans };
}

// Back from the shown text to the Markdown. A symbol that no longer sits
// where it was recorded (cannot happen through typing) is dropped.
export function sourceOf(text, spans) {
  let out = ''; let from = 0;
  for (const span of spans) {
    if (text.slice(span.at, span.at + span.symbol.length) !== span.symbol) continue;
    out += text.slice(from, span.at) + span.raw;
    from = span.at + span.symbol.length;
  }
  return out + text.slice(from);
}

export function toShown(spans, offset) {
  let shift = 0;
  for (const span of spans) {
    const start = span.at + shift;
    if (offset <= start) break;
    if (offset < start + span.raw.length) return span.at + span.symbol.length;
    shift += span.raw.length - span.symbol.length;
  }
  return offset - shift;
}

export function toSource(spans, offset) {
  let shift = 0;
  for (const span of spans) {
    if (span.at >= offset) break;
    shift += span.raw.length - span.symbol.length;
  }
  return offset + shift;
}

// After an edit of the shown text, the symbols that survive it: those before
// and after the changed stretch keep their embed, those inside it are gone.
export function followEdit(before, after, spans) {
  let head = 0;
  const limit = Math.min(before.length, after.length);
  while (head < limit && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < limit - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const delta = after.length - before.length;
  const kept = [];
  for (const span of spans) {
    if (span.at + span.symbol.length <= head) kept.push(span);
    else if (span.at >= before.length - tail) kept.push({ ...span, at: span.at + delta });
  }
  return kept;
}

// --------------------------------------------------------------- repairing
const BROKEN = 'a.internal-link.is-unresolved, .embed-missing, img.embed-image.is-broken';
const own = (el) => !el.closest('[data-embed-path], .hover-preview') && !(el.matches('a') && el.closest('.embed-missing'));
const keyOf = (el) => (el.matches('img') ? el.dataset.path || '' : el.matches('.embed-missing') ? (el.dataset.href ?? (el.querySelector('a') || el).dataset.href ?? '') : el.dataset.href || '');

// A link written without an extension points at a note.
const kindOfTarget = (target) => (Meta.extOf(target) ? Meta.kindOf(target) : 'note');

function escapeUrl(value) { return value.replace(/[ ()<>%]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`); }

export class LinkDoctor {
  constructor(view) {
    this.view = view;
    this.popover = null;
    this.outside = (event) => { if (this.popover && !this.popover.contains(event.target) && !event.target.closest('.broken-dot')) this.close(); };
    this.keys = (event) => { if (event.key === 'Escape' && this.popover) { event.preventDefault(); event.stopPropagation(); this.close(); } };
  }

  // A red dot next to everything broken in the note's own text.
  decorate(root) {
    for (const el of root.querySelectorAll(BROKEN)) if (own(el)) this.mark(el);
  }

  mark(el) {
    if (el.dataset.brokenMarked) return;
    el.dataset.brokenMarked = '1';
    el.classList.add('is-broken-link');
    const image = el.matches('img') || el.matches('.embed-missing');
    const dot = h('button.broken-dot', {
      type: 'button', tabIndex: -1, contentEditable: 'false',
      title: image ? 'Image introuvable — cliquer pour réparer' : 'Lien cassé — cliquer pour réparer',
      'aria-label': image ? 'Réparer l’image' : 'Réparer le lien',
      onMousedown: (event) => { event.preventDefault(); event.stopPropagation(); },
      onClick: (event) => { event.preventDefault(); event.stopPropagation(); this.open(el, dot); },
    });
    if (el.matches('img')) {
      // A picture cannot hold the dot: lay it on the picture's corner.
      dot.classList.add('on-image');
      el.after(dot);
      const place = () => { dot.style.left = `${el.offsetLeft + el.offsetWidth - 9}px`; dot.style.top = `${el.offsetTop - 5}px`; };
      place();
      requestAnimationFrame(place);
    } else el.append(dot);
  }

  // Where the broken element is written: the k-th link with the same target
  // in its block (live view) or in the whole note (reading view).
  locate(el) {
    const view = this.view;
    let base = 0; let source = view.content; let scope = view.body;
    const blockEl = view.mode === 'live' ? el.closest('.lp-block') : null;
    if (blockEl) {
      const block = view.blocks[Number(blockEl.dataset.index)];
      if (!block) return null;
      const lines = view.lines();
      for (let i = 0; i < block.start; i++) base += lines[i].length + 1;
      source = lines.slice(block.start, block.end + 1).join('\n');
      scope = blockEl;
    }
    const key = keyOf(el);
    const picture = el.matches('img');
    const siblings = [...scope.querySelectorAll(BROKEN)].filter((item) => own(item) && item.matches('img') === picture && keyOf(item) === key);
    const k = siblings.indexOf(el);
    const links = findLinks(source).filter((link) => link.local && (picture
      ? isEmbed(link) && store.resolve(link.target, view.path) === key
      : link.target === key && !store.resolve(link.target, view.path)));
    const link = links[k] || links[0];
    return link ? { ...link, base } : null;
  }

  open(el, anchor) {
    const link = this.locate(el);
    if (!link) { this.close(); toast('Ce lien ne peut pas être réparé ici : passez en mode source.'); return; }
    this.openFor(link, anchor, { image: el.matches('img') });
  }

  // The small window for one link ({ ...findLinks() item, base }).
  // options.title / options.text replace the "broken" wording.
  openFor(link, anchor, options = {}) {
    this.close();
    const view = this.view;
    const picture = isEmbed(link);
    const wantImage = kindOfTarget(link.target) === 'image' || !!options.image;
    const input = h('input.text-input.small', { type: 'text', spellcheck: false, placeholder: 'Chercher un fichier du coffre…', 'aria-label': 'Chercher le bon fichier' });
    const list = h('div.link-fix-list', { role: 'listbox' });
    let shown = []; let index = 0;
    const pool = [...store.files.values()].filter((entry) => (wantImage ? entry.kind === 'image' : kindOfTarget(link.target) === 'note' ? entry.kind === 'note' : true));
    const draw = () => {
      const query = input.value.trim();
      const scored = [];
      for (const entry of pool) {
        const name = entry.kind === 'note' ? Meta.stem(entry.path) : Meta.baseName(entry.path);
        const hit = query ? fuzzy(query, name) : { score: entry.mtime || 0, ranges: [] };
        if (hit) scored.push({ entry, name, ...hit });
      }
      shown = scored.sort((a, b) => b.score - a.score).slice(0, 6);
      index = Math.min(index, Math.max(0, shown.length - 1));
      list.replaceChildren(...(shown.length ? shown.map((item, at) => h(`button.link-fix-item${at === index ? '.active' : ''}`, {
        type: 'button', role: 'option',
        onMousemove: () => { if (index !== at) { index = at; mark(); } },
        onClick: () => this.apply(link, item.entry.path),
      }, h('span.link-fix-icon', { html: icon(item.entry.kind === 'image' ? 'image' : 'file', 14) }), h('span.link-fix-name', highlighted(item.name, item.ranges)), h('span.link-fix-folder', Meta.dirName(item.entry.path) || '/')))
        : [h('div.link-fix-empty', 'Aucun fichier ne correspond.')]));
    };
    const mark = () => [...list.children].forEach((child, at) => child.classList.toggle('active', at === index));
    input.addEventListener('input', () => { index = 0; draw(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (shown.length) { index = (index + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length; mark(); } }
      else if (event.key === 'Enter') { event.preventDefault(); if (shown[index]) this.apply(link, shown[index].entry.path); }
    });
    const actions = [];
    if (!options.title && kindOfTarget(link.target) === 'note') actions.push(h('button.btn.small', { type: 'button', onClick: () => { this.close(); app.workspace.openLink({ target: link.target, source: view.path, view }); } }, 'Créer la note'));
    actions.push(h('button.btn.small.danger', { type: 'button', onClick: () => this.unlink(link) }, wantImage ? 'Retirer l’image' : picture ? 'Retirer l’intégration' : 'Retirer le lien'));
    const title = options.title || (wantImage ? 'Image introuvable' : 'Lien cassé');
    this.popover = h(`div.link-fix${options.title ? '.is-edit' : ''}`, { role: 'dialog', 'aria-label': title },
      h('div.link-fix-head', h('span.link-fix-badge'), h('span.link-fix-title', title),
        h('button.icon-btn.link-fix-close', { type: 'button', title: 'Fermer (Échap)', 'aria-label': 'Fermer', html: icon('x', 14), onClick: () => this.close() })),
      options.text ? h('p.link-fix-text', options.text)
        : h('p.link-fix-text', '« ', h('code', link.target || link.raw), wantImage ? ' » n’existe pas dans le coffre. Choisissez le bon fichier :' : ' » ne mène à aucune note. Choisissez la bonne :'),
      input, list, h('div.link-fix-actions', actions));
    document.body.append(this.popover);
    input.value = options.title ? '' : kindOfTarget(link.target) === 'note' ? Meta.baseName(link.target) : Meta.baseName(link.target).replace(/\.[^.]+$/, '');
    draw();
    if (!shown.length) { input.value = ''; draw(); }
    const rect = anchor.getBoundingClientRect(); const box = this.popover.getBoundingClientRect();
    const below = rect.bottom + 8;
    this.popover.style.left = `${Math.max(8, Math.min(rect.left - 18, window.innerWidth - box.width - 8))}px`;
    this.popover.style.top = `${below + box.height > window.innerHeight - 8 ? Math.max(8, rect.top - box.height - 8) : below}px`;
    this.popover.style.transformOrigin = `${Math.max(0, rect.left - parseFloat(this.popover.style.left))}px ${below + box.height > window.innerHeight - 8 ? '100%' : '0'}`;
    requestAnimationFrame(() => { if (this.popover) this.popover.classList.add('is-open'); });
    input.focus(); input.select();
    document.addEventListener('mousedown', this.outside, true);
    document.addEventListener('keydown', this.keys, true);
  }

  close() {
    const popover = this.popover;
    if (!popover) return;
    this.popover = null;
    document.removeEventListener('mousedown', this.outside, true);
    document.removeEventListener('keydown', this.keys, true);
    popover.classList.remove('is-open');
    setTimeout(() => popover.remove(), 160);
  }

  // Point the link at `path`, keeping its section, its text and its options.
  apply(link, path) {
    const view = this.view;
    let raw;
    if (link.kind === 'wikilink' || link.kind === 'embed') {
      raw = link.raw.slice(0, link.targetStart - link.start) + store.linkText(path) + link.raw.slice(link.targetEnd - link.start);
    } else {
      const hash = link.url.indexOf('#');
      raw = link.raw.slice(0, link.urlStart - link.start) + escapeUrl(path) + (hash >= 0 ? link.url.slice(hash) : '') + link.raw.slice(link.urlEnd - link.start);
    }
    const fixed = !store.resolve(link.target, view.path);
    this.replace(link, raw);
    const name = Meta.kindOf(path) === 'note' ? Meta.stem(path) : Meta.baseName(path);
    toast(fixed ? `Lien réparé : « ${name} »` : `Image remplacée par « ${name} »`);
  }

  unlink(link) {
    const view = this.view;
    const start = link.base + link.start; const end = link.base + link.end;
    if (isEmbed(link)) {
      this.close();
      view.setContent(Markdown.removeSpan(view.content, start, end), { step: true });
      view.redraw();
      toast(keys('Image retirée de la note (Ctrl+Z pour annuler).'));
      return;
    }
    const alias = link.kind === 'wikilink' ? Meta.parseWikiInner(link.raw.slice(2, -2)).alias : link.label;
    this.replace(link, alias || link.target);
  }

  replace(link, raw) {
    const view = this.view;
    this.close();
    const start = link.base + link.start; const end = link.base + link.end;
    view.setContent(view.content.slice(0, start) + raw + view.content.slice(end), { step: true });
    view.redraw();
  }
}
