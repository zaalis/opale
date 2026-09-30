#!/usr/bin/env bash
# Runs the GTK/WebKit shell headlessly and proves it starts its owned server.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
home="$(mktemp -d "${TMPDIR:-/tmp}/opale-linux-smoke.XXXXXX")"
group=""
cleanup() {
  if [[ -n "$group" ]]; then kill -TERM "-$group" 2>/dev/null || true; fi
  rm -rf "$home"
}
trap cleanup EXIT
command -v xvfb-run >/dev/null || { echo "xvfb-run est requis pour ce smoke test." >&2; exit 1; }
setsid env OPALE_HOME="$home" xvfb-run -a "$root/dist/linux/Opale" >/tmp/opale-linux-smoke.log 2>&1 &
group=$!
for _ in $(seq 1 50); do
  [[ -s "$home/instance.json" ]] && break
  sleep .1
done
[[ -s "$home/instance.json" ]] || { cat /tmp/opale-linux-smoke.log >&2; exit 1; }
grep -Eq '"url"[[:space:]]*:[[:space:]]*"http://127.0.0.1:[0-9]+"' "$home/instance.json"
echo "Linux native smoke OK"
