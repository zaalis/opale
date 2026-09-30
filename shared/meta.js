// Opale — note metadata: paths, frontmatter, links, tags, headings.
// Loaded by the Node server (require) and by the interface (<script>), so the
// index built on disk and the one the editor reasons about can never disagree.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OpaleMeta = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
  const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac']);
  const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'ogv']);

  // ------------------------------------------------------------------ paths
  function baseName(p) { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); }
  function dirName(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function extOf(p) { const b = baseName(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; }
  function stem(p) { const b = baseName(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; }
  function kindOf(p) {
    const ext = extOf(p);
    if (ext === 'md' || ext === 'markdown') return 'note';
    if (IMAGE_EXTS.has(ext)) return 'image';
    if (AUDIO_EXTS.has(ext)) return 'audio';
    if (VIDEO_EXTS.has(ext)) return 'video';
    if (ext === 'pdf') return 'pdf';
    return 'other';
  }
  function joinPath(a, b) { return a ? (b ? a + '/' + b : a) : b; }
  // Collapse "." and ".." segments. Returns null when the path climbs above
  // the vault root.
  function normalizePath(p) {
    const out = [];
    for (const part of String(p).replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!out.length) return null; out.pop(); continue; }
      out.push(part);
    }
    return out.join('/');
  }
  function notePathWithoutExt(p) { return /\.md$/i.test(p) ? p.slice(0, -3) : p; }

  // ------------------------------------------------------------ frontmatter
  function splitFrontmatter(text) {
    const none = { yaml: null, body: text, bodyLine: 0 };
    if (!text.startsWith('---')) return none;
    const lines = text.split('\n');
    if (lines[0].trim() !== '---') return none;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '---' || line === '...') {
        return { yaml: lines.slice(1, i).join('\n'), body: lines.slice(i + 1).join('\n'), bodyLine: i + 1 };
      }
    }
    return none;
  }

  function parseScalar(raw) {
    const value = raw.trim();
    if (value === '') return '';
    if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2)) {
      try { return JSON.parse(value); } catch { return value.slice(1, -1); }
    }
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1).replace(/''/g, "'");
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null' || value === '~') return null;
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    return value;
  }
  // Split "a, "b, c", d" on the commas that are not inside quotes.
  function splitInline(src) {
    const out = []; let current = ''; let quote = '';
    for (const ch of src) {
      if (quote) { current += ch; if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
      if (ch === ',') { out.push(current); current = ''; continue; }
      current += ch;
    }
    if (current.trim() !== '' || out.length) out.push(current);
    return out.map(parseScalar).filter((v) => v !== '');
  }
  // The subset of YAML that note properties use: scalars, inline lists,
  // dash lists and block scalars. Anything else is kept as a plain string.
  function parseYaml(src) {
    const result = {};
    const lines = String(src || '').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const match = /^([^\s#:][^:]*?)\s*:(?:\s+(.*)|\s*)$/.exec(line);
      if (!match) { i++; continue; }
      const key = match[1].trim();
      const rest = (match[2] || '').trim();
      i++;
      if (rest === '' ) {
        const items = []; const block = [];
        while (i < lines.length && (/^\s+\S/.test(lines[i]) || /^-\s/.test(lines[i]) || lines[i].trim() === '')) {
          const item = /^\s*-\s+(.*)$/.exec(lines[i]) || /^\s*-\s*$/.exec(lines[i]);
          if (item) items.push(parseScalar(item[1] || ''));
          else if (lines[i].trim() !== '') block.push(lines[i].trim());
          i++;
        }
        result[key] = items.length ? items : (block.length ? block.join(' ') : null);
      } else if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
        const block = [];
        while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i].trim() === '')) { block.push(lines[i].replace(/^\s{1,2}/, '')); i++; }
        result[key] = block.join(rest[0] === '|' ? '\n' : ' ').trim();
      } else if (rest.startsWith('[') && rest.endsWith(']')) {
        result[key] = splitInline(rest.slice(1, -1));
      } else {
        result[key] = parseScalar(rest);
      }
    }
    return result;
  }

  function yamlScalar(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    const text = String(value);
    if (text === '' || /^[\s]|[\s]$|^[-?:,\[\]{}#&*!|>'"%@`]|: |\s#|^(true|false|null|~)$|^-?\d+(\.\d+)?$/.test(text) || text.includes('\n')) return JSON.stringify(text);
    return text;
  }
  function stringifyYaml(object) {
    const out = [];
    for (const [key, value] of Object.entries(object || {})) {
      if (Array.isArray(value)) {
        if (!value.length) out.push(`${key}: []`);
        else { out.push(`${key}:`); for (const item of value) out.push(`  - ${yamlScalar(item)}`); }
      } else out.push(`${key}: ${yamlScalar(value)}`);
    }
    return out.join('\n');
  }
  // Rebuild a note with its frontmatter replaced (or removed when empty).
  function withFrontmatter(text, object) {
    const split = splitFrontmatter(text);
    const yaml = stringifyYaml(object);
    const body = split.yaml === null ? text : split.body;
    if (!yaml) return body.replace(/^\n+/, '');
    return `---\n${yaml}\n---\n${body}`;
  }

  function listValue(value) {
    if (Array.isArray(value)) return value.map((v) => String(v == null ? '' : v).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(/[,\s]+/).map((v) => v.trim()).filter(Boolean);
    return [];
  }

  // ------------------------------------------------------------- code masks
  // Replace everything that must not be scanned for links or tags (fenced
  // code, inline code, comments, math) with spaces, keeping every line the
  // same length so match offsets still address the original text.
  function maskLines(lines, fromLine) {
    const out = lines.slice();
    let fence = null; let comment = false; let math = false;
    const blank = (s) => s.replace(/[^\n]/g, ' ');
    for (let i = 0; i < out.length; i++) {
      if (i < fromLine) { out[i] = blank(out[i]); continue; }
      const line = out[i];
      if (fence) {
        const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
        if (close && close[1][0] === fence.ch && close[1].length >= fence.len) fence = null;
        out[i] = blank(line); continue;
      }
      const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (open && !comment && !math) { fence = { ch: open[1][0], len: open[1].length }; out[i] = blank(line); continue; }
      if (math) { if (line.includes('$$')) math = false; out[i] = blank(line); continue; }
      if (/^\s*\$\$/.test(line) && !comment) {
        // "$$ … $$" on one line closes itself; a lone opening "$$" runs on.
        math = !line.trim().slice(2).includes('$$');
        out[i] = blank(line); continue;
      }
      let text = line;
      if (comment) {
        const end = text.indexOf('%%');
        if (end < 0) { out[i] = blank(line); continue; }
        text = blank(text.slice(0, end + 2)) + text.slice(end + 2); comment = false;
      }
      text = text.replace(/(`+)(?:(?!\1)[^])*?\1/g, blank);
      text = text.replace(/%%.*?%%/g, blank);
      const start = text.indexOf('%%');
      if (start >= 0) { text = text.slice(0, start) + blank(text.slice(start)); comment = true; }
      out[i] = text;
    }
    return out;
  }

  // ------------------------------------------------------------------ links
  const WIKI_RE = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
  const MD_LINK_RE = /(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;
  const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

  function parseWikiInner(inner) {
    // "\|" is how a pipe is written inside a table cell.
    const pipe = inner.search(/\\?\|/);
    let target = inner; let alias = '';
    if (pipe >= 0) { target = inner.slice(0, pipe); alias = inner.slice(pipe).replace(/^\\?\|/, ''); }
    const hash = target.indexOf('#');
    let subpath = '';
    if (hash >= 0) { subpath = target.slice(hash + 1); target = target.slice(0, hash); }
    return { target: target.trim(), subpath: subpath.trim(), alias: alias.trim() };
  }
  function safeDecode(value) { try { return decodeURIComponent(value); } catch { return value; } }

  function scanLinks(line, masked, lineNumber, visit) {
    WIKI_RE.lastIndex = 0;
    let match;
    while ((match = WIKI_RE.exec(masked))) {
      const inner = line.slice(match.index + match[1].length + 2, match.index + match[0].length - 2);
      visit({ style: 'wiki', embed: !!match[1], line: lineNumber, index: match.index, length: match[0].length, ...parseWikiInner(inner), raw: line.slice(match.index, match.index + match[0].length), hadPipeEscape: /\\\|/.test(inner) });
    }
    MD_LINK_RE.lastIndex = 0;
    while ((match = MD_LINK_RE.exec(masked))) {
      const raw = line.slice(match.index, match.index + match[0].length);
      const real = new RegExp(MD_LINK_RE.source).exec(raw);
      if (!real) continue;
      const url = real[3];
      if (SCHEME_RE.test(url) || url.startsWith('//')) continue;
      const hash = url.indexOf('#');
      const target = safeDecode(hash >= 0 ? url.slice(0, hash) : url);
      const subpath = safeDecode(hash >= 0 ? url.slice(hash + 1) : '');
      visit({ style: 'md', embed: !!real[1], line: lineNumber, index: match.index, length: match[0].length, target, subpath, alias: real[2], raw });
    }
  }

  const TAG_RE = /(^|\s)#([\p{L}\p{N}_\-\/]+)/gu;

  function extract(text) {
    const source = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const split = splitFrontmatter(source);
    const frontmatter = split.yaml === null ? {} : parseYaml(split.yaml);
    const lines = source.split('\n');
    const masked = maskLines(lines, split.bodyLine);
    const links = []; const headings = []; const blockIds = [];
    const tagSet = new Map();
    const addTag = (tag) => {
      const clean = String(tag).replace(/^#/, '').replace(/\/+$/, '');
      if (!clean || /^\d+$/.test(clean)) return;
      if (!tagSet.has(clean.toLowerCase())) tagSet.set(clean.toLowerCase(), clean);
    };
    for (const tag of listValue(frontmatter.tags)) addTag(tag);
    for (const tag of listValue(frontmatter.tag)) addTag(tag);
    let tasks = 0; let tasksDone = 0;
    for (let i = split.bodyLine; i < lines.length; i++) {
      const line = lines[i]; const mask = masked[i];
      if (!mask.trim()) continue;
      const heading = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(mask);
      if (heading) {
        const real = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
        headings.push({ level: heading[1].length, text: (real ? real[2] : heading[2]).trim(), line: i });
      }
      scanLinks(line, mask, i, (link) => { links.push({ target: link.target, subpath: link.subpath, alias: link.alias, embed: link.embed, style: link.style, line: link.line }); });
      // Links are blanked first so "[[Note#Section]]" never yields a tag.
      const tagLine = mask.replace(WIKI_RE, (m) => ' '.repeat(m.length)).replace(MD_LINK_RE, (m) => ' '.repeat(m.length));
      TAG_RE.lastIndex = 0;
      let tag;
      while ((tag = TAG_RE.exec(tagLine))) addTag(tag[2]);
      const task = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]\s/.exec(mask);
      if (task) { tasks++; if (task[1] !== ' ') tasksDone++; }
      const block = /\s\^([A-Za-z0-9-]+)\s*$/.exec(mask);
      if (block) blockIds.push({ id: block[1], line: i });
    }
    const body = split.body;
    const words = (body.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || []).length;
    // Aliases may contain spaces, so a string is split on commas only.
    const aliasSource = frontmatter.aliases !== undefined ? frontmatter.aliases : frontmatter.alias;
    const aliases = (Array.isArray(aliasSource) ? aliasSource : typeof aliasSource === 'string' ? aliasSource.split(',') : [])
      .map((alias) => String(alias == null ? '' : alias).trim()).filter(Boolean);
    return {
      frontmatter,
      aliases,
      tags: [...tagSet.values()],
      links, headings, blockIds,
      tasks: { total: tasks, done: tasksDone },
      words, chars: body.length,
    };
  }

  // Rewrite link targets in place. `change(link)` returns the new target, or
  // null/undefined to leave that link untouched.
  function rewriteLinks(text, change) {
    const source = String(text == null ? '' : text);
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const masked = maskLines(lines, splitFrontmatter(lines.join('\n')).bodyLine);
    let changed = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!masked[i].trim()) continue;
      const edits = [];
      scanLinks(lines[i], masked[i], i, (link) => {
        const next = change(link);
        if (next === null || next === undefined || next === link.target) return;
        let replacement;
        if (link.style === 'wiki') {
          const pipe = link.hadPipeEscape ? '\\|' : '|';
          replacement = `${link.embed ? '!' : ''}[[${next}${link.subpath ? '#' + link.subpath : ''}${link.alias ? pipe + link.alias : ''}]]`;
        } else {
          // Only what would break the Markdown link is escaped; accented
          // names stay readable in the source.
          const escape = (value) => value.replace(/[ ()<>%]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
          const url = escape(next) + (link.subpath ? '#' + escape(link.subpath) : '');
          replacement = `${link.embed ? '!' : ''}[${link.alias}](${url})`;
        }
        edits.push({ index: link.index, length: link.length, replacement });
      });
      if (!edits.length) continue;
      edits.sort((a, b) => b.index - a.index);
      let line = lines[i];
      for (const edit of edits) line = line.slice(0, edit.index) + edit.replacement + line.slice(edit.index + edit.length);
      lines[i] = line; changed += edits.length;
    }
    return { text: changed ? lines.join(eol) : source, changed };
  }

  // --------------------------------------------------------------- resolver
  // Link resolution the way a vault user expects it: exact path first, then
  // relative to the linking note, then the closest file with that name.
  function buildResolver(paths) {
    const byLower = new Map(); const byBase = new Map();
    for (const path of paths) {
      byLower.set(path.toLowerCase(), path);
      const base = baseName(path).toLowerCase();
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(path);
    }
    const best = (list) => list.slice().sort((a, b) => (a.split('/').length - b.split('/').length) || (a.length - b.length) || a.localeCompare(b))[0];
    function resolve(target, sourcePath) {
      const cleaned = String(target == null ? '' : target).trim().replace(/\\/g, '/').replace(/^\/+/, '');
      if (!cleaned) return sourcePath || null;
      const candidates = /\.md$/i.test(cleaned) ? [cleaned] : [cleaned + '.md', cleaned];
      for (const candidate of candidates) {
        const lower = candidate.toLowerCase();
        if (byLower.has(lower)) return byLower.get(lower);
        if (sourcePath) {
          const relative = normalizePath(joinPath(dirName(sourcePath), candidate));
          if (relative && byLower.has(relative.toLowerCase())) return byLower.get(relative.toLowerCase());
        }
        const named = byBase.get(baseName(lower)) || [];
        const matches = lower.includes('/') ? named.filter((p) => p.toLowerCase().endsWith('/' + lower)) : named;
        if (matches.length) return best(matches);
      }
      return null;
    }
    // Shortest text that still resolves to `path`.
    function linkText(path) {
      const isNote = kindOf(path) === 'note';
      const short = isNote ? stem(path) : baseName(path);
      const same = byBase.get(baseName(path).toLowerCase()) || [];
      if (same.length <= 1 || best(same) === path) return short;
      return isNote ? notePathWithoutExt(path) : path;
    }
    return { resolve, linkText, has: (path) => byLower.has(String(path).toLowerCase()) };
  }

  // ------------------------------------------------------------------ dates
  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  // Moment-style tokens, the subset daily notes and templates rely on.
  function formatDate(date, format) {
    const pad = (n) => String(n).padStart(2, '0');
    const tokens = {
      YYYY: date.getFullYear(), YY: String(date.getFullYear()).slice(-2),
      MMMM: MONTHS[date.getMonth()], MM: pad(date.getMonth() + 1), M: date.getMonth() + 1,
      DD: pad(date.getDate()), D: date.getDate(), dddd: DAYS[date.getDay()],
      HH: pad(date.getHours()), H: date.getHours(), mm: pad(date.getMinutes()), ss: pad(date.getSeconds()),
    };
    return String(format || 'YYYY-MM-DD').replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MM|M|DD|D|dddd|HH|H|mm|ss/g, (token, literal) => (literal !== undefined ? literal : tokens[token]));
  }

  return {
    IMAGE_EXTS, AUDIO_EXTS, VIDEO_EXTS, formatDate,
    baseName, dirName, extOf, stem, kindOf, joinPath, normalizePath, notePathWithoutExt,
    splitFrontmatter, parseYaml, stringifyYaml, withFrontmatter, listValue,
    maskLines, parseWikiInner, extract, rewriteLinks, buildResolver,
  };
});
