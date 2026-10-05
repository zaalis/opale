// Opale — moodboards: the library of vector shapes (KINDS.shape in
// shared/board.js, where data.shape is one of the ids below). Every shape
// draws itself as SVG markup inside 0..w × 0..h from a style
// { fill, stroke, strokeWidth, dash, opacity } and says where its label goes.
// Pure functions only: nothing here touches the DOM, so the module also runs
// in Node (tests, export).

// ------------------------------------------------------------- categories
export const CATEGORIES = [
  { id: 'basic', name: 'Formes de base' },
  { id: 'flow', name: 'Diagramme de flux' },
  { id: 'arrows', name: 'Flèches en bloc' },
  { id: 'bubbles', name: 'Bulles' },
  { id: 'uml', name: 'UML' },
  { id: 'bpmn', name: 'BPMN' },
  { id: 'data', name: 'Données (entité-relation)' },
  { id: 'infra', name: 'Infrastructure & cloud' },
  { id: 'ui', name: 'Prototype (interface)' },
];

export const SHAPES = {};

// -------------------------------------------------------------- utilities
const FALLBACK_FILL = '#ffffff';
const FALLBACK_STROKE = '#1f2937';
const MAX_SIZE = 1e6;
const KAPPA = 0.5523;

const finite = (value, fallback = 0) => {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : fallback;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dim = (value) => clamp(finite(value), 0, MAX_SIZE);

// Numbers are written with at most two decimals, never NaN, never "-0".
function num(value) {
  const rounded = Math.round(finite(value) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Only colour-like strings get into the markup; anything else falls back.
function safeColor(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) return text;
  if (text.length <= 64 && /^(?:rgb|hsl)a?\((?:[\d.\s,%/+-]|deg|turn|rad)+\)$/i.test(text)) return text;
  const lower = text.toLowerCase();
  if (lower === 'transparent' || lower === 'none') return lower;
  if (lower === 'currentcolor') return 'currentColor';
  return fallback;
}

function normStyle(s) {
  const style = s && typeof s === 'object' ? s : {};
  return {
    fill: safeColor(style.fill, FALLBACK_FILL),
    stroke: safeColor(style.stroke, FALLBACK_STROKE),
    strokeWidth: clamp(finite(style.strokeWidth, 2), 0, 64),
    dash: ['solid', 'dashed', 'dotted'].includes(style.dash) ? style.dash : 'solid',
    opacity: clamp(finite(style.opacity, 1), 0, 1),
  };
}

const attr = (pairs) => Object.entries(pairs)
  .filter(([, value]) => value !== undefined && value !== null && value !== '')
  .map(([key, value]) => `${key}="${esc(typeof value === 'number' ? num(value) : value)}"`)
  .join(' ');

// ------------------------------------------------------------ path builder
// D('M', [x, y], 'L', [x, y], 'Z'): points are [x, y] pairs, numbers are
// rounded, strings are commands or flags.
function D(...parts) {
  return parts.map((part) => (Array.isArray(part) ? `${num(part[0])} ${num(part[1])}` : typeof part === 'number' ? String(num(part)) : part)).join(' ');
}

function poly(points) {
  return D('M', points[0], ...points.slice(1).flatMap((p) => ['L', p]), 'Z');
}

function polyline(points) {
  return D('M', points[0], ...points.slice(1).flatMap((p) => ['L', p]));
}

// Polygon whose corners are rounded (radius per corner, or one for all).
function roundPoly(points, radius) {
  const n = points.length;
  const parts = [];
  for (let k = 0; k < n; k++) {
    const p = points[k];
    const r = Array.isArray(radius) ? radius[k] || 0 : radius;
    if (!(r > 0)) { parts.push(k ? 'L' : 'M', p); continue; }
    const a = points[(k + n - 1) % n];
    const b = points[(k + 1) % n];
    const ta = Math.min(r / (Math.hypot(a[0] - p[0], a[1] - p[1]) || 1), 0.5);
    const tb = Math.min(r / (Math.hypot(b[0] - p[0], b[1] - p[1]) || 1), 0.5);
    const p1 = [p[0] + (a[0] - p[0]) * ta, p[1] + (a[1] - p[1]) * ta];
    const p2 = [p[0] + (b[0] - p[0]) * tb, p[1] + (b[1] - p[1]) * tb];
    const c1 = [p1[0] + (p[0] - p1[0]) * KAPPA, p1[1] + (p[1] - p1[1]) * KAPPA];
    const c2 = [p2[0] + (p[0] - p2[0]) * KAPPA, p2[1] + (p[1] - p2[1]) * KAPPA];
    parts.push(k ? 'L' : 'M', p1, 'C', c1, c2, p2);
  }
  parts.push('Z');
  return D(...parts);
}

const rad = (deg) => (deg * Math.PI) / 180;
const at = (cx, cy, rx, ry, deg) => [cx + rx * Math.cos(rad(deg)), cy + ry * Math.sin(rad(deg))];

// Elliptic arc as cubic curves (angles in degrees, y down, 0 = right).
function arc(cx, cy, rx, ry, a0, a1) {
  const out = [];
  const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90));
  const delta = rad((a1 - a0) / steps);
  const k = (4 / 3) * Math.tan(delta / 4);
  let t = rad(a0);
  for (let s = 0; s < steps; s++) {
    const t2 = t + delta;
    out.push('C',
      [cx + rx * (Math.cos(t) - k * Math.sin(t)), cy + ry * (Math.sin(t) + k * Math.cos(t))],
      [cx + rx * (Math.cos(t2) + k * Math.sin(t2)), cy + ry * (Math.sin(t2) - k * Math.cos(t2))],
      [cx + rx * Math.cos(t2), cy + ry * Math.sin(t2)]);
    t = t2;
  }
  return out;
}

function ellipsePath(cx, cy, rx, ry) {
  return D('M', [cx + rx, cy], ...arc(cx, cy, rx, ry, 0, 360), 'Z');
}

// Normalise arbitrary points to the unit square.
function fit(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs); const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1; const spanY = Math.max(...ys) - minY || 1;
  return points.map(([x, y]) => [clamp((x - minX) / spanX, 0, 1), clamp((y - minY) / spanY, 0, 1)]);
}

function starPoints(count, inner, jitter = []) {
  const points = [];
  for (let k = 0; k < count * 2; k++) {
    const r = k % 2 ? inner * (jitter[k] || 1) : (jitter[k] || 1);
    points.push(at(0, 0, r, r, -90 + (k * 180) / count));
  }
  return fit(points);
}

// --------------------------------------------------------------- elements
const P = (d, a) => `<path d="${esc(d)}" ${a}/>`;
function R(x, y, w, h, r, a) {
  const width = Math.max(0, w); const height = Math.max(0, h);
  const radius = clamp(finite(r), 0, Math.min(width, height) / 2);
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}"${radius > 0 ? ` rx="${num(radius)}"` : ''} ${a}/>`;
}
const E = (cx, cy, rx, ry, a) => `<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="${num(Math.max(0, rx))}" ry="${num(Math.max(0, ry))}" ${a}/>`;
const C = (cx, cy, r, a) => `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(Math.max(0, r))}" ${a}/>`;
const L = (x1, y1, x2, y2, a) => `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" ${a}/>`;

// ---------------------------------------------------------------- context
// Geometry and paints of one drawing: the box inset by half the stroke
// width (so strokes stay inside 0..w × 0..h) and ready-made attribute sets.
function context(w, h, s, opts = {}) {
  const st = normStyle(s);
  const width = dim(w); const height = dim(h);
  const visible = st.stroke !== 'none' && st.strokeWidth > 0;
  const limit = Math.min(width, height) / (opts.line ? 1 : 3);
  const sw = Math.min(st.strokeWidth * (opts.swScale || 1), limit);
  const i = visible ? sw / 2 : 0;
  const x0 = i; const y0 = i;
  const x1 = Math.max(i, width - i); const y1 = Math.max(i, height - i);
  const W = x1 - x0; const H = y1 - y0;
  const ink = st.stroke === 'none' || st.stroke === 'transparent' ? FALLBACK_STROKE : st.stroke;
  const dsw = visible ? Math.max(Math.min(sw, limit), Math.min(1, limit)) : Math.min(1.5, limit);
  const base = Math.max(sw, 1);
  const dash = st.dash === 'dashed' ? `${num(base * 3)} ${num(base * 2)}` : st.dash === 'dotted' ? `0 ${num(base * 2)}` : '';
  const round = { 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
  const stroke = visible ? st.stroke : 'none';
  const g = {
    w: width, h: height, sw, i, x0, y0, x1, y1, W, H, cx: x0 + W / 2, cy: y0 + H / 2, m: Math.min(W, H),
    fill: st.fill, stroke, ink, dsw, opacity: st.opacity,
    p: (u, v) => [x0 + u * W, y0 + v * H],
    main: attr({ fill: st.fill, stroke, 'stroke-width': visible ? sw : '', 'stroke-dasharray': visible ? dash : '', ...round }),
    outline: attr({ fill: 'none', stroke, 'stroke-width': visible ? sw : '', 'stroke-dasharray': visible ? dash : '', ...round }),
    fillOnly: attr({ fill: st.fill, stroke: 'none' }),
    ink: attr({ fill: ink, stroke: 'none' }),
    // Decorations (inner lines, glyphs): solid, in the stroke colour.
    line: (k = 1, extra = {}) => attr({ fill: 'none', stroke: ink, 'stroke-width': dsw * k, ...round, ...extra }),
    tint: (alpha) => attr({ fill: ink, 'fill-opacity': alpha, stroke: 'none' }),
    inner: (k = 1) => attr({ fill: st.fill, stroke: ink, 'stroke-width': dsw * k, ...round }),
    dashed: (k = 1) => attr({ fill: 'none', stroke: ink, 'stroke-width': dsw * k, 'stroke-dasharray': `${num(Math.max(dsw, 1) * 4)} ${num(Math.max(dsw, 1) * 3)}`, ...round }),
  };
  g.inkColor = ink;
  return g;
}

// Unit path tokens ([u, v] pairs in 0..1) mapped to the inset box.
const mapUnit = (g, tokens, map = g.p) => tokens.map((t) => (Array.isArray(t) ? map(t[0], t[1]) : t));

// ------------------------------------------------------------- text boxes
function fitBox(box, w, h) {
  const b = box && typeof box === 'object' ? box : {};
  const x = num(clamp(finite(b.x), 0, w));
  const y = num(clamp(finite(b.y), 0, h));
  const bw = Math.max(0, Math.min(num(clamp(finite(b.w), 0, w)), Math.floor((w - x) * 100 + 1e-6) / 100));
  const bh = Math.max(0, Math.min(num(clamp(finite(b.h), 0, h)), Math.floor((h - y) * 100 + 1e-6) / 100));
  return { x, y, w: bw, h: bh };
}

const padOf = (w, h) => Math.min(10, w * 0.08, h * 0.15);
const T = {
  full: (w, h) => { const p = padOf(w, h); return { x: p, y: p, w: w - 2 * p, h: h - 2 * p }; },
  frac: (fx, fy, fw, fh) => (w, h) => ({ x: w * fx, y: h * fy, w: w * fw, h: h * fh }),
  circle: (w, h) => { const side = Math.min(w, h) * 0.68; return { x: (w - side) / 2, y: (h - side) / 2, w: side, h: side }; },
  below: (w, h) => ({ x: 0, y: h * 0.76, w, h: h * 0.24 }),
  tile: (w, h) => ({ x: w * 0.06, y: h * 0.64, w: w * 0.88, h: h * 0.32 }),
};
T.ellipse = T.frac(0.15, 0.15, 0.7, 0.7);
T.diamond = T.frac(0.25, 0.25, 0.5, 0.5);

// ------------------------------------------------------------ registration
function add(category, id, name, keywords, w, h, draw, text = T.full, extra = {}) {
  const render = (rw, rh, s, opts) => {
    const g = context(rw, rh, s, opts || extra.context);
    let out = '';
    try { out = draw(g); } catch { out = ''; }
    return g.opacity < 1 ? `<g opacity="${num(g.opacity)}">${out}</g>` : out;
  };
  SHAPES[id] = {
    id, name, category, keywords, w, h,
    text: (tw, th) => { const bw = dim(tw); const bh = dim(th); return fitBox(text(bw, bh), bw, bh); },
    render: (rw, rh, s) => render(rw, rh, s),
  };
  if (extra.style) SHAPES[id].style = { ...extra.style };
}

// ------------------------------------------------------- shared drawings
const rectShape = (radius = () => 0) => (g) => R(g.x0, g.y0, g.W, g.H, radius(g), g.main);
const ellipseShape = (g) => E(g.cx, g.cy, g.W / 2, g.H / 2, g.main);
const circleShape = (g) => C(g.cx, g.cy, g.m / 2, g.main);
const unitPoly = (points) => (g) => P(poly(points.map(([u, v]) => g.p(u, v))), g.main);
const DIAMOND = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
const diamondShape = unitPoly(DIAMOND);
const roundRadius = (g) => Math.min(14, g.m * 0.25);

function hexagon(g) {
  const k = Math.min(g.W * 0.25, g.H * 0.5);
  return P(poly([[g.x0 + k, g.y0], [g.x1 - k, g.y0], [g.x1, g.cy], [g.x1 - k, g.y1], [g.x0 + k, g.y1], [g.x0, g.cy]]), g.main);
}
const hexText = (w, h) => { const k = Math.min(w * 0.25, h * 0.5); return { x: k * 0.6, y: h * 0.1, w: w - k * 1.2, h: h * 0.8 }; };

function cylinderGeometry(g) {
  const ry = Math.min(g.H * 0.15, g.W * 0.22);
  return { ry, rx: g.W / 2 };
}
function cylinder(g, rims = 0) {
  const { rx, ry } = cylinderGeometry(g);
  const top = g.y0 + ry;
  const body = D('M', [g.x0, top], 'L', [g.x0, g.y1 - ry], 'A', [rx, ry], 0, 0, 0, [g.x1, g.y1 - ry], 'L', [g.x1, top], 'A', [rx, ry], 0, 0, 0, [g.x0, top], 'Z');
  let out = P(body, g.main) + P(D('M', [g.x0, top], 'A', [rx, ry], 0, 0, 0, [g.x1, top]), g.outline);
  for (let k = 1; k <= rims; k++) {
    const y = top + ry * 0.55 * k;
    if (y < g.y1 - ry) out += P(D('M', [g.x0, y], 'A', [rx, ry], 0, 0, 0, [g.x1, y]), g.outline);
  }
  return out;
}
const cylinderText = (w, h) => { const ry = Math.min(h * 0.15, w * 0.22); return { x: w * 0.08, y: ry * 2 + 2, w: w * 0.84, h: h - ry * 3 - 4 }; };

function cube(g, ratio = 0.2) {
  const d = g.m * ratio;
  const { x0, y0, x1, y1 } = g;
  return P(poly([[x0, y0 + d], [x0 + d, y0], [x1, y0], [x1, y1 - d], [x1 - d, y1], [x0, y1]]), g.main)
    + P(poly([[x0, y0 + d], [x0 + d, y0], [x1, y0], [x1 - d, y0 + d]]), g.tint(0.06))
    + P(poly([[x1 - d, y0 + d], [x1, y0], [x1, y1 - d], [x1 - d, y1]]), g.tint(0.14))
    + P(D('M', [x0, y0 + d], 'L', [x1 - d, y0 + d], 'L', [x1, y0], 'M', [x1 - d, y0 + d], 'L', [x1 - d, y1]), g.outline);
}
const cubeText = (ratio) => (w, h) => { const d = Math.min(w, h) * ratio; const p = padOf(w - d, h - d); return { x: p, y: d + p, w: w - d - 2 * p, h: h - d - 2 * p }; };

function dogEar(g, size) {
  const f = Math.min(g.W, g.H, size);
  const { x0, y0, x1, y1 } = g;
  return P(poly([[x0, y0], [x1 - f, y0], [x1, y0 + f], [x1, y1], [x0, y1]]), g.main)
    + P(poly([[x1 - f, y0], [x1 - f, y0 + f], [x1, y0 + f]]), g.tint(0.1))
    + P(polyline([[x1 - f, y0], [x1 - f, y0 + f], [x1, y0 + f]]), g.outline);
}

// Document outline with a wavy bottom edge (amplitude a, trough on y1).
function docPath(x0, y0, x1, y1, a) {
  const W = x1 - x0; const yb = y1 - a; const c = a * 3.46;
  return D('M', [x0, y0], 'L', [x1, y0], 'L', [x1, yb], 'C', [x1 - W / 3, yb - c], [x0 + W / 3, yb + c], [x0, yb], 'Z');
}
const docAmp = (W, H) => Math.min(H * 0.08, W * 0.1);

// Cloud: union of circles, computed once in unit coordinates.
const CLOUD = (() => {
  const circles = [[0.24, 0.62, 0.2], [0.4, 0.36, 0.24], [0.66, 0.34, 0.22], [0.82, 0.6, 0.18], [0.6, 0.72, 0.18], [0.4, 0.74, 0.16]];
  const n = circles.length;
  const ox = circles.reduce((sum, c) => sum + c[0], 0) / n;
  const oy = circles.reduce((sum, c) => sum + c[1], 0) / n;
  const meet = ([ax, ay, ar], [bx, by, br]) => {
    const d = Math.hypot(bx - ax, by - ay);
    const a = (ar * ar - br * br + d * d) / (2 * d);
    const hh = Math.sqrt(Math.max(0, ar * ar - a * a));
    const mx = ax + (a * (bx - ax)) / d; const my = ay + (a * (by - ay)) / d;
    const p1 = [mx + (hh * (by - ay)) / d, my - (hh * (bx - ax)) / d];
    const p2 = [mx - (hh * (by - ay)) / d, my + (hh * (bx - ax)) / d];
    return Math.hypot(p1[0] - ox, p1[1] - oy) > Math.hypot(p2[0] - ox, p2[1] - oy) ? p1 : p2;
  };
  const joints = circles.map((c, k) => meet(c, circles[(k + 1) % n]));
  const tokens = []; const samples = [];
  circles.forEach(([cx, cy, r], k) => {
    const s = joints[(k + n - 1) % n]; const e = joints[k];
    const a0 = (Math.atan2(s[1] - cy, s[0] - cx) * 180) / Math.PI;
    let a1 = (Math.atan2(e[1] - cy, e[0] - cx) * 180) / Math.PI;
    while (a1 <= a0) a1 += 360;
    tokens.push(...arc(cx, cy, r, r, a0, a1));
    for (let a = a0; a <= a1; a += 2) samples.push(at(cx, cy, r, r, a));
    samples.push(e);
  });
  const xs = samples.map((p) => p[0]); const ys = samples.map((p) => p[1]);
  const minX = Math.min(...xs); const minY = Math.min(...ys);
  const sx = Math.max(...xs) - minX; const sy = Math.max(...ys) - minY;
  const norm = (p) => [clamp((p[0] - minX) / sx, 0, 1), clamp((p[1] - minY) / sy, 0, 1)];
  return ['M', norm(joints[n - 1]), ...tokens.map((t) => (Array.isArray(t) ? norm(t) : t)), 'Z'];
})();
const cloudPath = (g, map = g.p) => D(...mapUnit(g, CLOUD, map));

// Block arrows: geometry along (u) and across (v) the arrow, then oriented.
function orient(g, dir) {
  const { x0, y0, x1, y1, W, H } = g;
  if (dir === 'left') return { L: W, T: H, p: (u, v) => [x1 - u, y0 + v] };
  if (dir === 'down') return { L: H, T: W, p: (u, v) => [x0 + v, y0 + u] };
  if (dir === 'up') return { L: H, T: W, p: (u, v) => [x0 + v, y1 - u] };
  return { L: W, T: H, p: (u, v) => [x0 + u, y0 + v] };
}
function arrowPoints(Ln, Tn, kind) {
  const hl = Math.min(Ln * (kind === 'double' ? 0.4 : 0.6), Tn * 0.8);
  const a = Tn * 0.25; const b = Tn * 0.75; const c = Tn / 2;
  if (kind === 'double') return [[0, c], [hl, 0], [hl, a], [Ln - hl, a], [Ln - hl, 0], [Ln, c], [Ln - hl, Tn], [Ln - hl, b], [hl, b], [hl, Tn]];
  const points = [[0, a], [Ln - hl, a], [Ln - hl, 0], [Ln, c], [Ln - hl, Tn], [Ln - hl, b], [0, b]];
  if (kind === 'notched') points.push([Math.min(hl * 0.5, Ln * 0.2), c]);
  return points;
}
const blockArrow = (dir, kind) => (g) => { const o = orient(g, dir); return P(poly(arrowPoints(o.L, o.T, kind).map(([u, v]) => o.p(u, v))), g.main); };
const arrowText = (dir, kind) => (w, h) => {
  const vertical = dir === 'up' || dir === 'down';
  const Ln = vertical ? h : w; const Tn = vertical ? w : h;
  const hl = Math.min(Ln * (kind === 'double' ? 0.4 : 0.6), Tn * 0.8);
  const start = kind === 'double' ? hl : kind === 'notched' ? Math.min(hl * 0.5, Ln * 0.2) : Ln * 0.04;
  const end = Ln - hl;
  const along = dir === 'left' || dir === 'up' ? [Ln - end, end - start] : [start, end - start];
  return vertical ? { x: Tn * 0.25, y: along[0], w: Tn * 0.5, h: along[1] } : { x: along[0], y: Tn * 0.25, w: along[1], h: Tn * 0.5 };
};

// Line-art glyphs drawn on a 24 × 24 grid, scaled into a square box.
function glyph(g, markup, x, y, size, opts = {}) {
  const k = Math.max(0, size) / 24;
  if (!(k > 0)) return '';
  const px = clamp(size * 0.075, 0.6, 4) * (opts.weight || 1);
  const a = attr({ fill: 'none', stroke: opts.color || g.inkColor, 'stroke-width': px / k, 'stroke-opacity': opts.alpha, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  return `<g transform="translate(${num(x)} ${num(y)}) scale(${Math.round(k * 10000) / 10000})" ${a}>${markup}</g>`;
}

// ------------------------------------------------------------------ basic
add('basic', 'rect', 'Rectangle', 'rectangle carré boîte cadre rectangle box square', 180, 120, rectShape());
add('basic', 'roundrect', 'Rectangle arrondi', 'rectangle arrondi coins ronds rounded rectangle box', 180, 120, rectShape(roundRadius));
add('basic', 'ellipse', 'Ellipse', 'ellipse ovale ovale oval', 180, 120, ellipseShape, T.ellipse);
add('basic', 'circle', 'Cercle', 'cercle rond disque circle round', 120, 120, circleShape, T.circle);
add('basic', 'triangle', 'Triangle', 'triangle isocèle pyramide triangle', 140, 120,
  unitPoly([[0.5, 0], [1, 1], [0, 1]]), T.frac(0.25, 0.48, 0.5, 0.44));
add('basic', 'right-triangle', 'Triangle rectangle', 'triangle rectangle angle droit right triangle', 140, 120,
  unitPoly([[0, 0], [1, 1], [0, 1]]), T.frac(0.06, 0.5, 0.48, 0.44));
add('basic', 'diamond', 'Losange', 'losange carreau diamant diamond rhombus', 160, 120, diamondShape, T.diamond);
add('basic', 'pentagon', 'Pentagone', 'pentagone cinq côtés pentagon', 130, 124,
  unitPoly([[0.5, 0], [1, 0.382], [0.809, 1], [0.191, 1], [0, 0.382]]), T.frac(0.2, 0.32, 0.6, 0.58));
add('basic', 'hexagon', 'Hexagone', 'hexagone six côtés hexagon', 160, 120, hexagon, hexText);
add('basic', 'octagon', 'Octogone', 'octogone huit côtés stop octagon', 130, 130, (g) => {
  const c = g.m * 0.29; const { x0, y0, x1, y1 } = g;
  return P(poly([[x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c], [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c]]), g.main);
}, (w, h) => { const c = Math.min(w, h) * 0.15; return { x: c, y: c, w: w - 2 * c, h: h - 2 * c }; });
const STAR5 = starPoints(5, 0.4);
add('basic', 'star', 'Étoile', 'étoile cinq branches favori star', 130, 124, unitPoly(STAR5), T.frac(0.3, 0.38, 0.4, 0.34));
const STAR4 = starPoints(4, 0.32);
add('basic', 'star-4', 'Étoile à 4 branches', 'étoile quatre branches étincelle star sparkle', 120, 120, unitPoly(STAR4), T.frac(0.32, 0.32, 0.36, 0.36));
add('basic', 'cross', 'Croix', 'croix plus ajouter cross plus', 120, 120,
  unitPoly([[1 / 3, 0], [2 / 3, 0], [2 / 3, 1 / 3], [1, 1 / 3], [1, 2 / 3], [2 / 3, 2 / 3], [2 / 3, 1], [1 / 3, 1], [1 / 3, 2 / 3], [0, 2 / 3], [0, 1 / 3], [1 / 3, 1 / 3]]),
  T.frac(0.05, 1 / 3, 0.9, 1 / 3));
const skew = (W, H) => Math.min(W * 0.25, H * 0.6);
const skewText = (w, h) => { const s = skew(w, h); return { x: s * 0.9, y: h * 0.1, w: w - s * 1.8, h: h * 0.8 }; };
add('basic', 'parallelogram', 'Parallélogramme', 'parallélogramme incliné parallelogram slanted', 180, 110, (g) => {
  const s = skew(g.W, g.H);
  return P(poly([[g.x0 + s, g.y0], [g.x1, g.y0], [g.x1 - s, g.y1], [g.x0, g.y1]]), g.main);
}, skewText);
add('basic', 'parallelogram-alt', 'Parallélogramme inversé', 'parallélogramme inversé incliné parallelogram reverse', 180, 110, (g) => {
  const s = skew(g.W, g.H);
  return P(poly([[g.x0, g.y0], [g.x1 - s, g.y0], [g.x1, g.y1], [g.x0 + s, g.y1]]), g.main);
}, skewText);
add('basic', 'trapezoid', 'Trapèze', 'trapèze trapezoid trapezium', 180, 110, (g) => {
  const s = skew(g.W, g.H);
  return P(poly([[g.x0 + s, g.y0], [g.x1 - s, g.y0], [g.x1, g.y1], [g.x0, g.y1]]), g.main);
}, skewText);
add('basic', 'trapezoid-alt', 'Trapèze inversé', 'trapèze inversé trapezoid inverted', 180, 110, (g) => {
  const s = skew(g.W, g.H);
  return P(poly([[g.x0, g.y0], [g.x1, g.y0], [g.x1 - s, g.y1], [g.x0 + s, g.y1]]), g.main);
}, skewText);
add('basic', 'cylinder', 'Cylindre', 'cylindre tube base de données cylinder', 120, 140, (g) => cylinder(g), cylinderText);
add('basic', 'cube', 'Cube', 'cube boîte 3d volume box', 130, 130, (g) => cube(g, 0.2), cubeText(0.2));
add('basic', 'cloud', 'Nuage', 'nuage cloud', 180, 120, (g) => P(cloudPath(g), g.main), T.frac(0.2, 0.3, 0.6, 0.5));
const HEART = ['M', [0.5, 1], 'C', [0.5, 1], [0, 0.62], [0, 0.3], 'C', [0, 0.12], [0.13, 0], [0.28, 0], 'C', [0.39, 0], [0.47, 0.07], [0.5, 0.17],
  'C', [0.53, 0.07], [0.61, 0], [0.72, 0], 'C', [0.87, 0], [1, 0.12], [1, 0.3], 'C', [1, 0.62], [0.5, 1], [0.5, 1], 'Z'];
add('basic', 'heart', 'Cœur', 'coeur cœur amour like heart love', 130, 120, (g) => P(D(...mapUnit(g, HEART)), g.main), T.frac(0.2, 0.2, 0.6, 0.42));
add('basic', 'moon', 'Lune', 'lune croissant nuit moon crescent night', 100, 124, (g) => {
  const ua = (rx, ry) => [rx * g.W, ry * g.H];
  return P(D('M', g.p(1, 0.1), 'A', ua(0.625, 0.5), 0, 1, 0, g.p(1, 0.9), 'A', ua(0.5, 0.4), 0, 0, 1, g.p(1, 0.1), 'Z'), g.main);
}, T.frac(0.06, 0.3, 0.42, 0.4));
add('basic', 'ring', 'Anneau', 'anneau donut beignet couronne ring donut', 130, 130, (g) => {
  const t = g.m * 0.28;
  const d = ellipsePath(g.cx, g.cy, g.W / 2, g.H / 2) + ' ' + ellipsePath(g.cx, g.cy, Math.max(0, g.W / 2 - t), Math.max(0, g.H / 2 - t));
  return P(d, `fill-rule="evenodd" ${g.main}`);
}, T.frac(0.3, 0.3, 0.4, 0.4));
add('basic', 'stadium', 'Stade (pilule)', 'stade pilule capsule arrondi stadium pill capsule', 180, 80,
  rectShape((g) => g.m / 2), (w, h) => { const r = Math.min(w, h) / 2; return { x: r * 0.6, y: h * 0.1, w: w - r * 1.2, h: h * 0.8 }; });
add('basic', 'double-circle', 'Double cercle', 'double cercle anneau cible double circle', 120, 120, (g) => {
  const r = g.m / 2; const gap = clamp(r * 0.12, 1, 10) + g.sw;
  return C(g.cx, g.cy, r, g.main) + C(g.cx, g.cy, Math.max(0, r - gap), g.outline);
}, (w, h) => { const side = Math.min(w, h) * 0.58; return { x: (w - side) / 2, y: (h - side) / 2, w: side, h: side }; });
add('basic', 'asymmetric', 'Drapeau (asymétrique)', 'asymétrique drapeau fanion asymmetric flag', 180, 100, (g) => {
  const k = Math.min(g.W * 0.2, g.H * 0.5);
  return P(poly([[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1], [g.x0 + k, g.cy]]), g.main);
}, (w, h) => { const k = Math.min(w * 0.2, h * 0.5); return { x: k + 4, y: h * 0.1, w: w - k - 10, h: h * 0.8 }; });
add('basic', 'note', 'Note (coin plié)', 'note coin corné page post-it note dog-ear', 160, 160, (g) => dogEar(g, Math.min(g.m * 0.25, 26)));
add('basic', 'card', 'Carte (coin coupé)', 'carte coin coupé fiche card cut corner', 180, 120, (g) => {
  const c = Math.min(g.m * 0.3, 22);
  return P(poly([[g.x0 + c, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1], [g.x0, g.y0 + c]]), g.main);
});
const docText = (w, h) => { const a = docAmp(w, h); const p = padOf(w, h); return { x: p, y: p, w: w - 2 * p, h: h - 2 * a - 2 * p }; };
add('basic', 'document', 'Document', 'document page fichier vague document file', 160, 120,
  (g) => P(docPath(g.x0, g.y0, g.x1, g.y1, docAmp(g.W, g.H)), g.main), docText);
add('basic', 'multi-document', 'Documents multiples', 'documents multiples pile fichiers multiple documents stack', 170, 130, (g) => {
  const o = Math.min(g.m * 0.08, 10); const dw = g.W - 2 * o; const dh = g.H - 2 * o; const a = docAmp(dw, dh);
  return [[2 * o, 0], [o, o], [0, 2 * o]].map(([dx, dy]) => P(docPath(g.x0 + dx, g.y0 + dy, g.x0 + dx + dw, g.y0 + dy + dh, a), g.main)).join('');
}, (w, h) => { const o = Math.min(Math.min(w, h) * 0.08, 10); const b = docText(w - 2 * o, h - 2 * o); return { ...b, y: b.y + 2 * o }; });
add('basic', 'line-h', 'Ligne horizontale', 'ligne horizontale séparateur trait divider line horizontal rule', 200, 8,
  (g) => L(g.x0, g.h / 2, g.x1, g.h / 2, g.outline), (w, h) => ({ x: 0, y: 0, w, h }), { context: { line: true } });

// ------------------------------------------------------------------- flow
add('flow', 'process', 'Processus', 'processus étape action traitement process step', 180, 100, rectShape());
add('flow', 'decision', 'Décision', 'décision condition choix si losange decision condition if', 180, 120, diamondShape, T.diamond);
add('flow', 'terminator', 'Début / fin', 'terminal début fin démarrage terminator start end', 180, 70,
  rectShape((g) => g.m / 2), (w, h) => { const r = Math.min(w, h) / 2; return { x: r * 0.6, y: h * 0.1, w: w - r * 1.2, h: h * 0.8 }; });
add('flow', 'data', 'Données (entrée/sortie)', 'données entrée sortie input output data io', 180, 100, (g) => {
  const s = skew(g.W, g.H);
  return P(poly([[g.x0 + s, g.y0], [g.x1, g.y0], [g.x1 - s, g.y1], [g.x0, g.y1]]), g.main);
}, skewText);
add('flow', 'subroutine', 'Sous-programme', 'sous-programme processus prédéfini fonction subroutine predefined process', 180, 100, (g) => {
  const b = Math.min(g.W * 0.1, 16);
  return R(g.x0, g.y0, g.W, g.H, 0, g.main) + P(D('M', [g.x0 + b, g.y0], 'L', [g.x0 + b, g.y1], 'M', [g.x1 - b, g.y0], 'L', [g.x1 - b, g.y1]), g.outline);
}, (w, h) => { const b = Math.min(w * 0.1, 16); return { x: b + 4, y: h * 0.08, w: w - 2 * b - 8, h: h * 0.84 }; });
add('flow', 'manual-input', 'Saisie manuelle', 'saisie manuelle entrée clavier manual input', 180, 100, unitPoly([[0, 0.3], [1, 0], [1, 1], [0, 1]]), T.frac(0.06, 0.34, 0.88, 0.6));
add('flow', 'preparation', 'Préparation', 'préparation initialisation hexagone preparation setup', 180, 100, hexagon, hexText);
const halfRound = (W, H) => Math.min(H / 2, W);
add('flow', 'delay', 'Délai', 'délai attente pause delay wait', 160, 100, (g) => {
  const rx = halfRound(g.W, g.H); const ry = g.H / 2;
  return P(D('M', [g.x0, g.y0], 'L', [g.x1 - rx, g.y0], 'A', [rx, ry], 0, 0, 1, [g.x1 - rx, g.y1], 'L', [g.x0, g.y1], 'Z'), g.main);
}, (w, h) => ({ x: w * 0.06, y: h * 0.1, w: w * 0.94 - halfRound(w, h) * 0.4, h: h * 0.8 }));
add('flow', 'display', 'Affichage', 'affichage écran display screen', 180, 100, (g) => {
  const k = Math.min(g.W * 0.2, g.H * 0.5); const rx = Math.min(g.W * 0.15, g.H / 2); const ry = g.H / 2;
  return P(D('M', [g.x0, g.cy], 'L', [g.x0 + k, g.y0], 'L', [g.x1 - rx, g.y0], 'A', [rx, ry], 0, 0, 1, [g.x1 - rx, g.y1], 'L', [g.x0 + k, g.y1], 'Z'), g.main);
}, (w, h) => { const k = Math.min(w * 0.2, h * 0.5); return { x: k * 0.8, y: h * 0.1, w: w - k * 0.8 - Math.min(w * 0.15, h / 2) * 0.6, h: h * 0.8 }; });
add('flow', 'stored-data', 'Données stockées', 'données stockées stockage stored data storage', 180, 100, (g) => {
  const rx = Math.min(g.W * 0.15, g.H * 0.3); const ry = g.H / 2;
  return P(D('M', [g.x0 + rx, g.y0], 'L', [g.x1, g.y0], 'A', [rx, ry], 0, 0, 0, [g.x1, g.y1], 'L', [g.x0 + rx, g.y1], 'A', [rx, ry], 0, 0, 1, [g.x0 + rx, g.y0], 'Z'), g.main);
}, (w, h) => { const rx = Math.min(w * 0.15, h * 0.3); return { x: rx * 0.8, y: h * 0.1, w: w - rx * 1.8, h: h * 0.8 }; });
const storageInset = (W, H) => Math.min(Math.min(W, H) * 0.18, 18);
add('flow', 'internal-storage', 'Mémoire interne', 'mémoire interne stockage interne internal storage memory', 160, 110, (g) => {
  const k = storageInset(g.W, g.H);
  return R(g.x0, g.y0, g.W, g.H, 0, g.main) + P(D('M', [g.x0, g.y0 + k], 'L', [g.x1, g.y0 + k], 'M', [g.x0 + k, g.y0], 'L', [g.x0 + k, g.y1]), g.outline);
}, (w, h) => { const k = storageInset(w, h); return { x: k + 4, y: k + 4, w: w - k - 10, h: h - k - 10 }; });
add('flow', 'database', 'Base de données', 'base de données bdd sgbd stockage database db sql', 120, 140, (g) => cylinder(g), cylinderText);
add('flow', 'connector', 'Connecteur', 'connecteur renvoi cercle connector on-page reference', 56, 56, circleShape, T.circle);
add('flow', 'off-page', 'Renvoi de page', 'renvoi page suivante connecteur hors page off-page connector', 100, 110, (g) => {
  const k = Math.min(g.H * 0.35, g.W * 0.5);
  return P(poly([[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1 - k], [g.cx, g.y1], [g.x0, g.y1 - k]]), g.main);
}, (w, h) => ({ x: w * 0.08, y: h * 0.08, w: w * 0.84, h: h * 0.84 - Math.min(h * 0.35, w * 0.5) }));
add('flow', 'merge', 'Fusion', 'fusion merge triangle bas', 120, 100, unitPoly([[0, 0], [1, 0], [0.5, 1]]), T.frac(0.25, 0.06, 0.5, 0.44));
add('flow', 'extract', 'Extraction', 'extraction extract triangle haut', 120, 100, unitPoly([[0.5, 0], [1, 1], [0, 1]]), T.frac(0.25, 0.5, 0.5, 0.44));
add('flow', 'sort', 'Tri', 'tri trier sort', 120, 120, (g) => diamondShape(g) + L(g.x0, g.cy, g.x1, g.cy, g.outline), T.frac(0.28, 0.25, 0.44, 0.24));
add('flow', 'collate', 'Assemblage', 'assemblage collationner sablier collate hourglass', 110, 120,
  (g) => P(D('M', [g.x0, g.y0], 'L', [g.x1, g.y0], 'L', [g.x0, g.y1], 'L', [g.x1, g.y1], 'Z'), g.main), T.frac(0.25, 0.06, 0.5, 0.3));
add('flow', 'or', 'Ou', 'ou logique or junction', 80, 80, (g) => {
  const r = g.m / 2;
  return C(g.cx, g.cy, r, g.main) + P(D('M', [g.cx - r, g.cy], 'L', [g.cx + r, g.cy], 'M', [g.cx, g.cy - r], 'L', [g.cx, g.cy + r]), g.outline);
}, T.circle);
add('flow', 'summing-junction', 'Jonction de sommation', 'jonction sommation et somme summing junction and', 80, 80, (g) => {
  const r = g.m / 2; const d = r * Math.SQRT1_2;
  return C(g.cx, g.cy, r, g.main) + P(D('M', [g.cx - d, g.cy - d], 'L', [g.cx + d, g.cy + d], 'M', [g.cx + d, g.cy - d], 'L', [g.cx - d, g.cy + d]), g.outline);
}, T.circle);
add('flow', 'loop-limit', 'Limite de boucle', 'limite boucle début de boucle loop limit', 180, 100, (g) => {
  const c = Math.min(g.m * 0.3, g.W * 0.25);
  return P(poly([[g.x0 + c, g.y0], [g.x1 - c, g.y0], [g.x1, g.y0 + c], [g.x1, g.y1], [g.x0, g.y1], [g.x0, g.y0 + c]]), g.main);
});
add('flow', 'punched-tape', 'Bande perforée', 'bande perforée ruban punched tape', 180, 100, (g) => {
  const a = Math.min(g.H * 0.1, g.W * 0.08); const c = a * 3.46; const W3 = g.W / 3;
  const ya = g.y0 + a; const yb = g.y1 - a;
  return P(D('M', [g.x0, ya], 'C', [g.x0 + W3, ya + c], [g.x1 - W3, ya - c], [g.x1, ya], 'L', [g.x1, yb], 'C', [g.x1 - W3, yb - c], [g.x0 + W3, yb + c], [g.x0, yb], 'Z'), g.main);
}, (w, h) => { const a = Math.min(h * 0.1, w * 0.08); return { x: w * 0.06, y: 2 * a + 2, w: w * 0.88, h: h - 4 * a - 4 }; });
add('flow', 'manual-operation', 'Opération manuelle', 'opération manuelle manual operation', 180, 100, (g) => {
  const s = skew(g.W, g.H);
  return P(poly([[g.x0, g.y0], [g.x1, g.y0], [g.x1 - s, g.y1], [g.x0 + s, g.y1]]), g.main);
}, skewText);
add('flow', 'chevron', 'Chevron', 'chevron étape phase chevron step', 180, 90, (g) => {
  const k = Math.min(g.W * 0.25, g.H * 0.5);
  return P(poly([[g.x0, g.y0], [g.x1 - k, g.y0], [g.x1, g.cy], [g.x1 - k, g.y1], [g.x0, g.y1], [g.x0 + k, g.cy]]), g.main);
}, (w, h) => { const k = Math.min(w * 0.25, h * 0.5); return { x: k, y: h * 0.1, w: w - 2 * k, h: h * 0.8 }; });
add('flow', 'annotation', 'Annotation', 'annotation commentaire crochet comment bracket', 160, 90, (g) => {
  const k = Math.min(g.W * 0.2, 16);
  return R(0, 0, g.w, g.h, 0, attr({ fill: 'transparent', stroke: 'none' })) + P(polyline([[g.x0 + k, g.y0], [g.x0, g.y0], [g.x0, g.y1], [g.x0 + k, g.y1]]), g.outline);
}, (w, h) => ({ x: Math.min(w * 0.2, 16) + 4, y: h * 0.06, w: w - Math.min(w * 0.2, 16) - 8, h: h * 0.88 }));

// ----------------------------------------------------------------- arrows
add('arrows', 'arrow-right', 'Flèche droite', 'flèche droite arrow right', 160, 80, blockArrow('right'), arrowText('right'));
add('arrows', 'arrow-left', 'Flèche gauche', 'flèche gauche arrow left', 160, 80, blockArrow('left'), arrowText('left'));
add('arrows', 'arrow-up', 'Flèche haut', 'flèche haut monter arrow up', 80, 160, blockArrow('up'), arrowText('up'));
add('arrows', 'arrow-down', 'Flèche bas', 'flèche bas descendre arrow down', 80, 160, blockArrow('down'), arrowText('down'));
add('arrows', 'arrow-left-right', 'Flèche gauche-droite', 'flèche double gauche droite arrow left right double', 180, 80, blockArrow('right', 'double'), arrowText('right', 'double'));
add('arrows', 'arrow-up-down', 'Flèche haut-bas', 'flèche double haut bas arrow up down double', 80, 180, blockArrow('down', 'double'), arrowText('down', 'double'));
add('arrows', 'arrow-quad', 'Flèche 4 directions', 'flèche quatre directions croix déplacer arrow quad four way move', 140, 140, unitPoly([
  [0.5, 0], [0.7, 0.2], [0.58, 0.2], [0.58, 0.42], [0.8, 0.42], [0.8, 0.3], [1, 0.5], [0.8, 0.7], [0.8, 0.58], [0.58, 0.58], [0.58, 0.8], [0.7, 0.8],
  [0.5, 1], [0.3, 0.8], [0.42, 0.8], [0.42, 0.58], [0.2, 0.58], [0.2, 0.7], [0, 0.5], [0.2, 0.3], [0.2, 0.42], [0.42, 0.42], [0.42, 0.2], [0.3, 0.2],
]), T.frac(0.42, 0.42, 0.16, 0.16));
const CURVED = ['M', [0, 1], 'C', [0, 0.45], [0.3, 0.15], [0.68, 0.15], 'L', [0.68, 0], 'L', [1, 0.3], 'L', [0.68, 0.6], 'L', [0.68, 0.45], 'C', [0.45, 0.45], [0.3, 0.65], [0.3, 1], 'Z'];
add('arrows', 'arrow-curved-right', 'Flèche courbe', 'flèche courbe tournant virage arrow curved bent turn', 140, 120,
  (g) => P(D(...mapUnit(g, CURVED)), g.main), T.frac(0.68, 0.18, 0.2, 0.24));
add('arrows', 'arrow-u-turn', 'Flèche demi-tour', 'flèche demi-tour retour u arrow u-turn back', 140, 140, (g) => {
  const ox = g.x0 + 0.4 * g.W; const oy = g.y0 + 0.45 * g.H;
  const parts = ['M', g.p(0, 1), 'L', g.p(0, 0.45), ...arc(ox, oy, 0.4 * g.W, 0.45 * g.H, 180, 360),
    'L', g.p(0.8, 0.62), 'L', g.p(1, 0.62), 'L', g.p(0.68, 1), 'L', g.p(0.36, 0.62), 'L', g.p(0.56, 0.62), 'L', g.p(0.56, 0.45),
    ...arc(ox, oy, 0.16 * g.W, 0.22 * g.H, 360, 180), 'L', g.p(0.24, 1), 'Z'];
  return P(D(...parts), g.main);
}, T.frac(0.25, 0.03, 0.3, 0.17));
add('arrows', 'arrow-notched', 'Flèche à encoche', 'flèche encoche entaillée arrow notched', 160, 80, blockArrow('right', 'notched'), arrowText('right', 'notched'));
add('arrows', 'chevron-right', 'Chevron droite', 'chevron droite flèche suivant chevron right next', 120, 100, (g) => {
  const k = Math.min(g.W * 0.5, g.H * 0.5);
  return P(poly([[g.x0, g.y0], [g.x1 - k, g.y0], [g.x1, g.cy], [g.x1 - k, g.y1], [g.x0, g.y1], [g.x0 + k, g.cy]]), g.main);
}, (w, h) => { const k = Math.min(w * 0.5, h * 0.5); return { x: k, y: h * 0.2, w: Math.max(0, w - 2 * k), h: h * 0.6 }; });
add('arrows', 'pentagon-arrow', 'Flèche pentagone', 'flèche pentagone étiquette marbre étape pentagon arrow home plate tag', 180, 80, (g) => {
  const k = Math.min(g.W * 0.4, g.H * 0.5);
  return P(poly([[g.x0, g.y0], [g.x1 - k, g.y0], [g.x1, g.cy], [g.x1 - k, g.y1], [g.x0, g.y1]]), g.main);
}, (w, h) => { const k = Math.min(w * 0.4, h * 0.5); return { x: w * 0.06, y: h * 0.1, w: w * 0.94 - k * 0.7, h: h * 0.8 }; });
add('arrows', 'arrow-callout-right', 'Bulle flèche droite', 'bulle flèche légende droite arrow callout right', 200, 100, (g) => {
  const xb = g.x0 + g.W * 0.62; const hl = Math.min(g.W * 0.2, g.H * 0.4); const ts = g.H * 0.14; const hh = g.H * 0.3; const { x0, y0, x1, y1, cy } = g;
  return P(poly([[x0, y0], [xb, y0], [xb, cy - ts], [x1 - hl, cy - ts], [x1 - hl, cy - hh], [x1, cy], [x1 - hl, cy + hh], [x1 - hl, cy + ts], [xb, cy + ts], [xb, y1], [x0, y1]]), g.main);
}, T.frac(0.05, 0.08, 0.52, 0.84));

// ---------------------------------------------------------------- bubbles
function speech(g, radius) {
  const yb = g.y0 + g.H * 0.78; const r = Math.min(radius, g.m * 0.25, g.H * 0.39);
  const { x0, y0, x1, y1 } = g;
  return P(roundPoly([[x0, y0], [x1, y0], [x1, yb], [x0 + g.W * 0.36, yb], [x0 + g.W * 0.1, y1], [x0 + g.W * 0.16, yb], [x0, yb]], [r, r, r, 0, 0, 0, r]), g.main);
}
add('bubbles', 'speech-round', 'Bulle arrondie', 'bulle parole dialogue arrondie speech bubble rounded chat', 200, 130, (g) => speech(g, 14), T.frac(0.06, 0.06, 0.88, 0.66));
add('bubbles', 'speech-rect', 'Bulle rectangulaire', 'bulle parole dialogue rectangle speech bubble rectangle', 200, 130, (g) => speech(g, 0), T.frac(0.06, 0.06, 0.88, 0.66));
add('bubbles', 'speech-oval', 'Bulle ovale', 'bulle parole ovale dialogue speech bubble oval', 200, 130, (g) => {
  const ry = (g.H * 0.82) / 2; const cy = g.y0 + ry; const rx = g.W / 2;
  return P(D('M', at(g.cx, cy, rx, ry, 125), ...arc(g.cx, cy, rx, ry, 125, 460), 'L', [g.x0 + g.W * 0.12, g.y1], 'Z'), g.main);
}, T.frac(0.18, 0.14, 0.64, 0.52));
add('bubbles', 'thought', 'Bulle de pensée', 'bulle pensée réflexion idée nuage thought bubble think', 200, 140, (g) => {
  const ch = g.H * 0.76; const r1 = g.m * 0.07; const r2 = r1 * 0.6;
  return P(cloudPath(g, (u, v) => [g.x0 + u * g.W, g.y0 + v * ch]), g.main)
    + C(g.x0 + g.W * 0.22, g.y0 + g.H * 0.84, r1, g.main) + C(g.x0 + g.W * 0.12, g.y1 - r2, r2, g.main);
}, T.frac(0.22, 0.2, 0.56, 0.38));
const SHOUT = starPoints(12, 0.74, [1, 0.95, 0.92, 1, 1, 0.9, 0.96, 1, 0.9, 0.97, 1, 0.92, 0.94, 1, 1, 0.9, 0.97, 1, 0.92, 0.95, 1, 0.93, 0.9, 1]);
add('bubbles', 'shout', 'Bulle cri', 'bulle cri explosion exclamation shout burst spiky', 200, 150, unitPoly(SHOUT), T.frac(0.25, 0.3, 0.5, 0.4));
function callout(g, side) {
  const { x0, y0, x1, y1, cx, cy, W, H } = g;
  const r = Math.min(10, g.m * 0.15);
  if (side === 'left' || side === 'right') {
    const tl = Math.min(W * 0.2, H * 0.5); const ph = Math.min(H * 0.16, W * 0.2);
    const pts = side === 'left'
      ? [[x0 + tl, y0], [x1, y0], [x1, y1], [x0 + tl, y1], [x0 + tl, cy + ph], [x0, cy], [x0 + tl, cy - ph]]
      : [[x0, y0], [x1 - tl, y0], [x1 - tl, cy - ph], [x1, cy], [x1 - tl, cy + ph], [x1 - tl, y1], [x0, y1]];
    return P(roundPoly(pts, side === 'left' ? [r, r, r, r, 0, 0, 0] : [r, r, 0, 0, 0, r, r]), g.main);
  }
  const tl = Math.min(H * 0.22, W * 0.5); const pw = Math.min(W * 0.1, H * 0.2);
  const pts = side === 'down'
    ? [[x0, y0], [x1, y0], [x1, y1 - tl], [cx + pw, y1 - tl], [cx, y1], [cx - pw, y1 - tl], [x0, y1 - tl]]
    : [[cx, y0], [cx + pw, y0 + tl], [x1, y0 + tl], [x1, y1], [x0, y1], [x0, y0 + tl], [cx - pw, y0 + tl]];
  return P(roundPoly(pts, side === 'down' ? [r, r, r, 0, 0, 0, r] : [0, 0, r, r, r, r, 0]), g.main);
}
const calloutText = (side) => (w, h) => {
  const p = padOf(w, h);
  if (side === 'left' || side === 'right') { const tl = Math.min(w * 0.2, h * 0.5); return { x: (side === 'left' ? tl : 0) + p, y: p, w: w - tl - 2 * p, h: h - 2 * p }; }
  const tl = Math.min(h * 0.22, w * 0.5); return { x: p, y: (side === 'up' ? tl : 0) + p, w: w - 2 * p, h: h - tl - 2 * p };
};
add('bubbles', 'callout-left', 'Légende (pointe à gauche)', 'légende bulle pointe gauche callout left', 200, 100, (g) => callout(g, 'left'), calloutText('left'));
add('bubbles', 'callout-right', 'Légende (pointe à droite)', 'légende bulle pointe droite callout right', 200, 100, (g) => callout(g, 'right'), calloutText('right'));
add('bubbles', 'callout-down', 'Légende (pointe en bas)', 'légende bulle pointe bas callout down', 180, 120, (g) => callout(g, 'down'), calloutText('down'));
add('bubbles', 'callout-up', 'Légende (pointe en haut)', 'légende bulle pointe haut callout up', 180, 120, (g) => callout(g, 'up'), calloutText('up'));

// -------------------------------------------------------------------- uml
const classHeader = (H) => Math.min(H * 0.3, 36);
add('uml', 'uml-class', 'Classe', 'classe uml attributs méthodes class', 180, 140, (g) => {
  const y1 = g.y0 + classHeader(g.H); const y2 = y1 + (g.y1 - y1) / 2;
  return R(g.x0, g.y0, g.W, g.H, 0, g.main) + P(D('M', [g.x0, y1], 'L', [g.x1, y1], 'M', [g.x0, y2], 'L', [g.x1, y2]), g.outline);
}, (w, h) => { const p = padOf(w, h); return { x: p, y: 0, w: w - 2 * p, h: classHeader(h) }; });
add('uml', 'uml-interface', 'Interface (sucette)', 'interface uml sucette lollipop provided interface', 90, 110, (g) => {
  const r = Math.min(g.W * 0.3, g.H * 0.2);
  return L(g.cx, g.y0 + 2 * r, g.cx, g.y0 + g.H * 0.58, g.outline) + C(g.cx, g.y0 + r, r, g.main);
}, T.frac(0, 0.62, 1, 0.38));
add('uml', 'actor', 'Acteur', 'acteur utilisateur personnage bonhomme actor user stick figure', 80, 130, (g) => {
  const fh = g.H * 0.74; const r = Math.min(fh * 0.13, g.W * 0.25); const top = g.y0;
  const hip = top + fh * 0.62; const arms = top + fh * 0.36;
  const ah = Math.min(g.W / 2, fh * 0.3); const lh = Math.min(g.W / 2, fh * 0.24);
  return P(D('M', [g.cx, top + 2 * r], 'L', [g.cx, hip], 'M', [g.cx - ah, arms], 'L', [g.cx + ah, arms], 'M', [g.cx - lh, top + fh], 'L', [g.cx, hip], 'L', [g.cx + lh, top + fh]), g.outline)
    + C(g.cx, top + r, r, g.main);
}, T.below);
add('uml', 'use-case', "Cas d'utilisation", "cas d'utilisation use case ellipse", 180, 90, ellipseShape, T.ellipse);
const packageTab = (H) => Math.min(H * 0.2, 24);
add('uml', 'uml-package', 'Paquetage', 'paquetage package dossier module folder namespace', 200, 140, (g) => {
  const tw = g.W * 0.4; const th = packageTab(g.H);
  return P(poly([[g.x0, g.y0], [g.x0 + tw, g.y0], [g.x0 + tw, g.y0 + th], [g.x1, g.y0 + th], [g.x1, g.y1], [g.x0, g.y1]]), g.main)
    + L(g.x0, g.y0 + th, g.x0 + tw, g.y0 + th, g.outline);
}, (w, h) => { const th = packageTab(h); const p = padOf(w, h - th); return { x: p, y: th + p, w: w - 2 * p, h: h - th - 2 * p }; });
const compTab = (W, H) => ({ tw: Math.min(W * 0.18, 22), th: Math.min(H * 0.16, 12) });
add('uml', 'uml-component', 'Composant', 'composant module component', 180, 110, (g) => {
  const { tw, th } = compTab(g.W, g.H);
  return R(g.x0 + tw / 2, g.y0, g.W - tw / 2, g.H, 0, g.main)
    + R(g.x0, g.y0 + g.H * 0.25, tw, th, 0, g.main) + R(g.x0, g.y0 + g.H * 0.55, tw, th, 0, g.main);
}, (w, h) => { const { tw } = compTab(w, h); return { x: tw + 6, y: h * 0.08, w: w - tw - 12, h: h * 0.84 }; });
add('uml', 'uml-note', 'Note UML', 'note uml commentaire comment', 160, 100, (g) => dogEar(g, Math.min(g.m * 0.25, 18)));
const lifeHeader = (H) => Math.min(H * 0.25, 40);
add('uml', 'uml-lifeline', 'Ligne de vie', 'ligne de vie séquence objet participant lifeline sequence', 120, 300, (g) => {
  const hh = lifeHeader(g.H);
  return L(g.cx, g.y0 + hh, g.cx, g.y1, g.dashed()) + R(g.x0, g.y0, g.W, hh, 0, g.main);
}, (w, h) => { const p = padOf(w, lifeHeader(h)); return { x: p, y: 0, w: w - 2 * p, h: lifeHeader(h) }; });
add('uml', 'uml-activation', "Barre d'activation", 'activation exécution focus séquence activation bar execution', 20, 120, rectShape(), (w, h) => ({ x: 0, y: 0, w, h }));
add('uml', 'uml-object', 'Objet', 'objet instance object', 180, 70, (g) => {
  const y = g.cy + Math.min(g.H * 0.22, 11);
  return R(g.x0, g.y0, g.W, g.H, 0, g.main) + L(g.cx - g.W * 0.28, y, g.cx + g.W * 0.28, y, g.line(0.7));
}, (w, h) => { const p = padOf(w, h); return { x: p, y: p, w: w - 2 * p, h: h / 2 + Math.min(h * 0.22, 11) - p - 2 }; });
add('uml', 'uml-state', 'État', 'état statut state', 160, 80, rectShape((g) => Math.min(g.m * 0.35, 20)));
add('uml', 'uml-initial', 'État initial', 'état initial départ début initial state start', 32, 32, (g) => C(g.cx, g.cy, g.m / 2, g.ink), T.circle);
add('uml', 'uml-final', 'État final', 'état final fin cible final state end bullseye', 36, 36,
  (g) => C(g.cx, g.cy, g.m / 2, g.main) + C(g.cx, g.cy, g.m / 2 * 0.55, g.ink), T.circle);
add('uml', 'uml-fork', 'Barre de synchronisation', 'fourche jointure synchronisation barre fork join bar', 160, 10,
  (g) => R(0, 0, g.w, g.h, Math.min(2, g.h / 2), g.ink), (w, h) => ({ x: 0, y: 0, w, h }));
add('uml', 'uml-choice', 'Choix', 'choix décision jonction choice decision', 40, 40, diamondShape, T.diamond);
add('uml', 'uml-node', 'Nœud', 'noeud nœud déploiement serveur node deployment', 170, 120, (g) => cube(g, 0.15), cubeText(0.15));
const iconArea = (g) => g.H * 0.74;
add('uml', 'uml-boundary', 'Frontière', 'frontière interface robustesse boundary', 100, 90, (g) => {
  const ih = iconArea(g); const r = Math.min(ih / 2, g.W / 2.7); const cy = g.y0 + ih / 2;
  const left = g.cx - 1.35 * r; const ccx = left + 1.7 * r;
  return P(D('M', [left, cy - r], 'L', [left, cy + r], 'M', [left, cy], 'L', [ccx - r, cy]), g.outline) + C(ccx, cy, r, g.main);
}, T.below);
add('uml', 'uml-control', 'Contrôle', 'contrôle contrôleur robustesse control controller', 90, 90, (g) => {
  const ih = iconArea(g); const r = Math.min(ih / 2.6, g.W / 2); const cy = g.y0 + r * 1.3; const a = r * 0.3;
  return C(g.cx, cy, r, g.main) + P(polyline([[g.cx + a, cy - r - a], [g.cx - a * 0.4, cy - r], [g.cx + a, cy - r + a]]), g.outline);
}, T.below);
add('uml', 'uml-entity', 'Entité', 'entité robustesse entity', 90, 90, (g) => {
  const ih = iconArea(g); const r = Math.min(ih / 2, g.W / 2); const cy = g.y0 + r;
  return C(g.cx, cy, r, g.main) + L(g.cx - r, cy + r, g.cx + r, cy + r, g.outline);
}, T.below);
const frameTag = (W, H) => ({ tw: Math.min(W * 0.3, 120), th: Math.min(H * 0.15, 24) });
add('uml', 'uml-frame', 'Cadre (fragment)', 'cadre fragment séquence boucle alt opt frame fragment', 320, 200, (g) => {
  const { tw, th } = frameTag(g.W, g.H);
  return R(g.x0, g.y0, g.W, g.H, 0, g.main) + P(polyline([[g.x0, g.y0 + th], [g.x0 + tw - th * 0.5, g.y0 + th], [g.x0 + tw, g.y0 + th * 0.5], [g.x0 + tw, g.y0]]), g.outline);
}, (w, h) => { const { tw, th } = frameTag(w, h); return { x: 4, y: 0, w: tw - th * 0.5 - 4, h: th }; });

// ------------------------------------------------------------------- bpmn
const eventCircle = (g) => C(g.cx, g.cy, g.m / 2, g.main);
add('bpmn', 'bpmn-start', 'Événement de début', 'bpmn événement début start event', 48, 48, eventCircle, T.circle);
add('bpmn', 'bpmn-intermediate', 'Événement intermédiaire', 'bpmn événement intermédiaire intermediate event', 48, 48, (g) => {
  const r = g.m / 2; const gap = Math.max(g.sw + 1, r * 0.12);
  return C(g.cx, g.cy, r, g.main) + C(g.cx, g.cy, Math.max(0, r - gap), g.outline);
}, T.circle);
add('bpmn', 'bpmn-end', 'Événement de fin', 'bpmn événement fin end event', 48, 48, eventCircle, T.circle, { context: { swScale: 2.2 } });
function envelope(g, x, y, w, h, a) {
  return R(x, y, w, h, Math.min(w, h) * 0.08, a) + P(polyline([[x, y], [x + w / 2, y + h * 0.55], [x + w, y]]), a);
}
add('bpmn', 'bpmn-message-start', 'Début par message', 'bpmn message début enveloppe message start event', 48, 48, (g) => {
  const r = g.m / 2; const ew = r * 1.0; const eh = r * 0.68;
  return eventCircle(g) + envelope(g, g.cx - ew / 2, g.cy - eh / 2, ew, eh, g.line(0.8));
}, T.circle);
add('bpmn', 'bpmn-timer', 'Événement minuterie', 'bpmn minuterie horloge temps timer clock event', 48, 48, (g) => {
  const r = g.m / 2; const r2 = r * 0.7; let ticks = '';
  for (let k = 0; k < 12; k++) {
    const p1 = at(g.cx, g.cy, r2 * 0.78, r2 * 0.78, k * 30); const p2 = at(g.cx, g.cy, r2 * 0.92, r2 * 0.92, k * 30);
    ticks += `M ${D(p1)} L ${D(p2)} `;
  }
  return eventCircle(g) + C(g.cx, g.cy, r2, g.line(0.8))
    + P(ticks.trim(), g.line(0.5)) + P(D('M', [g.cx, g.cy - r2 * 0.6], 'L', [g.cx, g.cy], 'L', [g.cx + r2 * 0.45, g.cy + r2 * 0.2]), g.line(0.8));
}, T.circle);
const taskRadius = (g) => Math.min(10, g.m * 0.15);
add('bpmn', 'bpmn-task', 'Tâche', 'bpmn tâche activité task activity', 160, 90, rectShape(taskRadius));
const subMarker = (W, H) => Math.min(14, W * 0.2, H * 0.22);
add('bpmn', 'bpmn-subprocess', 'Sous-processus', 'bpmn sous-processus sous processus subprocess collapsed', 160, 100, (g) => {
  const q = subMarker(g.W, g.H); const y = g.y1 - q - Math.min(4, g.H * 0.05); const x = g.cx - q / 2;
  return R(g.x0, g.y0, g.W, g.H, taskRadius(g), g.main) + R(x, y, q, q, 0, g.line(0.7))
    + P(D('M', [g.cx, y + q * 0.22], 'L', [g.cx, y + q * 0.78], 'M', [x + q * 0.22, y + q / 2], 'L', [x + q * 0.78, y + q / 2]), g.line(0.7));
}, (w, h) => { const p = padOf(w, h); return { x: p, y: p, w: w - 2 * p, h: h - 2 * p - subMarker(w, h) - 4 }; });
const gatewayGlyph = (fn) => (g) => diamondShape(g) + fn(g, Math.min(g.W, g.H) * 0.2);
add('bpmn', 'bpmn-gateway', 'Passerelle', 'bpmn passerelle porte branchement gateway', 64, 64, diamondShape, T.diamond);
add('bpmn', 'bpmn-gateway-exclusive', 'Passerelle exclusive', 'bpmn passerelle exclusive xor ou exclusif gateway exclusive', 64, 64, gatewayGlyph((g, s) => {
  const d = s * 0.75;
  return P(D('M', [g.cx - d, g.cy - d], 'L', [g.cx + d, g.cy + d], 'M', [g.cx + d, g.cy - d], 'L', [g.cx - d, g.cy + d]), g.line(1.6));
}), T.diamond);
add('bpmn', 'bpmn-gateway-parallel', 'Passerelle parallèle', 'bpmn passerelle parallèle et and gateway parallel', 64, 64, gatewayGlyph((g, s) =>
  P(D('M', [g.cx - s, g.cy], 'L', [g.cx + s, g.cy], 'M', [g.cx, g.cy - s], 'L', [g.cx, g.cy + s]), g.line(1.6))), T.diamond);
add('bpmn', 'bpmn-gateway-inclusive', 'Passerelle inclusive', 'bpmn passerelle inclusive ou or gateway inclusive', 64, 64, gatewayGlyph((g, s) => C(g.cx, g.cy, s, g.line(1.4))), T.diamond);
add('bpmn', 'bpmn-gateway-event', 'Passerelle événementielle', 'bpmn passerelle événement gateway event based', 64, 64, gatewayGlyph((g, s) => {
  const pent = Array.from({ length: 5 }, (_, k) => at(g.cx, g.cy, s * 0.55, s * 0.55, -90 + k * 72));
  return C(g.cx, g.cy, s * 1.1, g.line(0.7)) + C(g.cx, g.cy, s * 0.88, g.line(0.7)) + P(poly(pent), g.line(0.7));
}), T.diamond);
add('bpmn', 'bpmn-data-object', 'Objet de données', 'bpmn objet de données document data object', 60, 80, (g) => dogEar(g, Math.min(g.m * 0.3, 16)));
add('bpmn', 'bpmn-data-store', 'Stockage de données', 'bpmn stockage de données base data store database', 90, 90, (g) => cylinder(g, 2), cylinderText);
const poolBand = (W, k) => Math.min(W * k, 32);
add('bpmn', 'bpmn-pool', 'Bassin (pool)', 'bpmn bassin piscine pool participant', 560, 200, (g) => {
  const bw = poolBand(g.W, 0.1);
  return R(g.x0, g.y0, g.W, g.H, 0, g.main) + P(D('M', [g.x0, g.y0], 'L', [g.x0 + bw, g.y0], 'L', [g.x0 + bw, g.y1], 'L', [g.x0, g.y1], 'Z'), g.tint(0.06))
    + L(g.x0 + bw, g.y0, g.x0 + bw, g.y1, g.outline);
}, (w, h) => ({ x: 2, y: h * 0.04, w: poolBand(w, 0.1) - 4, h: h * 0.92 }));
add('bpmn', 'bpmn-lane', 'Couloir (lane)', 'bpmn couloir ligne lane swimlane', 560, 140, (g) => {
  const bw = poolBand(g.W, 0.08) * 0.8;
  return R(g.x0, g.y0, g.W, g.H, 0, g.main) + L(g.x0 + bw, g.y0, g.x0 + bw, g.y1, g.outline);
}, (w, h) => ({ x: 2, y: h * 0.04, w: poolBand(w, 0.08) * 0.8 - 4, h: h * 0.92 }));
add('bpmn', 'bpmn-message', 'Message', 'bpmn message enveloppe courrier message envelope', 70, 50,
  (g) => R(g.x0, g.y0, g.W, g.H, Math.min(g.m * 0.08, 4), g.main) + P(polyline([g.p(0, 0), g.p(0.5, 0.55), g.p(1, 0)]), g.outline), T.frac(0.1, 0.6, 0.8, 0.36));
add('bpmn', 'bpmn-call-activity', 'Activité d’appel', 'bpmn activité appel call activity', 160, 90, rectShape(taskRadius), T.full, { context: { swScale: 2 } });

// ------------------------------------------------------------------- data
const doubleGap = (g) => clamp(g.m * 0.08, 2, 6) + g.sw / 2;
add('data', 'er-entity', 'Entité', 'entité table er entity', 160, 80, rectShape());
add('data', 'er-weak-entity', 'Entité faible', 'entité faible er weak entity', 160, 80, (g) => {
  const d = doubleGap(g);
  return R(g.x0, g.y0, g.W, g.H, 0, g.main) + R(g.x0 + d, g.y0 + d, g.W - 2 * d, g.H - 2 * d, 0, g.outline);
});
add('data', 'er-attribute', 'Attribut', 'attribut propriété er attribute', 140, 70, ellipseShape, T.ellipse);
add('data', 'er-key-attribute', 'Attribut clé', 'attribut clé primaire er key attribute primary', 140, 70, ellipseShape, T.ellipse);
add('data', 'er-multivalued-attribute', 'Attribut multivalué', 'attribut multivalué er multivalued attribute', 140, 70, (g) => {
  const d = doubleGap(g);
  return ellipseShape(g) + E(g.cx, g.cy, g.W / 2 - d, g.H / 2 - d, g.outline);
}, T.ellipse);
add('data', 'er-derived-attribute', 'Attribut dérivé', 'attribut dérivé calculé er derived attribute', 140, 70, (g) => {
  const a = attr({ fill: g.fill, stroke: g.stroke, 'stroke-width': g.sw, 'stroke-dasharray': `${num(Math.max(g.sw, 1) * 3)} ${num(Math.max(g.sw, 1) * 2)}` });
  return E(g.cx, g.cy, g.W / 2, g.H / 2, a);
}, T.ellipse);
add('data', 'er-relationship', 'Relation', 'relation association er relationship', 160, 100, diamondShape, T.diamond);
add('data', 'er-weak-relationship', 'Relation faible', 'relation faible identifiante er weak identifying relationship', 160, 100, (g) => {
  const dx = g.W / 2; const dy = g.H / 2; const d = (dx * dy) / (Math.hypot(dx, dy) || 1);
  const k = d > 0 ? Math.max(0, (d - doubleGap(g)) / d) : 0;
  const inner = DIAMOND.map(([u, v]) => [g.cx + (u - 0.5) * g.W * k, g.cy + (v - 0.5) * g.H * k]);
  return diamondShape(g) + P(poly(inner), g.outline);
}, T.diamond);
const tableHeader = (H) => Math.min(H * 0.22, 32);
add('data', 'er-table', 'Table', 'table base de données sql colonnes lignes database table columns', 200, 160, (g) => {
  const hh = tableHeader(g.H); const rows = (g.y1 - g.y0 - hh) / 5; const kx = g.x0 + Math.min(g.W * 0.18, 40);
  let lines = '';
  for (let k = 1; k <= 4; k++) lines += `M ${D([g.x0, g.y0 + hh + rows * k])} L ${D([g.x1, g.y0 + hh + rows * k])} `;
  lines += `M ${D([kx, g.y0 + hh])} L ${D([kx, g.y1])}`;
  return R(g.x0, g.y0, g.W, g.H, 0, g.fillOnly) + R(g.x0, g.y0, g.W, hh, 0, g.tint(0.12))
    + P(lines, g.line(0.6, { 'stroke-opacity': 0.45 })) + L(g.x0, g.y0 + hh, g.x1, g.y0 + hh, g.outline) + R(g.x0, g.y0, g.W, g.H, 0, g.outline);
}, (w, h) => { const p = padOf(w, tableHeader(h)); return { x: p, y: 0, w: w - 2 * p, h: tableHeader(h) }; });

// ------------------------------------------------------------------ infra
// Generic, original line-art glyphs (24 × 24 grid). No vendor artwork.
const ICONS = {
  server: '<rect x="3" y="3.5" width="18" height="7" rx="1.5"/><rect x="3" y="13.5" width="18" height="7" rx="1.5"/><path d="M6.5 7h.01M6.5 17h.01M10 7h7.5M10 17h7.5"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
  storage: '<ellipse cx="12" cy="6" rx="8" ry="2.5"/><path d="M4 6l1.9 13.2c.2 1 2.9 1.8 6.1 1.8s5.9-.8 6.1-1.8L20 6M5 12.5c1.6.9 4.1 1.4 7 1.4s5.4-.5 7-1.4"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.5 9.3 4.6 4.6 0 0 0 7 18.5z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="16.5" cy="7" r="2.8"/><path d="M17 12.5c2.6.2 4.3 1.9 4.8 4.8"/>',
  laptop: '<rect x="4" y="4.5" width="16" height="11" rx="1.2"/><path d="M2 19.5h20M3 19.5l1-4M21 19.5l-1-4"/>',
  desktop: '<rect x="2.5" y="3.5" width="19" height="13" rx="1.5"/><path d="M9 20.5h6M12 16.5v4"/>',
  mobile: '<rect x="6.5" y="2.5" width="11" height="19" rx="2"/><path d="M11 18.5h2"/>',
  router: '<rect x="2.5" y="12.5" width="19" height="7" rx="1.5"/><path d="M6 16h.01M9 16h.01M12 16h.01M7 12.5 5.5 6M17 12.5 18.5 6M15.5 4.5a4 4 0 0 1 6 0M14 2.5a6.5 6.5 0 0 1 9 0"/>',
  switch: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M7 10h10l-2.5-2.5M17 14H7l2.5 2.5"/>',
  firewall: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9.3h18M3 14.7h18M9 4v5.3M15 4v5.3M12 9.3v5.4M7 14.7V20M17 14.7V20"/>',
  'load-balancer': '<circle cx="4.5" cy="12" r="2.2"/><circle cx="19.5" cy="5" r="2"/><circle cx="19.5" cy="12" r="2"/><circle cx="19.5" cy="19" r="2"/><path d="M6.7 12h4M10.7 12l6.9-6.2M10.7 12h6.8M10.7 12l6.9 6.2"/>',
  queue: '<rect x="3" y="8" width="4.5" height="8" rx="1"/><rect x="9.75" y="8" width="4.5" height="8" rx="1"/><rect x="16.5" y="8" width="4.5" height="8" rx="1"/><path d="M3 4.5h17M17.5 2.5l2.5 2-2.5 2M21 19.5H4M6.5 17.5l-2.5 2 2.5 2"/>',
  function: '<path d="M6 4h2.5l8 16H19M12.4 11.8 7 20"/>',
  container: '<path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.5 7.5 12 12.2l8.5-4.7M12 12.2v9"/>',
  pod: '<path d="M12 2.8 19.43 6.38 21.26 14.41 16.12 20.86H7.88L2.74 14.41 4.57 6.38z"/><path d="M12 8.5l3.5 2v4L12 16.5l-3.5-2v-4zM8.5 10.5 12 12.5l3.5-2M12 12.5v4"/>',
  cluster: '<rect x="9" y="2.5" width="6" height="5" rx="1"/><rect x="2.5" y="16.5" width="6" height="5" rx="1"/><rect x="15.5" y="16.5" width="6" height="5" rx="1"/><path d="M12 7.5v4.5M5.5 16.5V12h13v4.5"/>',
  cdn: '<circle cx="12" cy="12" r="4"/><path d="M8 12h8M12 8c1.2 1.2 1.6 2.5 1.6 4s-.4 2.8-1.6 4c-1.2-1.2-1.6-2.5-1.6-4s.4-2.8 1.6-4z"/><circle cx="4" cy="4.5" r="1.8"/><circle cx="20" cy="4.5" r="1.8"/><circle cx="4" cy="19.5" r="1.8"/><circle cx="20" cy="19.5" r="1.8"/><path d="M5.4 5.9 9.2 9.2M18.6 5.9l-3.8 3.3M5.4 18.1l3.8-3.3M18.6 18.1l-3.8-3.3"/>',
  'api-gateway': '<path d="M8 6 3 12l5 6M16 6l5 6-5 6M13.5 4.5l-3 15"/>',
  cache: '<path d="M13.5 2.5 5 13.5h6l-1 8 8.5-11h-6z"/>',
  monitoring: '<rect x="3" y="3.5" width="18" height="17" rx="1.5"/><path d="M6.5 15.5l3.5-4 3 2.5 4.5-6"/>',
  security: '<path d="M12 2.8 19.5 5.6v6c0 4.6-3.2 8.2-7.5 9.6-4.3-1.4-7.5-5-7.5-9.6v-6z"/><rect x="9" y="11" width="6" height="5" rx="1"/><path d="M10.2 11V9.6a1.8 1.8 0 0 1 3.6 0V11"/>',
  key: '<circle cx="7.5" cy="14.5" r="4.5"/><path d="M10.7 11.3 20 2M16.5 5.5l2.5 2.5M14 8l2 2"/>',
  mail: '<rect x="2.5" y="5" width="19" height="14" rx="1.8"/><path d="M3 6l9 7 9-7"/>',
  dns: '<path d="M12 21V3M5 5h12l2.5 2.5L17 10H5zM19 12H7l-2.5 2.5L7 17h12z"/>',
  vm: '<rect x="3" y="3.5" width="18" height="13" rx="1.5"/><rect x="7.5" y="6.5" width="9" height="7" rx="1" stroke-dasharray="2 2"/><path d="M9 20.5h6M12 16.5v4"/>',
  network: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M10.8 7.2 6.2 15.8M13.2 7.2l4.6 8.6M7.5 18h9"/>',
  internet: '<circle cx="12" cy="12" r="9"/><path d="M3.6 8.5h16.8M3.6 15.5h16.8M12 3c-2.4 2.6-3.5 5.6-3.5 9s1.1 6.4 3.5 9M12 3c2.4 2.6 3.5 5.6 3.5 9s-1.1 6.4-3.5 9"/>',
  analytics: '<path d="M3.5 20.5h17M7 17v-6M12 17V6M17 17v-4"/>',
  ai: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5M12 8.8l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/>',
  iot: '<circle cx="12" cy="12" r="2"/><path d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.1 18.9a9.8 9.8 0 0 1 0-13.8M18.9 5.1a9.8 9.8 0 0 1 0 13.8"/>',
  home: '<path d="M4 11 12 4l8 7M6.5 9.5V20h11V9.5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 20 20"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4 4 0 0 1 12 7.6 4 4 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
};
function tile(g, icon) {
  const sz = Math.min(g.W * 0.6, g.H * 0.5); const top = g.y0 + Math.max(0, (g.H * 0.62 - sz) / 2) + g.H * 0.02;
  return R(g.x0, g.y0, g.W, g.H, Math.min(12, g.m * 0.15), g.main) + glyph(g, ICONS[icon], g.cx - sz / 2, top, sz);
}
const INFRA = [
  ['server', 'Serveur', 'serveur machine hôte server host', 'server'],
  ['database', 'Base de données', 'base de données bdd sql stockage database db', 'database'],
  ['storage', 'Stockage (bucket)', 'stockage objets seau fichiers bucket object storage blob', 'storage'],
  ['cloud', 'Cloud', 'cloud nuage hébergement cloud hosting', 'cloud'],
  ['user', 'Utilisateur', 'utilisateur personne client user person', 'user'],
  ['users', 'Utilisateurs', 'utilisateurs groupe équipe users group team', 'users'],
  ['laptop', 'Ordinateur portable', 'ordinateur portable laptop notebook', 'laptop'],
  ['desktop', 'Ordinateur de bureau', 'ordinateur bureau poste écran desktop computer workstation', 'desktop'],
  ['mobile', 'Mobile', 'mobile téléphone smartphone phone', 'mobile'],
  ['router', 'Routeur', 'routeur wifi réseau router', 'router'],
  ['switch', 'Commutateur', 'commutateur switch réseau network switch', 'switch'],
  ['firewall', 'Pare-feu', 'pare-feu sécurité firewall', 'firewall'],
  ['load-balancer', 'Répartiteur de charge', 'répartiteur de charge équilibreur load balancer', 'load-balancer'],
  ['queue', 'File de messages', 'file d’attente messages queue message broker', 'queue'],
  ['function', 'Fonction (serverless)', 'fonction serverless lambda function', 'function'],
  ['container', 'Conteneur', 'conteneur container docker image', 'container'],
  ['kubernetes-pod', 'Pod', 'pod kubernetes orchestration k8s', 'pod'],
  ['cluster', 'Cluster', 'cluster grappe nœuds nodes', 'cluster'],
  ['cdn', 'CDN', 'cdn réseau de diffusion contenu distribution edge', 'cdn'],
  ['api-gateway', 'Passerelle API', 'passerelle api gateway rest', 'api-gateway'],
  ['cache', 'Cache', 'cache mémoire rapide redis memory', 'cache'],
  ['monitoring', 'Supervision', 'supervision monitoring métriques metrics observability', 'monitoring'],
  ['security', 'Sécurité', 'sécurité bouclier cadenas security shield lock', 'security'],
  ['key', 'Clé', 'clé secret chiffrement key secret encryption', 'key'],
  ['mail', 'E-mail', 'mail courriel email message', 'mail'],
  ['dns', 'DNS', 'dns noms de domaine domain name', 'dns'],
  ['virtual-machine', 'Machine virtuelle', 'machine virtuelle vm instance virtual machine', 'vm'],
  ['network', 'Réseau', 'réseau topologie network', 'network'],
  ['internet', 'Internet', 'internet web globe monde world', 'internet'],
  ['analytics', 'Analytique', 'analytique statistiques analytics stats bi', 'analytics'],
  ['ai', 'IA', 'ia intelligence artificielle puce ai machine learning chip', 'ai'],
  ['iot', 'Objet connecté (IoT)', 'iot objet connecté capteur sensor device', 'iot'],
];
for (const [id, name, keywords, icon] of INFRA) add('infra', id, name, keywords, 120, 120, (g) => tile(g, icon), T.tile);

// --------------------------------------------------------------------- ui
const uiSuggest = (fill, stroke, color) => ({ style: { fill, stroke, color } });
const caretPad = (h) => Math.min(h * 0.3, 12);
add('ui', 'ui-phone', 'Téléphone', 'téléphone mobile smartphone écran maquette phone device mockup', 180, 360, (g) => {
  const r = Math.min(g.m * 0.16, 40); const b = clamp(g.m * 0.05, 0, 12); const nh = clamp(g.m * 0.06, 0, 20); const nw = g.W * 0.32;
  return R(g.x0, g.y0, g.W, g.H, r, g.main) + R(g.x0 + b, g.y0 + b, g.W - 2 * b, g.H - 2 * b, Math.max(0, r - b), g.tint(0.06))
    + R(g.cx - nw / 2, g.y0 + b, nw, nh, nh / 2, g.ink) + L(g.cx - g.W * 0.15, g.y1 - b - nh * 0.5, g.cx + g.W * 0.15, g.y1 - b - nh * 0.5, g.line(1, { 'stroke-opacity': 0.5 }));
}, (w, h) => { const m = Math.min(w, h); const b = clamp(m * 0.05, 0, 12); const nh = clamp(m * 0.06, 0, 20); return { x: b + 6, y: b + nh + 8, w: w - 2 * b - 12, h: h - 2 * b - nh * 2 - 16 }; });
add('ui', 'ui-tablet', 'Tablette', 'tablette ipad écran maquette tablet device', 320, 420, (g) => {
  const r = Math.min(g.m * 0.08, 24); const b = clamp(g.m * 0.06, 0, 18);
  return R(g.x0, g.y0, g.W, g.H, r, g.main) + R(g.x0 + b, g.y0 + b, g.W - 2 * b, g.H - 2 * b, Math.max(0, r - b) * 0.5, g.tint(0.06))
    + C(g.cx, g.y0 + b / 2, b * 0.18, g.ink);
}, (w, h) => { const b = clamp(Math.min(w, h) * 0.06, 0, 18); return { x: b + 6, y: b + 6, w: w - 2 * b - 12, h: h - 2 * b - 12 }; });
const browserChrome = (H) => Math.min(H * 0.12, 26) + Math.min(H * 0.12, 30);
add('ui', 'ui-browser', 'Navigateur web', 'navigateur web fenêtre site page browser window website', 480, 320, (g) => {
  const r = Math.min(8, g.m * 0.08); const t1 = Math.min(g.H * 0.12, 26); const t2 = Math.min(g.H * 0.12, 30); const yc = g.y0 + t1 + t2;
  const tabX = g.x0 + t1 * 2; const tabW = Math.min(g.W * 0.3, 160);
  let out = R(g.x0, g.y0, g.W, g.H, r, g.fillOnly)
    + P(roundPoly([[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y0 + t1], [g.x0, g.y0 + t1]], [r, r, 0, 0]), g.tint(0.08))
    + P(roundPoly([[tabX, g.y0 + t1 * 0.25], [tabX + tabW, g.y0 + t1 * 0.25], [tabX + tabW, g.y0 + t1], [tabX, g.y0 + t1]], [t1 * 0.25, t1 * 0.25, 0, 0]), g.fillOnly);
  for (let k = 0; k < 3; k++) out += C(g.x0 + t1 * 0.5 + k * t1 * 0.42, g.y0 + t1 / 2, t1 * 0.12, g.tint(0.45));
  const a = t2 * 0.16; const ay = g.y0 + t1 + t2 / 2;
  out += P(D('M', [g.x0 + t2 * 0.55 + a / 2, ay - a], 'L', [g.x0 + t2 * 0.55 - a / 2, ay], 'L', [g.x0 + t2 * 0.55 + a / 2, ay + a], 'M', [g.x0 + t2 * 1.15 - a / 2, ay - a], 'L', [g.x0 + t2 * 1.15 + a / 2, ay], 'L', [g.x0 + t2 * 1.15 - a / 2, ay + a]), g.line(0.7, { 'stroke-opacity': 0.6 }));
  out += R(g.x0 + t2 * 1.8, g.y0 + t1 + t2 * 0.2, g.W - t2 * 2.2, t2 * 0.6, t2 * 0.3, g.tint(0.08));
  return out + L(g.x0, yc, g.x1, yc, g.line(0.6, { 'stroke-opacity': 0.5 })) + R(g.x0, g.y0, g.W, g.H, r, g.outline);
}, (w, h) => { const c = browserChrome(h); const p = padOf(w, h - c); return { x: p, y: c + p, w: w - 2 * p, h: h - c - 2 * p }; });
const titleBar = (H) => Math.min(H * 0.14, 30);
add('ui', 'ui-desktop-window', 'Fenêtre', 'fenêtre application bureau window desktop app dialog', 420, 280, (g) => {
  const r = Math.min(8, g.m * 0.08); const th = titleBar(g.H);
  let out = R(g.x0, g.y0, g.W, g.H, r, g.fillOnly) + P(roundPoly([[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y0 + th], [g.x0, g.y0 + th]], [r, r, 0, 0]), g.tint(0.08));
  const tints = [0.75, 0.5, 0.3];
  for (let k = 0; k < 3; k++) out += C(g.x0 + th * 0.55 + k * th * 0.5, g.y0 + th / 2, th * 0.14, g.tint(tints[k]));
  return out + L(g.x0, g.y0 + th, g.x1, g.y0 + th, g.line(0.6, { 'stroke-opacity': 0.5 })) + R(g.x0, g.y0, g.W, g.H, r, g.outline);
}, (w, h) => { const th = titleBar(h); const p = padOf(w, h - th); return { x: p, y: th + p, w: w - 2 * p, h: h - th - 2 * p }; });
add('ui', 'ui-button', 'Bouton', 'bouton action valider button cta primary', 140, 44, rectShape((g) => Math.min(g.H * 0.25, 10)),
  (w, h) => ({ x: Math.min(12, w * 0.1), y: 0, w: w - 2 * Math.min(12, w * 0.1), h }), uiSuggest('#4f46e5', '#4338ca', '#ffffff'));
add('ui', 'ui-button-outline', 'Bouton contour', 'bouton contour secondaire button outline secondary ghost', 140, 44,
  (g) => R(g.x0, g.y0, g.W, g.H, g.m / 2, g.outline), (w, h) => ({ x: Math.min(h / 2, w * 0.15), y: 0, w: w - 2 * Math.min(h / 2, w * 0.15), h }), uiSuggest('transparent', '#4f46e5', '#4f46e5'));
add('ui', 'ui-input', 'Champ de saisie', 'champ saisie texte formulaire input text field form', 220, 40, (g) => {
  const x = g.x0 + caretPad(g.H);
  return R(g.x0, g.y0, g.W, g.H, Math.min(6, g.H * 0.2), g.main) + L(x, g.cy - g.H * 0.25, x, g.cy + g.H * 0.25, g.line(0.8, { 'stroke-opacity': 0.7 }));
}, (w, h) => { const x = caretPad(h) + 6; return { x, y: 0, w: w - x - caretPad(h), h }; });
add('ui', 'ui-search', 'Recherche', 'recherche champ loupe search field magnifier', 220, 40, (g) => {
  const r = g.H * 0.16; const cx = g.x0 + g.H * 0.48; const d = r * 0.75;
  return R(g.x0, g.y0, g.W, g.H, g.m / 2, g.main) + C(cx, g.cy - r * 0.15, r, g.line(0.8)) + L(cx + d, g.cy - r * 0.15 + d, cx + r * 1.6, g.cy - r * 0.15 + r * 1.6, g.line(0.8));
}, (w, h) => ({ x: h * 0.85, y: 0, w: w - h * 0.85 - h * 0.4, h }));
const checkSize = (W, H) => Math.min(H * 0.7, W * 0.3, 24);
add('ui', 'ui-checkbox', 'Case à cocher', 'case à cocher coche option checkbox check', 160, 32, (g) => {
  const q = checkSize(g.W, g.H); const x = g.x0; const y = g.cy - q / 2;
  return R(x, y, q, q, q * 0.2, g.ink) + P(polyline([[x + q * 0.25, g.cy], [x + q * 0.43, g.cy + q * 0.18], [x + q * 0.76, g.cy - q * 0.2]]), attr({ fill: 'none', stroke: g.fill === 'none' || g.fill === 'transparent' ? '#ffffff' : g.fill, 'stroke-width': q * 0.12, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}, (w, h) => { const q = checkSize(w, h); return { x: q * 1.45, y: 0, w: w - q * 1.45, h }; });
add('ui', 'ui-radio', 'Bouton radio', 'bouton radio choix option radio button', 160, 32, (g) => {
  const q = checkSize(g.W, g.H);
  return C(g.x0 + q / 2, g.cy, q / 2, g.inner()) + C(g.x0 + q / 2, g.cy, q * 0.24, g.ink);
}, (w, h) => { const q = checkSize(w, h); return { x: q * 1.45, y: 0, w: w - q * 1.45, h }; });
const toggleWidth = (W, H) => Math.min(W, H * 1.8);
add('ui', 'ui-toggle', 'Interrupteur', 'interrupteur bascule switch toggle on activé', 64, 32, (g) => {
  const tw = toggleWidth(g.W, g.H); const kr = Math.max(0, g.H / 2 - Math.max(1.5, g.H * 0.12));
  return R(g.x0, g.y0, tw, g.H, g.H / 2, g.ink) + C(g.x0 + tw - g.H / 2, g.cy, kr, attr({ fill: g.fill === 'none' || g.fill === 'transparent' ? '#ffffff' : g.fill, stroke: 'none' }));
}, (w, h) => { const tw = toggleWidth(w, h); return w - tw > h ? { x: tw + 8, y: 0, w: w - tw - 8, h } : { x: 0, y: 0, w, h }; });
add('ui', 'ui-slider', 'Curseur', 'curseur glissière réglage slider range', 200, 28, (g) => {
  const kr = Math.min(g.H / 2, g.W / 6); const th = clamp(g.H * 0.15, 0, 6); const a = g.x0 + kr; const b = g.x1 - kr; const v = a + (b - a) * 0.6;
  return L(a, g.cy, b, g.cy, attr({ stroke: g.inkColor, 'stroke-opacity': 0.25, 'stroke-width': th, 'stroke-linecap': 'round' }))
    + L(a, g.cy, v, g.cy, attr({ stroke: g.inkColor, 'stroke-width': th, 'stroke-linecap': 'round' })) + C(v, g.cy, Math.max(0, kr - g.dsw / 2), g.inner());
}, (w, h) => ({ x: 0, y: 0, w, h }));
add('ui', 'ui-dropdown', 'Liste déroulante', 'liste déroulante sélection menu select dropdown combobox', 200, 40, (g) => {
  const cx = g.x1 - g.H * 0.5; const a = g.H * 0.15;
  return R(g.x0, g.y0, g.W, g.H, Math.min(6, g.H * 0.2), g.main) + P(polyline([[cx - a, g.cy - a / 2], [cx, g.cy + a / 2], [cx + a, g.cy - a / 2]]), g.line(0.9));
}, (w, h) => ({ x: Math.min(12, h * 0.3), y: 0, w: w - Math.min(12, h * 0.3) - h, h }));
add('ui', 'ui-navbar', 'Barre de navigation', 'barre navigation entête menu hamburger navbar header menu', 480, 56, (g) => {
  const lw = g.H * 0.2; const mx = g.x1 - g.H * 0.5; const s = g.H * 0.13;
  return R(g.x0, g.y0, g.W, g.H, 0, g.main) + C(g.x0 + g.H * 0.5, g.cy, g.H * 0.2, g.tint(0.6))
    + P(D('M', [mx - lw, g.cy - s], 'L', [mx + lw, g.cy - s], 'M', [mx - lw, g.cy], 'L', [mx + lw, g.cy], 'M', [mx - lw, g.cy + s], 'L', [mx + lw, g.cy + s]), g.line(0.9));
}, (w, h) => ({ x: h * 0.9, y: 0, w: w - h * 1.8, h }));
add('ui', 'ui-tabbar', "Barre d'onglets", 'barre onglets navigation bas icônes tab bar bottom navigation', 360, 60, (g) => {
  const slot = g.W / 4; const sz = Math.min(g.H * 0.45, slot * 0.5);
  return R(g.x0, g.y0, g.W, g.H, 0, g.main) + ['home', 'search', 'heart', 'user'].map((icon, k) =>
    glyph(g, ICONS[icon], g.x0 + slot * (k + 0.5) - sz / 2, g.cy - sz / 2, sz, { alpha: k ? 0.45 : undefined })).join('');
}, (w, h) => ({ x: 0, y: 0, w, h }));
function picture(g, x, y, w, h) {
  return P(poly([[x, y + h], [x + w * 0.32, y + h * 0.42], [x + w * 0.55, y + h * 0.72], [x + w * 0.7, y + h * 0.55], [x + w, y + h]]), g.tint(0.3))
    + C(x + w * 0.72, y + h * 0.28, Math.min(w, h) * 0.09, g.tint(0.4));
}
add('ui', 'ui-card', 'Carte', 'carte vignette article image texte card tile', 220, 260, (g) => {
  const r = Math.min(10, g.m * 0.08); const ih = g.H * 0.5; const lw = clamp(g.H * 0.025, 0, 6);
  const line = (y, k) => L(g.x0 + g.W * 0.08, y, g.x0 + g.W * k, y, attr({ stroke: g.inkColor, 'stroke-opacity': 0.3, 'stroke-width': lw, 'stroke-linecap': 'round' }));
  return R(g.x0, g.y0, g.W, g.H, r, g.fillOnly) + P(roundPoly([[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y0 + ih], [g.x0, g.y0 + ih]], [r, r, 0, 0]), g.tint(0.08))
    + picture(g, g.x0 + g.W * 0.3, g.y0 + ih * 0.22, g.W * 0.4, ih * 0.6) + line(g.y0 + g.H * 0.78, 0.86) + line(g.y0 + g.H * 0.86, 0.6)
    + R(g.x0, g.y0, g.W, g.H, r, g.outline);
}, (w, h) => ({ x: w * 0.08, y: h * 0.54, w: w * 0.84, h: h * 0.17 }));
add('ui', 'ui-avatar', 'Avatar', 'avatar profil photo utilisateur avatar profile user picture', 64, 64, (g) => {
  const r = g.m / 2; const { cx, cy } = g;
  const body = D('M', at(cx, cy, r, r, 130), 'A', [r, r], 0, 0, 0, at(cx, cy, r, r, 50),
    'C', [cx + 0.6 * r, cy + 0.28 * r], [cx + 0.3 * r, cy + 0.18 * r], [cx, cy + 0.18 * r], 'C', [cx - 0.3 * r, cy + 0.18 * r], [cx - 0.6 * r, cy + 0.28 * r], at(cx, cy, r, r, 130), 'Z');
  return C(cx, cy, r, g.fillOnly) + P(body, g.tint(0.35)) + C(cx, cy - 0.24 * r, 0.3 * r, g.tint(0.35)) + C(cx, cy, r, g.outline);
}, T.circle);
add('ui', 'ui-image', 'Image', 'image photo illustration picture placeholder', 200, 140, (g) => {
  const r = Math.min(6, g.m * 0.06);
  return R(g.x0, g.y0, g.W, g.H, r, g.fillOnly) + picture(g, g.x0 + g.W * 0.2, g.y0 + g.H * 0.2, g.W * 0.6, g.H * 0.6) + R(g.x0, g.y0, g.W, g.H, r, g.outline);
}, T.frac(0.05, 0.82, 0.9, 0.16));
const modalTitle = (H) => Math.min(H * 0.2, 44);
add('ui', 'ui-modal', 'Fenêtre modale', 'fenêtre modale dialogue boîte popup modal dialog', 360, 220, (g) => {
  const th = modalTitle(g.H); const cs = th * 0.16; const cx = g.x1 - th * 0.5; const cy = g.y0 + th / 2;
  const pad = Math.min(g.H * 0.06, 14, g.W * 0.04); const bh = Math.min(g.H * 0.16, 34); const bw = Math.min(g.W * 0.22, 90); const by = g.y1 - bh - pad;
  const lw = clamp(g.H * 0.022, 0, 5);
  const text = (y, k) => L(g.x0 + pad * 1.5, y, g.x0 + g.W * k, y, attr({ stroke: g.inkColor, 'stroke-opacity': 0.3, 'stroke-width': lw, 'stroke-linecap': 'round' }));
  return R(g.x0, g.y0, g.W, g.H, Math.min(10, g.m * 0.08), g.main)
    + P(D('M', [cx - cs, cy - cs], 'L', [cx + cs, cy + cs], 'M', [cx + cs, cy - cs], 'L', [cx - cs, cy + cs]), g.line(0.8))
    + L(g.x0, g.y0 + th, g.x1, g.y0 + th, g.line(0.6, { 'stroke-opacity': 0.4 }))
    + text(g.y0 + th + (g.H - th) * 0.22, 0.85) + text(g.y0 + th + (g.H - th) * 0.36, 0.6)
    + R(g.x1 - pad - bw, by, bw, bh, Math.min(6, bh * 0.25), g.ink)
    + R(g.x1 - pad * 2 - bw * 2, by, bw, bh, Math.min(6, bh * 0.25), g.line(0.7, { 'stroke-opacity': 0.7 }));
}, (w, h) => ({ x: Math.min(w * 0.05, 16), y: 0, w: w - Math.min(w * 0.05, 16) - modalTitle(h), h: modalTitle(h) }));
add('ui', 'ui-list-item', 'Élément de liste', 'élément liste ligne rangée list item row', 320, 56, (g) => {
  const cx = g.x1 - g.H * 0.45; const a = g.H * 0.1;
  return R(g.x0, g.y0, g.W, g.H, Math.min(6, g.H * 0.12), g.main) + C(g.x0 + g.H * 0.5, g.cy, g.H * 0.3, g.tint(0.25))
    + P(polyline([[cx - a / 2, g.cy - a], [cx + a / 2, g.cy], [cx - a / 2, g.cy + a]]), g.line(0.8, { 'stroke-opacity': 0.7 }));
}, (w, h) => ({ x: h * 0.95, y: 0, w: w - h * 1.6, h }));
add('ui', 'ui-progress', 'Barre de progression', 'barre progression chargement avancement progress bar loading', 220, 16, (g) => {
  const gap = clamp(g.H * 0.15, 0, 4);
  return R(g.x0, g.y0, g.W, g.H, g.H / 2, g.main) + R(g.x0 + gap, g.y0 + gap, (g.W - 2 * gap) * 0.62, g.H - 2 * gap, (g.H - 2 * gap) / 2, g.ink);
}, (w, h) => ({ x: 0, y: 0, w, h }));
add('ui', 'ui-badge', 'Badge', 'badge étiquette pastille compteur tag label chip pill', 72, 28, rectShape((g) => g.m / 2),
  (w, h) => ({ x: Math.min(h * 0.4, w * 0.2), y: 0, w: w - 2 * Math.min(h * 0.4, w * 0.2), h }), uiSuggest('#ef4444', '#ef4444', '#ffffff'));
add('ui', 'ui-tooltip', 'Info-bulle', 'info-bulle infobulle astuce tooltip hint', 160, 52, (g) => {
  const tl = Math.min(g.H * 0.22, 10); const pw = Math.min(g.W * 0.08, tl); const yb = g.y1 - tl; const r = Math.min(6, g.m * 0.15);
  return P(roundPoly([[g.x0, g.y0], [g.x1, g.y0], [g.x1, yb], [g.cx + pw, yb], [g.cx, g.y1], [g.cx - pw, yb], [g.x0, yb]], [r, r, r, 0, 0, 0, r]), g.main);
}, (w, h) => ({ x: Math.min(10, w * 0.06), y: 0, w: w - 2 * Math.min(10, w * 0.06), h: h - Math.min(h * 0.22, 10) }), uiSuggest('#1f2937', '#1f2937', '#ffffff'));
add('ui', 'ui-keyboard', 'Clavier', 'clavier touches saisie keyboard keys', 360, 160, (g) => {
  const pad = g.m * 0.05; const rh = (g.H - pad * 5) / 4; const key = attr({ fill: g.inkColor, 'fill-opacity': 0.06, stroke: g.inkColor, 'stroke-opacity': 0.45, 'stroke-width': Math.min(g.dsw * 0.6, 1.2) });
  let out = R(g.x0, g.y0, g.W, g.H, Math.min(10, g.m * 0.08), g.main);
  const rows = [[10, 0], [9, 0.5], [7, 1.5]];
  const kw = (g.W - pad * 11) / 10;
  rows.forEach(([count, offset], row) => {
    for (let k = 0; k < count; k++) out += R(g.x0 + pad + (offset + k) * (kw + pad), g.y0 + pad + row * (rh + pad), kw, rh, Math.min(rh * 0.18, 4), key);
  });
  const y = g.y0 + pad + 3 * (rh + pad);
  out += R(g.x0 + pad, y, kw * 2 + pad, rh, Math.min(rh * 0.18, 4), key) + R(g.x0 + pad * 3 + kw * 2, y, g.W - pad * 6 - kw * 4, rh, Math.min(rh * 0.18, 4), key)
    + R(g.x1 - pad * 2 - kw * 2, y, kw * 2 + pad, rh, Math.min(rh * 0.18, 4), key);
  return out;
}, (w, h) => ({ x: 0, y: 0, w, h }));
const PIN = ['M', [0.5, 1], 'C', [0.38, 0.82], [0, 0.62], [0, 0.38], 'C', [0, 0.17], [0.22, 0], [0.5, 0], 'C', [0.78, 0], [1, 0.17], [1, 0.38], 'C', [1, 0.62], [0.62, 0.82], [0.5, 1], 'Z'];
add('ui', 'ui-map-pin', 'Repère de carte', 'repère carte épingle localisation lieu map pin marker location', 48, 64, (g) => {
  const [cx, cy] = g.p(0.5, 0.38);
  return P(D(...mapUnit(g, PIN)), g.main) + C(cx, cy, Math.min(g.W, g.H) * 0.16, g.line(0.9));
}, T.frac(0.2, 0.15, 0.6, 0.46));
add('ui', 'ui-video-player', 'Lecteur vidéo', 'lecteur vidéo lecture play video player media', 360, 220, (g) => {
  const ch = Math.min(g.H * 0.16, 32); const pcy = g.cy - ch / 2; const pr = Math.min(g.W, g.H - ch) * 0.16;
  const ty = g.y1 - ch / 2; const a = g.x0 + Math.min(g.W * 0.05, 16); const b = g.x1 - Math.min(g.W * 0.05, 16); const v = a + (b - a) * 0.4;
  const lw = clamp(ch * 0.12, 0, 4);
  return R(g.x0, g.y0, g.W, g.H, Math.min(8, g.m * 0.06), g.main) + C(g.cx, pcy, pr, g.tint(0.12))
    + P(poly([[g.cx - pr * 0.3, pcy - pr * 0.45], [g.cx + pr * 0.5, pcy], [g.cx - pr * 0.3, pcy + pr * 0.45]]), g.ink)
    + L(a, ty, b, ty, attr({ stroke: g.inkColor, 'stroke-opacity': 0.25, 'stroke-width': lw, 'stroke-linecap': 'round' }))
    + L(a, ty, v, ty, attr({ stroke: g.inkColor, 'stroke-width': lw, 'stroke-linecap': 'round' })) + C(v, ty, lw * 1.4, g.ink);
}, T.frac(0.05, 0.04, 0.9, 0.18));
add('ui', 'ui-chart-bar', 'Graphique en barres', 'graphique barres histogramme diagramme bar chart graph', 240, 160, (g) => {
  const pad = Math.min(g.m * 0.08, 14); const left = g.x0 + pad; const bottom = g.y1 - pad; const top = g.y0 + g.H * 0.2;
  const heights = [0.45, 0.75, 0.55, 0.9, 0.65]; const slot = (g.x1 - pad - left) / heights.length; const bw = slot * 0.6;
  return R(g.x0, g.y0, g.W, g.H, Math.min(8, g.m * 0.06), g.main)
    + heights.map((k, n) => R(left + slot * n + (slot - bw) / 2, bottom - (bottom - top) * k, bw, (bottom - top) * k, Math.min(2, bw / 4), n % 2 ? g.tint(0.45) : g.tint(0.85))).join('')
    + P(polyline([[left, top - pad * 0.3], [left, bottom], [g.x1 - pad, bottom]]), g.line(0.7, { 'stroke-opacity': 0.6 }));
}, T.frac(0.06, 0.02, 0.88, 0.16));
add('ui', 'ui-chart-pie', 'Graphique circulaire', 'graphique circulaire camembert secteurs pie chart donut', 160, 160, (g) => {
  const r = g.m / 2; const { cx, cy } = g; let a0 = -90; let out = C(cx, cy, r, g.main);
  [[0.42, 0.85], [0.33, 0.5], [0.25, 0.2]].forEach(([part, alpha]) => {
    const a1 = a0 + part * 360;
    out += P(D('M', [cx, cy], 'L', at(cx, cy, r, r, a0), ...arc(cx, cy, r, r, a0, a1), 'Z'), attr({ fill: g.inkColor, 'fill-opacity': alpha, stroke: g.fill === 'none' ? 'none' : g.fill, 'stroke-width': g.dsw * 0.8, 'stroke-linejoin': 'round' }));
    a0 = a1;
  });
  return out + C(cx, cy, r, g.outline);
}, T.circle);

// -------------------------------------------------------------------- api
// Full standalone SVG document (previews, thumbnails, export).
export function shapeSvg(id, w, h, s) {
  const shape = SHAPES[id] || SHAPES.rect;
  const width = num(dim(w)); const height = num(dim(h));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${shape.render(width, height, s)}</svg>`;
}

const fold = (text) => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').toLowerCase();
const CATEGORY_NAMES = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.name]));
const HAYSTACK = {};
for (const shape of Object.values(SHAPES)) HAYSTACK[shape.id] = fold(`${shape.id} ${shape.name} ${shape.keywords} ${CATEGORY_NAMES[shape.category] || ''}`);

// Shapes whose name, keywords or category contain every word of the query
// (case and accent insensitive); every shape for an empty query.
export function search(query) {
  const words = fold(query || '').split(/\s+/).filter(Boolean);
  return Object.values(SHAPES).filter((shape) => words.every((word) => HAYSTACK[shape.id].includes(word)));
}

// Shape ids of a category, in order (all ids without a category).
export function ids(category) {
  return Object.values(SHAPES).filter((shape) => !category || shape.category === category).map((shape) => shape.id);
}
