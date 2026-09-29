#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
unit=/etc/systemd/system/volition-halogen-priority.service
dry=0
if [ "${1:-}" = '--dry-run' ]; then dry=1; shift; fi
[ "${1:-}" = install ] || { echo 'usage: priority-install.sh [--dry-run] install' >&2; exit 2; }
[ "$dry" = 1 ] || [ "$(id -u)" = 0 ] || { echo 'run as root' >&2; exit 1; }
gid=${VOLITION_AGENTS_GID:-$(getent group volition-agents | cut -d: -f3)}
[ -n "$gid" ] || { echo 'volition-agents group missing' >&2; exit 1; }
if [ "$dry" = 1 ]; then
  echo "would install $unit (volition-agents gid $gid)"
  echo 'would enable/start volition-halogen-priority.service'
  echo 'would sync isolation launcher, then disable old helena-halogen-proxy sockets'
  exit 0
fi
# Same container network as install.sh (SUBNET there).
subnet=${HALOGEN_SUBNET:-10.89.73.0/29}
sed -e "s/@AGENTS_GID@/$gid/g" -e "s#@SUBNET@#$subnet#g" \
  "$here/systemd/volition-halogen-priority.service.in" > "$unit.tmp"
chmod 0644 "$unit.tmp"
mv "$unit.tmp" "$unit"
systemctl daemon-reload
systemctl enable --now volition-halogen-priority.service
ready=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:8741/priority/status >/dev/null; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { echo 'priority proxy did not become ready' >&2; exit 1; }
# The proxy must actually reach Halogen, not only answer its own status.
reached=0
for attempt in 1 2 3 4 5 6; do
  if curl --fail --silent --max-time 10 http://127.0.0.1:8741/v1/models >/dev/null; then reached=1; break; fi
  sleep 2
done
[ "$reached" = 1 ] || { echo 'priority proxy cannot reach Halogen' >&2; exit 1; }
"$here/../isolation.sh" sync
systemctl disable --now helena-halogen-proxy@8731.socket helena-halogen-proxy@8733.socket
systemctl stop helena-halogen-proxy@8731.service helena-halogen-proxy@8733.service || true
echo 'priority proxy installed; Halogen was not restarted'
