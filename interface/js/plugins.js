// Miro imports are independent local copies. Credentials stay on the server.
import { api, app, h, openModal } from './core.js';
import { store } from './store.js';

function errorWindow(error) {
  let modal;
  const close = h('button.btn.primary', { type: 'button', onClick: () => modal.close() }, 'Compris');
  modal = openModal({ title: 'Miro — opération impossible', className: 'modal-miro-message', body: h('div.miro-message', h('p', { role: 'alert' }, error.message || 'Une erreur est survenue. Réessayez depuis le plugin Miro.'), error.code ? h('p.setting-hint', `Référence : ${error.code}`) : null), footer: close });
  close.focus();
}

async function openImported(path, modal) {
  try {
    await store.load();
    if (!store.has(path)) throw new Error('Le fichier importé n’est plus présent dans ce coffre. Rouvrez le coffre utilisé pour l’import.');
    modal.close();
    if (app.settings_ui.modal) app.settings_ui.modal.close();
    app.workspace.openPath(path, { newTab: true });
  } catch (error) { errorWindow(error); }
}

function resultWindow(result) {
  let modal;
  const warnings = result.warnings || [];
  const body = h('div.miro-message', h('p', `${result.elements} éléments importés et ${result.images} images enregistrées dans le coffre.`), h('p.setting-hint', result.path), warnings.length ? h('div.miro-observations', h('strong', `${warnings.length} observation${warnings.length > 1 ? 's' : ''} à consulter`), h('ul', warnings.slice(0, 5).map((w) => h('li', w.message))), warnings.length > 5 ? h('p', 'Toutes les observations figurent dans le rapport d’import.') : null) : h('p.setting-hint', 'Aucun remplacement nécessaire parmi les éléments reçus de Miro.'), h('p.setting-hint', 'La copie reste indépendante de Miro. Les limites de l’API sont détaillées dans le rapport.'));
  const open = h('button.btn.primary', { type: 'button', onClick: () => openImported(result.path, modal) }, 'Ouvrir le moodboard');
  modal = openModal({ title: warnings.length ? 'Import Miro terminé avec observations' : 'Import Miro terminé', className: 'modal-miro-message', body, footer: [h('button.btn', { type: 'button', onClick: () => openImported(result.report, modal) }, 'Lire le rapport'), open] });
  open.focus();
}

function miroPane(back) {
  let state = null; let busy = false; let boards = []; let cursor = ''; let listed = false;
  let lastAccountError = ''; let handledJob = ''; let ownedJob = ''; let timer; let polling = false;
  const root = h('div.miro-plugin');
  const heading = h('div.plugin-detail-head', h('button.btn', { type: 'button', onClick: back }, '← Plugins'), h('span.miro-wordmark', 'miro'), h('span.setting-hint', 'Importer des moodboards'));
  const connection = h('p.miro-status', { role: 'status', 'aria-live': 'polite' }, 'Chargement du plugin…');
  const clientId = h('input.text-input', { id: 'miro-client-id', inputMode: 'numeric', autocomplete: 'off', required: true });
  const secret = h('input.text-input', { id: 'miro-client-secret', type: 'password', autocomplete: 'new-password', required: true });
  const redirect = h('input.text-input', { id: 'miro-redirect', readOnly: true });
  const copy = h('button.btn', { type: 'button', onClick: async () => {
    try { await navigator.clipboard.writeText(redirect.value); copy.textContent = 'Copié'; setTimeout(() => { copy.textContent = 'Copier'; }, 1600); }
    catch { redirect.select(); errorWindow(new Error('La copie automatique est indisponible. Copiez l’adresse sélectionnée avec Ctrl+C.')); }
  } }, 'Copier');
  const save = h('button.btn', { type: 'submit' }, 'Enregistrer la configuration');
  const configuration = h('details.miro-configuration', { open: true }, h('summary', 'Configuration de l’application Miro'), h('ol.miro-steps',
    h('li', 'Dans Miro, ouvrez Your apps et créez une application dans une Developer team.'),
    h('li', 'Activez uniquement la permission ', h('code', 'boards:read'), ' et copiez le Client ID et le Client secret ici.'),
    h('li', 'Ajoutez exactement l’adresse de redirection ci-dessous dans l’application Miro. Puis enregistrez la configuration.')),
  h('a.link-btn', { href: 'https://miro.com/app/settings/user-profile/apps', target: '_blank', rel: 'noopener noreferrer' }, 'Ouvrir les applications Miro'),
  h('form.miro-form', { onSubmit: (event) => { event.preventDefault(); run(async () => {
    state = await api('/api/miro/client', { method: 'PUT', body: { clientId: clientId.value, clientSecret: secret.value } });
    secret.value = ''; boards = []; listed = false; cursor = ''; lastAccountError = ''; renderBoards(); update();
  }); } }, h('label', { htmlFor: clientId.id }, 'Client ID'), clientId, h('label', { htmlFor: secret.id }, 'Client secret'), secret, h('p.setting-hint', 'Protégés par votre compte Windows et conservés hors du coffre. Le secret ne sera jamais réaffiché.'), h('label', { htmlFor: redirect.id }, 'Adresse de redirection'), h('div.miro-inline', redirect, copy), save));
  const connect = h('button.btn.primary', { type: 'button', onClick: () => run(async () => {
    await api('/api/miro/connect', { method: 'POST', body: {} });
    state = await api('/api/miro'); lastAccountError = ''; update();
  }) }, 'Connecter mon compte Miro');
  const disconnect = h('button.btn', { type: 'button', onClick: () => run(async () => {
    state = await api('/api/miro/disconnect', { method: 'POST', body: {} }); boards = []; listed = false; cursor = ''; renderBoards(); update();
  }) }, 'Déconnecter');
  const boardList = h('select.select', { id: 'miro-board-list', onChange: () => { if (boardList.value) boardUrl.value = boardList.value; update(); } });
  const boardUrl = h('input.text-input', { id: 'miro-board-url', placeholder: 'https://miro.com/app/board/…', autocomplete: 'off', onInput: () => { boardList.value = ''; update(); } });
  const load = h('button.btn', { type: 'button', onClick: () => run(() => loadBoards(false)) }, 'Charger mes tableaux');
  const more = h('button.btn', { type: 'button', hidden: true, onClick: () => run(() => loadBoards(true)) }, 'Voir plus de tableaux');
  const importButton = h('button.btn.primary', { type: 'button', onClick: () => run(async () => {
    const started = await api('/api/miro/import', { method: 'POST', body: { board: boardUrl.value } });
    ownedJob = started.jobId; handledJob = ''; state = await api('/api/miro'); update();
  }) }, 'Importer dans ce coffre');
  const progress = h('progress.miro-progress', { hidden: true, 'aria-label': 'Téléchargement des images' });
  const activity = h('p.miro-activity', { role: 'status', 'aria-live': 'polite' });
  const recent = h('button.btn', { type: 'button', hidden: true, onClick: () => resultWindow(state.import.result) }, 'Consulter le dernier import');
  const imports = h('div.miro-import-section', h('h3', 'Importer un moodboard'), h('p.setting-hint', 'Choisissez un tableau de l’équipe autorisée ou collez son lien. Chaque import crée une nouvelle copie : fichier .canvas, images locales, source et rapport.'), h('div.miro-inline', load, more), h('label', { htmlFor: boardList.id }, 'Tableaux accessibles'), boardList, h('label', { htmlFor: boardUrl.id }, 'Lien ou identifiant du tableau'), boardUrl, h('p.setting-hint', 'Textes, post-it, formes, cadres, images et connexions sont convertis. Les éléments non convertibles sont signalés et remplacés par une carte avec lien Miro.'), importButton, progress, activity, recent);
  root.append(heading, connection, configuration, h('div.miro-inline', connect, disconnect), h('p.setting-hint', 'La connexion s’ouvre dans votre navigateur. Choisissez le compte et l’équipe qui contiennent vos tableaux, puis autorisez l’accès en lecture.'), imports);

  async function run(action) {
    if (busy) return;
    busy = true; update();
    try { await action(); } catch (error) { if (root.isConnected) errorWindow(error); }
    finally { busy = false; if (root.isConnected) update(); }
  }
  async function loadBoards(append) {
    const result = await api(`/api/miro/boards${append && cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
    const next = append ? [...boards, ...result.data] : result.data;
    boards = [...new Map(next.filter((b) => b && typeof b.id === 'string').map((b) => [b.id, b])).values()];
    cursor = result.cursor; listed = true; renderBoards(); update();
  }
  function renderBoards() {
    const selected = boardList.value;
    boardList.replaceChildren(h('option', { value: '' }, listed && !boards.length ? 'Aucun tableau dans cette équipe — vérifiez l’équipe autorisée' : 'Choisir un tableau…'), ...boards.map((board) => h('option', { value: board.id }, board.name || board.id)));
    boardList.value = selected; more.hidden = !cursor;
  }
  function update() {
    const account = state?.account || {}; const job = state?.import; const running = job?.phase === 'running';
    connection.textContent = account.connected ? `Compte Miro connecté · équipe ${account.teamId || 'autorisée'}` : account.pending ? 'Autorisation en cours dans le navigateur…' : account.configured ? 'Application configurée · connectez votre compte Miro.' : 'Configurez l’application Miro pour connecter votre compte.';
    if (state) redirect.value = state.redirectUri;
    if (state && !clientId.value) clientId.value = account.clientId || '';
    for (const control of [save, clientId, secret, connect, disconnect, load, more, boardList, boardUrl]) control.disabled = busy || running;
    connect.disabled ||= !account.configured;
    connect.hidden = !!account.connected; disconnect.hidden = !account.connected;
    load.disabled ||= !account.connected; more.disabled ||= !account.connected;
    boardList.disabled ||= !account.connected; boardUrl.disabled ||= !account.connected;
    importButton.disabled = busy || running || !account.connected || !app.vault || !boardUrl.value.trim();
    importButton.textContent = running ? 'Import en cours…' : 'Importer dans ce coffre';
    activity.textContent = !app.vault ? 'Ouvrez un coffre pour y importer un moodboard.' : job?.message || '';
    progress.hidden = !running;
    recent.hidden = job?.phase !== 'done'; recent.disabled = busy;
    if (running && job.total) { progress.max = job.total; progress.value = job.done; } else progress.removeAttribute('value');
    if (account.error && account.error !== lastAccountError) { lastAccountError = account.error; errorWindow(new Error(account.error)); }
    if (job && job.phase !== 'running' && job.id !== handledJob && (ownedJob === job.id || !ownedJob)) {
      handledJob = job.id;
      if (job.phase === 'error') errorWindow({ message: job.error, code: job.code });
      else if (job.phase === 'done') resultWindow(job.result);
    }
  }
  async function poll() {
    if (!root.isConnected) { clearInterval(timer); return; }
    if (polling || busy) return;
    polling = true;
    try {
      const first = !state; const previous = state?.account?.connected;
      state = await api('/api/miro');
      if (!root.isConnected) return;
      if (first && !ownedJob && state.import) {
        if (state.import.phase === 'running') ownedJob = state.import.id;
        else handledJob = state.import.id;
      }
      if (state.account.connected && !previous) configuration.open = false;
      update();
      if (state.account.connected && !previous && !listed) await run(() => loadBoards(false));
    } catch (error) {
      if (root.isConnected && !lastAccountError) { lastAccountError = error.message; errorWindow(error); }
    } finally { polling = false; }
  }
  renderBoards(); update();
  timer = setInterval(poll, 1200);
  setTimeout(poll, 0);
  return root;
}

export const pluginsUi = {
  pane() {
    const root = h('div.plugins-pane');
    const list = () => {
      root.replaceChildren(h('p.setting-hint', 'Connectez vos outils pour importer leur contenu dans votre coffre.'), h('button.plugin-card', { type: 'button', 'aria-label': 'Miro — importer des moodboards', onClick: () => { root.replaceChildren(miroPane(list)); } }, h('span.miro-wordmark', 'miro'), h('span.plugin-card-copy', h('strong', 'Miro'), h('span', 'Importer des moodboards et leurs images')), h('span.plugin-card-arrow', { 'aria-hidden': 'true' }, '→')));
    };
    list(); return root;
  },
};
