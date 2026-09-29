#!/usr/bin/env bash
# Installs the web app of the live checkout as a release the web service runs from, so a
# build never changes files the running server reads. The three newest releases are kept;
# to roll back, point `current` at an older one and restart volition-plan-web (deploy.sh
# does that itself when a deployment fails).
#
#   sudo deployment/volition-stack/native/web-release.sh                  build it here
#   sudo deployment/volition-stack/native/web-release.sh --artifact PATH  install a verified
#                                                                         release archive
#
# Building here takes about 12 GB for a few minutes, which the server running Helena, its
# agents and the local models cannot spare; a build made on another machine from the exact
# commit (web-artifact.sh build) is installed instead, and building here stays the fallback.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "web-release.sh: run with sudo" >&2; exit 1; }

artifact=''
force_local_build=0
while (($#)); do
  case $1 in
    --artifact) artifact=${2:?web-release.sh: --artifact needs a path}; shift 2 ;;
    --force-local-build) force_local_build=1; shift ;;
    *) echo "web-release.sh: unknown option $1" >&2; exit 1 ;;
  esac
done

live=/srv/volition/source/plan
web=$live/apps/web
releases=/srv/volition/releases/web
owner=$(stat -c %U "$live")
as_owner() { runuser -u "$owner" -- "$@"; }
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

commit=$(as_owner git -C "$live" rev-parse HEAD)
# The deployment id is the commit: a page still open from an older release notices on
# its next navigation that the server moved on and loads the new release in full,
# instead of asking the new server for code it no longer has and stopping dead. Twelve
# characters, so a build made elsewhere names it the same way.
deployment_id=${commit:0:12}
release=$releases/$(date +%Y%m%d-%H%M%S)-$deployment_id

if [[ -n $artifact ]]; then
  # A build made elsewhere: it must be of this very commit, complete, unaltered, and for
  # this machine (web-artifact.sh verify checks all of it).
  lock_hash=$(sha256sum "$live/bun.lock" | cut -d' ' -f1)
  if [[ -f $artifact ]]; then
    stage=$(mktemp -d)
    trap 'rm -rf "$stage"' EXIT
    python3 "$here/web-artifact.py" archive "$artifact" --commit "$commit" \
      --lockfile-sha256 "$lock_hash" --out "$stage"
    artifact=$stage/web-$deployment_id
  else
    python3 "$here/web-artifact.py" verify "$artifact" --commit "$commit" \
      --lockfile-sha256 "$lock_hash"
  fi
  standalone=$artifact/standalone
  static=$artifact/static
  public=$artifact/public
else
  available_kib=$(awk '/^MemAvailable:|^SwapFree:/ {sum += $2} END {print sum+0}' /proc/meminfo)
  if ((available_kib < 16 * 1024 * 1024)); then
    echo "web-release.sh: WARNING: only $((available_kib / 1024 / 1024)) GiB memory + swap available" >&2
    if ((force_local_build == 0)); then
      echo 'web-release.sh: refusing local build; pass --force-local-build to override' >&2
      exit 1
    fi
  fi
  # The build writes into .next as the checkout's owner. A development server's own
  # .next/dev is left to whoever runs it.
  mkdir -p "$web/.next"
  chown "$owner" "$web/.next" "$web/next-env.d.ts"
  find "$web/.next" -mindepth 1 -maxdepth 1 ! -name dev -exec chown -R "$owner" {} +
  log=$(mktemp)
  if ! systemd-run --scope -p MemoryHigh=10G -p MemoryMax=14G -p CPUWeight=20 \
    --uid="$owner" -- env NEXT_DEPLOYMENT_ID="$deployment_id" \
    VOLITION_GATED_BUILD="${VOLITION_GATED_BUILD:-0}" \
    bash -c "cd '$web' && bun run build" >"$log" 2>&1; then
    tail -40 "$log" >&2
    rm -f "$log"
    exit 1
  fi
  rm -f "$log"
  # The build rewrites this tracked file, which would stop the next fast-forward.
  as_owner git -C "$live" checkout -- apps/web/next-env.d.ts
  standalone=$web/.next/standalone
  static=$web/.next/static
  public=$web/public
fi

install -d -m 0750 -o root -g volition "$releases" "$release"
cp -a "$standalone/." "$release/"
cp -a "$static" "$release/apps/web/.next/static"
# The previous release's chunks stay servable, so a page that was open before this
# deploy can still load what it is about to render until it reloads.
if [[ -d $releases/current/apps/web/.next/static ]]; then
  cp -an "$releases/current/apps/web/.next/static/." "$release/apps/web/.next/static/"
fi
if [[ -d $public ]]; then cp -a "$public" "$release/apps/web/public"; fi
chown -R root:volition "$release"
chmod -R g+rX,g-w,o-rwx "$release"
# Next writes its fetch and image cache next to the server.
install -d -m 0750 -o volition-plan -g volition "$release/apps/web/.next/cache"
ln -sfn "$release" "$releases/current"
find "$releases" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort -r | tail -n +4 | xargs -r rm -rf
echo "web release $release"
