#!/usr/bin/env bash
# Installs the kiosk shown on Kingston's own monitors after a native boot (see README.md).
# Idempotent; does nothing visible inside the container.
#
#   sudo deployment/volition-stack/native/kiosk/install.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "install.sh: run with sudo" >&2; exit 1; }
here=$(cd "$(dirname "$0")" && pwd)
command -v wlr-randr >/dev/null || { echo "install.sh: wlr-randr is missing (apt install wlr-randr)" >&2; exit 1; }
id plan-kiosk >/dev/null 2>&1 || useradd --create-home --home-dir /var/lib/plan-kiosk --shell /bin/bash --comment "Plan kiosk display" plan-kiosk
install -m 0755 "$here/plan-kiosk.sh" /usr/local/libexec/volition-plan-kiosk
install -m 0755 "$here/kiosk-session.sh" /usr/local/libexec/volition-plan-kiosk-session
install -m 0755 "$here/kiosk-hotplug.sh" /usr/local/libexec/volition-plan-kiosk-hotplug
install -m 0644 "$here/90-volition-kiosk.rules" /etc/udev/rules.d/90-volition-kiosk.rules
install -d -m 0755 /etc/systemd/system/getty@tty1.service.d
install -m 0644 "$here/getty-autologin.conf" /etc/systemd/system/getty@tty1.service.d/plan-kiosk.conf
install -m 0644 -o plan-kiosk -g plan-kiosk "$here/bash_profile" /var/lib/plan-kiosk/.bash_profile
# The kiosk reaches Helena as the owner through nginx on 127.0.0.1:8088 (local-owner/
# configure.py); nftables sends the kiosk user's port 80 there and keeps everyone else out.
install -d -m 0755 /etc/nftables.d
install -m 0644 "$here/helena-kiosk.nft" /etc/nftables.d/helena-kiosk.nft
if ! grep -q '^include "/etc/nftables.d/\*.nft"' /etc/nftables.conf; then
  cp -p /etc/nftables.conf "/etc/nftables.conf.bak-$(date +%Y%m%d%H%M%S)"
  printf '\ninclude "/etc/nftables.d/*.nft"\n' >>/etc/nftables.conf
fi
systemctl enable --now nftables.service >/dev/null
nft -f /etc/nftables.d/helena-kiosk.nft
systemctl daemon-reload
udevadm control --reload 2>/dev/null || true
echo "install.sh: kiosk installed"
