// Opale — Google Drive synchronisation: the Integrations settings, the small
// indicator in the status bar, the conflicts window and the launcher entry.
import { api, app, bus, confirmDialog, h, icon, noteTitle, openModal, reportError, toast } from './core.js';

const DRIVE_LOGO = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M8.2 3h7.6l6.2 10.7h-7.6Z" fill="#fbbc04"/><path d="M2 13.7 5.8 7l3.8 6.7L5.8 20.4Z" fill="#34a853"/><path d="M5.8 20.4 9.6 13.7H22l-3.8 6.7Z" fill="#4285f4"/><path d="m5.8 7 2.4-4 3.8 6.6-2.4 4.1Z" fill="#188038" opacity=".5"/></svg>';
// Above this, a run shows its percentage; below it stays a quiet spinner.
const BIG_FILES = 3;
const BIG_BYTES = 1024 * 1024;
const SPIN_DELAY = 450;

const status = () => app.drive || { account: {} };

function ago(time) {
  if (!time) return 'jamais';
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 45) return 'à l’instant';
  if (seconds < 3600) return `il y a ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `il y a ${Math.round(seconds / 3600)} h`;
  return new Date(time).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
function percent(progress) {
  if (!progress) return 0;
  const ratio = progress.totalBytes > 0 ? progress.doneBytes / progress.totalBytes : progress.totalFiles ? progress.doneFiles / progress.totalFiles : 0;
  return Math.max(0, Math.min(100, Math.floor(ratio * 100)));
}
const isBig = (progress) => !!progress && (progress.totalFiles >= BIG_FILES || progress.totalBytes >= BIG_BYTES);

function row(label, hint, control) {
  return h('div.setting', h('div.setting-text', h('div.setting-label', label), hint ? h('div.setting-hint', hint) : null), h('div.setting-control', control));
}
async function call(route, method = 'POST', body = {}) {
  const result = await api(route, { method, body });
  if (result && result.account) { app.drive = result; bus.emit('sync', result); }
  return result;
}

// ------------------------------------------------------------ status bar
// [ring] 42 %  next to “Enregistré”: shown while files move, quiet otherwise.
function ring() {
  return h('span.sync-ring', { html: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle class="sync-ring-track" cx="8" cy="8" r="6"/><circle class="sync-ring-bar" cx="8" cy="8" r="6" pathLength="100"/></svg>' });
}

const indicator = {
  el: null, spinTimer: null, spinning: false,

  build() {
    this.ring = ring();
    this.icon = h('span.sync-icon');
    this.pct = h('span.sync-pct');
    this.el = h('button.status-item.status-sync', { type: 'button', hidden: true, onClick: () => (status().conflicts || []).length ? syncUi.showConflicts() : app.settings_ui.open('integrations') }, this.ring, this.icon, this.pct);
    bus.on('sync', () => this.update());
    // Keeps “il y a 2 min” true in the tooltip.
    setInterval(() => this.update(), 30000);
    this.update();
    return this.el;
  },

  update() {
    if (!this.el) return;
    const s = status();
    const account = s.account || {};
    const shown = !!(s.linked && (account.connected || s.errorCode === 'auth'));
    this.el.hidden = !shown;
    if (!shown) return;
    const conflicts = (s.conflicts || []).length;
    const moving = s.phase === 'syncing' && s.progress && s.progress.totalFiles > 0;
    // A short run never shows a spinner: only one that lasts.
    if (moving && !this.spinning && !this.spinTimer) this.spinTimer = setTimeout(() => { this.spinTimer = null; this.spinning = true; this.update(); }, isBig(s.progress) ? 0 : SPIN_DELAY);
    if (!moving) { clearTimeout(this.spinTimer); this.spinTimer = null; this.spinning = false; }
    const spin = moving && this.spinning;
    const big = spin && isBig(s.progress);
    const value = percent(s.progress);

    this.el.classList.toggle('is-spinning', spin);
    this.el.classList.toggle('is-determinate', big);
    this.el.classList.toggle('warn', !spin && (conflicts > 0 || s.phase === 'error' || !account.connected));
    this.el.classList.toggle('muted', !spin && s.phase === 'offline');
    this.ring.hidden = !spin;
    this.ring.style.setProperty('--sync-progress', String(big ? value : 28));
    this.pct.textContent = big ? `${value} %` : conflicts && !spin ? String(conflicts) : '';
    this.icon.hidden = spin;
    const name = !account.connected ? 'alert' : conflicts ? 'alert' : s.phase === 'error' ? 'alert' : s.phase === 'offline' ? 'cloud-off' : 'cloud-check';
    this.icon.innerHTML = icon(name, 15);

    let title;
    if (!account.connected) title = 'Google Drive : reconnectez le compte (Paramètres → Intégrations)';
    else if (spin) title = `Synchronisation avec Google Drive… ${s.progress.doneFiles}/${s.progress.totalFiles} fichier${s.progress.totalFiles > 1 ? 's' : ''}`;
    else if (conflicts) title = `${conflicts} conflit${conflicts > 1 ? 's' : ''} à examiner — cliquez pour voir`;
    else if (s.phase === 'error') title = `Synchronisation interrompue : ${s.error}`;
    else if (s.phase === 'offline') title = 'Google Drive injoignable — nouvelle tentative automatique';
    else if (!s.enabled) title = 'Synchronisation en pause';
    else title = `Synchronisé avec Google Drive — ${ago(s.lastSync)}`;
    this.el.title = title;
    this.el.setAttribute('aria-label', title);
  },
};

// ------------------------------------------------------------- conflicts
function showConflicts() {
  const body = h('div.sync-conflicts');
  const render = () => {
    const list = status().conflicts || [];
    if (!list.length) { modal.close(); toast('Tous les conflits sont réglés.'); return; }
    body.replaceChildren(
      h('p.setting-note', 'La même note a été modifiée sur deux ordinateurs avant d’avoir pu se synchroniser, aux mêmes endroits. Rien n’est perdu : la version de cet ordinateur est restée à sa place, l’autre a été enregistrée à côté.'),
      ...list.map((item) => h('div.sync-conflict',
        h('div.sync-conflict-text',
          h('div.sync-conflict-name', noteTitle(item.path)),
          h('div.setting-hint', `Modifiée ici et sur ${item.device} · ${new Date(item.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`)),
        h('div.sync-conflict-actions',
          h('button.btn.small', { type: 'button', title: 'Ouvrir les deux versions dans des onglets', onClick: () => { modal.close(); app.workspace.openPath(item.path); app.workspace.openPath(item.copy, { newTab: true }); } }, 'Comparer'),
          h('button.btn.small', { type: 'button', title: 'Supprime la copie (dans la corbeille du coffre)', onClick: () => resolve(item, 'mine') }, 'Garder la mienne'),
          h('button.btn.small', { type: 'button', title: `La version de ${item.device} remplace la note`, onClick: () => resolve(item, 'theirs') }, 'Garder l’autre'),
          h('button.btn.small', { type: 'button', title: 'Garde les deux fichiers', onClick: () => resolve(item, 'both') }, 'Les deux')))));
  };
  const resolve = async (item, keep) => { try { await call('/api/drive/resolve', 'POST', { path: item.path, keep }); render(); } catch (error) { reportError(error); } };
  const modal = openModal({ title: 'Conflits de synchronisation', className: 'modal-conflicts', body });
  render();
}

// ------------------------------------------------------------ settings
// Account part: also shown from the launcher, before any vault is open.
function accountBlock(refresh) {
  const s = status(); const account = s.account || {};
  if (!account.configured) return clientSetup(refresh);
  if (!account.connected) {
    return [
      account.pending ? h('div.connection-status', h('span.dot'), 'Une page Google s’est ouverte dans votre navigateur : connectez-vous puis revenez ici.') : null,
      account.error ? h('div.connection-status.warn', account.error) : null,
      s.errorCode === 'auth' && s.error ? h('div.connection-status.warn', s.error) : null,
      row('Compte Google', 'Opale n’accède qu’aux fichiers qu’il a lui-même créés dans votre Drive.',
        h('button.btn.primary', { type: 'button', onClick: async () => { try { await call('/api/drive/connect'); refresh(); } catch (error) { reportError(error); } } }, account.pending ? 'Rouvrir la page Google' : 'Se connecter avec Google')),
      account.builtin ? null : h('p.setting-note', 'Identifiant client : ', h('code', account.clientId), ' — ', h('button.link-btn', { type: 'button', onClick: () => { app.drive = { ...s, account: { ...account, configured: false } }; refresh(); } }, 'changer')),
    ];
  }
  return [
    h('div.connection-status.on', h('span.dot'), `Connecté à Google Drive — ${account.email || 'compte Google'}`),
    row('Déconnecter le compte', 'Arrête la synchronisation de tous les coffres sur cet ordinateur. Les fichiers restent des deux côtés.',
      h('button.btn.small.danger', { type: 'button', onClick: async () => {
        if (!await confirmDialog({ title: 'Déconnecter Google Drive', message: 'Opale n’aura plus accès à votre Drive depuis cet ordinateur. Vos notes restent sur l’ordinateur et dans Drive.', confirm: 'Déconnecter', danger: true })) return;
        try { await call('/api/drive/disconnect'); refresh(); } catch (error) { reportError(error); }
      } }, 'Déconnecter')),
  ];
}

function clientSetup(refresh) {
  const id = h('input.text-input', { type: 'text', placeholder: '…apps.googleusercontent.com', spellcheck: false, 'aria-label': 'Identifiant client' });
  const secret = h('input.text-input', { type: 'password', placeholder: 'GOCSPX-…', spellcheck: false, 'aria-label': 'Code secret du client' });
  const save = async (body) => { try { await call('/api/drive/client', 'PUT', body); refresh(); toast('Client Google enregistré'); } catch (error) { reportError(error); } };
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onChange: async () => { const picked = file.files[0]; if (picked) save({ json: await picked.text() }); file.value = ''; } });
  return [
    h('p.setting-note', 'Cette version d’Opale n’inclut pas de client Google : il faut en créer un (réservé aux développeurs). Dans ', h('strong', 'console.cloud.google.com'), ' :'),
    h('ol.sync-steps',
      h('li', 'Créez un projet, puis ', h('strong', 'API et services → Bibliothèque'), ' : activez ', h('strong', 'Google Drive API'), '.'),
      h('li', h('strong', 'Écran de consentement OAuth'), ' : type « Externe », ajoutez votre adresse comme utilisateur test, puis ', h('strong', 'Publier l’application'), ' (sinon Google coupe l’accès au bout de 7 jours).'),
      h('li', h('strong', 'Identifiants → Créer → ID client OAuth'), ', type ', h('strong', 'Application de bureau'), ', puis téléchargez le fichier JSON.'),
      h('li', 'Importez ce fichier ci-dessous. Le même fichier sert sur tous vos ordinateurs.')),
    row('Fichier du client', 'Le fichier client_secret_….json téléchargé.', h('div.inline', file, h('button.btn.primary', { type: 'button', onClick: () => file.click() }, 'Importer le fichier…'))),
    h('details.tools', h('summary', 'Ou saisir les valeurs à la main'),
      row('Identifiant client', '', id),
      row('Code secret du client', '', secret),
      h('div.inline.sync-manual', h('button.btn.small', { type: 'button', onClick: () => save({ clientId: id.value.trim(), clientSecret: secret.value.trim() }) }, 'Enregistrer'))),
  ];
}

function vaultBlock(refresh) {
  const s = status();
  if (!s.linked) {
    const choice = h('select.select', { 'aria-label': 'Dossier Drive' }, h('option', { value: '' }, `Créer ou retrouver « ${app.vault.name} »`));
    api('/api/drive/vaults').then((result) => {
      const vaults = result.vaults || [];
      for (const item of vaults) choice.append(h('option', { value: item.vaultId }, `Existant : ${item.name}`));
      const key = (name) => String(name || '').normalize('NFC').toLowerCase();
      const matching = vaults.find((item) => key(item.name) === key(app.vault.name));
      if (matching && !choice.value) choice.value = matching.vaultId;
    }).catch(() => {});
    return [
      h('h3.sync-heading', 'Ce coffre'),
      row('Synchroniser ce coffre', 'Le dossier du même nom est réutilisé automatiquement ; vous pouvez aussi choisir un autre coffre Drive.', choice),
      h('div.inline.sync-manual', h('button.btn.primary', { type: 'button', onClick: async (event) => {
        event.target.disabled = true;
        try { await call('/api/drive/link', 'POST', { vaultId: choice.value }); refresh(); toast('Synchronisation activée'); } catch (error) { reportError(error); event.target.disabled = false; }
      } }, 'Activer la synchronisation')),
      h('p.setting-note', 'Si le dossier choisi contient déjà des notes, les deux côtés sont réunis ; une note différente des deux côtés est gardée en deux exemplaires.'),
    ];
  }
  const conflicts = (s.conflicts || []).length;
  const toggleInput = h('input', { type: 'checkbox', checked: !!s.enabled, 'aria-label': 'Synchronisation automatique', onChange: () => call('/api/drive/enabled', 'PUT', { enabled: toggleInput.checked }).then(refresh).catch(reportError) });
  const lastHint = s.errorCode === 'mass-delete' || s.errorCode === 'remote-missing' ? 'En attente de votre décision.' : s.phase === 'error' ? `Interrompue : ${s.error}` : s.phase === 'offline' ? 'Drive injoignable, nouvelle tentative automatique.' : `${s.files} fichier${s.files > 1 ? 's' : ''} suivis · ${ago(s.lastSync)}`;
  return [
    h('h3.sync-heading', 'Ce coffre'),
    row('Dossier dans Drive', `Mon Drive › Opale › ${s.link.name}`, h('span.badge', 'relié')),
    row('Synchronisation automatique', 'Après chaque modification, et toutes les 30 secondes pour les changements des autres ordinateurs.', h('label.switch', toggleInput, h('span.switch-track'))),
    s.errorCode === 'mass-delete' ? h('div.connection-status.warn', h('span', s.error), h('button.btn.small.danger', { type: 'button', onClick: async () => {
      if (!await confirmDialog({ title: 'Confirmer les suppressions', message: 'Les fichiers seront envoyés à la corbeille (celle du coffre ou celle de Drive, où ils restent 30 jours).', confirm: 'Synchroniser', danger: true })) return;
      call('/api/drive/sync', 'POST', { force: true }).catch(reportError);
    } }, 'Confirmer')) : null,
    s.errorCode === 'remote-missing' ? h('div.connection-status.warn', s.error) : null,
    row('Dernière synchronisation', lastHint, h('button.btn.small', { type: 'button', disabled: !s.enabled || s.phase === 'syncing', onClick: () => call('/api/drive/sync').catch(reportError) }, 'Synchroniser maintenant')),
    conflicts ? row('Conflits', `${conflicts} note${conflicts > 1 ? 's' : ''} modifiée${conflicts > 1 ? 's' : ''} sur deux ordinateurs aux mêmes endroits.`, h('button.btn.small', { type: 'button', onClick: showConflicts }, 'Examiner')) : null,
    row('Ne plus synchroniser ce coffre', 'Les fichiers restent sur cet ordinateur et dans Drive.', h('button.btn.small.danger', { type: 'button', onClick: async () => {
      if (!await confirmDialog({ title: 'Arrêter la synchronisation', message: 'Ce coffre ne sera plus relié à Google Drive sur cet ordinateur. Aucun fichier n’est supprimé.', confirm: 'Arrêter', danger: true })) return;
      try { await call('/api/drive/unlink'); refresh(); } catch (error) { reportError(error); }
    } }, 'Délier')),
    h('p.setting-note', `Cet ordinateur s’appelle « ${s.device} » dans Drive. Les dossiers `, h('code', '.opale'), ' et ', h('code', '.trash'), ' restent sur l’ordinateur. Ce qui est supprimé d’un côté va dans la corbeille de l’autre ; Drive garde aussi l’historique des versions de chaque fichier.'),
  ];
}

// Structural changes rebuild the pane; progress only updates it in place.
function shape(s) {
  const account = s.account || {};
  return [account.configured, account.connected, account.pending, account.error, s.linked, s.enabled, (s.conflicts || []).length, s.phase === 'error', s.phase === 'offline'].join('|');
}

function pane() {
  const box = h('div.sync-pane');
  let current = '';
  const refresh = () => {
    if (!box.isConnected && current) { off(); return; }
    const s = status();
    current = shape(s);
    const account = s.account || {};
    box.replaceChildren(
      h('div.sync-card', h('span.sync-logo', { html: DRIVE_LOGO }), h('div', h('div.sync-card-title', 'Google Drive'), h('div.setting-hint', 'Vos notes à jour sur tous vos ordinateurs, et accessibles depuis drive.google.com.'))),
      ...accountBlock(refresh).filter(Boolean),
      ...(account.connected ? vaultBlock(refresh) : []).filter(Boolean));
  };
  const off = bus.on('sync', () => { if (!box.isConnected) { off(); return; } if (shape(status()) !== current) refresh(); });
  api('/api/drive').then((result) => { app.drive = result; refresh(); }).catch(() => refresh());
  refresh();
  return [box];
}

// --------------------------------------------------------------- launcher
// On a new computer: connect, then bring a vault down from Drive.
function launcherSection(state) {
  const box = h('div.sync-launch');
  const draw = () => {
    const s = status(); const account = s.account || {};
    if (!account.connected) {
      box.replaceChildren(h('p.launcher-hint', 'Déjà des notes synchronisées sur un autre ordinateur ?'),
        h('button.btn.wide', { type: 'button', onClick: () => openAccount(draw) }, h('span', { html: DRIVE_LOGO.replace(/26/g, '16') }), 'Connecter Google Drive'));
      return;
    }
    box.replaceChildren(h('p.launcher-hint', `Connecté : ${account.email || 'compte Google'}.`),
      h('button.btn.wide', { type: 'button', onClick: () => pickRemote(state) }, h('span', { html: DRIVE_LOGO.replace(/26/g, '16') }), 'Récupérer un coffre depuis Drive'));
  };
  api('/api/drive').then((result) => { app.drive = result; draw(); }).catch(draw);
  draw();
  return [h('h3', 'Google Drive'), box];
}

function openAccount(done) {
  const body = h('div.sync-pane');
  let timer = 0;
  const refresh = () => {
    body.replaceChildren(...accountBlock(refresh).filter(Boolean));
    clearInterval(timer);
    // No event stream before a vault is open: ask until the browser comes back.
    if ((status().account || {}).pending) timer = setInterval(async () => {
      try { const next = await api('/api/drive'); app.drive = next; if (!next.account.pending || next.account.connected) { clearInterval(timer); refresh(); if (next.account.connected) { modal.close(); done(); } } } catch {}
    }, 1500);
  };
  const modal = openModal({ title: 'Connecter Google Drive', className: 'modal-drive', body, onClose: () => { clearInterval(timer); done(); } });
  refresh();
}

async function pickRemote(state) {
  let vaults;
  try { vaults = (await api('/api/drive/vaults')).vaults; } catch (error) { reportError(error); return; }
  const parent = h('input.text-input', { type: 'text', value: state.defaultVaultParent || '', spellcheck: false, 'aria-label': 'Emplacement' });
  const clone = async (item, button) => {
    button.disabled = true; button.textContent = 'Récupération…';
    try {
      if (app.workspace && app.workspace.flushAll) await app.workspace.flushAll();
      await api('/api/drive/clone', { method: 'POST', body: { vaultId: item.vaultId, parent: parent.value.trim() } });
      location.reload();
    } catch (error) { reportError(error); button.disabled = false; button.textContent = 'Récupérer'; }
  };
  openModal({ title: 'Récupérer depuis Google Drive', className: 'modal-drive', body: h('div.sync-pane',
    vaults.length
      ? h('div.vault-list', vaults.map((item) => {
        const button = h('button.btn.small.primary', { type: 'button', onClick: () => clone(item, button) }, 'Récupérer');
        return h('div.vault-item', h('div.vault-open', h('span.vault-item-name', item.name), h('span.vault-item-path', `Mon Drive › Opale › ${item.name}`)), button);
      }))
      : h('p.launcher-empty', 'Aucun coffre Opale dans ce Drive pour l’instant. Activez la synchronisation sur l’ordinateur qui a vos notes (Paramètres → Intégrations).'),
    h('label.field-label', 'Créer le dossier du coffre dans'), parent,
    h('p.setting-note', 'Les notes arrivent dans un nouveau dossier, puis restent synchronisées.')) });
}

// ------------------------------------------------------- event messages
function onStatus(next) {
  const summary = next.summary;
  app.drive = next;
  bus.emit('sync', next);
  if (!summary) return;
  if (summary.merged.length) toast(summary.merged.length === 1 ? `« ${noteTitle(summary.merged[0])} » modifiée sur deux ordinateurs : versions fusionnées.` : `${summary.merged.length} notes modifiées sur deux ordinateurs : versions fusionnées.`);
  if (summary.conflicts.length) toast(summary.conflicts.length === 1 ? `Conflit sur « ${noteTitle(summary.conflicts[0].path)} » : les deux versions sont gardées.` : `${summary.conflicts.length} conflits : les deux versions sont gardées.`, { kind: 'error', action: { label: 'Voir', run: showConflicts } });
}

export const syncUi = { statusItem: () => indicator.build(), pane, showConflicts, launcherSection, onStatus };
app.sync = syncUi;
