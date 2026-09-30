# Opale pour Linux

L’interface native utilise GTK3 et WebKitGTK ; le même serveur Node et la même interface web sont partagés avec Windows et macOS. Les réglages locaux sont dans `~/.config/Opale` (répertoire `0700`, fichiers `0600`).

```bash
sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev
npm ci
npm run build:linux
npm run package:linux
```

`package.sh` produit un `.deb` et une archive `.tar.gz`. `install.sh` installe pour l’utilisateur sous `~/.local`.

Après une compilation, `xvfb-run bash native/linux/smoke.sh` vérifie que la fenêtre GTK/WebKit démarre le serveur empaqueté dans un affichage virtuel.
