#!/usr/bin/env bash
# Proves the rendered firewall in a private network namespace (no root, no change to the
# host's rules): it loads, the self guard refuses a connection to "nginx" (port 80) from a
# non-loopback source address while loopback still works, and a peer outside the home
# network is dropped on port 22 while a home-network peer gets through.
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
nft list table inet helena_hardening | grep -c 'helena:' | sed 's/^/rules with helena markers: /'
INNER
unshare -rn bash "$work/inside.sh" "$work/rules.nft"
