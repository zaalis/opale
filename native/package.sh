#!/bin/bash
# Build distributable Linux artifacts in dist/: a Debian package and tarball.
set -euo pipefail
cd "$(dirname "$0")/.."

bash native/build.sh
VERSION="$(node -p "require('./package.json').version")"
case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ROOT="$STAGE/opale_${VERSION}_${ARCH}"
INSTALL="$ROOT/usr/lib/opale"
mkdir -p "$INSTALL" "$ROOT/usr/bin" "$ROOT/usr/share/applications" "$ROOT/usr/share/icons/hicolor/256x256/apps" "$ROOT/DEBIAN"
install -m 755 dist/opale "$INSTALL/Opale"
install -m 755 dist/opale-pickfolder "$INSTALL/opale-pickfolder"
install -m 755 dist/opale-server "$INSTALL/opale-server"
install -m 644 dist/opale.png "$INSTALL/opale.png"
install -m 644 native/opale.desktop "$ROOT/usr/share/applications/opale.desktop"
install -m 644 native/icons/hicolor/256x256/apps/opale.png "$ROOT/usr/share/icons/hicolor/256x256/apps/opale.png"
ln -s ../lib/opale/Opale "$ROOT/usr/bin/opale"
cat > "$ROOT/DEBIAN/control" <<EOF
Package: opale
Version: $VERSION
Section: office
Priority: optional
Architecture: $ARCH
Depends: libgtk-3-0, libwebkit2gtk-4.0-37 | libwebkit2gtk-4.1-0
Maintainer: zaalis
Description: Carnet de notes Markdown local
 Opale est un carnet de notes local relie par des liens Markdown.
EOF
dpkg-deb --build "$ROOT" "dist/Opale_${VERSION}_${ARCH}.deb"

ARCHIVE="Opale-${VERSION}-linux-${ARCH}"
ARCHIVE_ROOT="$STAGE/$ARCHIVE"
mkdir -p "$ARCHIVE_ROOT"
cp -a "$INSTALL/." "$ARCHIVE_ROOT/"
cp native/opale.desktop "$ARCHIVE_ROOT/"
cp native/icons/hicolor/256x256/apps/opale.png "$ARCHIVE_ROOT/"
tar -C "$STAGE" -czf "dist/Opale_${VERSION}_linux-${ARCH}.tar.gz" "$ARCHIVE"
echo "Packages ready in dist/"
