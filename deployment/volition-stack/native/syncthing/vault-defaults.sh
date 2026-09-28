#!/usr/bin/env bash
# Writes the vault's .stignore (what Syncthing leaves on this server) and the folders every
# vault has. Lines missing from .stignore are appended and the owner's own lines stay.
#
#   vault-defaults.sh VAULT
set -euo pipefail
umask 0007

vault=${1:?usage: vault-defaults.sh VAULT}
if [[ ! -d $vault ]]; then
  echo "vault-defaults.sh: $vault is not a directory" >&2
  exit 1
fi

# .stignore applies on Kingston only. Kingston is the one device every other device
# syncs with, so what it ignores never reaches a device and never comes back from one.
ignore=$vault/.stignore
touch "$ignore"
while IFS= read -r line; do
  grep -qxF -- "$line" "$ignore" || printf '%s\n' "$line" >>"$ignore"
done <<'EOF'
// Every Git repository: the vault's and the one of Private/.
.git
// Helena's trash stays on each device.
/.trash
// A desktop editor's settings folder must not be brought back from another device.
/.obsidian
// Temporary and system files. (?d) lets Syncthing delete them with their directory.
(?d).DS_Store
(?d)._*
(?d)Thumbs.db
(?d)desktop.ini
*.tmp
*.swp
~$*
.~lock.*#
EOF

mkdir -p "$vault/Templates" "$vault/Home/Docs/Journal"
