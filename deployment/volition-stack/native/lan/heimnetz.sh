#!/usr/bin/env bash
# Prepare Kingston as the home DNS/DHCP server. Mutations require --apply.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ACTION=${1:-}
shift || true
APPLY=0
CONFIRM=0
EXPLICIT_DRY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0; EXPLICIT_DRY=1 ;;
    --confirm) CONFIRM=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done
LAN_IF=eno1
LAN_IP=192.168.2.58
GATEWAY=192.168.2.1
DNS_DIR=/etc/helena/dnsmasq.d
DNS_UNIT=/etc/systemd/system/helena-dnsmasq.service
STATIC_NAME=helena-heimnetz-static
ROLLBACK_STATE=/run/helena-heimnetz-rollback

usage() {
  echo 'Usage: heimnetz.sh status|static-ip|dns-on|dhcp-on|dhcp-off|verify [--apply|--dry-run] [--confirm]' >&2
  exit 2
}
run() {
  if (( APPLY )); then "$@"; else printf 'DRY-RUN:'; printf ' %q' "$@"; printf '\n'; fi
}
need_root() {
  if (( APPLY )) && (( EUID != 0 )); then echo 'Run --apply as root.' >&2; exit 1; fi
}
require_lan() {
  ip -o -4 addr show dev "$LAN_IF" | grep -q "inet $LAN_IP/24 " || {
    echo "$LAN_IF must have $LAN_IP/24 before this action" >&2; exit 1;
  }
}

case "$ACTION" in
  status)
    ip -o -4 addr show dev "$LAN_IF" || true
    ip -4 route show default || true
    nmcli -t -f NAME,UUID,DEVICE con show --active || true
    systemctl is-active helena-dnsmasq.service || true
    if [[ -f $DNS_DIR/dhcp.conf ]]; then echo 'Helena DHCP: enabled'; else echo 'Helena DHCP: disabled'; fi
    ;;
  static-ip)
    need_root
    if (( CONFIRM )); then
      if (( ! APPLY )); then echo 'DRY-RUN: confirm static address and cancel rollback timer'; exit 0; fi
      require_lan
      [[ -f $ROLLBACK_STATE ]] || { echo 'No pending static-IP rollback' >&2; exit 1; }
      rollback_unit=$(sed -n '2p' "$ROLLBACK_STATE")
      systemctl stop "$rollback_unit.timer"
      rm -f "$ROLLBACK_STATE"
      echo 'Static IP confirmed; rollback timer cancelled.'
      exit 0
    fi
    old_uuid=$(nmcli -g GENERAL.CON-UUID dev show "$LAN_IF")
    [[ -n $old_uuid ]] || { echo 'No active NetworkManager profile on LAN interface' >&2; exit 1; }
    if nmcli -g NAME con show "$STATIC_NAME" >/dev/null 2>&1; then
      echo "Profile $STATIC_NAME already exists; refusing to overwrite" >&2; exit 1
    fi
    if (( ! APPLY )); then
      echo "DRY-RUN: clone active profile $old_uuid to $STATIC_NAME"
      echo "DRY-RUN: set $LAN_IP/24, gateway $GATEWAY, DNS $GATEWAY and 1.1.1.1 on $LAN_IF"
      echo 'DRY-RUN: schedule automatic rollback after 3 minutes; then activate static profile'
      echo 'DRY-RUN: confirm with static-ip --confirm --apply after connection is proven'
      exit 0
    fi
    rollback_unit="helena-static-ip-rollback-$$"
    printf '%s\n%s\n' "$old_uuid" "$rollback_unit" > "$ROLLBACK_STATE"
    chmod 600 "$ROLLBACK_STATE"
    if ! nmcli con clone "$old_uuid" "$STATIC_NAME"; then
      rm -f "$ROLLBACK_STATE"
      exit 1
    fi
    if ! nmcli con mod "$STATIC_NAME" connection.interface-name "$LAN_IF" connection.autoconnect-priority 100 \
      ipv4.method manual ipv4.addresses "$LAN_IP/24" ipv4.gateway "$GATEWAY" \
      ipv4.dns "$GATEWAY,1.1.1.1" ipv4.ignore-auto-dns yes; then
      nmcli con delete "$STATIC_NAME"
      rm -f "$ROLLBACK_STATE"
      exit 1
    fi
    if ! systemd-run --quiet --on-active=3m --unit="$rollback_unit" \
      "$(readlink -f "$0")" rollback --apply; then
      nmcli con delete "$STATIC_NAME"
      rm -f "$ROLLBACK_STATE"
      exit 1
    fi
    if ! nmcli --wait 20 con up "$STATIC_NAME" ifname "$LAN_IF"; then
      "$(readlink -f "$0")" rollback --apply
      exit 1
    fi
    echo 'Static IP active. Run static-ip --confirm --apply within 3 minutes.'
    ;;
  rollback)
    need_root
    [[ -f $ROLLBACK_STATE ]] || exit 0
    old_uuid=$(cat "$ROLLBACK_STATE")
    run nmcli --wait 20 con up "$old_uuid" ifname "$LAN_IF"
    run nmcli con delete "$STATIC_NAME"
    run rm -f "$ROLLBACK_STATE"
    ;;
  dns-on)
    need_root
    if (( APPLY )); then require_lan; fi
    run install -d -m 755 "$DNS_DIR"
    run install -m 644 "$HERE/helena.conf" "$DNS_DIR/helena.conf"
    run install -m 644 "$HERE/helena-dnsmasq.service" "$DNS_UNIT"
    run systemctl daemon-reload
    run /usr/sbin/dnsmasq --test --conf-file=/dev/null --conf-dir="$DNS_DIR"
    run systemctl enable --now helena-dnsmasq.service
    run systemctl restart helena-dnsmasq.service
    ;;
  dhcp-on)
    need_root
    if (( APPLY )); then
      require_lan
      [[ -f $DNS_DIR/helena.conf ]] || { echo 'Run dns-on first' >&2; exit 1; }
      systemctl is-active --quiet helena-dnsmasq.service || { echo 'DNS service is not active' >&2; exit 1; }
    fi
    run install -m 644 "$HERE/dhcp.conf.disabled" "$DNS_DIR/dhcp.conf"
    run /usr/sbin/dnsmasq --test --conf-file=/dev/null --conf-dir="$DNS_DIR"
    run systemctl restart helena-dnsmasq.service
    ;;
  dhcp-off)
    need_root
    run rm -f "$DNS_DIR/dhcp.conf"
    run systemctl restart helena-dnsmasq.service
    ;;
  verify)
    if (( EXPLICIT_DRY )); then
      echo 'DRY-RUN: check LAN DNS, certificate, no-cookie and /cdn-cgi Edge paths, and DHCP leases'
      exit 0
    fi
    python3 "$HERE/verify_heimnetz.py"
    ;;
  *) usage ;;
esac
