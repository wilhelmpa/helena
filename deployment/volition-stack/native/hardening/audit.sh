#!/usr/bin/env bash
# Helena host security audit: a repeatable pass/fail list of the hardening state of this
# machine. Read-only. It never prints a secret: it checks modes, owners, presence and
# counts, never the content of a token, key or env file.
#
#   sudo audit.sh                     # table on the terminal
#   sudo audit.sh --json              # the report as JSON on stdout
#   sudo audit.sh --json-file PATH    # write the report atomically (0644, no secrets in it)
#   sudo audit.sh --install-timer     # install + start the hourly timer that writes
#                                     # /var/lib/helena/security/audit.json for Helena
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
state_dir=/var/lib/helena/security

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
TUNNEL_PORT=${HELENA_TUNNEL_PORT:-8090}
PLAN_BACKUPS=${HELENA_PLAN_BACKUPS:-/var/lib/volition/plan/backups}
SECRET_DIRS=${HELENA_SECRET_DIRS:-/etc/volition /etc/helena /etc/letsencrypt/cloudflare}
API_UNITS=${HELENA_API_UNITS:-volition-plan-api volition-plan-web volition-plan-worker}
TUNNEL_UNIT=${HELENA_TUNNEL_UNIT:-helena-cloudflared}
NGINX_TUNNEL_SITE=${HELENA_NGINX_TUNNEL_SITE:-/etc/nginx/sites-enabled/helena-tunnel.conf}

is_root=0; [[ $EUID -eq 0 ]] && is_root=1
results=()

# record ID GROUP SEVERITY STATE DETAIL. The detail is a short technical fact (a mode, a
# port, a setting's value); it must never carry a secret.
record() {
  local detail=${5//$'\t'/ }
  detail=${detail//$'\n'/ }
  results+=("$1"$'\t'"$2"$'\t'"$3"$'\t'"$4"$'\t'"${detail:0:280}")
}
need_root() { # ID GROUP SEVERITY
  record "$1" "$2" "$3" skip "needs root"
}
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
  if grep -q 'helena:self-guard' <<<"$nft_rules"; then
    record net.self_guard network critical pass "local connections to nginx must come from loopback"
  else
    record net.self_guard network critical fail "a local process can connect to nginx from the LAN address and get the LAN owner sign-in"
  fi
  if grep -q 'helena:acl-cdp' <<<"$nft_rules" && grep -q 'helena:acl-tools' <<<"$nft_rules"; then
    record net.loopback_acl network high pass "CDP, browser router, code and terminal limited to their users"
  else
    record net.loopback_acl network high fail "every local user reaches CDP (19201+, 9222), the browser router (6082), code-server (8443) and the terminal router (8444)"
  fi
fi

# Listeners on a wildcard or LAN address. Allowed from the network: SSH, HTTP(S), mDNS,
# DHCP client, Syncthing. Everything else must be loopback-only (or behind the firewall).
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
    record net.listeners network high pass "only 22, 80, 443 and Syncthing/mDNS face the network"
  elif grep -q 'helena:input-drop' <<<"$nft_rules"; then
    record net.listeners network high warn "open on the network but dropped by the firewall: $unexpected"
  else
    record net.listeners network high fail "open on the network: $unexpected"
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
  if [[ -e $guard_conf ]] && grep -rqs 'helena_local_owner_token' /etc/nginx/sites-enabled/; then
    :
  else
    grep -Eq '^\s*fe80::/10\s+1;' "$lo_conf" && problems+=("link-local fe80::/10 in the owner geo")
    grep -Eq '^\s*192\.168\.122\.1/32\s+1;' "$lo_conf" && problems+=("stale 192.168.122.1 in the owner geo")
    problems+=("no listener/source guard (helena-local-owner-guard.conf)")
  fi
  if [[ -e $NGINX_TUNNEL_SITE ]] && grep -Eq 'volition_local_owner_token|helena_local_owner_token' "$NGINX_TUNNEL_SITE"; then
    problems+=("the tunnel site references the owner token")
  fi
  if ((${#problems[@]})); then
    record net.local_owner network critical fail "$(IFS=';'; echo "${problems[*]}")"
  else
    record net.local_owner network critical pass "LAN listener + non-self source only"
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
    || record ssh.root ssh high fail "permitrootlogin $(val permitrootlogin)"
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
if have ss && ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '(^|:)443$'; then
  record web.https web high pass "nginx listens on 443"
else
  record web.https web high warn "no HTTPS listener on the LAN (the owner's browsers have no secure context locally)"
fi

if [[ -e $NGINX_TUNNEL_SITE ]]; then
  problems=()
  grep -q "listen 127.0.0.1:$TUNNEL_PORT" "$NGINX_TUNNEL_SITE" || problems+=("not bound to 127.0.0.1:$TUNNEL_PORT")
  grep -Eq 'volition_local_owner_token|helena_local_owner_token' "$NGINX_TUNNEL_SITE" && problems+=("owner token referenced")
  # Every location, the internal auth ones included, sets the tunnel headers through the
  # one snippet (nginx does not inherit proxy_set_header into a location that sets its own).
  n_loc=$(grep -Ec '^\s*location ' "$NGINX_TUNNEL_SITE")
  n_entry=$(grep -Ec 'include .*helena-tunnel-headers\.conf;' "$NGINX_TUNNEL_SITE")
  (( n_entry >= n_loc )) || problems+=("$((n_loc - n_entry)) location(s) without the tunnel headers")
  grep -q 'auth_request /_helena_edge' "$NGINX_TUNNEL_SITE" || problems+=("no edge auth_request")
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
  record web.production web medium warn "API unit runs NODE_ENV=$(grep -o 'NODE_ENV=[^ ]*' <<<"$api_env" | cut -d= -f2)"
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
  systemctl cat "$TUNNEL_UNIT" | grep -q -- '--no-autoupdate' || problems+=("self-update not disabled")
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
    grep -q 'helena:acl-tunnel' <<<"$nft_rules" \
      && record tunnel.acl tunnel high pass "port $TUNNEL_PORT only for the tunnel user" \
      || record tunnel.acl tunnel high fail "every local user reaches the tunnel entry on $TUNNEL_PORT"
  else
    need_root tunnel.edge tunnel critical; need_root tunnel.acl tunnel high
  fi
else
  record tunnel.service tunnel high skip "no tunnel installed"
fi

# ── TLS ────────────────────────────────────────────────────────────────────────
cert=/etc/letsencrypt/live/$PUBLIC_HOST/fullchain.pem
if [[ $is_root -eq 0 ]]; then
  need_root tls.certificate tls high
elif [[ -e $cert ]]; then
  if openssl x509 -checkend $((14 * 86400)) -noout -in "$cert" >/dev/null 2>&1; then
    record tls.certificate tls high pass "$PUBLIC_HOST until $(openssl x509 -enddate -noout -in "$cert" | cut -d= -f2)"
  else
    record tls.certificate tls high fail "$PUBLIC_HOST expires within 14 days"
  fi
  systemctl is-active --quiet certbot.timer \
    && record tls.renewal tls medium pass "certbot.timer active" \
    || record tls.renewal tls medium fail "certbot.timer not active"
else
  record tls.certificate tls high skip "no certificate for $PUBLIC_HOST yet"
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
    || record auth.registration auth high fail "registration ${reg:-open}"
  sessions=$(psql_ro "select count(*) from session s join \"user\" u on u.id=s.user_id where u.role='god' and s.expires_at > now()")
  [[ ${sessions:-0} -le 50 ]] \
    && record auth.sessions auth low pass "$sessions open owner sessions" \
    || record auth.sessions auth low warn "$sessions open owner sessions (every LAN visit without a cookie opens one)"
else
  for id in auth.second_factor auth.step_up auth.registration auth.sessions; do need_root "$id" auth high; done
fi
if [[ $is_root -eq 1 ]]; then
  nopasswd=$(grep -Rhs -E '^[^#]*NOPASSWD:\s*ALL\s*$' /etc/sudoers /etc/sudoers.d/ | awk '{print $1}' | sort -u | paste -sd, -)
  [[ -z $nopasswd ]] \
    && record auth.sudo auth medium pass "no blanket NOPASSWD" \
    || record auth.sudo auth medium warn "NOPASSWD: ALL for $nopasswd (the browser terminal is root without a password)"
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
    while IFS= read -r f; do wide+=("$f"); done < <(find "$dir" -type f -perm /004 \
      ! -name '*.json' ! -name 'README*' ! -name '*.pem.pub' 2>/dev/null)
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
    cid, group, severity, state, detail = (line.split("\t") + [""] * 5)[:5]
    checks.append({"id": cid, "group": group, "severity": severity, "state": state, "detail": detail})
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
