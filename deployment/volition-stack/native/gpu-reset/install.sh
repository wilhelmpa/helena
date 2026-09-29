#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
[ "${1:-}" = "--refresh" ] || [ $# -eq 0 ] || { echo 'usage: install.sh [--refresh]' >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo 'run as root' >&2; exit 1; }
install -d -m 0755 /usr/local/lib/helena-ai /var/lib/helena-ai
install -m 0755 "$here/watch.py" /usr/local/lib/helena-ai/gpu-reset-watch
if [ "${1:-}" = "--refresh" ]; then
  systemctl try-restart helena-gpu-reset-watch.service
  exit 0
fi
install -m 0644 "$here/helena-gpu-reset-watch.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now helena-gpu-reset-watch.service
