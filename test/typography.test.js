'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Type = require('../shared/typography');
const Markdown = require('../shared/markdown');
test('typography survives Markdown rendering and accepts only constrained values', () => {
  const value = Type.encode({ font: 'EB Garamond', size: 28, weight: 700, color: '#112233', highlight: '#facc15', italic: 1, align: 'center' });
  const html = Markdown.render(`<span data-opale="${value}">Du **texte** éà</span>`);
  assert.match(html, /font-family:&#39;EB Garamond&#39;/);
  assert.match(html, /font-size:28px/);
  assert.match(html, /<strong>texte<\/strong>/);
  assert.match(html, /text-align:center/);
  const hostile = Type.parse('font=evil\');background:url(https://evil);size=9999;weight=1000;color=red;align=fixed;highlight=#12;spacing=Infinity');
  assert.deepEqual(hostile, {});
  const unsafe = Markdown.render('<span data-opale="size=24" onclick="alert(1)">Bonjour</span>');
  assert.ok(!unsafe.includes('<span data-opale='));
  assert.ok(!Markdown.render('<span style="background:url(https://evil)">Texte</span>').includes('<span style='));
});
test('the note title style is kept in frontmatter and stays out of the properties panel', () => {
  const html = Markdown.render('---\nopale-titre: font=Lora;weight=400\nprojet: Typographie\n---\n\nTexte');
  assert.ok(!html.includes('opale-titre'));
  assert.match(html, /projet/);
  assert.match(html, />Texte</);
  const only = Markdown.render('---\nopale-titre: font=Lora\n---\n\nTexte');
  assert.ok(!only.includes('properties'));
  assert.ok(!only.includes('opale-titre'));
});
test('104 locally bundled families have font files, original licenses and portable CSS', () => {
  const root = path.resolve(__dirname, '../interface/assets/fonts');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json')));
  assert.equal(catalog.length, 104);
  assert.equal(new Set(catalog.map(f => f.name)).size, 104);
  for (const font of catalog) {
    assert.ok(fs.statSync(path.join(root, font.id, 'LICENSE.txt')).size > 500);
    for (const face of font.faces) {
      assert.ok(!face.file.includes('..') && !path.isAbsolute(face.file));
      assert.ok(fs.statSync(path.join(root, face.file)).size > 1000);
    }
  }
  const css = fs.readFileSync(path.join(root, 'fonts.css'), 'utf8');
  assert.ok(!/https?:|[A-Z]:\\/.test(css));
});
