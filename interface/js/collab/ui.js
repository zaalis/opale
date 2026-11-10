// Opale — shared projects in the left sidebar (« Projets partagés », under
// the notes) and their windows: create, join, members and permissions, sync
// status, network settings.
import { api, app, bus, confirmDialog, h, icon, iconButton, openModal, promptText, reportError, showMenu, toast } from '../core.js';
import { collab, nameOf } from './client.js';
import { initials } from './presence.js';
import './views.js';

const ROLE_NAMES = { owner: 'Propriétaire', admin: 'Administrateur', editor: 'Éditeur', reader: 'Lecteur' };
const ROLE_HELP = {
  admin: 'gère les membres (sauf le propriétaire et les autres administrateurs) et modifie tout',
  editor: 'modifie les notes et moodboards',
  reader: 'consulte sans modifier',
};
const LEVEL_TEXT = { ok: 'Tout est enregistré', pending: 'Modifications en cours d’envoi', warn: 'Modifications seulement sur cet ordinateur', error: 'Problème de synchronisation', closed: 'Fermé' };
const store = {
  get(key, fallback) { try { const value = JSON.parse(localStorage.getItem(`opale.collab.${key}`)); return value ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`opale.collab.${key}`, JSON.stringify(value)); } catch {} },
};
const when = (time) => {
  if (!time) return 'jamais';
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 10) return 'à l’instant';
  if (seconds < 60) return `il y a ${seconds} s`;
  if (seconds < 3600) return `il y a ${Math.round(seconds / 60)} min`;
  return new Date(time).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};

// ============================================================== sidebar
export const collabUi = {
  open: new Set(store.get('open', [])),
  folders: new Set(store.get('folders', [])),
  collapsed: store.get('collapsed', false),

  init(explorerEl) {
    this.list = h('div.collab-list', { role: 'tree', 'aria-label': 'Projets partagés' });
    this.count = h('span.collab-count');
    this.head = h('div.collab-head',
      h('button.collab-toggle', { type: 'button', 'aria-expanded': String(!this.collapsed), onClick: () => this.toggle() },
        h('span.tree-chevron', { html: icon(this.collapsed ? 'chevron-right' : 'chevron-down', 14) }), h('span', 'Projets partagés'), this.count),
      iconButton('plus', 'Créer ou rejoindre un projet partagé', (event) => this.addMenu(event)));
    this.el = h('section.collab-section', { 'data-collapsed': this.collapsed ? '1' : '' }, this.head, this.list);
    explorerEl.append(this.el);
    for (const name of ['collab-list', 'collab-files', 'collab-status', 'collab-open']) bus.on(name, () => this.renderSoon());
    bus.on('active-view', () => this.markActive());
    setInterval(() => { if (collab.projects.size) this.renderSoon(); }, 15000);
  },
  // Projects left expanded last time open again.
  start() {
    this.render();
    for (const id of this.open) if (collab.known(id)) collab.open(id).catch(() => {});
  },
  toggle() {
    this.collapsed = !this.collapsed; store.set('collapsed', this.collapsed);
    this.el.dataset.collapsed = this.collapsed ? '1' : '';
    this.head.querySelector('.collab-toggle').setAttribute('aria-expanded', String(!this.collapsed));
    this.head.querySelector('.tree-chevron').innerHTML = icon(this.collapsed ? 'chevron-right' : 'chevron-down', 14);
  },
  renderSoon() { if (this.frame) return; this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); }); },

  render() {
    const overview = collab.overview;
    const rows = [];
    const account = overview.account || {};
    if (!account.connected || !account.sharedScope) rows.push(this.accountCard(account));
    for (const summary of overview.projects) rows.push(...this.projectRows(summary));
    if (!overview.projects.length && account.connected && account.sharedScope) rows.push(h('div.panel-empty', 'Aucun projet partagé. Créez-en un ou rejoignez celui d’un collègue avec le bouton +.'));
    this.count.textContent = overview.projects.length ? String(overview.projects.length) : '';
    this.list.replaceChildren(...rows);
    this.markActive();
  },
  accountCard(account) {
    if (account.configured === false) return h('div.collab-card', h('p', 'Les projets partagés passent par Google Drive. Configurez la connexion Google dans Paramètres → Intégrations.'));
    const text = account.connected ? 'Pour ouvrir les dossiers que d’autres partagent avec vous, Opale doit pouvoir lire les dossiers partagés de votre Drive (et seulement eux en pratique : Opale ne touche qu’aux dossiers de ses projets).' : 'Les projets partagés passent par votre compte Google : chacun utilise le sien, et le dossier du projet est partagé dans Drive avec les membres.';
    return h('div.collab-card', h('p', text), h('button.btn.small.primary', { type: 'button', onClick: () => this.authorize() }, account.connected ? 'Autoriser les dossiers partagés' : 'Se connecter avec Google'));
  },
  async authorize() {
    try { await api('/api/collab/authorize', { method: 'POST', body: {} }); toast('Terminez la connexion dans la fenêtre du navigateur qui vient de s’ouvrir.'); }
    catch (error) { reportError(error); }
  },

  projectRows(summary) {
    const id = summary.projectId;
    const expanded = this.open.has(id);
    const project = collab.get(id);
    const level = project ? project.level() : 'closed';
    const people = project ? project.participants() : [];
    const role = project ? project.me.role : summary.role;
    const removed = role === 'removed' || summary.state === 'removed';
    const status = h(`span.collab-dot.is-${level}`, { title: project ? this.statusLine(project) : 'Projet fermé : ouvrez-le pour vous connecter aux autres participants.' });
    const faces = people.length ? h('span.collab-mini-faces', { title: people.map((person) => person.name).join(', ') + ' connecté(s)' }, ...people.slice(0, 3).map((person) => h('span.collab-mini-face', { style: `--who:${person.color}` }, initials(person.name)))) : null;
    const row = h(`div.tree-row.folder.collab-project${removed ? '.is-removed' : ''}`, {
      role: 'treeitem', tabIndex: -1, 'aria-expanded': String(expanded), dataset: { project: id }, title: `${summary.name} — projet partagé (${ROLE_NAMES[role] || 'retiré'})`,
      onClick: () => this.toggleProject(id),
      onContextmenu: (event) => { event.preventDefault(); this.projectMenu(event, summary); },
    },
    h('span.tree-chevron', { html: icon(expanded ? 'chevron-down' : 'chevron-right', 14) }),
    h('span.collab-mark', { html: icon('share', 13), title: 'Projet partagé' }),
    h('span.tree-name', summary.name),
    faces, status,
    h('button.collab-row-btn', { type: 'button', title: 'Actions du projet', 'aria-label': 'Actions du projet', html: icon('more', 15), onClick: (event) => { event.stopPropagation(); this.projectMenu(event, summary); } }));
    const rows = [row];
    if (!expanded) return rows;
    if (!project) { rows.push(h('div.collab-hint', { style: 'padding-left:30px' }, collab.opening.has(id) ? 'Ouverture…' : 'Projet fermé.')); return rows; }
    const files = project.files();
    const children = new Map();
    for (const file of files) { const list = children.get(file.parent) || []; list.push(file); children.set(file.parent, list); }
    const walk = (parent, depth) => {
      const list = (children.get(parent) || []).sort((a, b) => (a.kind === 'folder') !== (b.kind === 'folder') ? (a.kind === 'folder' ? -1 : 1) : a.display.localeCompare(b.display, 'fr', { numeric: true }));
      for (const file of list) {
        const folder = file.kind === 'folder';
        const open = this.folders.has(file.id);
        const here = people.filter((person) => person.presence.doc === file.id);
        rows.push(h(`div.tree-row${folder ? '.folder' : '.file'}.collab-file`, {
          role: 'treeitem', tabIndex: -1, dataset: { path: folder ? '' : project.pathOf(file), file: file.id, project: id },
          style: { paddingLeft: `${8 + depth * 16}px` }, title: file.path,
          onClick: () => (folder ? this.toggleFolder(file.id) : app.workspace.openPath(project.pathOf(file))),
          onAuxclick: (event) => { if (event.button === 1 && !folder) app.workspace.openPath(project.pathOf(file), { newTab: true }); },
          onContextmenu: (event) => { event.preventDefault(); this.fileMenu(event, project, file); },
        },
        h('span.tree-chevron', { html: folder ? icon(open ? 'chevron-down' : 'chevron-right', 14) : '' }),
        h('span.tree-name', file.display),
        here.length ? h('span.collab-mini-faces', { title: `${here.map((person) => person.name).join(', ')} ici` }, ...here.slice(0, 3).map((person) => h('span.collab-mini-face', { style: `--who:${person.color}` }, initials(person.name)))) : null,
        file.kind === 'board' ? h('span.tree-ext', 'board') : null));
        if (folder && open) walk(file.id, depth + 1);
      }
    };
    walk('', 1);
    if (!files.length) rows.push(h('div.collab-hint', { style: 'padding-left:30px' }, 'Projet vide.'));
    if (project.removed) rows.push(h('div.collab-hint.is-error', { style: 'padding-left:30px' }, 'Vous n’êtes plus membre : copie locale seulement.'));
    return rows;
  },
  statusLine(project) {
    const s = project.status();
    const parts = [LEVEL_TEXT[project.level()]];
    parts.push(s.peers ? `${s.peers} participant${s.peers > 1 ? 's' : ''} connecté${s.peers > 1 ? 's' : ''}` : 'aucun autre participant connecté');
    if (s.lastSaved) parts.push(`Drive : ${when(s.lastSaved)}`);
    return parts.join(' · ');
  },
  markActive() {
    const view = app.workspace.activeView;
    const path = view && view.path;
    for (const row of this.list.querySelectorAll('.collab-file')) row.classList.toggle('active', !!path && row.dataset.path === path);
  },
  async toggleProject(id) {
    if (this.open.has(id)) { this.open.delete(id); store.set('open', [...this.open]); this.render(); return; }
    this.open.add(id); store.set('open', [...this.open]);
    this.render();
    try { await collab.open(id); } catch (error) { reportError(error); }
    this.render();
  },
  toggleFolder(id) { if (this.folders.has(id)) this.folders.delete(id); else this.folders.add(id); store.set('folders', [...this.folders]); this.render(); },
  reveal(id) {
    if (this.collapsed) this.toggle();
    app.layout.show('left', 'files');
    if (!this.open.has(id)) this.toggleProject(id);
    const row = this.list.querySelector(`.collab-project[data-project="${CSS.escape(id)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  },

  // --------------------------------------------------------------- menus
  addMenu(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    showMenu(rect.left, rect.bottom + 4, [
      { label: 'Créer un projet partagé…', icon: 'plus', run: () => this.create() },
      { label: 'Rejoindre un projet…', icon: 'login', run: () => this.join() },
      'separator',
      { label: 'Réseau et nom de cet ordinateur…', icon: 'settings', run: () => this.network() },
    ]);
  },
  async projectMenu(event, summary) {
    const rect = event.currentTarget.getBoundingClientRect ? event.currentTarget.getBoundingClientRect() : { left: event.clientX, bottom: event.clientY };
    const x = event.clientX || rect.left; const y = event.clientY || rect.bottom;
    let project = collab.get(summary.projectId);
    const ensure = async () => { if (!project) project = await collab.open(summary.projectId); this.open.add(summary.projectId); store.set('open', [...this.open]); return project; };
    const writable = !project || !project.readOnly;
    const role = project ? project.me.role : summary.role;
    showMenu(x, y, [
      { label: 'Nouvelle note', icon: 'file-plus', disabled: !writable, run: async () => this.newFile(await ensure(), 'note', '') },
      { label: 'Nouveau moodboard', icon: 'template', disabled: !writable, run: async () => this.newFile(await ensure(), 'board', '') },
      { label: 'Nouveau dossier', icon: 'folder-plus', disabled: !writable, run: async () => this.newFile(await ensure(), 'folder', '') },
      'separator',
      { label: 'Membres et permissions…', icon: 'users', run: async () => this.members(await ensure()) },
      { label: 'État de la synchronisation…', icon: 'cloud', run: async () => this.status(await ensure()) },
      'separator',
      { label: 'Exporter une copie (Markdown et .canvas)…', icon: 'external', run: () => this.exportCopy(summary) },
      project ? { label: 'Se déconnecter du projet', icon: 'cloud-off', run: () => { collab.close(summary.projectId); this.open.delete(summary.projectId); store.set('open', [...this.open]); this.render(); } } : null,
      { label: 'Supprimer la copie de cet ordinateur…', icon: 'trash', run: () => this.forget(summary) },
      role !== 'owner' && role !== 'removed' ? { label: 'Quitter le projet…', icon: 'x', danger: true, run: () => this.leave(summary) } : null,
    ]);
  },
  fileMenu(event, project, file) {
    const writable = !project.readOnly;
    const folder = file.kind === 'folder';
    showMenu(event.clientX, event.clientY, [
      folder ? { label: 'Nouvelle note ici', icon: 'file-plus', disabled: !writable, run: () => this.newFile(project, 'note', file.id) } : { label: 'Ouvrir dans un nouvel onglet', icon: 'plus', run: () => app.workspace.openPath(project.pathOf(file), { newTab: true }) },
      folder ? { label: 'Nouveau moodboard ici', icon: 'template', disabled: !writable, run: () => this.newFile(project, 'board', file.id) } : null,
      folder ? { label: 'Nouveau dossier ici', icon: 'folder-plus', disabled: !writable, run: () => this.newFile(project, 'folder', file.id) } : null,
      'separator',
      { label: 'Renommer…', icon: 'pencil', disabled: !writable, run: () => this.rename(project, file) },
      { label: 'Déplacer vers…', icon: 'folder', disabled: !writable, run: () => this.move(project, file) },
      'separator',
      { label: 'Supprimer du projet', icon: 'trash', danger: true, disabled: !writable, run: () => {
        project.remove(file.id);
        toast(`« ${file.display} » a été supprimé pour tous les participants.`, { action: { label: 'Annuler', run: () => project.restore(file.id) } });
      } },
    ]);
  },
  async newFile(project, kind, parent) {
    const base = kind === 'folder' ? 'Nouveau dossier' : kind === 'board' ? 'Nouveau moodboard' : 'Sans titre';
    const name = kind === 'note' ? project.uniqueName(parent, base, kind) : await promptText({ title: kind === 'folder' ? 'Nouveau dossier' : 'Nouveau moodboard', label: 'Nom', value: project.uniqueName(parent, base, kind) });
    if (!name) return;
    const id = project.createFile(kind, name, parent);
    if (!id) return;
    if (parent) this.folders.add(parent);
    this.open.add(project.id); store.set('open', [...this.open]);
    this.render();
    if (kind !== 'folder') app.workspace.openPath(project.pathOf(project.file(id)), { focusTitle: kind === 'note' });
  },
  async rename(project, file) {
    const name = await promptText({ title: 'Renommer', label: 'Nouveau nom', value: file.name, confirm: 'Renommer', validate: (text) => (!text ? 'Indiquez un nom.' : /[\\/]/.test(text) ? 'Le nom ne peut pas contenir / ni \\.' : '') });
    if (name) project.rename(file.id, name);
  },
  move(project, file) {
    const blocked = new Set([file.id]);
    // A folder cannot go inside itself.
    let grew = true;
    while (grew) { grew = false; for (const item of project.files()) if (item.kind === 'folder' && !blocked.has(item.id) && blocked.has(item.parent)) { blocked.add(item.id); grew = true; } }
    const targets = [{ id: '', label: 'Racine du projet' }, ...project.files().filter((item) => item.kind === 'folder' && !blocked.has(item.id)).map((item) => ({ id: item.id, label: item.path }))];
    const modal = openModal({
      title: `Déplacer « ${file.display} »`, className: 'modal-small',
      body: h('div.collab-pick', ...targets.map((target) => h(`button.collab-pick-item${target.id === file.parent ? '.is-current' : ''}`, { type: 'button', onClick: () => { project.move(file.id, target.id); modal.close(); } }, h('span', { html: icon('folder', 15) }), target.label))),
    });
  },

  // ------------------------------------------------------------- create
  async create() {
    const overview = await collab.load();
    if (!overview.account.connected || !overview.account.sharedScope) { this.render(); toast('Connectez d’abord votre compte Google (section « Projets partagés »).'); return; }
    const name = await promptText({ title: 'Créer un projet partagé', label: 'Nom du projet', placeholder: 'Ex. : Atelier printemps', confirm: 'Créer', validate: (text) => (!text ? 'Indiquez un nom.' : text.length > 80 ? 'Nom trop long.' : '') });
    if (!name) return;
    const close = toast('Création du dossier du projet dans Drive…', { duration: 20000 });
    try {
      const created = await api('/api/collab/create', { method: 'POST', body: { name } });
      close();
      await collab.load();
      this.open.add(created.projectId); store.set('open', [...this.open]);
      const project = await collab.open(created.projectId);
      this.render();
      const first = project.files().find((file) => file.kind === 'note');
      if (first) app.workspace.openPath(project.pathOf(first));
      this.members(project, true);
    } catch (error) { close(); reportError(error); }
  },

  // --------------------------------------------------------------- join
  async join() {
    const overview = await collab.load();
    if (!overview.account.connected || !overview.account.sharedScope) { this.render(); toast('Connectez d’abord votre compte Google (section « Projets partagés »).'); return; }
    const input = h('input.text-input', { type: 'text', placeholder: 'OPALE-…', spellcheck: false, 'aria-label': 'Code d’invitation' });
    const error = h('p.field-error', { hidden: true });
    const found = h('div.collab-found', h('p.collab-hint', 'Recherche des projets partagés avec vous dans Drive…'));
    const run = async (body, button) => {
      error.hidden = true;
      if (button) button.disabled = true;
      try {
        const joined = await api('/api/collab/join', { method: 'POST', body });
        modal.close();
        await collab.load();
        this.open.add(joined.projectId); store.set('open', [...this.open]);
        await collab.open(joined.projectId);
        this.render();
        toast(`Vous avez rejoint « ${joined.name} ».`);
      } catch (problem) { error.textContent = problem.message; error.hidden = false; if (button) button.disabled = false; }
    };
    const joinButton = h('button.btn.primary', { type: 'button', onClick: () => { const code = input.value.trim(); if (!code) { error.textContent = 'Collez le code reçu.'; error.hidden = false; return; } run({ code }, joinButton); } }, 'Rejoindre');
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') joinButton.click(); });
    const modal = openModal({
      title: 'Rejoindre un projet partagé', className: 'modal-small collab-modal',
      body: h('div.form',
        h('label.field-label', 'Code d’invitation reçu'), input, error,
        h('p.collab-hint', 'Le propriétaire ou un administrateur doit d’abord vous avoir invité avec l’adresse de votre compte Google : Drive vous donne alors accès au dossier du projet.'),
        h('h3.collab-subtitle', 'Projets partagés avec vous'), found),
      footer: [h('button.btn', { type: 'button', onClick: () => modal.close() }, 'Annuler'), joinButton],
    });
    input.focus();
    try {
      const { projects } = await api('/api/collab/discover');
      found.replaceChildren(...(projects.length ? projects.map((item) => {
        const button = h('button.btn.small', { type: 'button', onClick: () => run({ projectId: item.projectId, folderId: item.folderId }, button) }, 'Rejoindre');
        return h('div.collab-found-row', h('span.collab-mark', { html: icon('share', 14) }), h('span.collab-found-name', item.name, h('small', ` partagé par ${item.ownerEmail || 'un membre'}`)), button);
      }) : [h('p.collab-hint', 'Aucun nouveau projet partagé avec ce compte pour le moment.')]));
    } catch (problem) { found.replaceChildren(h('p.collab-hint.is-error', problem.message)); }
  },

  // ------------------------------------------------------------ members
  async members(project, fresh = false) {
    let data;
    try { data = await project.refreshMembers(); } catch (error) { data = project.members; reportError(error); }
    const body = h('div.collab-members');
    const modal = openModal({ title: `Membres — ${project.info.name}`, className: 'collab-modal', body, footer: [h('button.btn', { type: 'button', onClick: () => modal.close() }, 'Fermer')] });
    const act = async (path, payload, done) => {
      try { const result = await api(path, { method: 'POST', body: { project: project.id, ...payload } }); if (result && result.driveWarning) toast(result.driveWarning, { kind: 'error', duration: 12000 }); data = await project.refreshMembers(); draw(); if (done) done(result); }
      catch (error) { reportError(error); }
    };
    const online = new Set(project.participants().map((person) => person.id));
    const draw = () => {
      const me = data.me;
      const rows = data.members.map((member) => {
        const editable = data.canManage && member.role !== 'owner' && !member.me && (data.isOwner || !['admin'].includes(member.role));
        const roleControl = editable
          ? h('select.collab-role', { 'aria-label': `Rôle de ${member.email}`, onChange: (event) => act('/api/collab/role', { email: member.email, role: event.target.value }) },
            ...['admin', 'editor', 'reader'].filter((role) => data.isOwner || role !== 'admin').map((role) => h('option', { value: role, selected: role === member.role }, ROLE_NAMES[role])))
          : h('span.collab-role-label', ROLE_NAMES[member.role] || member.role);
        const connected = member.devices.some((device) => online.has(device.deviceId) || (device.me));
        const devices = member.devices.map((device) => h(`div.collab-device${device.revoked ? '.is-revoked' : ''}`,
          h('span', `${device.name || 'Ordinateur'}${device.me ? ' (cet ordinateur)' : ''}`),
          h('small', device.revoked ? 'révoqué' : online.has(device.deviceId) ? 'connecté maintenant' : device.me ? 'vous' : 'hors ligne'),
          !device.revoked && !device.me && (member.me || data.isOwner || (data.canManage && !['owner', 'admin'].includes(member.role)))
            ? h('button.btn.small', { type: 'button', onClick: async () => { if (await confirmDialog({ title: 'Révoquer cet appareil', message: `« ${device.name || 'Cet ordinateur'} » ne pourra plus se connecter à ce projet ni y envoyer de modifications. La copie qu’il a déjà gardée ne peut pas être effacée à distance.`, confirm: 'Révoquer', danger: true })) act('/api/collab/revoke', { device: device.deviceId }); } }, 'Révoquer')
            : null));
        return h('div.collab-member',
          h('span.collab-face.is-static', { style: `--who:${member.me ? project.me.color : '#64748b'}` }, initials(nameOf(member.email))),
          h('div.collab-member-main', h('div.collab-member-name', member.email, member.me ? h('small', ' (vous)') : null, h(`span.collab-online${connected && !member.me ? '.is-on' : ''}`, member.me ? '' : connected ? 'connecté' : 'hors ligne')), h('div.collab-devices', ...devices)),
          roleControl,
          editable ? h('button.btn.small.danger', { type: 'button', onClick: async () => {
            if (await confirmDialog({ title: 'Retirer du projet', message: `${member.email} ne pourra plus se connecter au projet ni lire le dossier dans Drive. Attention : les copies déjà enregistrées sur ses ordinateurs ne peuvent pas être effacées à distance.`, confirm: 'Retirer', danger: true })) act('/api/collab/remove', { email: member.email });
          } }, 'Retirer') : null);
      });
      const invite = data.canManage ? (() => {
        const email = h('input.text-input', { type: 'email', placeholder: 'adresse@gmail.com', 'aria-label': 'Adresse Google de la personne à inviter' });
        const role = h('select.collab-role', { 'aria-label': 'Rôle' }, ...['editor', 'reader', ...(data.isOwner ? ['admin'] : [])].map((value) => h('option', { value }, ROLE_NAMES[value])));
        const button = h('button.btn.primary', { type: 'button', onClick: () => {
          const address = email.value.trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) { toast('Indiquez l’adresse e-mail de son compte Google.'); return; }
          button.disabled = true;
          act('/api/collab/invite', { email: address, role: role.value }, () => { email.value = ''; toast(`Invitation envoyée par Drive. Transmettez aussi le code à ${address}.`); }).finally(() => { button.disabled = false; });
        } }, 'Inviter');
        return h('div.collab-invite', h('h3.collab-subtitle', 'Inviter quelqu’un'), h('div.collab-invite-row', email, role, button),
          h('p.collab-hint', ...Object.entries(ROLE_HELP).flatMap(([key, text]) => [h('b', ROLE_NAMES[key]), ` : ${text}. `])));
      })() : null;
      const code = h('div.collab-code', h('code', data.code), h('button.btn.small', { type: 'button', onClick: () => navigator.clipboard.writeText(data.code).then(() => toast('Code copié')) }, 'Copier'));
      body.replaceChildren(...[
        fresh ? h('p.collab-hint.is-ok', 'Projet créé. Invitez les membres avec l’adresse de leur compte Google, puis envoyez-leur le code ci-dessous.') : null,
        h('p.collab-hint', `Votre rôle : ${ROLE_NAMES[me.role] || 'retiré'}.`),
        ...rows,
        invite,
        h('h3.collab-subtitle', 'Code du projet'), code,
        h('p.collab-hint', 'Le code n’ouvre le projet qu’aux comptes Google invités : le partager seul ne donne aucun accès.'),
        h('p.collab-hint.is-warn', 'Retirer un membre ou révoquer un appareil l’empêche de recevoir la suite et d’envoyer des modifications, mais ne peut pas effacer ce qu’il a déjà copié sur ses ordinateurs.'),
        me.role !== 'owner' && me.role !== 'removed' ? h('button.btn.danger.collab-leave', { type: 'button', onClick: () => { modal.close(); this.leave(project.info); } }, 'Quitter le projet') : null,
      ].filter(Boolean));
    };
    draw();
  },

  // ------------------------------------------------------------- status
  status(project) {
    const body = h('div.collab-status');
    const modal = openModal({ title: `Synchronisation — ${project.info.name}`, className: 'collab-modal', body, footer: [
      h('button.btn', { type: 'button', onClick: () => this.network() }, 'Réseau…'),
      h('button.btn', { type: 'button', onClick: () => api('/api/collab/poll', { method: 'POST', body: { project: project.id } }).then((summary) => { project.info = summary; draw(); }).catch(reportError) }, 'Vérifier Drive maintenant'),
      h('button.btn.primary', { type: 'button', onClick: () => modal.close() }, 'Fermer')] });
    const line = (state, title, detail) => h(`div.collab-state.is-${state}`, h('span.collab-state-icon', { html: icon(state === 'ok' ? 'check' : state === 'error' ? 'alert' : state === 'off' ? 'cloud-off' : 'refresh', 16) }), h('div', h('b', title), h('p', detail)));
    const draw = () => {
      const s = project.status();
      const mesh = project.mesh.describe();
      const peers = project.participants();
      const local = s.local === 'error' ? line('error', 'Enregistré sur cet ordinateur', `Échec de l’enregistrement local : ${s.localError}`)
        : s.local === 'saving' ? line('pending', 'Enregistré sur cet ordinateur', 'Enregistrement en cours…')
          : line('ok', 'Enregistré sur cet ordinateur', 'Toutes vos modifications sont écrites sur le disque de cet ordinateur.');
      const net = !mesh.enabled ? line('off', 'À jour avec les participants connectés', 'Connexions directes désactivées : les modifications passent seulement par Drive (plus lentement), sans curseurs.')
        : !s.peers ? line('off', 'À jour avec les participants connectés', 'Aucun autre participant connecté en ce moment. Les autres recevront vos modifications par Drive.')
          : line(s.peersUpToDate && s.peersHaveMine !== false ? 'ok' : 'pending', 'À jour avec les participants connectés',
            `${peers.map((person) => `${person.name} (${person.device || 'ordinateur'})`).join(', ')} — ${s.peersUpToDate ? 'tout le monde a la même version.' : 'échange en cours…'} Coordinateur des sauvegardes Drive : ${project.coordinatorName() || '—'}.`);
      const driveState = s.drive;
      const drive = ['auth'].includes(driveState) ? line('error', 'Sauvegardé sur Drive', 'La connexion Google a expiré ou a été retirée : reconnectez votre compte. Vos modifications attendent sur cet ordinateur.')
        : driveState === 'access' ? line('error', 'Sauvegardé sur Drive', 'Drive refuse l’accès au dossier du projet (accès retiré ?).')
          : driveState === 'offline' ? line('pending', 'Sauvegardé sur Drive', `Drive est injoignable (réseau coupé ?). ${s.pendingDrive} modification(s) en attente, envoyées dès le retour du réseau.`)
            : driveState === 'error' ? line('error', 'Sauvegardé sur Drive', `Erreur Drive : ${s.driveError}`)
              : s.driveSaved ? line('ok', 'Sauvegardé sur Drive', `Dernier envoi ${when(s.lastSaved)}. Point de sauvegarde complet : ${when(s.lastCheckpoint)}.`)
                : line('pending', 'Sauvegardé sur Drive', `${s.pendingDrive} modification(s) de cet ordinateur en cours d’envoi (par petits lots, toutes les quelques secondes).`);
      const pending = s.onlyHere
        ? line('warn', 'Modifications en attente', `${s.pendingDrive} modification(s) n’existent encore que sur cet ordinateur. Elles sont enregistrées sur son disque, mais si cet ordinateur s’éteint maintenant, les autres ne les recevront qu’à son retour, et elles seront perdues s’il ne revient jamais.`)
        : s.local === 'error' || ['auth', 'access', 'error'].includes(driveState) ? line('error', 'Modifications en attente ou erreur', 'Voir ci-dessus.')
          : s.pendingDrive ? line('pending', 'Modifications en attente', 'Vos dernières modifications sont déjà chez les participants connectés ; Drive les reçoit dans quelques secondes.')
            : line('ok', 'Aucune modification en attente', 'Rien n’est perdu si cet ordinateur s’éteint maintenant.');
      const links = mesh.links.length ? h('ul.collab-links', ...mesh.links.map((link) => { const peer = project.session.peers.get(link.id); return h('li', `${peer && peer.info ? nameOf(peer.info.email) : link.id.slice(0, 8)} : ${link.state === 'connected' ? (link.path === 'relay' ? 'connecté par un relais TURN' : link.path === 'local' ? 'connecté directement (réseau local)' : 'connecté directement') : 'connexion en cours…'}`); })) : null;
      body.replaceChildren(...[local, net, drive, pending,
        links,
        mesh.lastError ? h('p.collab-hint', `Dernier problème de connexion directe : ${mesh.lastError}. Sur un réseau qui bloque les connexions directes, configurez un relais TURN (Réseau…) ; sinon tout passe par Drive.`) : null,
        h('p.collab-hint', 'Les curseurs, sélections et présences ne passent qu’en direct entre ordinateurs : ils ne sont jamais enregistrés dans Drive.')].filter(Boolean));
    };
    draw();
    const off = project.on('status', draw);
    const timer = setInterval(draw, 2000);
    const close = modal.close;
    modal.close = (result) => { off(); clearInterval(timer); close(result); };
  },

  // ------------------------------------------------------------ network
  async network() {
    const overview = await collab.load();
    const net = overview.network || {};
    const name = h('input.text-input', { type: 'text', value: overview.deviceName || '', 'aria-label': 'Nom de cet ordinateur' });
    const stun = h('textarea.text-input.collab-textarea', { rows: 2, spellcheck: false, 'aria-label': 'Serveurs STUN' }, (net.stun || []).join('\n'));
    const turn = (net.turn && net.turn[0]) || {};
    const turnUrl = h('input.text-input', { type: 'text', value: turn.urls || '', placeholder: 'turn:relais.exemple.fr:3478', 'aria-label': 'Adresse du relais TURN' });
    const turnUser = h('input.text-input', { type: 'text', value: turn.username || '', placeholder: 'Identifiant', 'aria-label': 'Identifiant TURN' });
    const turnPass = h('input.text-input', { type: 'password', value: turn.credential || '', placeholder: 'Mot de passe', 'aria-label': 'Mot de passe TURN' });
    const driveOnly = h('input', { type: 'checkbox', checked: !!net.driveOnly });
    const save = async () => {
      try {
        await api('/api/collab/network', { method: 'PUT', body: { deviceName: name.value, stun: stun.value, turn: turnUrl.value.trim() ? [{ urls: turnUrl.value.trim(), username: turnUser.value, credential: turnPass.value }] : [], driveOnly: driveOnly.checked } });
        await collab.load();
        modal.close();
        toast('Réglages enregistrés. Ils s’appliquent aux projets ouverts après reconnexion.');
      } catch (error) { reportError(error); }
    };
    const modal = openModal({
      title: 'Réseau des projets partagés', className: 'collab-modal',
      body: h('div.form',
        h('label.field-label', 'Nom de cet ordinateur (vu par les autres membres)'), name,
        h('p.collab-hint', 'Il n’y a pas de serveur Opale : les ordinateurs se trouvent grâce à de petits fichiers déposés dans le dossier du projet sur Drive, puis se connectent directement, de façon chiffrée. Chaque ordinateur prouve son identité avec une clé propre au projet, vérifiée par les autres.'),
        h('label.field-label', 'Serveurs STUN (un par ligne)'), stun,
        h('p.collab-hint', 'Un serveur STUN indique à chaque ordinateur son adresse vue d’Internet ; il ne voit pas le contenu. Par défaut : les serveurs publics de Google, qui voient donc l’adresse IP des participants. Les autres membres du projet voient aussi ces adresses.'),
        h('label.field-label', 'Relais TURN (facultatif)'), turnUrl, h('div.collab-invite-row', turnUser, turnPass),
        h('p.collab-hint', 'Certains réseaux (entreprise, hôtel, 4G) bloquent les connexions directes. Un relais TURN, fourni par vous ou un hébergeur, fait passer la connexion chiffrée par lui : il ne peut pas lire le contenu. Sans relais, ces ordinateurs restent synchronisés par Drive, avec quelques secondes de délai et sans curseurs.'),
        h('label.collab-check', driveOnly, h('span', 'Ne jamais se connecter directement aux autres ordinateurs (Drive seulement)'))),
      footer: [h('button.btn', { type: 'button', onClick: () => modal.close() }, 'Annuler'), h('button.btn.primary', { type: 'button', onClick: save }, 'Enregistrer')],
    });
  },

  // ---------------------------------------------- copy, leave, forget
  async exportCopy(summary) {
    try {
      const result = await api('/api/collab/export', { method: 'POST', body: { project: summary.projectId } });
      toast(`${result.files} fichier(s) exporté(s) dans ${result.path}`, { action: { label: 'Afficher', run: () => api('/api/collab/reveal', { method: 'POST', body: { path: result.path } }) } });
    } catch (error) { reportError(error); }
  },
  async forget(summary) {
    const ok = await confirmDialog({ title: 'Supprimer la copie de cet ordinateur', message: `La copie de « ${summary.name} » sur cet ordinateur sera effacée. Vous restez membre : le projet sera rechargé depuis Drive à la prochaine ouverture. Les modifications pas encore envoyées seraient perdues.`, confirm: 'Supprimer la copie', danger: true });
    if (!ok) return;
    this.closeTabs(summary.projectId);
    collab.close(summary.projectId);
    try { await api('/api/collab/forget', { method: 'POST', body: { project: summary.projectId } }); this.open.delete(summary.projectId); store.set('open', [...this.open]); await collab.load(); } catch (error) { reportError(error); }
  },
  async leave(summary) {
    const ok = await confirmDialog({ title: 'Quitter le projet', message: `Vous ne serez plus membre de « ${summary.name} » : vous ne recevrez plus les modifications et la copie de cet ordinateur sera effacée. Pour revenir, il faudra une nouvelle invitation.`, confirm: 'Quitter', danger: true });
    if (!ok) return;
    const id = summary.projectId;
    this.closeTabs(id);
    try { await api('/api/collab/leave', { method: 'POST', body: { project: id } }); collab.close(id); this.open.delete(id); store.set('open', [...this.open]); await collab.load(); toast('Vous avez quitté le projet.'); }
    catch (error) { reportError(error); }
  },
  closeTabs(id) {
    for (const tab of [...app.workspace.tabs]) if (tab.view && tab.view.path && tab.view.path.startsWith(`@shared/${id}/`)) app.workspace.closeTab(tab.id);
  },
};

app.collabUi = collabUi;
