#!/bin/bash
set -euo pipefail
export PATH="/opt/opale-node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export NODE_PATH=/opt/opale-validation/node_modules
cd "$(dirname "$0")/.."
mkdir -p artifacts
task=${1:-tests}
if [[ "$task" = packaged-* ]]; then export OPALE_TEST_SERVER="$PWD/dist/opale-server"; task=${task#packaged-}; fi
case "$task" in
 setup) npm ci --no-audit --no-fund; npm install --prefix /opt/opale-validation pptxgenjs --no-audit --no-fund ;;
 tests) npm test ;;
 build) npm run package ;;
 design) node scripts/verify-design-browser.cjs ;;
 native)
   gcc -O2 -Wall -Wno-deprecated-declarations scripts/verify-native.c -o dist/opale-native-test $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.1)
   temp=$(mktemp -d -t opale-native-XXXXXXXX)
   trap 'rm -rf -- "$temp"' EXIT
   export OPALE_HOME="$temp/home" OPALE_NATIVE_TEST_JS="$PWD/scripts/verify-native-page.js"
   export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1
   mkdir -p "$temp/vault"
   export OPALE_TEST_VAULT="$temp/vault" OPALE_NATIVE_SNAPSHOT="$PWD/artifacts/linux-native.png"
   node -e 'const a=require("./lib/appdata");const c=a.loadConfig();c.lastVault=process.env.OPALE_TEST_VAULT;a.saveConfig(c);'
   dbus-run-session -- xvfb-run -a dist/opale-native-test ;;
 update) dbus-run-session -- xvfb-run -a python3 scripts/verify-linux-update.py ;;
 installed-test)
   runtime=$(mktemp -d -t opale-runtime-XXXXXXXX)
   trap 'rm -rf -- "$runtime"' EXIT
   export XDG_RUNTIME_DIR="$runtime" GTK_USE_PORTAL=0
   export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1
   dbus-run-session -- xvfb-run -a python3 scripts/verify-installed.py ;;
 installed)
   dpkg -i dist/Opale_0.2.0_amd64.deb
   export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1
   dbus-run-session -- xvfb-run -a python3 scripts/verify-installed.py ;;
 board) node scripts/verify-board-browser.cjs ;;
 speed) node scripts/verify-collab-speed.cjs ;;
 exports) node scripts/verify-export-documents.cjs ;;
 *) exit 2 ;;
esac
