// Opale — who else is in a shared project and where: the faces in the
// header of a shared note or board, and « Suivre cette personne ».
// Only what happens inside the project is shared: the file someone looks at,
// their caret or pointer on it, what they select or drag. Nothing else.
import { h, showMenu, toast } from '../core.js';
import { nameOf } from './client.js';

export const initials = (name) => String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
export const STATE_LABEL = { active: 'actif', idle: 'inactif', away: 'absent' };

// Following someone: one at a time, for the whole window.
export const follow = {
  target: null, // { project, id, name, color }
  listeners: new Set(),
  start(project, person) {
    this.target = { project: project.id, id: person.id, name: person.name, color: person.color };
    this.notify();
    toast(`Vous suivez ${person.name}. Échap ou un geste de votre part pour arrêter.`);
  },
  stop() { if (!this.target) return; this.target = null; this.notify(); },
  is(project, id) { return !!this.target && this.target.project === project.id && (id === undefined || this.target.id === id); },
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  notify() { for (const fn of [...this.listeners]) { try { fn(this.target); } catch (error) { console.error(error); } } },
};
window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && follow.target) follow.stop(); }, true);

// The faces at the top of a shared view, and the "following" pill.
export class PresenceBar {
  constructor(view) {
    this.view = view;
    this.el = h('div.collab-faces', { 'aria-label': 'Participants connectés' });
    this.pill = h('div.collab-follow', { hidden: true });
    this.offFollow = follow.on(() => this.render());
  }
  render() {
    const view = this.view; const project = view.project;
    if (!project) { this.el.replaceChildren(); return; }
    const people = project.participants();
    const here = people.filter((person) => person.presence.doc === view.fileId);
    const elsewhere = people.filter((person) => person.presence.doc !== view.fileId);
    const face = (person, away) => {
      const state = person.state === 'idle' ? 'idle' : 'active';
      const label = `${person.name}${person.device ? ` — ${person.device}` : ''} · ${away ? 'ailleurs dans le projet' : STATE_LABEL[state]}${person.presence.typing ? ' · écrit' : ''}`;
      return h(`button.collab-face.is-${state}${away ? '.is-away' : ''}${follow.is(project, person.id) ? '.is-followed' : ''}`, {
        type: 'button', title: label, 'aria-label': label, style: `--who:${person.color}`,
        onClick: (event) => this.menu(event, person),
      }, initials(person.name));
    };
    this.el.replaceChildren(...here.map((person) => face(person, false)), ...elsewhere.slice(0, 4).map((person) => face(person, true)),
      ...(elsewhere.length > 4 ? [h('span.collab-face-more', `+${elsewhere.length - 4}`)] : []));
    this.el.hidden = !people.length;
    const target = follow.target;
    if (target && follow.is(project)) {
      this.pill.hidden = false;
      this.pill.style.setProperty('--who', target.color);
      this.pill.replaceChildren(h('span', `Vous suivez ${target.name}`), h('button.btn.small', { type: 'button', onClick: () => follow.stop() }, 'Arrêter'));
    } else this.pill.hidden = true;
  }
  menu(event, person) {
    const rect = event.currentTarget.getBoundingClientRect();
    const project = this.view.project;
    const following = follow.is(project, person.id);
    const where = person.presence.doc && person.presence.doc !== this.view.fileId ? project.file(person.presence.doc) : null;
    showMenu(rect.left, rect.bottom + 4, [
      { label: `${person.name}${person.device ? ` (${person.device})` : ''}`, disabled: true },
      following ? { label: 'Arrêter de suivre', icon: 'x', run: () => follow.stop() } : { label: 'Suivre cette personne', icon: 'eye', run: () => { follow.start(project, person); this.view.followNow && this.view.followNow(); } },
      where ? { label: `Aller à « ${where.display} »`, icon: 'file', run: () => this.view.goTo && this.view.goTo(where) } : null,
    ].filter(Boolean));
  }
  destroy() { this.offFollow(); }
}

// Label for a remote caret or pointer.
export function tag(person, extra = '') {
  return h('span.collab-tag', { style: `--who:${person.color}` }, `${person.name || nameOf(person.email)}${extra}`);
}
