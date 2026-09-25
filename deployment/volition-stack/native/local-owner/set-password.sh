#!/bin/bash
# Sets a Helena password from the console, for an owner who does not know the old one while
# Helena has no mail provider for a reset link. Asks twice, hidden; the password goes to the
# API's script (apps/api/src/scripts/set-password.ts) on stdin, never on a command line or into a
# file. Every session of that account ends; on the home network the owner is signed in again
# at once.
#
#   sudo deployment/volition-stack/native/local-owner/set-password.sh <email>
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Bitte mit sudo starten." >&2; exit 1; }
email=${1:?"Aufruf: sudo $0 <E-Mail-Adresse des Helena-Kontos>"}
here=$(cd "$(dirname "$0")" && pwd)
api=$(cd "$here/../../../../apps/api" && pwd)
env_file=${HELENA_API_ENV:-/etc/volition/plan.env}
api_user=${HELENA_API_USER:-volition-plan}
bun=$(command -v bun || echo /usr/local/bin/bun)
read -rsp "Neues Helena-Passwort für $email: " first </dev/tty
echo >/dev/tty
read -rsp "Noch einmal: " second </dev/tty
echo >/dev/tty
if [[ "$first" != "$second" ]]; then
  echo "Die beiden Eingaben stimmen nicht überein. Nichts geändert." >&2
  exit 1
fi
printf "%s" "$first" | systemd-run --wait --pipe --collect --quiet --uid="$api_user" \
  -p EnvironmentFile="$env_file" -p WorkingDirectory="$api" \
  "$bun" src/scripts/set-password.ts --email "$email"
