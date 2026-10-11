'use strict';

// Three-way line merge for notes edited on two computers since their last
// common version. Edits to different parts of a note combine; edits to the
// same lines (or next to each other) are a real conflict and return null.
const MAX_CELLS = 4e6;

// Hunks turning `a` into `b`: { aStart, aLen, bStart, bLen }. Null when the
// changed middle is too large to compare cheaply.
function diff(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf); const B = b.slice(pre, b.length - suf);
  const n = A.length; const m = B.length;
  if (!n && !m) return [];
  if (!n || !m) return [{ aStart: pre, aLen: n, bStart: pre, bLen: m }];
  if (n * m > MAX_CELLS) return null;
  // Longest common subsequence of every pair of suffixes.
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = A[i] === B[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const hunks = []; let open = null; let i = 0; let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { if (open) { hunks.push(open); open = null; } i++; j++; continue; }
    if (!open) open = { aStart: pre + i, aLen: 0, bStart: pre + j, bLen: 0 };
    if (j < m && (i >= n || table[i * width + j + 1] >= table[(i + 1) * width + j])) { open.bLen++; j++; } else { open.aLen++; i++; }
  }
  if (open) hunks.push(open);
  return hunks;
}

function merge3(base, mine, theirs) {
  if (mine === theirs) return mine;
  if (mine === base) return theirs;
  if (theirs === base) return mine;
  const O = base.split('\n'); const A = mine.split('\n'); const B = theirs.split('\n');
  const ha = diff(O, A); const hb = diff(O, B);
  if (!ha || !hb) return null;
  const all = [...ha.map((hunk) => ({ ...hunk, side: 'a' })), ...hb.map((hunk) => ({ ...hunk, side: 'b' }))]
    .sort((x, y) => x.aStart - y.aStart || x.aLen - y.aLen);
  const out = []; let at = 0; let k = 0;
  while (k < all.length) {
    const start = all[k].aStart; let end = start + all[k].aLen;
    const group = [all[k++]];
    // Overlapping or touching changes are decided together.
    while (k < all.length && all[k].aStart <= end) { end = Math.max(end, all[k].aStart + all[k].aLen); group.push(all[k++]); }
    for (let line = at; line < start; line++) out.push(O[line]);
    const side = (name, lines) => {
      const list = group.filter((hunk) => hunk.side === name);
      if (!list.length) return null;
      const first = list[0]; const last = list[list.length - 1];
      return lines.slice(first.bStart - (first.aStart - start), last.bStart + last.bLen + (end - (last.aStart + last.aLen)));
    };
    const fromA = side('a', A); const fromB = side('b', B);
    if (fromA && fromB && fromA.join('\n') !== fromB.join('\n')) return null;
    out.push(...(fromA || fromB));
    at = end;
  }
  for (let line = at; line < O.length; line++) out.push(O[line]);
  return out.join('\n');
}

module.exports = { diff, merge3 };
