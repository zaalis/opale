// Opale — what rendered Markdown does once it is in the page: links open
// notes, embeds load their content, tasks can be ticked, code can be copied,
// and hovering a link previews the note behind it.
import { app, h, icon, Markdown, Meta, toast } from './core.js';
import { store } from './store.js';

// The part of a note that "Note#Section" or "Note#^bloc" refers to.
export function sectionOf(text, subpath) {
  const split = Meta.splitFrontmatter(text);
  if (!subpath) return split.body;
  const lines = text.split('\n');
  if (subpath.startsWith('^')) {
    const id = subpath.slice(1).toLowerCase();
    const at = lines.findIndex((line) => new RegExp(`\\s\\^${id.replace(/[^a-z0-9-]/g, '')}\\s*$`, 'i').test(line));
    if (at < 0) return '';
    let from = at; let to = at;
    while (from > 0 && lines[from - 1].trim()) from--;
    while (to < lines.length - 1 && lines[to + 1].trim()) to++;
    return lines.slice(from, to + 1).join('\n');
  }
  const headings = Meta.extract(text).headings;
  const wanted = subpath.split('#').pop().trim().toLowerCase();
  const at = headings.findIndex((heading) => Markdown.plainText(heading.text).toLowerCase() === wanted || heading.text.toLowerCase() === wanted);
  if (at < 0) return '';
  const next = headings.slice(at + 1).find((heading) => heading.level <= headings[at].level);
  return lines.slice(headings[at].line, next ? next.line : lines.length).join('\n');
}

async function fillEmbed(element) {
  const path = element.dataset.embedPath; const subpath = element.dataset.embedSubpath || '';
  const depth = Number(element.dataset.embedDepth) || 1;
  element.dataset.embedState = 'loading';
  try {
    const text = await store.text(path);
    const section = sectionOf(text, subpath);
    const title = h('a.embed-title.internal-link', { dataset: { href: store.linkText(path), path, ...(subpath ? { subpath } : {}) } }, subpath ? `${Meta.stem(path)} › ${subpath}` : Meta.stem(path));
    const content = h('div.embed-content.markdown', { html: section.trim() ? Markdown.render(section, store.renderContext(path, { embedDepth: depth })) : '<p class="embed-empty">Section introuvable ou vide.</p>' });
    element.replaceChildren(title, content);
    element.dataset.embedState = 'ready';
    decorate(content, path);
  } catch {
    element.replaceChildren(h('span.embed-empty', `Impossible de charger « ${Meta.baseName(path)} ».`));
    element.dataset.embedState = 'error';
  }
}

// Asynchronous and structural finishing touches on freshly rendered HTML.
export function decorate(root) {
  for (const pre of root.querySelectorAll('pre.code-block:not([data-ready])')) {
    pre.dataset.ready = '1';
    // Appended after <code> so the tools never count as note text.
    pre.append(h('div.code-tools', { contentEditable: 'false' },
      pre.dataset.lang ? h('span.code-lang', pre.dataset.lang) : null,
      h('button.code-copy', { type: 'button', title: 'Copier le code', 'aria-label': 'Copier le code', html: icon('copy', 14) })));
  }
  for (const embed of root.querySelectorAll('.embed-note[data-embed-path]:not([data-embed-state])')) fillEmbed(embed);
  for (const image of root.querySelectorAll('img.embed-image:not([data-ready])')) {
    image.dataset.ready = '1';
    image.addEventListener('error', () => image.classList.add('is-broken'), { once: true });
  }
}

// ------------------------------------------------------------ hover preview
const preview = { el: null, timer: null, link: null };
function hidePreview() {
  clearTimeout(preview.timer); preview.timer = null; preview.link = null;
  if (preview.el) { preview.el.remove(); preview.el = null; }
}
async function showPreview(link) {
  const path = link.dataset.path;
  if (!path || Meta.kindOf(path) !== 'note' || !document.contains(link)) return;
  let text;
  try { text = await store.text(path); } catch { return; }
  if (preview.link !== link) return;
  const section = sectionOf(text, link.dataset.subpath || '');
  const content = h('div.markdown.hover-content', { html: Markdown.render(section.slice(0, 6000) || '*Note vide*', store.renderContext(path, { embedDepth: 2 })) });
  const el = h('div.hover-preview', { onMouseleave: hidePreview }, h('div.hover-title', Meta.stem(path)), content);
  if (preview.el) preview.el.remove();
  preview.el = el;
  document.body.append(el);
  bindNoteInteractions(el, { path, toggleTask() {} });
  decorate(content);
  const rect = link.getBoundingClientRect(); const box = el.getBoundingClientRect();
  const below = rect.bottom + 6;
  el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8))}px`;
  el.style.top = `${below + box.height > window.innerHeight - 8 ? Math.max(8, rect.top - box.height - 6) : below}px`;
}

// Delegated behaviour for a container that holds rendered note content.
// view: { path, toggleTask(line), followAnchor(subpath) }
export function bindNoteInteractions(container, view) {
  const sourceOf = (element) => { const embed = element.closest('[data-embed-path]'); return embed ? embed.dataset.embedPath : view.path; };

  const follow = (event, link) => {
    event.preventDefault();
    hidePreview();
    app.workspace.openLink({
      target: link.dataset.href || '', subpath: link.dataset.subpath || '', path: link.dataset.path || '',
      source: sourceOf(link), newTab: event.ctrlKey || event.metaKey || event.button === 1, view,
    });
  };

  container.addEventListener('click', (event) => {
    const copy = event.target.closest('.code-copy');
    if (copy) {
      const code = copy.closest('pre').querySelector('code');
      navigator.clipboard.writeText(code ? code.textContent : '').then(() => toast('Code copié'), () => toast('Copie impossible', { kind: 'error' }));
      return;
    }
    // A missing picture is not a note to create: offer to repair it instead.
    const missing = event.target.closest('.embed-missing');
    if (missing) {
      event.preventDefault();
      if (!missing.closest('[data-embed-path]') && view.repairLink) view.repairLink(missing);
      return;
    }
    const link = event.target.closest('a.internal-link');
    if (link) return follow(event, link);
    const tag = event.target.closest('a.tag');
    if (tag) { event.preventDefault(); app.panels.searchFor(`tag:#${tag.dataset.tag}`); return; }
    const footnote = event.target.closest('.footnote-ref');
    if (footnote) {
      const target = container.querySelector(`.footnotes li[data-footnote="${CSS.escape(footnote.dataset.footnote)}"]`);
      if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1400); }
      return;
    }
    const image = event.target.closest('img.embed-image[data-path]');
    if (image && (event.ctrlKey || event.metaKey)) app.workspace.openPath(image.dataset.path, { newTab: true });
  });
  container.addEventListener('auxclick', (event) => {
    const link = event.button === 1 && event.target.closest('a.internal-link');
    if (link) follow(event, link);
  });
  container.addEventListener('change', (event) => {
    const box = event.target.closest('.task-list-item-checkbox');
    if (!box) return;
    // A task inside an embed belongs to another note: leave it as it was.
    if (box.closest('[data-embed-path]') || box.closest('.hover-preview')) { box.checked = !box.checked; return; }
    view.toggleTask(Number(box.dataset.line));
  });
  container.addEventListener('mouseover', (event) => {
    const link = event.target.closest('a.internal-link[data-path]');
    if (!link || link === preview.link || link.closest('.hover-preview')) return;
    clearTimeout(preview.timer);
    preview.link = link;
    preview.timer = setTimeout(() => showPreview(link), 550);
  });
  container.addEventListener('mouseout', (event) => {
    const link = event.target.closest('a.internal-link[data-path]');
    if (!link) return;
    const to = event.relatedTarget;
    if (to && (link.contains(to) || (preview.el && preview.el.contains(to)))) return;
    clearTimeout(preview.timer);
    // Leave a moment to reach the preview with the pointer.
    preview.timer = setTimeout(() => { if (!preview.el || !preview.el.matches(':hover')) hidePreview(); }, 220);
  });
}

document.addEventListener('keydown', hidePreview, true);
document.addEventListener('mousedown', (event) => { if (preview.el && !preview.el.contains(event.target)) hidePreview(); }, true);
export { hidePreview };
