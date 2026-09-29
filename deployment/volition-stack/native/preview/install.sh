#!/usr/bin/env bash
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
here=$(cd "$(dirname "$0")" && pwd)
packages=(libreoffice-core-nogui libreoffice-calc-nogui libreoffice-impress-nogui libreoffice-writer-nogui)
missing=()
for package in "${packages[@]}"; do
  dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -qx 'install ok installed' || missing+=("$package")
done
if ((${#missing[@]})); then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
fi

getent group volition-preview >/dev/null || groupadd --system volition-preview
id volition-preview >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --gid volition-preview volition-preview
install -m 0644 "$here/volition-preview.service" /etc/systemd/system/volition-preview.service
install -d -m 0755 /etc/systemd/system/volition-plan-api.service.d
printf '[Service]\nSupplementaryGroups=volition-preview\n' >/etc/systemd/system/volition-plan-api.service.d/preview.conf
systemctl daemon-reload
systemctl enable volition-preview.service
systemctl restart volition-preview.service
echo 'Restart volition-plan-api.service after installing this unit so it can access the preview socket.'
