#!/bin/sh
# Helena local AI, step 2: one local endpoint for the GPU, the NPU and (through Laya) the CPU.
# Lemonade Server (AMD, Apache-2.0) serves an OpenAI-compatible API on 127.0.0.1:13305 with
# llama.cpp on the Radeon 8060S — ROCm first (our own HIP build for gfx1151 on AMD's ROCm
# 10.0.0), Vulkan (RADV) as the measured comparison and fallback — and FastFlowLM on the XDNA2
# NPU. Everything is pinned and checked (SHA-256, git commit, pip --require-hashes); nothing here
# is part of Helena's own image: it is an optional host service (FastFlowLM's NPU kernels are
# proprietary binaries). Decision: docs/helena-decisions/local-ai-platform.md; runbook: README.md.
#
#   sudo ./install.sh status                 (with the ROCm checks: rocminfo, KFD memory, HIP)
#   sudo ./install.sh [--dry-run] [--no-rocm] [--no-npu] install
#   sudo ./install.sh [--dry-run] models list | pull <name> | load <name> | verify
#   sudo ./install.sh [--dry-run] [--purge] uninstall
#
# --no-rocm   Vulkan only (no ROCm SDK, no HIP build): a GPU-only setup on an older kernel.
# --no-npu    leave FastFlowLM and XRT out (a machine without the NPU driver: kernel < 7.0).
# --purge     uninstall also removes the key, the models, the ROCm tree and the downloads.
#
# Runs after kernel.sh (backports source and pin, kernel 7.1.8: amdxdna for the NPU, and KFD
# giving ROCm the 96 GiB carve-out — on 6.12 KFD offers only the ~15.5 GiB GTT). Downloads only
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
# llama.cpp: one release for both backends, so the comparison is fair. ROCm is built here from the
# tagged source (the commit is checked), Vulkan is the project's own Ubuntu build of the same tag.
LLAMA_TAG=b11166
LLAMA_COMMIT=a72e04abe0fe9b36e203033ac71bd5f379c35bc5
LLAMA_SRC=llama.cpp-${LLAMA_TAG}.tar.gz
LLAMA_SRC_URL=https://github.com/ggml-org/llama.cpp/archive/refs/tags/${LLAMA_TAG}.tar.gz
# GitHub may re-pack an archive; the commit inside (git get-tar-commit-id) is what must match.
LLAMA_SRC_SHA256=1f8d18ea155f37d7f55814ee7fa9066e9d53424d153728fb03921d73eb754267
VULKAN_TAR=llama-${LLAMA_TAG}-bin-ubuntu-vulkan-x64.tar.gz
VULKAN_URL=https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${VULKAN_TAR}
VULKAN_SHA256=69e26c5e577e1c17dec0b59d3146f008424297a2c64a92fa445365e264585667
# ROCm 10.0.0 (AMD's TheRock release, stable channel; gfx1151 native) and PyTorch 2.13 for it, one
# tree for the HIP build and Laya, every wheel hash-pinned in rocm-requirements.txt.
ROCM_VERSION=10.0.0
ROCM_INDEX=https://stable.repo.amd.com/rocm/whl-next/
ROCM_VENV=/opt/helena-ai/rocm-${ROCM_VERSION}
ROCM_PYTHON=/usr/bin/python3.13
# From trixie-backports, at exactly these versions (preferences.d/helena-ai).
BPO_PINS="libcpp-httplib0.41=0.41.0+ds-3~bpo13+1"
XRT_VERSION=1:2.25.0-4~bpo13+1
XRT_PACKAGES="libxrt2 libxrt-npu2 libxrt-utils libxrt-utils-npu"

PORT=13305
ETC=/etc/helena
KEY=$ETC/local-ai.key
# The group the API reads the key through: on Kingston the API user's secrets group
# `volition-plan-secrets` (there is no group `volition-plan`); after the rename helena-secrets.
# HELENA_API_GROUP overrides it (same rule as native/laya/install.sh).
api_group() {
  if [ -n "${HELENA_API_GROUP:-}" ]; then echo "$HELENA_API_GROUP"; return; fi
  local group
  for group in helena-secrets volition-plan-secrets volition-plan; do
    if getent group "$group" >/dev/null; then echo "$group"; return; fi
  done
  echo volition-plan-secrets
}
API_GROUP=$(api_group)
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
ROCM=1
NPU=1
PURGE=0
command=
args=
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --no-rocm) ROCM=0 ;;
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
case "$command $args" in "status "*|"models  list"|"models "|"models  verify") readonly_command=1 ;; *) readonly_command=0 ;; esac
[ "$(id -u)" = 0 ] || [ "$DRY_RUN" = 1 ] || [ "$readonly_command" = 1 ] || die "run as root"

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
  # ROCm is the default engine; Vulkan stays configured, so a model whose bench favours it is
  # loaded with `llamacpp_backend: vulkan` (models.tsv, `models load`). "rocm" is Lemonade's
  # rocm-stable channel; rocm_bin (a path) replaces its own download (lemonade-sdk/llama.cpp
  # b10820 on TheRock 7.14, a second ROCm next to ours), and without Lemonade's TheRock runtime
  # it only adds the binary's folder to LD_LIBRARY_PATH. `--load-mode none`: the weights are
  # read into VRAM, not memory-mapped (llama.cpp's former --no-mmap; with mmap the page cache
  # of a 60 GB model competes with the 31 GB the OS has).
  backend=rocm rocm_bin=$OPT/llamacpp/rocm-$LLAMA_TAG
  if [ "$ROCM" = 0 ]; then backend=vulkan rocm_bin=builtin; fi
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
    "backend": "$backend",
    "prefer_system": false,
    "vulkan_bin": "$OPT/llamacpp/vulkan-$LLAMA_TAG",
    "rocm_bin": "$rocm_bin",
    "args": "--load-mode none"
  },
  "flm": { "prefer_system": true, "args": "" }
}
EOF
}

# ── ROCm ─────────────────────────────────────────────────────────────────────────────────

rocm_root() { "$ROCM_VENV/bin/rocm-sdk" path --root; }

# ROCm 10.0.0 as AMD publishes it for every distribution: the TheRock SDK wheels (core,
# libraries with hipBLASLt and rocWMMA, devel with hipcc/clang, the gfx1151 device code) and
# PyTorch built against them, in one venv owned by root. No /opt/rocm, no apt repository, no
# second ROCm tree: llama.cpp is compiled against this one, Laya imports torch from it.
install_rocm() {
  if [ -x "$ROCM_VENV/bin/rocm-sdk" ] && [ "$("$ROCM_VENV/bin/rocm-sdk" version 2>/dev/null)" = "$ROCM_VERSION" ]; then
    say "have ROCm $ROCM_VERSION in $ROCM_VENV"
    return
  fi
  if [ "$DRY_RUN" = 0 ]; then
    command -v uv >/dev/null || die "uv is missing (/usr/local/bin/uv, as for Hermes)"
    [ -x "$ROCM_PYTHON" ] || die "$ROCM_PYTHON is missing"
  fi
  run install -d -m 0755 /var/cache/helena-ai/uv
  run env UV_CACHE_DIR=/var/cache/helena-ai/uv uv venv -q -p "$ROCM_PYTHON" "$ROCM_VENV"
  # --require-hashes: every wheel must match the hash recorded in rocm-requirements.txt (AMD's
  # index publishes none of its own). Installed ≈ 8 GB: SDK devel 4.3 GB (hipcc, headers, and
  # the libraries llama.cpp links), core 1.4 GB, PyTorch 0.9 GB, Triton 1.4 GB.
  run env UV_CACHE_DIR=/var/cache/helena-ai/uv uv pip install -q --python "$ROCM_VENV/bin/python" \
    --require-hashes --index-url "$ROCM_INDEX" --extra-index-url https://pypi.org/simple \
    --index-strategy unsafe-best-match -r "$here/rocm-requirements.txt"
  run chmod -R go-w "$ROCM_VENV"
  # The unpacked wheels in uv's cache are as large as the venv (8 GB); a reinstall downloads
  # the same hash-pinned files again.
  run rm -rf /var/cache/helena-ai/uv
}

# llama.cpp's HIP backend for gfx1151, built from the pinned commit against the ROCm above.
build_llama_hip() {
  dest=$OPT/llamacpp/rocm-$LLAMA_TAG
  if [ -x "$dest/llama-server" ]; then say "have $dest"; return; fi
  src=/var/cache/helena-ai/build/llama.cpp-$LLAMA_TAG
  run rm -rf "$src"
  run install -d -m 0755 "$src"
  run tar -xzf "$DOWNLOADS/$LLAMA_SRC" -C "$src" --strip-components=1
  root=$( [ "$DRY_RUN" = 1 ] && echo "$ROCM_VENV/lib/python3.13/site-packages/_rocm_sdk_devel" || rocm_root )
  command -v g++ >/dev/null || [ "$DRY_RUN" = 1 ] || die "g++ is missing (build-essential: ROCm's clang uses its C++ library)"
  # cmake and ninja come from the ROCm venv (hash-pinned); the compilers are ROCm's own clang,
  # the LLVM that also builds the device code (Debian's libstdc++ headers from g++).
  # HIP_PATH/ROCM_PATH: llama.cpp's CMake finds hip, hipBLAS, rocBLAS and rocWMMA in the venv's
  #   SDK tree (rocm-sdk path --root), not in a /opt/rocm that does not exist here.
  # GGML_HIP=ON: the HIP backend (ggml-cuda compiled for AMD).
  # AMDGPU_TARGETS=gfx1151: code for this GPU only (ROCm 10 knows it natively: no
  #   HSA_OVERRIDE_GFX_VERSION anywhere).
  # GGML_HIP_ROCWMMA_FATTN=ON: flash attention through rocWMMA on RDNA3.5's WMMA units, the
  #   prefill gain on Strix Halo at long context (§4 of the decision, measured).
  # LLAMA_CURL=OFF: the binaries never download anything (Lemonade places the models).
  # LLAMA_BUILD_NUMBER/COMMIT: a tarball has no .git; `llama-server --version` still names the
  #   release (b11166 = build 11166) and the checked commit.
  # CMAKE_BUILD_RPATH=$ORIGIN;<SDK>/lib: the copied binaries find their own libllama/libggml
  #   next to them and ROCm in the venv, with no LD_LIBRARY_PATH (ldd shows every library
  #   resolved there, TheRock's own libdrm/libnuma/zstd included). hipBLASLt is chosen at run
  #   time (ROCBLAS_USE_HIPBLASLT in the drop-in).
  run env PATH="$ROCM_VENV/bin:$PATH" HIP_PATH="$root" ROCM_PATH="$root" \
    cmake -S "$src" -B "$src/build" -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1151 -DGGML_HIP_ROCWMMA_FATTN=ON \
      -DCMAKE_C_COMPILER="$root/lib/llvm/bin/clang" -DCMAKE_CXX_COMPILER="$root/lib/llvm/bin/clang++" \
      -DCMAKE_HIP_COMPILER="$root/lib/llvm/bin/clang++" -DCMAKE_PREFIX_PATH="$root" \
      -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF \
      -DLLAMA_BUILD_NUMBER="${LLAMA_TAG#b}" -DLLAMA_BUILD_COMMIT="$(echo "$LLAMA_COMMIT" | cut -c1-9)" \
      "-DCMAKE_BUILD_RPATH=\$ORIGIN;$root/lib"
  # Four jobs: each HIP translation unit takes 2–3 GB, and Helena keeps running meanwhile.
  run env PATH="$ROCM_VENV/bin:$PATH" cmake --build "$src/build" -j 4 \
    --target llama-server llama-bench llama-cli
  run install -d -m 0755 "$dest"
  run sh -c "cp -a '$src/build/bin/.' '$dest/'"
  run rm -rf "$src"
}

# What ROCm needs, checked: the GPU as gfx1151, KFD offering the carve-out (kernel 7.x), a
# HIP kernel through PyTorch, and llama.cpp seeing the ROCm device. As Lemonade's user.
# A matrix product on the GPU through PyTorch (the Laya path), compared with the CPU's.
HIP_SMOKE='import torch
a = torch.randn(1024, 1024)
g = (a.cuda() @ a.cuda()).cpu()
print(torch.version.hip, torch.cuda.get_device_name(0), "ok" if torch.allclose(g, a @ a, rtol=1e-3, atol=1e-2) else "MISMATCH")'

rocm_check() {
  [ -x "$ROCM_VENV/bin/rocm-sdk" ] || { say "ROCm:          not installed"; return; }
  root=$(rocm_root)
  # As Lemonade's user (render, video) when root; otherwise as the caller, who needs the
  # render group for /dev/kfd.
  as_ai() {
    if [ "$(id -u)" = 0 ] && getent passwd lemonade >/dev/null; then
      systemd-run --wait --pipe --collect --quiet --uid=lemonade --gid=lemonade \
        -p SupplementaryGroups="render video" "$@"
    else "$@"; fi
  }
  say "ROCm:          $("$ROCM_VENV/bin/rocm-sdk" version) in $ROCM_VENV"
  say "rocminfo:      $(as_ai "$root/bin/rocminfo" 2>/dev/null | grep -m1 -o 'gfx1151' || echo 'no gfx1151 agent')"
  kfd=0
  for f in /sys/class/kfd/kfd/topology/nodes/*/mem_banks/*/properties; do
    size=$(sed -n 's/^size_in_bytes //p' "$f" 2>/dev/null); [ "${size:-0}" -gt "$kfd" ] && kfd=$size
  done
  say "KFD memory:    $((kfd / 1073741824)) GiB $( [ "$kfd" -ge 68719476736 ] && echo '(the carve-out: ok)' || echo '(only GTT: boot kernel 7.x)')"
  say "HIP smoke:     $(as_ai "$ROCM_VENV/bin/python" -c "$HIP_SMOKE" 2>&1 | tail -n 1)"
  say "llama.cpp:     $(as_ai "$OPT/llamacpp/rocm-$LLAMA_TAG/llama-cli" --list-devices 2>&1 | grep -m1 ROCm || echo 'no ROCm device')"
  say "amd-smi:       $(as_ai "$root/bin/amd-smi" static --asic --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); d=d[0] if isinstance(d,list) else d; a=d.get("asic") or {}; print(a.get("market_name","?"), a.get("target_graphics_version","?"))' 2>/dev/null || echo 'not available')"
}

install_all() {
  [ -f /etc/apt/sources.list.d/helena-backports.sources ] || [ "$DRY_RUN" = 1 ] || die "run kernel.sh prepare first (backports source)"
  if [ "$NPU" = 1 ] && [ ! -e /dev/accel/accel0 ] && [ "$DRY_RUN" = 0 ]; then
    die "no NPU device (/dev/accel/accel0): boot kernel 7.x first (kernel.sh), or pass --no-npu"
  fi
  getent group "$API_GROUP" >/dev/null || [ "$DRY_RUN" = 1 ] || die "group $API_GROUP missing (the API's secrets group, it reads the key)"

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
  if [ "$ROCM" = 1 ]; then
    fetch "$LLAMA_SRC_URL" "$LLAMA_SRC" "$LLAMA_SRC_SHA256"
    if [ "$DRY_RUN" = 0 ]; then
      commit=$(gzip -dc "$DOWNLOADS/$LLAMA_SRC" | git get-tar-commit-id)
      [ "$commit" = "$LLAMA_COMMIT" ] || die "llama.cpp source is commit $commit, not $LLAMA_COMMIT"
    fi
  fi

  say "== the key (root:$API_GROUP 0640; never printed)"
  # Helena's key directory (native/laya keeps its key here too); the key file itself is 0640.
  run install -d -m 0755 -o root -g root "$ETC"
  if [ ! -s "$KEY" ]; then
    if [ "$DRY_RUN" = 1 ]; then say "would create $KEY"; else
      umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$KEY.new"
      chown "root:$API_GROUP" "$KEY.new"; chmod 0640 "$KEY.new"; mv "$KEY.new" "$KEY"
    fi
  fi

  say "== llama.cpp backends in $OPT"
  run install -d -m 0755 "$OPT/llamacpp"
  if [ ! -x "$OPT/llamacpp/vulkan-$LLAMA_TAG/llama-server" ]; then
    run install -d -m 0755 "$OPT/llamacpp/vulkan-$LLAMA_TAG"
    run tar -xzf "$DOWNLOADS/$VULKAN_TAR" -C "$OPT/llamacpp/vulkan-$LLAMA_TAG" --strip-components=1
  fi
  if [ "$ROCM" = 1 ]; then
    install_rocm
    build_llama_hip
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
  # A file in a folder of the repository (UD-Q4_K_XL/…) lies one level deeper.
  up=$(echo "$file" | sed 's#[^/]*/#../#g; s#[^/]*$##')
  run install -d -o lemonade -g lemonade -m 0750 "$(dirname "$dir/snapshots/$commit/$file")"
  run ln -sfn "../../${up}blobs/$sum" "$dir/snapshots/$commit/$file"
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
  case "$name" in
    user.*)
      # Not in Lemonade's own registry: register the checkpoint it now finds on disk.
      variant=$(echo "$files" | cut -d, -f1)
      case "$variant" in */*) variant=${variant%%/*} ;; esac
      mmproj=$(echo "$files" | tr ',' '\n' | grep '^mmproj' | head -n 1 || true)
      body="{\"model_name\":\"$name\",\"checkpoint\":\"$repo:$variant\",\"recipe\":\"llamacpp\""
      [ -z "$mmproj" ] || body="$body,\"mmproj\":\"$mmproj\",\"labels\":[\"vision\",\"tool-calling\"]"
      body="$body}"
      if [ "$DRY_RUN" = 1 ]; then say "would POST /pull $body"; else
        API_TIMEOUT=120 api /pull -X POST -H 'content-type: application/json' -d "$body"
        say ""
      fi
      ;;
  esac
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
  rocm_check
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
  run rm -rf "$LIB" "$OPT/llamacpp"
  if [ "$PURGE" = 1 ]; then
    # Only this installer's key: /etc/helena also holds other keys (native/laya).
    run rm -rf "$KEY" "$MODELS" "$DOWNLOADS" /var/cache/helena-ai "$ROCM_VENV"
    run rmdir --ignore-fail-on-non-empty "$OPT"
  else
    # The ROCm tree stays: Laya (--rocm) may use its PyTorch.
    say "kept: $KEY, $MODELS, $DOWNLOADS, $ROCM_VENV (--purge removes them)"
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
