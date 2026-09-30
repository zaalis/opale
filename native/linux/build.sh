#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

pkg="$(pkg-config --exists webkit2gtk-4.1 && printf webkit2gtk-4.1 || printf webkit2gtk-4.0)"
pkg-config --exists gtk+-3.0 "$pkg" || { echo "Installez build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev." >&2; exit 1; }
mkdir -p dist/linux
cc -O2 -Wall -Wextra -Werror native/linux/opale.c -o dist/linux/Opale $(pkg-config --cflags --libs gtk+-3.0 "$pkg")
cc -O2 -Wall -Wextra -Werror native/linux/pickfolder.c -o dist/linux/pickfolder $(pkg-config --cflags --libs gtk+-3.0)
npx --no-install pkg . --targets node22-linux-x64 --no-bytecode --public --output dist/linux/opale-server
cp interface/assets/opale.svg dist/linux/opale.svg
echo "Built dist/linux/Opale"
