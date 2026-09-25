#!/usr/bin/env bash
# Helena Notizen: SilverBullet (silverbullet.md, MIT) on the knowledge vault, shown in Helena as
# the tool "Notizen". Dry run by default; --apply changes things. Idempotent.
# docs/helena-decisions/notes-silverbullet.md (decision, design, runbook).
#
#   sudo install.sh check                         what is there, what is missing
#   sudo install.sh [--apply] binary              the pinned release (release.env): download,
#                                                 check its sha256, unpack to /opt/helena/notes
#   sudo install.sh [--apply] service             user helena-notes, the unit, start it; the
#                                                 notes' settings page CONFIG.md into the vault
#                                                 when it has none (--force-config: rewrite it)
#   sudo install.sh [--apply] nginx-home [--home-host H] [--port P]
#                                                 https://H:P on the home network (default
#                                                 helena-home.volition.one:8446); opens P for the
#                                                 home network in the firewall
#   sudo install.sh [--apply] nginx-tunnel [--notes-host N]
#                                                 https://N through the tunnel (default
#                                                 helena-notes.volition.one). Only after the owner
#                                                 made N a public hostname of the tunnel and a
#                                                 destination of Helena's Access application
#   sudo install.sh [--apply] web                 tells the web app where the notes are on each
#                                                 of Helena's origins (restart the web app after)
#   sudo install.sh [--apply] all                 binary, service, nginx-home, web
#   sudo install.sh [--apply] obsidian-leftovers  moves the vault's .obsidian/ folder to the
#                                                 delete folder (the owner deletes it for good)
#   sudo install.sh [--apply] remove              stops the notes and closes their entries (the
#                                                 binary, the unit file and every note stay)
#   install.sh render unit|common|proxy|home|tunnel|config|web
#                                                 prints a rendered file (no root; for the tests)
set -uo pipefail
export LC_ALL=C PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=release.env
. "$here/release.env"

vault=${HELENA_VAULT:-/srv/volition/vault}
vault_group=${HELENA_VAULT_GROUP:-volition}
prefix=${HELENA_NOTES_PREFIX:-/opt/helena/notes}
unit=helena-notes
notes_user=helena-notes
socket=/run/helena-notes/notes.sock
home_host=${HELENA_HOME_HOST:-helena-home.volition.one}
port=${HELENA_NOTES_PORT:-8446}
public_host=${HELENA_PUBLIC_HOST:-helena.volition.one}
notes_host=${HELENA_NOTES_HOST:-helena-notes.volition.one}
tunnel_port=${HELENA_TUNNEL_PORT:-8090}
cert_dir=${HELENA_HOME_CERT_DIR:-}
web_unit=${HELENA_WEB_UNIT:-volition-plan-web}
# The daily notes' folder: packages/knowledge DEFAULT_DAILY_NOTES.folder says the same.
journal_folder=Home/Docs/Journal
index_page=ordner:Home
delete_root=/var/backups/helena-zum-loeschen

snippets=/etc/nginx/snippets
home_site=/etc/nginx/sites-available/helena-notes-home.conf
home_enabled=/etc/nginx/sites-enabled/helena-notes-home.conf
# Sorts after helena-tunnel.conf, so helena.volition.one stays the entry's default server.
tunnel_site=/etc/nginx/sites-available/helena-tunnel.notes.conf
tunnel_enabled=/etc/nginx/sites-enabled/helena-tunnel.notes.conf
web_dropin=/etc/systemd/system/$web_unit.service.d/70-helena-notes.conf

apply=0 force_config=0 cmd= what=
while (($#)); do
  case "$1" in
    --apply) apply=1 ;;
    --force-config) force_config=1 ;;
    --home-host) home_host=${2:-}; shift ;;
    --port) port=${2:-}; shift ;;
    --notes-host) notes_host=${2:-}; shift ;;
    -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
    *)
      if [[ -z $cmd ]]; then cmd=$1
      elif [[ $cmd == render && -z $what ]]; then what=$1
      else echo "install.sh: unexpected $1" >&2; exit 2; fi ;;
  esac
  shift
done
[[ -n $cert_dir ]] || cert_dir=/etc/letsencrypt/live/$home_host

say() { echo "install.sh: $*"; }
die() { echo "install.sh: $*" >&2; exit 1; }
run() { if [[ $apply -eq 1 ]]; then "$@"; else printf 'install.sh: [dry-run] would run:'; printf ' %q' "$@"; printf '\n'; fi; }

host_ok() { [[ $1 =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; }
host_ok "$home_host" || die "invalid home host $home_host"
host_ok "$public_host" || die "invalid public host $public_host"
host_ok "$notes_host" || die "invalid notes host $notes_host"
[[ $port =~ ^[0-9]{2,5}$ && $port -ne 443 && $port -ne 80 ]] || die "invalid port $port"
[[ $tunnel_port =~ ^[0-9]{2,5}$ ]] || die "invalid tunnel port $tunnel_port"
[[ $vault == /* && $vault != *[[:space:]]* ]] || die "invalid vault path $vault"

arch_sha() {
  case "$(uname -m)" in
    x86_64) echo "x86_64 $HELENA_NOTES_SHA256_X86_64" ;;
    aarch64|arm64) echo "aarch64 $HELENA_NOTES_SHA256_AARCH64" ;;
    *) return 1 ;;
  esac
}
binary_path() { echo "$prefix/current/silverbullet"; }

# ── Rendering (pure: templates and settings in, text out) ─────────────────────────────

home_origin() { echo "https://$home_host"; }
home_notes_origin() { echo "https://$home_host:$port"; }
public_origin() { echo "https://$public_host"; }
tunnel_notes_origin() { echo "https://$notes_host"; }

render_unit() {
  sed -e "s|@VAULT@|$vault|g" -e "s|@BINARY@|$(binary_path)|g" -e "s|@INDEX_PAGE@|$index_page|g" \
    -e "s|^SupplementaryGroups=volition$|SupplementaryGroups=$vault_group|" \
    "$here/helena-notes.service.in"
}
render_common() {
  sed -e "s|@FRAME_ANCESTORS@|$(home_origin) $(public_origin)|g" "$here/helena-notes-common.conf.in"
}
render_home() {
  sed -e "s|@HOME_HOST@|$home_host|g" -e "s|@PORT@|$port|g" -e "s|@CERT_DIR@|$cert_dir|g" \
    "$here/nginx-notes-home.conf.in"
}
render_tunnel() {
  sed -e "s|@NOTES_HOST@|$notes_host|g" -e "s|@PUBLIC_HOST@|$public_host|g" \
    -e "s|@TUNNEL_PORT@|$tunnel_port|g" "$here/nginx-notes-tunnel.conf.in"
}
render_config() {
  local origins
  origins=$(printf '  ["%s:%s"] = "%s",\n  ["%s"] = "%s",' \
    "$home_host" "$port" "$(home_origin)" "$notes_host" "$(public_origin)")
  python3 -I - "$here/CONFIG.md.in" "$journal_folder" "$origins" <<'PY'
import sys
path, journal, origins = sys.argv[1:4]
text = open(path, encoding='utf-8').read()
sys.stdout.write(text.replace('@JOURNAL_FOLDER@', journal).replace('@HELENA_ORIGINS@', origins))
PY
}
# The web app's map of Helena's origins to the notes' origin on each (HELENA_NOTES_URLS,
# apps/web utils/runtimeEnv.ts). Only entries that are installed: $1 home on/off, $2 tunnel.
notes_urls_json() {
  python3 -I - "$1" "$2" "$(home_origin)" "$(home_notes_origin)" "$(public_origin)" "$(tunnel_notes_origin)" <<'PY'
import json, sys
home, tunnel, home_origin, home_notes, public_origin, tunnel_notes = sys.argv[1:7]
urls = {}
if home == '1':
    urls[home_origin] = home_notes
if tunnel == '1':
    urls[public_origin] = tunnel_notes
print(json.dumps(urls, separators=(',', ':')))
PY
}
render_web() { # render_web HOME TUNNEL
  printf '[Service]\n# Where the tool "Notizen" is on each of Helena'"'"'s origins (notes/install.sh web).\n'
  printf "Environment='HELENA_NOTES_URLS=%s'\n" "$(notes_urls_json "$1" "$2")"
}

if [[ $cmd == render ]]; then
  case "$what" in
    unit) render_unit ;;
    common) render_common ;;
    proxy) cat "$here/helena-notes-proxy.conf" ;;
    home) render_home ;;
    tunnel) render_tunnel ;;
    config) render_config ;;
    web) render_web "${HELENA_RENDER_HOME:-1}" "${HELENA_RENDER_TUNNEL:-1}" ;;
    *) die "render what? unit|common|proxy|home|tunnel|config|web" ;;
  esac
  exit 0
fi

[[ $EUID -eq 0 ]] || die "run with sudo (only 'render' works without root)"

# ── Checks ────────────────────────────────────────────────────────────────────────────

sb_get() { # sb_get PATH → HTTP status over the socket (as root)
  curl -s -o /dev/null -w '%{http_code}' -m 5 --unix-socket "$socket" "http://notes$1" 2>/dev/null || echo 000
}
socket_state() {
  [[ -S $socket ]] || { echo "no socket"; return; }
  local dir; dir=$(stat -c '%U:%G %a' "$(dirname "$socket")")
  local sock; sock=$(stat -c '%U:%G %a' "$socket")
  if [[ $dir == "$notes_user:www-data 2750" && $sock == "$notes_user:www-data 770" ]]; then
    echo "ok (folder $dir, socket $sock)"
  else
    echo "UNEXPECTED (folder $dir, socket $sock; want $notes_user:www-data 2750 / 770)"
  fi
}
private_state() {
  local listing
  listing=$(curl -s -m 5 --unix-socket "$socket" http://notes/.fs 2>/dev/null) || { echo "not answering"; return; }
  if grep -Eq '"name": ?"Private/' <<<"$listing"; then echo "VISIBLE (must not be)"; else echo "not visible"; fi
}
home_probe() {
  local base="https://$home_host:$port" code sw dot
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 --resolve "$home_host:$port:127.0.0.1" "$base/" 2>/dev/null || echo 000)
  sw=$(curl -s -o /dev/null -w '%{http_code}' -m 5 --resolve "$home_host:$port:127.0.0.1" "$base/service_worker.js" 2>/dev/null || echo 000)
  dot=$(curl -s -o /dev/null -w '%{http_code}' -m 5 --resolve "$home_host:$port:127.0.0.1" "$base/.fs/.git/config" 2>/dev/null || echo 000)
  echo "no session → $code (want 401), service worker → $sw (want 200), .git → $dot (want 404)"
}
tunnel_probe() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -H "Host: $notes_host" "http://127.0.0.1:$tunnel_port/" 2>/dev/null || echo 000)
  echo "without Access → $code (want 403)"
}
firewall_state() {
  command -v nft >/dev/null || { echo "nft missing"; return; }
  nft list table inet helena_hardening >/dev/null 2>&1 || { echo "no Helena firewall (hardening/apply.sh firewall)"; return; }
  if nft list set inet helena_hardening lan_tcp 2>/dev/null | grep -Eq "(\{|, )$port(,| \})"; then echo "open for the home network"
  else echo "CLOSED (install.sh --apply nginx-home adds it)"; fi
}

check() {
  local sha arch
  printf '%-34s %s\n' "release (pinned)" "$HELENA_NOTES_VERSION"
  if [[ -x $(binary_path) ]]; then
    printf '%-34s %s\n' "binary" "$("$(binary_path)" version 2>/dev/null || echo "does not run") ($(readlink -f "$(binary_path)"))"
  else
    printf '%-34s %s\n' "binary" "missing (install.sh --apply binary)"
  fi
  read -r arch sha < <(arch_sha) || true
  printf '%-34s %s\n' "architecture" "${arch:-unsupported $(uname -m)}"
  printf '%-34s %s\n' "user $notes_user" "$(id -u "$notes_user" 2>/dev/null || echo missing)"
  printf '%-34s %s\n' "unit $unit" "$(systemctl is-active "$unit" 2>/dev/null)"
  printf '%-34s %s\n' "socket" "$(socket_state)"
  printf '%-34s %s\n' "ping" "$(sb_get /.ping)"
  printf '%-34s %s\n' "Private/ in the notes" "$(private_state)"
  printf '%-34s %s\n' "settings page $vault/CONFIG.md" "$([[ -e $vault/CONFIG.md ]] && echo present || echo missing)"
  printf '%-34s %s\n' "home entry (:$port)" "$([[ -L $home_enabled ]] && echo "enabled: $(home_probe)" || echo "not enabled")"
  printf '%-34s %s\n' "firewall ($port)" "$(firewall_state)"
  printf '%-34s %s\n' "tunnel entry ($notes_host)" "$([[ -L $tunnel_enabled ]] && echo "enabled: $(tunnel_probe)" || echo "not enabled")"
  printf '%-34s %s\n' "web app knows the notes" "$([[ -e $web_dropin ]] && sed -n "s/^Environment='HELENA_NOTES_URLS=\(.*\)'$/\1/p" "$web_dropin" || echo "no ($web_dropin missing)")"
  printf '%-34s %s\n' "vault .obsidian/ (leftover)" "$([[ -d $vault/.obsidian ]] && echo "present (install.sh obsidian-leftovers)" || echo gone)"
}

# ── Steps ─────────────────────────────────────────────────────────────────────────────

binary() {
  local arch sha
  read -r arch sha < <(arch_sha) || die "no SilverBullet build for $(uname -m)"
  local asset="silverbullet-server-linux-$arch.zip" target="$prefix/$HELENA_NOTES_VERSION"
  local url="$HELENA_NOTES_BASE_URL/$asset"
  if [[ -x $target/silverbullet ]] && [[ $("$target/silverbullet" version 2>/dev/null) == "$HELENA_NOTES_VERSION"* ]]; then
    say "SilverBullet $HELENA_NOTES_VERSION is in $target"
  else
    command -v unzip >/dev/null || die "unzip is missing (apt install unzip)"
    if [[ $apply -eq 0 ]]; then
      say "[dry-run] would download $url (about 16 MB), check sha256 $sha and unpack it to $target"
    else
      local tmp; tmp=$(mktemp -d /var/tmp/helena-notes.XXXXXX)
      trap 'rm -rf "$tmp"' RETURN
      say "downloading $url"
      curl -fsSL -m 300 "$url" -o "$tmp/$asset" || die "download failed"
      local got; got=$(sha256sum "$tmp/$asset" | cut -d' ' -f1)
      [[ $got == "$sha" ]] || die "sha256 $got does not match the pinned $sha; nothing installed"
      say "sha256 matches"
      unzip -q -o "$tmp/$asset" silverbullet -d "$tmp/x" || die "the archive has no silverbullet binary"
      install -d -m 0755 -o root -g root "$prefix" "$target"
      install -m 0755 -o root -g root "$tmp/x/silverbullet" "$target/silverbullet"
      [[ $("$target/silverbullet" version 2>/dev/null) == "$HELENA_NOTES_VERSION"* ]] \
        || die "the unpacked binary does not report version $HELENA_NOTES_VERSION"
      say "SilverBullet $HELENA_NOTES_VERSION installed in $target"
    fi
  fi
  if [[ $(readlink "$prefix/current" 2>/dev/null) != "$HELENA_NOTES_VERSION" ]]; then
    run ln -sfn "$HELENA_NOTES_VERSION" "$prefix/current"
    if [[ $apply -eq 1 ]] && systemctl is-active --quiet "$unit"; then
      say "a new version: restart $unit to run it (sudo systemctl restart $unit)"
    fi
  fi
}

config_page() {
  local target=$vault/CONFIG.md rendered
  rendered=$(mktemp); render_config >"$rendered"
  if [[ -e $target ]] && [[ $force_config -eq 0 ]]; then
    cmp -s "$rendered" "$target" && say "settings page $target is current" \
      || say "settings page $target kept (the owner may have changed it; --force-config rewrites it)"
    rm -f "$rendered"; return 0
  fi
  if [[ $apply -eq 0 ]]; then
    say "[dry-run] would write $target (root:$vault_group 0660)"; rm -f "$rendered"; return 0
  fi
  if [[ -e $target ]]; then
    local backup="$delete_root/$(date +%Y%m%d)/notes-config"
    install -d -m 0700 "$backup" && cp -a "$target" "$backup/CONFIG.md.$(date +%H%M%S)"
    say "previous $target saved to $backup"
  fi
  install -m 0660 -o root -g "$vault_group" "$rendered" "$target"; rm -f "$rendered"
  say "settings page $target written"
}

service() {
  if [[ ! -x $(binary_path) ]]; then
    [[ $apply -eq 1 ]] && die "no SilverBullet binary yet (install.sh --apply binary)"
    say "[dry-run] (no binary installed yet; the unit would run $(binary_path))"
  fi
  [[ -d $vault ]] || die "no vault at $vault"
  getent group "$vault_group" >/dev/null || die "the vault's group $vault_group does not exist"
  getent group www-data >/dev/null || die "nginx's group www-data does not exist"
  if ! id "$notes_user" >/dev/null 2>&1; then
    run useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$notes_user"
  fi
  local target=/etc/systemd/system/$unit.service rendered
  rendered=$(mktemp); render_unit >"$rendered"
  if [[ -e $target ]]; then diff -u "$target" "$rendered" || true; else say "new $target"; fi
  if [[ $apply -eq 1 ]]; then
    install -m 0644 -o root -g root "$rendered" "$target"
    systemd-analyze verify "$target" 2>&1 | grep -v '^$' | sed 's/^/install.sh: systemd-analyze: /' || true
  fi
  rm -f "$rendered"
  config_page
  run systemctl daemon-reload
  run systemctl enable "$unit"
  run systemctl restart "$unit"
  [[ $apply -eq 1 ]] || return 0
  local i
  for i in $(seq 1 20); do
    sleep 1
    if [[ $(sb_get /.ping) == 200 ]]; then
      say "notes answer on $socket: $(socket_state)"
      say "Private/: $(private_state)"
      return 0
    fi
  done
  say "the notes did not answer in 20 s; see: journalctl -u $unit"
  return 1
}

install_snippets() { # install_snippets BACKUP
  local rendered; rendered=$(mktemp); render_common >"$rendered"
  [[ -e $snippets/helena-notes-common.conf ]] && cp -a "$snippets/helena-notes-common.conf" "$1/"
  [[ -e $snippets/helena-notes-proxy.conf ]] && cp -a "$snippets/helena-notes-proxy.conf" "$1/"
  install -m 0644 "$rendered" "$snippets/helena-notes-common.conf"; rm -f "$rendered"
  install -m 0644 "$here/helena-notes-proxy.conf" "$snippets/helena-notes-proxy.conf"
}
restore_snippets() { # restore_snippets BACKUP
  local f
  for f in helena-notes-common.conf helena-notes-proxy.conf; do
    if [[ -e $1/$f ]]; then cp -a "$1/$f" "$snippets/$f"; fi
  done
}
# Installs one site ($1 available, $2 enabled, $3 rendered file) with the snippets; nginx -t
# and reload, or everything back as it was.
install_site() {
  local available=$1 enabled=$2 rendered=$3
  local backup; backup=/var/lib/helena/notes/backup/nginx-$(date +%Y%m%d-%H%M%S)
  install -d -m 0700 "$backup"
  [[ -e $available ]] && cp -a "$available" "$backup/"
  install_snippets "$backup"
  install -m 0644 "$rendered" "$available"
  local was_enabled=0; [[ -L $enabled ]] && was_enabled=1
  ln -sfn "$available" "$enabled"
  if ! nginx -t 2>/dev/null; then
    [[ $was_enabled -eq 1 ]] || rm -f "$enabled"
    if [[ -e $backup/$(basename "$available") ]]; then cp -a "$backup/$(basename "$available")" "$available"; fi
    restore_snippets "$backup"
    nginx -t 2>&1 | tail -3
    die "nginx refused $available; the previous state is back"
  fi
  systemctl reload nginx
}

open_port() {
  command -v nft >/dev/null || { say "nft missing: open tcp $port for the home network yourself"; return; }
  if ! nft list table inet helena_hardening >/dev/null 2>&1; then
    say "no Helena firewall loaded; with hardening/apply.sh firewall the port is in lan_tcp"; return
  fi
  [[ $(firewall_state) == open* ]] && { say "firewall: $port is open for the home network"; return; }
  run nft add element inet helena_hardening lan_tcp "{ $port }"
  [[ $port == 8446 ]] || say "NOTE: add $port to lan_tcp in hardening/files/helena-hardening.nft.in, or the next firewall render closes it"
}

nginx_home() {
  [[ -e $cert_dir/fullchain.pem && -e $cert_dir/privkey.pem ]] \
    || die "no certificate for $home_host in $cert_dir (home HTTPS first: cloudflare/lan_https.py)"
  [[ -e $snippets/helena-tls.conf ]] || die "$snippets/helena-tls.conf missing (home HTTPS first: cloudflare/lan_https.py)"
  local rendered; rendered=$(mktemp); render_home >"$rendered"
  if [[ -e $home_site ]]; then diff -u "$home_site" "$rendered" || true; else say "new $home_site for https://$home_host:$port"; fi
  if [[ $apply -eq 1 ]]; then install_site "$home_site" "$home_enabled" "$rendered"; fi
  rm -f "$rendered"
  open_port
  [[ $apply -eq 1 ]] || return 0
  say "home entry https://$home_host:$port: $(home_probe)"
}

nginx_tunnel() {
  [[ -e /etc/nginx/sites-enabled/helena-tunnel.conf ]] || die "the tunnel entry is not enabled (cloudflare/install.sh nginx)"
  [[ -e $snippets/helena-tunnel-headers.conf ]] || die "$snippets/helena-tunnel-headers.conf missing (cloudflare/install.sh nginx)"
  local rendered; rendered=$(mktemp); render_tunnel >"$rendered"
  if [[ -e $tunnel_site ]]; then diff -u "$tunnel_site" "$rendered" || true; else say "new $tunnel_site for https://$notes_host"; fi
  if [[ $apply -eq 1 ]]; then install_site "$tunnel_site" "$tunnel_enabled" "$rendered"; fi
  rm -f "$rendered"
  [[ $apply -eq 1 ]] || return 0
  say "tunnel entry for $notes_host: $(tunnel_probe)"
  say "in Cloudflare (the owner): $notes_host as a public hostname of the tunnel (service http://127.0.0.1:$tunnel_port) and as a destination of Helena's existing Access application (same audience); then: install.sh --apply web"
}

web() {
  local home=0 tunnel=0
  [[ -L $home_enabled ]] && home=1
  [[ -L $tunnel_enabled ]] && tunnel=1
  if [[ $home -eq 0 && $tunnel -eq 0 && $apply -eq 1 ]]; then
    die "no entry is enabled yet (install.sh --apply nginx-home first)"
  fi
  local rendered; rendered=$(mktemp)
  render_web "$home" "$tunnel" >"$rendered"
  if [[ -e $web_dropin ]] && cmp -s "$rendered" "$web_dropin"; then
    say "the web app already knows the notes: $(notes_urls_json "$home" "$tunnel")"; rm -f "$rendered"; return 0
  fi
  if [[ -e $web_dropin ]]; then diff -u "$web_dropin" "$rendered" || true; else say "new $web_dropin: $(notes_urls_json "$home" "$tunnel")"; fi
  if [[ $apply -eq 1 ]]; then
    install -d -m 0755 "$(dirname "$web_dropin")"
    install -m 0644 "$rendered" "$web_dropin"
    systemctl daemon-reload
    say "restart the web app so it reads it: sudo systemctl restart $web_unit (no agent run depends on it)"
  fi
  rm -f "$rendered"
}

obsidian_leftovers() {
  if [[ ! -d $vault/.obsidian ]]; then say "no $vault/.obsidian"; return; fi
  local dest; dest="$delete_root/$(date +%Y%m%d)/vault-obsidian-$(date +%H%M%S)"
  say "$vault/.obsidian holds: $(find "$vault/.obsidian" -type f -printf '%P ' | head -c 400)"
  run install -d -m 0700 "$(dirname "$dest")"
  run mv "$vault/.obsidian" "$dest"
  [[ $apply -eq 1 ]] && say "moved to $dest (the owner deletes it for good; Helena's watcher records the removal in the vault history)"
  true
}

remove() {
  run systemctl disable --now "$unit"
  run rm -f "$home_enabled" "$tunnel_enabled" "$web_dropin"
  run nginx -t
  run systemctl reload nginx
  run systemctl daemon-reload
  say "notes stopped, entries and the web app's setting removed; restart $web_unit so the tool disappears."
  say "kept: $prefix, /etc/systemd/system/$unit.service, the sites in sites-available, $vault/CONFIG.md and every note."
  say "the firewall element tcp $port stays in lan_tcp (nothing listens there any more)."
}

case "$cmd" in
  check) check ;;
  binary) binary ;;
  service) service ;;
  nginx-home) nginx_home ;;
  nginx-tunnel) nginx_tunnel ;;
  web) web ;;
  all) binary && service && nginx_home && web ;;
  obsidian-leftovers) obsidian_leftovers ;;
  remove) remove ;;
  *) sed -n '2,33p' "$0"; exit 2 ;;
esac
