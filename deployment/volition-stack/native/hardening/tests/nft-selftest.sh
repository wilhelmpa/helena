#!/usr/bin/env bash
# Proves the rendered firewall in a private network namespace (no root, no change to the
# host's rules): it loads, the self guard refuses a connection to "nginx" (port 80) from a
# non-loopback source address while loopback still works, and a peer outside the home
# network is dropped on port 22 while a home-network peer gets through (and is dropped on a
# port that is not on the list).
#
#   tests/nft-selftest.sh            # needs unprivileged user namespaces (Debian default)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/helena-nft-test.XXXXXX")
trap 'rm -rf "$work"' EXIT
sed -e 's|@LAN4@|192.168.2.0/24|' -e 's|@UIDS_CDP@|0|' -e 's|@UIDS_ROUTER@|0|' \
  -e 's|@UIDS_TOOLS@|0|' -e 's|@UIDS_SYNCTHING@|0|' -e 's|@UIDS_TUNNEL@|0|' \
  -e 's|@TUNNEL_PORT@|8090|' "$here/files/helena-hardening.nft.in" >"$work/rules.nft"

cat >"$work/inside.sh" <<'INNER'
set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin
ip link set lo up
# "eno1": this machine's LAN address, plus a peer namespace for inbound tests.
ip link add eno1 type veth peer name peer0
ip addr add 192.168.2.58/24 dev eno1
ip link set eno1 up
nft -f "$1"
python3 - <<'PY'
import socket, subprocess, sys, threading
def serve(port):
    s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", port)); s.listen(8)
    def loop():
        while True:
            c, _ = s.accept(); c.close()
    threading.Thread(target=loop, daemon=True).start()
serve(80)
def attempt(src, dst, port):
    c = socket.socket(); c.settimeout(2)
    try:
        if src: c.bind((src, 0))
        c.connect((dst, port)); return "open"
    except ConnectionRefusedError: return "refused"
    except OSError as e: return type(e).__name__
    finally: c.close()
results = {
    "loopback -> 127.0.0.1:80": attempt("127.0.0.1", "127.0.0.1", 80),
    "LAN address -> 127.0.0.1:80 (self guard)": attempt("192.168.2.58", "127.0.0.1", 80),
    "LAN address -> 192.168.2.58:80 (self guard)": attempt("192.168.2.58", "192.168.2.58", 80),
}
expected = {
    "loopback -> 127.0.0.1:80": "open",
    "LAN address -> 127.0.0.1:80 (self guard)": "refused",
    "LAN address -> 192.168.2.58:80 (self guard)": "refused",
}
ok = True
for name, got in results.items():
    good = got == expected[name]
    ok &= good
    print(("PASS " if good else "FAIL ") + f"{name}: {got} (expected {expected[name]})")
sys.exit(0 if ok else 1)
PY
# Inbound: a peer in its own namespace behind the veth, once from the home network and
# once from an outside address.
unshare -n sleep 60 &
peer=$!
sleep 0.5
ip link set peer0 netns "$peer"
ip route add 203.0.113.0/24 dev eno1
nsenter -t "$peer" -n sh -c 'ip link set lo up; ip link set peer0 up;
  ip addr add 192.168.2.40/24 dev peer0; ip addr add 203.0.113.9/24 dev peer0'
python3 - <<'PY' &
import socket
for port in (22, 8384):
    s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", port)); s.listen(8)
    import threading
    threading.Thread(target=lambda s=s: [s.accept()[0].close() for _ in iter(int, 1)], daemon=True).start()
import time; time.sleep(20)
PY
server=$!
sleep 1
nsenter -t "$peer" -n python3 - <<'PY'
import socket, sys
def attempt(src, port):
    c = socket.socket(); c.settimeout(2)
    try:
        c.bind((src, 0)); c.connect(("192.168.2.58", port)); return "open"
    except ConnectionRefusedError: return "refused"
    except OSError as e: return type(e).__name__
    finally: c.close()
cases = [("home network -> :22", "192.168.2.40", 22, "open"),
         ("outside -> :22", "203.0.113.9", 22, "TimeoutError"),
         ("home network -> :8384 (not allowed)", "192.168.2.40", 8384, "TimeoutError")]
ok = True
for name, src, port, want in cases:
    got = attempt(src, port)
    ok &= got == want
    print(("PASS " if got == want else "FAIL ") + f"{name}: {got} (expected {want})")
sys.exit(0 if ok else 1)
PY
# The network sync follows a new home network (here: the router moved to 10.20.30.0/24).
ip addr add 10.20.30.5/24 dev eno1
ip addr del 192.168.2.58/24 dev eno1
ip route add default via 10.20.30.1 dev eno1
ip -6 addr add 2001:db8:1:2::5/64 dev eno1 nodad
python3 -I "$2" --firewall-only
lan4=$(nft list set inet helena_hardening lan4 | tr -d '\n\t ')
lan6=$(nft list set inet helena_hardening lan6 | tr -d '\n\t ')
case "$lan4" in *10.20.30.0/24*) echo "PASS network sync: lan4 follows the new network" ;; *) echo "FAIL network sync: $lan4"; exit 1 ;; esac
case "$lan6" in *2001:db8:1:2::/64*) echo "PASS network sync: lan6 has the machine's /64" ;; *) echo "FAIL network sync: $lan6"; exit 1 ;; esac
kill "$peer" "$server" 2>/dev/null || true
nft list table inet helena_hardening | grep -c 'helena:' | sed 's/^/rules with helena markers: /'
INNER
unshare -rn bash "$work/inside.sh" "$work/rules.nft" "$here/files/helena-lan6-sync"
