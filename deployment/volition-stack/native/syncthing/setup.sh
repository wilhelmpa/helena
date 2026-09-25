#!/usr/bin/env bash
# Sets up the Syncthing service that syncs the vault with the owner's devices: the user
# volition-sync, the API key Plan uses, the unit, the vault's .stignore and folders, and
# the folder "Helena". Safe to run again; deploy.sh runs it when this
# directory or the unit changes.
#
#   sudo deployment/volition-stack/native/syncthing/setup.sh [--dry-run]
#
# --dry-run prints what would change and changes nothing.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
vault=${VAULT:-/srv/volition/vault}
home=${SYNCTHING_HOME:-/var/lib/volition/syncthing}
key_file=${SYNCTHING_KEY_FILE:-/etc/volition/syncthing-api.key}
unit_dir=${UNIT_DIR:-/etc/systemd/system}
syncthing=${SYNCTHING_BIN:-/usr/bin/syncthing}
url=http://127.0.0.1:8384
unit=volition-syncthing.service
unit_file=$(dirname "$here")/systemd/$unit
user=volition-sync

dry_run=0
case "${1:-}" in
  --dry-run) dry_run=1 ;;
  '') ;;
  *)
    echo "usage: $0 [--dry-run]" >&2
    exit 2
    ;;
esac
((dry_run)) || [[ $EUID -eq 0 ]] || {
  echo "setup.sh: run with sudo" >&2
  exit 1
}

run() {
  if ((dry_run)); then printf '+ %s\n' "$*"; else "$@"; fi
}

random_hex() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }

run groupadd -f volition
run groupadd -f volition-private
if ! id -u "$user" >/dev/null 2>&1; then
  run useradd --system --user-group --home-dir "$home" --no-create-home \
    --shell /usr/sbin/nologin "$user"
fi
run usermod -a -G volition,volition-private "$user"
run install -d -o "$user" -g "$user" -m 0700 "$home"

# The API unit loads this file as well, so it is written before anything that needs
# Syncthing: that unit starts whether or not the package is installed.
if [[ ! -s $key_file ]]; then
  if ((dry_run)); then
    echo "+ write a new API key to $key_file"
  else
    (umask 077 && random_hex 32 >"$key_file")
  fi
fi

if [[ ! -x $syncthing ]]; then
  echo "setup.sh: $syncthing is missing; install the Debian package syncthing and run this again" >&2
  ((dry_run)) || exit 1
fi

# The GUI password is random and kept nowhere: Plan uses the API key. Without a
# password the page on 127.0.0.1:8384 would give every local user a session.
if [[ ! -f $home/config.xml ]]; then
  if ((dry_run)); then
    echo "+ $syncthing generate --home=$home"
  else
    printf '%s\n' "$(random_hex 24)" |
      runuser -u "$user" -- "$syncthing" generate --home="$home" --no-default-folder \
        --skip-port-probing --gui-user=volition --gui-password=- >/dev/null
  fi
fi

# .stignore has to exist before the folder is added, or the first scan announces what
# it excludes. The script is read from stdin, so the user needs no access to this
# checkout.
if ((dry_run)); then
  echo "+ $here/vault-defaults.sh $vault (as $user)"
else
  runuser -u "$user" -- bash -s -- "$vault" <"$here/vault-defaults.sh"
fi

if cmp -s "$unit_file" "$unit_dir/$unit"; then
  run systemctl enable --now --quiet "$unit"
else
  run install -m 0644 "$unit_file" "$unit_dir/$unit"
  run systemctl daemon-reload
  run systemctl enable --quiet "$unit"
  run systemctl restart "$unit"
fi

run "$here/configure.sh" "$url" "$key_file" "$vault"
