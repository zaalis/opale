#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
version="$(node -p "require('./package.json').version")"
out="dist/macos/Opale.app"
rm -rf "$out"
mkdir -p "$out/Contents/MacOS" "$out/Contents/Resources"
swiftc -O -target x86_64-apple-macos12.0 -framework Cocoa -framework WebKit native/macos/main.swift -o "$out/Contents/MacOS/Opale-x64"
swiftc -O -target arm64-apple-macos12.0 -framework Cocoa -framework WebKit native/macos/main.swift -o "$out/Contents/MacOS/Opale-arm64"
lipo -create "$out/Contents/MacOS/Opale-x64" "$out/Contents/MacOS/Opale-arm64" -output "$out/Contents/MacOS/Opale"
rm "$out/Contents/MacOS/Opale-x64" "$out/Contents/MacOS/Opale-arm64"
cp native/macos/Info.plist "$out/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$version" "$out/Contents/Info.plist"
npx --no-install pkg . --targets node22-macos-x64 --no-bytecode --public --output "$out/Contents/Resources/opale-server-x64"
npx --no-install pkg . --targets node22-macos-arm64 --no-bytecode --public --output "$out/Contents/Resources/opale-server-arm64"
lipo -create "$out/Contents/Resources/opale-server-x64" "$out/Contents/Resources/opale-server-arm64" -output "$out/Contents/Resources/opale-server"
rm "$out/Contents/Resources/opale-server-x64" "$out/Contents/Resources/opale-server-arm64"
chmod +x "$out/Contents/MacOS/Opale" "$out/Contents/Resources/opale-server"
if [[ "${1:-}" == "--dmg" ]]; then
  hdiutil create -volname Opale -srcfolder "$out" -ov -format UDZO "dist/Opale-${version}.dmg"
fi
echo "Built $out"
