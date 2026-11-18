// Portable, deliberately restricted typography stored inside Markdown.
// No CSS declarations, URLs or system paths from documents reach the page.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OpaleTypography = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function parse(value) {
    const out = {};
    for (const item of String(value || '').slice(0, 800).split(';')) {
      const at = item.indexOf('='); if (at < 0) continue;
      const key = item.slice(0, at), v = item.slice(at + 1);
      if (key === 'font' && /^[A-Za-z][A-Za-z0-9 ]{0,70}$/.test(v)) out.font = v;
      if (key === 'size' && Number(v) >= 8 && Number(v) <= 144) out.size = Number(v);
      if (key === 'weight' && /^[1-9]00$/.test(v)) out.weight = Number(v);
      if ((key === 'color' || key === 'highlight') && /^#[0-9a-f]{6}$/i.test(v)) out[key] = v.toLowerCase();
      if (key === 'spacing' && Number(v) >= -2 && Number(v) <= 20) out.spacing = Number(v);
      if (key === 'leading' && Number(v) >= 1 && Number(v) <= 3) out.leading = Number(v);
      if (key === 'align' && /^(left|center|right|justify)$/.test(v)) out.align = v;
      if (['italic', 'underline', 'strike'].includes(key) && /^(0|1)$/.test(v)) out[key] = Number(v);
    }
    return out;
  }
  function encode(style) { return Object.entries(parse(Object.entries(style).map(([k, v]) => `${k}=${v}`).join(';'))).map(([k, v]) => `${k}=${v}`).join(';'); }
  function css(value) {
    const s = typeof value === 'string' ? parse(value) : parse(encode(value));
    const out = [];
    if (s.font) out.push(`font-family:'${s.font}'`);
    if (s.size) out.push(`font-size:${s.size}px`);
    if (s.weight) out.push(`font-weight:${s.weight}`);
    if (s.color) out.push(`color:${s.color}`);
    if (s.highlight) out.push(`background-color:${s.highlight}`);
    if (s.italic !== undefined) out.push(`font-style:${s.italic ? 'italic' : 'normal'}`);
    const decorations = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean);
    if (decorations.length || s.underline !== undefined || s.strike !== undefined) out.push(`text-decoration:${decorations.join(' ') || 'none'}`);
    if (s.spacing !== undefined) out.push(`letter-spacing:${s.spacing}px`);
    if (s.leading) out.push(`line-height:${s.leading}`);
    if (s.align) out.push(`display:block;text-align:${s.align}`);
    return out.join(';');
  }
  return { parse, encode, css };
});
