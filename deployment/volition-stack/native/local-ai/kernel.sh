#!/bin/sh
# Helena local AI, step 1: a newer kernel (amdxdna for the NPU, the KFD fixes ROCm needs on
# gfx1151) and the matching firmware from trixie-backports, with a test boot that cannot strand
# the machine. Decision: docs/helena-decisions/local-ai-platform.md §2–3; runbook: README.md.
#
#   sudo ./kernel.sh status
#   sudo ./kernel.sh [--dry-run] prepare   backports source (every package pinned low, ours to
#                                          exact versions); GRUB boots the running kernel by
#                                          name from now on (GRUB_DEFAULT=saved)
#   sudo ./kernel.sh [--dry-run] install   the pinned kernel, headers and firmware (not booted)
#   sudo ./kernel.sh [--dry-run] trial     arm ONE test boot into the new kernel (UEFI BootNext
#                                          to a trial loader entry); reboot yourself afterwards
#   sudo ./kernel.sh verify                after the test boot: the checklist, and a report
#   sudo ./kernel.sh [--dry-run] promote   the new kernel becomes the default (after verify)
#   sudo ./kernel.sh [--dry-run] rollback [--purge]
#                                          the old kernel the default again, the trial entry
#                                          removed; --purge also removes the new kernel and
#                                          puts the old firmware back
#   sudo ./kernel.sh [--dry-run] dkms      build every DKMS module for every installed kernel
#
# Why not grub-reboot: /boot is on the md RAID, and GRUB cannot write its environment block
# on a RAID ("diskfilter writes are not supported"). A one-time `next_entry` would never be
# cleared and every later boot, a panic's reboot included, would go to the new kernel again.
# The test boot therefore goes through the firmware's own one-shot BootNext: the firmware
# clears it before it boots, so the next reset (panic=30, a power cycle) is the normal
# "Debian" entry with the old kernel as GRUB's saved default.
set -eu

# ── Pins (docs/helena-decisions/local-ai-platform.md §2) ────────────────────────────────
TARGET_ABI=7.1.8+deb13-amd64
TARGET_VERSION=7.1.8-1~bpo13+1
FIRMWARE_VERSION=20260810-1~bpo13+1
# The firmware Debian 13 shipped, kept for a rollback.
FIRMWARE_OLD_VERSION=20250410-2
KERNEL_PACKAGES="linux-image-$TARGET_ABI linux-headers-$TARGET_ABI"
FIRMWARE_PACKAGES="firmware-amd-graphics"

# Everything below a root can be moved for the tests (tests/test_kernel.py).
R=${HELENA_KERNEL_ROOT:-}
DEFAULT_GRUB=$R/etc/default/grub
GRUB_CFG=$R/boot/grub/grub.cfg
GRUBENV=$R/boot/grub/grubenv
ESP=$R/boot/efi
ESP2=$R/boot/efi2
LOADER_DIR=EFI/helena-raid
TRIAL_DIR=EFI/helena-ktest
TRIAL_LABEL="Debian (Kernel-Test)"
SOURCES=$R/etc/apt/sources.list.d/helena-backports.sources
PREFERENCES=$R/etc/apt/preferences.d/helena-backports
STATE=$R/var/lib/helena-ai/kernel
ROLLBACK=$STATE/rollback
MDSTAT=${HELENA_MDSTAT:-/proc/mdstat}

DRY_RUN=0
PURGE=0
command=
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --purge) PURGE=1 ;;
    status|prepare|install|trial|verify|promote|rollback|dkms) command=$1 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$command" ] || { sed -n '2,26p' "$0"; exit 2; }

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY_RUN" = 1 ]; then say "would: $*"; else "$@"; fi; }
die() { say "kernel.sh: $*" >&2; exit 1; }
# Writes stdin to a file (dry run: shows it).
put() {
  if [ "$DRY_RUN" = 1 ]; then say "would write $1:"; sed 's/^/    /'; else mkdir -p "$(dirname "$1")"; cat > "$1"; fi
}

if [ "$(id -u)" != 0 ] && [ "$DRY_RUN" = 0 ] && [ "$command" != status ] && [ -z "$R" ]; then
  die "run as root"
fi

running() { uname -r; }
root_uuid() { findmnt -no UUID / 2>/dev/null || true; }

# The GRUB menu entry id of a kernel: 'gnulinux-advanced-<uuid>>gnulinux-<abi>-advanced-<uuid>',
# taken from grub.cfg itself so it matches what GRUB shows.
entry_id() {
  abi=$1
  [ -r "$GRUB_CFG" ] || return 1
  submenu=$(sed -n "s/^submenu .*\\\$menuentry_id_option '\\(gnulinux-advanced-[^']*\\)'.*/\\1/p" "$GRUB_CFG" | head -n 1)
  entry=$(sed -n "s/.*\\\$menuentry_id_option '\\(gnulinux-$abi-advanced-[^']*\\)'.*/\\1/p" "$GRUB_CFG" | head -n 1)
  [ -n "$submenu" ] && [ -n "$entry" ] || return 1
  printf '%s>%s\n' "$submenu" "$entry"
}

env_value() { grub-editenv "$GRUBENV" list 2>/dev/null | sed -n "s/^$1=//p"; }

grub_default() { sed -n 's/^GRUB_DEFAULT=//p' "$DEFAULT_GRUB" | tail -n 1 | tr -d '"'; }

# The ESP partition behind /boot/efi: its disk and partition number, for efibootmgr.
esp_disk() {
  part=$(findmnt -no SOURCE "$ESP" 2>/dev/null || true)
  [ -n "$part" ] || return 1
  name=$(basename "$part")
  disk=$(lsblk -no PKNAME "$part" 2>/dev/null | head -n 1)
  number=$(cat "${HELENA_SYS:-/sys}/class/block/$name/partition" 2>/dev/null || true)
  [ -n "$disk" ] && [ -n "$number" ] || return 1
  printf '/dev/%s %s\n' "$disk" "$number"
}

trial_bootnum() {
  efibootmgr 2>/dev/null | sed -n "s/^Boot\\([0-9A-Fa-f]\\{4\\}\\)\\*\\{0,1\\} $TRIAL_LABEL\$/\\1/p" | head -n 1
}

sync_esps() {
  if [ -d "$ESP2/EFI" ] || [ "$DRY_RUN" = 1 ]; then
    # The same as /etc/apt/apt.conf.d/99helena-esp-sync after every package change.
    run rsync -a --delete "$ESP/" "$ESP2/"
  fi
}

remove_trial() {
  num=$(trial_bootnum || true)
  if [ -n "$num" ]; then run efibootmgr -q -b "$num" -B; fi
  if [ -d "$ESP/$TRIAL_DIR" ]; then run rm -rf "$ESP/$TRIAL_DIR"; fi
  sync_esps
}

installed_version() { dpkg-query -W -f='${Version}' "$1" 2>/dev/null || true; }

status() {
  say "running kernel:      $(running)"
  say "installed kernels:   $(ls "$R/boot" 2>/dev/null | sed -n 's/^vmlinuz-//p' | tr '\n' ' ')"
  say "GRUB_DEFAULT:        $(grub_default)"
  say "saved_entry:         $(env_value saved_entry)"
  next=$(env_value next_entry)
  [ -z "$next" ] || say "next_entry:          $next  (!! GRUB cannot clear it on the RAID; run: $0 rollback)"
  say "backports source:    $([ -f "$SOURCES" ] && echo present || echo missing)"
  say "linux-image $TARGET_ABI: $(installed_version "linux-image-$TARGET_ABI")"
  say "firmware-amd-graphics: $(installed_version firmware-amd-graphics) (target $FIRMWARE_VERSION)"
  num=$(trial_bootnum || true)
  say "trial boot entry:    ${num:-none}$(efibootmgr 2>/dev/null | sed -n 's/^BootNext: \(.*\)/, BootNext \1/p')"
  say "NPU:                 $([ -e /dev/accel/accel0 ] && echo "/dev/accel/accel0 ($(basename "$(readlink -f /sys/class/accel/accel0/device/driver 2>/dev/null)" 2>/dev/null))" || echo 'no /dev/accel (needs kernel 7.x)')"
  say "RAID:                $(sed -n 's/.*\(\[[U_]*\]\).*/\1/p' "$MDSTAT" 2>/dev/null | head -n 1) $(grep -o 'recovery = [0-9.]*%' "$MDSTAT" 2>/dev/null || true)"
  if command -v dkms >/dev/null 2>&1; then say "dkms:"; dkms status 2>/dev/null | sed 's/^/  /'; else say "dkms:                not installed"; fi
}

prepare() {
  current=$(running)
  id=$(entry_id "$current") || die "no GRUB entry for the running kernel $current in $GRUB_CFG"
  say "Backports: every package at priority 1 (never chosen on its own); Helena's own at exactly"
  say "their pinned versions."
  put "$SOURCES" <<EOF
# Helena local AI (native/local-ai/kernel.sh): trixie-backports for the packages Helena pins
# in helena-backports (preferences.d). Nothing else is taken from here.
Types: deb
URIs: https://deb.debian.org/debian
Suites: trixie-backports
Components: main contrib non-free-firmware
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
EOF
  put "$PREFERENCES" <<EOF
# Helena local AI (native/local-ai/kernel.sh, install.sh): nothing from trixie-backports on its
# own; the packages Helena installs from there stay at exactly these versions until the
# scripts' pins move (the update center shows newer ones).
Package: *
Pin: release n=trixie-backports
Pin-Priority: 1

Package: $FIRMWARE_PACKAGES
Pin: version $FIRMWARE_VERSION
Pin-Priority: 1001
EOF
  if [ "$(grub_default)" != saved ]; then
    run cp -p "$DEFAULT_GRUB" "$DEFAULT_GRUB.pre-helena-kernel"
    if [ "$DRY_RUN" = 1 ]; then say "would set GRUB_DEFAULT=saved in $DEFAULT_GRUB"; else
      sed -i 's/^GRUB_DEFAULT=.*/GRUB_DEFAULT=saved/' "$DEFAULT_GRUB"
      grep -q '^GRUB_DEFAULT=saved$' "$DEFAULT_GRUB" || die "could not set GRUB_DEFAULT=saved"
    fi
  fi
  # Only the scripts decide the default: GRUB itself never saves a choice (it could not on the
  # RAID anyway).
  if grep -q '^GRUB_SAVEDEFAULT=true' "$DEFAULT_GRUB"; then die "GRUB_SAVEDEFAULT=true is set; remove it first"; fi
  run grub-set-default "$id"
  run grub-editenv "$GRUBENV" unset next_entry
  run update-grub
  run apt-get update
  say "GRUB boots $current by name ($id) until promote."
}

install_kernel() {
  [ -f "$SOURCES" ] || [ "$DRY_RUN" = 1 ] || die "run prepare first"
  [ "$(grub_default)" = saved ] || [ "$DRY_RUN" = 1 ] || die "GRUB_DEFAULT is not saved; run prepare first"
  saved=$(env_value saved_entry)
  case "$saved" in *"gnulinux-$(running)-advanced"*) ;; *) [ "$DRY_RUN" = 1 ] || die "saved_entry is not the running kernel; run prepare first" ;; esac
  # The firmware the old kernel ran with, for a rollback.
  run mkdir -p "$ROLLBACK"
  if [ "$(installed_version firmware-amd-graphics)" = "$FIRMWARE_OLD_VERSION" ]; then
    (cd "$ROLLBACK" && run apt-get download "firmware-amd-graphics=$FIRMWARE_OLD_VERSION")
  fi
  # Versioned packages, no meta package: the new kernel line does not upgrade itself; the
  # trixie meta packages keep the 6.12 line (and its security updates) as the fallback.
  pkgs=""
  for p in $KERNEL_PACKAGES; do pkgs="$pkgs $p=$TARGET_VERSION"; done
  for p in $FIRMWARE_PACKAGES; do pkgs="$pkgs $p=$FIRMWARE_VERSION"; done
  # shellcheck disable=SC2086
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends -t trixie-backports $pkgs
  # The kernel's postinst ran update-grub; the default must still be the running kernel.
  if [ "$DRY_RUN" = 0 ]; then
    case "$(env_value saved_entry)" in *"gnulinux-$(running)-advanced"*) ;; *) die "saved_entry moved; check $GRUBENV" ;; esac
    entry_id "$TARGET_ABI" >/dev/null || die "update-grub did not add $TARGET_ABI"
  fi
  sync_esps
  say "Installed $TARGET_ABI. Not booted: the default is still $(running). Next: $0 trial"
}

trial() {
  [ "$(running)" != "$TARGET_ABI" ] || die "already running $TARGET_ABI"
  id=$(entry_id "$TARGET_ABI") || die "no GRUB entry for $TARGET_ABI; run install first"
  where=$(esp_disk) || die "cannot tell the disk behind $ESP"
  disk=${where% *} part=${where#* }
  [ -f "$ESP/$LOADER_DIR/shimx64.efi" ] || die "no $ESP/$LOADER_DIR/shimx64.efi"
  [ -z "$(env_value next_entry)" ] || run grub-editenv "$GRUBENV" unset next_entry
  remove_trial
  run mkdir -p "$ESP/$TRIAL_DIR"
  for f in shimx64.efi grubx64.efi mmx64.efi; do
    [ -f "$ESP/$LOADER_DIR/$f" ] && run cp -p "$ESP/$LOADER_DIR/$f" "$ESP/$TRIAL_DIR/$f"
  done
  # The trial loader reads the same grub.cfg and only picks the new kernel as its default.
  # `source` keeps the menu in this context, so no environment block is written.
  { sed -n '/^search/p;/^set prefix/p' "$ESP/$LOADER_DIR/grub.cfg"
    say 'source $prefix/grub.cfg'
    say "set default='$id'"
    say 'set timeout=3'
  } | put "$ESP/$TRIAL_DIR/grub.cfg"
  # Not in BootOrder (-C): the firmware takes it only through BootNext, once.
  run efibootmgr -q -C -d "$disk" -p "$part" -L "$TRIAL_LABEL" -l '\EFI\helena-ktest\shimx64.efi'
  num=$(trial_bootnum || true)
  if [ "$DRY_RUN" = 0 ]; then [ -n "$num" ] || die "the trial entry was not created"; fi
  run efibootmgr -q -n "${num:-XXXX}"
  sync_esps
  say "Armed: the next boot (once) is $TARGET_ABI. Check that no agent run is in flight, then"
  say "reboot. If it hangs or panics, the machine comes back on $(running) by itself (panic=30)"
  say "or after a power cycle. After the boot: $0 verify"
}

verify() {
  report="$STATE/verify-$(date +%Y%m%d-%H%M%S).txt"
  mkdir -p "$STATE"
  failed=0
  check() {
    label=$1; shift
    if "$@" >/dev/null 2>&1; then say "ok    $label"; else say "FAIL  $label"; failed=1; fi
  }
  warn() {
    label=$1; shift
    if "$@" >/dev/null 2>&1; then say "ok    $label"; else say "warn  $label"; fi
  }
  {
    say "kernel.sh verify, $(date -Is), running $(running)"
    check "running $TARGET_ABI" test "$(running)" = "$TARGET_ABI"
    check "RAID array assembled" grep -q '^md' "$MDSTAT"
    warn "RAID both disks in sync [UU]" grep -q '\[UU\]' "$MDSTAT"
    check "ESP-B mirrors ESP-A" sh -c "! diff -rq '$ESP' '$ESP2' | grep -v helena-ktest | grep -q ."
    check "amdgpu loaded" sh -c "lsmod | grep -q '^amdgpu '"
    check "amdxdna loaded" sh -c "lsmod | grep -q '^amdxdna '"
    check "NPU device /dev/accel/accel0" test -e /dev/accel/accel0
    check "IOMMU on" sh -c "ls /sys/class/iommu | grep -q ."
    check "no amdxdna firmware errors" sh -c "! dmesg 2>/dev/null | grep -iE 'amdxdna.*(fail|error|incompatible)' | grep -q ."
    check "no amdgpu ring timeouts" sh -c "! dmesg 2>/dev/null | grep -iE 'amdgpu.*(ring .* timeout|GPU reset)' | grep -q ."
    check "VRAM carve-out seen (>= 64 GiB)" sh -c "[ \$(cat /sys/class/drm/card0/device/mem_info_vram_total) -ge 68719476736 ]"
    check "KFD exposes cwsr_size (ROCm on gfx1151)" sh -c "grep -qs cwsr_size /sys/class/kfd/kfd/topology/nodes/*/properties"
    check "no failed units" sh -c "[ -z \"\$(systemctl --failed --no-legend --plain)\" ]"
    for unit in nginx nftables postgresql volition-plan-api volition-plan-web volition-plan-worker volition-hermes-runner; do
      warn "$unit active" systemctl is-active --quiet "$unit"
    done
    warn "agent isolation units ok" sh -c "systemctl is-active --quiet volition-agent-launcher.socket || systemctl is-active --quiet volition-agent-launcher"
    if command -v dkms >/dev/null 2>&1; then
      for line in $(dkms status 2>/dev/null | sed -n 's/^\([^/,]*\)[/,] *\([^,:]*\).*/\1\/\2/p' | sort -u); do
        check "dkms $line built for $TARGET_ABI" sh -c "dkms status -k '$TARGET_ABI' '$line' | grep -q installed"
        check "dkms $line built for the old kernel too" sh -c "for k in \$(ls /lib/modules); do [ \"\$k\" = '$TARGET_ABI' ] && continue; dkms status -k \"\$k\" '$line' | grep -q installed || exit 1; done"
      done
    else
      say "info  dkms not installed (no out-of-tree modules yet)"
    fi
    say "firmware-amd-graphics $(installed_version firmware-amd-graphics)"
    dmesg 2>/dev/null | grep -iE 'amdxdna' | tail -n 5 || true
    if [ "$failed" = 0 ]; then say "RESULT: passed. Next: $0 promote"; else say "RESULT: failed. The machine returns to the old kernel on the next reboot; $0 rollback cleans up."; fi
  } | tee "$report"
  say "report: $report"
  grep -q '^RESULT: passed' "$report"
}

promote() {
  [ "$(running)" = "$TARGET_ABI" ] || die "boot $TARGET_ABI first ($0 trial, then reboot)"
  last=$(ls -t "$STATE"/verify-*.txt 2>/dev/null | head -n 1 || true)
  [ -n "$last" ] && grep -q '^RESULT: passed' "$last" || [ "$DRY_RUN" = 1 ] || die "run $0 verify first (it must pass)"
  id=$(entry_id "$TARGET_ABI") || die "no GRUB entry for $TARGET_ABI"
  run grub-set-default "$id"
  remove_trial
  say "$TARGET_ABI is the default now. The old kernel stays installed as the fallback (GRUB menu)."
}

rollback() {
  old=$(ls "$R/boot" | sed -n 's/^vmlinuz-//p' | grep -v "^$TARGET_ABI\$" | sort -V | tail -n 1)
  [ -n "$old" ] || die "no other kernel installed"
  id=$(entry_id "$old") || die "no GRUB entry for $old"
  run grub-set-default "$id"
  run grub-editenv "$GRUBENV" unset next_entry
  num=$(efibootmgr 2>/dev/null | sed -n 's/^BootNext: \(.*\)/\1/p')
  [ -z "$num" ] || run efibootmgr -q -N
  remove_trial
  if [ "$PURGE" = 1 ]; then
    [ "$(running)" != "$TARGET_ABI" ] || die "boot $old first, then purge"
    # shellcheck disable=SC2086
    run apt-get purge -y $KERNEL_PACKAGES "linux-binary-$TARGET_ABI" "linux-modules-$TARGET_ABI" \
      "linux-base-$TARGET_ABI" "linux-headers-${TARGET_ABI%-amd64}-common" "linux-kbuild-${TARGET_ABI%-amd64}"
    deb=$(ls "$ROLLBACK"/firmware-amd-graphics_*.deb 2>/dev/null | head -n 1 || true)
    if [ -n "$deb" ]; then
      run rm -f "$PREFERENCES"
      run apt-get install -y --allow-downgrades "$deb"
    else
      say "no saved firmware package; install firmware-amd-graphics=$FIRMWARE_OLD_VERSION from trixie by hand"
    fi
    run update-grub
    sync_esps
  fi
  say "Default: $old. Reboot to use it."
}

dkms_all() {
  command -v dkms >/dev/null 2>&1 || { say "dkms is not installed: nothing to build"; return; }
  for k in $(ls "$R/lib/modules"); do
    if [ -d "$R/lib/modules/$k/build" ]; then run dkms autoinstall -k "$k"; else say "no headers for $k (install linux-headers-$k)"; fi
  done
}

case "$command" in
  status) status ;;
  prepare) prepare ;;
  install) install_kernel ;;
  trial) trial ;;
  verify) verify ;;
  promote) promote ;;
  rollback) rollback ;;
  dkms) dkms_all ;;
esac
