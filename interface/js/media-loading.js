// Shared image loading: reserved space, subtle shimmer and bounded retries.
import { bus } from './core.js';
const waiting = new Set();
let timer;
function later() {
  if (!timer && waiting.size) timer = setTimeout(() => {
    timer = null;
    for (const state of waiting) {
      if (!state.img.isConnected) { waiting.delete(state); continue; }
      if (Date.now() - state.started >= 120000) { state.fail(); continue; }
      if (state.retry && Date.now() >= state.next) state.load();
    }
    later();
  }, 500);
}
bus.on('attachment-ready', ({ id }) => { for (const state of waiting) if (state.src.includes(id) && state.img.isConnected) state.load(); });
export function watchImage(img, { onError } = {}) {
  if (img.dataset.loadingManaged) return;
  img.dataset.loadingManaged = '1';
  const board = img.parentElement?.classList.contains('b-image') ? img.parentElement : null;
  const state = { img, src: img.getAttribute('src') || '', retry: false, next: 0, started: Date.now() };
  const shared = state.src.includes('%40shared') || state.src.includes('@shared');
  const busy = value => { img.classList.toggle('media-loading', value); img.setAttribute('aria-busy', String(value)); board?.classList.toggle('media-loading', value); };
  const ready = () => { busy(false); img.classList.remove('is-broken'); waiting.delete(state); };
  state.fail = () => { busy(false); img.classList.add('is-broken'); img.title = 'Image indisponible. Réessayez après le transfert.'; waiting.delete(state); onError?.(); };
  state.load = () => { state.retry = false; busy(true); img.classList.remove('is-broken'); img.src = state.src + (state.src.includes('?') ? '&' : '?') + `retry=${Date.now()}`; };
  img.addEventListener('load', ready);
  img.addEventListener('error', () => {
    if (shared && Date.now() - state.started < 120000) {
      state.retry = true; state.next = Date.now() + 1500; waiting.add(state); later();
    } else state.fail();
  });
  busy(true);
  if (img.complete && img.naturalWidth) ready();
  else { waiting.add(state); later(); }
}
export async function fetchMedia(url, { signal } = {}) {
  const started = Date.now();
  for (;;) {
    const response = await fetch(url, { signal, cache: 'no-store' });
    if (response.ok) return response;
    if (![425, 503].includes(response.status) || Date.now() - started > 60000) throw new Error('Impossible de charger le fichier. Le transfert peut être encore en cours.');
    await new Promise((resolve, reject) => {
      const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const timer = setTimeout(done, 750);
      const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
  }
}
