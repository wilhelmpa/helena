#!/bin/sh
# Helena local AI: Halogen, a fixed host service. Halogen (peonist-ai, a closed inference engine,
# free to use including commercially, no telemetry) serves Qwen3.8-Flash-Next OpenAI-compatibly
# on 127.0.0.1:8731 (and :8733, the same API for turns without thinking). It runs as a podman
# container pinned by digest, starts at boot, restarts after a crash and stops cleanly; its own
# network may not open any connection, and only Helena's users reach its port. Nothing here is
# part of Helena's image: an optional host service like Lemonade. Decision and runbook:
# docs/helena-decisions/halogen.md, README.md next to this file.
#
#   sudo ./install.sh status
#   sudo ./install.sh [--dry-run] [--restart] install
#   sudo ./install.sh [--dry-run] weights check | pull
#   sudo ./install.sh verify                         (SHA-256 of every file: reads ~96 GB)
#   sudo ./install.sh [--dry-run] cache status | clear
#   sudo ./install.sh [--dry-run] [--purge] uninstall
#
# install    image (pull by digest), MTP head and tokenizer (pinned, checked), the settings file
#            (once), the container network, the firewall table, the unit, the forwarders for
#            agents in isolation. A running Halogen keeps running: the new unit takes effect at
#            the next restart; --restart restarts it now (minutes; check no turn uses it).
# weights    the GGUF checkpoint in the Hugging Face cache layout: `check` compares name and size
#            (cheap), `pull` downloads what is missing (94 GB: only with the owner's OK).
# cache      Halogen repacks the GGUF into its own format on the first start (~71 GB,
#            /var/lib/helena-halogen/cache) and reuses it while the shards are unchanged.
set -eu
here=$(cd "$(dirname "$0")" && pwd)

# ── Pins (docs/helena-decisions/halogen.md §2) ───────────────────────────────────────────
HALOGEN_VERSION=0.14.2
IMAGE_REPO=ghcr.io/peonist-ai/halogen-flash-server
IMAGE_DIGEST=sha256:f3f99aa48f3a051f18da9ee24b333ca108fe745773fd036a365fe1875871d0be
IMAGE=$IMAGE_REPO@$IMAGE_DIGEST
FILES=$here/files.tsv
MODEL_ID=halogen-qwen3.8-flash-next

PORT=8731
QUIET_PORT=8733
NETWORK=helena-halogen
SUBNET=10.89.73.0/29
FWD_USER=helena-halogen-fwd
# The users whose processes may reach Halogen's ports (besides root and the forwarder): the API,
# the runner (agents outside isolation) and the owner's shell. Names that do not exist here are
# skipped. HELENA_HALOGEN_USERS overrides.
USERS=${HELENA_HALOGEN_USERS:-"volition-plan helena volition-hermes wilhelmpa"}

# Where the installer keeps its state. Tests point HELENA_HALOGEN_TEST_ROOT at a temporary
# directory so a dry run reads that instead of the machine's (only with --dry-run).
R=${HELENA_HALOGEN_TEST_ROOT:-}
STATE=$R/var/lib/helena-halogen
MODELS=$STATE/models
CACHE=$STATE/cache
HUB=$R/var/lib/helena-ai/models/hub
CONF=$R/etc/helena/halogen.conf
LIB=$R/usr/local/lib/helena-halogen
UNIT=$R/etc/systemd/system/helena-halogen.service
PROXY_SOCKET=$R/etc/systemd/system/helena-halogen-proxy@.socket
PROXY_SERVICE=$R/etc/systemd/system/helena-halogen-proxy@.service
NFT=$R/etc/nftables.d/helena-halogen.nft
SYSCTL=$R/etc/sysctl.d/60-helena-halogen.conf
THP=$R/etc/tmpfiles.d/60-helena-thp.conf

DRY_RUN=0
RESTART=0
PURGE=0
command=
args=
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --restart) RESTART=1 ;;
    --purge) PURGE=1 ;;
    status|install|weights|verify|cache|uninstall|render) [ -z "$command" ] && command=$1 || args="$args $1" ;;
    *) [ -n "$command" ] && args="$args $1" || { echo "unknown argument: $1" >&2; exit 2; } ;;
  esac
  shift
done
[ -n "$command" ] || { sed -n '2,26p' "$0"; exit 2; }

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY_RUN" = 1 ]; then say "would: $*"; else "$@"; fi; }
die() { say "install.sh: $*" >&2; exit 1; }
put() {
  mode=$2 owner=$3
  if [ "$DRY_RUN" = 1 ]; then say "would write $1 ($mode $owner):"; sed 's/^/    /'; return; fi
  mkdir -p "$(dirname "$1")"
  tmp=$(mktemp "$1.XXXXXX")
  cat > "$tmp"
  chmod "$mode" "$tmp"
  chown "$owner" "$tmp"
  mv "$tmp" "$1"
}
case "$command $args" in
  "status "*|"weights  check"|"cache  status"|"cache "|"render "*) readonly_command=1 ;;
  *) readonly_command=0 ;;
esac
[ "$(id -u)" = 0 ] || [ "$DRY_RUN" = 1 ] || [ "$readonly_command" = 1 ] || die "run as root"
# A test root is for dry runs and the read-only commands only.
[ -z "$R" ] || [ "$DRY_RUN" = 1 ] || [ "$readonly_command" = 1 ] || { echo "HELENA_HALOGEN_TEST_ROOT is for --dry-run only" >&2; exit 2; }

files() { grep -v '^#' "$FILES" | grep -v '^[[:space:]]*$'; }
field() { printf '%s\n' "$1" | cut -f"$2"; }
# The weights' repository folder in the Hugging Face cache, and the checkpoint's first shard.
repo_dir() { printf '%s/models--%s' "$HUB" "$(printf '%s' "$1" | sed 's#/#--#')"; }
weights_line() { files | awk -F '\t' '$1 == "weights"' | head -n 1; }
WEIGHTS_REPO=$(field "$(weights_line)" 2)
WEIGHTS_REVISION=$(field "$(weights_line)" 3)
WEIGHTS_FILE=$(field "$(weights_line)" 4)
HEAD_FILE=$(files | awk -F '\t' '$1 == "head" { print $4; exit }')

# The numeric ids of the users that may reach Halogen: root, the forwarder, $USERS.
allowed_uids() {
  uids=0
  for name in $FWD_USER $USERS; do
    id=$(id -u "$name" 2>/dev/null || true)
    [ -n "$id" ] && case " $uids " in *" $id "*) ;; *) uids="$uids $id" ;; esac
  done
  printf '%s' "$uids" | sed 's/ /, /g'
}

render_unit() {
  sed -e "s#@IMAGE@#$IMAGE#g" -e "s#@PORT@#$PORT#g" -e "s#@QUIET_PORT@#$QUIET_PORT#g" \
    -e "s#@CONF@#/etc/helena/halogen.conf#g" -e "s#@NETWORK@#$NETWORK#g" \
    -e "s#@MODELS@#/var/lib/helena-halogen/models#g" \
    -e "s#@GGUF_REPO@#/var/lib/helena-ai/models/hub/models--$(printf '%s' "$WEIGHTS_REPO" | sed 's#/#--#')#g" \
    -e "s#@GGUF_REVISION@#$WEIGHTS_REVISION#g" -e "s#@GGUF_FILE@#$WEIGHTS_FILE#g" \
    -e "s#@MTP_HEAD@#$HEAD_FILE#g" -e "s#@CACHE@#/var/lib/helena-halogen/cache#g" \
    -e "s#@LIB@#/usr/local/lib/helena-halogen#g" \
    "$here/systemd/helena-halogen.service.in"
}

render_nft() {
  sed -e "s#@SUBNET@#$SUBNET#g" -e "s#@NETWORK@#$NETWORK#g" \
    -e "s#@PORTS@#$PORT, $QUIET_PORT#g" -e "s#@UIDS@#$(allowed_uids)#g" \
    "$here/helena-halogen.nft.in"
}

render_proxy_service() {
  sed "s#@SUBNET@#$SUBNET#g" "$here/systemd/helena-halogen-proxy@.service"
}

# fetch <repo> <revision> <path> <bytes> <sha256> <target>: from Hugging Face at the pinned
# revision, checked; a good file is kept.
fetch() {
  repo=$1 revision=$2 path=$3 bytes=$4 sum=$5 target=$6
  if [ -f "$target" ] && [ "$(stat -c %s "$target")" = "$bytes" ] && echo "$sum  $target" | sha256sum -c --status; then
    say "have $path"; return
  fi
  run install -d -m 0755 "$(dirname "$target")"
  run curl -fL --retry 3 --proto '=https' -o "$target.part" "https://huggingface.co/$repo/resolve/$revision/$path"
  [ "$DRY_RUN" = 0 ] || return 0
  echo "$sum  $target.part" | sha256sum -c --status || { rm -f "$target.part"; die "$path: checksum mismatch"; }
  chmod 0644 "$target.part"
  mv "$target.part" "$target"
}

# The weights in the Hugging Face cache: <repo dir>/snapshots/<revision>/<path> → ../../blobs/<sha256>.
# `check`: every shard present, its blob named by the pinned SHA-256 and of the pinned size.
weights_check() {
  out=$(files | awk -F '\t' '$1 == "weights"' | while IFS="$(printf '\t')" read -r kind repo revision path bytes sum; do
    dir=$(repo_dir "$repo")
    link="$dir/snapshots/$revision/$path"
    blob="$dir/blobs/$sum"
    if [ -f "$blob" ] && [ "$(stat -c %s "$blob")" = "$bytes" ] && [ "$(readlink -f "$link" 2>/dev/null)" = "$(readlink -f "$blob")" ]; then
      say "ok      $path"
    else
      say "MISSING $path ($bytes bytes)"
    fi
  done)
  say "$out"
  case "$out" in *MISSING*) return 1 ;; esac
  return 0
}

weights_pull() {
  files | awk -F '\t' '$1 == "weights"' | while IFS="$(printf '\t')" read -r kind repo revision path bytes sum; do
    dir=$(repo_dir "$repo")
    blob="$dir/blobs/$sum"
    if [ ! -f "$blob" ] || [ "$(stat -c %s "$blob")" != "$bytes" ]; then
      avail=$(df -B1 --output=avail "$HUB" 2>/dev/null | tail -n 1 || echo 0)
      [ "$DRY_RUN" = 1 ] || [ "$avail" -gt $((bytes + 20000000000)) ] || die "not enough space for $path"
      run install -d -m 0750 "$dir/blobs" "$dir/refs"
      run curl -fL --retry 3 -C - --proto '=https' -o "$blob.part" "https://huggingface.co/$repo/resolve/$revision/$path"
      if [ "$DRY_RUN" = 0 ]; then
        say "checking $path …"
        echo "$sum  $blob.part" | sha256sum -c --status || { rm -f "$blob.part"; die "$path: checksum mismatch"; }
        mv "$blob.part" "$blob"
      fi
    fi
    up=$(echo "$path" | sed 's#[^/]*/#../#g; s#[^/]*$##')
    run install -d -m 0750 "$(dirname "$dir/snapshots/$revision/$path")"
    run ln -sfn "../../${up}blobs/$sum" "$dir/snapshots/$revision/$path"
  done
  # The store belongs to Lemonade's user where it exists (local-ai/install.sh); Halogen reads it
  # as root in its container.
  if getent passwd lemonade >/dev/null; then run chown -R lemonade:lemonade "$(repo_dir "$WEIGHTS_REPO")"; fi
}

# Every pinned file's SHA-256, read in full.
verify() {
  failed=0
  for line in $(files | tr '\t' '|' ); do
    kind=$(echo "$line" | cut -d'|' -f1) repo=$(echo "$line" | cut -d'|' -f2)
    revision=$(echo "$line" | cut -d'|' -f3) path=$(echo "$line" | cut -d'|' -f4)
    sum=$(echo "$line" | cut -d'|' -f6)
    case "$kind" in
      weights) file="$(repo_dir "$repo")/snapshots/$revision/$path" ;;
      *) file="$MODELS/$path" ;;
    esac
    if [ -e "$file" ] && echo "$sum  $file" | sha256sum -c --status; then say "ok    $path"; else say "FAIL  $path"; failed=1; fi
  done
  return $failed
}

cache_status() {
  meta=$(ls "$CACHE"/*.hgn.json 2>/dev/null | head -n 1 || true)
  if [ -z "$meta" ]; then say "cache:         empty (the next start repacks the GGUF, ~71 GB)"; return; fi
  size=$(du -sb "$CACHE" 2>/dev/null | cut -f1)
  dir="$(repo_dir "$WEIGHTS_REPO")/snapshots/$WEIGHTS_REVISION/$(dirname "$WEIGHTS_FILE")"
  state=$(python3 - "$meta" "$dir" <<'PY'
import json, os, sys
meta, folder = sys.argv[1], sys.argv[2]
try:
    shards = json.load(open(meta)).get('shards', [])
except (OSError, ValueError):
    print('unreadable'); sys.exit(0)
for shard in shards:
    path = os.path.join(folder, shard.get('name', ''))
    try:
        if os.path.getsize(path) != shard.get('size'):
            print('stale (shard size changed: %s)' % shard.get('name')); sys.exit(0)
    except OSError:
        print('stale (shard missing: %s)' % shard.get('name')); sys.exit(0)
print('current (%d shards)' % len(shards))
PY
)
  say "cache:         $(awk -v b="${size:-0}" 'BEGIN { printf "%.1f GB", b / 1e9 }') in $CACHE, $state"
}

cache_clear() {
  if [ "$DRY_RUN" = 0 ] && systemctl is-active --quiet helena-halogen; then
    die "Halogen is running on this cache: stop it first (systemctl stop helena-halogen)"
  fi
  run find "$CACHE" -mindepth 1 -maxdepth 1 -name '*.hgn*' -delete
  say "Cache cleared: the next start repacks the GGUF (minutes, ~71 GB)."
}

install_all() {
  command -v podman >/dev/null || [ "$DRY_RUN" = 1 ] || die "podman is missing (apt install podman)"
  command -v nft >/dev/null || [ "$DRY_RUN" = 1 ] || die "nftables is missing"
  [ -e /dev/kfd ] || [ "$DRY_RUN" = 1 ] || die "no /dev/kfd: the GPU's compute device (amdgpu, kernel 7.x)"

  say "== the weights ($WEIGHTS_REPO @ ${WEIGHTS_REVISION%${WEIGHTS_REVISION#????????}})"
  weights_check || [ "$DRY_RUN" = 1 ] || die "the weights are missing: $0 weights pull (94 GB, owner's OK first)"

  say "== the image (pinned by digest: $HALOGEN_VERSION)"
  if [ "$DRY_RUN" = 0 ] && podman image exists "$IMAGE"; then say "have $IMAGE"; else
    run podman pull "$IMAGE"
  fi

  say "== MTP head and tokenizer (pinned, checked) in $MODELS"
  run install -d -m 0755 "$STATE" "$MODELS" "$MODELS/tokenizer" "$CACHE"
  files | awk -F '\t' '$1 == "head" || $1 == "tokenizer"' | while IFS="$(printf '\t')" read -r kind repo revision path bytes sum; do
    fetch "$repo" "$revision" "$path" "$bytes" "$sum" "$MODELS/$path"
  done

  say "== settings (once; never overwritten)"
  if [ -e "$CONF" ]; then say "have $CONF"; else put "$CONF" 0644 root:root < "$here/halogen.conf"; fi

  say "== Kingston host memory policy (kernel cmdline is a separate maintenance step)"
  put "$SYSCTL" 0644 root:root < "$here/60-helena-halogen.conf"
  put "$THP" 0644 root:root < "$here/60-helena-thp.conf"
  run sysctl -p "$SYSCTL"
  run systemd-tmpfiles --create "$THP"

  say "== the forwarder's user (the firewall lets only named users reach the port)"
  if ! id -u "$FWD_USER" >/dev/null 2>&1; then
    run useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$FWD_USER"
  fi

  say "== the container's network: no DNS, no route out (the firewall drops what it starts)"
  if [ "$DRY_RUN" = 0 ] && podman network exists "$NETWORK"; then say "have network $NETWORK"; else
    run podman network create --disable-dns --subnet "$SUBNET" --opt isolate=true "$NETWORK"
  fi

  say "== the firewall table ($NFT)"
  render_nft | put "$NFT" 0644 root:root
  run nft -f "$NFT"

  say "== the unit"
  run install -d -m 0755 "$LIB"
  run install -m 0755 "$here/wait-healthy" "$LIB/wait-healthy"
  changed=1
  if [ -f "$UNIT" ] && render_unit | cmp -s - "$UNIT"; then changed=0; fi
  render_unit | put "$UNIT" 0644 root:root
  run systemctl daemon-reload
  run systemctl enable helena-halogen.service

  say "== agents in isolation reach it through their unit's forwarder (127.0.0.1:$PORT, :$QUIET_PORT)"
  if getent group volition-agents >/dev/null; then
    put "$PROXY_SOCKET" 0644 root:root < "$here/systemd/helena-halogen-proxy@.socket"
    render_proxy_service | put "$PROXY_SERVICE" 0644 root:root
    run systemctl daemon-reload
    run systemctl enable --now "helena-halogen-proxy@$PORT.socket" "helena-halogen-proxy@$QUIET_PORT.socket"
    say "then: native/isolation.sh sync (launcher.json forwards halogen/halogenquiet)"
  else
    say "no agent isolation here (group volition-agents): no forwarder needed"
  fi

  say "== start"
  if [ "$DRY_RUN" = 0 ] && systemctl is-active --quiet helena-halogen; then
    if [ "$RESTART" = 1 ]; then run systemctl restart helena-halogen
    elif [ "$changed" = 1 ]; then say "Halogen runs on the previous unit: restart it when no turn uses it (--restart, or systemctl restart helena-halogen)"
    else say "Halogen runs on this unit already"; fi
  else
    run systemctl start helena-halogen
  fi
  say "Installed. Register it in Helena: Administrator → Lokale KI → Server hinzufügen (Art"
  say "\"Halogen\"), or apps/api/src/scripts/local-ai-register.ts --kind halogen (README.md)."
}

check_value() {
  if [ "$2" = "$3" ]; then say "ok             $1=$2"
  else say "DRIFT          $1=${2:-unavailable}; expected $3"; fi
}

host_status() {
  for spec in "60-helena-halogen.conf:$SYSCTL" "60-helena-thp.conf:$THP"; do
    if cmp -s "$here/${spec%%:*}" "${spec#*:}"; then
      say "host file:     ${spec#*:} current"
    else
      say "DRIFT          ${spec#*:} missing or differs (re-run install; see kernel.md)"
    fi
  done
  while read -r key equals expected; do
    case "$key" in vm.*)
      actual=$(cat "$R/proc/sys/$(printf '%s' "$key" | tr . /)" 2>/dev/null || true)
      check_value "$key" "$actual" "$expected" ;;
    esac
  done < "$here/60-helena-halogen.conf"
  for setting in enabled defrag; do
    actual=$(sed -n 's/.*\[\([^]]*\)\].*/\1/p' "$R/sys/kernel/mm/transparent_hugepage/$setting" 2>/dev/null || true)
    check_value "THP.$setting" "$actual" madvise
  done
  cmdline=$(cat "$R/proc/cmdline" 2>/dev/null || true)
  for arg in ttm.pages_limit=31457280 amdgpu.noretry=0 iommu=pt; do
    case " $cmdline " in
      *" $arg "*) say "kernel:        $arg" ;;
      *) say "DRIFT          kernel cmdline lacks $arg (review kernel.md; no automatic GRUB changes)" ;;
    esac
  done
  for key in vm/watermark_scale_factor vm/zone_reclaim_mode vm/nr_hugepages kernel/numa_balancing; do
    say "host observed: $key=$(cat "$R/proc/sys/$key" 2>/dev/null || echo unavailable)"
  done
  for name in scaling_driver scaling_governor energy_performance_preference; do
    say "CPU0 observed: $name=$(cat "$R/sys/devices/system/cpu/cpu0/cpufreq/$name" 2>/dev/null || echo unavailable)"
  done
  for name in memory.high memory.max memory.events; do
    value=$(cat "$R/sys/fs/cgroup/system.slice/helena-halogen.service/$name" 2>/dev/null || echo unavailable)
    say "cgroup:        $name=$(printf '%s' "$value" | tr '\n' ' ')"
    case "$name" in memory.high|memory.max) check_value "$name" "$value" max ;; esac
  done
  # Inspect the engine, not podman's limit; never read a process environment.
  engine_found=0
  for proc in "$R"/proc/[0-9]*; do
    read -r name 2>/dev/null < "$proc/comm" || continue
    [ "$name" = flash_serve ] || continue
    grep -q '/system.slice/helena-halogen.service/' "$proc/cgroup" 2>/dev/null || continue
    engine_found=1
    locked=$(awk '/^VmLck:/ {print $2}' "$proc/status" 2>/dev/null || true)
    say "engine:        pid=${proc##*/}, VmLck=${locked:-unavailable} kB"
    [ -n "$locked" ] && [ "$locked" != 0 ] || say "DRIFT          engine weights not confirmed mlocked; next planned start with HALOGEN_WEIGHTS_LOCK=1 (kernel.md)"
    say "engine limit:  $(grep '^Max locked memory' "$proc/limits" 2>/dev/null || echo unavailable)"
    limit=$(awk '/^Max locked memory/ {print $4 ":" $5}' "$proc/limits" 2>/dev/null || true)
    check_value "engine.memlock.soft:hard" "$limit" unlimited:unlimited
  done
  [ "$engine_found" = 1 ] || say "engine:        unavailable (not running or /proc access restricted)"
}

status() {
  host_status
  enabled=$(systemctl is-enabled helena-halogen 2>/dev/null) || true
  active=$(systemctl is-active helena-halogen 2>/dev/null) || true
  say "unit:          ${enabled:-not installed}, ${active:-inactive}"
  if [ -f "$UNIT" ]; then
    pinned=$(sed -n 's/^Environment=HALOGEN_IMAGE=//p' "$UNIT")
    if [ "$pinned" = "$IMAGE" ]; then say "image:         $HALOGEN_VERSION ($IMAGE_DIGEST)"; else say "image:         unit pins ${pinned:-nothing}; installer pins $HALOGEN_VERSION: re-run install"; fi
    render_unit | cmp -s - "$UNIT" && say "unit file:     current" || say "unit file:     differs from this installer (re-run install)"
  else
    say "image:         (no unit)"
  fi
  say "firewall:      $(nft list table inet helena_halogen >/dev/null 2>&1 && echo loaded || echo 'NOT loaded (the unit refuses to start)')"
  say "forwarders:    $(systemctl is-active "helena-halogen-proxy@$PORT.socket" 2>/dev/null || true) / $(systemctl is-active "helena-halogen-proxy@$QUIET_PORT.socket" 2>/dev/null || true)"
  if [ -f "$CONF" ]; then
    diff=$(grep -v '^#' "$CONF" | grep . | sort > "${TMPDIR:-/tmp}/hh-conf.$$"; grep -v '^#' "$here/halogen.conf" | grep . | sort | comm -13 - "${TMPDIR:-/tmp}/hh-conf.$$"; rm -f "${TMPDIR:-/tmp}/hh-conf.$$")
    say "settings:      $CONF${diff:+ (own: $(printf '%s' "$diff" | tr '\n' ' '))}"
  else
    say "settings:      missing ($CONF)"
  fi
  weights_check >/dev/null 2>&1 && say "weights:       present ($WEIGHTS_REPO)" || say "weights:       MISSING ($0 weights check)"
  cache_status
  health=$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/health" 2>/dev/null || true)
  if [ -n "$health" ]; then
    say "health:        $(printf '%s' "$health" | python3 -c 'import json,sys; d=json.load(sys.stdin); v=d.get("version") or {}; print(d.get("status"), v.get("engine"), "·", d.get("model"), "· slots", d.get("slots"), "· busy", d.get("in_flight"), "queued", d.get("queued"), "· vision", "on" if (d.get("vision") or {}).get("enabled") else "off")' 2>/dev/null)"
  else
    say "health:        no answer on 127.0.0.1:$PORT"
  fi
  mem=$(cat "$R/sys/fs/cgroup/system.slice/helena-halogen.service/memory.current" 2>/dev/null || true)
  [ -z "$mem" ] || say "memory:        $(awk -v b="$mem" 'BEGIN { printf "%.1f GB", b / 1e9 }') charged to the unit (not total weights/GTT; see kernel.md)"
}

uninstall() {
  run systemctl disable --now helena-halogen.service || true
  run systemctl disable --now "helena-halogen-proxy@$PORT.socket" "helena-halogen-proxy@$QUIET_PORT.socket" || true
  run rm -f "$UNIT" "$PROXY_SOCKET" "$PROXY_SERVICE"
  run systemctl daemon-reload
  run nft delete table inet helena_halogen || true
  run rm -f "$NFT"
  # Host memory policy also affects other services; retain it until explicitly reviewed.
  say "kept host policy: $SYSCTL, $THP (see kernel.md for removal)"
  run podman network rm "$NETWORK" || true
  run rm -rf "$LIB"
  if [ "$PURGE" = 1 ]; then
    run podman rmi "$IMAGE" || true
    run rm -rf "$MODELS" "$CACHE" "$CONF"
    say "The GGUF weights stay in $HUB (Lemonade's store; local-ai/install.sh manages it)."
  else
    say "kept: $CONF, $MODELS, $CACHE (71 GB), the image (--purge removes them)"
  fi
  say "Halogen removed. Helena falls back to the configured models by itself."
}

case "$command" in
  status) status ;;
  install) install_all ;;
  render)
    case "${args# }" in
      unit) render_unit ;;
      nft) render_nft ;;
      proxy) render_proxy_service ;;
      *) die "render unit | nft | proxy" ;;
    esac
    ;;
  weights)
    case "${args# }" in
      check|'') weights_check ;;
      pull) weights_pull ;;
      *) die "weights check | pull" ;;
    esac
    ;;
  verify) verify ;;
  cache)
    case "${args# }" in
      status|'') cache_status ;;
      clear) cache_clear ;;
      *) die "cache status | clear" ;;
    esac
    ;;
  uninstall) uninstall ;;
esac
