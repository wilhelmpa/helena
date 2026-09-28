#!/usr/bin/env bash
# Proves install.sh entry-token and tls-setup.sh (certbot) in a private user + mount namespace
# (no root, no change on the host): /etc/helena, /etc/nginx/conf.d and /etc/systemd/system are
# scratch folders, certbot/systemctl/nginx are fakes on /usr/local/sbin (first in both
# scripts' PATH); the fake nginx checks the written map with the real nginx.
#
#   tests/scripts-selftest.sh        # needs unprivileged user namespaces (Debian default)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)          # native/cloudflare
work=$(mktemp -d "${TMPDIR:-/tmp}/helena-cf-scripts.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work"/{helena,confd,systemd,bin,le,ngx}

cat >"$work/bin/systemctl" <<'SH'
#!/bin/sh
echo "systemctl $*" >>"$W/calls"
case "$1" in is-active) echo active ;; esac
SH
cat >"$work/bin/nginx" <<'SH'
#!/bin/sh
# nginx -t: the real nginx on a config that includes the written conf.d; reload: recorded.
echo "nginx $*" >>"$W/calls"
cat >"$W/ngx/nginx.conf" <<EOF
user root root;
pid $W/ngx/nginx.pid;
error_log $W/ngx/error.log;
events {}
http {
  access_log off;
  client_body_temp_path $W/ngx/body; proxy_temp_path $W/ngx/proxy; fastcgi_temp_path $W/ngx/fastcgi;
  uwsgi_temp_path $W/ngx/uwsgi; scgi_temp_path $W/ngx/scgi;
  include /etc/nginx/conf.d/*.conf;
  server { listen 127.0.0.1:18099; location / { proxy_set_header X-E \$helena_edge_entry_token; proxy_pass http://127.0.0.1:3001; } }
}
EOF
exec /usr/sbin/nginx -q -t -p "$W/ngx" -c "$W/ngx/nginx.conf" 2>/dev/null
SH
cat >"$work/bin/certbot" <<'SH'
#!/bin/sh
# Records the arguments and what the credentials file holds (the token must reach it, and
# only it), then writes a certificate lineage like certbot's.
echo "$*" >"$W/certbot.args"
creds=""
prev=""
for arg; do [ "$prev" = --dns-cloudflare-credentials ] && creds=$arg; prev=$arg; done
cp "$creds" "$W/certbot.creds"
stat -c '%a' "$creds" >"$W/certbot.creds.mode"
name=""
prev=""
for arg; do [ "$prev" = --cert-name ] && name=$arg; prev=$arg; done
mkdir -p "$HELENA_LETSENCRYPT_DIR/live/$name"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 90 \
  -subj "/CN=$name" -addext "subjectAltName=DNS:$name" \
  -keyout "$HELENA_LETSENCRYPT_DIR/live/$name/privkey.pem" \
  -out "$HELENA_LETSENCRYPT_DIR/live/$name/fullchain.pem" 2>/dev/null
SH
chmod +x "$work"/bin/*

cat >"$work/inside.sh" <<'INNER'
set -euo pipefail
work=$1 here=$2
export W=$work
mount --bind "$work/helena" /etc/helena 2>/dev/null || { mkdir -p /etc/helena 2>/dev/null; mount --bind "$work/helena" /etc/helena; }
mount --bind "$work/confd" /etc/nginx/conf.d
mount --bind "$work/systemd" /etc/systemd/system
mount --bind "$work/bin" /usr/local/sbin
fail=0
check() { if [[ $3 == "$2" ]]; then echo "PASS $1"; else echo "FAIL $1: got '$3', expected '$2'"; fail=1; fi; }

# ── install.sh entry-token ─────────────────────────────────────────────────────
out=$(bash "$here/install.sh" entry-token 2>&1)
check "entry-token dry run writes nothing" 0 "$(find /etc/helena /etc/nginx/conf.d -mindepth 1 | wc -l)"
out=$(bash "$here/install.sh" --apply entry-token 2>&1)
token=$(sed -n 's/^HELENA_EDGE_ENTRY_TOKEN=//p' /etc/helena/cloudflare/entry.env)
check "a 64-hex proof" 1 "$([[ $token =~ ^[0-9a-f]{64}$ ]] && echo 1 || echo 0)"
check "env file 0600" 600 "$(stat -c '%a' /etc/helena/cloudflare/entry.env)"
check "nginx map 0600" 600 "$(stat -c '%a' /etc/nginx/conf.d/helena-edge-entry.conf)"
check "the map sends the same proof, to the web app only" 1 \
  "$(grep -c "\"127.0.0.1:8090:127.0.0.1:3001\" \"$token\";" /etc/nginx/conf.d/helena-edge-entry.conf)"
check "the map is volatile" 1 "$(grep -c '^    volatile;$' /etc/nginx/conf.d/helena-edge-entry.conf)"
check "the proof is never printed" 0 "$(grep -c "$token" <<<"$out" || true)"
for unit in volition-plan-api volition-plan-web; do
  check "drop-in for $unit" "EnvironmentFile=-/etc/helena/cloudflare/entry.env" \
    "$(sed -n 2p "/etc/systemd/system/$unit.service.d/55-helena-edge-entry.conf")"
done
check "nginx -t ran on the map and nginx reloaded" 2 "$(grep -Ec '^nginx (-t|-q -t)$|^systemctl reload nginx$' "$W/calls" || true)"
: >"$W/calls"
out=$(bash "$here/install.sh" --apply entry-token 2>&1)
check "a second run changes nothing" "install.sh: entry proof already in place" "$out"
check "a second run reloads nothing" "" "$(cat "$W/calls")"
state=$(bash "$here/install.sh" check 2>/dev/null | grep 'entry proof' || true)
check "check: present" 1 "$(grep -c 'present (0600)' <<<"$state")"
# A strict LAN entry adds the same proof under its own 443 key; rotation preserves it.
sed -i "/^}/i\\    \"192.168.2.58:443:127.0.0.1:3001\" \"$token\";" /etc/nginx/conf.d/helena-edge-entry.conf
state=$(bash "$here/install.sh" check 2>/dev/null | grep 'entry proof' || true)
check "check: present with the LAN key" 1 "$(grep -c 'present (0600)' <<<"$state")"
bash "$here/install.sh" --apply --rotate entry-token >/dev/null 2>&1
rotated=$(sed -n 's/^HELENA_EDGE_ENTRY_TOKEN=//p' /etc/helena/cloudflare/entry.env)
check "--rotate makes a new proof" 1 "$([[ $rotated != "$token" && $rotated =~ ^[0-9a-f]{64}$ ]] && echo 1 || echo 0)"
check "--rotate writes it to both nginx keys" 2 "$(grep -c "$rotated" /etc/nginx/conf.d/helena-edge-entry.conf)"
sed -i 's/[0-9a-f]\{64\}/'"$(printf '%064d' 0)"'/' /etc/nginx/conf.d/helena-edge-entry.conf
state=$(bash "$here/install.sh" check 2>/dev/null | grep 'entry proof' || true)
check "check: a mismatch between nginx and the env file is named" 1 "$(grep -c 'MISMATCH' <<<"$state")"

# ── tls-setup.sh with certbot ──────────────────────────────────────────────────
export HELENA_TLS_SETUP_TEST=1 HELENA_CLOUDFLARE_ETC=$work/cf HELENA_LETSENCRYPT_DIR=$work/le
mkdir -p "$work/cf" && chmod 0700 "$work/cf"
dns='test-only-dns-token-0123456789abcdefghijklmnop'
(umask 077; printf '%s' "$dns" >"$work/cf/dns.token")
out=$(bash "$here/tls-setup.sh" issue --email owner@example.com --accept-letsencrypt-terms 2>&1)
check "issue dry run writes no credentials" 0 "$(ls "$work/cf" | grep -c certbot || true)"
check "issue dry run shows certbot without the token" 0 "$(grep -c "$dns" <<<"$out" || true)"
out=$(bash "$here/tls-setup.sh" --apply issue --email owner@example.com --accept-letsencrypt-terms 2>&1)
check "certbot got the token through its credentials file" "dns_cloudflare_api_token = $dns" \
  "$(grep '^dns_cloudflare_api_token' "$W/certbot.creds")"
check "the credentials file is 0600" 600 "$(cat "$W/certbot.creds.mode")"
args=$(cat "$W/certbot.args")
for part in 'certonly' '--non-interactive' '--agree-tos' '-m owner@example.com' '--dns-cloudflare ' \
    "--dns-cloudflare-credentials $work/cf/certbot-dns.ini" '--dns-cloudflare-propagation-seconds 30' \
    '--cert-name helena-home.volition.one' '--key-type ecdsa' '-d helena-home.volition.one'; do
  check "certbot argument: $part" 1 "$(grep -cF -- "$part" <<<"$args")"
done
check "the token is in no argument and no output" 0 "$(grep -c "$dns" <<<"$args$out" || true)"
bash "$here/tls-setup.sh" --apply issue --email owner@example.com --accept-letsencrypt-terms \
  --also helena.volition.one >/dev/null 2>&1
check "--also adds a name" 1 "$(grep -cF -- '-d helena-home.volition.one -d helena.volition.one' "$W/certbot.args")"
: >"$W/calls"
bash "$here/tls-setup.sh" --apply renewal >/dev/null 2>&1
check "the deploy hook reloads nginx after nginx -t" 1 \
  "$(grep -c 'nginx -t -q && systemctl reload nginx' "$work/le/renewal-hooks/deploy/helena-nginx-reload")"
check "the deploy hook is executable" 755 "$(stat -c '%a' "$work/le/renewal-hooks/deploy/helena-nginx-reload")"
check "certbot.timer enabled" 1 "$(grep -c 'systemctl enable --now certbot.timer' "$W/calls")"
state=$(bash "$here/tls-setup.sh" check 2>&1)
check "check reports the certificate and its days" 1 "$(grep -Ec 'helena-home.volition.one: until .* \((89|90) days\)' <<<"$state")"
exit $fail
INNER
unshare -rmn bash "$work/inside.sh" "$work" "$here"
echo "cloudflare scripts selftest: all checks passed"
