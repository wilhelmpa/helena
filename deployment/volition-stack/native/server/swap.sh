#!/bin/sh
# Swap for Helena's server: one swap file on the root filesystem (the RAID, so it survives a
# disk failure like everything else) and zswap in front of it, so pages are compressed in RAM
# before anything is written to the disks. The OS gets ~31 GB (the rest is the GPU's), and a
# `next build`, the local models and the agents' test stacks together outgrow that; without
# enough swap the machine thrashes instead of slowing down.
#
#   sudo ./swap.sh [--dry-run] [--size 32G] apply   create/enable the file, fstab, zswap;
#                                                   retires other swap files listed in fstab
#   ./swap.sh status
#
# Idempotent. A larger --size replaces the file (off, recreate, on). Retiring an old swap file
# needs its pages back in RAM + the new file, so run apply when the machine is not under load.
set -eu
DRY_RUN=0
size=32G
command=
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --size) size=$2; shift ;;
    apply|status) command=$1 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$command" ] || { sed -n '2,13p' "$0"; exit 2; }
run() { if [ "$DRY_RUN" = 1 ]; then echo "would: $*"; else "$@"; fi; }
PATH=/usr/local/sbin:/usr/sbin:/sbin:$PATH

FILE=/helena.swap
PRIORITY=10
FSTAB=/etc/fstab
ZSWAP=/sys/module/zswap/parameters
TMPFILES=/etc/tmpfiles.d/helena-zswap.conf

status() {
  swapon --show
  for p in enabled compressor max_pool_percent shrinker_enabled; do
    printf 'zswap %s=%s\n' "$p" "$(cat "$ZSWAP/$p" 2>/dev/null || echo '?')"
  done
  grep -E '^[^#].*[[:space:]]swap[[:space:]]' "$FSTAB" || echo "fstab: no swap entry"
}

bytes() { numfmt --from=iec "$1"; }

swap_file() {
  want=$(bytes "$size")
  have=$(stat -c %s "$FILE" 2>/dev/null || echo 0)
  if [ "$have" -ge "$want" ]; then
    echo "$FILE: $(numfmt --to=iec "$have") present"
  else
    if swapon --show=NAME --noheadings | grep -qx "$FILE"; then run swapoff "$FILE"; fi
    run rm -f "$FILE"
    # ext4 takes a fallocated swap file (no holes); nothing is written, so this is quick.
    run fallocate -l "$size" "$FILE"
    run chmod 600 "$FILE"
    run mkswap -L HELENA_SWAP "$FILE"
  fi
  swapon --show=NAME --noheadings | grep -qx "$FILE" || run swapon --priority "$PRIORITY" "$FILE"
}

fstab() {
  line="$FILE none swap sw,pri=$PRIORITY 0 0"
  grep -qxF "$line" "$FSTAB" && return 0
  [ -e "$FSTAB.pre-helena-swap" ] || run cp -a "$FSTAB" "$FSTAB.pre-helena-swap"
  if [ "$DRY_RUN" = 1 ]; then echo "would: set '$line' in $FSTAB"; return; fi
  grep -v -E "^$FILE[[:space:]]" "$FSTAB" >"$FSTAB.helena-new"
  echo "$line" >>"$FSTAB.helena-new"
  cat "$FSTAB.helena-new" >"$FSTAB" && rm -f "$FSTAB.helena-new"
}

# Other swap *files* in fstab (an installer's /swapfile): off, out of fstab, removed. Swap
# partitions are left alone.
retire_others() {
  # Read the list first: the loop rewrites fstab.
  others=$(grep -E '^/[^[:space:]]+[[:space:]]+none[[:space:]]+swap' "$FSTAB" | awk '{print $1}')
  for other in $others; do
    [ "$other" = "$FILE" ] && continue
    [ -f "$other" ] || continue
    if swapon --show=NAME --noheadings | grep -qx "$other"; then run swapoff "$other"; fi
    if [ "$DRY_RUN" = 1 ]; then echo "would: drop $other from $FSTAB and remove it"; continue; fi
    grep -v -E "^$other[[:space:]]" "$FSTAB" >"$FSTAB.helena-new" && cat "$FSTAB.helena-new" >"$FSTAB"
    rm -f "$FSTAB.helena-new" "$other"
    echo "retired $other"
  done
}

# zswap: zstd, at most 20 % of RAM, cold pages written on to the file (shrinker). Set now and
# at every boot (tmpfiles runs before the swap is used much).
zswap() {
  if [ "$DRY_RUN" = 1 ]; then echo "would: write $TMPFILES and set zswap (zstd, 20 %, shrinker)"; return; fi
  cat >"$TMPFILES" <<'EOF'
# Helena (native/server/swap.sh): compress swap in RAM before it reaches the disks.
w /sys/module/zswap/parameters/compressor - - - - zstd
w /sys/module/zswap/parameters/max_pool_percent - - - - 20
w /sys/module/zswap/parameters/shrinker_enabled - - - - Y
w /sys/module/zswap/parameters/enabled - - - - Y
EOF
  systemd-tmpfiles --create "$TMPFILES"
}

case "$command" in
  status) status ;;
  apply)
    [ "$(id -u)" = 0 ] || [ "$DRY_RUN" = 1 ] || { echo "run as root" >&2; exit 1; }
    swap_file
    fstab
    retire_others
    zswap
    run systemctl daemon-reload
    status
    ;;
esac
