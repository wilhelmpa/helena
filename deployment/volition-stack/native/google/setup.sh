#!/usr/bin/env bash
# Keeps gog (Google Workspace CLI) and the tokens of the owner's Google accounts away from
# the agents: its own user volition-google, a root-owned binary, a home only that user can
# read. Moves an existing store from /var/lib/volition/hermes/gog. Idempotent. The home lies
# outside /var/lib/volition, which only the volition group may enter.
#
#   sudo deployment/volition-stack/native/google/setup.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "setup.sh: run with sudo" >&2; exit 1; }

here=$(cd "$(dirname "$0")" && pwd)
old_home=/var/lib/volition/hermes/gog
old_binary=/var/lib/volition/hermes/bin/gog
base=/var/lib/volition-google
home=$base/gog
binary=/usr/local/libexec/volition-gog

if ! id volition-google >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$base" --shell /usr/sbin/nologin volition-google
fi
usermod --home "$base" volition-google
install -d -m 0700 -o volition-google -g volition-google "$base"

# The binary must not stay where the agent user can replace it: the owner runs it via sudo.
if [[ -f $old_binary && ! -f $binary ]]; then
  install -m 0755 -o root -g root "$old_binary" "$binary"
fi
[[ -f $binary ]] || { echo "setup.sh: no gog binary at $binary" >&2; exit 1; }
rm -f "$old_binary"

for previous in "$old_home" /var/lib/volition/google/gog; do
  if [[ -d $previous && ! -e $home ]]; then
    mv "$previous" "$home"
  fi
done
rmdir /var/lib/volition/google 2>/dev/null || true
if [[ -d $home ]]; then
  chown -R volition-google:volition-google "$home"
  chmod -R go-rwx "$home"
fi

install -m 0755 -o root -g root "$here/volition-gog-bridge" /usr/local/libexec/volition-gog-bridge
tmp=$(mktemp)
install -m 0440 "$here/sudoers-gog" "$tmp"
visudo -cf "$tmp" >/dev/null
install -m 0440 -o root -g root "$tmp" /etc/sudoers.d/91-volition-gog
rm -f "$tmp" /etc/sudoers.d/91-volition-gog-claude
echo "setup.sh: gog runs as volition-google from $home"

# The owner's own `gog` command.
owner=${SUDO_USER:-}
if [[ -n $owner && $owner != root ]]; then
  owner_home=$(getent passwd "$owner" | cut -d: -f6)
  install -d -m 0755 -o "$owner" -g "$owner" "$owner_home/.local/bin"
  printf '#!/bin/sh\nexec sudo -n -u volition-google /usr/local/libexec/volition-gog-bridge "$@"\n' >"$owner_home/.local/bin/gog"
  chown "$owner:$owner" "$owner_home/.local/bin/gog"
  chmod 0700 "$owner_home/.local/bin/gog"
fi
