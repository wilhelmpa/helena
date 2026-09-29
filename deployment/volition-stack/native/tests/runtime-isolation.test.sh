#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/work"
bun build "$repo/packages/runner/src/cli.ts" --target=node --outfile "$work/cli.js"
bwrap --unshare-user --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
  --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --symlink usr/bin /bin --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$work/work" /work --ro-bind "$work/cli.js" /runner/cli.js \
  --ro-bind "$repo/deployment/volition-stack/native/tests/runtime-isolation.mjs" /fixture.mjs \
  --clearenv --setenv PATH /usr/bin:/bin --setenv HOME /work --setenv FIXTURE_KEY fixture \
  --chdir /work /usr/bin/node /fixture.mjs /runner/cli.js
