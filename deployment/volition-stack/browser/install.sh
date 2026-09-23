#!/usr/bin/env bash
set -euo pipefail
umask 077

source_root="${BROWSER_PACKAGE_ROOT:-/home/pw/services/volition-browser}"
live_root="${BROWSER_LIVE_ROOT:-/home/pw/services/volition-stack/browser}"
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
unit_root="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

test -x "$source_root/vendor/root/usr/bin/x11vnc"
test -f "$source_root/vendor/root/usr/share/novnc/vnc.html"
test -x "$source_root/venv/bin/python"
test -d "$source_root/venv/lib/python3.13/site-packages/websockify"
test -x /usr/bin/chromium
test -x /usr/bin/Xvfb
test -x /usr/bin/xauth
test -x /usr/bin/mcookie

install -d -m 700 "$live_root" "$live_root/bin" "$live_root/docs" "$live_root/projects"
install -d -m 700 "$live_root/runtime/vendor" "$live_root/runtime/venv" "$unit_root"

tar -C "$source_root/vendor/root" -cf - . | tar -C "$live_root/runtime/vendor" -xf -
tar -C "$source_root/venv" -cf - . | tar -C "$live_root/runtime/venv" -xf -

install -m 700 "$repo_root/bin/wait-for-x" "$live_root/bin/wait-for-x"
install -m 700 "$repo_root/bin/x11vnc-wrapper" "$live_root/bin/x11vnc-wrapper"
install -m 600 "$repo_root/project-router.mjs" "$live_root/project-router.mjs"
install -m 600 "$repo_root/README.md" "$live_root/docs/README.md"
install -m 600 "$repo_root/ACCEPTANCE.md" "$live_root/docs/ACCEPTANCE.md"


for name in \
  volition-project-browser-router.service \
  volition-project-browser@.target volition-project-browser-xvfb@.service \
  volition-project-browser-chromium@.service volition-project-browser-vnc@.service \
  volition-project-browser-novnc@.service; do
  install -m 600 "$repo_root/systemd/$name" "$unit_root/$name"
done

systemctl --user daemon-reload
systemctl --user enable --now volition-project-browser-router.service
