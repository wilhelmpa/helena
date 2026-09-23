#!/bin/sh
# udev runs this on a DRM hotplug. It restarts the kiosk session when the number of
# connected screens differs from the one the kiosk started with, so plugging in a second
# screen switches to the dual layout; monitors waking up change nothing.
set -eu
connected=0
for status in /sys/class/drm/card*-*/status; do
  [ -r "$status" ] || continue
  [ "$(cat "$status")" = connected ] || continue
  connected=$((connected + 1))
done
running=$(cat /var/lib/plan-kiosk/.kiosk-outputs 2>/dev/null || echo "")
[ "$running" = "$connected" ] && exit 0
exec /usr/bin/systemctl --no-block restart getty@tty1.service
