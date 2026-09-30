'use strict';

// Vault search. Query language:
//   word another        both words, anywhere in the note or its name
//   "exact phrase"      the phrase as typed
//   -word               must not appear
//   a OR b              either side
//   /regex/             regular expression
//   file:name  path:folder  tag:#projet  content:word
const Meta = require('../shared/meta.js');

function tokenizeQuery(query) {
  const tokens = []; const text = String(query || '');
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i++; continue; }
    let negate = false;
    if (text[i] === '-' && i + 1 < text.length && !/\s/.test(text[i + 1])) { negate = true; i++; }
    let field = '';
    const operator = /^(file|path|tag|content):/i.exec(text.slice(i));
    if (operator) { field = operator[1].toLowerCase(); i += operator[0].length; }
    let value = ''; let kind = 'text';
    if (text[i] === '"') {
      const end = text.indexOf('"', i + 1);
      value = text.slice(i + 1, end < 0 ? text.length : end); i = end < 0 ? text.length : end + 1; kind = 'phrase';
    } else if (text[i] === '/' && text.indexOf('/', i + 1) > i) {
      const end = text.indexOf('/', i + 1);
      value = text.slice(i + 1, end); i = end + 1; kind = 'regex';
    } else {
      const end = text.slice(i).search(/\s/);
      value = end < 0 ? text.slice(i) : text.slice(i, i + end); i += value.length;
    }
    if (!value) continue;
    if (!field && !negate && kind === 'text' && value === 'OR') { tokens.push({ or: true }); continue; }
    tokens.push({ field: field || 'any', kind, value, negate });
  }
  return tokens;
}

function compile(clause) {
  if (clause.kind === 'regex') {
    try { return new RegExp(clause.value, 'giu'); } catch { /* fall through: treat as plain text */ }
  }
  return new RegExp(clause.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
}

function parseQuery(query) {
  const groups = [[]];
  for (const token of tokenizeQuery(query)) {
    if (token.or) { if (groups[groups.length - 1].length) groups.push([]); continue; }
    groups[groups.length - 1].push({ ...token, pattern: compile(token) });
  }
  return groups.filter((group) => group.length);
}

function testPattern(pattern, text) { pattern.lastIndex = 0; return pattern.test(text); }

function matchClause(clause, entry, text) {
  switch (clause.field) {
    case 'file': return testPattern(clause.pattern, Meta.baseName(entry.path));
    case 'path': return testPattern(clause.pattern, entry.path);
    case 'tag': {
      const wanted = clause.value.replace(/^#/, '').toLowerCase();
      return !!(entry.meta && entry.meta.tags.some((tag) => { const lower = tag.toLowerCase(); return lower === wanted || lower.startsWith(wanted + '/'); }));
    }
    case 'content': return testPattern(clause.pattern, text);
    default: return testPattern(clause.pattern, Meta.baseName(entry.path)) || testPattern(clause.pattern, text);
  }
}

function search(vault, query, options = {}) {
  const groups = parseQuery(query);
  if (!groups.length) return { query, results: [], total: 0 };
  const limit = Math.max(1, Math.min(Number(options.limit) || 100, 500));
  const perFile = Math.max(1, Math.min(Number(options.matchesPerFile) || 12, 60));
  const results = [];
  for (const entry of vault.files.values()) {
    if (entry.kind !== 'note') continue;
    const text = vault.texts.get(entry.path) || '';
    const group = groups.find((clauses) => clauses.every((clause) => matchClause(clause, entry, text) !== clause.negate));
    if (!group) continue;
    const patterns = group.filter((clause) => !clause.negate && (clause.field === 'any' || clause.field === 'content')).map((clause) => clause.pattern);
    const matches = []; let count = 0;
    if (patterns.length) {
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const ranges = [];
        for (const pattern of patterns) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(lines[i]))) {
            if (!match[0]) { pattern.lastIndex++; continue; }
            ranges.push([match.index, match.index + match[0].length]);
          }
        }
        if (!ranges.length) continue;
        count += ranges.length;
        if (matches.length < perFile) {
          // Long lines are cut around the first hit so the snippet stays readable.
          const first = ranges[0][0]; const from = Math.max(0, first - 80); const to = Math.min(lines[i].length, first + 220);
          matches.push({ line: i, text: lines[i].slice(from, to), offset: from, ranges: ranges.filter((range) => range[0] >= from && range[1] <= to).map((range) => [range[0] - from, range[1] - from]) });
        }
      }
    }
    const nameHit = group.some((clause) => !clause.negate && clause.field !== 'content' && clause.field !== 'tag' && testPattern(clause.pattern, Meta.stem(entry.path)));
    results.push({ path: entry.path, count, nameHit, mtime: entry.mtime, matches });
  }
  results.sort((a, b) => (Number(b.nameHit) - Number(a.nameHit)) || (b.count - a.count) || (b.mtime - a.mtime));
  return { query, total: results.length, results: results.slice(0, limit) };
}

module.exports = { search, parseQuery, tokenizeQuery };
