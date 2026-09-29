#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
dry=0
if [ "${1:-}" = --dry-run ]; then dry=1; shift; fi
command=${1:-}
case "$command" in install|uninstall) ;; *) echo 'usage: npu-install.sh [--dry-run] install|uninstall' >&2; exit 2;; esac
run() { if [ "$dry" = 1 ]; then printf 'would: %s\n' "$*"; else "$@"; fi; }
[ "$dry" = 1 ] || [ "$(id -u)" = 0 ] || { echo 'Run as root' >&2; exit 1; }
if [ "$command" = uninstall ]; then
  for unit in volition-npu-proxy.socket volition-npu-proxy.service volition-npu.service; do
    if [ "$dry" = 1 ] || [ "$(systemctl show -p LoadState --value "$unit")" != not-found ]; then
      run systemctl disable --now "$unit"
    fi
  done
  run rm -f /etc/systemd/system/volition-npu.service /etc/systemd/system/volition-npu-proxy.socket /etc/systemd/system/volition-npu-proxy.service
  run systemctl daemon-reload
  exit
fi
if [ "$dry" = 0 ]; then
  test -x /usr/bin/flm
  test -x /usr/local/lib/helena/hostd/helena-hostd
  test -c /dev/accel/accel0
  getent passwd lemonade >/dev/null
fi
run install -d -m 755 /usr/local/lib/volition-npu /var/lib/volition-npu
run install -m 755 "$here/npu-server.py" /usr/local/lib/volition-npu/npu-server.py
for unit in volition-npu.service volition-npu-proxy.socket volition-npu-proxy.service; do
  run install -m 644 "$here/systemd/$unit" "/etc/systemd/system/$unit"
done
if [ ! -f /var/lib/volition-npu/model.json ]; then
  if [ "$dry" = 1 ]; then echo 'would initialize qwen3.5:2b';
  else printf '{"model":"qwen3.5:2b"}\n' > /var/lib/volition-npu/model.json; fi
fi
if [ ! -f /etc/helena/volition-npu.key ]; then
  if [ "$dry" = 1 ]; then echo 'would generate NPU key (not displayed)';
  else
    mkdir -p /etc/helena
    (umask 027; openssl rand -hex 32 > /etc/helena/volition-npu.key)
  fi
fi
run chown root:volition-plan-secrets /etc/helena/volition-npu.key
run chmod 640 /etc/helena/volition-npu.key
if [ "$dry" = 1 ]; then
  echo 'would inventory installed FLM models as lemonade (HOME=/var/lib/lemonade)'
else
  runuser -u lemonade -- env HOME=/var/lib/lemonade /usr/bin/flm list --filter installed --json > /var/lib/volition-npu/installed.json.tmp
  chmod 644 /var/lib/volition-npu/installed.json.tmp
  mv /var/lib/volition-npu/installed.json.tmp /var/lib/volition-npu/installed.json
fi
run systemctl daemon-reload
run systemctl enable volition-npu.service
printf '%s\n' 'Installed without starting; register Ava and select a profile through the maintenance API.'
