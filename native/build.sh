#!/bin/bash
# =====================================================================
#  Builds Opale for Linux into dist/ :
#    opale                native window (C + GTK 3 + WebKitGTK)
#    opale-pickfolder     folder picker (GTK)
#    opale-server         the Node server, packaged with @yao-pkg/pkg (skip with --no-server)
#    opale.png            icon shown when running from the build folder
#
#  Usage:  bash native/build.sh [--no-server]
#
#  Requires: gcc, pkg-config, GTK 3 and WebKitGTK development files, Node.js 18+
#    Debian / Ubuntu : sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev
#    Fedora          : sudo dnf install gcc pkgconf-pkg-config gtk3-devel webkit2gtk4.1-devel
#    Arch            : sudo pacman -S base-devel gtk3 webkit2gtk-4.1
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

WITH_SERVER=1
for arg in "$@"; do
  case "$arg" in
    --no-server) WITH_SERVER=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

command -v gcc >/dev/null        || { echo "gcc not found (install build-essential)." >&2; exit 1; }
command -v pkg-config >/dev/null || { echo "pkg-config not found." >&2; exit 1; }

WEBKIT=""
for candidate in webkit2gtk-4.1 webkit2gtk-4.0; do
  if pkg-config --exists "$candidate"; then WEBKIT="$candidate"; break; fi
done
[ -n "$WEBKIT" ] || { echo "WebKitGTK development files not found (libwebkit2gtk-4.1-dev)." >&2; exit 1; }
pkg-config --exists gtk+-3.0 || { echo "GTK 3 development files not found (libgtk-3-dev)." >&2; exit 1; }
echo "==> Using $WEBKIT"

mkdir -p dist
echo "==> Compiling the window"
gcc -O2 -Wall -Wextra -Wno-deprecated-declarations native/opale.c -o dist/opale $(pkg-config --cflags --libs gtk+-3.0 "$WEBKIT")
echo "==> Compiling the folder picker"
gcc -O2 -Wall -Wno-deprecated-declarations native/pickfolder.c -o dist/opale-pickfolder $(pkg-config --cflags --libs gtk+-3.0)
cp native/icons/hicolor/256x256/apps/opale.png dist/opale.png

if [ "$WITH_SERVER" = 1 ]; then
  command -v node >/dev/null || { echo "Node.js not found (needed to package the server; use --no-server to skip)." >&2; exit 1; }
  echo "==> Packaging the server"
  if [ ! -d node_modules/@yao-pkg/pkg ]; then npm install --no-audit --no-fund; fi
  case "$(uname -m)" in
    aarch64|arm64) TARGET="node22-linux-arm64" ;;
    *)             TARGET="node22-linux-x64" ;;
  esac
  npx --no-install pkg . --targets "$TARGET" --no-bytecode --public --output dist/opale-server
fi

echo
echo "Done. Run it with:  dist/opale"
echo "Make a .deb and a tarball with:  bash native/package.sh     Install for this user with:  bash native/install.sh"
