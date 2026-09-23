#!/usr/bin/env bash
# Sets up the knowledge vault: its top-level layout, the private group, the permissions
# and the git history. Idempotent; deploy.sh runs it on every deploy. The provisioning
# service creates the project and area folders inside it.
#
#   sudo deployment/volition-stack/native/vault-setup.sh
#
# - Everything outside Private/ belongs to the group volition (the Plan user and the
#   agent user); folders are 2770, files 0660. Private/ belongs to volition-private (the
#   Plan user, the sync user and the owner, never the agent user).
# - Every folder gets a default ACL, so a file anyone creates in the vault is readable
#   and writable by its group whatever the umask of the program that writes it.
# - The vault is a git repository tracking text files only; Private/ is a repository of
#   its own, so its history is readable by the private group alone. Plan (API and
#   worker, as volition-plan) makes all commits.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "vault-setup.sh: run with sudo" >&2; exit 1; }

vault=${VOLITION_VAULT_ROOT:-/srv/volition/vault}
plan_user=volition-plan
shared_group=volition
private_group=volition-private
private_members=${VAULT_PRIVATE_MEMBERS:-"volition-plan volition-sync wilhelmpa"}

getent group "$private_group" >/dev/null || groupadd --system "$private_group"
for member in $private_members; do
  id "$member" >/dev/null 2>&1 || continue
  id -nG "$member" | tr ' ' '\n' | grep -qx "$private_group" || usermod -aG "$private_group" "$member"
done

folder() {
  mkdir -p "$1"
  chgrp "$2" "$1"
  chmod 2770 "$1"
}

folder "$vault" "$shared_group"
for name in Home Home/Docs Templates Projects .trash; do
  folder "$vault/$name" "$shared_group"
done
folder "$vault/Private" "$private_group"
folder "$vault/Private/.trash" "$private_group"

# Repairs what is there: the group, group access on folders and files, nothing for others.
fix_tree() {
  local top=$1 group=$2
  shift 2
  find "$top" "$@" \( ! -group "$group" \) -exec chgrp -h "$group" {} +
  find "$top" "$@" -type d \( ! -perm -2770 -o -perm /0007 \) -exec chmod g+rwxs,o-rwx {} +
  find "$top" "$@" -type f \( ! -perm -0660 -o -perm /0007 \) -exec chmod g+rw,o-rwx {} +
  find "$top" "$@" -type d -exec setfacl -d -m u::rwx,g::rwx,o::--- {} +
}
fix_tree "$vault" "$shared_group" -path "$vault/Private" -prune -o
fix_tree "$vault/Private" "$private_group"

as_plan() { runuser -u "$plan_user" -- "$@"; }

# The same paths the vault package commits (packages/vault/src/git.ts: isVersioned).
text_only='# Written by vault-setup.sh: the history holds text files only.
*
!*/
!.gitignore
!*.md
!*.canvas
!*.txt
!*.csv
!*.json
!*.yaml
!*.yml
*.sync-conflict-*
*.tmp
.stfolder/
.stversions/
/.trash/'

repository() {
  local dir=$1 group=$2 ignore=$3
  local git=(git -c "safe.directory=$dir" -c "user.name=Volition Plan" -c "user.email=plan@volition.local" -C "$dir")
  [[ -d $dir/.git ]] || as_plan "${git[@]}" init -q -b main
  as_plan "${git[@]}" config core.sharedRepository group
  as_plan "${git[@]}" config core.quotePath false
  printf '%s\n' "$ignore" >"$dir/.gitignore"
  chgrp "$group" "$dir/.gitignore"
  chmod 0660 "$dir/.gitignore"
  if ! as_plan "${git[@]}" rev-parse -q --verify HEAD >/dev/null; then
    as_plan "${git[@]}" add -A
    as_plan "${git[@]}" commit -q --allow-empty -m "Start the vault history"
  fi
}

repository "$vault" "$shared_group" "$text_only
/.obsidian/workspace*
/.obsidian/cache
/Private/"
repository "$vault/Private" "$private_group" "$text_only"

echo "vault-setup.sh: $vault is set up"
