// Opale keeps its interface code shared. This small adapter is the sole place
// where platform conventions (labels, font stacks and shortcut glyphs) differ.
const hint = String(window.__OPALE_PLATFORM__ || navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase();
const mac = hint.includes('mac');
const linux = !mac && hint.includes('linux');

export const platform = Object.freeze({
  id: mac ? 'macos' : linux ? 'linux' : 'windows',
  isMac: mac,
  isLinux: linux,
  fileManager: mac ? 'Finder' : linux ? 'gestionnaire de fichiers' : 'Explorateur Windows',
  recycleBin: mac ? 'Corbeille' : linux ? 'corbeille du système' : 'corbeille de Windows',
  shortcut(value) {
    const text = String(value || '');
    if (!mac) return text;
    return text.replace(/Ctrl\+Maj\+/g, '⌘⇧').replace(/Ctrl\+Shift\+/g, '⌘⇧').replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/ArrowLeft/g, '←').replace(/ArrowRight/g, '→').replace(/Tab/g, '⇥').replace(/Backspace/g, '⌫');
  },
});

document.documentElement.dataset.platform = platform.id;
