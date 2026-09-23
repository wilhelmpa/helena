#!/usr/bin/env bash
# Writes the vault files Syncthing and Obsidian read. Lines missing from .stignore are
# appended and the owner's own lines stay. An Obsidian settings file is written only
# while it does not exist, so a setting the owner changed is never replaced.
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
// Plan's trash, which Obsidian's "Move to Obsidian trash" also uses, stays on each device.
/.trash
// Obsidian's open tabs and window layout differ per device.
/.obsidian/workspace*.json
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

settings=$vault/.obsidian
mkdir -p "$settings" "$vault/Templates" "$vault/Home/Journal"

write_absent() {
  [[ -e $settings/$1 ]] || cat >"$settings/$1"
}

# Wikilinks with the shortest unique name. Deleted notes go to the vault's .trash.
# Attachments go to an Assets folder beside the note: a note of a project keeps its
# files inside that project, and one in Private/ keeps them inside Private/.
write_absent app.json <<'EOF'
{
  "useMarkdownLinks": false,
  "newLinkFormat": "shortest",
  "trashOption": "local",
  "attachmentFolderPath": "./Assets"
}
EOF
write_absent core-plugins.json <<'EOF'
{
  "backlink": true,
  "graph": true,
  "templates": true,
  "daily-notes": true
}
EOF
write_absent templates.json <<'EOF'
{
  "folder": "Templates"
}
EOF
write_absent daily-notes.json <<'EOF'
{
  "folder": "Home/Journal"
}
EOF
