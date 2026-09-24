#!/bin/sh
# Installs the Hermes update helper: the root helper, its path and service units, its config
# (kept when present) and the spool the runner writes requests into. Idempotent.
# Usage: sudo ./install.sh [--dry-run]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
run() { if [ "${DRY_RUN:-0}" = 1 ]; then echo "would: $*"; else "$@"; fi; }
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
[ "$(id -u)" = 0 ] || [ "${DRY_RUN:-0}" = 1 ] || { echo "run as root" >&2; exit 1; }

run install -m 0755 -o root -g root "$here/helena-hermes-update" /usr/local/libexec/helena-hermes-update
run install -m 0644 -o root -g root "$here/helena-hermes-update.path" /etc/systemd/system/helena-hermes-update.path
run install -m 0644 -o root -g root "$here/helena-hermes-update.service" /etc/systemd/system/helena-hermes-update.service
run install -d -m 0755 -o root -g root /etc/helena
if [ ! -e /etc/helena/hermes-update.json ]; then
  run install -m 0644 -o root -g root "$here/hermes-update.example.json" /etc/helena/hermes-update.json
fi
# The copy of the virtual environment an update can go back to, root's alone.
run install -d -m 0700 -o root -g root /var/lib/helena /var/lib/helena/hermes-update
# The runner (volition-hermes) writes requests; the helper (root) writes the status.
run install -d -m 0770 -o volition-hermes -g volition-hermes /var/lib/volition/hermes/run/helena-update
run systemctl daemon-reload
run systemctl enable --now helena-hermes-update.path
