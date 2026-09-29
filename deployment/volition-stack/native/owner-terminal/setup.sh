#!/usr/bin/env bash
# Installs the owner terminal: the volition-owner-terminal service (Unix socket,
# runs as wilhelmpa), its nginx location and its signing key. Idempotent -- safe
# to run on every deploy, which is what deployment/.../deploy.sh is expected to
# call it from.
#
#   sudo deployment/volition-stack/native/owner-terminal/setup.sh [--dry-run]
# The sudo policy is installed by hardening/apply.sh sudo-model and changed by hostd.
#
# --dry-run prints what would change without writing, enabling or restarting
# anything, and needs no root.
#
# This installer does not change sudoers.
set -euo pipefail

dry_run=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    *)
      echo "setup.sh: unknown argument: $arg" >&2
      exit 64
      ;;
  esac
done

if [[ $dry_run -eq 0 && $EUID -ne 0 ]]; then
  echo "setup.sh: run with sudo (or pass --dry-run)" >&2
  exit 1
fi

here=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$here/../../../.." && pwd)

log() { echo "setup.sh: $*"; }

# Runs (or, under --dry-run, only prints) a mutating step.
run() {
  if [[ $dry_run -eq 1 ]]; then
    printf 'setup.sh: [dry-run] would run:'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

key_path=/etc/volition/owner-terminal.key
if [[ -f $key_path ]]; then
  log "signing key already present at $key_path, leaving it"
else
  log "generating $key_path"
  if [[ $dry_run -eq 1 ]]; then
    log "[dry-run] would generate a new random key at $key_path (root:volition, 0640)"
  else
    install -d -m 0755 -o root -g root /etc/volition
    umask 077
    openssl rand -hex 32 >"$key_path"
    chown root:volition "$key_path"
    chmod 0640 "$key_path"
  fi
fi

run install -d -m 0750 -o wilhelmpa -g wilhelmpa /var/log/volition/owner-terminal
run chmod +x "$here/owner-terminal-shell"

log "installing the systemd units"
# The sessions' own tmux server first: the router joins it (see helena-owner-tmux.service).
run install -m 0644 -o root -g root "$here/helena-owner-tmux.service" \
  /etc/systemd/system/helena-owner-tmux.service
run install -m 0644 -o root -g root "$here/volition-owner-terminal.service" \
  /etc/systemd/system/volition-owner-terminal.service
run systemctl daemon-reload
# Enabled only: the router's Wants= starts it when the router (re)starts, so the sessions
# move to it at one restart and never split between two servers.
run systemctl enable helena-owner-tmux.service
# Start it only when it is not running: a start of a running unit still pulls in its Wants=,
# which would start helena-owner-tmux next to the router's own tmux server (2026-09-24).
run systemctl enable volition-owner-terminal.service
systemctl is-active --quiet volition-owner-terminal.service || run systemctl start volition-owner-terminal.service

log "installing the nginx snippet"
run install -m 0644 -o root -g root "$here/nginx-owner-terminal.conf" \
  /etc/nginx/snippets/volition-owner-terminal.conf
# The map the snippet reads its client address from (the kiosk port counts as the LAN).
run install -m 0644 -o root -g root "$here/nginx-client-addr.conf" \
  /etc/nginx/conf.d/helena-client-addr.conf
for site in /etc/nginx/sites-available/volition.conf /etc/nginx/sites-enabled/volition-dev.conf; do
  if [[ -f $site ]] && ! grep -q 'volition-owner-terminal.conf' "$site"; then
    log "ACTION NEEDED: $site does not include the owner-terminal snippet yet."
    log "  Add this line inside its server {} block, next to the other tool includes:"
    log "    include /etc/nginx/snippets/volition-owner-terminal.conf;"
    log "  Not done automatically: a bad structural edit to that file would take"
    log "  every embedded tool down, not just this one, so it is a one-line manual step."
  fi
done
if [[ $dry_run -eq 0 ]] && command -v nginx >/dev/null; then
  nginx -t
  systemctl reload nginx
fi

log "done ($([[ $dry_run -eq 1 ]] && echo 'dry-run, nothing changed' || echo 'installed'))"
log "repo root: $repo_root"
