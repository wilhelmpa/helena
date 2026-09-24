#!/bin/sh
# Runs inside cage: scales every output in the compositor, so Chromium renders natively at
# the output's resolution (crisp text and images) instead of being enlarged afterwards,
# and places the outputs left to right in the order the owner set.
# Ctrl +/- still zooms the page on top of it.
set -eu
kiosk_display=${1:-single}
# /etc/default/helena-kiosk may set HELENA_KIOSK_OUTPUTS="DP-3 DP-1" (left to right) and
# HELENA_KIOSK_SCALE; without it the compositor's own order is kept.
[ -r /etc/default/helena-kiosk ] && . /etc/default/helena-kiosk
scale=${HELENA_KIOSK_SCALE:-${VOLITION_KIOSK_SCALE:-2}}
for output in $(/usr/bin/wlr-randr | awk '/^[^ \t]/ { print $1 }'); do
  /usr/bin/wlr-randr --output "$output" --scale "$scale" || true
done
# Left to right: each output starts where the previous one ends, in logical pixels
# (its current mode's width divided by the scale).
x=0
for output in ${HELENA_KIOSK_OUTPUTS:-}; do
  width=$(/usr/bin/wlr-randr | awk -v o="$output" '
    /^[^ \t]/ { current = ($1 == o) }
    current && /current/ { split($1, size, "x"); print size[1]; exit }')
  [ -n "$width" ] || continue
  /usr/bin/wlr-randr --output "$output" --pos "$x,0" || true
  x=$((x + width / ${scale%%.*}))
done
# Helena is plain http on the LAN until Cloudflare puts HTTPS in front of it; browsers
# only lend the microphone (chat dictation) and passkeys to a secure origin, so the
# kiosk treats Helena's own origin as one. Nothing else is affected.
exec /usr/bin/chromium \
  --unsafely-treat-insecure-origin-as-secure=http://kingston-server.local \
  --ozone-platform=wayland \
  --enable-features=WaylandFractionalScaleV1 \
  --kiosk \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --user-data-dir="$HOME/chromium" \
  --app="http://kingston-server.local/?kioskDisplay=$kiosk_display"
