#!/usr/bin/env bash
# Run a command with the dev env file loaded. Values are exported literally, so
# characters such as & or # in a value are never interpreted by the shell.
set -euo pipefail

while IFS= read -r line || [[ -n $line ]]; do
  [[ -z $line || $line == \#* || $line != *=* ]] && continue
  export "$line"
done </etc/volition/plan-dev.env

exec "$@"
