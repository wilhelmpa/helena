#!/usr/bin/env bash
# Builds the web app of the live checkout and installs the result as a release the web
# service runs from, so a build never changes files the running server reads. The three
# newest releases are kept; to roll back, point `current` at an older one and restart
# volition-plan-web.
#
#   sudo deployment/volition-stack/native/web-release.sh
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "web-release.sh: run with sudo" >&2; exit 1; }

live=/srv/volition/source/plan
web=$live/apps/web
releases=/srv/volition/releases/web
owner=$(stat -c %U "$live")
as_owner() { runuser -u "$owner" -- "$@"; }

# The build writes into .next as the checkout's owner. A development server's own
# .next/dev is left to whoever runs it.
mkdir -p "$web/.next"
chown "$owner" "$web/.next"
find "$web/.next" -mindepth 1 -maxdepth 1 ! -name dev -exec chown -R "$owner" {} +
log=$(mktemp)
if ! as_owner bash -c "cd '$web' && bun run build" >"$log" 2>&1; then
  tail -40 "$log" >&2
  rm -f "$log"
  exit 1
fi
rm -f "$log"
# The build rewrites this tracked file, which would stop the next fast-forward.
as_owner git -C "$live" checkout -- apps/web/next-env.d.ts

release=$releases/$(date +%Y%m%d-%H%M%S)-$(as_owner git -C "$live" rev-parse --short HEAD)
install -d -m 0750 -o root -g volition "$releases" "$release"
cp -a "$web/.next/standalone/." "$release/"
cp -a "$web/.next/static" "$release/apps/web/.next/static"
if [[ -d $web/public ]]; then cp -a "$web/public" "$release/apps/web/public"; fi
chown -R root:volition "$release"
chmod -R g+rX,g-w,o-rwx "$release"
# Next writes its fetch and image cache next to the server.
install -d -m 0750 -o volition-plan -g volition "$release/apps/web/.next/cache"
ln -sfn "$release" "$releases/current"
find "$releases" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort -r | tail -n +4 | xargs -r rm -rf
echo "web release $release"
