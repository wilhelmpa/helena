#!/usr/bin/env bash
# Helena host security audit: a repeatable pass/fail list of the hardening state of this
# machine. Read-only. It never prints a secret: it checks modes, owners, presence and
# counts, never the content of a token, key or env file.
#
#   sudo audit.sh                     # table on the terminal
#   sudo audit.sh --json              # the report as JSON on stdout
#   sudo audit.sh --json-file PATH    # write the report atomically (0644, no secrets in it)
#   sudo audit.sh --install-timer     # install + start the hourly timer that writes
#                                     # /var/lib/helena-security/audit.json for Helena
#
# Without root most checks report "skip". Exit status: 0 when nothing failed, 1 when a
# check failed, 2 on a usage error. Decision and the meaning of every check:
# docs/helena-decisions/security-hardening.md.
set -uo pipefail
export LC_ALL=C PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

mode=table
json_file=
case "${1:-}" in
  "") ;;
  --json) mode=json ;;
  --json-file) mode=file; json_file=${2:-}; [[ -n $json_file ]] || { echo "usage: $0 --json-file PATH" >&2; exit 2; } ;;
  --install-timer) mode=install ;;
  -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
  *) echo "audit.sh: unknown argument $1" >&2; exit 2 ;;
esac

here=$(cd "$(dirname "$0")" && pwd)
state_dir=/var/lib/helena-security

if [[ $mode == install ]]; then
  [[ $EUID -eq 0 ]] || { echo "audit.sh: --install-timer needs root" >&2; exit 2; }
  install -d -m 0755 /usr/local/libexec "$state_dir"
  install -m 0755 "$here/audit.sh" /usr/local/libexec/helena-security-audit
  install -m 0644 "$here/files/helena-security-audit.service" /etc/systemd/system/helena-security-audit.service
  install -m 0644 "$here/files/helena-security-audit.timer" /etc/systemd/system/helena-security-audit.timer
  systemctl daemon-reload
  systemctl enable --now helena-security-audit.timer
  systemctl start helena-security-audit.service
  echo "audit.sh: timer installed; report at $state_dir/audit.json"
  exit 0
fi

# Settings that differ per installation (defaults are Kingston's).
HELENA_DB=${HELENA_DB:-itsaplan}
PUBLIC_HOST=${HELENA_PUBLIC_HOST:-helena.volition.one}
# The home network's own name, served by nginx on the LAN (cloudflare/lan_https.py) with a
# certificate from cloudflare/tls-setup.sh (certbot, lineage named after the host).
HOME_HOST=${HELENA_HOME_HOST:-helena-home.volition.one}
LETSENCRYPT=${HELENA_LETSENCRYPT_DIR:-/etc/letsencrypt}
TUNNEL_USER=${HELENA_TUNNEL_USER:-helena-tunnel}
TUNNEL_PORT=${HELENA_TUNNEL_PORT:-8090}
PLAN_BACKUPS=${HELENA_PLAN_BACKUPS:-/var/lib/volition/plan/backups}
SECRET_DIRS=${HELENA_SECRET_DIRS:-/etc/volition /etc/helena}
ISOLATION_LIB=${HELENA_ISOLATION_LIB:-/usr/local/lib/volition-isolation}
API_UNITS=${HELENA_API_UNITS:-volition-plan-api volition-plan-web volition-plan-worker}
TUNNEL_UNIT=${HELENA_TUNNEL_UNIT:-helena-cloudflared}
NGINX_TUNNEL_SITE=${HELENA_NGINX_TUNNEL_SITE:-/etc/nginx/sites-enabled/helena-tunnel.conf}
# The notes (notes/install.sh): SilverBullet behind nginx on the home name's second port.
NOTES_PORT=${HELENA_NOTES_PORT:-8446}
NOTES_UNIT=${HELENA_NOTES_UNIT:-helena-notes}
NOTES_VAULT=${HELENA_VAULT:-/srv/volition/vault}

is_root=0; [[ $EUID -eq 0 ]] && is_root=1
results=()

# record ID GROUP SEVERITY STATE DETAIL [NAME=VALUE ...]. The detail is a short technical fact
# (a mode, a port, a setting's value) in English; it must never carry a secret. Helena words
# a finding from its code (ID.STATE) in the reader's language and fills in the NAME=VALUE
# params; the detail is only its tooltip.
record() {
  local field row detail=${5//$'\t'/ }
  detail=${detail//$'\n'/ }
  row="$1"$'\t'"$2"$'\t'"$3"$'\t'"$4"$'\t'"${detail:0:280}"
  shift 5
  for field in "$@"; do
    field=${field//$'\t'/ }
    row+=$'\t'"${field//$'\n'/ }"
  done
  results+=("$row")
}
need_root() { # ID GROUP SEVERITY
  record "$1" "$2" "$3" skip "needs root"
}

# auth.sudo (H-07, §8.3). The automation account (helena-ops) is the only one allowed sudo
# without a password, and only while its password is locked and SSH takes its key only
# (sshd_config.d/60-helena-ops.conf, checked in sshd's effective config). Anyone else with
# NOPASSWD: ALL is root without a password for whoever holds that account.
OPS_USER=${HELENA_OPS_USER:-helena-ops}
check_sudo() {
  local blanket others status methods problem=
  blanket=$(grep -Rhs -E '^[^#]*NOPASSWD:\s*ALL\s*$' /etc/sudoers /etc/sudoers.d/ | awk '{print $1}' | sort -u)
  others=$(grep -vxF -- "$OPS_USER" <<<"$blanket" | grep . | paste -sd, -)
  if [[ -n $others ]]; then
    record auth.sudo auth medium warn "NOPASSWD: ALL for $others (root without a password for that account)" \
      "why=others" "value=$others"
    return
  fi
  if ! grep -qxF -- "$OPS_USER" <<<"$blanket"; then
    record auth.sudo auth medium pass "no blanket NOPASSWD"
    return
  fi
  status=$(passwd -S "$OPS_USER" 2>/dev/null | awk '{print $2}')
  methods=$(sshd -T -C "user=$OPS_USER,host=localhost,addr=127.0.0.1" 2>/dev/null \
    | awk '$1 == "authenticationmethods" {print $2}')
  [[ $status == L ]] || problem=password
  if [[ $methods != publickey ]]; then problem=${problem:+both}; problem=${problem:-ssh}; fi
  if [[ -z $problem ]]; then
    record auth.sudo auth medium pass "only $OPS_USER (the automation account: password locked, SSH key only)"
  else
    record auth.sudo auth medium warn "$OPS_USER has NOPASSWD: ALL; password ${status:-?}, SSH authenticationmethods ${methods:-?}" \
      "why=ops" "value=$OPS_USER" "problem=$problem"
  fi
}
# tunnel.acl (2026-09-25): the tunnel entry is for the tunnel user alone, and the ACL names
# that user by uid. A firewall loaded before the user existed lets only root in: cloudflared
# then gets "connection refused" and Cloudflare answers 502. hardening/apply.sh
# firewall-uids adds the user (cloudflare/install.sh service runs it).
check_tunnel_acl() { # check_tunnel_acl RULESET
  local tunnel_uid
  tunnel_uid=$(id -u "$TUNNEL_USER" 2>/dev/null || true)
  if ! grep -q 'helena:acl-tunnel' <<<"$1"; then
    record tunnel.acl tunnel high fail "every local user reaches the tunnel entry on $TUNNEL_PORT" "why=open"
  elif [[ -n $tunnel_uid ]] && ! nft -j list set inet helena_hardening tunnel_uids 2>/dev/null \
      | python3 -I -c 'import json,sys; u=int(sys.argv[1]); d=json.load(sys.stdin); sys.exit(0 if u in [e for i in d.get("nftables",[]) for e in i.get("set",{}).get("elem",[])] else 1)' "$tunnel_uid"; then
    record tunnel.acl tunnel high fail "$TUNNEL_USER ($tunnel_uid) is not in tunnel_uids: cloudflared cannot reach the entry" "why=user" "user=$TUNNEL_USER"
  else
    record tunnel.acl tunnel high pass "port $TUNNEL_PORT only for the tunnel user ($TUNNEL_USER)"
  fi
}
# The self-tests run one check each (in a private namespace with fakes).
case "${HELENA_AUDIT_ONLY:-}" in
  auth.sudo)
    [[ $is_root -eq 1 ]] && check_sudo || need_root auth.sudo auth medium
    printf '%s\n' "${results[@]}"
    exit 0 ;;
  tunnel.acl)
    [[ $is_root -eq 1 ]] && check_tunnel_acl "$(nft list ruleset 2>/dev/null)" || need_root tunnel.acl tunnel high
    printf '%s\n' "${results[@]}"
    exit 0 ;;
esac
have() { command -v "$1" >/dev/null 2>&1; }
psql_ro() { # one value from Helena's database, read-only, as the postgres user
  runuser -u postgres -- psql -d "$HELENA_DB" -XAtq -v ON_ERROR_STOP=1 \
    -c "set default_transaction_read_only = on" -c "$1" 2>/dev/null | tail -n 1
}

# ── Network ────────────────────────────────────────────────────────────────────
nft_rules=
if [[ $is_root -eq 1 ]] && have nft; then nft_rules=$(nft list ruleset 2>/dev/null); fi

if [[ $is_root -eq 0 ]]; then
  for id in net.firewall net.self_guard net.loopback_acl; do need_root "$id" network critical; done
else
  if grep -Eq 'hook input priority [^;]*; policy drop;' <<<"$nft_rules"; then
    record net.firewall network critical pass "input policy drop"
  else
    record net.firewall network critical fail "no input chain with policy drop (everything bound to 0.0.0.0/:: is reachable)"
  fi
  # Both families: the IPv4 rule and the IPv6 one (a local process binding the machine's own
  # global IPv6 address is the same hole as binding its LAN IPv4 address).
  if grep -q 'comment "helena:self-guard"' <<<"$nft_rules" && grep -q 'comment "helena:self-guard6"' <<<"$nft_rules"; then
    record net.self_guard network critical pass "local connections to nginx must come from loopback (IPv4 and IPv6)"
  else
    record net.self_guard network critical fail "a local process can connect to nginx from the LAN address (IPv4 or IPv6) and get the LAN owner sign-in"
  fi
  if grep -q 'helena:acl-cdp' <<<"$nft_rules" && grep -q 'helena:acl-tools' <<<"$nft_rules"; then
    record net.loopback_acl network high pass "CDP, browser router, code and terminal limited to their users"
  else
    record net.loopback_acl network high fail "every local user reaches CDP (19201+, 9222), the browser router (6082), code-server (8443) and the terminal router (8444)"
  fi
  # Helena's voice servers (native/local-ai/voice.sh) have no key: installed, they need the ACL.
  if [[ -e /etc/systemd/system/helena-voice-stt.service || -e /etc/systemd/system/helena-voice-tts.service ]]; then
    if grep -q 'helena:acl-voice' <<<"$nft_rules"; then
      record net.voice_acl network high pass "the voice servers (13306, 13307) answer only Helena's API"
    else
      record net.voice_acl network high fail "every local user reaches the voice servers (13306, 13307): apply.sh firewall"
    fi
  fi
fi

# Listeners on a wildcard or LAN address. Allowed from the network: SSH, HTTP(S), the notes'
# HTTPS port (nginx, notes/install.sh), mDNS, DHCP client, Syncthing. Everything else must be
# loopback-only (or behind the firewall).
# avahi and Syncthing also hold UDP sockets on random ports for their own queries; their
# answers come back as replies, which the firewall's conntrack admits, so only their
# well-known ports count as listeners.
unexpected_listeners() {
  ss -H -ltnup 2>/dev/null | awk '{print $1, $5, $7}' | while read -r proto addr users; do
    local port=${addr##*:} host=${addr%:*}
    case "$host" in
      127.*|"[::1]"|"[::ffff:127."*|*%*) continue ;;
    esac
    case "$proto:$port" in
      tcp:22|tcp:80|tcp:443|udp:5353|udp:546|udp:68|udp:21027|udp:22000|tcp:22000) continue ;;
      "tcp:$NOTES_PORT") [[ $users == *'"nginx"'* ]] && continue ;;
    esac
    case "$proto:$users" in
      udp:*'"avahi-daemon"'*|udp:*'"syncthing"'*) continue ;;
    esac
    echo "$proto/$port"
  done | sort -u | paste -sd, -
}
if have ss; then
  unexpected=$(unexpected_listeners)
  if [[ -z $unexpected ]]; then
    record net.listeners network high pass "only 22, 80, 443, the notes' port and Syncthing/mDNS face the network"
  elif grep -q 'helena:input-drop' <<<"$nft_rules"; then
    record net.listeners network high warn "open on the network but dropped by the firewall: $unexpected" "ports=$unexpected"
  else
    record net.listeners network high fail "open on the network: $unexpected" "ports=$unexpected"
  fi
else
  record net.listeners network high skip "ss not installed"
fi

# The LAN owner sign-in: never for loopback, link-local or the server itself.
lo_conf=/etc/nginx/conf.d/volition-local-owner.conf
guard_conf=/etc/nginx/conf.d/helena-local-owner-guard.conf
if [[ ! -e $lo_conf ]]; then
  record net.local_owner network critical pass "LAN owner sign-in not configured"
elif [[ $is_root -eq 0 ]]; then
  need_root net.local_owner network critical
else
  problems=()
  grep -Eq '^\s*(127\.|::1)' "$lo_conf" && problems+=("loopback in the owner geo")
  if [[ -e $guard_conf ]] && grep -Rqs 'helena_owner_capability' /etc/nginx/sites-enabled/; then
    :
  else
    grep -Eq '^\s*fe80::/10\s+1;' "$lo_conf" && problems+=("link-local fe80::/10 in the owner geo")
    grep -Eq '^\s*192\.168\.122\.1/32\s+1;' "$lo_conf" && problems+=("stale 192.168.122.1 in the owner geo")
    problems+=("no listener/source guard (helena-local-owner-guard.conf)")
  fi
  if [[ -e $NGINX_TUNNEL_SITE ]] && grep -Eq 'volition_local_owner_token|helena_owner_capability' "$NGINX_TUNNEL_SITE"; then
    problems+=("the tunnel site references the owner token")
  fi
  # IPv6 (helena-lan6-sync's include in the owner geo): the owner never from link-local,
  # loopback or a unique-local prefix the LAN interface does not have, and this machine's own
  # addresses listed as never the owner (privacy addresses may lag the 5-minute sync: skipped).
  owner_include=$(grep -Eo '^[[:space:]]*include[[:space:]]+[^;]+' "$lo_conf" | awk '{print $2}' | head -n 1)
  if [[ -n $owner_include ]]; then
    if [[ ! -e $owner_include ]]; then
      problems+=("the owner networks include $owner_include is missing")
    else
      while IFS= read -r problem; do [[ -n $problem ]] && problems+=("$problem"); done < <(python3 -I - "$owner_include" <<'PY'
import ipaddress, json, subprocess, sys
def ip(*args):
    try:
        return json.loads(subprocess.run(['ip', '-j', *args], capture_output=True, text=True).stdout or '[]')
    except ValueError:
        return []
links = ip('addr', 'show')
routes = ip('-6', 'route', 'show', 'default') + ip('-4', 'route', 'show', 'default')
lan = next((r['dev'] for r in routes if r.get('dev')), None)
entries = {}
for line in open(sys.argv[1]):
    parts = line.split('#', 1)[0].replace(';', ' ').split()
    if len(parts) == 2:
        try:
            entries[ipaddress.ip_network(parts[0], strict=False)] = parts[1]
        except ValueError:
            print(f'unreadable owner networks entry {parts[0]}')
lan_addresses = [ipaddress.ip_address(a['local']) for l in links if l.get('ifname') == lan
                 for a in l.get('addr_info') or [] if a.get('family') == 'inet6']
for network, value in entries.items():
    if value != '1':
        continue
    if network.is_link_local or network.is_loopback or network.overlaps(ipaddress.ip_network('fe80::/10')):
        print(f'the owner networks include gives the owner sign-in to {network}')
    elif network.version == 6 and network.is_private and not any(a in network for a in lan_addresses):
        print(f'the owner networks include gives the owner sign-in to {network}, not on the LAN interface')
for link in links:
    for a in link.get('addr_info') or []:
        if a.get('family') not in ('inet', 'inet6') or a.get('temporary') or a.get('tentative'):
            continue
        address = ipaddress.ip_address(a['local'])
        if address.is_loopback or address.is_link_local:
            continue
        if entries.get(ipaddress.ip_network(f'{address}/{address.max_prefixlen}')) != '0':
            print(f'the machine address {address} is not excluded from the owner sign-in (helena-lan6-sync)')
PY
)
    fi
  fi
  if ((${#problems[@]})); then
    record net.local_owner network critical fail "$(IFS=';'; echo "${problems[*]}")"
  else
    record net.local_owner network critical pass "LAN listener + non-self source only (IPv4 and IPv6)"
  fi
fi

if systemctl is-active --quiet redis-server 2>/dev/null; then
  if [[ $is_root -eq 1 ]] && grep -Eq '^\s*requirepass\s' /etc/redis/redis.conf 2>/dev/null; then
    record net.redis network low pass "running with a password"
  else
    record net.redis network low fail "running without a password and unused by Helena"
  fi
else
  record net.redis network low pass "not running"
fi

st_conf=/var/lib/volition/syncthing/config.xml
if [[ $is_root -eq 0 ]]; then
  need_root net.syncthing_nat network low
elif [[ -r $st_conf ]]; then
  if grep -q '<natEnabled>false</natEnabled>' "$st_conf"; then
    record net.syncthing_nat network low pass "natEnabled false"
  else
    record net.syncthing_nat network low warn "natEnabled true: Syncthing asks the router (UPnP/NAT-PMP) to open port 22000"
  fi
else
  record net.syncthing_nat network low skip "no Syncthing config"
fi

# ── SSH ────────────────────────────────────────────────────────────────────────
if [[ $is_root -eq 1 ]] && have sshd; then
  sshd_t=$(sshd -T 2>/dev/null)
  val() { awk -v k="$1" '$1==k {print $2; exit}' <<<"$sshd_t"; }
  [[ $(val passwordauthentication) == no && $(val kbdinteractiveauthentication) == no ]] \
    && record ssh.password ssh critical pass "passwords off" \
    || record ssh.password ssh critical fail "passwordauthentication=$(val passwordauthentication) kbdinteractive=$(val kbdinteractiveauthentication)"
  [[ $(val permitrootlogin) == no ]] \
    && record ssh.root ssh high pass "permitrootlogin no" \
    || record ssh.root ssh high fail "permitrootlogin $(val permitrootlogin)" "value=$(val permitrootlogin)"
  allow=$(awk '$1=="allowusers" {print $2}' <<<"$sshd_t" | paste -sd, -)
  [[ -n $allow ]] \
    && record ssh.allow_users ssh medium pass "allowusers $allow" \
    || record ssh.allow_users ssh medium fail "every account with a key may log in"
  tries=$(val maxauthtries); agent=$(val allowagentforwarding); fwd=$(val allowtcpforwarding)
  if [[ ${tries:-6} -le 3 && $agent == no && $fwd != yes && $fwd != all ]]; then
    record ssh.options ssh low pass "maxauthtries $tries, agent forwarding no, tcp forwarding $fwd"
  else
    record ssh.options ssh low fail "maxauthtries ${tries:-?}, agent forwarding ${agent:-?}, tcp forwarding ${fwd:-?}"
  fi
else
  for id in ssh.password ssh.root ssh.allow_users ssh.options; do need_root "$id" ssh high; done
fi

# ── Web (nginx, API) ───────────────────────────────────────────────────────────
# HTTPS at home: nginx's LAN listener answers the home name with a certificate a browser
# accepts (chain, name, dates), asked the way a browser at home asks (SNI = the home name).
if have ss && ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '(^|:)443$'; then
  if ! have curl; then
    record web.https web high skip "curl not installed"
  elif tls_err=$(curl -sS -o /dev/null -m 5 --resolve "$HOME_HOST:443:127.0.0.1" "https://$HOME_HOST/backend/edge/home/probe" 2>&1); then
    record web.https web high pass "https://$HOME_HOST: valid certificate on the LAN listener" "host=$HOME_HOST"
  else
    record web.https web high fail "https://$HOME_HOST: ${tls_err:-no valid certificate}" "host=$HOME_HOST"
  fi
else
  record web.https web high warn "no HTTPS listener on the LAN (the owner's browsers have no secure context locally)"
fi

if [[ -e $NGINX_TUNNEL_SITE ]]; then
  problems=()
  grep -q "listen 127.0.0.1:$TUNNEL_PORT" "$NGINX_TUNNEL_SITE" || problems+=("not bound to 127.0.0.1:$TUNNEL_PORT")
  grep -Eq 'volition_local_owner_token|helena_owner_capability' "$NGINX_TUNNEL_SITE" && problems+=("owner token referenced")
  # Proxy locations, including internal auth, need their own header snippet. Only the
  # exact local-capability block containing nothing but return 404 is exempt.
  if ! n_loc=$(python3 -I - "$NGINX_TUNNEL_SITE" 2>/dev/null <<'PY'
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text()
deny = (r'(?m)^[ \t]*location[ \t]+~[ \t]+'
        + re.escape('^/(backend/|api/)?owner-terminal/local/')
        + r'[ \t]*\{\s*return[ \t]+404[ \t]*;\s*\}[ \t]*(?=\n|$)')
# A mapped error can forward a return instead of denying the request.
if not re.search(r'\berror_page\b', text):
    text = re.sub(deny, '', text)
print(len(re.findall(r'(?m)^[ \t]*location[ \t]+', text)))
PY
  ); then
    problems+=("could not inspect tunnel locations")
    n_loc=0
  fi
  n_entry=$(grep -Ec 'include .*helena-tunnel-headers\.conf;' "$NGINX_TUNNEL_SITE")
  (( n_entry >= n_loc )) || problems+=("$((n_loc - n_entry)) location(s) without the tunnel headers")
  grep -Eq '^[[:space:]]*auth_request[[:space:]]+/_helena_edge[[:space:]]*;' "$NGINX_TUNNEL_SITE" || problems+=("no edge auth_request")
  ((${#problems[@]})) \
    && record web.tunnel_entry web critical fail "$(IFS=';'; echo "${problems[*]}")" \
    || record web.tunnel_entry web critical pass "loopback only, no owner token, edge check on every location"
else
  record web.tunnel_entry web critical skip "no tunnel site installed"
fi

api_env=$(systemctl show -p Environment --value volition-plan-api 2>/dev/null)
if grep -q 'NODE_ENV=production' <<<"$api_env"; then
  record web.production web medium pass "NODE_ENV=production"
else
  node_env=$(grep -o 'NODE_ENV=[^ ]*' <<<"$api_env" | cut -d= -f2)
  record web.production web medium warn "API unit runs NODE_ENV=$node_env" "value=${node_env:-–}"
fi

leftovers=()
[[ -e /etc/nginx/sites-enabled/volition-dev.conf ]] && leftovers+=("dev site enabled")
[[ -e /etc/nginx/conf.d/volition-dev-local-owner.conf ]] && leftovers+=("dev owner map")
n_bak=$(find /etc/nginx -maxdepth 2 -type f \( -name '*.bak*' -o -name '*.before-*' \) 2>/dev/null | wc -l)
(( n_bak > 0 )) && leftovers+=("$n_bak backup copies under /etc/nginx")
((${#leftovers[@]})) \
  && record web.leftovers web low warn "$(IFS=';'; echo "${leftovers[*]}")" \
  || record web.leftovers web low pass "clean"

# ── Tunnel ─────────────────────────────────────────────────────────────────────
if systemctl cat "$TUNNEL_UNIT" >/dev/null 2>&1; then
  problems=()
  systemctl is-active --quiet "$TUNNEL_UNIT" || problems+=("not active")
  user=$(systemctl show -p User --value "$TUNNEL_UNIT")
  [[ -z $user || $user == root ]] && problems+=("runs as root")
  # The unit starts a wrapper (cloudflare/helena-cloudflared) that passes --no-autoupdate.
  tunnel_exec=$(systemctl show -p ExecStart --value "$TUNNEL_UNIT" | grep -o 'path=[^ ;]*' | head -n1 | cut -d= -f2)
  { systemctl cat "$TUNNEL_UNIT"; [[ -n $tunnel_exec && -r $tunnel_exec ]] && cat "$tunnel_exec"; } 2>/dev/null \
    | grep -q -- '--no-autoupdate' || problems+=("self-update not disabled")
  ((${#problems[@]})) \
    && record tunnel.service tunnel high fail "$(IFS=';'; echo "${problems[*]}")" \
    || record tunnel.service tunnel high pass "active as $user, no self-update"
  if [[ $is_root -eq 1 ]]; then
    edge=$(psql_ro "select coalesce(value->>'teamDomain','') || '|' || coalesce(jsonb_array_length(value->'audiences'),0) from app_setting where key='edgeAccess'")
    if [[ $edge =~ \.cloudflareaccess\.com\|[1-9] ]]; then
      record tunnel.edge tunnel critical pass "${edge%%|*}"
    else
      record tunnel.edge tunnel critical fail "no team domain/AUD in Helena: the tunnel entry refuses everything"
    fi
    check_tunnel_acl "$nft_rules"
  else
    need_root tunnel.edge tunnel critical; need_root tunnel.acl tunnel high
  fi
else
  record tunnel.service tunnel high skip "no tunnel installed"
fi

# ── TLS ────────────────────────────────────────────────────────────────────────
# The home network's certificate (certbot renews it a month ahead; the web.https check
# above asks nginx for it the way a browser does).
cert=$LETSENCRYPT/live/$HOME_HOST/fullchain.pem
if [[ $is_root -eq 0 ]]; then
  need_root tls.certificate tls high
elif [[ -e $cert ]]; then
  end=$(openssl x509 -enddate -noout -in "$cert" 2>/dev/null | cut -d= -f2)
  days=$(( ($(date -d "$end" +%s 2>/dev/null || echo 0) - $(date +%s)) / 86400 ))
  if openssl x509 -checkend $((14 * 86400)) -noout -in "$cert" >/dev/null 2>&1; then
    record tls.certificate tls high pass "$HOME_HOST until $end ($days days)" "host=$HOME_HOST" "days=$days"
  else
    record tls.certificate tls high fail "$HOME_HOST expires within 14 days ($end)" "host=$HOME_HOST" "days=$days"
  fi
  hook=$LETSENCRYPT/renewal-hooks/deploy/helena-nginx-reload
  if systemctl is-active --quiet certbot.timer && [[ -x $hook ]]; then
    record tls.renewal tls medium pass "certbot.timer active, nginx reloads on renewal"
  else
    record tls.renewal tls medium fail "certbot.timer $(systemctl is-active certbot.timer 2>/dev/null), deploy hook $([[ -x $hook ]] && echo present || echo missing)"
  fi
else
  record tls.certificate tls high skip "no certificate for $HOME_HOST yet"
fi

# ── Sign-in (Helena's database, read-only, counts and flags only) ──────────────
if [[ $is_root -eq 1 ]] && have psql; then
  factors=$(psql_ro "select (coalesce(u.two_factor_enabled,false))::int + (select count(*) from passkey p where p.user_id=u.id)::int from \"user\" u where u.role='god' limit 1")
  [[ ${factors:-0} -ge 1 ]] \
    && record auth.second_factor auth critical pass "owner has $factors factor(s)" \
    || record auth.second_factor auth critical fail "owner has neither TOTP nor a passkey"
  step=$(psql_ro "select coalesce(value->>'stepUpRequired','true') from app_setting where key='ownerTerminal'")
  [[ ${step:-true} == true ]] \
    && record auth.step_up auth high pass "stepUpRequired true" \
    || record auth.step_up auth high fail "Code beim Öffnen verlangen is off (LAN opens a root shell without a code)"
  reg=$(psql_ro "select coalesce(value->>'registration','open') from app_setting where key='auth'")
  [[ ${reg:-open} == closed ]] \
    && record auth.registration auth high pass "closed" \
    || record auth.registration auth high fail "registration ${reg:-open}" "value=${reg:-open}"
  sessions=$(psql_ro "select count(*) from session s join \"user\" u on u.id=s.user_id where u.role='god' and s.expires_at > now()")
  [[ ${sessions:-0} -le 50 ]] \
    && record auth.sessions auth low pass "$sessions open owner sessions" \
    || record auth.sessions auth low warn "$sessions open owner sessions (every LAN visit without a cookie opens one)" "count=$sessions"
else
  for id in auth.second_factor auth.step_up auth.registration auth.sessions; do need_root "$id" auth high; done
fi
if [[ $is_root -eq 1 ]]; then
  check_sudo
else
  need_root auth.sudo auth medium
fi

# ── System ─────────────────────────────────────────────────────────────────────
if [[ $(timedatectl show -p NTPSynchronized --value 2>/dev/null) == yes ]]; then
  record sys.time system high pass "NTP synchronised"
else
  record sys.time system high fail "clock not synchronised (TOTP, Access JWTs and certificates depend on it)"
fi

declare -A want=(
  [kernel.kptr_restrict]=1 [kernel.yama.ptrace_scope]=1 [kernel.dmesg_restrict]=1
  [kernel.unprivileged_bpf_disabled]=2 [dev.tty.ldisc_autoload]=0 [fs.protected_fifos]=2
  [fs.protected_regular]=2 [fs.suid_dumpable]=0 [net.ipv4.conf.all.accept_redirects]=0
  [net.ipv4.conf.default.accept_redirects]=0 [net.ipv4.conf.all.send_redirects]=0
  [net.ipv6.conf.all.accept_redirects]=0 [net.ipv6.conf.default.accept_redirects]=0
  [net.ipv4.conf.all.log_martians]=1 [net.ipv4.tcp_syncookies]=1 [net.ipv4.conf.all.rp_filter]=2
)
off=()
for key in "${!want[@]}"; do
  cur=$(sysctl -n "$key" 2>/dev/null) || continue
  [[ $cur == "${want[$key]}" ]] || off+=("$key=$cur")
done
((${#off[@]})) \
  && record sys.sysctl system medium fail "$(printf '%s ' "${off[@]}")" \
  || record sys.sysctl system medium pass "kernel settings as intended"

uu=$(apt-config dump 2>/dev/null | awk -F'"' '/^APT::Periodic::Unattended-Upgrade /{print $2}')
if [[ ${uu:-0} != 0 ]] && systemctl is-enabled --quiet apt-daily-upgrade.timer 2>/dev/null; then
  record sys.updates system medium pass "unattended-upgrades on"
else
  record sys.updates system medium fail "unattended-upgrades off"
fi

[[ -e /run/reboot-required ]] \
  && record sys.reboot system low warn "reboot required ($(tr '\n' ' ' </run/reboot-required.pkgs 2>/dev/null | cut -c1-120))" \
  || record sys.reboot system low pass "none pending"

jmax=$(systemd-analyze cat-config systemd/journald.conf 2>/dev/null | awk -F= '/^SystemMaxUse=/{v=$2} END{print v}')
[[ -n $jmax ]] \
  && record sys.journald system low pass "SystemMaxUse=$jmax" \
  || record sys.journald system low warn "journal size not limited"

active_extra=()
for unit in redis-server ModemManager cups avahi-dnsconfd rpcbind telnet.socket; do
  systemctl is-active --quiet "$unit" 2>/dev/null && active_extra+=("$unit")
done
((${#active_extra[@]})) \
  && record sys.services system low warn "running: ${active_extra[*]}" \
  || record sys.services system low pass "none of the known unneeded services run"

shells=$(awk -F: '$3>0 && $3<1000 && $7 !~ /(nologin|false|sync)$/ && $1!="postgres" {print $1}' /etc/passwd | paste -sd, -)
[[ -z $shells ]] \
  && record sys.shells system low pass "service accounts have no login shell" \
  || record sys.shells system low warn "login shell for $shells"

if have mokutil; then
  mokutil --sb-state 2>/dev/null | grep -q 'enabled' \
    && record sys.secure_boot system low pass "enabled" \
    || record sys.secure_boot system low warn "disabled (unsigned DKMS modules); owner decision, see the hardening doc"
else
  record sys.secure_boot system low skip "mokutil not installed"
fi

if lsblk -rno TYPE 2>/dev/null | grep -qx crypt; then
  record sys.encryption system low pass "dm-crypt in use"
else
  record sys.encryption system low warn "no disk encryption; owner decision, see the hardening doc"
fi

# ── Files ──────────────────────────────────────────────────────────────────────
if [[ $is_root -eq 1 ]]; then
  if [[ -d $PLAN_BACKUPS ]]; then
    loose=$(find "$PLAN_BACKUPS" -maxdepth 1 -type f -perm /077 | wc -l)
    dmode=$(stat -c %a "$PLAN_BACKUPS")
    [[ $loose -eq 0 && $dmode == 700 ]] \
      && record files.backups files high pass "dumps 0600 in a 0700 folder" \
      || record files.backups files high fail "$loose dump(s) readable beyond their owner, folder $dmode (a dump holds every session)"
  else
    record files.backups files high skip "no $PLAN_BACKUPS"
  fi
  wide=()
  for dir in $SECRET_DIRS; do
    [[ -d $dir ]] || continue
    # local-ai-preload only names the models to load at start (the preload unit's dynamic
    # user reads it); cloudflare/resolv.conf is the tunnel's public DNS servers. Neither
    # holds anything secret.
    while IFS= read -r f; do wide+=("$f"); done < <(find "$dir" -type f -perm /004 \
      ! -name '*.json' ! -name 'README*' ! -name '*.pem.pub' ! -name 'local-ai-preload' \
      ! -name 'resolv.conf' 2>/dev/null)
  done
  key=/etc/volition/owner-terminal.key
  if [[ -e $key ]] && [[ $(stat -c %G "$key") == volition ]]; then
    wide+=("$key readable by group volition (browser and runner users)")
  fi
  ((${#wide[@]})) \
    && record files.secrets files high fail "$(printf '%s; ' "${wide[@]}" | cut -c1-270)" \
    || record files.secrets files high pass "no world-readable secret files"
else
  need_root files.backups files high; need_root files.secrets files high
fi

# files.agent_code (2026-09-26): isolated agents run Hermes as their project users from code the
# units bind read-only (isolation launcher.json sharedCode: the venv, its Python, its tools). A
# bind keeps the modes, so a file there only its owner reads fails every agent that imports it:
# on 2026-09-25 the anthropic SDK's docstring_parser (root 0600) stopped every agent on a Claude
# model at "credentials or agent init failed". A bytecode cache only its owner reads is harmless
# (Python compiles the source in memory; measured: no slower start), so it is only named.
# isolation.sh sync (every deploy) opens the trees again.
check_agent_code() {
  local modes=$ISOLATION_LIB/runtime_modes.py report sources bytecode tree
  if [[ ! -f $modes ]]; then
    record files.agent_code files high skip "agent isolation not installed"
    return
  fi
  report=$(python3 -I "$modes" check --config "$ISOLATION_LIB/launcher.json" --json 2>/dev/null) || true
  read -r sources bytecode tree < <(python3 -I -c '
import json, sys
try:
    trees = json.loads(sys.stdin.read())["trees"]
    print(sum(t["sources"] for t in trees), sum(t["unreadable"] - t["sources"] for t in trees),
          next((t["path"] for t in trees if t["sources"]), "-"))
except Exception:
    print("? ? -")' <<<"$report")
  if [[ $sources == "?" ]]; then
    record files.agent_code files high skip "runtime_modes.py gave no report"
  elif ((sources > 0)); then
    record files.agent_code files high fail "$sources file(s) in $tree only their owner reads (repair: isolation.sh sync)" \
      "count=$sources" "path=$tree"
  else
    record files.agent_code files high pass "every agent reads the runtime code it runs$( ((bytecode)) && echo " ($bytecode bytecode cache entries only their owner reads: harmless)")"
  fi
}
if [[ $is_root -eq 1 ]]; then check_agent_code; else need_root files.agent_code files high; fi

# ── Services ───────────────────────────────────────────────────────────────────
worst=
for unit in $API_UNITS; do
  systemctl cat "$unit" >/dev/null 2>&1 || continue
  score=$(systemd-analyze security --no-pager "$unit" 2>/dev/null | awk '/Overall exposure level/ {print $(NF-2)}')
  [[ -n $score ]] && worst+="$unit=$score "
done
if [[ -z $worst ]]; then
  record svc.exposure services medium skip "units not found"
elif awk '{for(i=1;i<=NF;i++){split($i,a,"="); if (a[2]+0 > 6.0) bad=1}} END{exit bad?0:1}' <<<"$worst"; then
  record svc.exposure services medium warn "$worst(target ≤ 6.0)"
else
  record svc.exposure services medium pass "$worst"
fi

exposed_tools() {
  ss -H -ltn 2>/dev/null | awk '{print $4}' | while read -r addr; do
    local port=${addr##*:} host=${addr%:*}
    case "$port" in
      3000|3001|6082|8384|8443|8444|9222|1920[0-9]|192[1-9][0-9]|1608[0-9]|1609[0-9]|"$TUNNEL_PORT") ;;
      *) continue ;;
    esac
    case "$host" in
      127.*|"[::1]") continue ;;
    esac
    echo "$port"
  done | sort -u | paste -sd, -
}
if have ss; then
  exposed=$(exposed_tools)
  [[ -z $exposed ]] \
    && record svc.tools_loopback services high pass "API, web, tools, CDP, VNC and tunnel entry on loopback" \
    || record svc.tools_loopback services high fail "bound beyond loopback: $exposed"
fi

# svc.notes: the notes (SilverBullet on the vault, notes/install.sh) are shielded the way
# docs/helena-decisions/notes-silverbullet.md §3 says: a socket only nginx reaches, no
# network, neither Private/ nor the vault's git history, no shell or headless runtime, and
# every nginx entry checks the owner and refuses hidden paths and Private/.
check_notes() {
  local unit_file=/etc/systemd/system/$NOTES_UNIT.service problems=() props site
  if [[ ! -e $unit_file ]]; then
    record svc.notes services high pass "notes not installed"
    return
  fi
  props=$(systemctl show "$NOTES_UNIT" -p PrivateNetwork -p InaccessiblePaths -p Environment -p User 2>/dev/null)
  grep -q '^PrivateNetwork=yes$' <<<"$props" || problems+=("PrivateNetwork not yes")
  grep -q "^InaccessiblePaths=.*$NOTES_VAULT/\.git" <<<"$props" || problems+=("vault .git reachable")
  grep -q "^InaccessiblePaths=.*$NOTES_VAULT/Private" <<<"$props" || problems+=("Private/ reachable")
  grep -q 'SB_SHELL_BACKEND=off' <<<"$props" || problems+=("shell not off")
  grep -q 'SB_RUNTIME_API=0' <<<"$props" || problems+=("runtime API not off")
  grep -q 'SB_UNIX_SOCKET=' <<<"$props" || problems+=("no Unix socket")
  if systemctl is-active --quiet "$NOTES_UNIT"; then
    local dir; dir=$(stat -c '%G %a' /run/helena-notes 2>/dev/null)
    [[ $dir == "www-data 2750" ]] || problems+=("socket folder ${dir:-missing}")
    if ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -q .; then
      local pid; pid=$(systemctl show -p MainPID --value "$NOTES_UNIT" 2>/dev/null)
      if [[ -n $pid && $pid != 0 ]] && ss -H -ltnp 2>/dev/null | grep -q "pid=$pid,"; then
        problems+=("listens on TCP")
      fi
    fi
  fi
  for site in /etc/nginx/sites-enabled/helena-notes-home.conf /etc/nginx/sites-enabled/helena-tunnel.notes.conf; do
    [[ -e $site ]] || continue
    grep -q '/auth/verify/notes' "$site" || problems+=("$(basename "$site"): no owner check")
    grep -q 'include /etc/nginx/snippets/helena-notes-common.conf' "$site" || problems+=("$(basename "$site"): rules missing")
  done
  if [[ -e /etc/nginx/snippets/helena-notes-common.conf ]]; then
    local common=/etc/nginx/snippets/helena-notes-common.conf
    grep -q '^auth_request /_helena_notes_auth;' "$common" || problems+=("rules: no owner check")
    grep -Fq 'location ~ ^/\.fs/Private(/|$)' "$common" || problems+=("rules: Private/ not refused")
    grep -Fq 'location ~ ^/\.fs/(.*/)?\.' "$common" || problems+=("rules: hidden paths not refused")
    grep -Fq "connect-src 'self'" "$common" || problems+=("rules: no connect-src self")
  fi
  if ((${#problems[@]})); then
    local list; list=$(IFS=,; echo "${problems[*]}")
    record svc.notes services high fail "notes not shielded: $list" "problems=$list"
  else
    record svc.notes services high pass "socket for nginx only, no network, no Private/ or git history, owner check and path rules on every entry"
  fi
}
if [[ $is_root -eq 1 ]]; then check_notes; else need_root svc.notes services high; fi

# ── Output ─────────────────────────────────────────────────────────────────────
failed=0
for row in "${results[@]}"; do [[ $(cut -f4 <<<"$row") == fail ]] && failed=1; done

emit_json() {
  printf '%s\n' "${results[@]}" | python3 -c '
import json, socket, sys, datetime
checks = []
for line in sys.stdin:
    line = line.rstrip("\n")
    if not line:
        continue
    fields = line.split("\t")
    cid, group, severity, state, detail = (fields + [""] * 5)[:5]
    params = {}
    for field in fields[5:]:
        name, sep, value = field.partition("=")
        if sep and name:
            params[name] = int(value) if value.isdigit() else value
    # code: a stable name for the finding (check id and state); Helena words it from its
    # translations and fills in the params. detail stays for older readers and tooltips.
    checks.append({"id": cid, "group": group, "severity": severity, "state": state,
                   "code": f"{cid}.{state}", "params": params, "detail": detail})
print(json.dumps({
    "version": 1,
    "host": socket.gethostname(),
    "ranAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "checks": checks,
}, ensure_ascii=False, indent=1))
'
}

case $mode in
  json) emit_json ;;
  file)
    install -d -m 0755 "$(dirname "$json_file")"
    tmp=$(mktemp "$(dirname "$json_file")/.audit.XXXXXX")
    emit_json >"$tmp" && chmod 0644 "$tmp" && mv -f "$tmp" "$json_file"
    ;;
  table)
    printf '%-6s %-8s %-22s %s\n' STATE SEVERITY CHECK DETAIL
    printf '%s\n' "${results[@]}" | sort -t$'\t' -k4,4 | while IFS=$'\t' read -r id group severity state detail; do
      printf '%-6s %-8s %-22s %s\n' "$state" "$severity" "$id" "$detail"
    done
    ;;
esac
exit $failed
