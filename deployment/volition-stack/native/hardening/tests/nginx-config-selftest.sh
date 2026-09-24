#!/usr/bin/env bash
# Checks with `nginx -t`, without root and without touching the running nginx, that the LAN
# site as it will look after the go-live (lan_https.py: https under the public name; the
# local-owner guard) and the tunnel entry (cloudflare/nginx-tunnel.conf.in) load together.
# Inputs: the live site and snippets from /etc/nginx (world-readable, no secrets in them); the
# owner map is replaced by one with a fake capability, the certificate by a self-signed one,
# the ports by unprivileged ones.
#
#   tests/nginx-config-selftest.sh [SITE]     (default /etc/nginx/sites-available/volition.conf)
set -euo pipefail
here=$(cd "$(dirname "$0")/../.." && pwd)   # native/
site=${1:-/etc/nginx/sites-available/volition.conf}
host=helena.volition.one
work=$(mktemp -d "${TMPDIR:-/tmp}/helena-nginx-config.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work"/{conf.d,snippets,sites,certs}

cp /etc/nginx/snippets/volition-*.conf "$work/snippets/"
cp "$here/cloudflare/helena-tunnel-headers.conf" "$work/snippets/"
cp /etc/nginx/conf.d/helena-client-addr.conf "$work/conf.d/" 2>/dev/null \
  || printf 'map "$server_port" $helena_client_addr { default $remote_addr; }\n' >"$work/conf.d/helena-client-addr.conf"
cp "$here/hardening/files/helena-local-owner-guard.conf" "$work/conf.d/"
cat >"$work/conf.d/owner.conf" <<'EOF'
geo $volition_local_owner_source { default 0; 192.168.2.0/24 1; }
map "$remote_addr|$server_addr" $volition_local_self { default 0; "~^([^|]+)\|\1$" 1; }
map "$host:$volition_local_owner_source:$server_port:$volition_local_self" $volition_local_owner_token {
    default "";
    "helena.volition.one:1:443:0" "FAKE";
}
EOF

# The LAN site after lan_https.py and the guard.
python3 - "$site" "$work/sites/lan.conf" "$here/cloudflare" "$host" <<'PY'
import importlib.util, sys
site, out, cf, host = sys.argv[1:5]
spec = importlib.util.spec_from_file_location('lan_https', f'{cf}/lan_https.py')
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
text = mod.edit(open(site).read(), host)
text = text.replace('X-Volition-Local-Access $volition_local_owner_token;',
                    'X-Volition-Local-Access $helena_owner_capability;')
open(out, 'w').write(text)
open(out.replace('lan.conf', 'redirect.conf'), 'w').write(mod.redirect(host))
open(out.replace('sites/lan.conf', 'snippets/helena-tls.conf'), 'w').write(mod.TLS)
PY
sed -e "s|@HOST@|$host|g" -e "s|@PORT@|18090|g" "$here/cloudflare/nginx-tunnel.conf.in" >"$work/sites/tunnel.conf"

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 \
  -subj "/CN=$host" -keyout "$work/certs/$host.key" -out "$work/certs/$host.crt" 2>/dev/null
for f in "$work"/sites/*.conf "$work"/snippets/*.conf; do
  sed -i -e "s|/etc/nginx/snippets/|$work/snippets/|g" \
    -e "s|/etc/helena/tls/lego/certificates/|$work/certs/|g" \
    -e 's|listen 80 default_server;|listen 127.0.0.1:18080 default_server;|' \
    -e 's|listen \[::\]:80 default_server;|listen [::1]:18080 default_server;|' \
    -e 's|listen 443 ssl default_server;|listen 127.0.0.1:18443 ssl default_server;|' \
    -e 's|listen \[::\]:443 ssl default_server;|listen [::1]:18443 ssl default_server;|' \
    -e 's|listen 127.0.0.1:8088;|listen 127.0.0.1:18088;|' \
    -e 's|listen 80;|listen 127.0.0.1:18080;|' -e 's|listen \[::\]:80;|listen [::1]:18080;|' "$f"
done
cat >"$work/nginx.conf" <<EOF
pid $work/nginx.pid;
error_log $work/error.log;
events {}
http {
    access_log off;
    include /etc/nginx/mime.types;
    client_body_temp_path $work/body;
    proxy_temp_path $work/proxy;
    fastcgi_temp_path $work/fastcgi;
    uwsgi_temp_path $work/uwsgi;
    scgi_temp_path $work/scgi;
    include $work/conf.d/*.conf;
    include $work/sites/*.conf;
}
EOF
if /usr/sbin/nginx -t -p "$work" -c "$work/nginx.conf" 2>&1 | grep -v 'the "user" directive'; then :; fi
/usr/sbin/nginx -t -q -p "$work" -c "$work/nginx.conf" && echo "PASS nginx -t: LAN site with HTTPS + owner guard + tunnel entry"
