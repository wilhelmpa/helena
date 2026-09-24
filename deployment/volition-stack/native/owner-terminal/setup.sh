#!/usr/bin/env bash
# Installs the owner terminal: the volition-owner-terminal service (Unix socket,
# runs as wilhelmpa), its nginx location and its signing key. Idempotent -- safe
# to run on every deploy, which is what deployment/.../deploy.sh is expected to
# call it from.
#
#   sudo deployment/volition-stack/native/owner-terminal/setup.sh [--dry-run]
#     [--install-sudo-policy=narrow|legacy-nopasswd]
#
# --dry-run prints what would change without writing, enabling or restarting
# anything, and needs no root.
#
# By default this script never touches /etc/sudoers.d/90-wilhelmpa -- not even
# to overwrite it with identical content. Read 90-wilhelmpa's own comment for
# why: sudo authorizes by Unix account, so the file's blanket NOPASSWD: ALL
# covers this feature's browser terminal exactly as much as it covers SSH
# automation, and the automation's actual command surface is broader than what
# is reviewed and encoded in this repo's 90-wilhelmpa today. Passing
# --install-sudo-policy is a deliberate, separate operational step the
# orchestrator takes only once the owner has turned "sudo in the browser
# terminal asks for a password" on in Home -> Security *and* the automation's
# `sudo -n` command surface has been audited against 90-wilhelmpa's
# Cmnd_Aliases -- never invoked automatically, and not by deploy.sh's call to
# this script.
set -euo pipefail

dry_run=0
sudo_policy=
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --install-sudo-policy=narrow) sudo_policy=narrow ;;
    --install-sudo-policy=legacy-nopasswd) sudo_policy=legacy-nopasswd ;;
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

log "installing the systemd unit"
run install -m 0644 -o root -g root "$here/volition-owner-terminal.service" \
  /etc/systemd/system/volition-owner-terminal.service
run systemctl daemon-reload
run systemctl enable --now volition-owner-terminal.service

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

if [[ -z $sudo_policy ]]; then
  log "sudoers policy: leaving /etc/sudoers.d/90-wilhelmpa untouched (default;" \
    "pass --install-sudo-policy=narrow|legacy-nopasswd to change it deliberately)"
else
  log "installing the sudoers policy ($sudo_policy)"
  sudoers_src="$here/90-wilhelmpa"
  if [[ $sudo_policy == legacy-nopasswd ]]; then
    sudoers_src="$here/90-wilhelmpa.legacy-nopasswd"
  fi
  if [[ $dry_run -eq 1 ]]; then
    /usr/sbin/visudo -cf "$sudoers_src" >/dev/null
    log "[dry-run] $sudoers_src is valid; would install it as /etc/sudoers.d/90-wilhelmpa"
  else
    tmp=$(mktemp)
    install -m 0440 "$sudoers_src" "$tmp"
    /usr/sbin/visudo -cf "$tmp" >/dev/null
    install -m 0440 -o root -g root "$tmp" /etc/sudoers.d/90-wilhelmpa
    rm -f "$tmp"
  fi
fi

log "done ($([[ $dry_run -eq 1 ]] && echo 'dry-run, nothing changed' || echo 'installed'))"
log "repo root: $repo_root"
