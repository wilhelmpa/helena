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
#   sudo install.sh --apply service                    user helena-tunnel, the unit, start
#   sudo install.sh --apply nginx [--host H] [--port P]
#        the tunnel entry: 127.0.0.1:P (default 8090) for helena.volition.one
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
key_url=${CLOUDFLARE_APT_KEY_URL:-https://pkg.cloudflare.com/cloudflare-main.gpg}
repo_line_suffix='https://pkg.cloudflare.com/cloudflared any main'
keyring=/usr/share/keyrings/cloudflare-main.gpg

apply=0 fingerprint= version= cmd=
while (($#)); do
  case "$1" in
    --apply) apply=1 ;;
    --fingerprint) fingerprint=${2:-}; shift ;;
    --version) version=${2:-}; shift ;;
    --host) host=${2:-}; shift ;;
    --port) port=${2:-}; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
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
  run install -d -m 0700 -o root -g root "$etc"
  run install -m 0644 "$here/resolv.conf" "$etc/resolv.conf"
  run install -m 0755 "$here/helena-cloudflared" /usr/local/libexec/helena-cloudflared
  run install -m 0644 "$here/helena-cloudflared.service" "/etc/systemd/system/$unit.service"
  run systemctl daemon-reload
  run systemctl enable --now "$unit"
  [[ $apply -eq 1 ]] || return 0
  local i
  for i in $(seq 1 30); do sleep 1; curl -fsS -m 2 http://127.0.0.1:20241/ready >/dev/null 2>&1 && { say "connector ready"; return 0; }; done
  say "the connector did not report ready in 30 s; see: journalctl -u $unit (the token is never logged)"
  return 1
}

nginx_entry() {
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
  # Without an assertion the entry must refuse, whatever else the request carries.
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -H "Host: $host" "http://127.0.0.1:$port/")
  [[ $code == 403 ]] && say "check: a request without Cloudflare Access is refused (403)" \
    || say "WARNING: a request without Cloudflare Access got $code, expected 403 (is the API deployed with the edge guard?)"
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
  remove) remove ;;
  *) sed -n '2,24p' "$0"; exit 2 ;;
esac
