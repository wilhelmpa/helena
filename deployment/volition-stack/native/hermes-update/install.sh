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
run install -d -m 0770 -o volition-hermes -g "$(id -gn volition-hermes)" /var/lib/volition/hermes/run/helena-update
# The hermes command where Hermes itself looks for it (owner, 2026-09-24: "Hermes muss auf
# Hermes zugreifen können"): the venv as <source>/.venv, Hermes' own layout, and
# ~/.local/bin/hermes in the Hermes user's home, which its shells have on PATH. Without
# them an agent checking its own setup got "hermes: command not found" and `hermes doctor`
# reported a missing entry point.
conf() { python3 -c 'import json,sys; print(json.load(open("/etc/helena/hermes-update.json"))[sys.argv[1]])' "$1"; }
if [ -e /etc/helena/hermes-update.json ]; then
  source_dir=$(conf source)
  venv=$(conf venv)
else
  source_dir=/srv/volition/source/hermes
  venv=/var/lib/volition/hermes/venv
fi
hermes_home=$(getent passwd volition-hermes | cut -d: -f6)
run ln -sfn "$venv" "$source_dir/.venv"
[ -d "$hermes_home/.local/bin" ] || run install -d -m 0700 -o volition-hermes -g "$(id -gn volition-hermes)" "$hermes_home/.local" "$hermes_home/.local/bin"
run ln -sfn "$venv/bin/hermes" "$hermes_home/.local/bin/hermes"
run chown -h volition-hermes:"$(id -gn volition-hermes)" "$hermes_home/.local/bin/hermes"
run systemctl daemon-reload
run systemctl enable --now helena-hermes-update.path
