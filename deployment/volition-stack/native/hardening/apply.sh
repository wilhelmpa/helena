#!/usr/bin/env bash
# Helena host hardening, one named step at a time. Dry run by default: it shows what the
# step would change and changes nothing. Idempotent; every step can be rolled back.
#
#   sudo apply.sh <step>                 # dry run: what would change
#   sudo apply.sh --apply <step>         # do it
#   sudo apply.sh --apply confirm <step> # keep a step that arms an automatic rollback
#   sudo apply.sh --apply rollback <step>
#   sudo apply.sh status
#
# Steps, in the order of the runbook (docs/helena-decisions/security-hardening.md §6):
#   leftovers     move the dev nginx site, the dev owner map and world-readable nginx
#                 backup copies out of /etc/nginx; reload nginx
#   local-owner   guard the LAN owner sign-in: only a LAN listener, never loopback,
#                 link-local or the machine itself (nginx map; the token stays untouched)
#   permissions   DB dumps 0600 in a 0700 folder
#   services      stop and disable unused services (redis-server, ModemManager); service
#                 accounts without a login shell
#   sysctl        kernel hardening (/etc/sysctl.d/90-helena-hardening.conf)
#   journald      journal limits (/etc/systemd/journald.conf.d/50-helena-journald.conf)
#   firewall      nftables default-deny inbound + loopback ACLs + the self guard. Arms a
#                 5-minute automatic rollback; "confirm firewall" keeps it.
#   sshd          keys only, AllowUsers, no agent forwarding. Arms a 5-minute rollback;
#                 "confirm sshd" keeps it.
#   units         systemd sandboxing drop-ins for the API, web and worker, restarted one
#                 by one with a health check; a unit that does not come back is rolled back
#   terminal-key  the owner-terminal signing key readable by the API and the terminal
#                 router only (own group), both restarted
#   kasm-loopback KasmVNC may talk to loopback only (its UDP listener faces every address);
#                 restarts the project browsers
#   audit-timer   the hourly audit that feeds Administrator -> Sicherheit
#
# Safety: a step never removes the owner's SSH access from the home network; the firewall
# and sshd steps refuse to run from an SSH session outside the home network, and roll back
# on their own after 5 minutes unless confirmed from a fresh session.
set -uo pipefail
export LC_ALL=C PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

here=$(cd "$(dirname "$0")" && pwd)
files=$here/files
state=/var/lib/helena/hardening
stamp=$(date +%Y%m%d-%H%M%S)
backup=$state/backup/$stamp
owner_user=${HELENA_OWNER_USER:-wilhelmpa}
ssh_users=${HELENA_SSH_USERS:-$owner_user}
tunnel_user=${HELENA_TUNNEL_USER:-helena-tunnel}
tunnel_port=${HELENA_TUNNEL_PORT:-8090}
plan_backups=${HELENA_PLAN_BACKUPS:-/var/lib/volition/plan/backups}
api_units=${HELENA_API_UNITS:-volition-plan-api volition-plan-web volition-plan-worker}
nginx_site=${HELENA_NGINX_SITE:-/etc/nginx/sites-available/volition.conf}
rollback_minutes=${HELENA_ROLLBACK_MINUTES:-5}

apply=0
args=()
for arg in "$@"; do
  case "$arg" in
    --apply) apply=1 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) args+=("$arg") ;;
  esac
done
set -- "${args[@]}"

say() { echo "apply.sh: $*"; }
die() { echo "apply.sh: $*" >&2; exit 1; }
# Runs a changing command, or under the dry run only prints it.
run() {
  if [[ $apply -eq 1 ]]; then "$@"; else printf 'apply.sh: [dry-run] would run:'; printf ' %q' "$@"; printf '\n'; fi
}
need_root() { [[ $EUID -eq 0 ]] || die "run with sudo (the dry run needs root too: it reads root-only files)"; }
log() { [[ $apply -eq 1 ]] && { install -d -m 0700 "$state"; echo "$(date -Is) $*" >>"$state/apply.log"; }; true; }
keep() { # keep a copy of a file before a step changes or moves it
  local src=$1
  [[ -e $src || -L $src ]] || return 0
  [[ $apply -eq 1 ]] || return 0
  install -d -m 0700 "$backup$(dirname "$src")"
  cp -a "$src" "$backup$src"
}
latest_backup() { ls -1d "$state"/backup/* 2>/dev/null | sort | tail -n 1; }
show_diff() { # show_diff CURRENT NEW
  if [[ -e $1 ]]; then diff -u "$1" "$2" && say "$1 unchanged"; else say "new file $1:"; sed 's/^/  + /' "$2"; fi
}
uid_of() { id -u "$1" 2>/dev/null; }
uids() { # uids USER... → "0, 1000, 995" with the ones that exist
  local out=0 u
  for u in "$@"; do u=$(uid_of "$u") && out+=", $u"; done
  echo "$out"
}
# The session this runs in, if it is an SSH session: its client address.
ssh_client() { awk '{print $1}' <<<"${SSH_CONNECTION:-}"; }

lan4_cidr() {
  local dev
  dev=$(ip -4 route show default 2>/dev/null | awk '{for(i=1;i<NF;i++) if ($i=="dev") {print $(i+1); exit}}')
  [[ -n $dev ]] || return 1
  ip -4 -o addr show dev "$dev" scope global | awk '{print $4}' | head -n 1 \
    | python3 -c 'import ipaddress,sys; print(ipaddress.ip_interface(sys.stdin.read().strip()).network)'
}

# An SSH session from outside the home network must not run a step that could cut it off.
guard_ssh_session() {
  local client lan4
  client=$(ssh_client)
  [[ -z $client ]] && return 0
  lan4=$(lan4_cidr) || die "cannot tell the home network; refusing to touch SSH or the firewall"
  python3 - "$client" "$lan4" <<'PY' || die "this SSH session ($client) is not from the home network; run the step from the LAN or the console"
import ipaddress, subprocess, sys
client = ipaddress.ip_address(sys.argv[1].split('%')[0])
if client.version == 4:
    ok = client in ipaddress.ip_network(sys.argv[2])
else:
    own = subprocess.run(['ip', '-6', '-o', 'addr', 'show', 'scope', 'global'], capture_output=True, text=True).stdout
    nets = [ipaddress.ip_interface(line.split()[3]).network for line in own.splitlines() if line.split()[3].endswith('/64')]
    ok = client.is_link_local or client in ipaddress.ip_network('fc00::/7') or any(client in n for n in nets)
sys.exit(0 if ok else 1)
PY
}

# Arms a transient timer that runs CMD... after the rollback window unless confirmed.
arm_rollback() { # arm_rollback NAME CMD...
  local name=helena-hardening-rollback-$1; shift
  run systemctl stop "$name.timer" 2>/dev/null
  run systemd-run --quiet --unit="$name" --on-active="${rollback_minutes}min" \
    --timer-property=AccuracySec=5s --description="Helena hardening: automatic rollback ($name)" "$@"
  say "automatic rollback armed: in $rollback_minutes minutes unless you run 'apply.sh --apply confirm ${name#helena-hardening-rollback-}' from a NEW session"
}
disarm_rollback() { run systemctl stop "helena-hardening-rollback-$1.timer" "helena-hardening-rollback-$1.service" 2>/dev/null; true; }

# ── Steps ──────────────────────────────────────────────────────────────────────

step_leftovers() {
  local moved=()
  for f in /etc/nginx/sites-enabled/volition-dev.conf /etc/nginx/conf.d/volition-dev-local-owner.conf \
    $(find /etc/nginx -maxdepth 2 -type f \( -name '*.bak*' -o -name '*.before-*' \) 2>/dev/null); do
    [[ -e $f || -L $f ]] || continue
    moved+=("$f")
  done
  ((${#moved[@]})) || { say "leftovers: nothing to move"; return 0; }
  for f in "${moved[@]}"; do
    say "leftovers: move $f → $backup$f"
    if [[ $apply -eq 1 ]]; then install -d -m 0700 "$backup$(dirname "$f")"; mv "$f" "$backup$f"; fi
  done
  if [[ $apply -eq 1 ]]; then
    printf '%s\n' "${moved[@]}" >"$backup/leftovers.list"
    if ! nginx -t 2>/dev/null; then
      say "nginx -t failed; putting the files back"
      while read -r f; do mv "$backup$f" "$f"; done <"$backup/leftovers.list"
      die "leftovers rolled back"
    fi
    systemctl reload nginx
    log "leftovers moved to $backup"
  fi
}
rollback_leftovers() {
  local dir; dir=$(grep -l . "$state"/backup/*/leftovers.list 2>/dev/null | sort | tail -n 1 | xargs -r dirname)
  [[ -n $dir ]] || die "no leftovers backup"
  while read -r f; do run mv "$dir$f" "$f"; done <"$dir/leftovers.list"
  run nginx -t && run systemctl reload nginx
}

step_local_owner() {
  local guard=/etc/nginx/conf.d/helena-local-owner-guard.conf
  [[ -e /etc/nginx/conf.d/volition-local-owner.conf ]] || { say "local-owner: LAN owner sign-in not configured, nothing to guard"; return 0; }
  [[ -e $nginx_site ]] || die "no $nginx_site"
  local new; new=$(mktemp)
  install -m 0644 "$files/helena-local-owner-guard.conf" "$new"
  show_diff "$guard" "$new"
  if grep -q 'X-Volition-Local-Access \$volition_local_owner_token;' "$nginx_site"; then
    say "local-owner: $nginx_site: proxy_set_header X-Volition-Local-Access \$volition_local_owner_token → \$helena_owner_capability"
  else
    say "local-owner: $nginx_site already uses the guarded variable"
  fi
  [[ $apply -eq 1 ]] || { rm -f "$new"; return 0; }
  keep "$guard"; keep "$nginx_site"
  install -m 0644 "$new" "$guard"; rm -f "$new"
  sed -i 's/X-Volition-Local-Access \$volition_local_owner_token;/X-Volition-Local-Access $helena_owner_capability;/' "$nginx_site"
  if ! nginx -t 2>/dev/null; then
    cp -a "$backup$nginx_site" "$nginx_site"; rm -f "$guard"
    [[ -e $backup$guard ]] && cp -a "$backup$guard" "$guard"
    die "nginx -t failed; local-owner rolled back"
  fi
  systemctl reload nginx
  log "local-owner guard installed (backup $backup)"
}
rollback_local_owner() {
  local dir; dir=$(latest_backup)
  [[ -e $dir$nginx_site ]] || die "no backup of $nginx_site in $dir"
  run cp -a "$dir$nginx_site" "$nginx_site"
  run rm -f /etc/nginx/conf.d/helena-local-owner-guard.conf
  run nginx -t && run systemctl reload nginx
}

step_permissions() {
  [[ -d $plan_backups ]] || { say "permissions: no $plan_backups"; return 0; }
  local loose
  loose=$(find "$plan_backups" -maxdepth 1 -type f -perm /077 | wc -l)
  say "permissions: $plan_backups $(stat -c %a "$plan_backups") → 700, $loose dump(s) → 600"
  if [[ $apply -eq 1 ]]; then
    install -d -m 0700 "$state"
    { stat -c '%a %n' "$plan_backups"; find "$plan_backups" -maxdepth 1 -type f -printf '%m %p\n'; } >"$state/permissions.before"
  fi
  run chmod 0700 "$plan_backups"
  run find "$plan_backups" -maxdepth 1 -type f -perm /077 -exec chmod 0600 {} +
  log "permissions tightened"
}
rollback_permissions() {
  [[ -e $state/permissions.before ]] || die "no record of the earlier modes"
  while read -r mode path; do run chmod "$mode" "$path"; done <"$state/permissions.before"
}

step_services() {
  for unit in redis-server ModemManager; do
    if systemctl is-enabled --quiet "$unit" 2>/dev/null || systemctl is-active --quiet "$unit" 2>/dev/null; then
      say "services: disable --now $unit"
      run systemctl disable --now "$unit"
      [[ $apply -eq 1 ]] && echo "$unit" >>"$state/services.disabled"
    fi
  done
  while IFS=: read -r name _ uid _ _ _ shell; do
    [[ $uid -gt 0 && $uid -lt 1000 && $name != postgres ]] || continue
    case "$shell" in */nologin|*/false|*/sync) continue ;; esac
    say "services: login shell of $name $shell → /usr/sbin/nologin"
    [[ $apply -eq 1 ]] && echo "$name $shell" >>"$state/shells.before"
    run usermod -s /usr/sbin/nologin "$name"
  done </etc/passwd
  log "services step done"
}
rollback_services() {
  [[ -e $state/services.disabled ]] && while read -r unit; do run systemctl enable --now "$unit"; done <"$state/services.disabled"
  [[ -e $state/shells.before ]] && while read -r name shell; do run usermod -s "$shell" "$name"; done <"$state/shells.before"
  true
}

step_sysctl() {
  local target=/etc/sysctl.d/90-helena-hardening.conf
  show_diff "$target" "$files/90-helena-hardening.conf"
  if [[ $apply -eq 1 ]]; then
    grep -Eo '^[a-z0-9_.]+' "$files/90-helena-hardening.conf" | while read -r key; do
      printf '%s = %s\n' "$key" "$(sysctl -n "$key" 2>/dev/null)"
    done >"$state/sysctl.before"
  fi
  run install -m 0644 "$files/90-helena-hardening.conf" "$target"
  run sysctl -q -p "$target"
  log "sysctl applied"
}
rollback_sysctl() {
  run rm -f /etc/sysctl.d/90-helena-hardening.conf
  [[ -e $state/sysctl.before ]] && run sysctl -q -p "$state/sysctl.before"
  true
}

step_journald() {
  local target=/etc/systemd/journald.conf.d/50-helena-journald.conf
  show_diff "$target" "$files/50-helena-journald.conf"
  run install -d -m 0755 /etc/systemd/journald.conf.d
  run install -m 0644 "$files/50-helena-journald.conf" "$target"
  run systemctl restart systemd-journald
  log "journald limits applied"
}
rollback_journald() {
  run rm -f /etc/systemd/journald.conf.d/50-helena-journald.conf
  run systemctl restart systemd-journald
}

render_nft() { # render_nft OUT
  local lan4 tunnel_uids
  lan4=$(lan4_cidr) || die "cannot read the home network from the default route"
  tunnel_uids=$(uids "$tunnel_user")
  sed -e "s|@LAN4@|$lan4|" \
    -e "s|@UIDS_CDP@|$(uids volition-browser volition-hermes "$owner_user")|" \
    -e "s|@UIDS_ROUTER@|$(uids volition-browser www-data "$owner_user")|" \
    -e "s|@UIDS_TOOLS@|$(uids www-data "$owner_user")|" \
    -e "s|@UIDS_SYNCTHING@|$(uids volition-sync volition-plan "$owner_user")|" \
    -e "s|@UIDS_TUNNEL@|$tunnel_uids|" \
    -e "s|@TUNNEL_PORT@|$tunnel_port|" \
    "$files/helena-hardening.nft.in" >"$1"
}
step_firewall() {
  local new=$state/pending/helena-hardening.nft target=/etc/nftables.d/helena-hardening.nft
  install -d -m 0700 "$state/pending"
  render_nft "$new"
  nft -c -f "$new" || die "the rendered ruleset does not load (nft -c)"
  show_diff "$target" "$new"
  guard_ssh_session
  grep -q 'include "/etc/nftables.d/\*.nft"' /etc/nftables.conf 2>/dev/null \
    || say "firewall: note: /etc/nftables.conf does not include /etc/nftables.d/*.nft; confirm adds the include"
  [[ $apply -eq 1 ]] || return 0
  arm_rollback firewall /usr/sbin/nft delete table inet helena_hardening
  nft -f "$new" || { disarm_rollback firewall; die "nft -f failed; nothing changed"; }
  install -m 0755 "$files/helena-lan6-sync" /usr/local/libexec/helena-lan6-sync
  /usr/local/libexec/helena-lan6-sync || say "firewall: lan6 sync failed (IPv6 LAN clients may be dropped until it runs)"
  log "firewall loaded (pending confirmation)"
  say "firewall: loaded. From a NEW SSH session and a LAN browser, check that both still work, then:"
  say "  sudo $here/apply.sh --apply confirm firewall"
}
confirm_firewall() {
  local new=$state/pending/helena-hardening.nft target=/etc/nftables.d/helena-hardening.nft
  [[ -e $new ]] || die "nothing pending"
  nft list table inet helena_hardening >/dev/null 2>&1 || die "the table is not loaded (rolled back already?); run the step again"
  disarm_rollback firewall
  keep "$target"
  run install -d -m 0755 /etc/nftables.d
  run install -m 0644 "$new" "$target"
  if ! grep -q 'include "/etc/nftables.d/\*.nft"' /etc/nftables.conf; then
    keep /etc/nftables.conf
    run sh -c 'echo "include \"/etc/nftables.d/*.nft\"" >>/etc/nftables.conf'
  fi
  run systemctl enable nftables.service
  run install -m 0644 "$files/helena-lan6-sync.service" /etc/systemd/system/helena-lan6-sync.service
  run install -m 0644 "$files/helena-lan6-sync.timer" /etc/systemd/system/helena-lan6-sync.timer
  run install -m 0755 "$files/90-helena-lan6" /etc/NetworkManager/dispatcher.d/90-helena-lan6
  run systemctl daemon-reload
  run systemctl enable --now helena-lan6-sync.service helena-lan6-sync.timer
  log "firewall confirmed"
}
rollback_firewall() {
  disarm_rollback firewall
  run nft delete table inet helena_hardening 2>/dev/null
  run rm -f /etc/nftables.d/helena-hardening.nft /etc/NetworkManager/dispatcher.d/90-helena-lan6
  run systemctl disable --now helena-lan6-sync.timer helena-lan6-sync.service 2>/dev/null
  true
}

step_sshd() {
  local target=/etc/ssh/sshd_config.d/50-helena-sshd.conf new
  new=$(mktemp)
  sed "s|@SSH_USERS@|$ssh_users|" "$files/50-helena-sshd.conf" >"$new"
  show_diff "$target" "$new"
  guard_ssh_session
  for u in $ssh_users; do
    id "$u" >/dev/null 2>&1 || die "AllowUsers names $u, which does not exist"
    [[ -s $(getent passwd "$u" | cut -d: -f6)/.ssh/authorized_keys ]] || die "$u has no authorized_keys; refusing (it would lock the account out)"
  done
  if [[ -n ${SUDO_USER:-} && " $ssh_users " != *" $SUDO_USER "* ]]; then
    die "you ($SUDO_USER) are not in AllowUsers ($ssh_users)"
  fi
  [[ $apply -eq 1 ]] || { rm -f "$new"; return 0; }
  keep "$target"
  install -m 0644 "$new" "$target"; rm -f "$new"
  if ! sshd -t; then rm -f "$target"; [[ -e $backup$target ]] && cp -a "$backup$target" "$target"; die "sshd -t failed; nothing changed"; fi
  arm_rollback sshd /bin/sh -c "rm -f $target && systemctl reload ssh"
  systemctl reload ssh
  log "sshd drop-in loaded (pending confirmation)"
  say "sshd: reloaded (this session stays open). Open a NEW SSH session, then:"
  say "  sudo $here/apply.sh --apply confirm sshd"
}
confirm_sshd() { disarm_rollback sshd; log "sshd confirmed"; }
rollback_sshd() {
  disarm_rollback sshd
  run rm -f /etc/ssh/sshd_config.d/50-helena-sshd.conf
  run systemctl reload ssh
}

unit_healthy() { # unit_healthy UNIT: active for 20 s and its port answers
  local unit=$1 i
  for i in $(seq 1 30); do sleep 1; systemctl is-active --quiet "$unit" || continue; [[ $i -ge 8 ]] && break; done
  systemctl is-active --quiet "$unit" || return 1
  case "$unit" in
    *-api) curl -fsS -m 5 http://127.0.0.1:3000/ >/dev/null ;;
    *-web) curl -sS -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/login | grep -Eq '^(200|30[0-9])$' ;;
    *) true ;;
  esac
}
step_units() {
  for unit in $api_units; do
    systemctl cat "$unit" >/dev/null 2>&1 || { say "units: $unit not installed, skipped"; continue; }
    local target=/etc/systemd/system/$unit.service.d/60-helena-hardening.conf
    show_diff "$target" "$files/60-helena-hardening.conf"
    [[ $apply -eq 1 ]] || continue
    keep "$target"
    install -d -m 0755 "$(dirname "$target")"
    install -m 0644 "$files/60-helena-hardening.conf" "$target"
    systemctl daemon-reload
    say "units: restarting $unit"
    systemctl restart "$unit"
    if unit_healthy "$unit"; then
      say "units: $unit healthy ($(systemd-analyze security --no-pager "$unit" 2>/dev/null | awk '/Overall exposure level/ {print $(NF-2)}'))"
      log "units: $unit hardened"
    else
      say "units: $unit did not come back; removing the drop-in"
      rm -f "$target"; systemctl daemon-reload; systemctl restart "$unit"
      log "units: $unit rolled back"
      die "units: stopped at $unit (see journalctl -u $unit)"
    fi
  done
}
rollback_units() {
  for unit in $api_units; do
    [[ -e /etc/systemd/system/$unit.service.d/60-helena-hardening.conf ]] || continue
    run rm -f "/etc/systemd/system/$unit.service.d/60-helena-hardening.conf"
    run systemctl daemon-reload
    run systemctl restart "$unit"
  done
}

step_terminal_key() {
  local key=/etc/volition/owner-terminal.key group=helena-terminal-key
  [[ -e $key ]] || { say "terminal-key: no $key"; return 0; }
  say "terminal-key: $key $(stat -c '%a %U:%G' "$key") → 0640 root:$group (API + owner-terminal router only)"
  run groupadd --system -f "$group"
  for unit in volition-plan-api volition-owner-terminal; do
    local dropin=/etc/systemd/system/$unit.service.d/61-helena-terminal-key.conf
    say "terminal-key: $dropin: SupplementaryGroups=$group"
    if [[ $apply -eq 1 ]]; then
      install -d -m 0755 "$(dirname "$dropin")"
      printf '[Service]\nSupplementaryGroups=%s\n' "$group" >"$dropin"
    fi
  done
  run systemctl daemon-reload
  [[ $apply -eq 1 ]] && stat -c '%a %U %G' "$key" >"$state/terminal-key.before"
  # Both services must hold the group before the file changes hands.
  run systemctl restart volition-plan-api volition-owner-terminal
  run chgrp "$group" "$key"
  run chmod 0640 "$key"
  log "terminal key moved to group $group"
}
rollback_terminal_key() {
  local key=/etc/volition/owner-terminal.key
  [[ -e $state/terminal-key.before ]] || die "no record"
  read -r mode user grp <"$state/terminal-key.before"
  run chown "$user:$grp" "$key"; run chmod "$mode" "$key"
  run rm -f /etc/systemd/system/volition-plan-api.service.d/61-helena-terminal-key.conf \
    /etc/systemd/system/volition-owner-terminal.service.d/61-helena-terminal-key.conf
  run systemctl daemon-reload
  run systemctl restart volition-plan-api volition-owner-terminal
}

# KasmVNC's UDP listener binds every address and has no "off" (nginx/README.md). The
# firewall already drops it from the network; this adds the unit-level wall natively
# (cgroup BPF works outside the old container). Restarting Xvnc takes the project browser's
# display away, so Chromium restarts too: run it in a quiet moment.
step_kasm_loopback() {
  local dropin=/etc/systemd/system/volition-project-browser-kasm@.service.d/60-helena-loopback.conf
  local body=$'[Service]\nIPAddressAllow=localhost\nIPAddressDeny=any\n'
  if [[ -e $dropin ]]; then say "kasm-loopback: $dropin present"; else say "kasm-loopback: new $dropin (IPAddressAllow=localhost, IPAddressDeny=any)"; fi
  [[ $apply -eq 1 ]] || return 0
  install -d -m 0755 "$(dirname "$dropin")"
  printf '%s' "$body" >"$dropin"
  systemctl daemon-reload
  for unit in $(systemctl list-units --plain --no-legend 'volition-project-browser-kasm@*' | awk '{print $1}'); do
    say "kasm-loopback: restarting $unit (and its browser)"
    systemctl restart "$unit" "${unit/kasm/chromium}"
  done
  log "kasm loopback drop-in installed"
}
rollback_kasm_loopback() {
  run rm -f /etc/systemd/system/volition-project-browser-kasm@.service.d/60-helena-loopback.conf
  run systemctl daemon-reload
  say "kasm-loopback: removed; the running Xvnc keep the wall until their next restart"
}

step_audit_timer() {
  say "audit-timer: install /usr/local/libexec/helena-security-audit + helena-security-audit.timer (hourly)"
  run "$here/audit.sh" --install-timer
}
rollback_audit_timer() {
  run systemctl disable --now helena-security-audit.timer
  run rm -f /etc/systemd/system/helena-security-audit.{service,timer} /usr/local/libexec/helena-security-audit
  run systemctl daemon-reload
}

status() {
  "$here/audit.sh" || true
  echo
  systemctl list-timers --all --no-legend 'helena-hardening-rollback-*' 2>/dev/null | sed 's/^/pending rollback: /'
  [[ -e $state/apply.log ]] && { echo; echo "last actions:"; tail -n 10 "$state/apply.log"; }
}

# ── Dispatch ───────────────────────────────────────────────────────────────────
need_root
if [[ $apply -eq 1 ]]; then
  install -d -m 0700 "$state"
else
  # The dry run writes nothing on the host: its renders and records go to a scratch folder.
  state=$(mktemp -d "${TMPDIR:-/tmp}/helena-hardening-dry.XXXXXX")
  backup=$state/backup/$stamp
  trap 'rm -rf "$state"' EXIT
fi
fn=step
case "${1:-}" in
  confirm) fn=confirm; shift ;;
  rollback) fn=rollback; shift ;;
  status) status; exit 0 ;;
  "") sed -n '2,40p' "$0"; exit 2 ;;
esac
name=${1:-}
[[ -n $name ]] || die "which step?"
func="${fn}_${name//-/_}"
declare -F "$func" >/dev/null || die "unknown: $fn $name"
[[ $apply -eq 1 ]] || say "dry run (add --apply to change anything)"
"$func"
