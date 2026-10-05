#!/bin/bash
# =====================================================================
#  Builds Opale for macOS into dist/ :
#    Opale.app            native window (Swift + WKWebView) with the packaged server inside
#    Opale-Setup.dmg      universal installation disk image (--universal --dmg)
#    Opale-Setup-x64.dmg  Intel-only installation disk image (--arch x86_64 --dmg)
#
#  Usage:  bash native/build.sh [--arch arm64|x86_64] [--universal] [--dmg]
#    --universal   Apple silicon and Intel in one app (default: this Mac's architecture)
#    --arch        build a separate single-architecture app (useful for separate DMGs)
#    --dmg         also create the disk image
#
#  Requires: a Mac with Xcode or the command line tools (xcode-select --install)
#            and Node.js 18+ (the server is packaged with @yao-pkg/pkg).
# =====================================================================
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then echo "This script builds the macOS app and must run on a Mac." >&2; exit 1; fi
command -v swiftc >/dev/null || { echo "swiftc not found: install the Xcode command line tools (xcode-select --install)." >&2; exit 1; }
command -v node   >/dev/null || { echo "Node.js not found: install it from https://nodejs.org or with Homebrew." >&2; exit 1; }

UNIVERSAL=0; DMG=0; REQUESTED_ARCH=""
while [ "$#" -gt 0 ]; do
  arg="$1"; shift
  case "$arg" in
    --universal) UNIVERSAL=1 ;;
    --dmg) DMG=1 ;;
    --arch)
      [ "$#" -gt 0 ] || { echo "--arch requires arm64 or x86_64." >&2; exit 1; }
      REQUESTED_ARCH="$1"; shift
      case "$REQUESTED_ARCH" in arm64|x86_64) ;; *) echo "Unsupported architecture: $REQUESTED_ARCH (use arm64 or x86_64)." >&2; exit 1 ;; esac
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done
[ "$UNIVERSAL" = 0 ] || [ -z "$REQUESTED_ARCH" ] || { echo "Use either --universal or --arch, not both." >&2; exit 1; }

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
VERSION="$(node -p "require('./package.json').version")"
APP="dist/Opale.app"
MACOS="$APP/Contents/MacOS"
MIN="12.0"

HOST="$(uname -m)"               # arm64 | x86_64
if [ "$UNIVERSAL" = 1 ]; then ARCHS=(arm64 x86_64); elif [ -n "$REQUESTED_ARCH" ]; then ARCHS=("$REQUESTED_ARCH"); else ARCHS=("$HOST"); fi

if [ -n "$REQUESTED_ARCH" ]; then
  APP="dist/Opale-$REQUESTED_ARCH.app"
  if [ "$REQUESTED_ARCH" = "x86_64" ]; then IMAGE="dist/Opale-Setup-x64.dmg"; else IMAGE="dist/Opale-Setup-arm64.dmg"; fi
else
  IMAGE="dist/Opale-Setup.dmg"
fi
MACOS="$APP/Contents/MacOS"

echo "==> Opale — macOS (${ARCHS[*]})"
rm -rf "$APP"
mkdir -p "$MACOS" "$APP/Contents/Resources"

# --- the native shell ------------------------------------------------
echo "==> Compiling the window (Swift)"
SLICES=()
for arch in "${ARCHS[@]}"; do
  out="dist/.Opale-$arch"
  swiftc -O -swift-version 5 -target "$arch-apple-macos$MIN" native/main.swift -o "$out"
  SLICES+=("$out")
done
if [ "${#SLICES[@]}" -gt 1 ]; then lipo -create "${SLICES[@]}" -output "$MACOS/Opale"; else cp "${SLICES[0]}" "$MACOS/Opale"; fi
rm -f "${SLICES[@]}"
chmod +x "$MACOS/Opale"

# --- the packaged server ---------------------------------------------
echo "==> Packaging the server (Node)"
if [ ! -d node_modules/@yao-pkg/pkg ]; then npm install --no-audit --no-fund; fi
for arch in "${ARCHS[@]}"; do
  if [ "$arch" = "arm64" ]; then target="node22-macos-arm64"; name="opale-server-arm64"; else target="node22-macos-x64"; name="opale-server-x64"; fi
  npx --no-install pkg . --targets "$target" --no-bytecode --public --output "$MACOS/$name"
done
# A single-architecture build also gets the plain name the shell falls back to.
if [ "${#ARCHS[@]}" = 1 ]; then
  if [ "${ARCHS[0]}" = "arm64" ]; then cp "$MACOS/opale-server-arm64" "$MACOS/opale-server"; else cp "$MACOS/opale-server-x64" "$MACOS/opale-server"; fi
fi
chmod +x "$MACOS"/opale-server*

# --- the bundle ------------------------------------------------------
cp native/Opale.icns "$APP/Contents/Resources/Opale.icns"
sed "s/@VERSION@/$VERSION/g" native/Info.plist > "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# Ad-hoc signature: enough to run on the Mac that built it (Apple silicon refuses unsigned code).
# Not --deep: the packaged servers keep the signature pkg gave them.
codesign --force --sign - "$APP" >/dev/null 2>&1 || echo "warning: codesign failed; the app may not start on Apple silicon." >&2
echo "==> $APP is ready"

# --- the disk image --------------------------------------------------
if [ "$DMG" = 1 ]; then
  echo "==> Creating the disk image"
  STAGE="dist/.dmg"
  rm -rf "$STAGE"; mkdir -p "$STAGE"
  # The architecture belongs to the DMG filename.  The application itself
  # must always be named Opale.app so Finder never shows “Opale-x86_64”.
  cp -R "$APP" "$STAGE/Opale.app"
  ln -s /Applications "$STAGE/Applications"
  hdiutil create -volname "Opale" -srcfolder "$STAGE" -ov -format UDZO "$IMAGE" >/dev/null
  rm -rf "$STAGE"
  echo "==> $IMAGE is ready"
fi

echo
echo "Done. Open $APP, or drag it to Applications."
echo "Not notarized: if macOS blocks a copy downloaded from elsewhere, right-click the app > Open,"
echo "or run:  xattr -dr com.apple.quarantine \"/Applications/$(basename "$APP")\""
