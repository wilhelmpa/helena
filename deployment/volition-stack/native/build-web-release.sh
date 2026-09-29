#!/usr/bin/env bash
# Run on the build host. The checkout is read only on Kingston; only the finished archive
# is sent to its incoming directory. Docker executes the build for Kingston's Linux x64 ABI.
set -euo pipefail

sha=${1:-}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo 'usage: build-web-release.sh <full gated sha>' >&2; exit 2; }
command -v docker >/dev/null
command -v ssh >/dev/null
command -v scp >/dev/null
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
server=${VOLITION_BUILD_SERVER:-kingston-server.local}
remote_repo=/srv/volition/source/plan
incoming=agent-work/web-artifacts/incoming
root=${VOLITION_BUILD_ROOT:-$HOME/volition-web-build}
mkdir -p "$root" "$root/cache" "$root/out"
root=$(cd "$root" && pwd)
work=$(mktemp -d "$root/source.XXXXXXXX")
trap 'rm -rf "$work"' EXIT

# Resolve and archive only this commit. Neither operation changes the server repository.
remote_sha=$(ssh -o HostKeyAlias=kingston-server.local "$server" \
  git -C "$remote_repo" rev-parse --verify "$sha^{commit}")
[[ $remote_sha == "$sha" ]] || { echo 'server commit mismatch' >&2; exit 1; }
ssh -o HostKeyAlias=kingston-server.local "$server" \
  git -C "$remote_repo" archive --format=tar "$sha" | tar -xf - -C "$work"
[[ $(shasum -a 256 "$work/bun.lock" | cut -d' ' -f1) == \
   $(ssh -o HostKeyAlias=kingston-server.local "$server" \
     git -C "$remote_repo" show "$sha:bun.lock" | shasum -a 256 | cut -d' ' -f1) ]] || {
  echo 'exported lockfile mismatch' >&2; exit 1;
}

image=volition-web-builder:node24-bun140
docker build --pull=false --platform linux/amd64 -q -t "$image" -f "$here/build-web-release.Dockerfile" "$here" >/dev/null
start=$(date +%s)
docker run --rm --platform linux/amd64 \
  -v "$work:/work" -v "$root/cache:/cache" -v "$root/out:/out" \
  -e BUN_INSTALL_CACHE_DIR=/cache/bun \
  -e VOLITION_BUILD_SHA="$sha" -e VOLITION_BUILD_HOST="$(hostname)" \
  "$image" bash -euo pipefail -c '
    cd /work
    test "$(uname -m)" = x86_64
    bun install --frozen-lockfile
    mkdir -p apps/web/.next/cache
    if test -d /cache/next; then cp -a /cache/next/. apps/web/.next/cache/; fi
    export NEXT_DEPLOYMENT_ID=${VOLITION_BUILD_SHA:0:12}
    export NEXT_TELEMETRY_DISABLED=1 VOLITION_GATED_BUILD=1
    export VOLITION_TURBOPACK_BUILD_CACHE=1
    cd apps/web
    bun run build
    rm -rf /cache/next
    mkdir -p /cache/next
    cp -a .next/cache/. /cache/next/
    cd /work
    python3 deployment/volition-stack/native/web-artifact.py package \
      --tree /work --commit "$VOLITION_BUILD_SHA" --out /out
    printf "container_peak_bytes=%s\n" "$(cat /sys/fs/cgroup/memory.peak 2>/dev/null || echo unknown)"
  '
elapsed=$(($(date +%s) - start))
archive="$root/out/web-${sha:0:12}.tar.gz"
tar -C "$root/out" -czf "$archive" "web-${sha:0:12}"
echo "build_seconds=$elapsed archive=$archive"
ssh -o HostKeyAlias=kingston-server.local "$server" mkdir -p "$incoming"
scp -o HostKeyAlias=kingston-server.local "$archive" "$server:$incoming/"
echo "uploaded $incoming/$(basename "$archive")"
