'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Meta = require('../shared/meta.js');
const Markdown = require('../shared/markdown.js');

test('frontmatter: scalars, inline lists, dash lists', () => {
  const split = Meta.splitFrontmatter('---\ntitle: "Deux: points"\ntags: [a, b/c]\naliases:\n  - Premier nom\n  - Second\ndone: true\nrank: 3\n---\nCorps');
  assert.equal(split.bodyLine, 9);
  assert.equal(split.body, 'Corps');
  assert.deepEqual(Meta.parseYaml(split.yaml), { title: 'Deux: points', tags: ['a', 'b/c'], aliases: ['Premier nom', 'Second'], done: true, rank: 3 });
});

test('frontmatter round-trips through stringify', () => {
  const data = { tags: ['x', 'y'], statut: 'en cours', note: 'a: b', vide: [] };
  assert.deepEqual(Meta.parseYaml(Meta.stringifyYaml(data)), data);
  assert.equal(Meta.withFrontmatter('---\nold: 1\n---\nTexte', { neuf: 2 }), '---\nneuf: 2\n---\nTexte');
  assert.equal(Meta.withFrontmatter('---\nold: 1\n---\nTexte', {}), 'Texte');
});

test('extract: links, tags, headings, tasks — and nothing from code', () => {
  const meta = Meta.extract([
    '---', 'tags: [meta]', 'aliases: Alias un, Alias deux', '---',
    '# Titre #pasuntag-mais-si',
    'Voir [[Cible#Section|texte]] et ![[image.png|200]] puis [md](Dossier/Autre%20note.md#ancre).',
    'Lien externe [x](https://exemple.fr) ignoré. #projet/web et #2024 ne compte pas.',
    '`[[pas un lien]] #pasuntag`',
    '```', '[[dans du code]] #code', '```',
    '- [ ] à faire', '- [x] fait',
    'Un bloc ^abc123',
  ].join('\n'));
  assert.deepEqual(meta.links.map((link) => [link.target, link.subpath, link.alias, link.embed, link.style]), [
    ['Cible', 'Section', 'texte', false, 'wiki'],
    ['image.png', '', '200', true, 'wiki'],
    ['Dossier/Autre note.md', 'ancre', 'md', false, 'md'],
  ]);
  assert.deepEqual(meta.tags.sort(), ['meta', 'pasuntag-mais-si', 'projet/web']);
  assert.deepEqual(meta.headings, [{ level: 1, text: 'Titre #pasuntag-mais-si', line: 4 }]);
  assert.deepEqual(meta.aliases, ['Alias un', 'Alias deux']);
  assert.deepEqual(meta.tasks, { total: 2, done: 1 });
  assert.deepEqual(meta.blockIds, [{ id: 'abc123', line: 13 }]);
});

test('resolver: exact path, relative, by name, shortest wins', () => {
  const resolver = Meta.buildResolver(['Idée.md', 'Projets/Idée.md', 'Projets/Web/Plan.md', 'Pièces/photo.png', 'a.b notes.md']);
  assert.equal(resolver.resolve('Idée', 'Projets/Web/Plan.md'), 'Idée.md');
  assert.equal(resolver.resolve('Projets/Idée', null), 'Projets/Idée.md');
  assert.equal(resolver.resolve('plan', null), 'Projets/Web/Plan.md');
  assert.equal(resolver.resolve('Web/Plan', 'Idée.md'), 'Projets/Web/Plan.md');
  assert.equal(resolver.resolve('photo.png', 'Idée.md'), 'Pièces/photo.png');
  assert.equal(resolver.resolve('../Idée', 'Projets/Web/Plan.md'), 'Projets/Idée.md');
  assert.equal(resolver.resolve('a.b notes', null), 'a.b notes.md');
  assert.equal(resolver.resolve('Absente', null), null);
  assert.equal(resolver.resolve('', 'Idée.md'), 'Idée.md');
  assert.equal(resolver.linkText('Idée.md'), 'Idée');
  assert.equal(resolver.linkText('Projets/Idée.md'), 'Projets/Idée');
  assert.equal(resolver.linkText('Pièces/photo.png'), 'photo.png');
});

test('rewriteLinks keeps alias, section, embeds and skips code', () => {
  const source = 'A [[Vieux|alias]] B ![[Vieux#S]] C `[[Vieux]]` D [t](Vieux.md#s)\n```\n[[Vieux]]\n```';
  const result = Meta.rewriteLinks(source, (link) => (link.target.replace(/\.md$/, '') === 'Vieux' ? (link.style === 'md' ? 'Dossier/Neuf nom.md' : 'Neuf') : null));
  assert.equal(result.changed, 3);
  assert.equal(result.text, 'A [[Neuf|alias]] B ![[Neuf#S]] C `[[Vieux]]` D [t](Dossier/Neuf%20nom.md#s)\n```\n[[Vieux]]\n```');
});

test('formatDate tokens', () => {
  const date = new Date(2026, 8, 30, 9, 5, 7);
  assert.equal(Meta.formatDate(date, 'YYYY-MM-DD'), '2026-09-30');
  assert.equal(Meta.formatDate(date, 'dddd D MMMM YYYY [à] HH:mm'), 'mercredi 30 septembre 2026 à 09:05');
});

const ctx = {
  resolve: (target) => ({ existe: 'Existe.md', 'image.png': 'img/image.png', 'doc.pdf': 'doc.pdf' }[target.toLowerCase()] || null),
  fileUrl: (path) => `/api/file?path=${encodeURIComponent(path)}`,
};

test('inline: emphasis, code, links, tags, embeds', () => {
  assert.equal(Markdown.renderInline('**gras** *ital* ~~non~~ ==oui== `a<b`', ctx), '<strong>gras</strong> <em>ital</em> <del>non</del> <mark>oui</mark> <code>a&lt;b</code>');
  assert.equal(Markdown.renderInline('[[Existe|ici]] [[Absente#S]]', ctx), '<a class="internal-link" data-href="Existe" data-path="Existe.md">ici</a> <a class="internal-link is-unresolved" data-href="Absente" data-subpath="S">Absente &gt; S</a>');
  assert.match(Markdown.renderInline('![[image.png|120]]', ctx), /<img class="embed-image" src="\/api\/file\?path=img%2Fimage\.png" alt="image\.png" width="120"/);
  assert.match(Markdown.renderInline('![[Existe]]', ctx), /class="embed embed-note" data-embed-path="Existe\.md" data-embed-depth="1"/);
  // A missing picture names its target, so the interface can offer to repair it.
  assert.equal(Markdown.renderInline('![photo](absente%20ici.png)', ctx), '<span class="embed embed-missing" data-href="absente ici.png">photo</span>');
  assert.equal(Markdown.renderInline('un #tag/sous et 2 * 3 * 4', ctx), 'un <a class="tag" data-tag="tag/sous">#tag/sous</a> et 2 * 3 * 4');
  assert.equal(Markdown.renderInline('snake_case_name et _ital_', ctx), 'snake_case_name et <em>ital</em>');
  assert.match(Markdown.renderInline('https://exemple.fr/a.', ctx), /^<a class="external-link" href="https:\/\/exemple\.fr\/a" target="_blank" rel="noopener noreferrer">https:\/\/exemple\.fr\/a<\/a>\.$/);
});

test('inline: hostile input stays inert', () => {
  const html = Markdown.renderInline('<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1)) <b onclick="x">y</b> <b>ok', ctx);
  assert.ok(!/<script|<img|javascript:|onclick=|onerror=[^&]/i.test(html.replace(/&lt;[^]*?&gt;/g, '')), html);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.endsWith('<b>ok</b>'), 'an unclosed allowed tag is closed inside its own run');
  assert.ok(!Markdown.renderInline('[[a" onmouseover="x]]', ctx).includes('" onmouseover="x'));
});

test('blocks: headings, lists, tasks, code, tables, callouts', () => {
  const html = Markdown.render([
    '# Titre', '', 'Para une', 'ligne deux', '',
    '- a', '  - b', '- [x] fait', '- [ ] reste', '',
    '1. un', '2. deux', '',
    '```js', 'const x = "<";', '```', '',
    '| A | B |', '| :-- | --: |', '| 1 | [[Existe\\|e]] |', '',
    '> [!warning]- Attention ici', '> contenu', '',
    '> citation', '', '---', '', 'Fin[^n].', '', '[^n]: La note.',
  ].join('\n'), ctx);
  assert.match(html, /<h1 data-line="0" data-heading="Titre">Titre<\/h1>/);
  assert.match(html, /<p data-line="2">Para une<br>\nligne deux<\/p>/);
  assert.match(html, /<ul data-line="5" class="contains-task-list"><li data-line="5"><span class="list-text" data-line="5">a<\/span><ul data-line="6"><li data-line="6"><span class="list-text" data-line="6">b<\/span><\/li><\/ul><\/li>/);
  assert.match(html, /<li class="task-list-item is-checked" data-task="x" data-line="7"><input type="checkbox" class="task-list-item-checkbox" data-line="7" checked>/);
  assert.match(html, /<ol data-line="10">/);
  assert.match(html, /<pre class="code-block" data-line="13" data-lang="js"><code><span class="tok-keyword">const<\/span> x = <span class="tok-string">&quot;&lt;&quot;<\/span>;<\/code><\/pre>/);
  assert.match(html, /<th style="text-align:left">A<\/th><th style="text-align:right">B<\/th>/);
  assert.match(html, /<td style="text-align:right"><a class="internal-link" data-href="Existe" data-path="Existe\.md">e<\/a><\/td>/);
  assert.match(html, /<details class="callout" data-callout="warning" data-callout-color="orange" data-line="21"><summary class="callout-title">/);
  assert.match(html, /<blockquote data-line="24"><p data-line="24">citation<\/p><\/blockquote>/);
  assert.match(html, /<hr data-line="26">/);
  assert.match(html, /<sup class="footnote-ref" data-footnote="n">\[1\]<\/sup>/);
  assert.match(html, /<section class="footnotes"><hr><ol><li data-footnote="n">La note\.<\/li><\/ol><\/section>/);
});

test('blocks: #tag at line start is not a heading, properties render', () => {
  assert.match(Markdown.render('#projet en tête', ctx), /^<p data-line="0"><a class="tag" data-tag="projet">#projet<\/a> en tête<\/p>$/);
  const html = Markdown.render('---\ntags: [a, b]\nfait: true\n---\nCorps', ctx);
  assert.match(html, /<div class="properties" data-line="0">/);
  assert.match(html, /<a class="tag" data-tag="a">#a<\/a> <a class="tag" data-tag="b">#b<\/a>/);
  assert.match(html, /<p data-line="4">Corps<\/p>/);
});

test('liveBlocks: one unit per block and per top-level list item', () => {
  const text = ['# T', '', 'p1', 'p1b', '', '- a', '  - a1', '- b', '', '3. x', '4. y', '', '```', 'c', '```'].join('\n');
  const blocks = Markdown.liveBlocks(text).map((block) => [block.token.type, block.start, block.end]);
  assert.deepEqual(blocks, [['heading', 0, 0], ['paragraph', 2, 3], ['list', 5, 6], ['list', 7, 7], ['list', 9, 9], ['list', 10, 10], ['code', 12, 14]]);
  const fourth = Markdown.liveBlocks(text)[5];
  assert.match(Markdown.renderToken(fourth.token, ctx), /<ol data-line="10" start="4">/);
});

test('images: placement and size options render and round-trip', () => {
  const ctx = { resolve: (target) => (target === 'chat.png' ? 'img/chat.png' : null), fileUrl: (path) => `/f/${path}` };
  assert.deepEqual(Markdown.imageOptions('Mon chat|left|300'), { alt: 'Mon chat', align: 'left', width: '300', height: '' });
  assert.deepEqual(Markdown.imageOptions('300x200|droite'), { alt: '', align: 'right', width: '300', height: '200' });
  assert.match(Markdown.renderInline('![[chat.png|left|300]]', ctx), /<img class="embed-image align-left" src="\/f\/img\/chat\.png" alt="chat\.png" width="300"/);
  assert.match(Markdown.renderInline('![Chat|center|120](chat.png)', ctx), /class="embed-image align-center"[^>]*alt="Chat" width="120"/);
  assert.match(Markdown.renderInline('![[chat.png|Légende]]', ctx), /class="embed-image" [^>]*alt="Légende"/);
  // Rewriting keeps the target and the text; the size always comes last.
  assert.equal(Markdown.rewriteImage('![[chat.png]]', { width: 250.4 }), '![[chat.png|250]]');
  assert.equal(Markdown.rewriteImage('![[chat.png|Légende|300]]', { align: 'right' }), '![[chat.png|Légende|right|300]]');
  assert.equal(Markdown.rewriteImage('![[chat.png|left|300x200]]', { width: null, align: '' }), '![[chat.png]]');
  assert.equal(Markdown.rewriteImage('![[chat.png\|300]]', { align: 'left' }), '![[chat.png\|left\|300]]');
  assert.equal(Markdown.rewriteImage('![Chat](img/chat.png "titre")', { width: 90 }), '![Chat|90](img/chat.png "titre")');
});

test('images: removing, inserting and moving an embed keeps the text tidy', () => {
  const text = 'Avant.\n\n![[a.png|300]]\n\nAprès le texte.\n';
  const start = text.indexOf('![['); const end = text.indexOf(']]') + 2;
  assert.equal(Markdown.removeSpan(text, start, end), 'Avant.\n\nAprès le texte.\n');
  assert.equal(Markdown.removeSpan('Un ![[a.png]] deux', 3, 13), 'Un deux');
  assert.equal(Markdown.removeSpan('![[a.png]] deux', 0, 10), 'deux');
  assert.deepEqual(Markdown.insertAt('Un deux', 2, '![[a.png]]', false), { text: 'Un ![[a.png]] deux', at: 3 });
  assert.deepEqual(Markdown.insertAt('Undeux', 2, '![[a.png]]', false), { text: 'Un ![[a.png]] deux', at: 3 });
  assert.deepEqual(Markdown.insertAt('# Titre\n\nTexte', 7, '![[a.png]]', true), { text: '# Titre\n\n![[a.png]]\n\nTexte', at: 9 });
  // Into a sentence further down, then back up as its own paragraph.
  const down = Markdown.moveSpan(text, start, end, text.indexOf('le texte'), false);
  assert.deepEqual(down, { text: 'Avant.\n\nAprès ![[a.png|300]] le texte.\n', at: 14 });
  const up = Markdown.moveSpan(down.text, 14, 28, 0, true);
  assert.equal(up.text, '![[a.png|300]]\n\nAvant.\n\nAprès le texte.\n');
});
