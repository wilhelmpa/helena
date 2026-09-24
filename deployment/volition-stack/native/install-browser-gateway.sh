#!/usr/bin/env bash
# The browser gateway on Kingston (docs/volition-design-browser-gateway.md): the MCP shim every
# agent runtime starts (/usr/local/libexec/helena-browser-mcp, one file built from
# packages/browser-gateway/src/shim.ts, owned by root), the gateway's service token, and the
# drop-ins that hand that token to the Plan API and the browser router, which then starts the
# gateway. Idempotent; --dry-run shows each change and makes none. Restarting the two units is
# the caller's step (the switch-on runbook, or deploy.sh).
#
#   sudo deployment/volition-stack/native/install-browser-gateway.sh install [--dry-run]
#   sudo deployment/volition-stack/native/install-browser-gateway.sh sync      (deploy: the shim, if installed)
#   sudo deployment/volition-stack/native/install-browser-gateway.sh remove [--dry-run]
#   sudo deployment/volition-stack/native/install-browser-gateway.sh status
#
# `remove` takes the drop-ins away again (the gateway stops at the next restart of the router,
# and the API refuses its calls); the shim and the token stay, so `install` brings it back.
set -euo pipefail

command=${1:-}
dry_run=0
[[ ${2:-} == --dry-run ]] && dry_run=1
# The GATEWAY_* variables exist for the script's own test; the defaults are the live paths.
[[ $EUID -eq 0 || ${GATEWAY_TEST:-} == 1 ]] || { echo "install-browser-gateway.sh: run with sudo" >&2; exit 1; }

here=$(cd "$(dirname "$0")" && pwd)
checkout=$(cd "$here/../../.." && pwd)
shim=${GATEWAY_SHIM:-/usr/local/libexec/helena-browser-mcp}
token=${GATEWAY_TOKEN:-/etc/volition/browser-gateway.token}
units=${GATEWAY_UNITS:-/etc/systemd/system}
node_bin=${GATEWAY_NODE:-/usr/local/bin/node}
bun_bin=${GATEWAY_BUN:-/usr/local/bin/bun}
owner=$(stat -c %U "$checkout")
dropin_units=(volition-plan-api.service volition-project-browser-router.service)
dropin_content=$'[Service]\nLoadCredential=browser_gateway_token:'"$token"$'\nEnvironment=BROWSER_GATEWAY_TOKEN_FILE=%d/browser_gateway_token\n'

say() { if ((dry_run)); then echo "would $*"; else echo "$*"; fi; }
run() { if ((dry_run)); then echo "would run: $*"; else "$@"; fi; }
as_owner() { if [[ ${GATEWAY_TEST:-} == 1 ]]; then "$@"; else runuser -u "$owner" -- "$@"; fi; }

# Builds the shim as the checkout's owner into a temporary file, with the interpreter's path
# as its first line, and installs it root-owned when it differs from the installed one.
install_shim() {
  local built
  built=$(as_owner mktemp --suffix=.cjs)
  as_owner "$bun_bin" build "$checkout/packages/browser-gateway/src/shim.ts" --target=node --format=cjs \
    --outfile "$built" >/dev/null
  local final
  final=$(mktemp)
  { echo "#!$node_bin"; sed '1{/^#!/d}' "$built"; } > "$final"
  rm -f "$built"
  if [[ -f $shim ]] && cmp -s "$final" "$shim"; then
    rm -f "$final"
    return
  fi
  say "install the MCP shim $shim"
  if ((dry_run)); then
    rm -f "$final"
  elif [[ ${GATEWAY_TEST:-} == 1 ]]; then
    install -D -m 0755 "$final" "$shim" && rm -f "$final"
  else
    install -D -o root -g root -m 0755 "$final" "$shim" && rm -f "$final"
  fi
}

install_token() {
  if [[ -s $token ]]; then return; fi
  say "create the browser gateway's service token $token (not shown)"
  if ((!dry_run)); then
    install -d -m 0750 "$(dirname "$token")"
    (umask 077 && head -c 32 /dev/urandom | base64 | tr -d '\n=' > "$token")
    chmod 0600 "$token"
  fi
}

# Where the project browsers save downloads until the gateway hands them to Helena: owned
# like the browser state it sits in (the runner's user, or the browser user once isolated).
install_downloads() {
  local state=${GATEWAY_BROWSER_STATE:-/var/lib/volition/project-browser}
  local directory=$state/downloads
  [[ -d $state ]] || return 0
  if [[ -d $directory ]]; then return; fi
  say "create $directory"
  if ((!dry_run)); then
    if [[ ${GATEWAY_TEST:-} == 1 ]]; then install -d -m 0700 "$directory"
    else install -d -m 0700 -o "$(stat -c %U "$state")" -g "$(stat -c %G "$state")" "$directory"; fi
  fi
}

install_dropins() {
  local changed=0
  for unit in "${dropin_units[@]}"; do
    local dropin=$units/$unit.d/browser-gateway.conf
    if [[ -f $dropin ]] && [[ $(cat "$dropin") == "${dropin_content%$'\n'}" ]]; then continue; fi
    say "hand the gateway token to $unit ($dropin)"
    ((dry_run)) || { install -d -m 0755 "$(dirname "$dropin")"; printf '%s' "$dropin_content" > "$dropin"; }
    changed=1
  done
  if ((changed)); then run systemctl daemon-reload; fi
  return 0
}

remove_dropins() {
  local changed=0
  for unit in "${dropin_units[@]}"; do
    local dropin=$units/$unit.d/browser-gateway.conf
    [[ -f $dropin ]] || continue
    say "take the gateway token away from $unit"
    run rm -f "$dropin"
    changed=1
  done
  if ((changed)); then run systemctl daemon-reload; fi
  return 0
}

case $command in
  install)
    install_shim
    install_token
    install_downloads
    install_dropins
    echo "install-browser-gateway.sh: restart volition-plan-api and volition-project-browser-router to start it"
    ;;
  sync)
    [[ -f $shim ]] || exit 0
    install_shim
    ;;
  remove)
    remove_dropins
    ;;
  status)
    printf 'shim   %s\n' "$([[ -x $shim ]] && echo "$shim" || echo missing)"
    printf 'token  %s\n' "$([[ -s $token ]] && echo present || echo missing)"
    for unit in "${dropin_units[@]}"; do
      printf '%-40s %s\n' "$unit" "$([[ -f $units/$unit.d/browser-gateway.conf ]] && echo 'token drop-in' || echo 'no drop-in')"
    done
    ;;
  *)
    sed -n '2,15p' "$0" >&2
    exit 64
    ;;
esac
