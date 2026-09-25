#!/usr/bin/env bash
# Tests notes/install.sh without root and without touching the running system:
#   1. the rendered files say what the design says (docs/helena-decisions/notes-silverbullet.md);
#   2. `systemd-analyze verify` accepts the unit, `nginx -t` accepts both entries together with
#      the snippets they include;
#   3. with a SilverBullet binary (--e2e BINARY): SilverBullet on a scratch vault behind the
#      rendered home entry on unprivileged ports, a fake Helena answering the owner check, and
#      the requests a browser and an attacker would make.
#
#   tests/install-selftest.sh [--e2e /path/to/silverbullet]
set -uo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)     # native/notes
native=$(cd "$here/.." && pwd)
binary=
[[ ${1:-} == --e2e ]] && binary=${2:-}

work=$(mktemp -d "${TMPDIR:-/tmp}/helena-notes-selftest.XXXXXX")
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done; rm -rf "$work"; }
trap cleanup EXIT
fails=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; fails=$((fails + 1)); }
expect() { # expect NAME ACTUAL WANTED
  if [[ $2 == "$3" ]]; then pass "$1 ($2)"; else fail "$1: got $2, want $3"; fi
}
has() { # has NAME FILE REGEX
  if grep -Eq -- "$3" "$2"; then pass "$1"; else fail "$1: /$3/ not in $(basename "$2")"; fi
}
hasnt() {
  if grep -Eq -- "$3" "$2"; then fail "$1: /$3/ in $(basename "$2")"; else pass "$1"; fi
}

render() { "$here/install.sh" render "$1" >"$work/$2" || fail "render $1"; }
render unit unit.service
render common common.conf
render proxy proxy.conf
render home home.conf
render tunnel tunnel.conf
render config CONFIG.md
render web web.conf

# ── 1. What the rendered files say ────────────────────────────────────────────────────
u=$work/unit.service
has "unit: single-space mode on the vault" "$u" '^ExecStart=/opt/helena/notes/current/silverbullet --single /srv/volition/vault$'
has "unit: Unix socket only" "$u" '^Environment=SB_UNIX_SOCKET=/run/helena-notes/notes.sock$'
has "unit: no shell" "$u" '^Environment=SB_SHELL_BACKEND=off$'
has "unit: no headless runtime" "$u" '^Environment=SB_RUNTIME_API=0$'
has "unit: no git of its own" "$u" '^Environment=SB_REVISIONS=disabled$'
has "unit: no network" "$u" '^PrivateNetwork=yes$'
has "unit: AF_UNIX only" "$u" '^RestrictAddressFamilies=AF_UNIX$'
has "unit: Private/ and .git unreachable" "$u" '^InaccessiblePaths=-/srv/volition/vault/\.git -/srv/volition/vault/Private '
has "unit: only the vault under /srv" "$u" '^TemporaryFileSystem=/srv:ro$'
has "unit: socket folder for nginx only" "$u" 'install -d -m 2750 -o helena-notes -g www-data /run/helena-notes'
has "unit: vault group" "$u" '^SupplementaryGroups=volition$'
hasnt "unit: no capabilities" "$u" '^AmbientCapabilities=.+'

c=$work/common.conf
has "nginx: owner check on every request" "$c" '^auth_request /_helena_notes_auth;'
has "nginx: dot paths refused" "$c" 'location ~ \^/\\\.fs/\(\.\*/\)\?\\\. \{'
has "nginx: Private/ refused" "$c" 'location ~ \^/\\\.fs/Private\(/\|\$\) \{'
has "nginx: SilverBullet's own endpoints closed" "$c" '^location \^~ /\. \{'
hasnt "nginx: /.fs/ is no ^~ location (the refusals must be checked)" "$c" 'location \^~ /\.fs'
has "nginx: CSP connect-src self" "$c" "connect-src 'self';"
has "nginx: framed by Helena only" "$c" 'frame-ancestors https://helena-home\.volition\.one https://helena\.volition\.one"'
# The strings hardening/audit.sh (svc.notes) looks for in the installed snippet.
for rule in 'location ~ ^/\.fs/Private(/|$)' 'location ~ ^/\.fs/(.*/)?\.' "connect-src 'self'"; do
  grep -Fq "$rule" "$c" && pass "audit finds: $rule" || fail "audit would not find: $rule"
done
grep -q '^auth_request /_helena_notes_auth;' "$c" && pass "audit finds the owner check" || fail "audit would not find the owner check"
grep -q 'elements = { 22, 80, 443, 8446, 22000 }' "$native/hardening/files/helena-hardening.nft.in" \
  && pass "firewall template opens 8446 for the home network" || fail "firewall template lacks 8446"
has "proxy: no cookie to SilverBullet" "$work/proxy.conf" '^proxy_set_header Cookie "";'
has "proxy: no Set-Cookie from SilverBullet" "$work/proxy.conf" '^proxy_hide_header Set-Cookie;'
has "proxy: no Access assertion to SilverBullet" "$work/proxy.conf" '^proxy_set_header Cf-Access-Jwt-Assertion "";'
has "home: owner check at the API" "$work/home.conf" 'proxy_pass http://127\.0\.0\.1:3000/auth/verify/notes;'
has "home: never a tunnel request" "$work/home.conf" 'proxy_set_header X-Helena-Entry "";'
has "home: no LAN owner capability" "$work/home.conf" 'proxy_set_header X-Volition-Local-Access "";'
has "tunnel: tunnel headers on the check" "$work/tunnel.conf" 'include /etc/nginx/snippets/helena-tunnel-headers\.conf;'
has "tunnel: loopback only" "$work/tunnel.conf" '^    listen 127\.0\.0\.1:8090;$'
has "config: journal where Helena keeps it" "$work/CONFIG.md" 'config\.set\("journal\.prefix", "Home/Docs/Journal/"\)'
has "config: task links to Helena" "$work/CONFIG.md" '\["helena-home\.volition\.one:8446"\] = "https://helena-home\.volition\.one"'
if python3 -c 'import json,sys,re; t=open(sys.argv[1]).read(); m=re.search(r"HELENA_NOTES_URLS=(.*)'"'"'", t); d=json.loads(m.group(1)); assert d=={"https://helena-home.volition.one":"https://helena-home.volition.one:8446","https://helena.volition.one":"https://helena-notes.volition.one"}, d' "$work/web.conf"; then
  pass "web: HELENA_NOTES_URLS maps each Helena origin to its notes origin"
else fail "web: HELENA_NOTES_URLS"; fi
if grep -q "DAILY_NOTES_FOLDER = 'Home/Docs/Journal'" "$native/../../../packages/knowledge/src/templates.ts" 2>/dev/null; then
  pass "config: journal folder matches packages/knowledge DEFAULT_DAILY_NOTES"
else fail "config: journal folder differs from packages/knowledge DEFAULT_DAILY_NOTES"; fi

# ── 2. systemd and nginx accept them ──────────────────────────────────────────────────
if command -v systemd-analyze >/dev/null; then
  cp "$u" "$work/helena-notes.service"
  out=$(systemd-analyze verify --man=no "$work/helena-notes.service" 2>&1 | grep -Ev 'User=|Group=|helena-notes|not found|No such|Failed to resolve|^$' || true)
  [[ -z $out ]] && pass "systemd-analyze verify" || fail "systemd-analyze verify: $out"
fi

nginx_conf() { # nginx_conf DIR SOCKET AUTH_PORT HOME_PORT TUNNEL_PORT
  local d=$1
  mkdir -p "$d"/{snippets,sites,certs,conf.d}
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 \
    -subj "/CN=helena-home.volition.one" -addext "subjectAltName=DNS:helena-home.volition.one" \
    -keyout "$d/certs/privkey.pem" -out "$d/certs/fullchain.pem" 2>/dev/null
  printf 'ssl_protocols TLSv1.2 TLSv1.3;\nssl_session_cache shared:helena_tls:1m;\n' >"$d/snippets/helena-tls.conf"
  cp "$native/cloudflare/helena-tunnel-headers.conf" "$d/snippets/"
  cp "$work/common.conf" "$d/snippets/helena-notes-common.conf"
  sed "s|unix:/run/helena-notes/notes.sock:|unix:$2:|" "$work/proxy.conf" >"$d/snippets/helena-notes-proxy.conf"
  printf 'map $http_cf_connecting_ip $helena_tunnel_client { "" "0.0.0.0"; default $http_cf_connecting_ip; }\n' >"$d/conf.d/tunnel.conf"
  printf 'map "$server_addr:$server_port:$proxy_host" $helena_edge_entry_token { volatile; default ""; }\n' >>"$d/conf.d/tunnel.conf"
  for f in home tunnel; do
    sed -e "s|/etc/nginx/snippets/|$d/snippets/|g" -e "s|/etc/letsencrypt/live/helena-home.volition.one|$d/certs|g" \
      -e "s|listen 8446 ssl;|listen 127.0.0.1:$4 ssl;|" -e "s|listen \[::\]:8446 ssl;||" \
      -e "s|127.0.0.1:8090;|127.0.0.1:$5;|" -e "s|127.0.0.1:3000/auth|127.0.0.1:$3/auth|" "$work/$f.conf" >"$d/sites/$f.conf"
  done
  sed -i "s|/etc/nginx/snippets/|$d/snippets/|g" "$d/snippets/"*.conf
  cat >"$d/nginx.conf" <<EOF
pid $d/nginx.pid;
error_log $d/error.log;
daemon off;
events {}
http {
    access_log off;
    include /etc/nginx/mime.types;
    client_body_temp_path $d/body;
    proxy_temp_path $d/proxy;
    fastcgi_temp_path $d/fastcgi;
    uwsgi_temp_path $d/uwsgi;
    scgi_temp_path $d/scgi;
    include $d/conf.d/*.conf;
    include $d/sites/*.conf;
}
EOF
}
if [[ -x /usr/sbin/nginx ]]; then
  nginx_conf "$work/ng" /run/helena-notes/notes.sock 3000 18446 18090
  if /usr/sbin/nginx -t -q -p "$work/ng" -c "$work/ng/nginx.conf" 2>"$work/ng/t.err"; then
    pass "nginx -t: home entry + tunnel entry + snippets"
  else fail "nginx -t: $(grep -v 'user" directive' "$work/ng/t.err" | tail -3)"; fi
fi

# ── 3. End to end with the real binary ────────────────────────────────────────────────
if [[ -n $binary ]]; then
  [[ -x $binary ]] || { fail "no binary at $binary"; binary=; }
fi
if [[ -n $binary && -x /usr/sbin/nginx ]]; then
  v=$work/vault; mkdir -p "$v"/{Home/Docs,Projects/VOL/Docs,Private,.git/hooks,.trash}
  printf '# Notiz\n[[VOL-1]]\n' >"$v/Projects/VOL/Docs/Notiz.md"
  printf '# Geheim\n' >"$v/Private/Geheim.md"
  printf '[core]\n' >"$v/.git/config"
  printf '{"nodes":[],"edges":[]}\n' >"$v/Projects/VOL/board.canvas"
  sock=$work/notes.sock
  SB_UNIX_SOCKET=$sock SB_SHELL_BACKEND=off SB_RUNTIME_API=0 SB_REVISIONS=disabled SB_NAME=Notizen \
    SB_FS_WATCH=poll SB_FS_POLL_INTERVAL=5 RUST_LOG=error SB_SPACE_IGNORE=$'/Private/\n*.canvas\n*.sync-conflict-*' \
    "$binary" --single "$v" >"$work/sb.log" 2>&1 &
  pids+=($!)
  # A fake Helena: 204 for the owner's cookie, 401 without one, 403 for an API key.
  cat >"$work/auth.py" <<'PY'
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get('x-api-key') or self.headers.get('authorization'):
            code = 403
        elif 'owner-session=1' in (self.headers.get('cookie') or ''):
            code = 204
        else:
            code = 401
        self.send_response(code); self.end_headers()
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
PY
  python3 "$work/auth.py" 18300 & pids+=($!)
  nginx_conf "$work/e2e" "$sock" 18300 18447 18091
  /usr/sbin/nginx -p "$work/e2e" -c "$work/e2e/nginx.conf" 2>"$work/e2e/start.err" & pids+=($!)
  for _ in $(seq 1 50); do
    [[ -S $sock ]] && curl -s -o /dev/null http://127.0.0.1:18300/ \
      && curl -sk -o /dev/null https://127.0.0.1:18447/.client/manifest.json && break
    sleep 0.2
  done
  base=https://helena-home.volition.one:18447
  r=(-sk --resolve helena-home.volition.one:18447:127.0.0.1 -m 5)
  code() { curl "${r[@]}" -o /dev/null -w '%{http_code}' "$@"; }
  expect "no session: the page" "$(code "$base/")" 401
  curl "${r[@]}" "$base/" | grep -q 'Bei Helena anmelden' && pass "no session: sign-in hint" || fail "no session: sign-in hint"
  expect "API key: refused" "$(code -H 'x-api-key: k' -b owner-session=1 "$base/")" 403
  expect "client code without a session" "$(code "$base/.client/client.js")" 200
  expect "service worker without a session" "$(code "$base/service_worker.js")" 200
  expect "owner: the page" "$(code -b owner-session=1 "$base/Projects/VOL/Docs/Notiz")" 200
  expect "owner: a note" "$(code -b owner-session=1 "$base/.fs/Projects/VOL/Docs/Notiz.md")" 200
  expect "owner: .git refused" "$(code -b owner-session=1 "$base/.fs/.git/config")" 404
  expect "owner: .git refused (encoded dot)" "$(code -b owner-session=1 "$base/.fs/%2Egit/config")" 404
  expect "owner: .git refused (dot segment)" "$(code --path-as-is -b owner-session=1 "$base/.fs/Projects/../.git/config")" 404
  expect "owner: .git write refused" "$(code -b owner-session=1 -X PUT --data-binary x "$base/.fs/.git/hooks/post-commit")" 404
  expect "owner: hidden file refused" "$(code -b owner-session=1 "$base/.fs/Projects/.hidden.md")" 404
  expect "owner: Private/ refused" "$(code -b owner-session=1 "$base/.fs/Private/Geheim.md")" 404
  expect "owner: Private/ refused (encoded)" "$(code -b owner-session=1 "$base/.fs/Priv%61te/Geheim.md")" 404
  expect "owner: shell closed" "$(code -b owner-session=1 -X POST -d '{}' "$base/.shell")" 404
  expect "owner: server-side fetch closed" "$(code -b owner-session=1 "$base/.proxy/example.com/")" 404
  expect "owner: runtime closed" "$(code -b owner-session=1 "$base/.runtime/logs")" 404
  expect "owner: dashboard closed" "$(code -b owner-session=1 "$base/.dashboard")" 404
  expect "owner: metrics closed" "$(code -b owner-session=1 "$base/metrics")" 404
  expect "owner: settings" "$(code -b owner-session=1 "$base/.config")" 200
  listing=$(curl "${r[@]}" -b owner-session=1 "$base/.fs")
  grep -q 'Projects/VOL/Docs/Notiz.md' <<<"$listing" && pass "listing: notes" || fail "listing: notes missing"
  grep -Eq '"Private/|board\.canvas|\.git/' <<<"$listing" && fail "listing shows Private/, boards or .git" || pass "listing: no Private/, boards or .git"
  expect "owner: write a note" "$(code -b owner-session=1 -X PUT --data-binary '# Neu' "$base/.fs/Projects/VOL/Docs/Neu.md")" 200
  [[ -f $v/Projects/VOL/Docs/Neu.md ]] && pass "the note is a file in the vault" || fail "the note did not reach the vault"
  headers=$(curl "${r[@]}" -D - -o /dev/null -b owner-session=1 "$base/Projects/VOL/Docs/Notiz")
  grep -qi "^content-security-policy: .*connect-src 'self'.*frame-ancestors https://helena-home.volition.one https://helena.volition.one" <<<"$headers" \
    && pass "headers: CSP with connect-src self and Helena's origins as frame ancestors" || fail "headers: CSP"
  grep -qi '^set-cookie' <<<"$headers" && fail "headers: a cookie was set" || pass "headers: no cookie"
  grep -qi '^x-content-type-options: nosniff' <<<"$headers" && pass "headers: nosniff" || fail "headers: nosniff"
  # The tunnel entry: the check's answer decides (403 without Access, from the fake Helena's view
  # an API-less request without cookie is 401, so the tunnel's own page answers 401 here too).
  expect "tunnel entry answers for its name" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: helena-notes.volition.one' http://127.0.0.1:18091/)" 401
else
  echo "SKIP end to end (pass --e2e /path/to/silverbullet)"
fi

echo
if [[ $fails -eq 0 ]]; then echo "notes selftest: all passed"; else echo "notes selftest: $fails failed"; exit 1; fi
