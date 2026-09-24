#!/bin/sh
# Helena local AI, step 2: one local endpoint for the GPU, the NPU and (through Laya) the CPU.
# Lemonade Server (AMD, Apache-2.0) serves an OpenAI-compatible API on 127.0.0.1:13305 with
# llama.cpp on the Radeon 8060S (Vulkan; ROCm optional) and FastFlowLM on the XDNA2 NPU.
# Everything is pinned and checked against its SHA-256; nothing here is part of Helena's own
# image: it is an optional host service (FastFlowLM's NPU kernels are proprietary binaries).
# Decision: docs/helena-decisions/local-ai-platform.md; runbook: README.md.
#
#   sudo ./install.sh status
#   sudo ./install.sh [--dry-run] [--rocm-backend] [--no-npu] install
#   sudo ./install.sh [--dry-run] models list | pull <name> | load <name> | verify
#   sudo ./install.sh [--dry-run] [--purge] uninstall
#
# --rocm-backend  also the llama.cpp ROCm backend for gfx1151 (self-contained, 397 MB), next to
#                 Vulkan; per model, `models load` picks the one the benchmark favoured.
# --no-npu        leave FastFlowLM and XRT out (a machine without the NPU driver: kernel < 7.0).
# --purge         uninstall also removes the key, the models and the downloads.
#
# Runs after kernel.sh (backports source and pin, kernel 7.1.8 for the NPU). Downloads only
# what the owner approved (README.md "Downloads"); a model over 1 GB needs its own OK.
set -eu
here=$(cd "$(dirname "$0")" && pwd)

# ── Pins (docs/helena-decisions/local-ai-platform.md §4) ────────────────────────────────
LEMONADE_VERSION=2026.39.1
LEMONADE_DEB=lemonade-server_${LEMONADE_VERSION}-debian13_amd64.deb
LEMONADE_URL=https://github.com/lemonade-sdk/lemonade/releases/download/v${LEMONADE_VERSION}/${LEMONADE_DEB}
LEMONADE_SHA256=cf68457d9a046ba376f3d5363f91a2d81769c9ec8aadb69f1bcfe249b6d7e227
FLM_VERSION=1.0.6
FLM_DEB=fastflowlm_${FLM_VERSION}_debian13_amd64.deb
FLM_URL=https://github.com/ROCm/FastFlowLM/releases/download/v${FLM_VERSION}/${FLM_DEB}
FLM_SHA256=318e00f4089e50c93f807b5684f676705446d06110442b9e0774a478e3377142
# llama.cpp for Vulkan, the build Lemonade 2026.39.1 pins.
VULKAN_TAG=b10825
VULKAN_TAR=llama-${VULKAN_TAG}-bin-ubuntu-vulkan-x64.tar.gz
VULKAN_URL=https://github.com/ggml-org/llama.cpp/releases/download/${VULKAN_TAG}/${VULKAN_TAR}
VULKAN_SHA256=4d0f4e351f1ed53a8d5076fb9aacc6effae15ff4d09d37453404ce8a5e447de5
# llama.cpp for ROCm on gfx1151, with its ROCm runtime inside (lemonade-sdk/llamacpp-rocm, MIT).
ROCM_TAG=b1324
ROCM_ZIP=llama-${ROCM_TAG}-ubuntu-rocm-gfx1151-x64.zip
ROCM_URL=https://github.com/lemonade-sdk/llamacpp-rocm/releases/download/${ROCM_TAG}/${ROCM_ZIP}
ROCM_SHA256=eced287d50537343703128c3579c6787cbf5edb0a56bbb808816eab7b6848eb0
# From trixie-backports, at exactly these versions (preferences.d/helena-ai).
BPO_PINS="libcpp-httplib0.41=0.41.0+ds-3~bpo13+1"
XRT_VERSION=1:2.25.0-4~bpo13+1
XRT_PACKAGES="libxrt2 libxrt-npu2 libxrt-utils libxrt-utils-npu"

PORT=13305
ETC=/etc/helena-ai
KEY=$ETC/api-key
LIB=/usr/local/lib/helena-ai
OPT=/opt/helena-ai
MODELS=/var/lib/helena-ai/models
DOWNLOADS=/var/cache/helena-ai/downloads
DROPIN=/etc/systemd/system/lemond.service.d/helena.conf
PREFERENCES=/etc/apt/preferences.d/helena-ai
PROXY_SOCKET=/etc/systemd/system/helena-ai-proxy.socket
PROXY_SERVICE=/etc/systemd/system/helena-ai-proxy.service
CATALOG=$here/models.tsv

DRY_RUN=0
ROCM_BACKEND=0
NPU=1
PURGE=0
command=
args=
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --rocm-backend) ROCM_BACKEND=1 ;;
    --no-npu) NPU=0 ;;
    --purge) PURGE=1 ;;
    status|install|uninstall|models) [ -z "$command" ] && command=$1 || args="$args $1" ;;
    *) [ -n "$command" ] && args="$args $1" || { echo "unknown argument: $1" >&2; exit 2; } ;;
  esac
  shift
done
[ -n "$command" ] || { sed -n '2,22p' "$0"; exit 2; }

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
[ "$(id -u)" = 0 ] || [ "$DRY_RUN" = 1 ] || [ "$command" = status ] || die "run as root"

# fetch <url> <file> <sha256>: into the download cache, checked; an existing good file is kept.
fetch() {
  url=$1 file=$DOWNLOADS/$2 sum=$3
  if [ -f "$file" ] && echo "$sum  $file" | sha256sum -c --status; then say "have $2"; return; fi
  run mkdir -p "$DOWNLOADS"
  run curl -fL --retry 3 --proto '=https' -o "$file.part" "$url"
  if [ "$DRY_RUN" = 1 ]; then return; fi
  echo "$sum  $file.part" | sha256sum -c --status || { rm -f "$file.part"; die "$2: checksum mismatch"; }
  mv "$file.part" "$file"
}

key_header() {
  [ -r "$KEY" ] && printf 'Authorization: Bearer %s' "$(cat "$KEY")"
}

api() {
  path=$1; shift
  curl -fsS --max-time "${API_TIMEOUT:-10}" -H "$(key_header)" "$@" "http://127.0.0.1:$PORT/api/v1$path"
}

lemonade_config() {
  rocm_channel=stable rocm_bin=builtin
  if [ "$ROCM_BACKEND" = 1 ] || [ -d "$OPT/llamacpp/rocm-$ROCM_TAG" ]; then
    rocm_channel=nightly rocm_bin=$OPT/llamacpp/rocm-$ROCM_TAG
  fi
  cat <<EOF
{
  "host": "127.0.0.1",
  "port": $PORT,
  "broadcast": false,
  "offline": true,
  "no_fetch_executables": true,
  "auto_check_model_updates": false,
  "auto_update_models": false,
  "max_loaded_models": 4,
  "ctx_size": 65536,
  "models_dir": "$MODELS/hub",
  "log_level": "info",
  "telemetry": { "enabled": false },
  "llamacpp": {
    "backend": "vulkan",
    "prefer_system": false,
    "vulkan_bin": "$OPT/llamacpp/vulkan-$VULKAN_TAG",
    "rocm_bin": "$rocm_bin",
    "args": "--no-mmap"
  },
  "rocm_channel": "$rocm_channel",
  "flm": { "prefer_system": true, "args": "" }
}
EOF
}

install_all() {
  [ -f /etc/apt/sources.list.d/helena-backports.sources ] || [ "$DRY_RUN" = 1 ] || die "run kernel.sh prepare first (backports source)"
  if [ "$NPU" = 1 ] && [ ! -e /dev/accel/accel0 ] && [ "$DRY_RUN" = 0 ]; then
    die "no NPU device (/dev/accel/accel0): boot kernel 7.x first (kernel.sh), or pass --no-npu"
  fi
  getent group volition-plan >/dev/null || [ "$DRY_RUN" = 1 ] || die "group volition-plan missing (the API's group, it reads the key)"

  say "== pins for trixie-backports"
  {
    say "# Helena local AI (native/local-ai/install.sh): these, and only these, from trixie-backports."
    for pin in $BPO_PINS; do
      say "Package: ${pin%%=*}"; say "Pin: version ${pin#*=}"; say "Pin-Priority: 1001"; say ""
    done
    if [ "$NPU" = 1 ]; then
      for p in $XRT_PACKAGES; do say "Package: $p"; say "Pin: version $XRT_VERSION"; say "Pin-Priority: 1001"; say ""; done
    fi
  } | put "$PREFERENCES" 0644 root:root
  run apt-get update

  say "== downloads (pinned, checked)"
  fetch "$LEMONADE_URL" "$LEMONADE_DEB" "$LEMONADE_SHA256"
  fetch "$VULKAN_URL" "$VULKAN_TAR" "$VULKAN_SHA256"
  [ "$NPU" = 0 ] || fetch "$FLM_URL" "$FLM_DEB" "$FLM_SHA256"
  [ "$ROCM_BACKEND" = 0 ] || fetch "$ROCM_URL" "$ROCM_ZIP" "$ROCM_SHA256"

  say "== the key (root:volition-plan 0640; never printed)"
  run install -d -m 0751 -o root -g root "$ETC"
  if [ ! -s "$KEY" ]; then
    if [ "$DRY_RUN" = 1 ]; then say "would create $KEY"; else
      umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$KEY.new"
      chown root:volition-plan "$KEY.new"; chmod 0640 "$KEY.new"; mv "$KEY.new" "$KEY"
    fi
  fi

  say "== llama.cpp backends in $OPT"
  run install -d -m 0755 "$OPT/llamacpp"
  if [ ! -x "$OPT/llamacpp/vulkan-$VULKAN_TAG/llama-server" ]; then
    run install -d -m 0755 "$OPT/llamacpp/vulkan-$VULKAN_TAG"
    run tar -xzf "$DOWNLOADS/$VULKAN_TAR" -C "$OPT/llamacpp/vulkan-$VULKAN_TAG" --strip-components=1
  fi
  if [ "$ROCM_BACKEND" = 1 ] && [ ! -x "$OPT/llamacpp/rocm-$ROCM_TAG/llama-server" ]; then
    command -v unzip >/dev/null || run apt-get install -y unzip
    run install -d -m 0755 "$OPT/llamacpp/rocm-$ROCM_TAG"
    run unzip -q -o "$DOWNLOADS/$ROCM_ZIP" -d "$OPT/llamacpp/rocm-$ROCM_TAG"
  fi

  say "== Lemonade's service, before the package starts it: localhost, the key, limits"
  run install -d -m 0755 "$LIB"
  run install -m 0755 "$here/lemond-start" "$LIB/lemond-start"
  lemonade_config | put "$LIB/lemonade-defaults.json" 0644 root:root
  put "$DROPIN" 0644 root:root < "$here/systemd/lemond-helena.conf"
  run install -d -m 0750 "$MODELS"
  run systemctl daemon-reload

  say "== packages"
  # shellcheck disable=SC2086
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends -t trixie-backports \
    $BPO_PINS "$DOWNLOADS/$LEMONADE_DEB"
  if [ "$NPU" = 1 ]; then
    xrt=""
    for p in $XRT_PACKAGES; do xrt="$xrt $p=$XRT_VERSION"; done
    # shellcheck disable=SC2086
    run env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends -t trixie-backports \
      $xrt "$DOWNLOADS/$FLM_DEB"
  fi
  # The package's user owns the model store; render/video for the GPU and the NPU.
  run chown -R lemonade:lemonade "$MODELS"
  run usermod -a -G render,video lemonade

  say "== agents in isolation reach it through their unit's forwarder (127.0.0.1:$PORT)"
  if getent group volition-agents >/dev/null; then
    put "$PROXY_SOCKET" 0644 root:root < "$here/systemd/helena-ai-proxy.socket"
    put "$PROXY_SERVICE" 0644 root:root < "$here/systemd/helena-ai-proxy.service"
    run systemctl daemon-reload
    run systemctl enable --now helena-ai-proxy.socket
  else
    say "no agent isolation here (group volition-agents): no forwarder needed"
  fi

  run systemctl enable lemond.service
  run systemctl restart lemond.service
  if [ "$DRY_RUN" = 0 ]; then
    i=0; until api /health >/dev/null 2>&1; do i=$((i + 1)); [ $i -lt 30 ] || die "Lemonade did not answer on 127.0.0.1:$PORT"; sleep 1; done
  fi
  say "Installed. Next: add the server in Helena (Administrator → Server → Lokale KI, or"
  say "apps/api/src/scripts/local-ai-register.ts), then: $0 models pull <name>"
}

# ── Models ───────────────────────────────────────────────────────────────────────────────

catalog() { grep -v '^#' "$CATALOG" | grep -v '^[[:space:]]*$'; }

model_line() { catalog | awk -F '\t' -v n="$1" '$1 == n'; }

models_list() {
  say "name	kind	unit	size	license	files"
  catalog | awk -F '\t' '{ printf "%s\t%s\t%s\t%.1f GB\t%s\t%s\n", $1, $2, $3, $8 / 1e9, $10, $6 }'
}

# Puts one pinned file into the Hugging Face cache layout Lemonade reads offline:
# hub/models--<org>--<repo>/{blobs/<sha256>, snapshots/<commit>/<file>, refs/main}.
place() {
  repo=$1 commit=$2 file=$3 bytes=$4 sum=$5
  dir="$MODELS/hub/models--$(echo "$repo" | sed 's#/#--#')"
  blob="$dir/blobs/$sum"
  if [ -f "$blob" ] && [ "$(stat -c %s "$blob")" = "$bytes" ]; then say "have $repo/$file"; else
    avail=$(df -B1 --output=avail "$MODELS" 2>/dev/null | tail -n 1 || echo 0)
    [ "$DRY_RUN" = 1 ] || [ "$avail" -gt $((bytes + 10000000000)) ] || die "not enough space for $file"
    run install -d -o lemonade -g lemonade -m 0750 "$dir/blobs" "$dir/snapshots/$commit" "$dir/refs"
    run curl -fL --retry 3 --proto '=https' -o "$blob.part" "https://huggingface.co/$repo/resolve/$commit/$file"
    if [ "$DRY_RUN" = 0 ]; then
      say "checking $file …"
      echo "$sum  $blob.part" | sha256sum -c --status || { rm -f "$blob.part"; die "$file: checksum mismatch"; }
      mv "$blob.part" "$blob"
    fi
  fi
  run ln -sfn "../../blobs/$sum" "$dir/snapshots/$commit/$file"
  if [ "$DRY_RUN" = 1 ]; then say "would write $dir/refs/main = $commit"; else printf '%s' "$commit" > "$dir/refs/main"; fi
  run chown -R lemonade:lemonade "$dir"
}

models_pull() {
  name=$1
  line=$(model_line "$name")
  [ -n "$line" ] || die "no model $name in models.tsv ($0 models list)"
  kind=$(echo "$line" | cut -f2)
  repo=$(echo "$line" | cut -f4) commit=$(echo "$line" | cut -f5)
  files=$(echo "$line" | cut -f6) sizes=$(echo "$line" | cut -f7) sums=$(echo "$line" | cut -f9)
  if [ "$kind" = flm ]; then
    # FastFlowLM pulls its NPU models itself; the pull runs as Lemonade's user, and what it got
    # is recorded (models.tsv names the model FLM knows).
    run systemd-run --wait --pipe --collect --uid=lemonade --gid=lemonade -p LimitMEMLOCK=infinity \
      -p Environment=HOME=/var/lib/lemonade /usr/bin/flm pull "$repo"
    return
  fi
  i=1
  for file in $(echo "$files" | tr ',' ' '); do
    size=$(echo "$sizes" | cut -d, -f$i) sum=$(echo "$sums" | cut -d, -f$i)
    place "$repo" "$commit" "$file" "$size" "$sum"
    i=$((i + 1))
  done
  say "Placed $name. Load it with: $0 models load $name"
}

models_load() {
  name=$1
  line=$(model_line "$name")
  [ -n "$line" ] || die "no model $name in models.tsv"
  ctx=$(echo "$line" | cut -f11)
  backend=$(echo "$line" | cut -f12)
  body="{\"model_name\":\"$name\",\"ctx_size\":${ctx:-65536},\"save_options\":true"
  [ -z "$backend" ] || [ "$backend" = - ] || body="$body,\"llamacpp_backend\":\"$backend\""
  body="$body}"
  if [ "$DRY_RUN" = 1 ]; then say "would POST /load $body"; return; fi
  API_TIMEOUT=600 api /load -X POST -H 'content-type: application/json' -d "$body"
  say ""
}

models_verify() {
  failed=0
  catalog | while IFS='	' read -r name kind unit repo commit files sizes total sums license ctx backend; do
    [ "$kind" = flm ] && continue
    dir="$MODELS/hub/models--$(echo "$repo" | sed 's#/#--#')"
    [ -d "$dir" ] || { say "-     $name (not pulled)"; continue; }
    ok=1
    for sum in $(echo "$sums" | tr ',' ' '); do
      [ -f "$dir/blobs/$sum" ] && echo "$sum  $dir/blobs/$sum" | sha256sum -c --status || ok=0
    done
    [ "$(cat "$dir/refs/main" 2>/dev/null)" = "$commit" ] || ok=0
    if [ $ok = 1 ]; then say "ok    $name @ ${commit%${commit#????????}}"; else say "FAIL  $name"; failed=1; fi
  done
  return $failed
}

status() {
  say "lemond:        $(systemctl is-active lemond 2>/dev/null || true) ($(dpkg-query -W -f='${Version}' lemonade-server 2>/dev/null || echo 'not installed'))"
  say "fastflowlm:    $(dpkg-query -W -f='${Version}' fastflowlm 2>/dev/null || echo 'not installed')"
  say "libxrt-npu2:   $(dpkg-query -W -f='${Version}' libxrt-npu2 2>/dev/null || echo 'not installed')"
  say "NPU device:    $([ -e /dev/accel/accel0 ] && echo present || echo missing)"
  say "forwarder:     $(systemctl is-active helena-ai-proxy.socket 2>/dev/null || true)"
  say "key file:      $([ -e "$KEY" ] && stat -c '%U:%G %a' "$KEY" || echo missing)"
  say "backends:      $(ls "$OPT/llamacpp" 2>/dev/null | tr '\n' ' ')"
  if [ -r "$KEY" ]; then
    health=$(api /health 2>/dev/null || true)
    if [ -n "$health" ]; then
      say "health:        $(printf '%s' "$health" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("status"), d.get("version"), "loaded:", ", ".join(m.get("model_name","?")+"@"+str(m.get("device")) for m in d.get("all_models_loaded",[])) or "none")' 2>/dev/null)"
    else
      say "health:        no answer on 127.0.0.1:$PORT"
    fi
  else
    say "health:        (run as root to use the key)"
  fi
  if [ -r /sys/class/drm/card0/device/mem_info_vram_used ]; then
    say "VRAM:          $(($(cat /sys/class/drm/card0/device/mem_info_vram_used) / 1048576)) MiB of $(($(cat /sys/class/drm/card0/device/mem_info_vram_total) / 1048576)) MiB, GPU busy $(cat /sys/class/drm/card0/device/gpu_busy_percent)%"
  fi
}

uninstall() {
  run systemctl disable --now lemond.service || true
  run systemctl disable --now helena-ai-proxy.socket helena-ai-proxy.service || true
  run rm -f "$DROPIN" "$PROXY_SOCKET" "$PROXY_SERVICE" "$PREFERENCES"
  run systemctl daemon-reload
  run apt-get purge -y lemonade-server fastflowlm || true
  run rm -rf "$LIB" "$OPT"
  if [ "$PURGE" = 1 ]; then
    run rm -rf "$ETC" "$MODELS" "$DOWNLOADS"
  else
    say "kept: $KEY, $MODELS, $DOWNLOADS (--purge removes them)"
  fi
  say "Local AI removed. Helena falls back to the configured models by itself."
}

case "$command" in
  status) status ;;
  install) install_all ;;
  uninstall) uninstall ;;
  models)
    set -- $args
    case "${1:-list}" in
      list) models_list ;;
      pull) [ -n "${2:-}" ] || die "models pull <name>"; models_pull "$2" ;;
      load) [ -n "${2:-}" ] || die "models load <name>"; models_load "$2" ;;
      verify) models_verify ;;
      *) die "models list | pull <name> | load <name> | verify" ;;
    esac
    ;;
esac
