// Opale — the rich elements of a moodboard: tables, kanban boards, mind
// maps, task cards, planning, polls, wheels… Each one has
//   render(view, el, body)        draw it (in place when only a state changed,
//                                 so flips and spins animate)
//   actions[name](view, el, args, event, target)   buttons inside it
//   grabs[name](view, el, args, event)             things dragged inside it
//   menu(view, el, target)        right-click entries for a part of it
// Texts are edited through `data-edit="path"` (see view.editField).
import { fileUrl, icon, Meta } from '../core.js';
import { store } from '../store.js';
import { esc, inline } from './render.js';

const Board = window.OpaleBoard;
const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#84cc16'];
const STATUS = { todo: 'À faire', doing: 'En cours', done: 'Terminé', blocked: 'Bloqué' };
const TSHIRT = ['', 'XS', 'S', 'M', 'L', 'XL', 'XXL'];
export const POINTS = ['', '0', '½', '1', '2', '3', '5', '8', '13', '21', '40', '?'];

const text = (view, value, placeholder) => (value ? inline(view, value) : `<span class="b-placeholder">${esc(placeholder)}</span>`);
const button = (action, label, title = '', cls = '') => `<button type="button" class="b-act ${cls}" data-action="${action}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;

let measureContext = null;
function measure(value, font) {
  if (!measureContext) measureContext = document.createElement('canvas').getContext('2d');
  measureContext.font = font;
  return Math.max(...String(value || ' ').split('\n').map((line) => measureContext.measureText(line).width));
}

// --------------------------------------------------------------- mind map
const MIND_FONT = 15; const ROOT_FONT = 19; const GAP_X = 56; const GAP_Y = 14;
function mindLayout(root) {
  const nodes = []; const links = [];
  const size = (node, depth) => {
    const font = depth === 0 ? ROOT_FONT : MIND_FONT;
    const lines = (node.text || ' ').split('\n').length;
    const w = Math.min(320, Math.max(depth === 0 ? 120 : 60, measure(node.text || 'Idée', `${depth === 0 ? 700 : 500} ${font}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`) + (depth === 0 ? 40 : 26)));
    const hgt = lines * font * 1.35 + (depth === 0 ? 22 : 14);
    return { w, h: hgt };
  };
  const walk = (node, depth) => {
    const box = size(node, depth);
    const kids = node.collapsed ? [] : node.children.map((child) => walk(child, depth + 1));
    const span = kids.length ? kids.reduce((sum, kid) => sum + kid.span, 0) + GAP_Y * (kids.length - 1) : 0;
    return { node, depth, box, kids, span: Math.max(box.h, span) };
  };
  const tree = walk(root, 0);
  const colX = [];
  const widths = (t) => { colX[t.depth] = Math.max(colX[t.depth] || 0, t.box.w); t.kids.forEach(widths); };
  widths(tree);
  const xs = [16];
  for (let d = 1; d < colX.length; d++) xs[d] = xs[d - 1] + colX[d - 1] + GAP_X;
  const put = (t, top, color) => {
    const y = top + t.span / 2 - t.box.h / 2;
    const tint = t.depth === 1 ? (t.node.color || PALETTE[nodes.filter((n) => n.depth === 1).length % PALETTE.length]) : (t.node.color || color);
    const placed = { id: t.node.id, node: t.node, depth: t.depth, x: xs[t.depth], y, w: t.box.w, h: t.box.h, color: tint };
    nodes.push(placed);
    let cursor = top + (t.span - (t.kids.reduce((s, k) => s + k.span, 0) + GAP_Y * Math.max(0, t.kids.length - 1))) / 2;
    for (const kid of t.kids) {
      const child = put(kid, cursor, tint);
      links.push({ from: placed, to: child, color: child.color });
      cursor += kid.span + GAP_Y;
    }
    return placed;
  };
  put(tree, 16, '#6366f1');
  const width = Math.max(...nodes.map((n) => n.x + n.w)) + 16; const height = tree.span + 32;
  return { nodes, links, width, height };
}

export function findTopic(root, id, parent = null) {
  if (!root) return null;
  if (root.id === id) return { node: root, parent };
  for (const child of root.children) { const hit = findTopic(child, id, root); if (hit) return hit; }
  return null;
}

// ------------------------------------------------------------- planning
function timelineDates(d) {
  let start = d.start ? new Date(`${d.start}T00:00:00`) : new Date();
  if (Number.isNaN(start.getTime())) start = new Date();
  if (!d.start) { const day = (start.getDay() + 6) % 7; start.setDate(start.getDate() - day); }
  const label = (i) => {
    const date = new Date(start);
    if (d.unit === 'day') { date.setDate(date.getDate() + i); return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }); }
    if (d.unit === 'week') { date.setDate(date.getDate() + i * 7); return `Sem. du ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`; }
    date.setMonth(date.getMonth() + i); return date.toLocaleDateString('fr-FR', { month: 'long', year: '2-digit' });
  };
  return Array.from({ length: d.count }, (_, i) => label(i));
}
const LANE_HEAD = 140; const TL_HEAD = 40; const TL_FOOT = 34;

// ------------------------------------------------------------ activities
const ACTIVITY_NAMES = { choice: 'Choix multiple', open: 'Question ouverte', scale: 'Échelle de notation', ranking: 'Classement', wordcloud: 'Nuage de mots', matrix: 'Matrice 2×2', quiz: 'Quiz' };
export { ACTIVITY_NAMES };

function optionsTotal(options) { return options.reduce((sum, option) => sum + option.votes, 0); }

// ---------------------------------------------------------------- widgets
export const WIDGETS = {
  table: {
    render(view, el, body) {
      body.className = 'b-body b-table-wrap';
      const { rows, header } = el.data;
      const widths = el.data.widths && el.data.widths.length === rows[0].length ? el.data.widths : null;
      const cols = widths ? `<colgroup>${widths.map((w) => `<col style="width:${(w / widths.reduce((a, b) => a + b, 0)) * 100}%">`).join('')}</colgroup>` : '';
      body.innerHTML = `<table class="b-table${header ? ' has-header' : ''}">${cols}${rows.map((row, r) => `<tr>${row.map((cell, c) => `<td data-cell="${r}:${c}" data-edit="rows.${r}.${c}">${cell ? inline(view, cell) : '&#8203;'}</td>`).join('')}</tr>`).join('')}</table>`
        + button('addRow', '+', 'Ajouter une ligne', 'b-add b-add-row') + button('addCol', '+', 'Ajouter une colonne', 'b-add b-add-col');
      view.autoSize(el, null, body.querySelector('table').offsetHeight + 2);
    },
    actions: {
      addRow(view, el) { view.mutate(el, (d) => { d.rows.push(d.rows[0].map(() => '')); }); },
      addCol(view, el) { view.mutate(el, (d) => { d.rows.forEach((row) => row.push('')); delete d.widths; el.w += 120; }); },
      insertRow(view, el, [r, after]) { view.mutate(el, (d) => { d.rows.splice(Number(r) + (after === '1' ? 1 : 0), 0, d.rows[0].map(() => '')); }); },
      insertCol(view, el, [c, after]) { view.mutate(el, (d) => { d.rows.forEach((row) => row.splice(Number(c) + (after === '1' ? 1 : 0), 0, '')); delete d.widths; el.w += 120; }); },
      deleteRow(view, el, [r]) { view.mutate(el, (d) => { if (d.rows.length > 1) d.rows.splice(Number(r), 1); }); },
      deleteCol(view, el, [c]) { view.mutate(el, (d) => { if (d.rows[0].length > 1) { d.rows.forEach((row) => row.splice(Number(c), 1)); delete d.widths; el.w = Math.max(120, el.w - 120); } }); },
      toggleHeader(view, el) { view.mutate(el, (d) => { d.header = !d.header; }); },
    },
    menu(view, el, target) {
      const cell = target.closest('[data-cell]');
      if (!cell) return [];
      const [r, c] = cell.dataset.cell.split(':');
      const run = (name, args) => () => WIDGETS.table.actions[name](view, el, args);
      return [
        { label: 'Insérer une ligne au-dessus', run: run('insertRow', [r, '0']) },
        { label: 'Insérer une ligne en dessous', run: run('insertRow', [r, '1']) },
        { label: 'Insérer une colonne à gauche', run: run('insertCol', [c, '0']) },
        { label: 'Insérer une colonne à droite', run: run('insertCol', [c, '1']) },
        'separator',
        { label: el.data.header ? 'Retirer la ligne d’en-tête' : 'Première ligne en en-tête', run: run('toggleHeader', []) },
        { label: 'Supprimer la ligne', icon: 'trash', danger: true, run: run('deleteRow', [r]), disabled: el.data.rows.length < 2 },
        { label: 'Supprimer la colonne', icon: 'trash', danger: true, run: run('deleteCol', [c]), disabled: el.data.rows[0].length < 2 },
      ];
    },
  },

  kanban: {
    render(view, el, body) {
      body.className = 'b-body b-kanban';
      const d = el.data;
      body.innerHTML = `<div class="b-kanban-title" data-edit="title">${esc(d.title || 'Kanban')}</div><div class="b-kanban-cols">${d.columns.map((column, i) => `
        <div class="b-kcol" data-col="${i}" style="--col:${esc(column.color || PALETTE[i % PALETTE.length])}">
          <div class="b-kcol-head"><span class="b-kcol-title" data-edit="columns.${i}.title">${esc(column.title || 'Colonne')}</span><span class="b-kcol-count">${column.cards.length}</span>${button(`delColumn:${i}`, icon('x', 12), 'Supprimer la colonne', 'b-mini b-hover')}</div>
          <div class="b-kcol-cards">${column.cards.map((card, j) => `<div class="b-kcard" data-grab="card:${i}:${j}" data-edit="columns.${i}.cards.${j}.text"${card.color ? ` style="border-left-color:${esc(card.color)}"` : ''}>${text(view, card.text, 'Carte vide')}${button(`delCard:${i}:${j}`, icon('x', 11), 'Supprimer la carte', 'b-mini b-hover b-kcard-del')}</div>`).join('')}</div>
          ${button(`addCard:${i}`, `${icon('plus', 13)} Ajouter une carte`, '', 'b-kadd')}
        </div>`).join('')}<div class="b-kcol b-kcol-new">${button('addColumn', `${icon('plus', 14)} Colonne`, 'Ajouter une colonne', 'b-kadd')}</div></div>`;
      const cols = body.querySelector('.b-kanban-cols');
      view.autoSize(el, Math.max(el.w, cols.scrollWidth + 24), Math.max(260, cols.scrollHeight + 60));
    },
    actions: {
      addCard(view, el, [i]) {
        let target = null;
        view.mutate(el, (d) => { const card = { id: Board.newId(), text: '', color: '' }; d.columns[Number(i)].cards.push(card); target = `columns.${i}.cards.${d.columns[Number(i)].cards.length - 1}.text`; });
        view.editField(el, target);
      },
      delCard(view, el, [i, j]) { view.mutate(el, (d) => { d.columns[Number(i)].cards.splice(Number(j), 1); }); },
      addColumn(view, el) {
        let target = null;
        view.mutate(el, (d) => { d.columns.push({ id: Board.newId(), title: 'Nouvelle colonne', color: '', cards: [] }); target = `columns.${d.columns.length - 1}.title`; });
        view.editField(el, target);
      },
      delColumn(view, el, [i]) { view.mutate(el, (d) => { d.columns.splice(Number(i), 1); }); },
    },
    grabs: {
      // Drag a card to another place or column of the board.
      card(view, el, [i, j], event, source) {
        return view.dragWithin(event, source, {
          target(x, y) {
            const node = view.nodeOf(el.id);
            const hit = document.elementFromPoint(x, y);
            const column = hit && hit.closest('.b-kcol[data-col]');
            if (!column || !node.contains(column)) return null;
            const cards = [...column.querySelectorAll('.b-kcard')].filter((card) => card !== source);
            let index = cards.findIndex((card) => { const r = card.getBoundingClientRect(); return y < r.top + r.height / 2; });
            if (index < 0) index = cards.length;
            const ref = cards[index];
            const r = (ref || column.querySelector('.b-kcol-cards')).getBoundingClientRect();
            return { col: Number(column.dataset.col), index, line: { left: r.left, width: r.width, top: ref ? r.top - 4 : (cards.length ? cards[cards.length - 1].getBoundingClientRect().bottom + 3 : r.top + 4) } };
          },
          drop(target) {
            view.mutate(el, (d) => {
              const [card] = d.columns[Number(i)].cards.splice(Number(j), 1);
              d.columns[target.col].cards.splice(target.index, 0, card);
            });
          },
        });
      },
    },
  },

  mindmap: {
    render(view, el, body) {
      body.className = 'b-body b-mindmap';
      const layout = mindLayout(el.data.root);
      const focus = view.widgetFocus && view.widgetFocus.id === el.id ? view.widgetFocus.node : null;
      const curve = (l) => { const x1 = l.from.x + l.from.w; const y1 = l.from.y + l.from.h / 2; const x2 = l.to.x; const y2 = l.to.y + l.to.h / 2; const mx = (x1 + x2) / 2; return `<path d="M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" stroke="${esc(l.color)}"/>`; };
      body.innerHTML = `<svg class="b-mind-links" width="${layout.width}" height="${layout.height}">${layout.links.map(curve).join('')}</svg>${layout.nodes.map((n) => `
        <div class="b-topic d${Math.min(n.depth, 3)}${n.id === focus ? ' is-focus' : ''}" data-topic="${esc(n.id)}" data-edit="node.${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;min-height:${n.h}px;--topic:${esc(n.color)}">${n.node.text ? esc(n.node.text).replace(/\n/g, '<br>') : '<span class="b-placeholder">Idée</span>'}
          ${button(`addChild:${n.id}`, icon('plus', 11), 'Ajouter une idée (Tab)', 'b-topic-add')}
          ${n.node.children.length ? button(`toggle:${n.id}`, n.node.collapsed ? String(n.node.children.length) : '−', n.node.collapsed ? 'Déplier' : 'Replier', 'b-topic-toggle') : ''}
        </div>`).join('')}`;
      view.autoSize(el, layout.width, layout.height, true);
    },
    actions: {
      addChild(view, el, [id]) { mindAdd(view, el, id, 'child'); },
      toggle(view, el, [id]) { view.mutate(el, (d) => { const hit = findTopic(d.root, id); if (hit) hit.node.collapsed = !hit.node.collapsed; }); },
      focus(view, el, [id]) { view.widgetFocus = { id: el.id, node: id }; view.redraw(el); },
    },
    menu(view, el, target) {
      const topic = target.closest('[data-topic]');
      if (!topic) return [];
      const id = topic.dataset.topic;
      return [
        { label: 'Ajouter une sous-idée', hint: 'Tab', run: () => mindAdd(view, el, id, 'child') },
        { label: 'Ajouter une idée sœur', hint: 'Enter', run: () => mindAdd(view, el, id, 'sibling'), disabled: id === el.data.root.id },
        'separator',
        { label: 'Supprimer l’idée', icon: 'trash', danger: true, run: () => mindRemove(view, el, id), disabled: id === el.data.root.id, hint: 'Backspace' },
      ];
    },
    // Keys while one idea is focused, as in mind-mapping tools.
    key(view, el, event) {
      const focus = view.widgetFocus && view.widgetFocus.id === el.id ? view.widgetFocus.node : null;
      if (!focus) return false;
      if (event.key === 'Tab') { event.preventDefault(); mindAdd(view, el, focus, 'child'); return true; }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (focus === el.data.root.id) view.editField(el, `node.${focus}`); else mindAdd(view, el, focus, 'sibling'); return true; }
      if (event.key === 'F2' || (event.key === 'Enter' && event.shiftKey)) { event.preventDefault(); view.editField(el, `node.${focus}`); return true; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && focus !== el.data.root.id) { event.preventDefault(); mindRemove(view, el, focus); return true; }
      if (event.key === 'Escape') { view.widgetFocus = null; view.redraw(el); return true; }
      return false;
    },
  },

  card: {
    render(view, el, body) {
      body.className = 'b-body b-card';
      const d = el.data;
      body.style.setProperty('--accent', el.style.accent || '#6366f1');
      body.innerHTML = `<div class="b-card-title" data-edit="title">${text(view, d.title, 'Titre de la tâche')}</div>
        <div class="b-card-desc" data-edit="description">${text(view, d.description, 'Description')}</div>
        ${d.tags.length ? `<div class="b-card-tags" data-edit="tags">${d.tags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>` : ''}
        <div class="b-card-foot">
          ${button('status', esc(STATUS[d.status]), 'Changer le statut', `b-pill s-${d.status}`)}
          <span class="b-card-who" data-edit="assignee" title="Personne assignée">${icon('pin', 12)}${d.assignee ? esc(d.assignee) : '<span class="b-placeholder">Assigner</span>'}</span>
          <span class="b-card-due" data-edit="due" title="Échéance">${icon('calendar', 12)}${d.due ? esc(new Date(`${d.due}T00:00:00`).toString() === 'Invalid Date' ? d.due : new Date(`${d.due}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })) : '<span class="b-placeholder">Date</span>'}</span>
          <span class="b-card-est">${button('points', d.points ? `${esc(d.points)} pts` : 'pts', 'Story points', 'b-pill b-est')}${button('tshirt', d.tshirt || 'Taille', 'Taille de T-shirt', 'b-pill b-est')}</span>
        </div>`;
      view.autoSize(el, null, body.scrollHeight);
    },
    actions: {
      status(view, el) { const order = ['todo', 'doing', 'done', 'blocked']; view.mutate(el, (d) => { d.status = order[(order.indexOf(d.status) + 1) % order.length]; }); },
      points(view, el, args, event, target) { view.pickValue(target, POINTS.map((value) => ({ label: value || 'Aucun', value })), (value) => view.mutate(el, (d) => { d.points = value; })); },
      tshirt(view, el, args, event, target) { view.pickValue(target, TSHIRT.map((value) => ({ label: value || 'Aucune', value })), (value) => view.mutate(el, (d) => { d.tshirt = value; })); },
    },
  },

  flipcard: {
    render(view, el, body) {
      const d = el.data;
      let flip = body.querySelector('.b-flip');
      if (!flip) {
        body.className = 'b-body b-flipcard';
        body.innerHTML = `<div class="b-flip"><div class="b-face b-front" data-edit="front"></div><div class="b-face b-back" data-edit="back"></div></div>${button('flip', icon('refresh', 14), 'Retourner la carte', 'b-mini b-flip-btn')}`;
        flip = body.querySelector('.b-flip');
      }
      body.style.setProperty('--fill', el.style.fill || '#ffffff');
      flip.querySelector('.b-front').innerHTML = text(view, d.front, 'Recto — double-cliquez');
      flip.querySelector('.b-back').innerHTML = text(view, d.back, 'Verso — double-cliquez');
      flip.classList.toggle('is-flipped', d.flipped);
    },
    actions: { flip(view, el) { view.mutate(el, (d) => { d.flipped = !d.flipped; }); } },
  },

  usercard: {
    render(view, el, body) {
      body.className = 'b-body b-usercard';
      const d = el.data;
      body.style.setProperty('--accent', el.style.accent || '#0ea5e9');
      const initials = (d.name || '?').split(/\s+/).map((part) => part[0] || '').join('').slice(0, 2).toUpperCase();
      const avatar = d.image && store.has(d.image) ? `<img src="${esc(fileUrl(d.image))}" alt="">` : `<span>${esc(initials)}</span>`;
      body.innerHTML = `<div class="b-user-head"><button type="button" class="b-avatar b-act" data-action="avatar" title="Choisir une photo">${avatar}</button><div><div class="b-user-name" data-edit="name">${text(view, d.name, 'Nom')}</div><div class="b-user-role" data-edit="role">${text(view, d.role, 'Rôle')}</div></div></div><div class="b-user-notes" data-edit="notes">${text(view, d.notes, 'Objectifs, besoins, frustrations…')}</div>`;
      view.autoSize(el, null, body.scrollHeight);
    },
    actions: { avatar(view, el) { view.chooseVaultImage((path) => view.mutate(el, (d) => { d.image = path; })); } },
  },

  timeline: {
    render(view, el, body) {
      body.className = 'b-body b-timeline';
      const d = el.data;
      const labels = timelineDates(d);
      const lanes = d.lanes.length ? d.lanes : [{ id: '', title: '' }];
      const unit = (el.w - LANE_HEAD) / d.count;
      const laneH = Math.max(44, (el.h - TL_HEAD - TL_FOOT) / lanes.length);
      body.style.setProperty('--unit', `${unit}px`);
      body.innerHTML = `<div class="b-tl-head" style="height:${TL_HEAD}px"><div class="b-tl-corner" data-edit="title">${esc(d.title || 'Planning')}</div>${labels.map((label, i) => `<div class="b-tl-unit" style="left:${LANE_HEAD + i * unit}px;width:${unit}px">${esc(label)}</div>`).join('')}</div>
        ${lanes.map((lane, l) => `<div class="b-tl-lane" data-lane="${l}" style="top:${TL_HEAD + l * laneH}px;height:${laneH}px"><div class="b-tl-lane-title" data-edit="lanes.${l}.title">${esc(lane.title) || '<span class="b-placeholder">Ligne</span>'}</div><div class="b-tl-track b-act" data-action="addItem:${l}" title="Cliquer pour ajouter une tâche ici"></div></div>`).join('')}
        ${d.items.map((item, i) => { const l = Math.max(0, lanes.findIndex((lane) => lane.id === item.lane)); return `<div class="b-tl-item" data-grab="item:${i}" data-edit="items.${i}.text" style="left:${LANE_HEAD + item.start * unit}px;width:${Math.max(16, item.length * unit - 4)}px;top:${TL_HEAD + l * laneH + 8}px;height:${laneH - 16}px;--item:${esc(item.color || PALETTE[i % PALETTE.length])}">${esc(item.text) || '<span class="b-placeholder">Tâche</span>'}<span class="b-tl-resize" data-grab="resize:${i}"></span></div>`; }).join('')}
        <div class="b-tl-foot" style="height:${TL_FOOT}px">${button('addLane', `${icon('plus', 12)} Ligne`, 'Ajouter une ligne')}${button('unit', d.unit === 'day' ? 'Jours' : d.unit === 'week' ? 'Semaines' : 'Mois', 'Changer l’échelle de temps')}${button('less', '−', 'Moins de colonnes')}${button('more', '+', 'Plus de colonnes')}<span class="b-tl-start" data-edit="start" title="Date de début (AAAA-MM-JJ)">${icon('calendar', 12)} ${esc(d.start || 'Début : cette semaine')}</span></div>`;
    },
    actions: {
      addLane(view, el) { let path = null; view.mutate(el, (d) => { if (!d.lanes.length) d.lanes.push({ id: Board.newId(), title: 'Équipe' }); d.lanes.push({ id: Board.newId(), title: '' }); el.h += 56; path = `lanes.${d.lanes.length - 1}.title`; }); view.editField(el, path); },
      unit(view, el) { const order = ['day', 'week', 'month']; view.mutate(el, (d) => { d.unit = order[(order.indexOf(d.unit) + 1) % 3]; }); },
      less(view, el) { view.mutate(el, (d) => { d.count = Math.max(1, d.count - 1); }); },
      more(view, el) { view.mutate(el, (d) => { d.count = Math.min(120, d.count + 1); }); },
      addItem(view, el, [l], event, target) {
        const rect = target.getBoundingClientRect();
        const d = el.data;
        const start = Math.max(0, Math.min(d.count - 1, Math.floor(((event.clientX - rect.left) / rect.width) * d.count)));
        let path = null;
        view.mutate(el, (data) => {
          if (!data.lanes.length) data.lanes.push({ id: Board.newId(), title: '' });
          data.items.push({ id: Board.newId(), lane: data.lanes[Number(l)].id, start, length: 1, text: '', color: '' });
          path = `items.${data.items.length - 1}.text`;
        });
        view.editField(el, path);
      },
    },
    grabs: {
      item(view, el, [i], event) { return timelineDrag(view, el, Number(i), event, 'move'); },
      resize(view, el, [i], event) { return timelineDrag(view, el, Number(i), event, 'resize'); },
    },
    menu(view, el, target) {
      const item = target.closest('[data-grab^="item:"]');
      if (!item) return [];
      const i = Number(item.dataset.grab.split(':')[1]);
      return [
        ...PALETTE.slice(0, 6).map((colour, n) => ({ label: ['Indigo', 'Bleu', 'Vert', 'Ambre', 'Rouge', 'Rose'][n], run: () => view.mutate(el, (d) => { d.items[i].color = colour; }) })),
        'separator',
        { label: 'Supprimer la tâche', icon: 'trash', danger: true, run: () => view.mutate(el, (d) => { d.items.splice(i, 1); }) },
      ];
    },
  },

  comment: {
    render(view, el, body) {
      body.className = `b-body b-comment${el.data.resolved ? ' is-resolved' : ''}`;
      const count = el.data.thread.length;
      body.innerHTML = `<button type="button" class="b-comment-pin b-act" data-action="thread" title="${count ? `${count} message(s)` : 'Nouveau commentaire'}">${icon('info', 16)}${count ? `<span>${count}</span>` : ''}</button>`;
    },
    actions: { thread(view, el) { view.openThread(el); } },
  },

  mermaid: {
    render(view, el, body) {
      body.className = 'b-body b-mermaid';
      const Mermaid = window.OpaleBoardMermaid;
      const result = Mermaid ? Mermaid.toSvg(el.data.source || '', { dark: document.documentElement.dataset.theme !== 'light' }) : { error: 'Module Mermaid indisponible.' };
      body.innerHTML = `<div class="b-mermaid-head">${icon('graph', 13)} Mermaid ${button('edit', 'Modifier', 'Modifier le code Mermaid', 'b-pill')}${button('convert', 'Convertir en formes', 'Remplacer par des formes modifiables', 'b-pill')}</div>`
        + (result.error ? `<div class="b-mermaid-error">${esc(result.error)}</div>` : `<div class="b-mermaid-svg">${result.svg}</div>`);
    },
    actions: {
      edit(view, el) { view.editMermaid(el); },
      convert(view, el) { view.convertMermaid(el); },
    },
  },

  poll: {
    render(view, el, body) {
      body.className = 'b-body b-poll';
      const d = el.data; const total = optionsTotal(d.options);
      body.innerHTML = `<div class="b-poll-q" data-edit="question">${text(view, d.question, 'Votre question')}</div>
        <div class="b-poll-options">${d.options.map((option, i) => `<div class="b-poll-option b-act" data-action="vote:${i}" title="Cliquer pour voter"><span class="b-poll-bar" style="width:${total ? (option.votes / total) * 100 : 0}%"></span><span class="b-poll-text" data-edit="options.${i}.text">${esc(option.text) || '<span class="b-placeholder">Option</span>'}</span><span class="b-poll-count">${option.votes}${total ? ` · ${Math.round((option.votes / total) * 100)} %` : ''}</span>${button(`remove:${i}`, icon('x', 11), 'Retirer l’option', 'b-mini b-hover')}</div>`).join('')}</div>
        <div class="b-poll-foot">${button('add', `${icon('plus', 12)} Option`)}${button('reset', 'Remettre à zéro')}<span>${total} vote${total > 1 ? 's' : ''}</span></div>`;
      view.autoSize(el, null, body.scrollHeight);
    },
    actions: {
      vote(view, el, [i]) { view.mutate(el, (d) => { d.options[Number(i)].votes++; }); view.pulse(el, `[data-action="vote:${i}"]`); },
      add(view, el) { let path = null; view.mutate(el, (d) => { d.options.push({ id: Board.newId(), text: '', votes: 0 }); path = `options.${d.options.length - 1}.text`; }); view.editField(el, path); },
      remove(view, el, [i]) { view.mutate(el, (d) => { d.options.splice(Number(i), 1); }); },
      reset(view, el) { view.mutate(el, (d) => { d.options.forEach((option) => { option.votes = 0; }); }); },
    },
  },

  wheel: {
    render(view, el, body) {
      const d = el.data;
      const entries = d.entries.length ? d.entries : ['Option 1', 'Option 2', 'Option 3'];
      const size = Math.min(el.w, el.h - 70);
      const r = size / 2 - 6;
      const slice = (Math.PI * 2) / entries.length;
      const segment = (entry, i) => {
        const a0 = i * slice - Math.PI / 2; const a1 = a0 + slice;
        const p = (a) => `${(size / 2 + r * Math.cos(a)).toFixed(2)} ${(size / 2 + r * Math.sin(a)).toFixed(2)}`;
        const mid = a0 + slice / 2;
        const tx = size / 2 + r * 0.62 * Math.cos(mid); const ty = size / 2 + r * 0.62 * Math.sin(mid);
        return `<path d="M ${size / 2} ${size / 2} L ${p(a0)} A ${r} ${r} 0 ${slice > Math.PI ? 1 : 0} 1 ${p(a1)} Z" fill="${PALETTE[i % PALETTE.length]}"/><text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" transform="rotate(${((mid * 180) / Math.PI).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(9, Math.min(16, r / 7))}">${esc(entry.length > 18 ? `${entry.slice(0, 17)}…` : entry)}</text>`;
      };
      const signature = JSON.stringify([entries, Math.round(size)]);
      let disc = body.querySelector('.b-wheel-disc');
      if (!disc || body.dataset.signature !== signature) {
        body.className = 'b-body b-wheel';
        body.dataset.signature = signature;
        body.innerHTML = `<div class="b-wheel-stage" style="width:${size}px;height:${size}px"><svg class="b-wheel-disc" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${entries.map(segment).join('')}<circle cx="${size / 2}" cy="${size / 2}" r="${Math.max(10, r * 0.12)}" fill="#fff" stroke="#1f2937" stroke-width="2"/></svg><span class="b-wheel-pointer"></span></div><div class="b-wheel-foot">${button('spin', 'Tourner', 'Tourner la roue', 'b-pill b-primary')}${button('entries', 'Modifier', 'Modifier les choix', 'b-pill')}<span class="b-wheel-result"></span></div>`;
        disc = body.querySelector('.b-wheel-disc');
        disc.style.transition = 'none';
        disc.style.transform = `rotate(${d.angle || 0}deg)`;
        void disc.offsetWidth;
        disc.style.transition = '';
      }
      disc.style.transform = `rotate(${d.angle || 0}deg)`;
      body.querySelector('.b-wheel-result').textContent = d.result ? `→ ${d.result}` : '';
    },
    actions: {
      spin(view, el) {
        const d = el.data;
        const entries = d.entries.length ? d.entries : ['Option 1', 'Option 2', 'Option 3'];
        const pick = Math.floor(Math.random() * entries.length);
        const slice = 360 / entries.length;
        const base = Math.ceil(((d.angle || 0) + 1) / 360) * 360 + 360 * 5;
        const angle = base + (360 - (pick * slice + slice / 2)) + (Math.random() - 0.5) * slice * 0.7;
        view.mutate(el, (data) => { data.angle = angle; data.result = ''; });
        setTimeout(() => { if (el.data.angle === angle) view.mutate(el, (data) => { data.result = entries[pick]; }, { merge: true }); }, 4200);
      },
      entries(view, el) { view.editLines(el, 'entries', 'Un choix par ligne'); },
    },
  },

  scale: {
    render(view, el, body) {
      body.className = 'b-body b-scale';
      const d = el.data;
      const steps = Array.from({ length: d.steps }, (_, i) => `<span class="b-scale-step" style="left:${(i / (d.steps - 1)) * 100}%"></span>`).join('');
      body.innerHTML = `<div class="b-scale-ends"><span data-edit="left">${text(view, d.left, 'Pas du tout d’accord')}</span><span data-edit="right">${text(view, d.right, 'Tout à fait d’accord')}</span></div>
        <div class="b-scale-track b-act" data-action="addMark" title="Cliquer pour placer un avis">${steps}${d.marks.map((mark, i) => `<span class="b-scale-mark" data-grab="mark:${i}" data-edit="marks.${i}.label" style="left:${mark.value * 100}%;--mark:${esc(mark.color || PALETTE[i % PALETTE.length])}"><i></i><em>${esc(mark.label)}</em></span>`).join('')}</div>`;
    },
    actions: {
      addMark(view, el, args, event, target) {
        const rect = target.getBoundingClientRect();
        const value = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        let path = null;
        view.mutate(el, (d) => { d.marks.push({ id: Board.newId(), value, label: '', color: '' }); path = `marks.${d.marks.length - 1}.label`; });
        view.editField(el, path);
      },
    },
    grabs: {
      mark(view, el, [i], event) {
        const track = view.nodeOf(el.id).querySelector('.b-scale-track');
        return view.dragValue(event, (x) => { const rect = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - rect.left) / rect.width)); }, (value) => { el.data.marks[Number(i)].value = value; }, el);
      },
    },
    menu(view, el, target) {
      const mark = target.closest('[data-grab^="mark:"]');
      if (!mark) return [];
      const i = Number(mark.dataset.grab.split(':')[1]);
      return [{ label: 'Retirer cet avis', icon: 'trash', danger: true, run: () => view.mutate(el, (d) => { d.marks.splice(i, 1); }) }];
    },
  },

  activity: {
    render(view, el, body) {
      body.className = `b-body b-activity t-${el.data.type}`;
      const d = el.data;
      const total = optionsTotal(d.options);
      let content = '';
      if (d.type === 'choice' || d.type === 'quiz') {
        content = `<div class="b-poll-options">${d.options.map((option, i) => `<div class="b-poll-option b-act${d.type === 'quiz' && d.revealed && option.correct ? ' is-correct' : ''}${d.type === 'quiz' && d.revealed && !option.correct ? ' is-wrong' : ''}" data-action="vote:${i}"><span class="b-poll-bar" style="width:${total ? (option.votes / total) * 100 : 0}%"></span><span class="b-poll-text" data-edit="options.${i}.text">${esc(option.text) || '<span class="b-placeholder">Réponse</span>'}</span><span class="b-poll-count">${option.votes}</span>${d.type === 'quiz' ? button(`correct:${i}`, option.correct ? '✓' : '○', 'Marquer comme bonne réponse', 'b-mini b-hover') : ''}${button(`remove:${i}`, icon('x', 11), 'Retirer', 'b-mini b-hover')}</div>`).join('')}</div>
          <div class="b-poll-foot">${button('add', `${icon('plus', 12)} Réponse`)}${d.type === 'quiz' ? button('reveal', d.revealed ? 'Masquer la réponse' : 'Révéler la réponse', '', 'b-primary') : ''}${button('reset', 'Remettre à zéro')}<span>${total} réponse${total > 1 ? 's' : ''}</span></div>`;
      } else if (d.type === 'open') {
        content = `<div class="b-answers">${d.answers.map((answer, i) => `<div class="b-answer" data-edit="answers.${i}">${esc(answer)}${button(`delAnswer:${i}`, icon('x', 11), 'Retirer', 'b-mini b-hover')}</div>`).join('') || '<div class="b-placeholder">Aucune réponse pour l’instant.</div>'}</div><div class="b-poll-foot">${button('answer', `${icon('plus', 12)} Ajouter une réponse`, '', 'b-primary')}${button('clear', 'Tout effacer')}</div>`;
      } else if (d.type === 'scale') {
        const values = d.answers.map(Number).filter(Number.isFinite);
        const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        const counts = Array.from({ length: 10 }, (_, i) => values.filter((v) => v === i + 1).length);
        const most = Math.max(1, ...counts);
        content = `<div class="b-rating">${counts.map((count, i) => `<button type="button" class="b-act b-rate" data-action="rate:${i + 1}"><span class="b-rate-bar" style="height:${(count / most) * 100}%"></span><b>${i + 1}</b><small>${count || ''}</small></button>`).join('')}</div><div class="b-poll-foot"><span>Moyenne : <b>${values.length ? average.toFixed(1) : '—'}</b> sur ${values.length} vote${values.length > 1 ? 's' : ''}</span>${button('clear', 'Remettre à zéro')}</div>`;
      } else if (d.type === 'ranking') {
        const ranked = d.options.map((option, i) => ({ option, i }));
        content = `<ol class="b-ranking">${ranked.map(({ option, i }, rank) => `<li><b>${rank + 1}</b><span data-edit="options.${i}.text">${esc(option.text) || '<span class="b-placeholder">Élément</span>'}</span>${button(`up:${i}`, '↑', 'Monter', 'b-mini')}${button(`down:${i}`, '↓', 'Descendre', 'b-mini')}${button(`remove:${i}`, icon('x', 11), 'Retirer', 'b-mini b-hover')}</li>`).join('')}</ol><div class="b-poll-foot">${button('add', `${icon('plus', 12)} Élément`)}</div>`;
      } else if (d.type === 'wordcloud') {
        const counts = new Map();
        for (const word of d.answers) { const key = word.trim().toLowerCase(); if (key) counts.set(key, { word: word.trim(), n: ((counts.get(key) || {}).n || 0) + 1 }); }
        const list = [...counts.values()].sort((a, b) => b.n - a.n);
        const max = list.length ? list[0].n : 1;
        content = `<div class="b-cloud">${list.map((item, i) => `<span style="font-size:${14 + (item.n / max) * 30}px;color:${PALETTE[i % PALETTE.length]}">${esc(item.word)}</span>`).join('') || '<div class="b-placeholder">Ajoutez des mots : les plus cités grossissent.</div>'}</div><div class="b-poll-foot">${button('answer', `${icon('plus', 12)} Ajouter un mot`, '', 'b-primary')}${button('clear', 'Tout effacer')}</div>`;
      } else if (d.type === 'matrix') {
        content = `<div class="b-matrix b-act" data-action="point"><span class="b-axis b-axis-x" data-edit="xLabel">${esc(d.xLabel || 'Effort →')}</span><span class="b-axis b-axis-y" data-edit="yLabel">${esc(d.yLabel || 'Impact →')}</span>${d.options.map((option, i) => `<span class="b-matrix-dot" data-grab="dot:${i}" data-edit="options.${i}.text" style="left:${option.x * 100}%;top:${(1 - option.y) * 100}%;--mark:${PALETTE[i % PALETTE.length]}"><i></i><em>${esc(option.text)}</em></span>`).join('')}</div>`;
      }
      body.innerHTML = `<div class="b-activity-type">${esc(ACTIVITY_NAMES[d.type])}</div><div class="b-poll-q" data-edit="question">${text(view, d.question, 'Votre question')}</div>${content}`;
      if (d.type !== 'matrix') view.autoSize(el, null, body.scrollHeight);
    },
    actions: {
      vote(view, el, [i]) { view.mutate(el, (d) => { d.options[Number(i)].votes++; }); },
      add(view, el) { let path = null; view.mutate(el, (d) => { d.options.push({ id: Board.newId(), text: '', votes: 0, x: 0.5, y: 0.5 }); path = `options.${d.options.length - 1}.text`; }); view.editField(el, path); },
      remove(view, el, [i]) { view.mutate(el, (d) => { d.options.splice(Number(i), 1); }); },
      reset(view, el) { view.mutate(el, (d) => { d.options.forEach((option) => { option.votes = 0; }); d.revealed = false; }); },
      correct(view, el, [i]) { view.mutate(el, (d) => { d.options[Number(i)].correct = !d.options[Number(i)].correct; }); },
      reveal(view, el) { view.mutate(el, (d) => { d.revealed = !d.revealed; }); },
      answer(view, el) { let path = null; view.mutate(el, (d) => { d.answers.push(''); path = `answers.${d.answers.length - 1}`; }); view.editField(el, path, { dropEmpty: true }); },
      delAnswer(view, el, [i]) { view.mutate(el, (d) => { d.answers.splice(Number(i), 1); }); },
      clear(view, el) { view.mutate(el, (d) => { d.answers = []; }); },
      rate(view, el, [value]) { view.mutate(el, (d) => { d.answers.push(String(value)); }); },
      up(view, el, [i]) { view.mutate(el, (d) => { const n = Number(i); if (n > 0) [d.options[n - 1], d.options[n]] = [d.options[n], d.options[n - 1]]; }); },
      down(view, el, [i]) { view.mutate(el, (d) => { const n = Number(i); if (n < d.options.length - 1) [d.options[n + 1], d.options[n]] = [d.options[n], d.options[n + 1]]; }); },
      point(view, el, args, event, target) {
        if (event.target !== target) return;
        const rect = target.getBoundingClientRect();
        let path = null;
        view.mutate(el, (d) => { d.options.push({ id: Board.newId(), text: '', votes: 0, x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height)) }); path = `options.${d.options.length - 1}.text`; });
        view.editField(el, path);
      },
    },
    grabs: {
      dot(view, el, [i], event) {
        const area = view.nodeOf(el.id).querySelector('.b-matrix');
        return view.dragValue(event, (x, y) => { const rect = area.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (x - rect.left) / rect.width)), y: Math.max(0, Math.min(1, 1 - (y - rect.top) / rect.height)) }; }, (value) => { Object.assign(el.data.options[Number(i)], value); }, el);
      },
    },
  },
};

// Mind map editing.
function mindAdd(view, el, id, where) {
  let created = null;
  view.mutate(el, (d) => {
    const hit = findTopic(d.root, id);
    if (!hit) return;
    const topic = { id: Board.newId(), text: '', collapsed: false, color: '', children: [] };
    if (where === 'child' || !hit.parent) { hit.node.collapsed = false; hit.node.children.push(topic); }
    else hit.parent.children.splice(hit.parent.children.indexOf(hit.node) + 1, 0, topic);
    created = topic.id;
  });
  if (!created) return;
  view.widgetFocus = { id: el.id, node: created };
  view.editField(el, `node.${created}`, { dropEmpty: true });
}
function mindRemove(view, el, id) {
  let next = null;
  view.mutate(el, (d) => {
    const hit = findTopic(d.root, id);
    if (!hit || !hit.parent) return;
    const at = hit.parent.children.indexOf(hit.node);
    hit.parent.children.splice(at, 1);
    next = (hit.parent.children[at] || hit.parent.children[at - 1] || hit.parent).id;
  });
  if (next) { view.widgetFocus = { id: el.id, node: next }; view.redraw(el); }
}

// Planning: move a task along its lane (or to another lane), or stretch it.
function timelineDrag(view, el, i, event, mode) {
  const node = view.nodeOf(el.id);
  const d = el.data;
  const item = d.items[i];
  if (!item) return null;
  const startX = event.clientX; const startY = event.clientY;
  const origin = { start: item.start, length: item.length, lane: item.lane };
  const unitPx = () => ((el.w - LANE_HEAD) / d.count) * view.camera.k;
  return view.dragValue(event, (x, y) => ({ dx: x - startX, dy: y - startY }), ({ dx, dy }) => {
    const step = Math.round(dx / Math.max(1, unitPx()) * 4) / 4;
    if (mode === 'resize') item.length = Math.max(0.25, Math.min(d.count - item.start, origin.length + step));
    else {
      item.start = Math.max(0, Math.min(d.count - 0.25, origin.start + step));
      const lanes = [...node.querySelectorAll('.b-tl-lane')];
      const hit = lanes.find((lane) => { const r = lane.getBoundingClientRect(); return startY + dy >= r.top && startY + dy <= r.bottom; });
      if (hit && d.lanes[Number(hit.dataset.lane)]) item.lane = d.lanes[Number(hit.dataset.lane)].id;
    }
  }, el);
}

export const WIDGET_KINDS = Object.keys(WIDGETS);
export { STATUS, TSHIRT, PALETTE, Meta };
