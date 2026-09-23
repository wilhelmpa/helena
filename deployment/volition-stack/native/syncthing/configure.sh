#!/usr/bin/env bash
# Configures the running Syncthing through its REST API: the folder "Volition" at the
# vault, and no crash or usage reports. Safe to run again; setup.sh runs it.
#
#   configure.sh URL KEY_FILE VAULT
set -euo pipefail

if (($# != 3)); then
  echo "usage: $0 URL KEY_FILE VAULT" >&2
  exit 2
fi
url=$1
key_file=$2
vault=$3

# The key goes through stdin, so it never shows up in the process list.
api() {
  local method=$1 path=$2
  shift 2
  printf 'X-API-Key: %s\n' "$(<"$key_file")" |
    curl -sS -H @- -H 'Content-Type: application/json' -X "$method" "$@" "$url$path"
}

curl -sf -o /dev/null --retry 30 --retry-delay 1 --retry-all-errors "$url/rest/noauth/health" || {
  echo "configure.sh: Syncthing does not answer on $url" >&2
  exit 1
}

# Devices send their own file modes: 0644 from a Mac, none from a phone. With
# ignorePerms Syncthing does not apply them and creates files with 0666 and
# directories with 0777, reduced by the unit's UMask, so Plan can write what a
# device synced.
folder='"label":"Volition","path":"'"$vault"'","type":"sendreceive","ignorePerms":true'
if [[ $(api GET /rest/config/folders/volition -o /dev/null -w '%{http_code}') == 404 ]]; then
  api POST /rest/config/folders --fail -d "{\"id\":\"volition\",$folder}"
else
  api PATCH /rest/config/folders/volition --fail -d "{$folder}"
fi
api PATCH /rest/config/options --fail -d '{"crashReportingEnabled":false,"urAccepted":-1}'
