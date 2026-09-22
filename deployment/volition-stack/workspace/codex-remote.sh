#!/bin/bash
# Opt-in, account-paired Codex access inside this unprivileged container only.
# No host listener, Docker socket, extra capability or system credentials.
set -uo pipefail
umask 077
state="${HOME}/.codex"
mkdir -p "$state"
chmod 0700 "$state"
trap 'codex remote-control stop >/dev/null 2>&1 || true; exit 0' TERM INT
while [[ -f "$state/remote-control.enabled" ]]; do
  if [[ -f "$state/auth.json" ]] && codex login status >/dev/null 2>&1; then
    # start is idempotent for an already running daemon. Keep diagnostic output
    # private and bounded, never in the public container log or a project.
    codex remote-control start --json >"$state/remote-control-status.json.new" 2>"$state/remote-control-error.log" &&
      mv "$state/remote-control-status.json.new" "$state/remote-control-status.json"
  fi
  sleep 30 &
  wait "$!" || true
done
codex remote-control stop >/dev/null 2>&1 || true
