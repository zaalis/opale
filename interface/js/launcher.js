// Opale — choosing a vault: shown full-screen on first launch, and as a
// window when switching from an open vault.
import { api, app, h, icon, openModal, reportError } from './core.js';

async function switchTo(request) {
  try {
    if (app.workspace && app.workspace.flushAll) await app.workspace.flushAll();
    await request();
    location.reload();
  } catch (error) { reportError(error); }
}

function content(state) {
  const parent = h('input.text-input', { type: 'text', value: state.defaultVaultParent || '', spellcheck: false, 'aria-label': 'Emplacement du nouveau coffre' });
  const name = h('input.text-input', { type: 'text', placeholder: 'Mon coffre', spellcheck: false, 'aria-label': 'Nom du nouveau coffre' });
  const existing = h('input.text-input', { type: 'text', placeholder: 'C:\\Users\\…\\Mes notes', spellcheck: false, 'aria-label': 'Chemin du dossier à ouvrir' });
  const browse = async (input) => {
    try { const picked = await api('/api/pick-folder', { method: 'POST', body: {} }); if (picked.path) input.value = picked.path; return picked.path || ''; }
    catch (error) { reportError(error); return ''; }
  };
  const create = () => {
    if (!name.value.trim()) { name.focus(); return; }
    switchTo(() => api('/api/vault/create', { method: 'POST', body: { name: name.value.trim(), parent: parent.value.trim() } }));
  };
  const open = (path) => switchTo(() => api('/api/vault/open', { method: 'POST', body: { path } }));
  name.addEventListener('keydown', (event) => { if (event.key === 'Enter') create(); });
  existing.addEventListener('keydown', (event) => { if (event.key === 'Enter' && existing.value.trim()) open(existing.value.trim()); });

  const recent = (state.vaults || []).map((vault) => h(`div.vault-item${vault.exists ? '' : '.missing'}${state.vault && state.vault.path === vault.path ? '.current' : ''}`,
    h('button.vault-open', { type: 'button', disabled: !vault.exists || (state.vault && state.vault.path === vault.path), onClick: () => open(vault.path) },
      h('span.vault-item-name', vault.name), h('span.vault-item-path', vault.exists ? vault.path : `${vault.path} — introuvable`)),
    state.vault && state.vault.path === vault.path ? h('span.badge', 'ouvert') : h('button.icon-btn', { type: 'button', title: 'Retirer de la liste (le dossier n’est pas supprimé)', 'aria-label': 'Retirer de la liste', html: icon('x', 15), onClick: async (event) => {
      try { const next = await api('/api/vault/forget', { method: 'POST', body: { path: vault.path } }); event.target.closest('.launcher').replaceWith(content({ ...state, vaults: next.vaults })); } catch (error) { reportError(error); }
    } })));

  return h('div.launcher',
    h('section.launcher-col',
      h('h3', 'Coffres récents'),
      recent.length ? h('div.vault-list', recent) : h('p.launcher-empty', 'Aucun coffre pour le moment. Un coffre est un simple dossier qui contient vos notes.')),
    h('section.launcher-col',
      h('h3', 'Créer un coffre'),
      h('label.field-label', 'Nom'), name,
      h('label.field-label', 'Emplacement'), h('div.inline', parent, h('button.btn', { type: 'button', onClick: () => browse(parent) }, 'Parcourir…')),
      h('button.btn.primary.wide', { type: 'button', onClick: create }, 'Créer le coffre'),
      h('h3', 'Ouvrir un dossier existant'),
      h('p.launcher-hint', 'N’importe quel dossier de fichiers Markdown convient, y compris un coffre Obsidian.'),
      h('div.inline', existing, h('button.btn', { type: 'button', onClick: async () => { const picked = await browse(existing); if (picked) open(picked); } }, 'Parcourir…')),
      h('button.btn.wide', { type: 'button', onClick: () => { if (existing.value.trim()) open(existing.value.trim()); else existing.focus(); } }, 'Ouvrir ce dossier')));
}

export const launcher = {
  // First launch: no vault is open yet.
  showFull(state, root) {
    root.replaceChildren(h('div.launcher-screen',
      h('div.launcher-brand',
        h('div', { html: '<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7dd3fc"/><stop offset=".5" stop-color="#a78bfa"/><stop offset="1" stop-color="#f0abfc"/></linearGradient></defs><path d="M32 4 54 20 46 52 18 52 10 20Z" fill="url(#lg)"/><path d="M32 4 38 24 54 20M38 24 46 52M38 24 24 30 10 20M24 30 18 52M24 30 32 4" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.4" stroke-linejoin="round"/></svg>' }),
        h('h1', 'Opale'), h('p', `Vos notes, reliées entre elles. Version ${state.version}.`)),
      content(state)));
  },
  async open() {
    try {
      const state = await api('/api/state');
      openModal({ title: 'Coffres', className: 'modal-launcher', body: content(state) });
    } catch (error) { reportError(error); }
  },
};

app.launcher = launcher;
