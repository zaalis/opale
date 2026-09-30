#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
prefix="${PREFIX:-$HOME/.local}"
"$root/native/linux/build.sh"
install -Dm755 "$root/dist/linux/Opale" "$prefix/lib/opale/Opale"
install -Dm755 "$root/dist/linux/opale-server" "$prefix/lib/opale/opale-server"
install -Dm755 "$root/dist/linux/pickfolder" "$prefix/lib/opale/pickfolder"
ln -sfn "$prefix/lib/opale/Opale" "$prefix/bin/Opale"
install -Dm644 "$root/native/linux/opale.desktop" "$prefix/share/applications/opale.desktop"
install -Dm644 "$root/interface/assets/opale.svg" "$prefix/share/icons/hicolor/scalable/apps/opale.svg"
echo "Installed Opale in $prefix"
