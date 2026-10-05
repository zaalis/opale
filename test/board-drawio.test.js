'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Drawio = require('../shared/board-drawio.js');

// A small but complete uncompressed file.
const MODEL = `<mxGraphModel dx="800" dy="600" grid="1">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <mxCell id="r" value="Rectangle" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#DAE8FC;strokeColor=#6c8ebf;fontColor=#333333;fontSize=14;dashed=1;rotation=30;opacity=50;" vertex="1" parent="1">
      <mxGeometry x="100" y="50" width="120" height="60" as="geometry" />
    </mxCell>
    <mxCell id="e" value="Rond" style="ellipse;whiteSpace=wrap;html=1;aspect=fixed;" vertex="1" parent="1">
      <mxGeometry x="300" y="50" width="80" height="80" as="geometry" />
    </mxCell>
    <mxCell id="d" value="Choix ?" style="rhombus;whiteSpace=wrap;html=1;fillColor=none;" vertex="1" parent="1">
      <mxGeometry x="450" y="40" width="100" height="100" as="geometry" />
    </mxCell>
    <mxCell id="t" value="Un titre" style="text;html=1;align=left;verticalAlign=middle;fontColor=#FF0000;fontSize=20;" vertex="1" parent="1">
      <mxGeometry x="100" y="0" width="200" height="30" as="geometry" />
    </mxCell>
    <mxCell id="lane" value="Équipe" style="swimlane;startSize=30;" vertex="1" parent="1">
      <mxGeometry x="600" y="200" width="300" height="200" as="geometry" />
    </mxCell>
    <mxCell id="inner" value="Dedans" style="shape=cloud;" vertex="1" parent="lane">
      <mxGeometry x="20" y="40" width="100" height="60" as="geometry" />
    </mxCell>
    <mxCell id="deep" value="Profond" style="whiteSpace=wrap;" vertex="1" parent="inner">
      <mxGeometry x="5" y="5" width="20" height="20" as="geometry" />
    </mxCell>
    <mxCell id="edge1" value="oui" style="edgeStyle=orthogonalEdgeStyle;dashed=1;strokeColor=#FF8000;strokeWidth=3;startArrow=oval;endArrow=block;" edge="1" parent="1" source="r" target="e">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="edge2" style="curved=1;endArrow=none;startArrow=diamondThin;" edge="1" parent="1" source="e" target="inner">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="lbl" value="étiquette" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="edge2">
      <mxGeometry x="-0.2" relative="1" as="geometry"><mxPoint as="offset" /></mxGeometry>
    </mxCell>
  </root>
</mxGraphModel>`;
const FILE = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- exported -->\n<mxfile host="app.diagrams.net"><diagram id="p1" name="Accueil">${MODEL}</diagram></mxfile>`;

const byText = (elements, text) => elements.find((el) => el.data.text === text || el.data.title === text);
const connectors = (elements) => elements.filter((el) => el.kind === 'connector');

async function compress(xml) {
  const bytes = new TextEncoder().encode(encodeURIComponent(xml));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const b of out) binary += String.fromCharCode(b);
  return btoa(binary);
}

test('XML reader: entities, CDATA, comments, ">" inside attributes, doctype', () => {
  const { root, error } = Drawio.parseXml(`<?xml version="1.0"?><!DOCTYPE x [ <!ENTITY a "b>"> ]>
    <a one="x &gt; y" two='it&apos;s "q"' three="&#233;&#x1F600;&bogus;&#xD800;"><!-- <b>not</b> -->
      <b/><c k="1">t &lt;&amp;&gt; <![CDATA[<raw & stuff>]]></c><d /></a>`);
  assert.equal(error, null);
  const a = root.children[0];
  assert.equal(a.name, 'a');
  assert.equal(a.attrs.one, 'x > y');
  assert.equal(a.attrs.two, 'it\'s "q"');
  assert.equal(a.attrs.three, 'é😀&bogus;&#xD800;');
  assert.deepEqual(a.children.map((child) => child.name), ['b', 'c', 'd']);
  assert.equal(a.children[1].text, 't <&> <raw & stuff>');
  assert.equal(a.children[1].attrs.k, '1');
  assert.equal(Object.getPrototypeOf(a.attrs), null);
});

test('XML reader: cut-off input is an error, never a throw', () => {
  assert.match(Drawio.parseXml('<a b="unterminated>').error, /XML invalide/);
  assert.match(Drawio.parseXml('<a b="1"').error, /XML invalide/);
  assert.equal(Drawio.parseXml('<a><b></a> stray </z>').error, null);
});

test('style strings and HTML labels', () => {
  const style = Drawio.parseStyle('ellipse;shape=cloud;fillColor=#fff;;whiteSpace=wrap');
  assert.deepEqual(style._names, ['ellipse']);
  assert.equal(style.shape, 'cloud');
  assert.equal(style.fillColor, '#fff');
  assert.equal(Drawio.htmlToText('<div><b>Gras</b>&nbsp;ici</div><div>ligne<br>deux &amp;lt;3</div><script>x()</script>'), 'Gras ici\nligne\ndeux &lt;3');
});

test('decode: uncompressed file, bare model, garbage', async () => {
  const file = await Drawio.decode(FILE);
  assert.equal(file.error, null);
  assert.equal(file.pages.length, 1);
  assert.equal(file.pages[0].name, 'Accueil');
  assert.ok(file.xml.startsWith('<mxGraphModel') && file.xml.endsWith('</mxGraphModel>'));
  const bare = await Drawio.decode(MODEL);
  assert.equal(bare.error, null);
  assert.equal(bare.xml, MODEL);
  for (const bad of ['', 'hello', '{"nodes":[]}', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', '<mxfile></mxfile>', null, 42, '\u0000<<<>>>', '<mxfile><diagram>!!!notbase64</diagram></mxfile>', '<mxfile><diagram>QUJD</diagram></mxfile>']) {
    const result = await Drawio.decode(bad);
    assert.ok(result.error, `expected an error for ${JSON.stringify(bad)}`);
  }
  assert.equal((await Drawio.decode('<svg/>')).error, 'Ce fichier n’est pas un diagramme draw.io.');
});

test('vertices: shapes, colours, text, frame and accumulated child offsets', async () => {
  const { elements, error, warnings } = Drawio.toElements((await Drawio.decode(FILE)).xml);
  assert.equal(error, null);
  assert.deepEqual(warnings, []);
  const rect = byText(elements, 'Rectangle');
  assert.equal(rect.kind, 'shape');
  assert.equal(rect.data.shape, 'roundrect');
  assert.equal(rect.style.fill, '#dae8fc');
  assert.equal(rect.style.stroke, '#6c8ebf');
  assert.equal(rect.style.color, '#333333');
  assert.equal(rect.style.fontSize, 14);
  assert.equal(rect.style.dash, 'dashed');
  assert.equal(rect.style.opacity, 0.5);
  assert.equal(rect.rotation, 30);
  assert.equal(byText(elements, 'Rond').data.shape, 'circle');
  const diamond = byText(elements, 'Choix ?');
  assert.equal(diamond.data.shape, 'diamond');
  assert.equal(diamond.style.fill, 'transparent');
  const title = byText(elements, 'Un titre');
  assert.equal(title.kind, 'text');
  assert.equal(title.style.color, '#ff0000');
  assert.equal(title.style.fontSize, 20);
  assert.equal(title.style.align, 'left');
  const lane = byText(elements, 'Équipe');
  assert.equal(lane.kind, 'frame');
  const inner = byText(elements, 'Dedans');
  const deep = byText(elements, 'Profond');
  assert.equal(inner.data.shape, 'cloud');
  assert.equal(deep.data.shape, 'rect');
  assert.deepEqual([inner.x - lane.x, inner.y - lane.y], [20, 40]);
  assert.deepEqual([deep.x - lane.x, deep.y - lane.y], [25, 45]);
  assert.ok(elements.indexOf(lane) < elements.indexOf(inner) && elements.indexOf(inner) < elements.indexOf(deep), 'containers come first');
  // No draw.io id survives, and the edge label cell is no element of its own.
  for (const el of elements) assert.ok(!['r', 'e', 'd', 't', 'lane', 'inner', 'deep', 'edge1', 'edge2', 'lbl'].includes(el.id));
  assert.equal(elements.filter((el) => el.kind !== 'connector').length, 7);
});

test('everything is moved so the top-left lands on the origin', async () => {
  const { elements } = Drawio.toElements(MODEL, { x: 1000, y: -50 });
  // The rotated rectangle sticks out to the left of x=100 a little.
  const minX = Math.min(...elements.filter((el) => el.kind !== 'connector').map((el) => require('../shared/board.js').bounds(el).x));
  const minY = Math.min(...elements.filter((el) => el.kind !== 'connector').map((el) => el.y));
  assert.ok(Math.abs(minX - 1000) < 1e-9);
  assert.equal(minY, -50);
  assert.equal(byText(elements, 'Un titre').y, -50);
});

test('edges: ends, path, arrows, colour, dash, labels', async () => {
  const { elements } = Drawio.toElements(MODEL);
  const [first, second] = connectors(elements);
  assert.equal(first.from.id, byText(elements, 'Rectangle').id);
  assert.equal(first.to.id, byText(elements, 'Rond').id);
  assert.equal(first.data.label, 'oui');
  assert.equal(first.style.path, 'elbow');
  assert.equal(first.style.start, 'circle');
  assert.equal(first.style.end, 'arrow');
  assert.equal(first.style.color, '#ff8000');
  assert.equal(first.style.width, 3);
  assert.equal(first.style.dash, 'dashed');
  assert.equal(second.style.path, 'curve');
  assert.equal(second.style.start, 'diamond');
  assert.equal(second.style.end, 'none');
  assert.equal(second.data.label, 'étiquette');
  assert.equal(second.to.id, byText(elements, 'Dedans').id);
});

test('edges: default style is a straight arrow, free endpoints are kept and moved', () => {
  const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry x="100" y="100" width="40" height="40" as="geometry"/></mxCell>
    <mxCell id="x" edge="1" parent="1" source="a"><mxGeometry relative="1" as="geometry"><mxPoint x="20" y="300" as="targetPoint"/></mxGeometry></mxCell>
    <mxCell id="y" edge="1" parent="1" target="ghost"><mxGeometry relative="1" as="geometry"><mxPoint x="50" y="60" as="sourcePoint"/><mxPoint x="400" y="60" as="targetPoint"/></mxGeometry></mxCell>
  </root></mxGraphModel>`;
  const { elements, error } = Drawio.toElements(xml);
  assert.equal(error, null);
  const [x, y] = connectors(elements);
  assert.equal(x.style.path, 'straight');
  assert.equal(x.style.start, 'none');
  assert.equal(x.style.end, 'arrow');
  assert.ok(x.from.id);
  assert.equal(x.to.id, undefined);
  // Top-left is (20, 60): everything shifts by (-20, -60).
  assert.deepEqual([x.to.x, x.to.y], [0, 240]);
  assert.deepEqual([y.from.x, y.from.y, y.to.x, y.to.y], [30, 0, 380, 0]);
  assert.equal(y.to.id, undefined, 'a missing target is a free end');
  const a = elements.find((el) => el.kind === 'shape');
  assert.deepEqual([a.x, a.y], [80, 40]);
});

test('every connector end points at an element of the result', async () => {
  const { elements } = await Drawio.importText(FILE);
  const ids = new Set(elements.map((el) => el.id));
  assert.equal(ids.size, elements.length, 'ids are unique');
  for (const el of connectors(elements)) {
    for (const end of [el.from, el.to]) if (end.id) assert.ok(ids.has(end.id), `${end.id} exists`);
  }
});

test('labels: HTML values and UserObject / object wrappers', () => {
  const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="h" value="&lt;div&gt;&lt;b&gt;Haut&lt;/b&gt;&lt;/div&gt;&lt;div&gt;bas &amp;amp; fin&lt;br&gt;&lt;/div&gt;" style="html=1;" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>
    <UserObject label="Objet &lt;i&gt;riche&lt;/i&gt;" link="https://x" id="u"><mxCell style="html=1;shape=hexagon;" vertex="1" parent="1"><mxGeometry x="100" width="80" height="40" as="geometry"/></mxCell></UserObject>
    <object label="Brut" id="o"><mxCell style="triangle;" vertex="1" parent="1"><mxGeometry x="200" width="80" height="40" as="geometry"/></mxCell></object>
    <mxCell id="z" edge="1" parent="1" source="u" target="o"><mxGeometry relative="1" as="geometry"/></mxCell>
  </root></mxGraphModel>`;
  const { elements } = Drawio.toElements(xml);
  assert.equal(elements[0].data.text, 'Haut\nbas & fin');
  assert.equal(elements[1].data.text, 'Objet riche');
  assert.equal(elements[1].data.shape, 'hexagon');
  assert.equal(elements[2].data.text, 'Brut');
  assert.equal(elements[2].data.shape, 'triangle');
  assert.equal(elements[3].from.id, elements[1].id);
  assert.equal(elements[3].to.id, elements[2].id);
});

test('flowchart names, unknown shapes and images give warnings once', () => {
  const cell = (id, style, x) => `<mxCell id="${id}" value="${id}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" width="80" height="40" as="geometry"/></mxCell>`;
  const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
    ${cell('a', 'shape=mxgraph.flowchart.decision;', 0)}${cell('b', 'shape=mxgraph.flowchart.terminator;', 100)}
    ${cell('c', 'shape=mxgraph.aws4.lambda;', 200)}${cell('d', 'shape=mxgraph.aws4.lambda;', 300)}
    ${cell('e', 'shape=image;image=data:image/png,iVBORw0KGgo=;', 400)}${cell('f', 'shape=process;', 500)}
    ${cell('g', 'shape=mxgraph.flowchart.manual_input;', 600)}${cell('h', 'ellipse;shape=doubleEllipse;', 700)}
  </root></mxGraphModel>`;
  const { elements, warnings } = Drawio.toElements(xml);
  assert.deepEqual(elements.map((el) => el.data.shape), ['diamond', 'stadium', 'rect', 'rect', 'rect', 'subroutine', 'manual-input', 'double-circle']);
  assert.equal(elements[4].data.text, '[image]\ne');
  assert.deepEqual(warnings, ['Forme inconnue remplacée par un rectangle : mxgraph.aws4.lambda', 'Image non importée : data:image/png,iVBORw0KGgo=']);
});

test('compressed diagrams round-trip through deflate-raw', async () => {
  const data = await compress(MODEL);
  const file = `<mxfile><diagram name="Compressé" id="z">\n${data}\n</diagram></mxfile>`;
  const decoded = await Drawio.decode(file);
  assert.equal(decoded.error, null);
  assert.equal(decoded.xml, MODEL);
  const result = await Drawio.importText(file, { x: 10, y: 20 });
  assert.equal(result.error, null);
  assert.equal(result.elements.filter((el) => el.kind === 'connector').length, 2);
  assert.equal(byText(result.elements, 'Un titre').y, 20);
});

test('multi-page files: every page, side by side in named frames', async () => {
  const second = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="q" value="Seul" vertex="1" parent="1"><mxGeometry x="500" y="500" width="100" height="50" as="geometry"/></mxCell></root></mxGraphModel>`;
  const file = `<mxfile><diagram name="Un">${MODEL}</diagram><diagram name="Deux">${await compress(second)}</diagram></mxfile>`;
  const decoded = await Drawio.decode(file);
  assert.deepEqual(decoded.pages.map((page) => page.name), ['Un', 'Deux']);
  assert.equal(decoded.pages[1].xml, second);
  const { elements, error } = await Drawio.importText(file);
  assert.equal(error, null);
  const frames = elements.filter((el) => el.kind === 'frame' && (el.data.title === 'Un' || el.data.title === 'Deux'));
  assert.equal(frames.length, 2);
  const [one, two] = frames;
  assert.deepEqual([one.x, one.y, two.y], [0, 0, 0]);
  assert.equal(two.x, one.x + one.w + 200);
  const alone = byText(elements, 'Seul');
  assert.deepEqual([alone.x, alone.y], [two.x + 40, 40]);
  assert.ok(elements.indexOf(two) < elements.indexOf(alone));
});

test('hostile models: cycles, missing geometry, garbage never throw', async () => {
  const xml = `<mxGraphModel><root><mxCell id="a" vertex="1" parent="b"/><mxCell id="b" vertex="1" parent="a"/><mxCell id="__proto__" vertex="1" parent="constructor"/></root></mxGraphModel>`;
  const result = Drawio.toElements(xml);
  assert.equal(result.error, null);
  assert.equal(result.elements.length, 3);
  assert.ok(Drawio.toElements('pas du xml').error);
  assert.ok(Drawio.toElements(undefined).error);
  assert.ok((await Drawio.importText('<<<')).error);
  assert.ok((await Drawio.importText({})).error);
});

test('a 2000-cell model is read in under 500 ms', () => {
  const parts = ['<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'];
  for (let i = 0; i < 1000; i++) {
    parts.push(`<mxCell id="v${i}" value="&lt;b&gt;N${i}&lt;/b&gt;" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;" vertex="1" parent="1"><mxGeometry x="${(i % 40) * 150}" y="${Math.floor(i / 40) * 100}" width="120" height="60" as="geometry"/></mxCell>`);
    parts.push(`<mxCell id="e${i}" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="v${i}" target="v${(i + 1) % 1000}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
  }
  parts.push('</root></mxGraphModel>');
  const started = performance.now();
  const { elements, error } = Drawio.toElements(parts.join(''));
  const elapsed = performance.now() - started;
  assert.equal(error, null);
  assert.equal(elements.length, 2000);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)} ms`);
});
