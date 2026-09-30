// Opale — the operating system this build is made for. It is the only file of
// the interface that differs between the macOS, Linux and Windows editions:
// which key is the "primary" modifier, how shortcuts are written, and what the
// file manager and the trash are called.
//
// Shortcuts are stored in one portable spelling — "Ctrl+Maj+F", "Alt+ArrowLeft" —
// where Ctrl means the primary modifier (⌘ on macOS, Ctrl elsewhere), and are
// only translated when shown to the user.
export const PLATFORM = 'linux'; // 'mac' | 'linux'
export const isMac = PLATFORM === 'mac';

// ⌘ on macOS, Ctrl everywhere else. Ctrl-click on a Mac is a right-click and
// Ctrl+letter belongs to the text system, so ⌃ is never the primary modifier there.
export const primary = (event) => (isMac ? event.metaKey : event.ctrlKey);

// Extra Ctrl key that is not the primary one (only meaningful on macOS).
export const secondaryCtrl = (event) => (isMac ? event.ctrlKey : false);

const SYMBOLS = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: '↵', Tab: '⇥', Escape: isMac ? '⎋' : 'Échap', Backspace: '⌫', Delete: isMac ? '⌦' : 'Suppr', Space: 'Espace' };

// "Ctrl+Maj+F" -> "⇧⌘F" (macOS) or "Ctrl+Maj+F" (Linux).
export function keyLabel(combo) {
  if (!combo) return '';
  const parts = String(combo).split('+');
  let key = parts.pop();
  if (key === '' && parts.length) key = '+';
  key = SYMBOLS[key] || key;
  if (!isMac) return [...parts, key].join('+');
  const has = (name) => parts.includes(name);
  return `${has('Control') ? '⌃' : ''}${has('Alt') ? '⌥' : ''}${has('Maj') ? '⇧' : ''}${has('Ctrl') ? '⌘' : ''}${key}`;
}

// Rewrites every shortcut found in a sentence: "Nouvelle note (Ctrl+N)".
const IN_TEXT = /(?:(?:Ctrl|Control|Alt|Maj)\+)+(?:Arrow(?:Left|Right|Up|Down)|Enter|Tab|Backspace|Delete|Space|[A-Za-z0-9,.[\]←→↵])/g;
export const keys = (text) => (typeof text === 'string' && text.includes('+') ? text.replace(IN_TEXT, keyLabel) : text);

// Names of things that differ between systems.
export const TEXT = isMac
  ? { fileManager: 'le Finder', revealVault: 'Afficher le coffre dans le Finder', revealItem: 'Afficher dans le Finder', trash: 'la Corbeille', trashOption: 'Corbeille' }
  : { fileManager: 'le gestionnaire de fichiers', revealVault: 'Afficher le coffre dans le gestionnaire de fichiers', revealItem: 'Afficher dans le gestionnaire de fichiers', trash: 'la corbeille', trashOption: 'Corbeille du système' };

// Shortcuts that are spelled differently on this system than in the portable form.
export const HOTKEY_OVERRIDES = isMac
  ? { 'tab:next': 'Control+Tab', 'tab:previous': 'Control+Maj+Tab', 'nav:back': 'Ctrl+Alt+ArrowLeft', 'nav:forward': 'Ctrl+Alt+ArrowRight' }
  : {};

// Deleting in the file tree: Delete on Windows and Linux keyboards, ⌘⌫ on a Mac (as in Finder).
export const isDeleteKey = (event) => (isMac ? event.key === 'Delete' || (event.key === 'Backspace' && event.metaKey) : event.key === 'Delete');
export const DELETE_HINT = isMac ? 'Ctrl+Backspace' : 'Delete';

// The modifiers of a key event, in the portable spelling used to register shortcuts.
export const modifierPrefix = (event) => (isMac ? `${event.metaKey ? 'Ctrl+' : ''}${event.ctrlKey ? 'Control+' : ''}` : event.ctrlKey ? 'Ctrl+' : '');

// Messages to the native shell, when there is one (window chrome follows the theme).
export function tellShell(message) {
  try {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.opale) window.webkit.messageHandlers.opale.postMessage(message);
  } catch {}
}

document.documentElement.classList.add(`os-${PLATFORM}`);
