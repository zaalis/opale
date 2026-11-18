import { app, h, Markdown, reportError, toast, closeMenu } from './core.js';
import { store } from './store.js';
import { findEmbeds } from './links.js';
import { uploadFile } from './editing.js';
import { decorate } from './renderer.js';

const Type = window.OpaleTypography;
let catalogPromise, loadedCatalog = [];
export function fontCatalog() {
  return catalogPromise ||= fetch('/assets/fonts/catalog.json').then(r => { if (!r.ok) throw Error('Catalogue de polices indisponible.'); return r.json(); }).then(fonts => (loadedCatalog = fonts));
}
function localFamily(value) {
  const name = value.replace(/^[A-Z]{6}\+/, '').replace(/["']/g, '').trim();
  const compact = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const exact = loadedCatalog.find(f => f.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact.name;
  const match = [...loadedCatalog].sort((a,b) => b.name.length - a.name.length).find(f => compact.startsWith(f.name.replace(/[^a-z0-9]/gi, '').toLowerCase()));
  if (match) return match.name;
  if (/arial|helvetica/.test(compact)) return 'Roboto';
  if (/timesnewroman|timesroman/.test(compact)) return 'Libre Baskerville';
  if (/courier/.test(compact)) return 'Roboto Mono';
  if (/calibri|carlito/.test(compact)) return 'Lato';
  if (/segoeui/.test(compact)) return 'Open Sans';
  return name;
}
const escapeText = text => text.replace(/\\/g, '\\\\').replace(/([`*_{}\[\]<>#~=$])/g, '\\$1').replace(/\u200b/g, '');
function clipboardSize(node, value, depth=0) {
  if (depth>20) return 16;
  const named={'xx-small':9,'x-small':10,small:13,medium:16,large:18,'x-large':24,'xx-large':32,'xxx-large':48};
  if (named[value]) return named[value];
  const m=/^([\d.]+)(px|pt|em|rem|%)$/.exec(value||'');
  if (!m) return null;
  const amount=Number(m[1]);
  if (m[2]==='px') return amount;
  if (m[2]==='pt') return amount*96/72;
  if (m[2]==='rem') return amount*16;
  let parent=node.parentElement;
  while(parent&&!parent.style?.fontSize)parent=parent.parentElement;
  const base=parent?clipboardSize(parent,parent.style.fontSize,depth+1)||16:16;
  return amount*base/(m[2]==='%'?100:1);
}
function styleOf(node) {
  const style = {}, css = node.style;
  if (!css) return style;
  if (css.fontFamily) {
    const family = css.fontFamily.split(',')[0]; style.font = localFamily(family);
    if (/[- ](?:bold|black|heavy)\b/i.test(family)) style.weight = 700;
    if (/[- ](?:italic|oblique)\b/i.test(family)) style.italic = 1;
  }
  const size=clipboardSize(node,css.fontSize);
  if (size!==null) style.size=Math.round(size*100)/100;
  if (node.nodeName === 'FONT' && !css.fontFamily && node.getAttribute('face')) style.font = localFamily(node.getAttribute('face').split(',')[0]);
  if (node.nodeName==='FONT' && size===null && /^[1-7]$/.test(node.getAttribute('size')||'')) style.size=[10,13,16,18,24,32,48][Number(node.getAttribute('size'))-1];
  if (css.fontWeight) style.weight = css.fontWeight === 'bold' ? 700 : css.fontWeight === 'normal' ? 400 : Number(css.fontWeight);
  const hex = value => { if (/^#[0-9a-f]{6}$/i.test(value)) return value; const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value); return m ? '#' + m.slice(1).map(v => Number(v).toString(16).padStart(2, '0')).join('') : ''; };
  if (hex(css.color)) style.color = hex(css.color);
  if (hex(css.backgroundColor)) style.highlight = hex(css.backgroundColor);
  if (css.fontStyle) style.italic = /^(italic|oblique)/.test(css.fontStyle) ? 1 : 0;
  if (css.textDecoration === 'none') { style.underline = 0; style.strike = 0; }
  if (css.textDecoration.includes('underline')) style.underline = 1;
  if (css.textDecoration.includes('line-through')) style.strike = 1;
  if (css.letterSpacing) style.spacing = parseFloat(css.letterSpacing);
  if (css.lineHeight && !/px|%|em/.test(css.lineHeight)) style.leading = parseFloat(css.lineHeight);
  if (css.textAlign) style.align = css.textAlign;
  return Type.parse(Type.encode(style));
}
function styled(text, style) {
  const value = Type.encode(style);
  return value && text ? `<span data-opale="${value}">${text}</span>` : text;
}

// Only this serializer produces persisted markup. Pasted HTML is never inserted
// into the application DOM; it is parsed in an inert document, reduced to this
// small vocabulary, and rendered through the same safe Markdown parser.
export function htmlToMarkdown(root, preserved = new WeakMap()) {
  function walk(node, listDepth = 0) {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'META', 'LINK', 'TEMPLATE'].includes(node.nodeName)) return '';
    const original = preserved.get(node);
    if (original?.inline) return original.source;
    if (original && (original.locked || node.outerHTML === original.html)) return original.source + '\n\n';
    const children = () => [...node.childNodes].map(n => walk(n, listDepth)).join('');
    const tag = node.nodeName;
    if (tag === 'BR') return '\n';
    if (tag === 'HR') return '\n\n---\n\n';
    if (tag === 'IMG') {
      const path = node.dataset.path;
      const target = path?.startsWith('@shared/') ? path.split('/').slice(2).join('/') : path;
      const width = /^\d{1,4}$/.test(node.getAttribute('width') || '') ? '|' + node.getAttribute('width') : '';
      return target ? `![[${target}${width}]]` : (node.alt ? escapeText(node.alt) : '');
    }
    if (tag === 'UL' || tag === 'OL') {
      const items = [...node.children].filter(n => n.nodeName === 'LI').map((li, i) => {
        const body = (li.classList.contains('task-list-item') ? `[${li.querySelector('input[type=checkbox]')?.checked ? 'x' : ' '}] ` : '') + [...li.childNodes].map(n => walk(n, listDepth + 1)).join('').trim();
        const lines = body.split('\n');
        return `${tag === 'OL' ? `${i + 1}.` : '-'} ${lines[0]}${lines.slice(1).map(l => '\n  ' + l).join('')}`;
      }).join('\n');
      return '\n\n' + items + '\n\n';
    }
    let text = children();
    if (tag === 'A') {
      if (node.dataset.tag) return '#' + node.dataset.tag;
      if (node.dataset.href !== undefined && !/^https?:/i.test(node.dataset.href)) return `[[${node.dataset.href}|${text}]]`;
      const href = node.getAttribute('href') || '';
      return /^(https?:|mailto:|tel:)/i.test(href) && !/[\s<>]/.test(href) ? `[${text}](${href.replace(/[()]/g, c => encodeURIComponent(c))})` : text;
    }
    if (tag === 'B' || tag === 'STRONG') text = text.trim() ? `**${text}**` : text;
    if (tag === 'I' || tag === 'EM') text = text.trim() ? `*${text}*` : text;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') text = text.trim() ? `~~${text}~~` : text;
    if (tag === 'MARK') text = text.trim() ? `==${text}==` : text;
    if (tag === 'U') text = `<u>${text}</u>`;
    if (tag === 'CODE') return '`' + node.textContent.replace(/`/g, '') + '`';
    if (tag === 'PRE') return '\n\n```\n' + node.textContent + '\n```\n\n';
    if (tag === 'BLOCKQUOTE') return '\n\n' + text.trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
    if (/^H[1-6]$/.test(tag)) return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + styled(text.trim(), styleOf(node)) + '\n\n';
    if (['P', 'DIV'].includes(tag) && !node.textContent.replace(/\u200b/g, '').trim() && !node.querySelector('img,audio,video,.embed,[contenteditable=false]') && root.childNodes.length > 1) {
      const emptyStyle=styleOf(node);for(const child of node.querySelectorAll('[style]'))Object.assign(emptyStyle,styleOf(child));
      return '\n\n'+styled('<br>',emptyStyle)+'\n\n';
    }
    text = styled(text, styleOf(node));
    return ['P', 'DIV', 'SECTION', 'ARTICLE'].includes(tag) ? '\n\n' + text.trim() + '\n\n' : text;
  }
  return [...root.childNodes].map(node => walk(node)).join('').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export class RichNote {
  constructor(view) {
    this.view = view; this.preserved = new WeakMap();
    this.el = h('div.markdown.rich-note', { contentEditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Texte enrichi de la note', spellcheck: !!app.settings.spellcheck });
    const lines = view.content.split('\n');
    const blocks = Markdown.liveBlocks(view.content);
    const context = store.renderContext(view.path);
    for (const block of blocks) {
      const source = lines.slice(block.start, block.end + 1).join('\n');
      const container = h('div', { html: Markdown.renderToken(block.token, context) });
      // A title style is the only frontmatter entry: keep its source, show nothing.
      if (block.token.type === 'frontmatter' && !container.innerHTML.trim()) {
        const wrapper = h('div', { contentEditable: 'false', hidden: true });
        this.preserved.set(wrapper, { source, html: '', locked: true });
        this.el.append(wrapper);
        continue;
      }
      for (const del of container.querySelectorAll('del')) { const strike = document.createElement('strike'); strike.append(...del.childNodes); del.replaceWith(strike); }
      const protectedBlock = !['paragraph', 'heading', 'list', 'blockquote'].includes(block.token.type) || !!container.querySelector('.math,.footnote-ref,.callout');
      let nodes = [...container.children];
      if (nodes.length !== 1 || protectedBlock) {
        const wrapper = h('div.rich-preserved', { contentEditable: 'false', title: 'Bloc conservé — modifiable en mode source' });
        wrapper.append(...container.childNodes); nodes = [wrapper];
      }
      for (const node of nodes) {
        const embeds = findEmbeds(source);
        const media = [...node.querySelectorAll('img.embed-image,.embed')].filter(n => !n.parentElement.closest('.embed'));
        media.forEach((n, i) => { if (embeds[i]) { this.preserved.set(n, { source: embeds[i].raw, inline: true }); n.contentEditable = 'false'; } });
        this.preserved.set(node, { source, html: node.outerHTML, locked: protectedBlock });
        this.el.append(node);
      }
    }
    if (!this.el.childNodes.length) this.el.append(h('p', h('br')));
    // Chromium cannot keep a select-all range whose first/last child is
    // non-editable. Editable zero-width boundaries keep protected blocks
    // selectable and deletable together with the rest of the document.
    if (this.el.firstElementChild?.contentEditable === 'false') this.el.prepend(document.createTextNode('\u200b'));
    if (this.el.lastElementChild?.contentEditable === 'false') this.el.append(document.createTextNode('\u200b'));
    decorate(this.el);
    this.el.addEventListener('input', () => { if(!this.inCommand)this.changed(); });
    this.el.addEventListener('beforeinput', e => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); this.view.travel(e.inputType === 'historyUndo' ? -1 : 1); }
    });
    this.el.addEventListener('keydown', e => {
      if (e.isComposing) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'a') { e.preventDefault(); const r = document.createRange(); r.selectNodeContents(this.el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
        else if (key === 'z' || key === 'y') { e.preventDefault(); e.stopPropagation(); this.view.travel(key === 'y' || e.shiftKey ? 1 : -1); }
        else if (e.shiftKey && key === 'x') { e.preventDefault(); this.command('strikeThrough'); }
        else if (e.shiftKey && key === 'h') { e.preventDefault(); this.apply({ highlight: '#facc15' }); }
        else if (['b', 'i', 'u'].includes(key)) { e.preventDefault(); this.command({ b: 'bold', i: 'italic', u: 'underline' }[key]); }
      }
    });
    this.el.addEventListener('paste', e => this.paste(e));
    this.el.addEventListener('drop', e => {
      // Browser HTML drops must pass through the same inert conversion.
      if (e.dataTransfer?.getData('text/html')) { e.preventDefault(); this.insertHTML(e.dataTransfer.getData('text/html')); }
    });
    for (const name of ['keyup', 'pointerup', 'input']) this.el.addEventListener(name, () => { this.remember(); view.typebar?.update(); });
  }
  changed(options = {}) { this.view.setContent(htmlToMarkdown(this.el, this.preserved), { step: !!(options.step || this.actionStep) }); this.remember(); }
  remember() { const s = getSelection(); if (s.rangeCount && this.el.contains(s.anchorNode) && this.el.contains(s.focusNode)) this.bookmark = s.getRangeAt(0).cloneRange(); }
  restore() {
    this.el.focus({ preventScroll: true });
    const s = getSelection();
    if (this.bookmark && this.el.contains(this.bookmark.commonAncestorContainer)) { s.removeAllRanges(); s.addRange(this.bookmark); }
    if (!s.rangeCount || !this.el.contains(s.anchorNode)) { const r = document.createRange(); r.selectNodeContents(this.el); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
    return s.getRangeAt(0);
  }
  offsets(range = null) {
    const s = getSelection(); if (!range && (!s.rangeCount || !this.el.contains(s.anchorNode) || !this.el.contains(s.focusNode))) return null;
    const r = range || s.getRangeAt(0), prefix = document.createRange(); prefix.selectNodeContents(this.el); prefix.setEnd(r.startContainer, r.startOffset);
    const start = prefix.toString().length; return { start, end: start + r.toString().length };
  }
  rangeAt(start, end = start) {
    const length=this.el.textContent.length;start=Math.max(0,Math.min(length,Number(start)||0));end=Math.max(start,Math.min(length,Number(end)||0));
    const walker = document.createTreeWalker(this.el, NodeFilter.SHOW_TEXT); let node, offset = 0, a, b;
    while ((node = walker.nextNode())) {
      if (!a && start < offset + node.length) a = [node, Math.max(0, start - offset)];
      if (a && end <= offset + node.length) { b = [node, Math.max(0, end - offset)]; break; }
      offset += node.length;
    }
    const range = document.createRange();
    if (a && b) { range.setStart(...a); range.setEnd(...b); } else { range.selectNodeContents(this.el); range.collapse(false); }
    return range;
  }
  selectOffsets(start, end = start) { const s = getSelection(); s.removeAllRanges(); s.addRange(this.rangeAt(start, end)); this.remember(); }
  command(command, value = null) {
    const range=this.restore(),before=this.el.innerHTML; this.actionStep = true; this.inCommand=true;
    let inserted;
    if(command==='insertHTML'){
      const doc=new DOMParser().parseFromString(value,'text/html');
      for(const span of doc.querySelectorAll('span[data-opale]'))span.setAttribute('data-opale-insert','1');
      inserted=doc.body.innerHTML;
    }
    try {
      const all=command==='insertHTML'&&(range.toString()===this.el.textContent)&&(!range.collapsed||!this.el.textContent);
      if(all){this.el.innerHTML=inserted;const r=document.createRange();r.selectNodeContents(this.el);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);}
      else document.execCommand(command, false, inserted??value);
      if(command==='insertHTML')for(const span of this.el.querySelectorAll('[data-opale-insert]')){span.style.cssText=Type.css(span.getAttribute('data-opale'));span.removeAttribute('data-opale-insert');}
      if(this.el.innerHTML!==before)this.changed({ step: true });else this.remember();
    }
    finally { this.actionStep = false; this.inCommand=false; }
    this.view.typebar?.update();
  }
  apply(style) {
    const range = this.restore();
    const offsets = this.offsets();let mutated=false;
    if (range.collapsed) {
      const span = h('span', { 'data-opale': Type.encode(style), style: Type.css(style) }, '\u200b');
      range.insertNode(span);mutated=true; range.selectNodeContents(span); range.collapse(false);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    } else {
      const nodes = [], walker = document.createTreeWalker(this.el, NodeFilter.SHOW_TEXT); let node;
      while ((node = walker.nextNode())) if (range.intersectsNode(node) && !node.parentElement.closest('[contenteditable="false"]')) nodes.push(node);
      for (const text of nodes.reverse()) {
        const from = text === range.startContainer ? range.startOffset : 0;
        const to = text === range.endContainer ? range.endOffset : text.length;
        if (from === to) continue;
        const part = document.createRange(); part.setStart(text, from); part.setEnd(text, to);
        const merged = {};
        const ancestors = []; for (let n = text.parentElement; n && n !== this.el; n = n.parentElement) ancestors.unshift(n);
        for (const n of ancestors) Object.assign(merged, styleOf(n));
        if (Object.entries(style).every(([key,value]) => String(merged[key]) === String(value))) continue;
        Object.assign(merged, style);
        const span = h('span', { 'data-opale': Type.encode(merged), style: Type.css(merged) });
        span.append(part.extractContents()); part.insertNode(span);mutated=true;
      }
    }
    if (offsets && offsets.start !== offsets.end) this.selectOffsets(offsets.start, offsets.end);
    if(mutated)this.changed({ step: true });else this.remember(); this.view.typebar?.update();
  }
  paragraph(style) {
    const r = this.restore();
    for (const p of this.el.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote')) if (r.intersectsNode(p)) {
      for (const child of p.querySelectorAll('[data-opale]')) {
        const prior = styleOf(child); for (const key of Object.keys(style)) delete prior[key];
        child.dataset.opale = Type.encode(prior); child.setAttribute('style', Type.css(prior));
      }
      const merged = { ...styleOf(p), ...style }; p.dataset.opale = Type.encode(merged); p.setAttribute('style', Type.css(merged));
    }
    this.changed({ step: true });
  }
  insertHTML(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const md = htmlToMarkdown(doc.body);
    this.command('insertHTML', Markdown.render(md, store.renderContext(this.view.path)));
  }
  paste(e) {
    if (e.clipboardData?.files.length) {
      e.preventDefault(); this.remember();
      const files = [...e.clipboardData.files], bookmark = this.bookmark?.cloneRange();
      (async () => {
        const paths = [];
        for (const file of files) paths.push(await uploadFile(file, this.view.path));
        if (this.view.rich !== this || this.view.project?.readOnly) return;
        if (bookmark) this.bookmark = bookmark;
        await this.view.insertAttachments(paths, { files });
      })().catch(reportError);
      return;
    }
    e.preventDefault(); const html = e.clipboardData?.getData('text/html');
    const formatted=html&&/<(?:p|div|span|b|strong|i|em|font|h[1-6]|u|s|strike|mark|ul|ol|li|br|table)\b/i.test(html);
    if (formatted) this.insertHTML(html);
    else {
      const text = e.clipboardData?.getData('text/plain') || '';
      const html = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => `<p>${Markdown.escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
      this.command('insertHTML', html);
      if(e.clipboardData?.getData('text/html')&&text.length>300&&/[\r\n]/.test(text))toast('Texte collé avec la police de la note : le presse-papiers ne fournit pas sa mise en forme.');
    }
  }
}

// Heading weight comes from the stylesheet. It is not a bold mark, so the
// toolbar must not stay pressed on every title in the page.
function markedBold(element, root) {
  for (let node = element; node && node !== root; node = node.parentElement) {
    if (node.tagName === 'B' || node.tagName === 'STRONG') return true;
    const inline = node.style?.fontWeight;
    if (inline) {
      const weight = inline === 'bold' ? 700 : inline === 'normal' ? 400 : Number(inline);
      if (Number.isFinite(weight)) return weight >= 600;
    }
    if (/^H[1-6]$/.test(node.tagName)) return false;
  }
  return false;
}
function textSamples(rich, range) {
  const result = [], walker = document.createTreeWalker(rich.el, NodeFilter.SHOW_TEXT); let text;
  while ((text = walker.nextNode())) {
    if (!text.data.replace(/\u200b/g, '').length || text.parentElement.closest('[contenteditable="false"]')) continue;
    const start = text === range.startContainer ? range.startOffset : 0;
    const end = text === range.endContainer ? range.endOffset : text.length;
    if (!range.collapsed && (!range.intersectsNode(text) || end <= start)) continue;
    if (range.collapsed && !(text === range.startContainer || (range.startContainer.nodeType === Node.ELEMENT_NODE && (range.startContainer.childNodes[range.startOffset]?.contains(text) || range.startContainer === text.parentNode)))) continue;
    const element = text.parentElement, css = getComputedStyle(element);
    const decorations = new Set(); let background = '';
    for (let n=element; n && n!==rich.el.parentElement; n=n.parentElement) {
      const s=getComputedStyle(n); for (const d of s.textDecorationLine.split(' ')) decorations.add(d);
      if (!background && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') background=s.backgroundColor;
    }
    result.push({block:element.closest('h1,h2,h3,h4,h5,h6')?.nodeName.toLowerCase()||(element.closest('blockquote')?'blockquote':'p'),font:css.fontFamily.split(',')[0].replace(/["']/g,'').trim(),size:Math.round(parseFloat(css.fontSize)*100)/100,weight:css.fontWeight,bold:markedBold(element, rich.el),italic:css.fontStyle==='italic',underline:decorations.has('underline'),strike:decorations.has('line-through'),color:css.color,highlight:background,align:css.textAlign==='start'?(css.direction==='rtl'?'right':'left'):css.textAlign==='end'?(css.direction==='rtl'?'left':'right'):css.textAlign,leading:parseFloat(css.lineHeight)/parseFloat(css.fontSize),spacing:parseFloat(css.letterSpacing)||0});
    if (range.collapsed || result.length >= 4096) break;
  }
  if (!result.length) {
    let n=range.startContainer.nodeType===Node.ELEMENT_NODE?range.startContainer:range.startContainer.parentElement;
    if(range.collapsed&&!n.textContent.replace(/\u200b/g,'').trim())while(n.firstElementChild&&n.firstElementChild.nodeName!=='BR')n=n.firstElementChild;
    const css=getComputedStyle(n===rich.el?rich.el:n);
    result.push({block:n.closest('h1,h2,h3,h4,h5,h6')?.nodeName.toLowerCase()||(n.closest('blockquote')?'blockquote':'p'),font:css.fontFamily.split(',')[0].replace(/["']/g,'').trim(),size:parseFloat(css.fontSize),weight:css.fontWeight,bold:markedBold(n, rich.el),italic:css.fontStyle==='italic',underline:css.textDecorationLine.includes('underline'),strike:css.textDecorationLine.includes('line-through'),color:css.color,highlight:'',align:css.textAlign==='start'?(css.direction==='rtl'?'right':'left'):css.textAlign==='end'?(css.direction==='rtl'?'left':'right'):css.textAlign,leading:parseFloat(css.lineHeight)/parseFloat(css.fontSize),spacing:0});
  }
  const state={};
  for (const key of Object.keys(result[0])) state[key]=result.every(s=>s[key]===result[0][key])?result[0][key]:null;
  return state;
}
function colorHex(value, fallback) {
  if (/^#[0-9a-f]{6}$/i.test(value||'')) return value;
  const rgb=/^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value||'');
  return rgb?'#'+rgb.slice(1).map(v=>Number(v).toString(16).padStart(2,'0')).join(''):fallback;
}

function titleSample(view) {
  const css = getComputedStyle(view.titleEl);
  const explicit = Type.parse(view.titleStyleValue || '');
  const weight = explicit.weight || Number(css.fontWeight) || 400;
  const decorations = new Set((css.textDecorationLine || '').split(' '));
  const align = explicit.align || (css.textAlign === 'start' ? 'left' : css.textAlign === 'end' ? 'right' : css.textAlign);
  return {
    block: '',
    font: explicit.font || css.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
    size: explicit.size || Math.round(parseFloat(css.fontSize) * 100) / 100,
    weight: String(weight),
    bold: weight >= 600,
    italic: explicit.italic !== undefined ? !!explicit.italic : css.fontStyle === 'italic',
    underline: explicit.underline !== undefined ? !!explicit.underline : decorations.has('underline'),
    strike: explicit.strike !== undefined ? !!explicit.strike : decorations.has('line-through'),
    color: explicit.color || css.color,
    highlight: explicit.highlight || '',
    align,
    leading: explicit.leading || (parseFloat(css.lineHeight) / parseFloat(css.fontSize)),
    spacing: explicit.spacing !== undefined ? explicit.spacing : (parseFloat(css.letterSpacing) || 0),
  };
}

export class TypographyBar {
  constructor(view) {
    this.view=view;
    this.el=h('div.note-typebar',{role:'group','aria-label':'Mise en forme du texte'});
    this.pendingTarget=null;
    this.holdTarget=null;
    this.el.addEventListener('pointerdown',()=>{this.rememberTarget();view.rich?.remember();},true);
    this.onArm=(event)=>{if(!this.el.contains(event.target)&&!this.popover?.contains(event.target)&&!view.titleEl?.contains(event.target))this.holdTarget=null;};
    document.addEventListener('pointerdown',this.onArm,true);
    this.el.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.altKey&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();view.travel(e.key.toLowerCase()==='y'||e.shiftKey?1:-1);this.updateSoon();}});
    const button=(label,text,run)=>{
      const b=h('button.type-button',{type:'button',title:label,'aria-label':label,onClick:()=>this.run(run)},text);
      b.addEventListener('pointerdown',e=>{view.rich?.remember();e.preventDefault();});this.el.append(b);return b;
    };
    this.toggle=button('Édition enrichie','Aa',()=>{});
    this.toggle.onclick=()=>{if(view.mode!=='rich'){this.activateRich();view.rich?.el.focus();}};
    const field=(label,element)=>{element.setAttribute('aria-label',label);element.title=label;this.el.append(h('label.type-field',h('span.sr-only',label),element));return element;};
    this.font=field('Police d’écriture',h('select.type-font',h('option',{value:''},'Police…')));
    this.font.onchange=()=>{const font=this.font.value;if(font)this.run(r=>r.apply({font}));};
    fontCatalog().then(list=>{
      for(const category of [...new Set(list.map(f=>f.category))]){
        const group=h('optgroup',{label:category});
        for(const f of list.filter(f=>f.category===category))group.append(h('option',{value:f.name,style:`font-family:'${f.name}'`},f.name));
        this.font.append(group);
      }
      this.font.dataset.catalogCount=String(list.length);this.update();
    }).catch(reportError);
    this.size=field('Taille de police en pixels',h('input',{type:'number',min:8,max:144,step:1,value:16}));
    const resize=()=>{const size=Number(this.size.value);if(size>=8&&size<=144)this.run(r=>r.apply({size}));};
    this.size.oninput=resize;
    this.weight=field('Épaisseur de police',h('select.type-weight',h('option',{value:''},'—'),...[100,200,300,400,500,600,700,800,900].map(w=>h('option',{value:w,selected:w===400},String(w)))));
    this.weight.onchange=()=>{const weight=Number(this.weight.value);if(weight)this.run(r=>r.apply({weight}));};
    const sep=()=>this.el.append(h('span.type-sep',{'aria-hidden':'true'}));
    const icon=(label,markup,run)=>{const b=button(label,'',run);b.classList.add('type-icon');b.innerHTML=markup;return b;};
    const bars=(widths)=>`<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="${widths}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    sep();
    this.bold=icon('Gras (Ctrl+B)','<b>B</b>',r=>r.command('bold'));
    this.italic=icon('Italique (Ctrl+I)','<i>I</i>',r=>r.command('italic'));
    this.underline=icon('Souligner (Ctrl+U)','<u>U</u>',r=>r.command('underline'));
    this.strike=icon('Barrer','<s>S</s>',r=>r.command('strikeThrough'));
    this.color=this.colorButton('Couleur du texte','color','#333333');
    this.highlight=this.colorButton('Couleur du surlignage','highlight','#facc15');
    this.mark=icon('Surligner','▰',r=>r.apply({highlight:this.highlight.value}));
    sep();
    this.block=field('Style de paragraphe',h('select.type-block',h('option',{value:''},'Mixte'),...[['p','Paragraphe'],['h1','Titre 1'],['h2','Titre 2'],['h3','Titre 3'],['blockquote','Citation']].map(([v,t])=>h('option',{value:v},t))));
    this.block.onchange=()=>{const value=this.block.value;this.run(r=>r.command('formatBlock',value));};
    sep();
    this.aligns={};
    for(const [value,label,path] of [['left','Aligner à gauche','M2 3h12M2 7h8M2 11h10'],['center','Centrer','M2 3h12M4 7h8M3 11h10'],['right','Aligner à droite','M2 3h12M6 7h8M4 11h10'],['justify','Justifier','M2 3h12M2 7h12M2 11h12']]){
      this.aligns[value]=icon(label,bars(path),r=>r.paragraph({align:value}));
    }
    this.leading=field('Interligne',h('select.type-leading',h('option',{value:''},'Mixte'),...[1,1.25,1.5,1.62,1.75,2,2.5,3].map(v=>h('option',{value:v,selected:v===1.62},String(v)))));
    this.leading.onchange=()=>{const leading=Number(this.leading.value);if(leading)this.run(r=>r.paragraph({leading}));};
    this.spacing=field('Espacement des lettres en pixels',h('input',{type:'number',min:-2,max:20,step:0.5,value:0}));
    this.spacing.onchange=()=>{const spacing=Number(this.spacing.value);this.run(r=>r.apply({spacing}));};
    sep();
    icon('Liste à puces','•',r=>r.command('insertUnorderedList'));
    icon('Liste numérotée','1.',r=>r.command('insertOrderedList'));
    icon('Effacer le style','T×',r=>{r.command('removeFormat');const range=r.restore();for(const span of [...r.el.querySelectorAll('span[data-opale]')])if(range.intersectsNode(span)&&range.comparePoint(span,0)===0&&range.comparePoint(span,span.childNodes.length)===0)span.replaceWith(...span.childNodes);r.changed({step:true});});
    this.onSelection=()=>{
      if(app.workspace.activeView!==view){this.closeColor();return;}
      if(this.ownsControl(document.activeElement))return;
      // A click outside leaves the old range in place but takes focus away.
      // The buttons follow the focused text, so they release once it is gone.
      if(view.titleEl?.contains(document.activeElement)){this.pendingTarget=this.holdTarget='title';this.updateSoon();return;}
      if(view.rich&&view.mode==='rich'&&view.rich.el.contains(document.activeElement)&&this.selectionInside(view.rich.el)){view.rich.remember();this.pendingTarget=this.holdTarget='body';this.updateSoon();return;}
      if(this.holdTarget){this.pendingTarget=this.holdTarget;return;}
      this.pendingTarget=null;this.clearPressed();
    };
    document.addEventListener('selectionchange',this.onSelection);
    this.onFocus=()=>this.onSelection();
    document.addEventListener('focusin',this.onFocus);
    this.onOutside=e=>{if(this.popover&&!this.popover.contains(e.target)&&!this.colorAnchor?.contains(e.target))this.closeColor();};
    document.addEventListener('pointerdown',this.onOutside,true);
    this.onEscape=e=>{if(this.popover&&e.key==='Escape'){e.preventDefault();e.stopPropagation();const anchor=this.colorAnchor;this.closeColor();anchor?.focus();}};
    document.addEventListener('keydown',this.onEscape,true);
    this.onResize=()=>this.closeColor();window.addEventListener('resize',this.onResize);
  }
  ownsControl(node){return !!node&&(this.el.contains(node)||this.popover?.contains(node));}
  updateSoon(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=null;this.update();});}
  activateRich(){
    const v=this.view,area=v.activeTextarea?.();let selected='';
    if(area)selected=Markdown.plainText(area.value.slice(area.selectionStart,area.selectionEnd));
    if(v.mode!=='rich')v.setMode('rich');
    if(selected&&v.rich){const at=v.rich.el.textContent.indexOf(selected);if(at>=0)v.rich.selectOffsets(at,at+selected.length);}
  }
  selectionInside(node){if(!node)return false;const s=getSelection();return !!(s.rangeCount&&node.contains(s.anchorNode)&&node.contains(s.focusNode));}
  rememberTarget(){const active=document.activeElement;if(active===this.view.titleEl||this.selectionInside(this.view.titleEl))this.pendingTarget='title';else if(this.view.rich&&(active===this.view.rich.el||this.selectionInside(this.view.rich.el)))this.pendingTarget='body';else if(this.ownsControl(active)&&this.holdTarget)this.pendingTarget=this.holdTarget;else if(!this.ownsControl(active))this.pendingTarget=null;if(this.pendingTarget)this.holdTarget=this.pendingTarget;}
  titleContext(){if(this.view.titleEl?.contains(document.activeElement)){this.pendingTarget='title';return true;}return this.pendingTarget==='title'&&(this.ownsControl(document.activeElement)||!!this.editingControl);}
  titleApi(){
    const view=this.view;
    return {el:view.titleEl,apply:style=>view.styleTitle(style),paragraph:style=>view.styleTitle(style),command:name=>view.commandTitle(name),changed(){},remember(){},restore:()=>{const range=document.createRange();range.selectNodeContents(view.titleEl);const s=getSelection();s.removeAllRanges();s.addRange(range);return range;}};
  }
  clearPressed(){for(const button of [this.bold,this.italic,this.underline,this.strike,this.mark])button?.setAttribute('aria-pressed','false');}
  run(fn){
    const v=this.view;if(v.project?.readOnly||this.running)return;
    const title=this.pendingTarget==='title'||this.selectionInside(v.titleEl);
    if(title&&v.mode==='reading')return;
    this.running=true;
    if(title)this.pendingTarget='title';
    if(!title&&v.mode!=='rich')this.activateRich();
    if(!title&&!v.rich){this.running=false;return;}
    const active=document.activeElement,control=this.ownsControl(active)&&/^(INPUT|SELECT)$/.test(active.tagName)?active:null;
    const selection=control&&typeof control.selectionStart==='number'?[control.selectionStart,control.selectionEnd]:null;
    this.editingControl=control;
    try{return fn(title?this.titleApi():v.rich);}finally{
      if(title&&control?.tagName==='SELECT'){
        v.titleEl.focus({preventScroll:true});
        const range=document.createRange();range.selectNodeContents(v.titleEl);
        const selectionState=getSelection();selectionState.removeAllRanges();selectionState.addRange(range);
        this.pendingTarget=this.holdTarget='title';
      }else if(control?.isConnected){control.focus({preventScroll:true});if(selection)try{control.setSelectionRange(...selection);}catch{}}
      this.editingControl=null;this.running=false;this.update();
    }
  }
  colorButton(label,key,value){
    const b=h('button.type-button.type-color-button',{type:'button',title:label,'aria-label':label,'aria-haspopup':'dialog','aria-expanded':'false',value,style:`--swatch:${value}`},h('span.type-color-chip',{'aria-hidden':'true'}));
    b.addEventListener('pointerdown',e=>{this.view.rich?.remember();e.preventDefault();});
    b.onclick=()=>this.toggleColor(b,key,label);this.el.append(b);return b;
  }
  closeColor(){this.popover?.remove();this.popover=null;this.colorAnchor?.setAttribute('aria-expanded','false');this.colorAnchor=null;}
  toggleColor(anchor,key,label){
    if(this.popover&&this.colorAnchor===anchor){this.closeColor();return;}
    this.closeColor();closeMenu();if(this.view.project?.readOnly)return;
    const title=this.pendingTarget==='title'||this.selectionInside(this.view.titleEl);
    if(!title&&this.view.mode!=='rich')this.activateRich();
    if(!title)this.view.rich?.remember();
    const panel=h('div.type-color-popover',{role:'dialog','aria-label':label});
    const close=h('button.type-button',{type:'button','aria-label':'Fermer la palette de couleurs',onClick:()=>this.closeColor()},'×');
    panel.append(h('div.type-color-header',h('strong',label),close));
    const apply=color=>{anchor.value=color;anchor.style.setProperty('--swatch',color);this.run(r=>r.apply({[key]:color}));};
    const grid=h('div.type-color-grid');
    for(const color of ['#111827','#ffffff','#6b7280','#ef4444','#f97316','#facc15','#22c55e','#14b8a6','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e','#7f1d1d','#854d0e','#14532d','#1e3a8a','#581c87']){
      const swatch=h('button.type-color-swatch',{type:'button','aria-label':`Appliquer ${color}`,style:`background:${color}`,onClick:()=>{apply(color);hex.value=color;}});
      swatch.addEventListener('pointerdown',e=>e.preventDefault());grid.append(swatch);
    }
    const hex=h('input.type-color-hex',{type:'text',value:anchor.value,maxLength:7,'aria-label':'Code couleur hexadécimal',spellcheck:false});
    const submit=h('button.type-button',{type:'button',onClick:()=>{if(/^#[0-9a-f]{6}$/i.test(hex.value)){hex.setCustomValidity('');apply(hex.value.toLowerCase());}else{hex.setCustomValidity('Saisissez une couleur comme #336699.');hex.reportValidity();}}},'Appliquer');
    hex.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submit.click();}});
    panel.append(grid,h('label.type-color-custom','Couleur personnalisée',h('div',hex,submit)));
    panel.addEventListener('pointerdown',()=>this.view.rich?.remember(),true);
    this.popover=panel;this.colorAnchor=anchor;anchor.setAttribute('aria-expanded','true');document.body.append(panel);
    const r=anchor.getBoundingClientRect();panel.style.left=`${Math.max(6,Math.min(r.left,innerWidth-panel.offsetWidth-6))}px`;panel.style.top=`${Math.min(r.bottom+6,innerHeight-panel.offsetHeight-6)}px`;
  }
  update(){
    const v=this.view;this.el.hidden=v.mode==='reading'||!!v.project?.readOnly;this.toggle.setAttribute('aria-pressed',String(v.mode==='rich'));
    if(v.mode==='reading'||v.project?.readOnly){this.closeColor();return;}
    if(this.titleContext()){this.paint(titleSample(v));return;}
    if(v.mode!=='rich'||!v.rich){this.closeColor();this.clearPressed();return;}
    const r=v.rich;let range;
    const live=r.el.contains(document.activeElement)&&!this.ownsControl(document.activeElement)&&this.selectionInside(r.el);
    const holding=this.ownsControl(document.activeElement)||!!this.editingControl;
    if(live){range=getSelection().getRangeAt(0);r.remember();this.pendingTarget='body';}
    else if(holding&&r.bookmark&&r.el.contains(r.bookmark.commonAncestorContainer))range=r.bookmark;
    else{this.clearPressed();return;}
    if(!range||!r.el.contains(range.commonAncestorContainer)){this.clearPressed();return;}
    this.paint(textSamples(r,range));
  }
  paint(state){
    this.state=state;
    const active=this.editingControl||document.activeElement;
    if(active!==this.font){if(state.font&&!Array.from(this.font.options).some(o=>o.value===state.font))this.font.append(h('option',{value:state.font},state.font));this.font.value=state.font||'';this.font.options[0].textContent=state.font===null?'Polices mixtes':'Police…';}
    if(active!==this.size){this.size.value=state.size===null?'':state.size;this.size.placeholder=state.size===null?'Mixte':'';}
    if(active!==this.weight)this.weight.value=state.weight||'';
    if(active!==this.block)this.block.value=state.block||'';
    for(const [value,button] of Object.entries(this.aligns||{}))button.setAttribute('aria-pressed',state.align===null?'mixed':String(state.align===value));
    if(active!==this.spacing){this.spacing.value=state.spacing===null?'':state.spacing;this.spacing.placeholder=state.spacing===null?'Mixte':'';}
    if(active!==this.leading)this.leading.value=state.leading===null?'':String(Math.round(state.leading*100)/100);
    for(const [button,key] of [[this.bold,'bold'],[this.italic,'italic'],[this.underline,'underline'],[this.strike,'strike']])button.setAttribute('aria-pressed',state[key]===null?'mixed':String(state[key]));
    this.mark.setAttribute('aria-pressed',state.highlight===null?'mixed':String(!!state.highlight));
    for(const [button,key,fallback] of [[this.color,'color','#333333'],[this.highlight,'highlight','#facc15']]){const value=colorHex(state[key],fallback);button.value=value;button.style.setProperty('--swatch',value);button.dataset.mixed=String(state[key]===null);}
  }
  destroy(){cancelAnimationFrame(this.frame);this.closeColor();document.removeEventListener('selectionchange',this.onSelection);document.removeEventListener('focusin',this.onFocus);document.removeEventListener('pointerdown',this.onArm,true);document.removeEventListener('pointerdown',this.onOutside,true);document.removeEventListener('keydown',this.onEscape,true);window.removeEventListener('resize',this.onResize);}
}
