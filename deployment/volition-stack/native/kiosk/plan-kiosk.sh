#!/bin/sh
# tty1 of the plan-kiosk user: Helena full screen on Kingston's own monitors. cage extends
# one window across all connected outputs; the session script scales them.
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
# The hotplug rule restarts the kiosk only when the number of screens changed.
printf "%s\n" "$connected_outputs" >"$HOME/.kiosk-outputs"
exec /usr/bin/dbus-run-session -- /usr/bin/cage -d -s -m extend -- \
  /usr/local/libexec/volition-plan-kiosk-session "$kiosk_display"
