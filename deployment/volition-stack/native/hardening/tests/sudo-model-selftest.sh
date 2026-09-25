#!/usr/bin/env bash
# Proves apply.sh's sudo-model step and audit.sh's auth.sudo check in a private user + mount
# namespace (no root, no change on the host): /etc/sudoers, /etc/sudoers.d and
# /etc/ssh/sshd_config.d are scratch copies, passwd/sshd/systemctl/useradd/id/getent are fakes
# (on /usr/local/sbin, first in both scripts' PATH), visudo is the real one.
#
#   tests/sudo-model-selftest.sh     # needs unprivileged user namespaces (Debian default)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/helena-sudo-test.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work"/{sudoers.d,sshd.d,state,bin,pw,home/helena-ops/.ssh}
: >"$work/sudoers"

cat >"$work/bin/passwd" <<'SH'
#!/bin/sh
# passwd -S USER | passwd -l USER, from $W/pw/USER (P, L or NP)
case "$1" in
  -S) echo "$2 $(cat "$W/pw/$2" 2>/dev/null || echo NP) 2026-09-25 0 99999 7 -1" ;;
  -l) echo L >"$W/pw/$2"; echo "passwd -l $2" >>"$W/calls" ;;
esac
SH
cat >"$work/bin/sshd" <<'SH'
#!/bin/sh
# sshd -t: fine; sshd -T -C user=…: the effective AuthenticationMethods for helena-ops.
[ "$1" = -t ] && exit 0
if grep -qs 'AuthenticationMethods publickey' /etc/ssh/sshd_config.d/60-helena-ops.conf; then
  echo 'authenticationmethods publickey'
else
  echo 'authenticationmethods any'
fi
SH
cat >"$work/bin/systemctl" <<'SH'
#!/bin/sh
echo "systemctl $*" >>"$W/calls"
SH
cat >"$work/bin/useradd" <<'SH'
#!/bin/sh
for last; do :; done
echo "$last" >>"$W/users"; echo "useradd $last" >>"$W/calls"
SH
cat >"$work/bin/id" <<'SH'
#!/bin/sh
case "$1" in
  -nG) [ "$2" = wilhelmpa ] && echo "wilhelmpa sudo" || echo "$2" ;;
  -*|"") exec /usr/bin/id "$@" ;;
  *) grep -qx "$1" "$W/users" ;;
esac
SH
cat >"$work/bin/getent" <<'SH'
#!/bin/sh
[ "$1 $2" = "passwd helena-ops" ] && grep -qx helena-ops "$W/users" \
  && { echo "helena-ops:x:1003:1003:Helena automation:$W/home/helena-ops:/bin/bash"; exit 0; }
exec /usr/bin/getent "$@"
SH
chmod 0755 "$work"/bin/*

cat >"$work/inside.sh" <<'INNER'
set -euo pipefail
here=$1
mount --bind "$W/sudoers" /etc/sudoers
mount --bind "$W/sudoers.d" /etc/sudoers.d
mount --bind "$W/sshd.d" /etc/ssh/sshd_config.d
mount --bind "$W/bin" /usr/local/sbin
export HELENA_HARDENING_STATE=$W/state HELENA_OWNER_USER=wilhelmpa HELENA_OPS_USER=helena-ops
fail() { echo "FAIL: $*"; exit 1; }
reset() { # the machine before the sudo model: the owner's blanket rule, helena-ops with a key
  rm -rf "$W"/sudoers.d/* "$W"/sshd.d/* "$W"/state/* "$W"/calls
  printf 'Defaults env_reset\nroot ALL=(ALL:ALL) ALL\n%%sudo ALL=(ALL:ALL) ALL\n@includedir /etc/sudoers.d\n' >"$W/sudoers"
  printf 'wilhelmpa ALL=(ALL:ALL) NOPASSWD: ALL\n' >"$W/sudoers.d/90-wilhelmpa"
  chmod 0440 "$W/sudoers" "$W"/sudoers.d/*
  printf 'helena-ops\nwilhelmpa\n' >"$W/users"
  echo 'ssh-ed25519 AAAAC3Nza test' >"$W/home/helena-ops/.ssh/authorized_keys"
  echo P >"$W/pw/wilhelmpa"; echo P >"$W/pw/helena-ops"
}
audit() { HELENA_AUDIT_ONLY=auth.sudo bash "$here/audit.sh" | grep '^auth.sudo' ; }
tree() { find "$W/sudoers.d" "$W/sshd.d" "$W/pw" -type f -exec md5sum {} + | sort; }

reset
audit | grep -q $'\twarn\t.*\twhy=others\tvalue=wilhelmpa$' || fail "the owner's blanket rule must warn: $(audit)"

# The dry run changes nothing.
before=$(tree)
bash "$here/apply.sh" sudo-model >"$W/out" || fail "dry run failed: $(cat "$W/out")"
[[ $(tree) == "$before" ]] || fail "the dry run changed files"
grep -q 'would run: passwd -l helena-ops' "$W/out" || fail "dry run does not say it locks the password"
grep -q 'moving /etc/sudoers.d/90-wilhelmpa aside' "$W/out" || fail "dry run does not name the owner's rule"

# Apply: the account locked, its sshd drop-in and sudo rule, the owner's rule aside.
bash "$here/apply.sh" --apply sudo-model >"$W/out" || fail "apply failed: $(cat "$W/out")"
[[ $(cat "$W/pw/helena-ops") == L ]] || fail "helena-ops not locked"
cmp -s "$here/files/60-helena-ops.conf" "$W/sshd.d/60-helena-ops.conf" || fail "sshd drop-in missing"
cmp -s "$here/files/80-helena-ops" "$W/sudoers.d/80-helena-ops" || fail "sudoers rule missing"
[[ $(stat -c %a "$W/sudoers.d/80-helena-ops") == 440 ]] || fail "sudoers rule not 0440"
[[ ! -e $W/sudoers.d/90-wilhelmpa ]] || fail "the owner's rule is still there"
ls "$W"/state/backup/*/etc/sudoers.d/90-wilhelmpa >/dev/null || fail "no backup of the owner's rule"
grep -q 'systemctl reload ssh' "$W/calls" || fail "sshd not reloaded"
visudo -c >/dev/null || fail "visudo -c fails afterwards"
audit | grep -q $'\tpass\t' || fail "audit should pass now: $(audit)"

# Again: nothing to do (the orchestrator did it live already).
rm -f "$W/calls"
bash "$here/apply.sh" --apply sudo-model >"$W/out" || fail "second apply failed: $(cat "$W/out")"
grep -q 'password locked (already)' "$W/out" && grep -q '60-helena-ops.conf unchanged' "$W/out" \
  && grep -q '80-helena-ops unchanged' "$W/out" && grep -q 'no other account has NOPASSWD: ALL (already)' "$W/out" \
  || fail "second run is not idempotent: $(cat "$W/out")"
[[ ! -e $W/calls ]] || fail "second run changed something: $(cat "$W/calls")"

# A live rule with other comments counts as in place.
printf '# written by hand\nhelena-ops   ALL=(ALL:ALL)   NOPASSWD: ALL\n' >"$W/sudoers.d/80-helena-ops"
bash "$here/apply.sh" --apply sudo-model >"$W/out" || fail "apply with a hand-made rule failed"
grep -q 'only comments differ' "$W/out" || fail "a hand-made equal rule was not recognised: $(cat "$W/out")"
grep -q '^# written by hand' "$W/sudoers.d/80-helena-ops" || fail "a hand-made equal rule was replaced"

# Rollback puts the owner's rule back; the audit warns again.
bash "$here/apply.sh" --apply rollback sudo-model >"$W/out" || fail "rollback failed: $(cat "$W/out")"
[[ -e $W/sudoers.d/90-wilhelmpa ]] || fail "rollback did not restore the owner's rule"
audit | grep -q $'\twarn\t.*why=others' || fail "after the rollback the audit should warn"

# A file with other rules keeps them; only the blanket line is commented out.
reset
printf 'wilhelmpa ALL=(ALL:ALL) NOPASSWD: ALL\nwilhelmpa ALL=(root) NOPASSWD: /usr/bin/true\n' >"$W/sudoers.d/90-wilhelmpa"
bash "$here/apply.sh" --apply sudo-model >"$W/out" || fail "apply on a mixed file failed: $(cat "$W/out")"
grep -q '^# helena sudo-model: wilhelmpa ALL=(ALL:ALL) NOPASSWD: ALL$' "$W/sudoers.d/90-wilhelmpa" \
  && grep -q '^wilhelmpa ALL=(root) NOPASSWD: /usr/bin/true$' "$W/sudoers.d/90-wilhelmpa" \
  || fail "mixed file not handled: $(cat "$W/sudoers.d/90-wilhelmpa")"

# Refusals: the owner without a usable password keeps his rule; no key, no --apply.
reset
echo L >"$W/pw/wilhelmpa"
if bash "$here/apply.sh" --apply sudo-model >"$W/out" 2>&1; then fail "applied although the owner has no password"; fi
grep -q 'has no usable password' "$W/out" || fail "wrong refusal: $(cat "$W/out")"
[[ -e $W/sudoers.d/90-wilhelmpa ]] || fail "the owner's rule was moved although refused"
reset
: >"$W/home/helena-ops/.ssh/authorized_keys"
if bash "$here/apply.sh" --apply sudo-model >"$W/out" 2>&1; then fail "applied without a key"; fi
grep -q 'put the automation key there first' "$W/out" || fail "wrong refusal: $(cat "$W/out")"

# The audit: helena-ops alone but not locked down.
reset
rm -f "$W/sudoers.d/90-wilhelmpa"
install -m 0440 "$here/files/80-helena-ops" "$W/sudoers.d/80-helena-ops"
audit | grep -q $'\twarn\t.*\twhy=ops\tvalue=helena-ops\tproblem=both$' || fail "expected problem=both: $(audit)"
cp "$here/files/60-helena-ops.conf" "$W/sshd.d/"
audit | grep -q $'problem=password$' || fail "expected problem=password: $(audit)"
echo L >"$W/pw/helena-ops"; rm "$W/sshd.d/60-helena-ops.conf"
audit | grep -q $'problem=ssh$' || fail "expected problem=ssh: $(audit)"
cp "$here/files/60-helena-ops.conf" "$W/sshd.d/"
audit | grep -q $'\tpass\tonly helena-ops' || fail "expected pass: $(audit)"
echo "sudo-model selftest: all checks passed"
INNER

W=$work unshare -rm env W="$work" TMPDIR="$work" bash "$work/inside.sh" "$here"
