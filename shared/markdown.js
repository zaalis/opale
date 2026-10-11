// Opale — Markdown renderer (string in, HTML string out, no DOM).
// Covers the vault dialect: wikilinks, embeds, tags, callouts, tasks, tables,
// footnotes, highlights, comments and properties. Raw HTML from a note is
// escaped, apart from a short list of attribute-less inline tags: a note can
// come from anywhere, and the page rendering it can write to the whole vault.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./meta.js'));
  else root.OpaleMarkdown = factory(root.OpaleMeta);
})(typeof self !== 'undefined' ? self : this, function (Meta) {
  'use strict';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESCAPES[c]); }
  const OPEN = ''; const CLOSE = '';

  const EXTERNAL_RE = /^(https?:|mailto:|tel:)/i;
  const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
  function safeDecode(value) { try { return decodeURIComponent(value); } catch { return value; } }

  const CALLOUTS = {
    note: ['Note', 'pencil'], abstract: ['Résumé', 'list'], summary: ['Résumé', 'list'], tldr: ['Résumé', 'list'],
    info: ['Info', 'info'], todo: ['À faire', 'check'], tip: ['Astuce', 'flame'], hint: ['Astuce', 'flame'],
    important: ['Important', 'flame'], success: ['Succès', 'check'], check: ['Succès', 'check'], done: ['Succès', 'check'],
    question: ['Question', 'help'], help: ['Question', 'help'], faq: ['Question', 'help'],
    warning: ['Attention', 'alert'], caution: ['Attention', 'alert'], attention: ['Attention', 'alert'],
    failure: ['Échec', 'cross'], fail: ['Échec', 'cross'], missing: ['Échec', 'cross'],
    danger: ['Danger', 'bolt'], error: ['Erreur', 'bolt'], bug: ['Bug', 'bug'],
    example: ['Exemple', 'list'], quote: ['Citation', 'quote'], cite: ['Citation', 'quote'],
  };
  const CALLOUT_COLOR = {
    note: 'blue', abstract: 'cyan', summary: 'cyan', tldr: 'cyan', info: 'blue', todo: 'blue', tip: 'cyan', hint: 'cyan',
    important: 'cyan', success: 'green', check: 'green', done: 'green', question: 'orange', help: 'orange', faq: 'orange',
    warning: 'orange', caution: 'orange', attention: 'orange', failure: 'red', fail: 'red', missing: 'red',
    danger: 'red', error: 'red', bug: 'red', example: 'purple', quote: 'gray', cite: 'gray',
  };
  const ICONS = {
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9Z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/>',
    alert: '<path d="M12 4 2.5 20h19Z"/><path d="M12 10v4M12 17h.01"/>',
    cross: '<path d="M18 6 6 18M6 6l12 12"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
    bug: '<rect x="8" y="7" width="8" height="12" rx="4"/><path d="M12 7V4M4 13h4M16 13h4M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2"/>',
    quote: '<path d="M7 7H4v6h4v-2c0 3-1 4-3 5M17 7h-3v6h4v-2c0 3-1 4-3 5"/>',
  };
  function icon(name) { return `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.pencil}</svg>`; }

  // ------------------------------------------------------------ highlighting
  const KEYWORDS = {
    js: 'async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while yield interface type enum implements public private protected readonly as',
    py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self',
    rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
    go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
    c: 'auto bool break case catch char class const continue default delete do double else enum extern false float for friend goto if inline int long namespace new null nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef union unsigned using var virtual void volatile while string final override abstract extends implements import package',
    sql: 'select from where and or not insert into values update set delete create table alter drop index view join inner left right outer on as group by order having limit offset union all distinct null is in like between case when then else end primary key foreign references default',
    sh: 'if then else elif fi for while do done case esac function in return exit echo export local readonly set unset cd source',
  };
  const LANG_FAMILY = {
    js: 'js', javascript: 'js', jsx: 'js', ts: 'js', tsx: 'js', typescript: 'js', mjs: 'js', cjs: 'js', json: 'json', jsonc: 'json',
    py: 'py', python: 'py', rs: 'rust', rust: 'rust', go: 'go', golang: 'go',
    c: 'c', h: 'c', cpp: 'c', 'c++': 'c', cs: 'c', csharp: 'c', java: 'c', kotlin: 'c', kt: 'c', swift: 'c', php: 'c', dart: 'c',
    sql: 'sql', sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', powershell: 'sh', ps1: 'sh', bat: 'sh', cmd: 'sh',
    html: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml', css: 'css', scss: 'css', less: 'css',
    yaml: 'yaml', yml: 'yaml', toml: 'yaml', ini: 'yaml', md: 'plain', markdown: 'plain',
  };
  const keywordSets = {};
  function keywordSet(family) {
    if (!keywordSets[family]) keywordSets[family] = new Set((KEYWORDS[family] || '').split(' ').filter(Boolean));
    return keywordSets[family];
  }
  function span(cls, text) { return `<span class="tok-${cls}">${escapeHtml(text)}</span>`; }
  function highlight(code, lang) {
    const family = LANG_FAMILY[String(lang || '').toLowerCase()];
    if (!family || family === 'plain' || code.length > 60000) return escapeHtml(code);
    if (family === 'xml') {
      return code.replace(/(<!--[^]*?-->)|(<\/?[A-Za-z][\w:-]*)|([\w:@-]+)(?==)|("[^"]*"|'[^']*')|(\/?>)|([^<"'>\w]+|\w+|.)/g, (m, comment, tag, attr, str, close) => comment ? span('comment', comment) : tag ? span('keyword', tag) : attr ? span('prop', attr) : str ? span('string', str) : close ? span('keyword', close) : escapeHtml(m));
    }
    if (family === 'css') {
      return code.replace(/(\/\*[^]*?\*\/)|("[^"\n]*"|'[^'\n]*')|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b)|([\w-]+)(?=\s*:)|(@[\w-]+)|([^]?)/g, (m, comment, str, num, prop, at) => comment ? span('comment', comment) : str ? span('string', str) : num ? span('number', num) : prop ? span('prop', prop) : at ? span('keyword', at) : escapeHtml(m));
    }
    if (family === 'yaml') {
      return code.replace(/(#.*$)|^(\s*-?\s*[\w.-]+)(?=\s*[:=])|("[^"\n]*"|'[^'\n]*')|(\b(?:true|false|null|yes|no)\b)|(\b\d+(?:\.\d+)?\b)|([^]?)/gm, (m, comment, key, str, bool, num) => comment ? span('comment', comment) : key ? span('prop', key) : str ? span('string', str) : bool ? span('keyword', bool) : num ? span('number', num) : escapeHtml(m));
    }
    if (family === 'json') {
      return code.replace(/("(?:[^"\\\n]|\\.)*")(\s*:)?|(\b(?:true|false|null)\b)|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\/\/.*$)|([^]?)/gm, (m, str, colon, bool, num, comment) => str ? (colon ? span('prop', str) + escapeHtml(colon) : span('string', str)) : bool ? span('keyword', bool) : num ? span('number', num) : comment ? span('comment', comment) : escapeHtml(m));
    }
    const keywords = keywordSet(family);
    const hashComments = family === 'py' || family === 'sh';
    const comment = hashComments ? '(#.*$)' : family === 'sql' ? '(--.*$|\\/\\*[^]*?\\*\\/)' : '(\\/\\/.*$|\\/\\*[^]*?\\*\\/)';
    const strings = family === 'py' ? '("""[^]*?"""|\'\'\'[^]*?\'\'\'|"(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\')' : '("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)';
    const pattern = new RegExp(`${comment}|${strings}|(\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b|\\b0x[0-9a-fA-F]+\\b)|([A-Za-z_$][\\w$]*)(\\s*\\()?|([^]?)`, 'gm');
    const insensitive = family === 'sql';
    return code.replace(pattern, (m, com, str, num, word, call) => {
      if (com) return span('comment', com);
      if (str) return span('string', str);
      if (num) return span('number', num);
      if (word) {
        const known = keywords.has(insensitive ? word.toLowerCase() : word);
        return (known ? span('keyword', word) : call ? span('fn', word) : escapeHtml(word)) + (call ? escapeHtml(call) : '');
      }
      return escapeHtml(m);
    });
  }

  // ------------------------------------------------------------------ inline
  const INLINE_HTML = /<(\/?)(br|kbd|mark|sub|sup|u|s|small|b|i|em|strong|del|ins|span|center)\s*(\/?)>/gi;

  function emphasize(html) {
    return html
      .replace(/\*\*\*(?=\S)([^]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(?=\S)([^]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\p{L}\p{N}_])__(?=\S)([^]*?\S)__(?![\p{L}\p{N}_])/gu, '$1<strong>$2</strong>')
      .replace(/\*(?=[^\s*])([^*]*?[^\s*])\*/g, '<em>$1</em>')
      .replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])([^_]*?[^\s_])_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>')
      .replace(/~~(?=\S)([^]*?\S)~~/g, '<del>$1</del>')
      .replace(/==(?=\S)([^]*?\S)==/g, '<mark>$1</mark>');
  }

  function attr(name, value) { return value === undefined || value === null || value === '' ? '' : ` ${name}="${escapeHtml(value)}"`; }

  function wikilinkHtml(inner, ctx) {
    const { target, subpath, alias } = Meta.parseWikiInner(inner);
    const path = ctx.resolve ? ctx.resolve(target) : null;
    const text = alias || (target ? (subpath ? `${target} > ${subpath}` : target) : subpath);
    return `<a class="internal-link${path ? '' : ' is-unresolved'}"${attr('data-href', target) || ' data-href=""'}${attr('data-subpath', subpath)}${attr('data-path', path)}>${escapeHtml(text)}</a>`;
  }

  function sizeFrom(text) {
    const match = /^(\d{1,4})(?:x(\d{1,4}))?$/.exec(String(text || '').trim());
    return match ? { width: match[1], height: match[2] } : null;
  }

  // What follows the target of an image: "![[photo.png|Légende|left|300]]" or
  // "![Légende|center|300](photo.png)". A size and a placement may come in any
  // order; anything else is the alternative text. Obsidian reads the last part
  // as the size, so writing the size last keeps notes compatible.
  const IMAGE_ALIGNS = { left: 'left', gauche: 'left', right: 'right', droite: 'right', center: 'center', centre: 'center', inline: '' };
  function imageOptions(label) {
    const options = { alt: '', align: '', width: '', height: '' };
    const rest = []; let sized = false; let placed = false;
    for (const part of String(label || '').split(/\\?\|/)) {
      const value = part.trim();
      const size = !sized && sizeFrom(value);
      if (size) { options.width = size.width; options.height = size.height || ''; sized = true; continue; }
      const align = placed ? undefined : IMAGE_ALIGNS[value.toLowerCase()];
      if (align !== undefined) { options.align = align; placed = true; continue; }
      if (value) rest.push(value);
    }
    options.alt = rest.join('|');
    return options;
  }
  function imageLabel(options, separator = '|') {
    const parts = [];
    if (options.alt) parts.push(options.alt);
    if (options.align) parts.push(options.align);
    if (options.width) parts.push(options.height ? `${options.width}x${options.height}` : String(options.width));
    return parts.join(separator);
  }
  // Rewrite the placement and size of one image written in Markdown, keeping
  // its target and its text. `change.width` null removes the size.
  function rewriteImage(raw, change) {
    const separator = raw.includes('\\|') ? '\\|' : '|';
    const apply = (label) => {
      const options = imageOptions(label);
      if ('align' in change) options.align = change.align || '';
      if ('width' in change) { options.width = change.width ? String(Math.round(change.width)) : ''; options.height = ''; }
      return imageLabel(options, separator);
    };
    const wiki = /^!\[\[([^]*)\]\]$/.exec(raw);
    if (wiki) {
      const pipe = wiki[1].search(/\\?\|/);
      const target = pipe < 0 ? wiki[1] : wiki[1].slice(0, pipe);
      const label = apply(pipe < 0 ? '' : wiki[1].slice(pipe).replace(/^\\?\|/, ''));
      return `![[${target}${label ? separator + label : ''}]]`;
    }
    const md = /^!\[([^\]]*)\](\([^]*\))$/.exec(raw);
    if (md) return `![${apply(md[1])}]${md[2]}`;
    return raw;
  }
  // Take the text [from, to) out of a note, tidying what is left: a line that
  // held only the image disappears, and an image inside a sentence takes one of
  // its surrounding spaces with it.
  function removeSpan(text, from, to) {
    const lineStart = text.lastIndexOf('\n', from - 1) + 1;
    let lineEnd = text.indexOf('\n', to);
    if (lineEnd < 0) lineEnd = text.length;
    if (!text.slice(lineStart, from).trim() && !text.slice(to, lineEnd).trim()) {
      let cut = lineStart; const after = lineEnd < text.length ? lineEnd + 1 : lineEnd;
      if (after === text.length && cut > 0) cut--;
      let out = text.slice(0, cut) + text.slice(after);
      // Never leave more than one blank line where the image was.
      let i = cut; let j = cut;
      while (i > 0 && out[i - 1] === '\n') i--;
      while (j < out.length && out[j] === '\n') j++;
      if (j - i > 2 || i === 0) out = out.slice(0, i) + (i === 0 ? '' : j === out.length ? '\n' : '\n\n') + out.slice(j);
      return out;
    }
    let a = from; let b = to;
    if (/[ \t]/.test(text[a - 1] || '') && (/[ \t]/.test(text[b] || '') || b === lineEnd)) a--;
    else if (a === lineStart && /[ \t]/.test(text[b] || '')) b++;
    return text.slice(0, a) + text.slice(b);
  }

  // Put `embed` at `offset`: inside the sentence (with spaces as needed), or as a
  // paragraph of its own. Returns the new text and where the embed starts.
  function insertAt(text, offset, embed, paragraph) {
    let before = text.slice(0, offset); let after = text.slice(offset);
    if (paragraph) {
      before = before.replace(/\s+$/, ''); after = after.replace(/^(?:[ \t]*\n)+/, '');
      const head = before ? `${before}\n\n` : '';
      return { text: `${head}${embed}${after ? `\n\n${after}` : '\n'}`, at: head.length };
    }
    const left = before && !/\s$/.test(before) ? ' ' : '';
    const right = after && !/^\s/.test(after) ? ' ' : '';
    return { text: before + left + embed + right + after, at: before.length + left.length };
  }

  // Move the image at [from, to) so that it lands at `offset` of the same text.
  function moveSpan(text, from, to, offset, paragraph) {
    const raw = text.slice(from, to);
    // A marker keeps track of the destination while the source is removed.
    const marked = `${text.slice(0, offset)}\u0000${text.slice(offset)}`;
    const shift = offset <= from ? 1 : 0;
    const removed = removeSpan(marked, from + shift, to + shift);
    const at = removed.indexOf('\u0000');
    return insertAt(removed.slice(0, at) + removed.slice(at + 1), at, raw, paragraph);
  }

  function imageTag(url, options, fallbackAlt, extra) {
    return `<img class="embed-image${options.align ? ` align-${options.align}` : ''}" src="${escapeHtml(url)}" alt="${escapeHtml(options.alt || fallbackAlt || '')}"${attr('width', options.width)}${attr('height', options.height)}${extra}>`;
  }


  function mediaHtml(path, label, ctx) {
    const kind = Meta.kindOf(path); const url = ctx.fileUrl ? ctx.fileUrl(path) : path;
    if (kind === 'image') return imageTag(url, imageOptions(label), Meta.baseName(path), ` loading="lazy"${attr('data-path', path)}`);
    if (kind === 'audio') return `<audio class="embed-audio" controls preload="none" src="${escapeHtml(url)}"></audio>`;
    if (kind === 'video') return `<video class="embed-video" controls preload="metadata" src="${escapeHtml(url)}"></video>`;
    return null;
  }

  function embedHtml(inner, ctx) {
    const { target, subpath, alias } = Meta.parseWikiInner(inner);
    const path = ctx.resolve ? ctx.resolve(target) : null;
    if (!path) return `<span class="embed embed-missing"><a class="internal-link is-unresolved"${attr('data-href', target) || ' data-href=""'}>${escapeHtml(target || inner)}</a></span>`;
    const media = mediaHtml(path, alias, ctx);
    if (media) return media;
    const depth = ctx.embedDepth || 0;
    if (Meta.kindOf(path) === 'note' && depth < 3) {
      return `<span class="embed embed-note" data-embed-path="${escapeHtml(path)}"${attr('data-embed-subpath', subpath)} data-embed-depth="${depth + 1}"></span>`;
    }
    return `<span class="embed embed-file"><a class="internal-link"${attr('data-href', target)} data-path="${escapeHtml(path)}">${escapeHtml(alias || Meta.baseName(path))}</a></span>`;
  }

  function imageHtml(alt, url, title, ctx) {
    const options = imageOptions(alt);
    const label = options.alt;
    if (/^(https?:|data:image\/(png|jpe?g|gif|webp|avif);)/i.test(url)) {
      return imageTag(url, options, '', `${attr('title', title)} loading="lazy" referrerpolicy="no-referrer"`);
    }
    if (SCHEME_RE.test(url)) return escapeHtml(label);
    const target = safeDecode(url.split('#')[0]);
    const path = ctx.resolve ? ctx.resolve(target) : null;
    if (!path) return `<span class="embed embed-missing" data-href="${escapeHtml(target)}">${escapeHtml(label || url)}</span>`;
    return mediaHtml(path, alt, ctx) || `<a class="internal-link" data-path="${escapeHtml(path)}" data-href="${escapeHtml(url)}">${escapeHtml(label || Meta.baseName(path))}</a>`;
  }

  function linkHtml(label, url, title, ctx) {
    const text = emphasize(escapeHtml(label));
    if (EXTERNAL_RE.test(url)) return `<a class="external-link" href="${escapeHtml(url)}"${attr('title', title)} target="_blank" rel="noopener noreferrer">${text}</a>`;
    // Any other scheme (javascript:, file:, data: …) is shown as plain text.
    if (SCHEME_RE.test(url)) return text;
    const hash = url.indexOf('#');
    const target = Meta.notePathWithoutExt(safeDecode(hash >= 0 ? url.slice(0, hash) : url));
    const subpath = hash >= 0 ? safeDecode(url.slice(hash + 1)) : '';
    const path = ctx.resolve ? ctx.resolve(target) : null;
    return `<a class="internal-link${path ? '' : ' is-unresolved'}" data-href="${escapeHtml(target)}"${attr('data-subpath', subpath)}${attr('data-path', path)}>${text || escapeHtml(target)}</a>`;
  }

  function footnoteRef(id, ctx) {
    const notes = ctx.footnotes || (ctx.footnotes = { order: [], defs: {} });
    let index = notes.order.indexOf(id);
    if (index < 0) { notes.order.push(id); index = notes.order.length - 1; }
    return `<sup class="footnote-ref" data-footnote="${escapeHtml(id)}">[${index + 1}]</sup>`;
  }

  function renderInline(text, ctx) {
    ctx = ctx || {};
    const slots = [];
    const hold = (html) => { slots.push(html); return OPEN + (slots.length - 1) + CLOSE; };
    let src = String(text == null ? '' : text).replace(/[]/g, '');

    src = src.replace(/(`+)(?!`)([^]*?[^`])\1(?!`)/g, (m, ticks, code) => hold(`<code>${escapeHtml(code.replace(/^ ([^]*) $/, '$1'))}</code>`));
    src = src.replace(/%%[^]*?%%/g, '');
    src = src.replace(/\\([\\`*_{}\[\]()#+\-.!|~=<>$%^&"'])/g, (m, ch) => hold(escapeHtml(ch)));
    src = src.replace(/\$\$([^$\n]+?)\$\$/g, (m, tex) => hold(`<span class="math math-block">${escapeHtml(tex.trim())}</span>`));
    src = src.replace(/(^|[^\\$\p{L}\p{N}])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\d$])/gu, (m, pre, tex) => pre + hold(`<span class="math">${escapeHtml(tex)}</span>`));
    src = src.replace(/(!?)\[\[([^\[\]\n]+?)\]\]/g, (m, bang, inner) => hold(bang ? embedHtml(inner, ctx) : wikilinkHtml(inner, ctx)));
    src = src.replace(/!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"\n]*)")?\s*\)/g, (m, alt, url, title) => hold(imageHtml(alt, url, title, ctx)));
    src = src.replace(/\[([^\[\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"\n]*)")?\s*\)/g, (m, label, url, title) => hold(linkHtml(label, url, title, ctx)));
    src = src.replace(/\^\[([^\]\n]+)\]/g, (m, note) => {
      const notes = ctx.footnotes || (ctx.footnotes = { order: [], defs: {} });
      const id = `inline-${notes.order.length + 1}`;
      notes.defs[id] = note;
      return hold(footnoteRef(id, ctx));
    });
    src = src.replace(/\[\^([^\]\s]+)\]/g, (m, id) => hold(footnoteRef(id, ctx)));
    src = src.replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/g, (m, url) => hold(`<a class="external-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url.replace(/^mailto:/, ''))}</a>`));
    src = src.replace(/(^|[\s(])(https?:\/\/[^\s<>]*[^\s<>.,;:!?)\]'"])/g, (m, pre, url) => pre + hold(`<a class="external-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`));

    // Attribute-less inline tags only, and always balanced inside this run so
    // an unclosed <b> cannot restyle the rest of the note.
    const open = [];
    src = src.replace(INLINE_HTML, (m, closing, name, selfClosing) => {
      const tag = name.toLowerCase();
      if (tag === 'br') return hold('<br>');
      if (selfClosing) return '';
      if (!closing) { open.push(tag); return hold(`<${tag}>`); }
      const at = open.lastIndexOf(tag);
      if (at < 0) return '';
      let html = '';
      while (open.length > at) html += `</${open.pop()}>`;
      return hold(html);
    });
    src = src.replace(/(^|\s)#([\p{L}\p{N}_\-\/]+)/gu, (m, pre, tag) => (/^\d+$/.test(tag) ? m : pre + hold(`<a class="tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</a>`)));

    let html = emphasize(escapeHtml(src)).replace(/\n/g, '<br>\n');
    while (open.length) html += `</${open.pop()}>`;
    for (let pass = 0; pass < 6 && html.includes(OPEN); pass++) html = html.replace(/(\d+)/g, (m, index) => slots[Number(index)] || '');
    return html;
  }

  // What a line of Markdown reads like once the syntax is gone (outline, tabs).
  function plainText(text) {
    return String(text == null ? '' : text)
      .replace(/!?\[\[([^\[\]\n]+?)\]\]/g, (m, inner) => { const link = Meta.parseWikiInner(inner); return link.alias || link.target || link.subpath; })
      .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
      .replace(/(`+)([^]*?)\1/g, '$2')
      .replace(/(\*\*\*|\*\*|__|~~|==)/g, '')
      .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  // ------------------------------------------------------------ block parser
  const RE = {
    fence: /^( {0,3})(`{3,}|~{3,})\s*([^`]*?)\s*$/,
    fenceClose: /^ {0,3}(`{3,}|~{3,})[ \t]*$/,
    heading: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
    hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
    quote: /^ {0,3}>/,
    item: /^( *)([-*+]|\d{1,9}[.)])(?:( +)(.*)|$)/,
    tableDelim: /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/,
    footnote: /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/,
    setext: /^ {0,3}(=+|-{2,})[ \t]*$/,
    callout: /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/,
  };
  function expandTabs(line) { return line.replace(/^[\t ]+/, (ws) => ws.replace(/\t/g, '    ')); }
  function indentOf(line) { return /^ */.exec(line)[0].length; }

  function startsBlock(line) {
    if (RE.fence.test(line) || RE.heading.test(line) || RE.hr.test(line) || RE.quote.test(line) || /^\s*\$\$/.test(line)) return true;
    const item = RE.item.exec(line);
    // A numbered item only interrupts a paragraph when it starts at 1, so a
    // line that happens to begin with "1986. " stays in its paragraph.
    return !!(item && item[4] && (!/\d/.test(item[2]) || /^1[.)]$/.test(item[2])));
  }

  function splitRow(line) {
    let row = line.trim();
    if (row.startsWith('|')) row = row.slice(1);
    if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
    const cells = []; let current = ''; let code = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '\\' && row[i + 1] === '|') { current += '|'; i++; continue; }
      if (ch === '`') code = !code;
      if (ch === '|' && !code) { cells.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    cells.push(current.trim());
    return cells;
  }

  function parseList(lines, from, base) {
    const first = RE.item.exec(lines[from]);
    const ordered = /\d/.test(first[2]); const indent = first[1].length;
    const token = { type: 'list', ordered, startNum: ordered ? parseInt(first[2], 10) : null, items: [], loose: false, start: base + from, end: base + from };
    const total = lines.length;
    let i = from;
    while (i < total) {
      const match = RE.item.exec(lines[i]);
      if (!match || RE.hr.test(lines[i]) || Math.abs(match[1].length - indent) > 1 || /\d/.test(match[2]) !== ordered) break;
      const contentIndent = match[1].length + match[2].length + Math.min((match[3] || ' ').length, 4);
      let strip = contentIndent;
      const itemLines = [match[4] || '']; let last = i; let j = i + 1;
      while (j < total) {
        const line = lines[j];
        if (!line.trim()) {
          let next = j + 1;
          while (next < total && !lines[next].trim()) next++;
          if (next < total && indentOf(lines[next]) > match[1].length + 1) { for (; j < next; j++) itemLines.push(''); continue; }
          break;
        }
        const depth = indentOf(line); const nested = RE.item.exec(line);
        if (nested && depth > match[1].length + 1) { strip = Math.min(strip, depth); itemLines.push(line.slice(strip)); }
        else if (depth >= strip) itemLines.push(line.slice(strip));
        else if (nested || startsBlock(line)) break;
        else itemLines.push(line.trim());
        last = j; j++;
      }
      const item = { start: base + i, end: base + last, num: ordered ? parseInt(match[2], 10) : null, task: null };
      const task = /^\[(.)\](?: +|$)/.exec(itemLines[0]);
      if (task) { item.task = task[1]; itemLines[0] = itemLines[0].slice(task[0].length); }
      item.children = parseBlocks(itemLines, base + i, false);
      token.items.push(item); token.end = item.end;
      let next = j;
      while (next < total && !lines[next].trim()) next++;
      const follow = next < total ? RE.item.exec(lines[next]) : null;
      if (follow && !RE.hr.test(lines[next]) && Math.abs(follow[1].length - indent) <= 1 && /\d/.test(follow[2]) === ordered) {
        if (next > j) token.loose = true;
        i = next; continue;
      }
      i = j; break;
    }
    return { token, next: i };
  }

  function parseBlocks(lines, base, top) {
    const tokens = []; const total = lines.length;
    let i = 0;
    if (top && total && lines[0].trim() === '---') {
      for (let j = 1; j < total; j++) {
        const line = lines[j].trim();
        if (line === '---' || line === '...') { tokens.push({ type: 'frontmatter', start: base, end: base + j, yaml: lines.slice(1, j).join('\n') }); i = j + 1; break; }
      }
    }
    while (i < total) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let match;

      if ((match = RE.fence.exec(line))) {
        const ch = match[2][0]; const length = match[2].length; const indent = match[1].length;
        const body = []; let j = i + 1;
        while (j < total) {
          const close = RE.fenceClose.exec(lines[j]);
          if (close && close[1][0] === ch && close[1].length >= length) break;
          body.push(lines[j].slice(Math.min(indent, indentOf(lines[j])))); j++;
        }
        tokens.push({ type: 'code', lang: match[3].trim().split(/\s+/)[0] || '', text: body.join('\n'), start: base + i, end: base + Math.min(j, total - 1) });
        i = j + 1; continue;
      }

      if (/^\s*\$\$/.test(line)) {
        const trimmed = line.trim();
        if (trimmed.length > 4 && trimmed.endsWith('$$')) { tokens.push({ type: 'math', text: trimmed.slice(2, -2).trim(), start: base + i, end: base + i }); i++; continue; }
        const body = [trimmed.slice(2)]; let j = i + 1;
        while (j < total && !lines[j].includes('$$')) { body.push(lines[j]); j++; }
        if (j < total) body.push(lines[j].slice(0, lines[j].indexOf('$$')));
        tokens.push({ type: 'math', text: body.join('\n').trim(), start: base + i, end: base + Math.min(j, total - 1) });
        i = j + 1; continue;
      }

      if (line.trim().startsWith('%%') && line.trim().indexOf('%%', 2) < 0) {
        let j = i + 1;
        while (j < total && !lines[j].includes('%%')) j++;
        tokens.push({ type: 'comment', start: base + i, end: base + Math.min(j, total - 1) });
        i = j + 1; continue;
      }

      if ((match = RE.heading.exec(line))) {
        tokens.push({ type: 'heading', level: match[1].length, text: (match[2] || '').trim(), start: base + i, end: base + i });
        i++; continue;
      }

      if (RE.hr.test(line)) { tokens.push({ type: 'hr', start: base + i, end: base + i }); i++; continue; }

      if (RE.quote.test(line)) {
        const inner = []; let j = i;
        while (j < total && (RE.quote.test(lines[j]) || (j > i && lines[j].trim() && !startsBlock(lines[j])))) { inner.push(lines[j].replace(/^ {0,3}> ?/, '')); j++; }
        const token = { type: 'blockquote', start: base + i, end: base + j - 1 };
        const callout = RE.callout.exec(inner[0]);
        if (callout) {
          token.callout = { kind: callout[1].toLowerCase(), fold: callout[2], title: callout[3].trim() };
          token.children = parseBlocks(inner.slice(1), base + i + 1, false);
        } else token.children = parseBlocks(inner, base + i, false);
        tokens.push(token); i = j; continue;
      }

      if (RE.item.test(line)) {
        const list = parseList(lines, i, base);
        tokens.push(list.token); i = list.next; continue;
      }

      if (line.includes('|') && i + 1 < total && lines[i + 1].includes('-') && RE.tableDelim.test(lines[i + 1])) {
        const header = splitRow(line); const delim = splitRow(lines[i + 1]);
        if (header.length === delim.length) {
          const align = delim.map((cell) => (/^:-+:$/.test(cell) ? 'center' : /-+:$/.test(cell) ? 'right' : /^:-+/.test(cell) ? 'left' : ''));
          const rows = []; let j = i + 2;
          while (j < total && lines[j].trim() && lines[j].includes('|') && !RE.fence.test(lines[j])) {
            const row = splitRow(lines[j]);
            while (row.length < header.length) row.push('');
            rows.push(row.slice(0, header.length)); j++;
          }
          tokens.push({ type: 'table', header, align, rows, start: base + i, end: base + j - 1 });
          i = j; continue;
        }
      }

      if ((match = RE.footnote.exec(line))) {
        const body = [match[2]]; let j = i + 1;
        while (j < total && /^( {2,}|\t)\S/.test(lines[j])) { body.push(lines[j].trim()); j++; }
        tokens.push({ type: 'footnote', id: match[1], text: body.join('\n'), start: base + i, end: base + j - 1 });
        i = j; continue;
      }

      let j = i + 1; let setext = 0;
      while (j < total && lines[j].trim()) {
        const under = RE.setext.exec(lines[j]);
        if (under) { setext = under[1][0] === '=' ? 1 : 2; break; }
        if (startsBlock(lines[j])) break;
        j++;
      }
      const text = lines.slice(i, j).map((value) => value.trim()).join('\n');
      if (setext) { tokens.push({ type: 'heading', level: setext, text, start: base + i, end: base + j }); i = j + 1; continue; }
      tokens.push({ type: 'paragraph', text, start: base + i, end: base + j - 1 });
      i = j;
    }
    return tokens;
  }

  function tokenize(text) {
    const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n').map(expandTabs);
    return parseBlocks(lines, 0, true);
  }

  // Editing units for the live view: one per top-level block, and one per
  // top-level list item so a long list is not swapped to source as a whole.
  function liveBlocks(text) {
    const blocks = [];
    for (const token of tokenize(text)) {
      if (token.type !== 'list') { blocks.push({ start: token.start, end: token.end, token }); continue; }
      for (const item of token.items) {
        blocks.push({ start: item.start, end: item.end, token: { type: 'list', ordered: token.ordered, startNum: item.num, loose: false, items: [item], start: item.start, end: item.end } });
      }
    }
    return blocks;
  }

  // ---------------------------------------------------------------- rendering
  function propertyValue(key, value, ctx) {
    const lower = key.toLowerCase();
    if (lower === 'tags' || lower === 'tag') {
      return Meta.listValue(value).map((tag) => tag.replace(/^#/, '')).filter(Boolean)
        .map((tag) => `<a class="tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</a>`).join(' ');
    }
    if (Array.isArray(value)) return value.map((item) => `<span class="pill">${renderInline(String(item == null ? '' : item), ctx)}</span>`).join(' ');
    if (typeof value === 'boolean') return `<input type="checkbox" disabled${value ? ' checked' : ''}>`;
    if (value === null || value === undefined || value === '') return '<span class="property-empty">—</span>';
    return renderInline(String(value), ctx);
  }

  function renderToken(token, ctx, tight) {
    const line = ` data-line="${token.start}"`;
    switch (token.type) {
      case 'frontmatter': {
        const entries = Object.entries(Meta.parseYaml(token.yaml));
        const rows = entries.map(([key, value]) => `<div class="property"><span class="property-key">${escapeHtml(key)}</span><span class="property-value">${propertyValue(key, value, ctx)}</span></div>`).join('');
        return `<div class="properties"${line}><div class="properties-title">Propriétés</div>${rows || '<div class="property-empty">Aucune propriété</div>'}</div>`;
      }
      case 'heading':
        return `<h${token.level}${line} data-heading="${escapeHtml(plainText(token.text))}">${renderInline(token.text, ctx)}</h${token.level}>`;
      case 'paragraph': {
        const block = /\s\^([A-Za-z0-9-]+)\s*$/.exec(token.text);
        const text = block ? token.text.slice(0, block.index) : token.text;
        const html = renderInline(text, ctx);
        return tight ? `<span class="list-text"${line}>${html}</span>` : `<p${line}${block ? ` data-block-id="${block[1]}"` : ''}>${html}</p>`;
      }
      case 'code':
        return `<pre class="code-block"${line}${attr('data-lang', token.lang)}><code>${highlight(token.text, token.lang)}</code></pre>`;
      case 'math':
        return `<div class="math math-block"${line}>${escapeHtml(token.text)}</div>`;
      case 'hr':
        return `<hr${line}>`;
      case 'comment':
        return '';
      case 'footnote': {
        const notes = ctx.footnotes || (ctx.footnotes = { order: [], defs: {} });
        notes.defs[token.id] = token.text;
        return ctx.live ? `<p class="footnote-def"${line}><span class="footnote-mark">[^${escapeHtml(token.id)}]</span> ${renderInline(token.text, ctx)}</p>` : '';
      }
      case 'blockquote': {
        const inner = renderTokens(token.children, ctx);
        if (!token.callout) return `<blockquote${line}>${inner}</blockquote>`;
        const known = CALLOUTS[token.callout.kind];
        const title = token.callout.title ? renderInline(token.callout.title, ctx) : escapeHtml(known ? known[0] : token.callout.kind.charAt(0).toUpperCase() + token.callout.kind.slice(1));
        const head = `<span class="callout-icon">${icon(known ? known[1] : 'pencil')}</span><span class="callout-title-text">${title}</span>`;
        const attrs = `class="callout" data-callout="${escapeHtml(token.callout.kind)}" data-callout-color="${CALLOUT_COLOR[token.callout.kind] || 'blue'}"${line}`;
        if (token.callout.fold) {
          return `<details ${attrs}${token.callout.fold === '+' ? ' open' : ''}><summary class="callout-title">${head}</summary><div class="callout-content">${inner}</div></details>`;
        }
        return `<div ${attrs}><div class="callout-title">${head}</div>${inner ? `<div class="callout-content">${inner}</div>` : ''}</div>`;
      }
      case 'list': {
        const tag = token.ordered ? 'ol' : 'ul';
        const hasTasks = token.items.some((item) => item.task !== null);
        const items = token.items.map((item) => {
          const body = item.children.map((child, index) => renderToken(child, ctx, !token.loose && index === 0 && child.type === 'paragraph')).join('');
          if (item.task === null) return `<li data-line="${item.start}">${body}</li>`;
          const done = item.task !== ' ';
          return `<li class="task-list-item${done ? ' is-checked' : ''}" data-task="${escapeHtml(item.task)}" data-line="${item.start}"><input type="checkbox" class="task-list-item-checkbox" data-line="${item.start}"${done ? ' checked' : ''}>${body}</li>`;
        }).join('');
        return `<${tag}${line}${hasTasks ? ' class="contains-task-list"' : ''}${token.ordered && token.startNum !== 1 && token.startNum !== null ? ` start="${token.startNum}"` : ''}>${items}</${tag}>`;
      }
      case 'table': {
        const cell = (tag, text, index) => `<${tag}${token.align[index] ? ` style="text-align:${token.align[index]}"` : ''}>${renderInline(text, ctx)}</${tag}>`;
        const head = `<tr>${token.header.map((text, index) => cell('th', text, index)).join('')}</tr>`;
        const body = token.rows.map((row) => `<tr>${row.map((text, index) => cell('td', text, index)).join('')}</tr>`).join('');
        return `<div class="table-wrap"${line}><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
      }
      default:
        return '';
    }
  }

  function renderTokens(tokens, ctx) { return tokens.map((token) => renderToken(token, ctx, false)).join('\n'); }

  function footnotesHtml(ctx) {
    const notes = ctx.footnotes;
    if (!notes || !notes.order.length) return '';
    const items = notes.order.map((id) => `<li data-footnote="${escapeHtml(id)}">${notes.defs[id] ? renderInline(notes.defs[id], { ...ctx, footnotes: { order: [], defs: {} } }) : '<em>Note manquante</em>'}</li>`).join('');
    return `<section class="footnotes"><hr><ol>${items}</ol></section>`;
  }

  function render(text, ctx) {
    const context = { ...(ctx || {}), footnotes: { order: [], defs: {} } };
    const tokens = tokenize(text);
    // Definitions are collected first: a reference may come before its note.
    for (const token of tokens) if (token.type === 'footnote') context.footnotes.defs[token.id] = token.text;
    return renderTokens(tokens, context) + footnotesHtml(context);
  }

  return { escapeHtml, highlight, renderInline, plainText, tokenize, liveBlocks, renderToken, renderTokens, render, imageOptions, imageLabel, rewriteImage, removeSpan, insertAt, moveSpan };
});
