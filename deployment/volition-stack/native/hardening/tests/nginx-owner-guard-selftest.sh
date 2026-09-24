#!/usr/bin/env bash
# Proves finding H-01 and its fix with a throw-away nginx (no root, port 18180, a fake
# capability): the LAN owner map as configure.py wrote it until now hands the capability to a
# local process that binds the machine's LAN (or link-local) address and connects to
# 127.0.0.1 (or its own global IPv6 address); with helena-local-owner-guard.conf it does not,
# while a real LAN client keeps it.
#
#   tests/nginx-owner-guard-selftest.sh [LAN_ADDRESS]     (default: the default route's source)
#   then, from another machine on the LAN:
#     curl -s -H 'Host: kingston-server.local' http://LAN_ADDRESS:18180/   → old=FAKE new=FAKE
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
port=18180
lan=${1:-$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<NF;i++) if ($i=="src") print $(i+1)}')}
dev=$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<NF;i++) if ($i=="dev") print $(i+1)}')
ll=$(ip -6 -o addr show dev "$dev" scope link | awk '{print $4}' | cut -d/ -f1 | head -n 1)
gl=$(ip -6 -o addr show dev "$dev" scope global | awk '{print $4}' | cut -d/ -f1 | head -n 1)
work=$(mktemp -d "${TMPDIR:-/tmp}/helena-nginx-guard.XXXXXX")
cleanup() { [[ -e $work/nginx.pid ]] && kill "$(cat "$work/nginx.pid")" 2>/dev/null; rm -rf "$work"; }
trap cleanup EXIT
mkdir -p "$work/conf.d"

# The owner map as configure.py wrote it before this branch (fake capability, test port).
cat >"$work/conf.d/owner.conf" <<EOF
geo \$volition_local_owner_source {
    default 0;
    192.168.122.1/32 1;
    192.168.2.0/24 1;
    fe80::/10 1;
}
map "\$remote_addr|\$server_addr" \$volition_local_self {
    default 0;
    "~^([^|]+)\\|\\1\$" 1;
}
map "\$host:\$volition_local_owner_source:\$server_port:\$volition_local_self" \$volition_local_owner_token {
    default "";
    "kingston-server.local:1:$port:0" "FAKE";
}
EOF
sed -e "s/\"80:10\"/\"$port:10\"/" "$here/files/helena-local-owner-guard.conf" >"$work/conf.d/guard.conf"
cat >"$work/nginx.conf" <<EOF
pid $work/nginx.pid;
error_log $work/error.log;
events {}
http {
    access_log off;
    client_body_temp_path $work/body;
    proxy_temp_path $work/proxy;
    fastcgi_temp_path $work/fastcgi;
    uwsgi_temp_path $work/uwsgi;
    scgi_temp_path $work/scgi;
    include $work/conf.d/*.conf;
    server {
        listen 127.0.0.1:$port;
        listen $lan:$port;
        ${gl:+listen [$gl]:$port;}
        location / { return 200 "old=\$volition_local_owner_token new=\$helena_local_owner_token\n"; }
    }
}
EOF
/usr/sbin/nginx -p "$work" -c "$work/nginx.conf" 2>/dev/null
sleep 0.5

fail=0
probe() { # probe NAME EXPECTED CURL-ARGS...
  local name=$1 want=$2; shift 2
  local got
  got=$(curl -s -m 3 -H 'Host: kingston-server.local' "$@" || echo "no answer")
  if [[ $got == "$want" ]]; then echo "PASS $name: $got"; else echo "FAIL $name: $got (expected $want)"; fail=1; fi
}
probe "local process, LAN source → 127.0.0.1 (the hole)" "old=FAKE new=" --interface "$lan" "http://127.0.0.1:$port/"
probe "local process, LAN source → LAN address (self)" "old= new=" --interface "$lan" "http://$lan:$port/"
if [[ -n $ll && -n $gl ]]; then
  probe "local process, link-local source → own global IPv6" "old=FAKE new=" --interface "$ll%$dev" -g "http://[$gl]:$port/"
fi
probe "local process from loopback" "old= new=" "http://127.0.0.1:$port/"
echo "From another LAN machine, expect 'old=FAKE new=FAKE':"
echo "  curl -s -H 'Host: kingston-server.local' http://$lan:$port/"
if [[ ${HOLD:-0} -gt 0 ]]; then echo "holding $HOLD s for the LAN check"; sleep "$HOLD"; fi
exit $fail
