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
#   sudo-model    H-07/§8.3: helena-ops is the automation account (sudo without a password,
#                 SSH key only, password locked); any other blanket NOPASSWD rule (the
#                 owner's) is moved aside, so the owner types his password for sudo
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
state=${HELENA_HARDENING_STATE:-/var/lib/helena/hardening}
stamp=$(date +%Y%m%d-%H%M%S)
backup=$state/backup/$stamp
owner_user=${HELENA_OWNER_USER:-wilhelmpa}
ops_user=${HELENA_OPS_USER:-helena-ops}
# AllowUsers: the owner, and the automation account once it exists (a later "sshd" run must
# never drop it).
ssh_users=${HELENA_SSH_USERS:-$owner_user$(id "$ops_user" >/dev/null 2>&1 && echo " $ops_user")}
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
lan4_cidr() {
  local dev
  dev=$(ip -4 route show default 2>/dev/null | awk '{for(i=1;i<NF;i++) if ($i=="dev") {print $(i+1); exit}}')
  [[ -n $dev ]] || return 1
  ip -4 -o addr show dev "$dev" scope global | awk '{print $4}' | head -n 1 \
    | python3 -c 'import ipaddress,sys; print(ipaddress.ip_interface(sys.stdin.read().strip()).network)'
}

# A step that could cut SSH off runs only when every open SSH connection comes from the home
# network (sudo drops SSH_CONNECTION, so the connections are read from the kernel instead):
# the session running this, whichever it is, keeps working afterwards.
guard_ssh_session() {
  local lan4 peers
  lan4=$(lan4_cidr) || die "cannot tell the home network; refusing to touch SSH or the firewall"
  peers=$(ss -Htn state established '( sport = :22 )' 2>/dev/null | awk '{print $4}' | sed -E 's/:[0-9]+$//; s/^\[//; s/\]$//' | sort -u)
  [[ -n ${SSH_CONNECTION:-} ]] && peers+=$'\n'$(awk '{print $1}' <<<"$SSH_CONNECTION")
  [[ -n ${peers//[[:space:]]/} ]] || return 0
  python3 - "$lan4" $peers <<'PY' || die "an SSH connection comes from outside the home network (see above); run the step from the LAN or the console"
import ipaddress, subprocess, sys
lan4 = ipaddress.ip_network(sys.argv[1])
own = subprocess.run(['ip', '-6', '-o', 'addr', 'show', 'scope', 'global'], capture_output=True, text=True).stdout
nets = [ipaddress.ip_interface(line.split()[3]).network for line in own.splitlines()
        if len(line.split()) > 3 and line.split()[3].endswith('/64')]
bad = []
for peer in sys.argv[2:]:
    address = ipaddress.ip_address(peer.split('%')[0])
    if address.version == 6 and address.ipv4_mapped:
        address = address.ipv4_mapped
    if address.version == 4:
        ok = address in lan4 or address.is_loopback
    else:
        ok = (address.is_link_local or address.is_loopback or address in ipaddress.ip_network('fc00::/7')
              or any(address in n for n in nets))
    if not ok:
        bad.append(str(address))
if bad:
    print('apply.sh: SSH from outside the home network: ' + ', '.join(bad))
sys.exit(1 if bad else 0)
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
    -e "s|@UIDS_ROUTER@|$(uids volition-browser www-data volition-plan "$owner_user")|" \
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

# ── sudo model (H-07, docs/helena-decisions/security-hardening.md §8.3) ─────────
# Active (non-comment) lines of a sudoers file that grant NOPASSWD: ALL.
blanket_rules() { grep -E '^[[:space:]]*[^#[:space:]].*NOPASSWD:[[:space:]]*ALL[[:space:]]*$' "$1" 2>/dev/null; }
# The rules of a sudoers file without comments and blank lines, whitespace folded.
active_rules() { grep -Ev '^[[:space:]]*(#|$)' "$1" 2>/dev/null | tr -s '[:space:]' ' ' | sed 's/ $//'; }
sudo_ok() { visudo -c >/dev/null 2>&1; }

step_sudo_model() {
  local ops_sudoers=/etc/sudoers.d/80-helena-ops ops_sshd=/etc/ssh/sshd_config.d/60-helena-ops.conf
  local home keys status file rules others moved=0 blanket_files=()
  # 0. Other blanket rules go aside at the end — only while the owner can still reach root
  #    with his password (group sudo + a %sudo rule, a usable password). Checked first, so a
  #    refusal changes nothing.
  if blanket_rules /etc/sudoers | awk '{print $1}' | grep -vqxF -- "$ops_user"; then
    die "sudo-model: /etc/sudoers itself grants NOPASSWD: ALL to someone else; change it with visudo by hand"
  fi
  for file in /etc/sudoers.d/*; do
    [[ -f $file && $file != "$ops_sudoers" ]] || continue
    [[ -n $(blanket_rules "$file" | awk -v ops="$ops_user" '$1 != ops') ]] && blanket_files+=("$file")
  done
  if [[ ${#blanket_files[@]} -gt 0 ]]; then
    [[ $(passwd -S "$owner_user" 2>/dev/null | awk '{print $2}') == P ]] \
      || die "sudo-model: $owner_user has no usable password; set one (passwd) before sudo asks for it"
    if ! id -nG "$owner_user" 2>/dev/null | tr ' ' '\n' | grep -qx sudo \
       || ! grep -Eq '^[[:space:]]*%sudo[[:space:]]+ALL[[:space:]]*=' /etc/sudoers; then
      die "sudo-model: $owner_user would lose sudo (not in group sudo, or no %sudo rule in /etc/sudoers)"
    fi
  fi
  # 1. The automation account: it exists, it has a key, its password is locked.
  if ! id "$ops_user" >/dev/null 2>&1; then
    say "sudo-model: $ops_user does not exist; creating it (home, bash, no password)"
    run useradd --create-home --shell /bin/bash --comment "Helena automation (SSH key only, LAN)" "$ops_user"
  fi
  home=$(getent passwd "$ops_user" | cut -d: -f6)
  keys=${home:-/nonexistent}/.ssh/authorized_keys
  if [[ ! -s $keys ]]; then
    [[ $apply -eq 1 ]] && die "sudo-model: $keys is empty; put the automation key there first (this step never makes a key)"
    say "sudo-model: $keys is empty; --apply stops here until the automation key is there"
  fi
  status=$(passwd -S "$ops_user" 2>/dev/null | awk '{print $2}')
  if [[ $status == L ]]; then
    say "sudo-model: $ops_user password locked (already)"
  else
    say "sudo-model: locking the password of $ops_user (was ${status:-unknown})"
    run passwd -l "$ops_user"
  fi
  # 2. SSH takes its key only.
  if cmp -s "$files/60-helena-ops.conf" "$ops_sshd"; then
    say "sudo-model: $ops_sshd unchanged"
  else
    show_diff "$ops_sshd" "$files/60-helena-ops.conf"
    if [[ $apply -eq 1 ]]; then
      keep "$ops_sshd"
      install -m 0644 -o root -g root "$files/60-helena-ops.conf" "$ops_sshd"
      if ! sshd -t; then
        rm -f "$ops_sshd"; [[ -e $backup$ops_sshd ]] && cp -a "$backup$ops_sshd" "$ops_sshd"
        die "sudo-model: sshd -t failed; $ops_sshd left as it was"
      fi
      systemctl reload ssh
      log "sudo-model: $ops_sshd installed"
    fi
  fi
  # 3. Its sudo rule.
  visudo -cf "$files/80-helena-ops" >/dev/null || die "sudo-model: files/80-helena-ops does not parse"
  if cmp -s "$files/80-helena-ops" "$ops_sudoers"; then
    say "sudo-model: $ops_sudoers unchanged"
  elif [[ -e $ops_sudoers && "$(active_rules "$ops_sudoers")" == "$(active_rules "$files/80-helena-ops")" ]]; then
    say "sudo-model: $ops_sudoers already grants the same rule (only comments differ); left as it is"
  else
    show_diff "$ops_sudoers" "$files/80-helena-ops"
    if [[ $apply -eq 1 ]]; then
      keep "$ops_sudoers"
      install -m 0440 -o root -g root "$files/80-helena-ops" "$ops_sudoers"
      sudo_ok || { rm -f "$ops_sudoers"; [[ -e $backup$ops_sudoers ]] && cp -a "$backup$ops_sudoers" "$ops_sudoers"; die "sudo-model: visudo -c failed; $ops_sudoers left as it was"; }
      log "sudo-model: $ops_sudoers installed"
    fi
  fi
  # 4. Every other blanket NOPASSWD rule goes aside (checked in step 0).
  for file in "${blanket_files[@]}"; do
    rules=$(blanket_rules "$file" | awk -v ops="$ops_user" '$1 != ops')
    moved=1
    say "sudo-model: $file grants NOPASSWD: ALL: $(tr '\n' ';' <<<"$rules")"
    others=$(grep -Ev '^[[:space:]]*(#|$)' "$file" | grep -vxF -f <(blanket_rules "$file" | awk -v ops="$ops_user" '$1 != ops') || true)
    if [[ -z $others ]]; then
      say "sudo-model: moving $file aside (to the backup of this run)"
      if [[ $apply -eq 1 ]]; then
        keep "$file"; rm -f "$file"
        echo "$file" >>"$state/sudo-model.moved"
      fi
    else
      say "sudo-model: commenting out those lines in $file (it has other rules too)"
      if [[ $apply -eq 1 ]]; then
        local new; new=$(mktemp)
        awk -v ops="$ops_user" '/^[[:space:]]*[^#[:space:]].*NOPASSWD:[[:space:]]*ALL[[:space:]]*$/ && $1 != ops { print "# helena sudo-model: " $0; next } { print }' "$file" >"$new"
        visudo -cf "$new" >/dev/null || { rm -f "$new"; die "sudo-model: $file would not parse without those lines"; }
        keep "$file"; install -m 0440 -o root -g root "$new" "$file"; rm -f "$new"
        echo "$file" >>"$state/sudo-model.moved"
      fi
    fi
    if [[ $apply -eq 1 ]] && ! sudo_ok; then
      cp -a "$backup$file" "$file"; die "sudo-model: visudo -c failed; $file restored"
    fi
    [[ $apply -eq 1 ]] && log "sudo-model: blanket rule of $file set aside (backup $backup$file)"
  done
  [[ $moved -eq 1 ]] || say "sudo-model: no other account has NOPASSWD: ALL (already)"
  [[ $apply -eq 1 ]] && say "sudo-model: done. The owner now types his password for sudo; $ops_user keeps key-only root."
  true
}
rollback_sudo_model() {
  # Puts the owner's moved-aside rules back (the automation account stays as it is).
  local file saved
  [[ -s $state/sudo-model.moved ]] || { say "sudo-model: nothing was moved aside"; return 0; }
  while read -r file; do
    saved=$(ls -1d "$state"/backup/*"$file" 2>/dev/null | sort | tail -n 1)
    [[ -n $saved ]] || { say "sudo-model: no backup of $file"; continue; }
    say "sudo-model: restoring $file from $saved"
    run install -m 0440 -o root -g root "$saved" "$file"
  done < <(sort -u "$state/sudo-model.moved")
  if [[ $apply -eq 1 ]]; then
    sudo_ok || die "sudo-model: visudo -c failed after the restore; check /etc/sudoers.d by hand"
    rm -f "$state/sudo-model.moved"
  fi
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
