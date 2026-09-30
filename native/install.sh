#!/bin/bash
# Install the current Linux build for the current user, without root access.
set -euo pipefail
cd "$(dirname "$0")/.."
bash native/build.sh

PREFIX="${XDG_DATA_HOME:-$HOME/.local/share}/opale"
BIN="${XDG_BIN_HOME:-$HOME/.local/bin}"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps"
mkdir -p "$PREFIX" "$BIN" "$APPS" "$ICONS"
install -m 755 dist/opale "$PREFIX/Opale"
install -m 755 dist/opale-pickfolder "$PREFIX/opale-pickfolder"
install -m 755 dist/opale-server "$PREFIX/opale-server"
install -m 644 dist/opale.png "$PREFIX/opale.png"
ln -sfn "$PREFIX/Opale" "$BIN/opale"
install -m 644 native/opale.desktop "$APPS/opale.desktop"
install -m 644 native/icons/hicolor/256x256/apps/opale.png "$ICONS/opale.png"
echo "Installed Opale. Ensure $BIN is in PATH, then run: opale"
