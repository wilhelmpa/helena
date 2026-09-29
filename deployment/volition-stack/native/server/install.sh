#!/bin/sh
# Installs Helena's host helper (helena-hostd): the code, its config (kept when present), the
# socket, the power guard, the backup units, the event hooks of smartd and mdadm, and the
# storage safeguards: NVMe power rules (udev), the guarded ESP copy after package changes
# (apt hook, replaces a hand-made one of the same name) and the boot entry repair at boot.
# Idempotent. Backups are set up by a separate, explicit step (backup-init).
#
#   sudo ./install.sh [--dry-run] [--owner <user>] [--api-user <user>] install
#   sudo ./install.sh [--dry-run] backup-init      password + restic repository + timers
#   sudo ./install.sh status
#   sudo ./install.sh [--dry-run] [--rollback] boot-layout   boot entries onto EFI/debian once
#                                                           (or back); runs the installed helper
#   sudo ./install.sh [--dry-run] [--owner <user>] memory-guards
#   sudo ./install.sh [--dry-run] uninstall        keeps the repository and its password
#
# See README.md and docs/helena-decisions/server-admin.md.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
DRY_RUN=0
owner=
api_user=volition-plan
command=
rollback=
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --rollback) rollback=--rollback ;;
    --owner) owner=$2; shift ;;
    --api-user) api_user=$2; shift ;;
    install|backup-init|status|uninstall|boot-layout|memory-guards) command=$1 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$command" ] || { sed -n '2,15p' "$0"; exit 2; }
run() { if [ "$DRY_RUN" = 1 ]; then echo "would: $*"; else "$@"; fi; }
[ "$(id -u)" = 0 ] || [ "$DRY_RUN" = 1 ] || [ "$command" = status ] || { echo "run as root" >&2; exit 1; }

LIB=/usr/local/lib/helena/hostd
CONF=/etc/helena/hostd.json
UNITS="helena-hostd.socket helena-hostd.service helena-power-guard.service helena-backup.service helena-backup.timer helena-backup-maintenance.service helena-backup-maintenance.timer helena-backup-restore-test.service helena-backup-restore-test.timer helena-boot-entries.service"
UDEV_RULE=/etc/udev/rules.d/60-helena-nvme.rules
APT_HOOK=/etc/apt/apt.conf.d/99helena-esp-sync

write_config() {
  home=
  if [ -n "$owner" ]; then
    home=$(getent passwd "$owner" | cut -d: -f6)
    [ -n "$home" ] || { echo "no such user: $owner" >&2; exit 1; }
  fi
  if [ "$DRY_RUN" = 1 ]; then echo "would: write $CONF (callers $api_user, owner home ${home:-none})"; return; fi
  API_USER="$api_user" OWNER_HOME="$home" python3 -I - "$CONF" <<'PY'
import json, os, sys
path = sys.argv[1]
home = os.environ.get('OWNER_HOME') or None
config = {
    'callers': [os.environ['API_USER']],
    'backup': {
        'ownerHome': home,
        'sqlite': [
            '/var/lib/volition/hermes/state.db',
            '/var/lib/volition/hermes/profiles/*/state.db',
            '/var/lib/volition/hermes/profiles/*/cron/executions.db',
        ],
        'excludes': [
            '*/GPUPersistentCache', '*/.npm/_cacache', '*/.bun/install/cache',
            '/var/lib/volition/project-browser/trash', '/srv/volition/releases', '/srv/volition/trash',
        ],
    },
}
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
with os.fdopen(fd, 'w') as handle:
    json.dump(config, handle, indent=2)
    handle.write('\n')
PY
}

install_code() {
  run install -d -m 0755 -o root -g root /usr/local/lib/helena "$LIB" "$LIB/helena_host"
  run install -m 0755 -o root -g root "$here/hostd/helena-hostd" "$LIB/helena-hostd"
  for file in "$here"/hostd/helena_host/*.py; do
    run install -m 0644 -o root -g root "$file" "$LIB/helena_host/$(basename "$file")"
  done
  run install -m 0755 -o root -g root "$here/hooks/helena-md-event" "$LIB/helena-md-event"
  run install -m 0755 -o root -g root "$here/hooks/helena-esp-sync" "$LIB/helena-esp-sync"
  run install -m 0755 -o root -g root "$here/hooks/helena-nvme-pm" "$LIB/helena-nvme-pm"
  run install -m 0644 -o root -g root "$here/README.md" "$LIB/README.md"
  run install -d -m 0755 -o root -g root /var/lib/volition /var/lib/volition/model-maintenance
  for unit in helena-halogen.service lemond.service helena-embed.service helena-voice-stt.service helena-voice-tts.service helena-ai-preload.service helena-ai-proxy.service helena-voice-stt-proxy.service helena-voice-tts-proxy.service; do
    run install -d -m 0755 "/etc/systemd/system/$unit.d"
    run install -m 0644 "$here/systemd/volition-model-maintenance.conf" "/etc/systemd/system/$unit.d/volition-model-maintenance.conf"
  done
  # Compiled caches from an older copy never shadow the new code (python3 -I writes none).
  run rm -rf "$LIB/helena_host/__pycache__"
}

case "$command" in
memory-guards)
  if [ "$DRY_RUN" = 1 ]; then
    HELENA_DEV_USER=${owner:-${HELENA_DEV_USER:-wilhelmpa}} "$here/memory-guards.sh" --dry-run apply
  else
    HELENA_DEV_USER=${owner:-${HELENA_DEV_USER:-wilhelmpa}} "$here/memory-guards.sh" apply
  fi
  ;;
install)
  getent group helena-hostd >/dev/null || run groupadd --system helena-hostd
  # The API's user reaches the socket through the group (the helper checks the user too).
  if id "$api_user" >/dev/null 2>&1; then
    id -nG "$api_user" | tr ' ' '\n' | grep -qx helena-hostd || run usermod -aG helena-hostd "$api_user"
  else
    echo "warning: API user $api_user does not exist" >&2
  fi
  install_code
  run install -d -m 0755 -o root -g root /etc/helena
  [ -e "$CONF" ] || write_config
  for unit in $UNITS; do
    run install -m 0644 -o root -g root "$here/systemd/$unit" "/etc/systemd/system/$unit"
  done
  # smartd's runner calls every script in run.d; mdadm reads mdadm.conf.d.
  if [ -d /etc/smartmontools/run.d ]; then
    run install -m 0755 -o root -g root "$here/hooks/50helena" /etc/smartmontools/run.d/50helena
  fi
  run install -d -m 0755 -o root -g root /etc/mdadm/mdadm.conf.d
  run install -m 0644 -o root -g root "$here/hooks/mdadm-helena.conf" /etc/mdadm/mdadm.conf.d/helena.conf
  # NVMe power: APST, D3cold and runtime suspend off for every NVMe disk and its PCIe path.
  # Applied now to the matching devices only (nvme controllers, NVMe PCI functions, the
  # nvme_core module), not with a machine-wide trigger.
  run install -m 0644 -o root -g root "$here/hooks/60-helena-nvme.rules" "$UDEV_RULE"
  if command -v udevadm >/dev/null; then
    run udevadm control --reload
    run udevadm trigger --type=subsystems --action=change --subsystem-match=module --sysname-match=nvme_core
    run udevadm trigger --action=change --subsystem-match=nvme
    run udevadm trigger --action=change --subsystem-match=pci --attr-match=class=0x010802
    run udevadm settle --timeout=15 || true
  fi
  # The guarded ESP copy after every package change (same file name as the hand-made hook it
  # replaces, so there is only ever one).
  if [ -d /etc/apt/apt.conf.d ]; then
    run install -m 0644 -o root -g root "$here/hooks/99helena-esp-sync" "$APT_HOOK"
  fi
  run systemctl daemon-reload
  run systemctl enable --now helena-hostd.socket
  # Restarted so a new version of the code is served (the socket keeps listening meanwhile).
  run systemctl try-restart helena-hostd.service
  run systemctl enable helena-power-guard.service
  run systemctl restart helena-power-guard.service
  # Runs at the next boot; not now: check it first with `helena-hostd boot-repair --dry-run`.
  if [ -d /sys/firmware/efi ]; then run systemctl enable helena-boot-entries.service; fi
  if systemctl is-active --quiet mdmonitor.service; then run systemctl restart mdmonitor.service; fi
  echo "helena-hostd installed. The API needs a restart to join the helena-hostd group."
  echo "Boot entries: sudo $LIB/helena-hostd boot-repair --dry-run  (then without --dry-run, or at the next boot)."
  echo "ESP copy:     sudo $LIB/helena-esp-sync --dry-run"
  ;;
backup-init)
  command -v restic >/dev/null || { echo "restic is not installed" >&2; exit 1; }
  run python3 -I "$LIB/helena-hostd" backup init
  echo "Backup ready. The owner writes the password down in Helena: Administrator → Server → Backup."
  echo "First backup: systemctl start helena-backup.service (journalctl -fu helena-backup)."
  ;;
boot-layout)
  # Even the dry run reads the ESPs and debconf: root only. The helper checks and refuses
  # (degraded array, missing ESP) itself; see helena_host/bootlayout.py.
  [ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
  [ -x "$LIB/helena-hostd" ] || { echo "install first: $0 --owner <user> install" >&2; exit 1; }
  if [ "$DRY_RUN" = 1 ]; then
    python3 -I "$LIB/helena-hostd" boot-layout --dry-run $rollback
  else
    python3 -I "$LIB/helena-hostd" boot-layout $rollback
    # The helper serves the config it started with; a rollback wrote an override.
    systemctl try-restart helena-hostd.service
  fi
  ;;
status)
  for unit in $UNITS; do printf '%-40s %s\n' "$unit" "$(systemctl is-active "$unit" 2>/dev/null || true)"; done
  [ -S /run/helena-hostd/hostd.sock ] && echo "socket: /run/helena-hostd/hostd.sock" || echo "socket: missing"
  if [ "$(id -u)" = 0 ] && [ -S /run/helena-hostd/hostd.sock ]; then
    python3 -I "$LIB/helena-hostd" call Capabilities || true
  fi
  ;;
uninstall)
  for unit in helena-backup.timer helena-backup-maintenance.timer helena-backup-restore-test.timer \
              helena-power-guard.service helena-boot-entries.service helena-hostd.service helena-hostd.socket; do
    run systemctl disable --now "$unit" 2>/dev/null || true
  done
  for unit in $UNITS; do run rm -f "/etc/systemd/system/$unit"; done
  run rm -rf /etc/systemd/system/helena-backup.timer.d
  run rm -f /etc/smartmontools/run.d/50helena /etc/mdadm/mdadm.conf.d/helena.conf "$UDEV_RULE" "$APT_HOOK"
  if command -v udevadm >/dev/null; then run udevadm control --reload; fi
  run rm -rf "$LIB"
  run systemctl daemon-reload
  if systemctl is-active --quiet mdmonitor.service; then run systemctl restart mdmonitor.service; fi
  echo "Removed. Kept: /etc/helena/hostd.json, /var/lib/helena/hostd, /etc/helena/backup (password),"
  echo "/var/backups/helena (the repository). Remove those by hand only if the backups are no longer needed."
  echo "The NVMe power values stay until the next boot. The second ESP is no longer copied after"
  echo "package changes: rsync /boot/efi/ to /boot/efi2/ by hand after a grub or shim update."
  ;;
esac
