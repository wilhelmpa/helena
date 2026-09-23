#!/bin/sh
set -eu
umask 077
export XKB_DEFAULT_LAYOUT=de
connected_outputs=0
for status in /sys/class/drm/card*-*/status; do
  [ -r "$status" ] || continue
  [ "$(cat "$status")" = connected ] || continue
  connected_outputs=$((connected_outputs + 1))
done
if [ "$connected_outputs" -ge 2 ]; then
  kiosk_display=dual
else
  kiosk_display=single
fi
exec /usr/bin/dbus-run-session -- /usr/bin/cage -d -s -m extend -- \
  /usr/bin/chromium \
  --ozone-platform=wayland \
  --kiosk \
  --force-device-scale-factor=2 \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --user-data-dir="$HOME/chromium" \
  --app="http://kingston-server.local/?kioskDisplay=$kiosk_display"
