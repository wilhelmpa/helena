#!/bin/sh
# Fan and power control for the Sixunited AXB35-02 board (Bosgame M5, GMKtec EVO-X2, …):
#   - ec_su_axb35 (cmetz, GPL-2.0): the EC's fans, temperature and APU power mode, as DKMS
#   - ryzen_smu   (amkillam fork, GPL-2.0): SMU access for ryzenadj, as DKMS
#   - ryzenadj    (FlyGoat, LGPL-3.0): reads back (and may set) the power limits
#   - power-profiles-daemon (Debian): the OS profile power-saver/balanced/performance
# Every source is pinned to a commit (docs/helena-decisions/server-admin.md §5). DKMS rebuilds
# both modules for every new kernel (linux-headers-amd64 pulls the headers along).
#
#   sudo ./install-fan-control.sh [--dry-run] [--from-clones <dir>] install
#   sudo ./install-fan-control.sh status
#   sudo ./install-fan-control.sh [--dry-run] uninstall     (fans back to auto, modules removed)
#
# --from-clones <dir>: take the sources from existing clones (<dir>/ec-su_axb35-linux,
# <dir>/ryzen_smu_amkillam, <dir>/RyzenAdj) with `git archive <pinned commit>`, so only the
# pinned, committed tree is used; without it they are cloned from GitHub.
# The first choice after the install is all fans at level 5 (owner, 2026-09-24).
set -eu
here=$(cd "$(dirname "$0")" && pwd)

EC_REPO=https://github.com/cmetz/ec-su_axb35-linux.git
EC_COMMIT=e483ec93deab514c66d3e5c9eeed98b6c17887b4      # 2026-04-03
EC_VERSION=20260403-e483ec9
SMU_REPO=https://github.com/amkillam/ryzen_smu.git
SMU_COMMIT=0bb95d961664c7a0ac180f849fa16fe7da71922d     # 2026-04-25, driver 0.1.7
SMU_VERSION=0.1.7-0bb95d9
RYZENADJ_REPO=https://github.com/FlyGoat/RyzenAdj.git
RYZENADJ_COMMIT=527cacc5a8d53f54c259b75b3aba7e47d6bc464d # 2026-01-16, v0.17.0-17 (Strix Halo)
BOARDS="AXB35-02"
PACKAGES="dkms linux-headers-amd64 cmake libpci-dev power-profiles-daemon"
HOSTD=/usr/local/lib/helena/hostd/helena-hostd

DRY_RUN=0
clones=
command=
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --from-clones) clones=$2; shift ;;
    install|status|uninstall) command=$1 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$command" ] || { sed -n '2,19p' "$0"; exit 2; }
run() { if [ "$DRY_RUN" = 1 ]; then echo "would: $*"; else "$@"; fi; }
[ "$(id -u)" = 0 ] || [ "$DRY_RUN" = 1 ] || [ "$command" = status ] || { echo "run as root" >&2; exit 1; }

board=$(cat /sys/class/dmi/id/board_name 2>/dev/null || true)

# fetch <name> <repo> <commit> <target dir>: the pinned tree, from a clone or from GitHub.
fetch() {
  name=$1 repo=$2 commit=$3 target=$4
  if [ "$DRY_RUN" = 1 ]; then echo "would: put $name@$commit into $target"; return; fi
  rm -rf "$target"
  mkdir -p "$target"
  if [ -n "$clones" ]; then
    src="$clones/$name"
    git -c safe.directory="$src" -C "$src" cat-file -e "$commit^{commit}" || { echo "$src has no commit $commit" >&2; exit 1; }
  else
    src=$(mktemp -d)
    git clone --quiet --filter=blob:none --no-checkout "$repo" "$src"
    git -C "$src" cat-file -e "$commit^{commit}" || { echo "$repo has no commit $commit" >&2; exit 1; }
  fi
  # safe.directory: root reads the owner's clone (git refuses other users' repositories).
  git -c safe.directory="$src" -C "$src" archive "$commit" | tar -x -C "$target"
  [ -n "$clones" ] || rm -rf "$src"
}

dkms_install() {
  module=$1 version=$2
  if dkms status -m "$module" -v "$version" 2>/dev/null | grep -q installed; then
    echo "$module/$version already installed"
    return
  fi
  run dkms add -m "$module" -v "$version" || true
  run dkms build -m "$module" -v "$version"
  run dkms install -m "$module" -v "$version"
}

case "$command" in
install)
  if ! echo " $BOARDS " | grep -q " $board "; then
    echo "This board ($board) is not a Sixunited AXB35-02; the EC driver would write into a foreign EC. Stopping." >&2
    exit 1
  fi
  [ -x "$HOSTD" ] || { echo "install helena-hostd first (../install.sh install)" >&2; exit 1; }
  run apt-get install -y --no-install-recommends $PACKAGES "linux-headers-$(uname -r)"

  # ec_su_axb35 as DKMS. Its own Makefile builds against KERNEL_BUILD.
  fetch ec-su_axb35-linux "$EC_REPO" "$EC_COMMIT" "/usr/src/ec_su_axb35-$EC_VERSION"
  if [ "$DRY_RUN" = 0 ]; then
    sed "s/@VERSION@/$EC_VERSION/" "$here/dkms/ec_su_axb35.dkms.conf" > "/usr/src/ec_su_axb35-$EC_VERSION/dkms.conf"
  fi
  dkms_install ec_su_axb35 "$EC_VERSION"

  # ryzen_smu (amkillam) as DKMS; our dkms.conf, not its template (built with gcc like Debian's kernel).
  fetch ryzen_smu_amkillam "$SMU_REPO" "$SMU_COMMIT" "/usr/src/ryzen_smu-$SMU_VERSION"
  if [ "$DRY_RUN" = 0 ]; then
    sed "s/@VERSION@/$SMU_VERSION/" "$here/dkms/ryzen_smu.dkms.conf" > "/usr/src/ryzen_smu-$SMU_VERSION/dkms.conf"
  fi
  dkms_install ryzen_smu "$SMU_VERSION"

  run install -m 0644 -o root -g root "$here/helena-fan-control.modules" /etc/modules-load.d/helena-fan-control.conf
  run modprobe ec_su_axb35
  run modprobe ryzen_smu

  # ryzenadj from the pinned commit.
  build=$(mktemp -d)
  fetch RyzenAdj "$RYZENADJ_REPO" "$RYZENADJ_COMMIT" "$build/src"
  run cmake -S "$build/src" -B "$build/build" -DCMAKE_BUILD_TYPE=Release
  run cmake --build "$build/build" --target ryzenadj -j 4
  run install -m 0755 -o root -g root "$build/build/ryzenadj" /usr/local/sbin/ryzenadj
  run rm -rf "$build"

  run systemctl enable --now power-profiles-daemon.service
  # The first choice: every fan at level 5. The guard applies it now and after every boot.
  run python3 -I "$HOSTD" fans-initial 5
  run systemctl restart helena-power-guard.service
  echo "Fan control installed. Status: $0 status"
  ;;
status)
  echo "board: $board"
  for module in ec_su_axb35 ryzen_smu; do
    printf '%-12s %s\n' "$module" "$(lsmod | grep -q "^$module " && echo loaded || echo 'not loaded')"
  done
  dkms status 2>/dev/null | grep -E 'ec_su_axb35|ryzen_smu' || true
  if [ -d /sys/class/ec_su_axb35 ]; then
    echo "EC power mode: $(cat /sys/class/ec_su_axb35/apu/power_mode)  CPU: $(cat /sys/class/ec_su_axb35/temp1/temp) °C"
    for fan in 1 2 3; do
      echo "fan$fan: $(cat /sys/class/ec_su_axb35/fan$fan/mode) level $(cat /sys/class/ec_su_axb35/fan$fan/level) $(cat /sys/class/ec_su_axb35/fan$fan/rpm) rpm"
    done
  fi
  command -v powerprofilesctl >/dev/null && echo "OS profile: $(powerprofilesctl get)"
  if [ "$(id -u)" = 0 ] && [ -x /usr/local/sbin/ryzenadj ]; then /usr/local/sbin/ryzenadj -i 2>/dev/null | sed -n '1,12p'; fi
  systemctl is-active helena-power-guard.service >/dev/null && echo "guard: active" || echo "guard: inactive"
  ;;
uninstall)
  # Fans back to the EC's own control first, so nothing is left fixed low.
  if [ -d /sys/class/ec_su_axb35 ]; then
    for fan in 1 2 3; do
      if [ "$DRY_RUN" = 1 ]; then echo "would: fan$fan auto"; else echo auto > "/sys/class/ec_su_axb35/fan$fan/mode" || true; fi
    done
  fi
  run rm -f /etc/modules-load.d/helena-fan-control.conf
  run modprobe -r ec_su_axb35 || true
  run modprobe -r ryzen_smu || true
  run dkms remove -m ec_su_axb35 -v "$EC_VERSION" --all || true
  run dkms remove -m ryzen_smu -v "$SMU_VERSION" --all || true
  run rm -rf "/usr/src/ec_su_axb35-$EC_VERSION" "/usr/src/ryzen_smu-$SMU_VERSION"
  run rm -f /usr/local/sbin/ryzenadj
  echo "Removed. Packages kept (remove by hand if unwanted): $PACKAGES"
  ;;
esac
