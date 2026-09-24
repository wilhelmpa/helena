#!/bin/sh
# udev runs this on a DRM hotplug. It restarts the kiosk session when the number of
# connected screens differs from the one the kiosk started with, so plugging in a second
# screen switches to the dual layout; monitors waking up change nothing.
# During boot the connectors report several hotplugs in a row; restarting on each of them
# ran getty@tty1 into its start limit (2026-09-24). So nothing happens in the first 60 s
# after boot, and a restart is only scheduled once, 3 s later, then checked again.
set -eu
[ "${1:-}" = --now ] || {
  [ "$(cut -d. -f1 /proc/uptime)" -ge 60 ] || exit 0
  exec /usr/bin/systemd-run --quiet --no-block --unit=helena-kiosk-hotplug --on-active=3 \
    /usr/local/libexec/volition-plan-kiosk-hotplug --now 2>/dev/null || exit 0
}
connected=0
for status in /sys/class/drm/card*-*/status; do
  [ -r "$status" ] || continue
  [ "$(cat "$status")" = connected ] || continue
  connected=$((connected + 1))
done
running=$(cat /var/lib/plan-kiosk/.kiosk-outputs 2>/dev/null || echo "")
[ "$running" = "$connected" ] && exit 0
exec /usr/bin/systemctl --no-block restart getty@tty1.service
