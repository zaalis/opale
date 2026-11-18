'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Board = require('../shared/board.js');
const Mermaid = require('../shared/board-mermaid.js');

const byId = (graph) => Object.fromEntries(graph.nodes.map((node) => [node.id, node]));
const inside = (outer, inner) => inner.x >= outer.x - 0.01 && inner.y >= outer.y - 0.01 && inner.x + inner.w <= outer.x + outer.w + 0.01 && inner.y + inner.h <= outer.y + outer.h + 0.01;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('header: flowchart / graph, directions and default', () => {
  assert.equal(Mermaid.parse('flowchart TD\nA-->B').direction, 'TB');
  assert.equal(Mermaid.parse('graph LR\nA-->B').direction, 'LR');
  assert.equal(Mermaid.parse('flowchart RL\nA-->B').direction, 'RL');
  assert.equal(Mermaid.parse('graph BT;A-->B').direction, 'BT');
  const plain = Mermaid.parse('%% un commentaire\nflowchart\n  A --> B');
  assert.equal(plain.type, 'flowchart');
  assert.equal(plain.direction, 'TB');
  assert.equal(plain.error, null);
  const fenced = Mermaid.parse('```mermaid\n---\ntitle: Démo\n---\ngraph TD\n  X --> Y\n```');
  assert.deepEqual(fenced.nodes.map((n) => n.id), ['X', 'Y']);
});

test('flowchart: every node shape', () => {
  const g = Mermaid.parse([
    'flowchart TD',
    'a[rect]', 'b(round)', 'c([stadium])', 'd[[subroutine]]', 'e[(cylinder)]', 'f((circle))', 'g>asym]',
    'h{rhombus}', 'i{{hexagon}}', 'j[/para/]', 'k[\\alt\\]', 'l[/trap\\]', 'm[\\trapalt/]', 'n(((double)))',
  ].join('\n'));
  assert.equal(g.error, null);
  const shapes = Object.fromEntries(g.nodes.map((n) => [n.id, [n.shape, n.label]]));
  assert.deepEqual(shapes, {
    a: ['rect', 'rect'], b: ['roundrect', 'round'], c: ['stadium', 'stadium'], d: ['subroutine', 'subroutine'],
    e: ['cylinder', 'cylinder'], f: ['circle', 'circle'], g: ['asymmetric', 'asym'], h: ['diamond', 'rhombus'],
    i: ['hexagon', 'hexagon'], j: ['parallelogram', 'para'], k: ['parallelogram-alt', 'alt'], l: ['trapezoid', 'trap'],
    m: ['trapezoid-alt', 'trapalt'], n: ['double-circle', 'double'],
  });
  for (const node of g.nodes) assert.ok(Mermaid.FLOW_SHAPES.includes(node.shape));
  // The newer @{ } syntax.
  const at = byId(Mermaid.parse('flowchart TD\nq@{ shape: diam, label: "Décision" }\nz@{ shape: cyl }'));
  assert.deepEqual([at.q.shape, at.q.label, at.z.shape, at.z.label], ['diamond', 'Décision', 'cylinder', 'z']);
});

test('flowchart: labels — quotes, <br>, markdown, entities', () => {
  const g = byId(Mermaid.parse([
    'flowchart LR',
    'A["Texte avec ] et (parenthèses)"]',
    'B["ligne 1<br>ligne 2<br/>ligne 3"]',
    'C["**gras** et <i>italique</i>"]',
    'D["#quot;cité#quot; &amp; #35;1"]',
    'E["`Markdown *doux*`"]',
  ].join('\n')));
  assert.equal(g.A.label, 'Texte avec ] et (parenthèses)');
  assert.equal(g.B.label, 'ligne 1\nligne 2\nligne 3');
  assert.equal(g.C.label, 'gras et italique');
  assert.equal(g.D.label, '"cité" & #1');
  assert.equal(g.E.label, 'Markdown doux');
});

test('flowchart: every edge kind', () => {
  const g = Mermaid.parse([
    'flowchart LR',
    'A --> B', 'A --- C', 'A -.-> D', 'A -.- E', 'A ==> F', 'A === G', 'A --o H', 'A --x I', 'A <--> J', 'A o--o K', 'A x--x L', 'A ~~~ M', 'A ---> N', 'A <-.-> O',
  ].join('\n'));
  assert.equal(g.error, null);
  const kinds = g.edges.map((e) => [e.to, e.line, e.arrow]);
  assert.deepEqual(kinds, [
    ['B', 'solid', 'arrow'], ['C', 'solid', 'none'], ['D', 'dotted', 'arrow'], ['E', 'dotted', 'none'],
    ['F', 'thick', 'arrow'], ['G', 'thick', 'none'], ['H', 'solid', 'circle'], ['I', 'solid', 'cross'],
    ['J', 'solid', 'both'], ['K', 'solid', 'circle'], ['L', 'solid', 'cross'], ['M', 'invisible', 'none'],
    ['N', 'solid', 'arrow'], ['O', 'dotted', 'both'],
  ]);
  const k = g.edges.find((e) => e.to === 'K');
  assert.deepEqual([k.start, k.end], ['circle', 'circle']);
});

test('flowchart: edge label syntaxes', () => {
  const g = Mermaid.parse([
    'flowchart TD',
    'A -->|pipe| B', 'A-->|collé|C', 'A -- texte --> D', 'A -. pointillé .-> E', 'A == épais ==> F', 'A -- ouvert --- G', 'A--sans espaces-->H', 'A ---|ouvert pipe| I',
  ].join('\n'));
  assert.equal(g.error, null);
  assert.deepEqual(g.edges.map((e) => [e.to, e.label, e.line, e.arrow]), [
    ['B', 'pipe', 'solid', 'arrow'], ['C', 'collé', 'solid', 'arrow'], ['D', 'texte', 'solid', 'arrow'],
    ['E', 'pointillé', 'dotted', 'arrow'], ['F', 'épais', 'thick', 'arrow'], ['G', 'ouvert', 'solid', 'none'],
    ['H', 'sans espaces', 'solid', 'arrow'], ['I', 'ouvert pipe', 'solid', 'none'],
  ]);
});

test('flowchart: chains, & groups and late definitions', () => {
  const g = Mermaid.parse('flowchart LR\n  A --> B --> C[Fin]\n  X & Y --> P & Q\n  B[Milieu]');
  assert.deepEqual(g.edges.map((e) => `${e.from}>${e.to}`), ['A>B', 'B>C', 'X>P', 'X>Q', 'Y>P', 'Y>Q']);
  const nodes = byId(g);
  assert.equal(nodes.A.label, 'A');
  assert.equal(nodes.B.label, 'Milieu');
  assert.equal(nodes.C.label, 'Fin');
  assert.equal(g.nodes.length, 7);
});

test('flowchart: nested subgraphs, titles, membership and subgraph targets', () => {
  const g = Mermaid.parse([
    'flowchart TB',
    '  c1 --> a2',
    '  subgraph one [Premier groupe]',
    '    a1 --> a2',
    '    subgraph inner',
    '      i1 --> i2',
    '    end',
    '  end',
    '  subgraph Deux mots',
    '    b1',
    '  end',
    '  c1 --> one',
  ].join('\n'));
  assert.equal(g.error, null);
  const subs = Object.fromEntries(g.subgraphs.map((s) => [s.id, s]));
  assert.equal(subs.one.title, 'Premier groupe');
  assert.deepEqual(subs.one.nodes, ['a1', 'a2']);
  assert.equal(subs.inner.parent, 'one');
  assert.deepEqual(subs.inner.nodes, ['i1', 'i2']);
  const deux = g.subgraphs.find((s) => s.title === 'Deux mots');
  assert.ok(deux && deux.nodes.includes('b1'));
  assert.ok(!g.nodes.some((n) => n.id === 'one'), 'a subgraph used as an edge end is not a node');
  const lay = Mermaid.layout(g);
  for (const id of ['a1', 'a2']) assert.ok(inside(lay.subgraphs.one, lay.positions[id]));
  for (const id of ['i1', 'i2']) assert.ok(inside(lay.subgraphs.inner, lay.positions[id]));
  assert.ok(inside(lay.subgraphs.one, lay.subgraphs.inner));
  assert.ok(!overlap(lay.subgraphs.one, lay.positions.c1));
  assert.ok(lay.routes[g.edges.findIndex((e) => e.to === 'one')], 'the edge to a subgraph is routed');
});

test('flowchart: comments, styling statements and separators are ignored', () => {
  const g = Mermaid.parse([
    'flowchart LR',
    '%% un commentaire --> X',
    'classDef rouge fill:#f00,stroke:#333;',
    'A:::rouge --> B; B --> C',
    'class A,B rouge',
    'style C fill:#bbf,stroke:#f66',
    'linkStyle 0 stroke:#ff3,stroke-width:4px',
    'click A callback "Infobulle"',
    'C --> D["a #59; b"]',
  ].join('\n'));
  assert.equal(g.error, null);
  assert.deepEqual(g.nodes.map((n) => n.id), ['A', 'B', 'C', 'D']);
  assert.deepEqual(g.edges.map((e) => `${e.from}>${e.to}`), ['A>B', 'B>C', 'C>D']);
  assert.equal(byId(g).D.label, 'a ; b');
  assert.deepEqual(g.warnings, []);
});

test('layout: TB grows downward, LR rightward, BT and RL reversed', () => {
  const src = (dir) => `flowchart ${dir}\n  A[Début] --> B[Milieu] --> C[Fin]\n  A --> D[Autre]`;
  const tb = Mermaid.layout(Mermaid.parse(src('TB'))).positions;
  assert.ok(tb.A.y + tb.A.h <= tb.B.y && tb.B.y + tb.B.h <= tb.C.y);
  const lr = Mermaid.layout(Mermaid.parse(src('LR'))).positions;
  assert.ok(lr.A.x + lr.A.w <= lr.B.x && lr.B.x + lr.B.w <= lr.C.x);
  const bt = Mermaid.layout(Mermaid.parse(src('BT'))).positions;
  assert.ok(bt.A.y > bt.B.y && bt.B.y > bt.C.y);
  const rl = Mermaid.layout(Mermaid.parse(src('RL'))).positions;
  assert.ok(rl.A.x > rl.B.x && rl.B.x > rl.C.x);
  // Siblings in a layer do not overlap; sizes follow the labels.
  assert.ok(!overlap(tb.B, tb.D));
  const wide = Mermaid.layout(Mermaid.parse('flowchart TD\n  A[Un libellé nettement plus long que les autres] --> B{?}')).positions;
  assert.ok(wide.A.w > 300);
  assert.ok(wide.B.w >= 140 && wide.B.h >= 90, 'diamonds get extra room');
  const lay = Mermaid.layout('flowchart TD\nA-->B');
  assert.equal(lay.positions.A.x >= 0 && lay.positions.A.y === 0, true);
  assert.ok(lay.width > 0 && lay.height > 0);
});

test('layout: cycles and self loops do not hang', () => {
  const g = Mermaid.parse('flowchart TD\n  A --> B --> C --> A\n  C --> C\n  B --> A\n  D --> D');
  const lay = Mermaid.layout(g);
  assert.equal(lay.error, null);
  for (const id of ['A', 'B', 'C', 'D']) {
    const p = lay.positions[id];
    assert.ok([p.x, p.y, p.w, p.h].every(Number.isFinite));
  }
  assert.ok(lay.routes.every((route) => route && route.points.length >= 2 && route.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))));
  const svg = Mermaid.toSvg(g === null ? '' : 'flowchart TD\n  A --> B --> C --> A\n  C --> C');
  assert.equal(svg.error, null);
  assert.ok(!svg.svg.includes('NaN'));
});

test('toElements: flowchart gives valid shapes, frames and connectors', () => {
  const src = [
    'flowchart LR',
    '  subgraph g1 [Groupe]',
    '    A([Départ]) --> B{Choix}',
    '  end',
    '  B -->|Oui| C[(Base)]',
    '  B -. Non .-> D>Drapeau]',
    '  C ==> E((Fin))',
    '  D <--> E',
    '  E --o F',
    '  F --x g1',
    '  F ~~~ A',
  ].join('\n');
  const { elements, error } = Mermaid.toElements(src, { x: 1000, y: -500 });
  assert.equal(error, null);
  const ids = new Set(elements.map((el) => el.id));
  assert.equal(ids.size, elements.length);
  const frames = elements.filter((el) => el.kind === 'frame');
  const shapes = elements.filter((el) => el.kind === 'shape');
  const connectors = elements.filter((el) => el.kind === 'connector');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].data.title, 'Groupe');
  assert.ok(elements.indexOf(frames[0]) < elements.indexOf(shapes[0]), 'frames come first (below in z-order)');
  assert.equal(shapes.length, 6);
  assert.equal(connectors.length, 7, 'invisible links are not drawn');
  for (const el of elements) {
    const copy = Board.normalize(Board.clone(el));
    assert.equal(copy.kind, el.kind);
    assert.ok(Board.KIND_NAMES.includes(el.kind));
    assert.ok(!['A', 'B', 'C', 'g1'].includes(el.id), 'element ids come from Board.create');
  }
  for (const c of connectors) {
    assert.ok(ids.has(c.from.id) && ids.has(c.to.id));
    assert.equal(c.style.path, 'elbow');
  }
  const byText = Object.fromEntries(shapes.map((el) => [el.data.text, el]));
  assert.deepEqual(['Départ', 'Choix', 'Base', 'Drapeau', 'Fin', 'F'].map((t) => byText[t].data.shape), ['stadium', 'diamond', 'cylinder', 'asymmetric', 'circle', 'rect']);
  for (const el of shapes) { assert.equal(el.style.fill, '#ffffff'); assert.equal(el.style.stroke, '#1f2937'); }
  // Top-left at the origin.
  assert.equal(Math.min(...elements.filter((el) => el.kind !== 'connector').map((el) => el.x)), 1000);
  assert.equal(Math.min(...elements.filter((el) => el.kind !== 'connector').map((el) => el.y)), -500);
  // Group contains its shapes.
  for (const t of ['Départ', 'Choix']) assert.ok(inside(frames[0], byText[t]));
  const link = (from, to) => connectors.find((c) => c.from.id === byText[from].id && c.to.id === (to === 'g1' ? frames[0].id : byText[to].id));
  assert.equal(link('Choix', 'Base').data.label, 'Oui');
  assert.equal(link('Choix', 'Drapeau').style.dash, 'dashed');
  assert.equal(link('Base', 'Fin').style.width, 4);
  assert.deepEqual([link('Drapeau', 'Fin').style.start, link('Drapeau', 'Fin').style.end], ['arrow', 'arrow']);
  assert.equal(link('Fin', 'F').style.end, 'circle');
  assert.equal(link('F', 'g1').style.end, 'cross');
  assert.equal(link('Départ', 'Choix').from.side, 'right');
  assert.equal(link('Départ', 'Choix').to.side, 'left');
  // The board can draw every connector.
  const lookup = (id) => elements.find((el) => el.id === id);
  for (const c of connectors) assert.ok(!Board.connectorPath(c, lookup).d.includes('NaN'));
});

test('mindmap: indentation tree, shapes, icons and classes ignored', () => {
  const src = [
    'mindmap',
    '  root((Projet))',
    '    Origines',
    '      ::icon(fa fa-book)',
    '      Histoire[Longue histoire]',
    '        Détail(arrondi)',
    '    Outils:::urgent',
    '      a))Bang((',
    '      b)Nuage(',
    '      c{{Hexa}}',
    '    :::large',
  ].join('\n');
  const g = Mermaid.parse(src);
  assert.equal(g.error, null);
  assert.equal(g.type, 'mindmap');
  assert.equal(g.tree.text, 'Projet');
  assert.equal(g.tree.shape, 'circle');
  assert.deepEqual(g.tree.children.map((c) => c.text), ['Origines', 'Outils']);
  const depth = (node) => 1 + Math.max(0, ...node.children.map(depth));
  assert.equal(depth(g.tree), 4);
  assert.deepEqual(g.tree.children[0].children[0].children.map((c) => [c.text, c.shape]), [['arrondi', 'round']]);
  assert.deepEqual(g.tree.children[1].children.map((c) => [c.text, c.shape]), [['Bang', 'bang'], ['Nuage', 'cloud'], ['Hexa', 'hexagon']]);
  const { elements, error } = Mermaid.toElements(src, { x: 10, y: 20 });
  assert.equal(error, null);
  assert.equal(elements.length, 1);
  const el = elements[0];
  assert.equal(el.kind, 'mindmap');
  assert.deepEqual([el.x, el.y], [10, 20]);
  assert.ok(el.w > 200 && el.h > 100);
  assert.equal(el.data.root.text, 'Projet');
  assert.equal(depth(el.data.root), 4);
  assert.ok(el.data.root.id && el.data.root.children[0].id, 'ids added by Board.normalize');
  const svg = Mermaid.toSvg(src);
  assert.equal(svg.error, null);
  assert.ok(svg.svg.includes('Projet') && svg.svg.includes('Longue histoire'));
});

test('sequence: participants, messages, lifelines', () => {
  const src = [
    'sequenceDiagram',
    '  autonumber',
    '  participant A as Alice',
    '  actor B as Bob',
    '  A->>B: Bonjour Bob',
    '  B-->>A: Salut',
    '  A->B: ligne pleine',
    '  B-->A: pointillés',
    '  A-xB: croix',
    '  A--xB: croix pointillée',
    '  A-)C: asynchrone',
    '  Note over A,B: une note',
    '  loop Chaque minute',
    '    A->>A: soi-même',
    '  end',
    '  ceci ne veut rien dire',
  ].join('\n');
  const g = Mermaid.parse(src);
  assert.equal(g.error, null);
  assert.deepEqual(g.participants.map((p) => [p.id, p.label, p.kind]), [['A', 'Alice', 'participant'], ['B', 'Bob', 'actor'], ['C', 'C', 'participant']]);
  assert.equal(g.messages.length, 8);
  assert.deepEqual(g.messages.slice(0, 7).map((m) => [m.line, m.arrow]), [
    ['solid', 'arrow'], ['dotted', 'arrow'], ['solid', 'none'], ['dotted', 'none'], ['solid', 'cross'], ['dotted', 'cross'], ['solid', 'arrow'],
  ]);
  assert.equal(g.warnings.length, 1);
  const { elements, error } = Mermaid.toElements(src);
  assert.equal(error, null);
  const shapes = elements.filter((el) => el.kind === 'shape');
  const connectors = elements.filter((el) => el.kind === 'connector');
  assert.deepEqual(shapes.map((el) => el.data.shape), ['rect', 'actor', 'rect']);
  assert.equal(connectors.length, 3 + 8);
  const lifelines = connectors.slice(0, 3);
  for (const l of lifelines) { assert.equal(l.style.dash, 'dashed'); assert.equal(l.from.x, l.to.x); assert.ok(l.to.y > l.from.y); assert.equal(l.style.end, 'none'); }
  const messages = connectors.slice(3);
  const ys = messages.map((m) => m.from.y);
  assert.ok(ys.every((y, i) => !i || y > ys[i - 1]), 'messages go down');
  assert.equal(messages[0].data.label, 'Bonjour Bob');
  assert.equal(messages[0].style.path, 'straight');
  assert.equal(messages[1].style.dash, 'dashed');
  assert.equal(messages[4].style.end, 'cross');
  assert.ok(messages[0].from.x < messages[0].to.x && messages[1].from.x > messages[1].to.x);
  const svg = Mermaid.toSvg(src, { dark: true });
  assert.equal(svg.error, null);
  assert.ok(svg.svg.includes('#ecebf3') && svg.svg.includes('Bonjour Bob'));
});

test('toSvg: standalone, escaped, themed', () => {
  const src = 'flowchart TD\n  A["<script>alert(1)</script> a < b & c"] -->|"x < y"| B{{Hex}}\n  B --> C[/Para/]\n  subgraph S [Titre <b>gras</b>]\n    C\n  end';
  const light = Mermaid.toSvg(src);
  assert.equal(light.error, null);
  assert.ok(light.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '));
  assert.ok(!/<script/i.test(light.svg));
  assert.ok(!/href|url\((?!#)/i.test(light.svg), 'no external references');
  assert.ok(light.svg.includes('a &lt; b &amp; c'));
  assert.ok(light.svg.includes('x &lt; y'));
  assert.ok(light.svg.includes('Titre gras'));
  assert.ok(light.svg.includes('<polygon'), 'hexagon and parallelogram are polygons');
  assert.ok(light.svg.includes('marker-end="url(#'));
  assert.ok(light.svg.includes('#1f2937') && light.svg.includes('#64748b') && light.svg.includes('Segoe UI'));
  assert.ok(light.width > 0 && light.height > 0);
  const dark = Mermaid.toSvg(src, { dark: true });
  assert.ok(dark.svg.includes('#c6c3d3') && dark.svg.includes('#1e1d25') && !dark.svg.includes('#1f2937'));
  // Two SVGs on one page never share marker ids.
  const id = (svg) => /<marker id="([^"]+)"/.exec(svg)[1];
  assert.notEqual(id(light.svg), id(dark.svg));
  // Every shape renders.
  const all = Mermaid.toSvg('flowchart LR\na[r]-->b(r)-->c([s])-->d[[s]]-->e[(c)]-->f((c))-->g>a]-->h{d}-->i{{h}}-->j[/p/]-->k[\\p\\]-->l[/t\\]-->m[\\t/]-->n(((d)))');
  assert.equal(all.error, null);
  assert.ok(!all.svg.includes('NaN') && !all.svg.includes('undefined'));
});

test('garbage input returns an error and never throws', () => {
  const inputs = [undefined, null, 42, {}, [], '', '   \n  ', 'bonjour le monde', 'pie title Animaux\n "Chiens" : 3',
    'flowchart TD', 'flowchart TD\n  !!! ???', 'flowchart TD\n A[jamais fermé', 'mindmap', 'sequenceDiagram\n  Note over A: rien',
    'flowchart TD\n' + '['.repeat(5000), 'graph LR\n' + 'A-->'.repeat(2000) + 'B', '\u0000\u0001flowchart'];
  for (const input of inputs) {
    const g = Mermaid.parse(input);
    const lay = Mermaid.layout(g);
    const els = Mermaid.toElements(input);
    const svg = Mermaid.toSvg(input);
    assert.ok(Array.isArray(els.elements));
    assert.equal(typeof svg.svg, 'string');
    if (g.error) {
      assert.equal(typeof g.error, 'string');
      assert.equal(els.error, g.error);
      assert.equal(svg.error, g.error);
      assert.equal(els.elements.length, 0);
      assert.equal(typeof lay.error, 'string');
    }
  }
  assert.match(Mermaid.parse('pie title Animaux').error, /^Type de diagramme Mermaid non pris en charge : pie/);
  assert.match(Mermaid.parse('').error, /vide/);
  assert.equal(Mermaid.parse('flowchart TD\n A[jamais fermé').error !== null, true);
  // A bad line is skipped, the rest still parses.
  const partial = Mermaid.parse('flowchart TD\n A --> B\n C[[oups\n B --> D');
  assert.equal(partial.error, null);
  assert.deepEqual(partial.nodes.map((n) => n.id), ['A', 'B', 'D']);
  assert.equal(partial.warnings.length, 1);
  assert.equal(Mermaid.layout(null).error, 'Graphe Mermaid invalide.');
});

test('a 300-node random graph lays out in under 500 ms', () => {
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const lines = ['flowchart TD'];
  for (let i = 0; i < 300; i++) lines.push(`  n${i}[Nœud ${i}]`);
  for (let i = 0; i < 450; i++) lines.push(`  n${Math.floor(rand() * 300)} --> n${Math.floor(rand() * 300)}`);
  for (let s = 0; s < 3; s++) lines.push(`  subgraph s${s}`, ...Array.from({ length: 10 }, (_, k) => `    n${s * 10 + k}`), '  end');
  const source = lines.join('\n');
  const started = performance.now();
  const g = Mermaid.parse(source);
  const lay = Mermaid.layout(g);
  const elapsed = performance.now() - started;
  assert.equal(lay.error, null);
  assert.equal(Object.keys(lay.positions).length, 300);
  assert.ok(elapsed < 500, `layout took ${Math.round(elapsed)} ms`);
  // No two nodes overlap.
  const boxes = Object.values(lay.positions);
  const byRow = new Map();
  for (const b of boxes) { const key = Math.round(b.y + b.h / 2); if (!byRow.has(key)) byRow.set(key, []); byRow.get(key).push(b); }
  for (const row of byRow.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) assert.ok(row[i].x >= row[i - 1].x + row[i - 1].w - 0.01);
  }
  const svg = Mermaid.toSvg(source);
  assert.equal(svg.error, null);
  const { elements } = Mermaid.toElements(source);
  assert.equal(elements.filter((el) => el.kind === 'shape').length, 300);
});
