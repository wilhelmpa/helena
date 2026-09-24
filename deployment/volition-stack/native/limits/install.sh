#!/bin/sh
# Installs the owner reporter of the plan limits (docs/helena-decisions/provider-limits.md):
# a timer that runs `itsaplan-runner limits-report` as the owner every five minutes, the spool
# it writes into, and the API setting that reads it. Idempotent.
# Usage: sudo ./install.sh --owner <user> [--plan /srv/volition/source/plan] [--dry-run]
#        sudo ./install.sh --remove [--dry-run]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
owner=""
plan=/srv/volition/source/plan
spool_root=/var/lib/helena-limits
spool=$spool_root/reports
api_unit=volition-plan-api.service
remove=0
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --owner) owner=$2; shift 2 ;;
    --plan) plan=$2; shift 2 ;;
    --remove) remove=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
run() { if [ "$DRY_RUN" = 1 ]; then echo "would: $*"; else "$@"; fi; }
[ "$(id -u)" = 0 ] || [ "$DRY_RUN" = 1 ] || { echo "run as root" >&2; exit 1; }

if [ "$remove" = 1 ]; then
  run systemctl disable --now helena-owner-limits.timer || true
  run rm -f /etc/systemd/system/helena-owner-limits.service /etc/systemd/system/helena-owner-limits.timer
  run rm -f /etc/systemd/system/$api_unit.d/helena-limits.conf
  run systemctl daemon-reload
  echo "removed (the spool $spool_root is kept)"
  exit 0
fi

[ -n "$owner" ] || { echo "--owner <user> is required" >&2; exit 2; }
home=$(getent passwd "$owner" | cut -d: -f6)
[ -n "$home" ] || { echo "no such user: $owner" >&2; exit 1; }
group=$(id -gn "$owner")
[ -f "$plan/packages/runner/dist/cli.js" ] || [ "$DRY_RUN" = 1 ] || {
  echo "no runner bundle in $plan (deploy first)" >&2; exit 1; }

render() {
  sed -e "s#@OWNER@#$owner#g" -e "s#@OWNER_GROUP@#$group#g" -e "s#@HOME@#$home#g" \
      -e "s#@PLAN@#$plan#g" -e "s#@SPOOL@#$spool#g" "$1"
}

# The spool: root's folder, the owner's reports inside, readable by the API (numbers only).
run install -d -m 0755 -o root -g root "$spool_root"
run install -d -m 0755 -o "$owner" -g "$group" "$spool"
if [ "$DRY_RUN" = 1 ]; then
  echo "would: write /etc/systemd/system/helena-owner-limits.service"; render "$here/helena-owner-limits.service.in"
  echo "would: write /etc/systemd/system/$api_unit.d/helena-limits.conf"; render "$here/helena-limits-api.conf.in"
else
  render "$here/helena-owner-limits.service.in" > /etc/systemd/system/helena-owner-limits.service
  chmod 0644 /etc/systemd/system/helena-owner-limits.service
  install -m 0644 -o root -g root "$here/helena-owner-limits.timer" /etc/systemd/system/helena-owner-limits.timer
  install -d -m 0755 "/etc/systemd/system/$api_unit.d"
  render "$here/helena-limits-api.conf.in" > "/etc/systemd/system/$api_unit.d/helena-limits.conf"
  chmod 0644 "/etc/systemd/system/$api_unit.d/helena-limits.conf"
fi
run systemctl daemon-reload
run systemctl enable --now helena-owner-limits.timer
echo "installed; restart $api_unit once so it reads the spool, and run"
echo "  sudo systemctl start helena-owner-limits.service"
echo "for a first report."
