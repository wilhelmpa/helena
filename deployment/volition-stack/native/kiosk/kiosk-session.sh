#!/bin/sh
# Runs inside cage: scales every output in the compositor, so Chromium renders natively at
# the output's resolution (crisp text and images) instead of being enlarged afterwards.
# Ctrl +/- still zooms the page on top of it.
set -eu
kiosk_display=${1:-single}
scale=${VOLITION_KIOSK_SCALE:-2}
for output in $(/usr/bin/wlr-randr | awk '/^[^ \t]/ { print $1 }'); do
  /usr/bin/wlr-randr --output "$output" --scale "$scale" || true
done
exec /usr/bin/chromium \
  --ozone-platform=wayland \
  --enable-features=WaylandFractionalScaleV1 \
  --kiosk \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --user-data-dir="$HOME/chromium" \
  --app="http://kingston-server.local/?kioskDisplay=$kiosk_display"
