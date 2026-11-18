#!/bin/bash
set -euo pipefail
export PATH=/opt/opale-node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
cd "$(dirname "$0")/.."
test_binary=dist/opale-native-test
if [ "${OPALE_NATIVE_SOURCE:-0}" = 1 ]; then mkdir -p artifacts/native-type-source; test_binary=artifacts/native-type-source/opale-native-test; fi
gcc -O2 -Wall -Wno-deprecated-declarations scripts/verify-native.c -o "$test_binary" $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.1)
task_dir=$(mktemp -d -t opale-typography-native-XXXXXXXX)
trap 'rm -rf -- "$task_dir"' EXIT
export OPALE_HOME="$task_dir/home" OPALE_TEST_VAULT="$task_dir/vault"
export OPALE_NATIVE_TEST_JS="$PWD/scripts/verify-native-typography.js" OPALE_NATIVE_SNAPSHOT="$PWD/artifacts/typography/linux-native.png"
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 GTK_USE_PORTAL=0
mkdir -p "$OPALE_TEST_VAULT" artifacts/typography
node -e 'const a=require("./lib/appdata");const c=a.loadConfig();c.lastVault=process.env.OPALE_TEST_VAULT;a.saveConfig(c);'
dbus-run-session -- xvfb-run -a "$test_binary"
find "$OPALE_TEST_VAULT" -name native-typography.pdf -exec cp '{}' artifacts/typography/linux-native.pdf \;
