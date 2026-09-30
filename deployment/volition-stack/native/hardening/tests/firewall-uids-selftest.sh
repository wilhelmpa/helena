#!/usr/bin/env bash
# Proves apply.sh's firewall-uids step and audit.sh's tunnel.acl check in a private user +
# network + mount namespace (no root, no change on the host). The live incident of
# 2026-09-25: the firewall step ran before cloudflare/install.sh service created
# helena-tunnel, so tunnel_uids held root alone, cloudflared got "connection refused" and
# Cloudflare answered 502.
# Here: the ruleset is rendered with tunnel_uids { 0 } and loaded, the installed copy sits in a
# scratch /etc/nftables.d, and a fake `id` knows helena-tunnel as uid 978.
#
#   tests/firewall-uids-selftest.sh  # needs unprivileged user namespaces (Debian default)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/helena-fw-uids.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work"/{nftables.d,state/pending,bin}
sed -e 's|@LAN4@|192.168.2.0/24|' -e 's|@UIDS_CDP@|0|' -e 's|@UIDS_ROUTER@|0|' \
  -e 's|@UIDS_TOOLS@|0|' -e 's|@UIDS_SYNCTHING@|0|' -e 's|@UIDS_TUNNEL@|0|' -e 's|@UIDS_VOICE@|0|' \
  -e 's|@UIDS_VOLITION_NPU@|0|' \
  -e 's|@TUNNEL_PORT@|8090|' "$here/files/helena-hardening.nft.in" >"$work/nftables.d/helena-hardening.nft"

# id: helena-tunnel is 978; every other account the sets name does not exist here.
cat >"$work/bin/id" <<'SH'
#!/bin/sh
if [ "$1" = -u ] && [ "$2" = helena-tunnel ]; then echo 978; exit 0; fi
if [ "$1" = -u ] && [ -n "$2" ]; then exit 1; fi
exec /usr/bin/id "$@"
SH
chmod +x "$work/bin/id"

cat >"$work/inside.sh" <<'INNER'
set -euo pipefail
work=$1 here=$2
mount --bind "$work/nftables.d" /etc/nftables.d
mount --bind "$work/bin" /usr/local/sbin
export HELENA_HARDENING_STATE=$work/state
PATH=/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin
ip link set lo up
nft -f /etc/nftables.d/helena-hardening.nft
fail=0
check() { if [[ $3 == "$2" ]]; then echo "PASS $1"; else echo "FAIL $1: got '$3', expected '$2'"; fail=1; fi; }
elems() { nft -j list set inet helena_hardening tunnel_uids | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(",".join(str(e) for i in d["nftables"] for e in i.get("set",{}).get("elem",[])))'; }
file_elems() { grep -A2 'set tunnel_uids' /etc/nftables.d/helena-hardening.nft | sed -n 's/.*elements = { \(.*\) }/\1/p'; }
acl() { HELENA_AUDIT_ONLY=tunnel.acl bash "$here/audit.sh" | cut -f1,4,6-; }

check "the incident: the loaded table lets only root in" "0" "$(elems)"
check "audit names the missing tunnel user" "$(printf 'tunnel.acl\tfail\twhy=user\tuser=helena-tunnel')" "$(acl)"

out=$(bash "$here/apply.sh" firewall-uids 2>&1)
check "dry run names the gap" 1 "$(grep -c 'tunnel_uids lacks helena-tunnel (978) in the loaded table' <<<"$out")"
check "dry run changes the table not" "0" "$(elems)"
check "dry run changes the file not" "0" "$(file_elems)"

bash "$here/apply.sh" --apply firewall-uids >/dev/null 2>&1
check "the loaded table has the tunnel user" "0,978" "$(elems)"
check "the installed ruleset has it" "0, 978" "$(file_elems)"
check "the installed ruleset still loads" 0 "$(nft -c -f /etc/nftables.d/helena-hardening.nft >/dev/null 2>&1; echo $?)"
check "the other sets are untouched" 1 "$(grep -A2 'set cdp_uids' /etc/nftables.d/helena-hardening.nft | grep -c 'elements = { 0 }')"
check "audit passes" "$(printf 'tunnel.acl\tpass')" "$(acl | cut -f1,2)"
out=$(bash "$here/apply.sh" --apply firewall-uids 2>&1)
check "a second run has nothing to do" 1 "$(grep -c 'nothing to do' <<<"$out")"

nft delete table inet helena_hardening
check "audit without the ACL" "$(printf 'tunnel.acl\tfail\twhy=open')" "$(acl)"
exit $fail
INNER
unshare -rnm bash "$work/inside.sh" "$work" "$here"
echo "firewall-uids selftest: all checks passed"
