#!/usr/bin/env bash
# Proves the home network's HTTPS entry and the tunnel entry's proof end to end, in private
# network namespaces with a throw-away nginx (no root, no change on the host):
#   - the LAN site after lan_https.py (fixtures/lan-site.conf, the live site of 2026-09-25),
#     the owner map as local-owner/configure.py --https-host writes it (fake capability), the
#     guard, the tunnel entry from nginx-tunnel.conf.in and the entry proof map as
#     install.sh entry-token writes it (fake proof);
#   - a throw-away CA and a certificate for the home name; echo servers for the web app
#     (127.0.0.1:3001) and the api (127.0.0.1:3000) that answer with the headers they got.
# "The machine": eno1 192.168.2.58/24; "a LAN device": a peer namespace with 192.168.2.40.
#
#   tests/lan-https-selftest.sh      # needs unprivileged user namespaces (Debian default)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)          # native/cloudflare
native=$(cd "$here/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/helena-lan-https.XXXXXX")
trap 'rm -rf "$work"' EXIT
home=helena-home.volition.one
public=helena.volition.one
mkdir -p "$work"/{conf.d,snippets,sites,certs}

# The certificate: a CA of this run, and the home name signed by it.
(
  cd "$work/certs"
  ec=(-newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes)
  openssl req -x509 "${ec[@]}" -days 2 -subj '/CN=Helena Test CA' -keyout ca.key -out ca.crt \
    -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign 2>/dev/null
  openssl req "${ec[@]}" -subj "/CN=$home" -keyout privkey.pem -out leaf.csr 2>/dev/null
  printf 'subjectAltName=DNS:%s\n' "$home" >san.ext
  openssl x509 -req -in leaf.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 30 \
    -extfile san.ext -out leaf.crt 2>/dev/null
  cat leaf.crt ca.crt >fullchain.pem
)

# conf.d as the scripts write it: owner map (fake capability), guard, client address,
# lan_https's maps, the entry proof (fake), and an empty IPv6 networks include.
: >"$work/owner-networks.conf"
python3 -I - "$native" "$work" "$home" <<'PY'
import importlib.util, pathlib, sys
native, work, home = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
sys.path.insert(0, str(native / 'local-owner'))
import configure
(work / 'conf.d/owner.conf').write_text(
    configure.owner_map(home, '443', 'FAKE', str(work / 'owner-networks.conf')))
spec = importlib.util.spec_from_file_location('lan_https', native / 'cloudflare/lan_https.py')
lan = importlib.util.module_from_spec(spec); spec.loader.exec_module(lan)
(work / 'conf.d/helena-lan-https.conf').write_text(lan.MAPS_TEXT)
(work / 'snippets/helena-tls.conf').write_text(lan.TLS)
site = (native / 'cloudflare/tests/fixtures/lan-site.conf').read_text()
(work / 'sites/lan.conf').write_text(lan.edit(site, home, work / 'certs'))
PY
cp "$native/hardening/files/helena-local-owner-guard.conf" "$work/conf.d/guard.conf"
printf 'map "$server_port" $helena_client_addr { default $remote_addr; }\n' >"$work/conf.d/client-addr.conf"
cat >"$work/conf.d/edge-entry.conf" <<'EOF'
map "$server_addr:$server_port:$proxy_host" $helena_edge_entry_token {
    volatile;
    default "";
    "127.0.0.1:8090:127.0.0.1:3001" "FAKE-PROOF";
}
EOF
sed -e "s|@HOST@|$public|g" -e 's|@PORT@|8090|g' "$here/nginx-tunnel.conf.in" >"$work/sites/tunnel.conf"
cp "$here/helena-tunnel-headers.conf" "$work/snippets/"
# The tools' own snippets (project and owner terminal) as the host has them, else stand-ins.
for name in volition-tool-proxy-security volition-project-terminal volition-owner-terminal; do
  if [[ -r /etc/nginx/snippets/$name.conf ]]; then cp "/etc/nginx/snippets/$name.conf" "$work/snippets/"
  else : >"$work/snippets/$name.conf"; fi
done
sed -i -e "s|/etc/nginx/snippets/|$work/snippets/|g" "$work"/sites/*.conf "$work"/snippets/*.conf
cat >"$work/nginx.conf" <<EOF
user root root;
pid $work/nginx.pid;
error_log $work/error.log;
master_process off;
events {}
http {
    access_log off;
    include /etc/nginx/mime.types;
    client_body_temp_path $work/body; proxy_temp_path $work/proxy; fastcgi_temp_path $work/fastcgi;
    uwsgi_temp_path $work/uwsgi; scgi_temp_path $work/scgi;
    include $work/conf.d/*.conf;
    include $work/sites/*.conf;
}
EOF

cat >"$work/echo.py" <<'PY'
# The web app (3001) and the api (3000): answer with the headers that matter here. The api
# says yes to nginx's auth subrequests; the web app sends its own HSTS on /with-hsts.
import http.server, json, sys, threading
class Echo(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.server.server_port == 3000 and self.path.startswith('/auth/verify'):
            self.send_response(204); self.end_headers(); return
        body = json.dumps({
            'upstream': self.server.server_port,
            'cap': self.headers.get('X-Volition-Local-Access', ''),
            'proof': self.headers.get('X-Helena-Edge-Entry', ''),
            'entry': self.headers.get('X-Helena-Entry', ''),
            'host': self.headers.get('Host', ''),
        }).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        if self.path.startswith('/with-hsts'):
            self.send_header('Strict-Transport-Security', 'max-age=1')
        self.end_headers(); self.wfile.write(body)
    def log_message(self, *args): pass
for port in (3000, 3001):
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), Echo)
    threading.Thread(target=server.serve_forever, daemon=True).start()
threading.Event().wait()
PY

cat >"$work/inside.sh" <<'INNER'
set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin
work=$1 home=$2 public=$3
ip link set lo up
ip link add eno1 type veth peer name peer0
ip addr add 192.168.2.58/24 dev eno1
ip link set eno1 up
unshare -n sleep 120 &
peer=$!
sleep 0.5
ip link set peer0 netns "$peer"
nsenter -t "$peer" -n sh -c 'ip link set lo up; ip link set peer0 up; ip addr add 192.168.2.40/24 dev peer0'
python3 -I "$work/echo.py" &
echo_pid=$!
/usr/sbin/nginx -p "$work" -c "$work/nginx.conf"
sleep 0.5

fail=0
check() { # check NAME EXPECTED GOT
  if [[ $3 == "$2" ]]; then echo "PASS $1: $3"; else echo "FAIL $1: got '$3', expected '$2'"; fail=1; fi
}
lan() { nsenter -t "$peer" -n curl -sS -m 5 --cacert "$work/certs/ca.crt" "$@"; }
field() { python3 -I -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1"; }

# A LAN device on the home name: HTTPS with a valid certificate, HTTP/2, the owner capability.
out=$(lan --resolve "$home:443:192.168.2.58" -w '\n%{http_version}' "https://$home/plain")
check "LAN device, https home name: owner capability" FAKE "$(head -n1 <<<"$out" | field cap)"
check "LAN device, https home name: HTTP/2" 2 "$(tail -n1 <<<"$out")"
check "LAN device, https home name: no entry proof reaches the web app" "" "$(head -n1 <<<"$out" | field proof)"
hsts=$(lan --resolve "$home:443:192.168.2.58" -D - -o /dev/null "https://$home/plain" | grep -ci '^strict-transport-security:' || true)
check "HSTS added once where the app sends none" 1 "$hsts"
hsts=$(lan --resolve "$home:443:192.168.2.58" -D - -o /dev/null "https://$home/with-hsts" | grep -i '^strict-transport-security:' | tr -d '\r' || true)
check "the app's own HSTS kept, nothing added" "strict-transport-security: max-age=1" "${hsts,,}"
forged=$(lan --resolve "$home:443:192.168.2.58" -H 'X-Helena-Edge-Entry: FAKE-PROOF' "https://$home/plain" | field proof)
check "LAN device sending the proof header: blanked" "" "$forged"
forged=$(lan --resolve "$home:443:192.168.2.58" -H 'X-Helena-Edge-Entry: FAKE-PROOF' "https://$home/backend/x" | field proof)
check "LAN device sending the proof header to the api: blanked" "" "$forged"

# Plain http on the LAN goes to https, path and query kept; for every name.
loc=$(lan -o /dev/null -w '%{http_code} %{redirect_url}' --resolve "$home:80:192.168.2.58" "http://$home/project/VOL?view=board")
check "LAN device, http home name: redirect" "301 https://$home/project/VOL?view=board" "$loc"
loc=$(lan -o /dev/null -w '%{http_code} %{redirect_url}' -H 'Host: kingston-server.local' "http://192.168.2.58/")
check "LAN device, http kingston-server.local: redirect" "301 https://$home/" "$loc"

# The machine itself: loopback http stays (local processes, the kiosk), and never the owner.
out=$(curl -sS -m 5 -H 'Host: kingston-server.local' http://127.0.0.1/plain)
check "machine, loopback http: no redirect" 3001 "$(field upstream <<<"$out")"
check "machine, loopback http: no capability" "" "$(field cap <<<"$out")"
out=$(curl -sS -m 5 --cacert "$work/certs/ca.crt" --resolve "$home:443:127.0.0.1" "https://$home/plain")
check "machine, loopback https home name: no capability" "" "$(field cap <<<"$out")"
out=$(curl -sS -m 5 --interface 192.168.2.58 --cacert "$work/certs/ca.crt" --resolve "$home:443:192.168.2.58" "https://$home/plain")
check "machine, own LAN address to itself: no capability" "" "$(field cap <<<"$out")"

# The tunnel entry: the proof goes to the web app only, a forged one nowhere.
out=$(curl -sS -m 5 -H "Host: $public" -H 'X-Helena-Edge-Entry: forged' http://127.0.0.1:8090/plain)
check "tunnel entry to the web app: the entry's proof" FAKE-PROOF "$(field proof <<<"$out")"
check "tunnel entry to the web app: marked tunnel" tunnel "$(field entry <<<"$out")"
check "tunnel entry to the web app: no capability" "" "$(field cap <<<"$out")"
out=$(curl -sS -m 5 -H "Host: $public" -H 'X-Helena-Edge-Entry: forged' http://127.0.0.1:8090/backend/x)
check "tunnel entry to the api: no proof, the forged one dropped" "" "$(field proof <<<"$out")"
check "tunnel entry to the api: marked tunnel" tunnel "$(field entry <<<"$out")"

kill "$(cat "$work/nginx.pid")" "$echo_pid" "$peer" 2>/dev/null || true
exit $fail
INNER
unshare -rn bash "$work/inside.sh" "$work" "$home" "$public"
echo "lan-https selftest: all checks passed"
