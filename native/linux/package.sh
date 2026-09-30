#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
version="$(node -p "require('$root/package.json').version")"
arch="$(dpkg --print-architecture 2>/dev/null || uname -m)"
stage="$(mktemp -d "${TMPDIR:-/tmp}/opale-package.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
chmod 755 "$stage"
"$root/native/linux/build.sh"
install -Dm755 "$root/dist/linux/Opale" "$stage/usr/lib/opale/Opale"
install -Dm755 "$root/dist/linux/opale-server" "$stage/usr/lib/opale/opale-server"
install -Dm755 "$root/dist/linux/pickfolder" "$stage/usr/lib/opale/pickfolder"
install -d "$stage/usr/bin"
ln -s ../lib/opale/Opale "$stage/usr/bin/Opale"
install -Dm644 "$root/native/linux/opale.desktop" "$stage/usr/share/applications/opale.desktop"
install -Dm644 "$root/interface/assets/opale.svg" "$stage/usr/share/icons/hicolor/scalable/apps/opale.svg"
install -Dm644 /dev/null "$stage/DEBIAN/control"
cat > "$stage/DEBIAN/control" <<EOF
Package: opale
Version: $version
Section: office
Priority: optional
Architecture: $arch
Depends: libgtk-3-0, libwebkit2gtk-4.0-37 | libwebkit2gtk-4.1-0
Maintainer: Opale
Description: Carnet de notes Markdown local
EOF
dpkg-deb --build "$stage" "$root/dist/Opale_${version}_${arch}.deb"
tar -C "$root/dist/linux" -czf "$root/dist/Opale_${version}_linux-${arch}.tar.gz" Opale opale-server pickfolder opale.svg
echo "Packages in $root/dist"
