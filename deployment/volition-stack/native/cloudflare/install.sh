#!/usr/bin/env bash
# Helena's Cloudflare Tunnel: cloudflared as a hardened, outbound-only service, and nginx's
# tunnel entry on loopback. Dry run by default; --apply changes things. Idempotent.
# docs/helena-decisions/security-hardening.md §4 (design) and §6 (runbook).
#
#   sudo install.sh check                              what is there, what is missing
#   sudo install.sh --apply package --fingerprint FPR [--version V]
#        adds Cloudflare's apt repository (signed-by, key fingerprint checked against FPR,
#        which the owner reads off Cloudflare's own documentation), installs cloudflared and
#        holds the version (updates go through Helena's update center). Owner's OK needed.
#   sudo install.sh --apply token                      the OWNER pastes the tunnel token
#        (Zero Trust → Networks → Tunnels → the tunnel → install command, the part after
#        --token). Read without echo, stored root-only 0600; never printed, never logged.
#   sudo install.sh --apply service                    user helena-tunnel, the unit, start;
#        adds the user to the firewall's tunnel ACL (hardening/apply.sh firewall-uids) and
#        checks the entry the way cloudflared reaches it (as helena-tunnel)
#   sudo install.sh --apply nginx [--host H] [--port P]
#        the tunnel entry: 127.0.0.1:P (default 8090) for helena.volition.one (creates the
#        entry proof below first when it is missing)
#   sudo install.sh --apply entry-token [--rotate]
#        the tunnel entry's proof for Helena's Cloudflare sign-in: a random value nginx
#        sends on every request of the tunnel entry (conf.d/helena-edge-entry.conf, 0600)
#        and the API and web app know (/etc/helena/cloudflare/entry.env, 0600, loaded by a
#        systemd drop-in). Only a request that came through the tunnel carries it, so no
#        LAN client or local process can present an Access assertion as its own sign-in.
#        Never printed. Restart the API and the web app afterwards (the step says so).
#   sudo install.sh --apply remove                     stop the tunnel, remove the entry
#                                                      (package and token stay)
set -uo pipefail
export LC_ALL=C PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

here=$(cd "$(dirname "$0")" && pwd)
etc=/etc/helena/cloudflare
token_file=$etc/tunnel.token
tunnel_user=helena-tunnel
unit=helena-cloudflared
host=${HELENA_PUBLIC_HOST:-helena.volition.one}
port=${HELENA_TUNNEL_PORT:-8090}
site=/etc/nginx/sites-available/helena-tunnel.conf
snippet=/etc/nginx/snippets/helena-tunnel-headers.conf
entry_env=$etc/entry.env
entry_map=/etc/nginx/conf.d/helena-edge-entry.conf
entry_units=${HELENA_ENTRY_UNITS:-volition-plan-api volition-plan-web}
web_upstream=${HELENA_WEB_UPSTREAM:-127.0.0.1:3001}
key_url=${CLOUDFLARE_APT_KEY_URL:-https://pkg.cloudflare.com/cloudflare-main.gpg}
repo_line_suffix='https://pkg.cloudflare.com/cloudflared any main'
keyring=/usr/share/keyrings/cloudflare-main.gpg

apply=0 fingerprint= version= cmd= rotate=0
while (($#)); do
  case "$1" in
    --apply) apply=1 ;;
    --rotate) rotate=1 ;;
    --fingerprint) fingerprint=${2:-}; shift ;;
    --version) version=${2:-}; shift ;;
    --host) host=${2:-}; shift ;;
    --port) port=${2:-}; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) [[ -z $cmd ]] && cmd=$1 || { echo "install.sh: unexpected $1" >&2; exit 2; } ;;
  esac
  shift
done

say() { echo "install.sh: $*"; }
die() { echo "install.sh: $*" >&2; exit 1; }
run() { if [[ $apply -eq 1 ]]; then "$@"; else printf 'install.sh: [dry-run] would run:'; printf ' %q' "$@"; printf '\n'; fi; }
[[ $EUID -eq 0 ]] || die "run with sudo"
[[ $host =~ ^[a-z0-9.-]+$ ]] || die "invalid host $host"
[[ $port =~ ^[0-9]+$ ]] || die "invalid port $port"

check() {
  printf '%-34s %s\n' "cloudflared package" "$(dpkg-query -W -f='${Version}' cloudflared 2>/dev/null || echo missing)"
  printf '%-34s %s\n' "held (no automatic upgrade)" "$(apt-mark showhold 2>/dev/null | grep -qx cloudflared && echo yes || echo no)"
  printf '%-34s %s\n' "user $tunnel_user" "$(id -u "$tunnel_user" 2>/dev/null || echo missing)"
  if [[ -e $token_file ]]; then
    printf '%-34s %s\n' "tunnel token" "present, $(stat -c '%a %U:%G' "$token_file"), $( [[ -s $token_file ]] && echo non-empty || echo EMPTY)"
  else
    printf '%-34s %s\n' "tunnel token" "missing"
  fi
  printf '%-34s %s\n' "unit $unit" "$(systemctl is-active "$unit" 2>/dev/null)"
  printf '%-34s %s\n' "connector ready (metrics :20241)" "$(curl -fsS -m 3 http://127.0.0.1:20241/ready >/dev/null 2>&1 && echo yes || echo no)"
  printf '%-34s %s\n' "nginx tunnel entry" "$( [[ -L /etc/nginx/sites-enabled/helena-tunnel.conf ]] && echo "enabled ($port)" || echo "not enabled")"
  printf '%-34s %s\n' "loopback only" "$(ss -H -ltn "sport = :$port" 2>/dev/null | awk '{print $4}' | paste -sd, - || true)"
  printf '%-34s %s\n' "nft: only $tunnel_user reaches $port" "$(nft list ruleset 2>/dev/null | grep -q 'helena:acl-tunnel' && echo yes || echo 'no (hardening/apply.sh firewall)')"
  printf '%-34s %s\n' "entry proof (Cloudflare sign-in)" "$(entry_state)"
  if id "$tunnel_user" >/dev/null 2>&1; then
    printf '%-34s %s\n' "entry reachable as $tunnel_user" "$(entry_probe_as_tunnel)"
  fi
  printf '%-34s %s\n' "connector" "$(connector_state)"
}

# The tunnel entry as cloudflared reaches it: from the tunnel user, over loopback. Without
# an Access assertion the answer must be 403 (the edge check); "000" means the connection was
# refused, which is what cloudflared sees when the firewall's tunnel ACL lacks the user
# (2026-09-25: Cloudflare answered 502). Root is always allowed there, so a check as root
# proves nothing.
entry_probe_as_tunnel() {
  local code
  code=$(runuser -u "$tunnel_user" -- curl -s -o /dev/null -w '%{http_code}' -m 5 \
    -H "Host: $host" "http://127.0.0.1:$port/" 2>/dev/null || true)
  case "$code" in
    403) echo "yes (403 without Access, as it must)" ;;
    000|"") echo "NO: connection refused for $tunnel_user (hardening/apply.sh --apply firewall-uids)" ;;
    *) echo "answers $code, expected 403 (is the API deployed with the edge guard?)" ;;
  esac
}

# cloudflared's own view (metrics on 127.0.0.1:20241): connections to Cloudflare's edge, and
# how often it could not reach the origin (a refused or failing tunnel entry).
connector_state() {
  local ready metrics conns errors requests
  ready=$(curl -fsS -m 3 http://127.0.0.1:20241/ready 2>/dev/null) || { echo "not ready (no metrics on :20241)"; return; }
  conns=$(python3 -I -c 'import json,sys; print(json.load(sys.stdin).get("readyConnections", 0))' <<<"$ready" 2>/dev/null || echo 0)
  metrics=$(curl -fsS -m 3 http://127.0.0.1:20241/metrics 2>/dev/null || true)
  errors=$(awk '$1 == "cloudflared_tunnel_request_errors" {print int($2)}' <<<"$metrics")
  requests=$(awk '$1 == "cloudflared_tunnel_total_requests" {print int($2)}' <<<"$metrics")
  echo "$conns edge connection(s), ${requests:-0} request(s), ${errors:-0} origin error(s) since start"
}

# The entry proof: present in nginx and in the env file, with the same value (compared
# without printing it), and the drop-ins that load it.
entry_state() {
  [[ -s $entry_env && -s $entry_map ]] || { echo "missing (install.sh --apply entry-token)"; return; }
  local a b
  a=$(sed -n 's/^HELENA_EDGE_ENTRY_TOKEN=//p' "$entry_env" | sha256sum | cut -c1-12)
  b=$(grep -o '"[0-9a-f]\{64\}"' "$entry_map" | tr -d '"' | sha256sum | cut -c1-12)
  [[ $a == "$b" ]] || { echo "MISMATCH between nginx and the env file (install.sh --apply entry-token)"; return; }
  local unit missing=()
  for unit in $entry_units; do
    [[ -e /etc/systemd/system/$unit.service.d/55-helena-edge-entry.conf ]] || missing+=("$unit")
  done
  ((${#missing[@]})) && echo "present, drop-in missing for ${missing[*]}" || echo "present (0600), loaded by $entry_units"
}

entry_map_text() { # entry_map_text TOKEN
  printf '%s\n' \
    "# Helena: the tunnel entry's proof for the web app (cloudflare/install.sh entry-token)." \
    "# Secret: 0600 root. Sent only by the tunnel entry (127.0.0.1:$port), only to the web" \
    "# app ($web_upstream); every other request and upstream gets an empty value (no header)." \
    "# volatile: the auth subrequests (other upstream) share the request's variables; a cached" \
    "# value from one of them must not decide the main request's header." \
    "map \"\$server_addr:\$server_port:\$proxy_host\" \$helena_edge_entry_token {" \
    "    volatile;" \
    "    default \"\";" \
    "    \"127.0.0.1:$port:$web_upstream\" \"$1\";" \
    "}"
}

# Writes the proof into nginx and the env file (a new one with --rotate or when missing),
# plus the drop-ins. Returns 0 when something changed, 1 when all was in place.
entry_token() {
  local token= changed=1
  [[ $web_upstream =~ ^[0-9.]+:[0-9]+$ ]] || die "invalid HELENA_WEB_UPSTREAM"
  if [[ $apply -eq 0 ]]; then
    if [[ -s $entry_env && $rotate -eq 0 ]]; then say "[dry-run] entry proof present; would rewrite $entry_map for port $port if needed"
    else say "[dry-run] would create a new entry proof in $entry_env and $entry_map (0600 root)"; fi
    for unit in $entry_units; do say "[dry-run] would add /etc/systemd/system/$unit.service.d/55-helena-edge-entry.conf"; done
    return 1
  fi
  install -d -m 0700 -o root -g root /etc/helena "$etc"
  if [[ $rotate -eq 0 && -s $entry_env ]]; then
    token=$(sed -n 's/^HELENA_EDGE_ENTRY_TOKEN=//p' "$entry_env")
  fi
  if [[ ! $token =~ ^[0-9a-f]{64}$ ]]; then
    token=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
    (umask 077; printf 'HELENA_EDGE_ENTRY_TOKEN=%s\n' "$token" >"$entry_env.new")
    chown root:root "$entry_env.new"; chmod 0600 "$entry_env.new"; mv -f "$entry_env.new" "$entry_env"
    changed=0
    say "new entry proof in $entry_env (0600 root; not printed)"
  fi
  local rendered
  rendered=$(umask 077; mktemp /etc/nginx/conf.d/.helena-edge-entry.XXXXXX)
  entry_map_text "$token" >"$rendered"
  unset token
  if [[ -e $entry_map ]] && cmp -s "$rendered" "$entry_map"; then
    rm -f "$rendered"
  else
    [[ -e $entry_map ]] && cp -a "$entry_map" "$rendered.old"
    chmod 0600 "$rendered"; mv -f "$rendered" "$entry_map"
    if ! nginx -t 2>/dev/null; then
      if [[ -e $rendered.old ]]; then mv -f "$rendered.old" "$entry_map"; else rm -f "$entry_map"; fi
      die "nginx refused $entry_map; the old state is back"
    fi
    rm -f "$rendered.old"
    systemctl reload nginx
    changed=0
    say "nginx sends the entry proof on 127.0.0.1:$port"
  fi
  local unit dropin text
  text=$'[Service]\nEnvironmentFile=-'"$entry_env"$'\n'
  for unit in $entry_units; do
    dropin=/etc/systemd/system/$unit.service.d/55-helena-edge-entry.conf
    if [[ ! -e $dropin ]] || [[ $(cat "$dropin") != "${text%$'\n'}" ]]; then
      install -d -m 0755 "$(dirname "$dropin")"
      printf '%s' "$text" >"$dropin"; chmod 0644 "$dropin"
      changed=0
    fi
  done
  if [[ $changed -eq 0 ]]; then
    systemctl daemon-reload
    say "restart $entry_units at a quiet moment (no chat answer or run in flight) so they read it"
  fi
  return $changed
}

package() {
  [[ -n $fingerprint ]] || die "pass --fingerprint with the key fingerprint from Cloudflare's documentation"
  local tmp; tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  say "fetching Cloudflare's apt key from $key_url"
  curl -fsSL -m 30 "$key_url" -o "$tmp/key" || die "download failed"
  local got
  got=$(gpg --show-keys --with-colons "$tmp/key" 2>/dev/null | awk -F: '$1=="fpr" {print $10; exit}')
  [[ ${got^^} == "${fingerprint^^// /}" ]] || die "key fingerprint $got does not match $fingerprint; not trusting it"
  say "key fingerprint matches"
  run install -d -m 0755 /usr/share/keyrings
  if [[ $apply -eq 1 ]]; then gpg --dearmor <"$tmp/key" >"$tmp/key.gpg" 2>/dev/null || cp "$tmp/key" "$tmp/key.gpg"; fi
  run install -m 0644 "$tmp/key.gpg" "$keyring"
  if [[ $apply -eq 1 ]]; then
    echo "deb [signed-by=$keyring] $repo_line_suffix" >/etc/apt/sources.list.d/cloudflared.list
  else
    say "[dry-run] would write /etc/apt/sources.list.d/cloudflared.list: deb [signed-by=$keyring] $repo_line_suffix"
  fi
  run apt-get update -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/cloudflared.list -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0
  run apt-get install -y --no-install-recommends "cloudflared${version:+=$version}"
  run apt-mark hold cloudflared
  # The package's own service (cloudflared.service from `cloudflared service install`) is
  # not used; Helena's unit is.
}

token() {
  run install -d -m 0700 -o root -g root /etc/helena "$etc"
  if [[ $apply -eq 0 ]]; then say "[dry-run] would read the token from the terminal (no echo) into $token_file (0600 root)"; return; fi
  [[ -t 0 ]] || die "run this in a terminal: the token is read without echo"
  local value
  read -rsp "Tunnel token or the whole install command (input hidden, Enter to finish): " value; echo
  # Cloudflare's copy button copies the whole command ("sudo cloudflared service install
  # <token>" or "cloudflared tunnel run --token <token>"): the token is its last word.
  value=${value%"${value##*[![:space:]]}"}
  value=${value##*[[:space:]]}
  [[ ${#value} -ge 100 && $value =~ ^[A-Za-z0-9+/=_-]+$ ]] || die "that does not look like a tunnel token; nothing written"
  (umask 077; printf '%s' "$value" >"$token_file.new")
  unset value
  chown root:root "$token_file.new"; chmod 0600 "$token_file.new"; mv -f "$token_file.new" "$token_file"
  say "token stored in $token_file (0600 root). It was not printed."
}

service() {
  command -v cloudflared >/dev/null || die "cloudflared is not installed (install.sh package)"
  [[ -s $token_file ]] || die "no tunnel token yet (install.sh token)"
  id "$tunnel_user" >/dev/null 2>&1 || run useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$tunnel_user"
  # The firewall names the tunnel user by uid: a firewall loaded before the user existed
  # lets only root reach the entry. Complete its uid sets now (live and installed).
  if [[ -x $here/../hardening/apply.sh ]]; then
    if [[ $apply -eq 1 ]]; then "$here/../hardening/apply.sh" --apply firewall-uids || die "could not add $tunnel_user to the firewall's tunnel ACL"
    else "$here/../hardening/apply.sh" firewall-uids || true; fi
  fi
  run install -d -m 0700 -o root -g root "$etc"
  run install -m 0644 "$here/resolv.conf" "$etc/resolv.conf"
  run install -m 0755 "$here/helena-cloudflared" /usr/local/libexec/helena-cloudflared
  run install -m 0644 "$here/helena-cloudflared.service" "/etc/systemd/system/$unit.service"
  run systemctl daemon-reload
  run systemctl enable --now "$unit"
  [[ $apply -eq 1 ]] || return 0
  local i
  for i in $(seq 1 30); do
    sleep 1
    if curl -fsS -m 2 http://127.0.0.1:20241/ready >/dev/null 2>&1; then
      say "connector ready: $(connector_state)"
      if [[ -e /etc/nginx/sites-enabled/helena-tunnel.conf ]]; then entry_self_check || return 1; fi
      return 0
    fi
  done
  say "the connector did not report ready in 30 s; see: journalctl -u $unit (the token is never logged)"
  return 1
}

# After the service or the entry changed: the entry answers the tunnel user with 403.
entry_self_check() {
  local verdict
  verdict=$(entry_probe_as_tunnel)
  case "$verdict" in
    yes*) say "check: as $tunnel_user, a request without Cloudflare Access is refused (403)" ;;
    *) say "WARNING: entry as $tunnel_user: $verdict"; return 1 ;;
  esac
}

nginx_entry() {
  # The headers snippet names $helena_edge_entry_token: the map must exist first.
  if [[ ! -e $entry_map ]]; then entry_token || true; fi
  local rendered; rendered=$(mktemp)
  sed -e "s|@HOST@|$host|g" -e "s|@PORT@|$port|g" "$here/nginx-tunnel.conf.in" >"$rendered"
  if [[ -e $site ]]; then diff -u "$site" "$rendered" || true; else say "new $site for $host on 127.0.0.1:$port"; fi
  [[ $apply -eq 1 ]] || { rm -f "$rendered"; return 0; }
  local backup=/var/lib/helena/hardening/backup/tunnel-$(date +%Y%m%d-%H%M%S)
  install -d -m 0700 "$backup"
  [[ -e $site ]] && cp -a "$site" "$backup/"
  [[ -e $snippet ]] && cp -a "$snippet" "$backup/"
  install -m 0644 "$here/helena-tunnel-headers.conf" "$snippet"
  install -m 0644 "$rendered" "$site"; rm -f "$rendered"
  ln -sfn "$site" /etc/nginx/sites-enabled/helena-tunnel.conf
  if ! nginx -t 2>/dev/null; then
    rm -f /etc/nginx/sites-enabled/helena-tunnel.conf
    [[ -e $backup/helena-tunnel.conf ]] && cp -a "$backup/helena-tunnel.conf" "$site"
    [[ -e $backup/helena-tunnel-headers.conf ]] && cp -a "$backup/helena-tunnel-headers.conf" "$snippet"
    nginx -t 2>&1 | tail -3
    die "nginx refused the tunnel entry; disabled again"
  fi
  systemctl reload nginx
  say "tunnel entry on 127.0.0.1:$port for $host"
  # Without an assertion the entry must refuse, whatever else the request carries; checked
  # as the tunnel user, the way cloudflared reaches it (root passes the firewall anyway).
  if id "$tunnel_user" >/dev/null 2>&1; then
    entry_self_check || true
    systemctl is-active --quiet "$unit" && say "connector: $(connector_state)"
  else
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -H "Host: $host" "http://127.0.0.1:$port/")
    [[ $code == 403 ]] && say "check (as root; $tunnel_user does not exist yet): a request without Cloudflare Access is refused (403)" \
      || say "WARNING: a request without Cloudflare Access got $code, expected 403 (is the API deployed with the edge guard?)"
  fi
}

remove() {
  run systemctl disable --now "$unit"
  run rm -f /etc/nginx/sites-enabled/helena-tunnel.conf
  run nginx -t
  run systemctl reload nginx
  say "tunnel stopped and entry disabled; cloudflared, the token and $site stay (delete the token with: sudo shred -u $token_file)"
}

case "$cmd" in
  check) check ;;
  package) package ;;
  token) token ;;
  service) service ;;
  nginx) nginx_entry ;;
  entry-token) if entry_token; then :; elif [[ $apply -eq 1 ]]; then say "entry proof already in place"; fi ;;
  remove) remove ;;
  *) sed -n '2,32p' "$0"; exit 2 ;;
esac
