#!/usr/bin/env bash
# Runs the gateway's end-to-end check (gateway-e2e.manual.ts) against a real, headed Chromium
# started here like a project browser (its own display, no automation flags), on the test
# site (site.mjs). Needs Xvfb and chromium; everything lives in a scratch directory, which is
# removed afterwards.
#
#   packages/browser-gateway/e2e/run.sh [scratch-dir]   (ports: CDP 19566, site 18566/18567,
#                                                        Helena stand-in 18568, display :93)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=${1:-$(mktemp -d)}
mkdir -p "$work"
cdp=19566 site=18566 frame=18567 display=:93
pids=()
mkdir -p "$work/downloads"
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  sleep 1
  if [[ -z ${KEEP:-} ]]; then rm -rf "$work" 2>/dev/null || { sleep 2; rm -rf "$work"; }; fi
}
trap cleanup EXIT

Xvfb "$display" -screen 0 1600x1000x24 -nolisten tcp >"$work/xvfb.log" 2>&1 &
pids+=($!)
node "$here/site.mjs" "$site" "$frame" >"$work/site.log" 2>&1 &
pids+=($!)
sleep 1
DISPLAY=$display chromium --ozone-platform=x11 --user-data-dir="$work/profile" \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=$cdp \
  --no-first-run --no-default-browser-check --lang=de-DE --window-size=1400,900 \
  "http://127.0.0.1:$site/" >"$work/chromium.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$cdp/json/version" >/dev/null && break
  sleep 0.2
done
cd "$here/.."
status=0
TMPDIR="$work/downloads" bun e2e/gateway-e2e.manual.ts "$cdp" "$site" "$frame" || status=1
# The chain an agent uses: the shim as installed (one file), an MCP client, the router's glue.
bun build src/shim.ts --target=node --format=cjs --outfile "$work/shim.cjs" >/dev/null
TMPDIR="$work/downloads" bun e2e/mcp-e2e.manual.ts "$cdp" "$site" "$work" "$work/shim.cjs" || status=1
exit $status
