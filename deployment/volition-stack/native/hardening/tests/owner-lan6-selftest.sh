#!/usr/bin/env bash
# Proves the LAN owner sign-in over IPv6 (and IPv4) end to end in private network namespaces
# (no root, no change on the host): a throw-away nginx with the owner map exactly as
# local-owner/configure.py writes it, the guard (files/helena-local-owner-guard.conf), and the
# networks include that helena-lan6-sync renders from the namespace's own addresses. No
# firewall is loaded, so this is nginx's layer alone (the firewall's self guard is the other).
#
# "The machine": eno1 with 192.168.2.58/24, a stable 2001:db8:1:2::58/64 and a second
# (privacy-like) 2001:db8:1:2::77/64. "The LAN": a peer namespace behind a veth with
# 192.168.2.40, 2001:db8:1:2::99, an address outside the home /64 and a ULA.
# Expected: a LAN client in the home /24 or /64 gets the capability; the machine itself never
# does, from any of its addresses (IPv4, IPv6, loopback, link-local, one own address to
# another); neither does an address outside the home /64, a ULA the LAN interface does not
# have (until it has one), or another Host.
#
#   tests/owner-lan6-selftest.sh      # needs unprivileged user namespaces (Debian default)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/helena-owner-lan6.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/conf.d"
python3 -I - "$here/../local-owner" "$work/owner-networks.conf" >"$work/conf.d/owner.conf" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
import configure
print(configure.owner_map('kingston-server.local', '80', 'FAKE', sys.argv[2]), end='')
PY
cp "$here/files/helena-local-owner-guard.conf" "$work/conf.d/guard.conf"
cat >"$work/nginx.conf" <<EOF
user root root;
pid $work/nginx.pid;
error_log $work/error.log;
master_process off;
events {}
http {
    access_log off;
    client_body_temp_path $work/body; proxy_temp_path $work/proxy; fastcgi_temp_path $work/fastcgi;
    uwsgi_temp_path $work/uwsgi; scgi_temp_path $work/scgi;
    include $work/conf.d/*.conf;
    server {
        listen 80 default_server;
        listen [::]:80 default_server;
        listen 127.0.0.1:8088;
        location / { return 200 "cap=\$helena_owner_capability src=\$volition_local_owner_source\n"; }
    }
}
EOF

cat >"$work/inside.sh" <<'INNER'
set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin
work=$1 sync=$2
ip link set lo up
ip link add eno1 type veth peer name peer0
ip addr add 192.168.2.58/24 dev eno1
ip -6 addr add 2001:db8:1:2::58/64 dev eno1 nodad
ip -6 addr add 2001:db8:1:2::77/64 dev eno1 nodad
ip link set eno1 up
unshare -n sleep 120 &
peer=$!
sleep 0.5
ip link set peer0 netns "$peer"
nsenter -t "$peer" -n sh -c 'ip link set lo up; ip link set peer0 up
  ip addr add 192.168.2.40/24 dev peer0
  ip -6 addr add 2001:db8:1:2::99/64 dev peer0 nodad
  ip -6 addr add 2001:db8:9::9/64 dev peer0 nodad
  ip -6 addr add fd00:1::9/64 dev peer0 nodad'
ip route add default via 192.168.2.1 dev eno1
ip -6 route add default via 2001:db8:1:2::1 dev eno1
ip -6 route add 2001:db8:9::/64 dev eno1
ip -6 route add fd00:1::/64 dev eno1
for _ in $(seq 1 50); do  # the link-local address leaves "tentative"
  ip -6 -o addr show dev eno1 scope link | grep -v tentative | grep -q fe80 && break; sleep 0.1
done

render() {
  HELENA_OWNER_NETWORKS=$work/owner-networks.conf python3 -I "$sync" --nginx-only --no-reload >/dev/null
  sed 's/^/  | /' "$work/owner-networks.conf"
}
start() { /usr/sbin/nginx -p "$work" -c "$work/nginx.conf"; sleep 0.3; }
stop() { kill "$(cat "$work/nginx.pid")"; sleep 0.3; }
probe() { # probe NAMESPACE-PID|- SOURCE DESTINATION HOST EXPECTED NAME
  local run=() got
  [[ $1 != - ]] && run=(nsenter -t "$1" -n)
  got=$("${run[@]}" python3 - "$2" "$3" "$4" <<'PY'
import socket, sys
src, dst, host = sys.argv[1:4]
family = socket.AF_INET6 if ':' in dst else socket.AF_INET
s = socket.socket(family, socket.SOCK_STREAM); s.settimeout(3)
try:
    if src.startswith('fe80'):
        s.bind((src, 0, 0, socket.if_nametoindex('eno1')))
    elif src:
        s.bind((src, 0))
    s.connect((dst, 80))
    s.sendall(f'GET / HTTP/1.0\r\nHost: {host}\r\n\r\n'.encode())
    data = b''
    while chunk := s.recv(4096):
        data += chunk
    print(data.split(b'\r\n\r\n', 1)[1].decode().split()[0])
except OSError as error:
    print(f'no-answer:{error}')
PY
)
  if [[ $got == "cap=$5" ]]; then echo "PASS $6: $got"; else echo "FAIL $6: $got (expected cap=$5)"; fail=1; fi
}

fail=0
ll=$(ip -6 -o addr show dev eno1 scope link | awk '{print $4}' | cut -d/ -f1 | head -n 1)
echo "networks include as helena-lan6-sync renders it:"
render
grep -qx '2001:db8:1:2::/64 1;' "$work/owner-networks.conf" || { echo "FAIL the home /64 is missing"; fail=1; }
grep -qx '2001:db8:1:2::77/128 0;' "$work/owner-networks.conf" || { echo "FAIL the second own address is missing"; fail=1; }
grep -qx '192.168.2.58/32 0;' "$work/owner-networks.conf" || { echo "FAIL the own IPv4 is missing"; fail=1; }
grep -Eq '^(fe80|fd00|::1|127\.)' "$work/owner-networks.conf" && { echo "FAIL link-local, ULA or loopback listed"; fail=1; }
start
probe "$peer" 192.168.2.40 192.168.2.58 kingston-server.local FAKE "LAN client over IPv4"
probe "$peer" 2001:db8:1:2::99 2001:db8:1:2::58 kingston-server.local FAKE "LAN client over IPv6 (home /64)"
probe "$peer" 2001:db8:1:2::99 2001:db8:1:2::77 kingston-server.local FAKE "LAN client over IPv6 to the machine's second address"
probe "$peer" 2001:db8:1:2::99 2001:db8:1:2::58 example.com "" "LAN client over IPv6 with another Host"
probe "$peer" 2001:db8:9::9 2001:db8:1:2::58 kingston-server.local "" "IPv6 client outside the home /64"
probe "$peer" fd00:1::9 2001:db8:1:2::58 kingston-server.local "" "ULA client, the machine has no ULA"
probe - 127.0.0.1 127.0.0.1 kingston-server.local "" "machine: loopback"
probe - ::1 ::1 kingston-server.local "" "machine: IPv6 loopback"
probe - 192.168.2.58 192.168.2.58 kingston-server.local "" "machine: own IPv4 to itself (self)"
probe - 192.168.2.58 127.0.0.1 kingston-server.local "" "machine: own IPv4 to 127.0.0.1"
probe - 2001:db8:1:2::58 2001:db8:1:2::58 kingston-server.local "" "machine: own IPv6 to itself (self)"
probe - 2001:db8:1:2::77 2001:db8:1:2::58 kingston-server.local "" "machine: one own IPv6 address to another"
probe - 2001:db8:1:2::58 ::1 kingston-server.local "" "machine: own IPv6 to ::1"
[[ -n $ll ]] && probe - "$ll" 2001:db8:1:2::58 kingston-server.local "" "machine: link-local to own IPv6"
stop

# The LAN interface gets a ULA too: then the ULA prefix is the home network's as well.
ip -6 addr add fd00:1::58/64 dev eno1 nodad
echo "networks include after the LAN interface got a ULA:"
render
start
probe "$peer" fd00:1::9 fd00:1::58 kingston-server.local FAKE "ULA client, the LAN interface has that ULA"
probe - fd00:1::58 2001:db8:1:2::58 kingston-server.local "" "machine: own ULA to own IPv6"
stop
kill "$peer" 2>/dev/null || true
exit $fail
INNER
unshare -rn bash "$work/inside.sh" "$work" "$here/files/helena-lan6-sync"
echo "owner-lan6 selftest: all checks passed"
