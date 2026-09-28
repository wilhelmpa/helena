#!/bin/sh
# Installs the host side of Helena's update center (docs/helena-decisions/update-center.md):
# the root helper `helena-update` with its path and service units and its config (kept when
# present), a root-owned copy of install-cli-runtimes.sh with its pins, lockfiles and release
# key (the helper runs this copy, never the checkout), the spool the API writes requests
# into, and the API drop-in that points the API at it. Idempotent.
#
# Usage: sudo ./install.sh [--api-user volition-plan] [--api-unit volition-plan-api.service]
#                          [--backups /var/lib/volition/plan/backups] [--dry-run]
#        sudo ./install.sh --refresh [--dry-run]   only the helper and the installer copy
#                                                   (deploy.sh, after they changed)
#        sudo ./install.sh --remove [--dry-run]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
runtimes=$(cd "$here/../runtimes" && pwd)
api_user=volition-plan
api_unit=volition-plan-api.service
backups=/var/lib/volition/plan/backups
spool_root=/var/lib/helena-updates
spool=$spool_root/spool
share=/usr/local/share/helena/runtimes
mode=install
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --api-user) api_user=$2; shift 2 ;;
    --api-unit) api_unit=$2; shift 2 ;;
    --backups) backups=$2; shift 2 ;;
    --refresh) mode=refresh; shift ;;
    --remove) mode=remove; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
run() { if [ "$DRY_RUN" = 1 ]; then echo "would: $*"; else "$@"; fi; }
[ "$(id -u)" = 0 ] || [ "$DRY_RUN" = 1 ] || { echo "run as root" >&2; exit 1; }

copy_programs() {
  run install -m 0755 -o root -g root "$here/helena-update" /usr/local/libexec/helena-update
  run install -m 0644 -o root -g root "$here/host_tools.py" /usr/local/libexec/host_tools.py
  run install -d -m 0755 -o root -g root /usr/local/lib/helena-whisper-update
  for module in whisper_update.py whisper_acceptance.py whisper_ui.py; do
    run install -m 0644 -o root -g root "$here/../local-ai/$module" /usr/local/lib/helena-whisper-update/
  done
  run install -d -m 0770 -o "$api_user" -g "$(id -gn "$api_user")" "$spool/voice-requests"
  # The runtime installer runs as root: its copy, pins, lockfiles and key are root's, so
  # nobody who can write the checkout changes what root executes.
  run install -d -m 0755 -o root -g root "$share" "$share/keys" "$share/npm"
  run install -m 0755 -o root -g root "$runtimes/install-cli-runtimes.sh" "$share/install-cli-runtimes.sh"
  run install -m 0644 -o root -g root "$runtimes/runtimes.json" "$share/runtimes.json"
  for key in "$runtimes"/keys/*; do
    run install -m 0644 -o root -g root "$key" "$share/keys/$(basename "$key")"
  done
  for lock in "$runtimes"/npm/*; do
    name=$(basename "$lock")
    run install -d -m 0755 -o root -g root "$share/npm/$name"
    run install -m 0644 -o root -g root "$lock/package.json" "$lock/package-lock.json" "$share/npm/$name/"
  done
}

if [ "$mode" = remove ]; then
  run systemctl disable --now helena-update.path || true
  run rm -f /etc/systemd/system/helena-update.path /etc/systemd/system/helena-update.service
  run rm -f "/etc/systemd/system/$api_unit.d/helena-updates.conf"
  run rm -f /usr/local/libexec/helena-update
  run systemctl daemon-reload
  echo "removed (kept: $spool_root, /etc/helena/update.json, $share, /var/lib/helena/runtimes)"
  exit 0
fi

if [ "$mode" = refresh ]; then
  [ -x /usr/local/libexec/helena-update ] || { echo "not installed; run install.sh first" >&2; exit 1; }
  copy_programs
  echo "refreshed the helper and the runtime installer"
  exit 0
fi

group=$(id -gn "$api_user")
copy_programs
run install -m 0644 -o root -g root "$here/helena-update.path" /etc/systemd/system/helena-update.path
run install -m 0644 -o root -g root "$here/helena-update.service" /etc/systemd/system/helena-update.service
run install -d -m 0755 -o root -g root /etc/helena
if [ ! -e /etc/helena/update.json ]; then
  run install -m 0644 -o root -g root "$here/update.example.json" /etc/helena/update.json
fi
# The spool: root's folders, the API's request folders inside, the answers root's alone.
run install -d -m 0755 -o root -g root "$spool_root" "$spool" "$spool/status"
run install -d -m 0770 -o "$api_user" -g "$group" "$spool/requests" "$spool/tmp"
# Where upgraded pins live (install-cli-runtimes.sh upgrade). /var/lib/helena itself is left
# as it is (the Hermes update helper keeps it root's alone).
run install -d -m 0755 -o root -g root /var/lib/helena/runtimes
render() { sed -e "s#@SPOOL@#$spool#g" -e "s#@BACKUPS@#$backups#g" "$1"; }
if [ "$DRY_RUN" = 1 ]; then
  echo "would: write /etc/systemd/system/$api_unit.d/helena-updates.conf"; render "$here/helena-update-api.conf.in"
else
  install -d -m 0755 "/etc/systemd/system/$api_unit.d"
  render "$here/helena-update-api.conf.in" > "/etc/systemd/system/$api_unit.d/helena-updates.conf"
  chmod 0644 "/etc/systemd/system/$api_unit.d/helena-updates.conf"
fi
run systemctl daemon-reload
run systemctl enable --now helena-update.path
echo "installed; restart $api_unit once so it sees the spool, then check with"
echo "  sudo /usr/local/libexec/helena-update inventory"
