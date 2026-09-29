#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" = 0 ] || { echo 'run as root' >&2; exit 1; }
install -d -m 0755 /usr/local/lib/helena-ai /var/lib/helena-ai
install -m 0755 "$here/watch.py" /usr/local/lib/helena-ai/gpu-reset-watch
install -m 0644 "$here/helena-gpu-reset-watch.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now helena-gpu-reset-watch.service
