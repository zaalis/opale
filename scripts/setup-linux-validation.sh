#!/bin/bash
set -euo pipefail
mkdir -p /opt/opale-node
cd /tmp
curl -fsS https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o opale-node-shasums
archive=$(grep 'linux-x64.tar.xz$' opale-node-shasums | tr -s ' ' | cut -d ' ' -f2)
curl -fsS "https://nodejs.org/dist/latest-v22.x/$archive" -o "$archive"
grep " $archive$" opale-node-shasums | sha256sum -c -
tar -xJf "$archive" --strip-components=1 -C /opt/opale-node
export PATH=/opt/opale-node/bin:$PATH
node --version
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libreoffice-impress ffmpeg python3-pil > /tmp/opale-linux-extra.log 2>&1
npm install --prefix /opt/opale-validation playwright pdf-lib pdfjs-dist --no-audit --no-fund > /tmp/opale-validation-npm.log 2>&1
/opt/opale-validation/node_modules/.bin/playwright install --with-deps chromium > /tmp/opale-chromium.log 2>&1
echo 'Linux validation dependencies ready'
