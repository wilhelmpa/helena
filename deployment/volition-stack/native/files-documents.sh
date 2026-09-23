#!/usr/bin/env bash
# The live steps of the Files page and of the attachments in the vault. deploy.sh runs it
# after the database migration; every step checks first and changes only what is not
# in place yet, so a second run changes nothing.
#
# 1. The vault's trash folder, and Private/ for the owner: group volition-private, which
#    the Plan API user joins and the agents' user does not. Plan never creates Private/.
# 2. code-server may open and edit the vault (drop-in vault.conf), for "Open in VS Code".
# 3. The issue attachments still in the object store move into their task folders of the
#    vault, once; the run writes a receipt to /var/lib/volition/plan/storage/receipts.
#
#   sudo deployment/volition-stack/native/files-documents.sh
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "files-documents.sh: run with sudo" >&2; exit 1; }

here=$(cd "$(dirname "$0")" && pwd)
vault=/srv/volition/vault

[[ -d $vault/.trash ]] || install -d -o root -g volition -m 2770 "$vault/.trash"

if ! getent group volition-private >/dev/null; then
  groupadd --system volition-private
fi
if [[ " $(id -nG volition-plan) " != *" volition-private "* ]]; then
  usermod -a -G volition-private volition-plan
  # The API reads its groups when it starts.
  restart_api=1
fi
[[ -d $vault/Private ]] || install -d -o root -g volition-private -m 2770 "$vault/Private"

dropin=/etc/systemd/system/volition-code.service.d/vault.conf
if ! cmp -s "$here/systemd/volition-code.service.d/vault.conf" "$dropin"; then
  install -D -m 0644 "$here/systemd/volition-code.service.d/vault.conf" "$dropin"
  systemctl daemon-reload
  systemctl try-restart volition-code.service
fi

unit=volition-plan-attachments-to-vault.service
if ! cmp -s "$here/systemd/$unit" "/etc/systemd/system/$unit"; then
  install -m 0644 "$here/systemd/$unit" /etc/systemd/system/
  systemctl daemon-reload
fi
# A failed attachment stays in the object store and is served from there; the next run
# retries it, so it does not stop the deploy.
if ! systemctl start "$unit"; then
  echo "files-documents.sh: some attachments were not moved, see journalctl -u $unit" >&2
fi
journalctl -u "$unit" -n 2 --no-pager -o cat || true

if [[ ${restart_api:-0} == 1 ]]; then
  systemctl try-restart volition-plan-api.service
fi
