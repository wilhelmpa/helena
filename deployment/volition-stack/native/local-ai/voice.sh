#!/bin/sh
# Helena's voice on the GPU (docs/helena-decisions/voice-2.md): the ear and the voice of the
# chat's conversation mode as two small servers next to Lemonade, both resident on the Radeon
# 8060S (the ~31 GB of system RAM is what agents and builds fight over; the 96 GiB VRAM
# carve-out has room):
#
#   helena-voice-stt  whisper.cpp's whisper-server (MIT) with Whisper large-v3-turbo fine-tuned
#                     for German (primeline, Apache-2.0), 127.0.0.1:13306, OpenAI path /v1;
#   helena-voice-tts  qwentts.cpp's tts-server (MIT) with Qwen3-TTS 12 Hz (Apache-2.0),
#                     127.0.0.1:13307, streams 24 kHz PCM as it speaks; the voices designed or
#                     cloned here are registered at every start.
#
# Both are built here from pinned sources for gfx1151 against the ROCm 10 tree install.sh put
# in /opt/helena-ai (no second ROCm), run as `helena-voice` in a sandbox, and have no key of
# their own: they listen on loopback, and the firewall's `voice` ACL (native/hardening,
# `apply.sh firewall`) lets only root and Helena's API user connect. Helena registers them as
# model servers (kinds `whisper-cpp` and `qwentts-cpp`), and Lokale KI → Transkription / Vorlesen
# point at them. Optional, like the rest of local AI; Helena works unchanged without it.
#
#   sudo ./voice.sh status
#   sudo ./voice.sh [--dry-run] install
#   sudo ./voice.sh [--dry-run] models list | pull <name> | verify
#   sudo ./voice.sh [--dry-run] voice design <name> "<English description>"   (needs the
#                   qwen3-tts-1.7b-voicedesign model: `models pull` it first)
#   sudo ./voice.sh [--dry-run] voice clone <name> <reference.wav> <transcript.txt>
#   sudo ./voice.sh [--dry-run] voice list | remove <name>
#   sudo ./voice.sh [--dry-run] [--purge] uninstall
#
# Downloads only what the owner approved (README.md "Voice"); models over 1 GB need their own OK.
set -eu
here=$(cd "$(dirname "$0")" && pwd)

# ── Pins (docs/helena-decisions/voice-2.md §6) ────────────────────────────────────────────
WHISPER_VERSION=1.8.4
WHISPER_COMMIT=9386f239401074690479731c1e41683fbbeac557
WHISPER_SRC=whisper.cpp-$WHISPER_VERSION.tar.gz
WHISPER_SRC_URL=https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v$WHISPER_VERSION.tar.gz
WHISPER_SRC_SHA256=b26f30e52c095ccb75da40b168437736605eb280de57381887bf9e2b65f31e66
# qwentts.cpp has no tags: a commit of master, and the commit of its ggml fork (a submodule,
# which GitHub's archive leaves out).
QWENTTS_COMMIT=6a3e91283220197bad2ae1eb40ae1c1392bfd820
QWENTTS_SRC=qwentts.cpp-$QWENTTS_COMMIT.tar.gz
QWENTTS_SRC_URL=https://github.com/ServeurpersoCom/qwentts.cpp/archive/$QWENTTS_COMMIT.tar.gz
QWENTTS_SRC_SHA256=1b4a520cb8506861381112921407a7c8903907fba8437a58eccf2508ce5c8c95
QWENTTS_GGML_COMMIT=765bc96f9bb8d4c397c91c23b4e5c52a93fcf9b0
QWENTTS_GGML_SRC=qwentts-ggml-$QWENTTS_GGML_COMMIT.tar.gz
QWENTTS_GGML_URL=https://github.com/ServeurpersoCom/ggml/archive/$QWENTTS_GGML_COMMIT.tar.gz
QWENTTS_GGML_SHA256=38edb3eefde696e90df4d5d52637d7ecbab35e0f669f2414ac7e3687d86e05df

STT_PORT=13306
TTS_PORT=13307
STT_BACKEND_PORT=14306
TTS_BACKEND_PORT=14307
VOICE_USER=helena-voice
# The model each server loads (a name of voice-models.tsv).
STT_MODEL=${HELENA_VOICE_STT_MODEL:-whisper-large-v3-turbo-german}
TTS_MODEL=${HELENA_VOICE_TTS_MODEL:-qwen3-tts-0.6b-base}
VAD_MODEL=whisper-vad-silero
TTS_CODEC=qwen3-tts-tokenizer
STT_BACKEND=${HELENA_VOICE_STT_BACKEND:-cpu}
TTS_BACKEND=${HELENA_VOICE_TTS_BACKEND:-rocm}
case "$STT_BACKEND" in cpu|rocm) ;; *) echo "voice.sh: HELENA_VOICE_STT_BACKEND must be cpu or rocm" >&2; exit 2 ;; esac
case "$TTS_BACKEND" in cpu|rocm) ;; *) echo "voice.sh: HELENA_VOICE_TTS_BACKEND must be cpu or rocm" >&2; exit 2 ;; esac

R=${HELENA_AI_TEST_ROOT:-}
OPT=$R/opt/helena-ai
ROCM_VENV=$OPT/rocm-10.0.0
BIN=$OPT/voice
DATA=$R/var/lib/helena-voice
MODELS=$DATA/models
VOICES=$DATA/voices
CACHE=$R/var/cache/helena-ai
DOWNLOADS=$CACHE/downloads
UNITS=${HELENA_VOICE_UNIT_DIR:-$R/etc/systemd/system}
LIB=$R/usr/local/lib/helena-ai
CATALOG=$here/voice-models.tsv

DRY_RUN=0
PURGE=0
command=
args=
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --purge) PURGE=1 ;;
    *)
      if [ -z "$command" ]; then
        case "$1" in status|install|uninstall|models|voice) command=$1 ;; *) echo "unknown argument: $1" >&2; exit 2 ;; esac
      else
        # One argument per line: a voice description has spaces.
        args="$args
$1"
      fi ;;
  esac
  shift
done
[ -n "$command" ] || { sed -n '2,33p' "$0"; exit 2; }
[ -z "$R" ] || [ "$DRY_RUN" = 1 ] || { echo "HELENA_AI_TEST_ROOT is for --dry-run only" >&2; exit 2; }

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY_RUN" = 1 ]; then say "would: $*"; else "$@"; fi; }
die() { say "voice.sh: $*" >&2; exit 1; }
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
case "$command" in status|models) readonly_command=1 ;; *) readonly_command=0 ;; esac
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

# The commit inside a GitHub archive (git get-tar-commit-id), checked against the pin: GitHub
# may re-pack an archive, the commit it holds must not change.
check_commit() {
  [ "$DRY_RUN" = 1 ] && return
  got=$(gzip -dc "$DOWNLOADS/$1" | git get-tar-commit-id 2>/dev/null || true)
  [ "$got" = "$2" ] || die "$1 holds commit '$got', expected $2"
}

# ── Models ───────────────────────────────────────────────────────────────────────────────

catalog() { grep -v '^#' "$CATALOG" | grep -v '^[[:space:]]*$'; }
model_line() { catalog | awk -F '\t' -v n="$1" '$1 == n'; }
model_path() { printf '%s/%s' "$MODELS" "$(model_line "$1" | cut -f5)"; }

models_list() {
  say "name	role	size	license	file"
  catalog | awk -F '\t' '{ printf "%s\t%s\t%.2f GB\t%s\t%s\n", $1, $2, $6 / 1e9, $8, $5 }'
}

models_pull() {
  line=$(model_line "$1")
  [ -n "$line" ] || die "no model $1 in voice-models.tsv ($0 models list)"
  repo=$(echo "$line" | cut -f3) commit=$(echo "$line" | cut -f4) file=$(echo "$line" | cut -f5)
  bytes=$(echo "$line" | cut -f6) sum=$(echo "$line" | cut -f7)
  dest=$MODELS/$file
  if [ -f "$dest" ] && [ "$(stat -c %s "$dest")" = "$bytes" ]; then say "have $1"; return; fi
  avail=$(df -B1 --output=avail "$(dirname "$MODELS")" 2>/dev/null | tail -n 1 || echo 0)
  [ "$DRY_RUN" = 1 ] || [ "$avail" -gt $((bytes + 5000000000)) ] || die "not enough space for $file"
  run install -d -o root -g "$VOICE_USER" -m 0750 "$MODELS"
  run curl -fL --retry 3 --proto '=https' -o "$dest.part" "https://huggingface.co/$repo/resolve/$commit/$(echo "$line" | cut -f9)"
  if [ "$DRY_RUN" = 0 ]; then
    say "checking $file …"
    echo "$sum  $dest.part" | sha256sum -c --status || { rm -f "$dest.part"; die "$file: checksum mismatch"; }
    chown root:"$VOICE_USER" "$dest.part"
    chmod 0640 "$dest.part"
    mv "$dest.part" "$dest"
  fi
}

models_verify() {
  status=0
  catalog | while IFS='	' read -r name role repo commit file bytes sum license remote; do
    path=$MODELS/$file
    if [ ! -f "$path" ]; then say "$name: not downloaded"; continue; fi
    if echo "$sum  $path" | sha256sum -c --status; then say "$name: ok"; else say "$name: CHECKSUM MISMATCH"; status=1; fi
  done
  return $status
}

# ── Build ────────────────────────────────────────────────────────────────────────────────

rocm_root() { "$ROCM_VENV/bin/rocm-sdk" path --root; }

# CMake for gfx1151 on Helena's ROCm, as install.sh builds llama.cpp (see the flags there):
# ROCm's own clang for host and device code, the ROCm libraries found through RPATH, no
# downloads. Static libraries of the project itself, so each binary is one file next to nothing
# but ROCm. NOT with rocWMMA flash attention (GGML_HIP_ROCWMMA_FATTN): measured 2026-09-26,
# whisper.cpp 1.8.4 built with it transcribes garbage on gfx1151 ("Pos.com.com.", 100 % WER);
# ggml's own flash-attention kernels are right (5.2 %) and the fastest (340 ms p50).
hip_cmake() {
  src=$1; shift
  root=$( [ "$DRY_RUN" = 1 ] && echo "$ROCM_VENV/lib/python3.13/site-packages/_rocm_sdk_devel" || rocm_root )
  run env PATH="$ROCM_VENV/bin:$PATH" HIP_PATH="$root" ROCM_PATH="$root" \
    cmake -S "$src" -B "$src/build" -G Ninja \
      -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
      -DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1151 -DGGML_NATIVE=OFF \
      -DCMAKE_C_COMPILER="$root/lib/llvm/bin/clang" -DCMAKE_CXX_COMPILER="$root/lib/llvm/bin/clang++" \
      -DCMAKE_HIP_COMPILER="$root/lib/llvm/bin/clang++" -DCMAKE_PREFIX_PATH="$root" \
      "-DCMAKE_BUILD_RPATH=$root/lib" "$@"
}

voice_cmake() {
  src=$1; shift
  if [ "$1" = rocm ]; then shift; hip_cmake "$src" "$@"; else
    shift
    # Ninja ships in the ROCm venv, not on the system PATH; the CPU build needs it too.
    run env PATH="$ROCM_VENV/bin:$PATH" cmake -S "$src" -B "$src/build" -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF -DGGML_HIP=OFF "$@"
  fi
}

build_whisper() {
  dest=$BIN/whisper-$WHISPER_VERSION-$STT_BACKEND
  if [ -x "$dest/whisper-server" ]; then say "have $dest"; return; fi
  fetch "$WHISPER_SRC_URL" "$WHISPER_SRC" "$WHISPER_SRC_SHA256"
  check_commit "$WHISPER_SRC" "$WHISPER_COMMIT"
  src=$CACHE/build/whisper.cpp-$WHISPER_VERSION
  run rm -rf "$src"
  run install -d -m 0755 "$src"
  run tar --no-same-owner -xzf "$DOWNLOADS/$WHISPER_SRC" -C "$src" --strip-components=1
  voice_cmake "$src" "$STT_BACKEND" -DWHISPER_BUILD_TESTS=OFF -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF
  # Four jobs; HIP builds otherwise compete with Helena for host memory.
  run env PATH="$ROCM_VENV/bin:$PATH" cmake --build "$src/build" -j 4 --target whisper-server whisper-cli
  run install -d -m 0755 "$dest"
  run install -m 0755 "$src/build/bin/whisper-server" "$src/build/bin/whisper-cli" "$dest/"
  run rm -rf "$src"
}

build_qwentts() {
  dest=$BIN/qwentts-$(echo "$QWENTTS_COMMIT" | cut -c1-9)-$TTS_BACKEND
  if [ -x "$dest/tts-server" ]; then say "have $dest"; return; fi
  fetch "$QWENTTS_SRC_URL" "$QWENTTS_SRC" "$QWENTTS_SRC_SHA256"
  fetch "$QWENTTS_GGML_URL" "$QWENTTS_GGML_SRC" "$QWENTTS_GGML_SHA256"
  check_commit "$QWENTTS_SRC" "$QWENTTS_COMMIT"
  check_commit "$QWENTTS_GGML_SRC" "$QWENTTS_GGML_COMMIT"
  src=$CACHE/build/qwentts.cpp
  run rm -rf "$src"
  run install -d -m 0755 "$src" "$src/ggml"
  run tar --no-same-owner -xzf "$DOWNLOADS/$QWENTTS_SRC" -C "$src" --strip-components=1
  run tar --no-same-owner -xzf "$DOWNLOADS/$QWENTTS_GGML_SRC" -C "$src/ggml" --strip-components=1
  voice_cmake "$src" "$TTS_BACKEND"
  run env PATH="$ROCM_VENV/bin:$PATH" cmake --build "$src/build" -j 4 --target tts-server qwen-tts qwen-codec
  run install -d -m 0755 "$dest"
  for tool in tts-server qwen-tts qwen-codec; do
    run sh -c "install -m 0755 \"\$(find '$src/build' -name $tool -type f -perm -u+x | head -n 1)\" '$dest/'"
  done
  run rm -rf "$src"
}

whisper_bin() { echo "$BIN/whisper-$WHISPER_VERSION-$STT_BACKEND"; }
qwentts_bin() { echo "$BIN/qwentts-$(echo "$QWENTTS_COMMIT" | cut -c1-9)-$TTS_BACKEND"; }

# ── Units ────────────────────────────────────────────────────────────────────────────────

ensure_user() {
  getent passwd "$VOICE_USER" >/dev/null && return
  run useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin \
    --user-group --groups render,video "$VOICE_USER"
}

write_units() {
  # Both services use loopback and a read-only system; GPU device access is backend-specific.
  common="User=$VOICE_USER
Group=$VOICE_USER
NoNewPrivileges=yes
CapabilityBoundingSet=
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictNamespaces=yes
RestrictRealtime=yes
LockPersonality=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
IPAddressDeny=any
IPAddressAllow=localhost
DevicePolicy=closed
Restart=always
RestartSec=3
Nice=-2"
  stt_gpu=
  tts_gpu=
  stt_args='--threads 12 --no-gpu'
  if [ "$STT_BACKEND" = rocm ]; then stt_args='--threads 4'; fi
  if [ "$STT_BACKEND" = rocm ]; then stt_gpu='SupplementaryGroups=render video
Environment=HSA_ENABLE_SDMA=0
Environment=ROCBLAS_USE_HIPBLASLT=1
DeviceAllow=/dev/kfd rw
DeviceAllow=char-drm rw'; fi
  if [ "$TTS_BACKEND" = rocm ]; then tts_gpu='SupplementaryGroups=render video
Environment=HSA_ENABLE_SDMA=0
Environment=ROCBLAS_USE_HIPBLASLT=1
DeviceAllow=/dev/kfd rw
DeviceAllow=char-drm rw'; fi
  put "$UNITS/helena-voice-stt.service" 0644 root:root <<EOF
# Helena's ear (native/local-ai/voice.sh): whisper.cpp ($STT_BACKEND), German Whisper.
# The owner's words go nowhere but this machine; only root and Helena's API may connect
# (firewall ACL \`voice\`).
[Unit]
Description=Helena voice: speech recognition (whisper.cpp, $STT_BACKEND)
After=network.target
StopWhenUnneeded=yes

[Service]
ExecStart=$(whisper_bin)/whisper-server --model $(model_path "$STT_MODEL") --language de \\
  --host 127.0.0.1 --port $STT_BACKEND_PORT --request-path /v1 --inference-path /audio/transcriptions \\
  $stt_args --flash-attn --suppress-nst --no-timestamps --vad --vad-model $(model_path "$VAD_MODEL")
ExecStartPost=+/usr/bin/curl --fail --silent --output /dev/null --retry 240 --retry-connrefused --retry-delay 1 --max-time 2 http://127.0.0.1:$STT_BACKEND_PORT/v1/health
ReadOnlyPaths=$MODELS
# Host-side memory ceiling; the actual requirement depends on backend and load.
MemoryHigh=3G
MemoryMax=6G
TimeoutStartSec=5min
$common
$stt_gpu

[Install]
WantedBy=multi-user.target
EOF
  put "$UNITS/helena-voice-tts.service" 0644 root:root <<EOF
# Helena's voice (native/local-ai/voice.sh): Qwen3-TTS ($TTS_BACKEND), streaming as it speaks.
# ROCm without flash attention was measured on gfx1151; CPU latency is not measured yet.
# The voices in $VOICES are registered once it answers (they live in its memory only).
[Unit]
Description=Helena voice: speech (Qwen3-TTS, $TTS_BACKEND)
After=network.target
StopWhenUnneeded=yes

[Service]
ExecStart=$(qwentts_bin)/tts-server --model $(model_path "$TTS_MODEL") --codec $(model_path "$TTS_CODEC") \\
  --alias qwen3-tts --host 127.0.0.1 --port $TTS_BACKEND_PORT --lang German --no-fa
# As root (+): the firewall voice ACL lets only root and the API user reach the port.
ExecStartPost=+$LIB/voice-register-voices $TTS_BACKEND_PORT $VOICES
ReadOnlyPaths=$MODELS $VOICES
MemoryHigh=3G
MemoryMax=6G
TimeoutStartSec=5min
$common
$tts_gpu

[Install]
WantedBy=multi-user.target
EOF
  for kind in stt tts; do
    if [ "$kind" = stt ]; then port=$STT_PORT; backend=$STT_BACKEND_PORT; else port=$TTS_PORT; backend=$TTS_BACKEND_PORT; fi
    put "$UNITS/helena-voice-$kind-proxy.socket" 0644 root:root <<EOF
[Unit]
Description=Helena voice $kind on-demand socket

[Socket]
ListenStream=127.0.0.1:$port
NoDelay=yes

[Install]
WantedBy=sockets.target
EOF
    put "$UNITS/helena-voice-$kind-proxy.service" 0644 root:root <<EOF
[Unit]
Description=Helena voice $kind on-demand proxy
Requires=helena-voice-$kind.service
After=helena-voice-$kind.service

[Service]
ExecStart=/lib/systemd/systemd-socket-proxyd --exit-idle-time=5min 127.0.0.1:$backend
EOF
  done
  put "$LIB/voice-register-voices" 0755 root:root < "$here/voice-register-voices"
}

wait_health() { # wait_health <port> <path>
  i=0
  while [ $i -lt 180 ]; do
    curl -sf -m 2 "http://127.0.0.1:$1$2" >/dev/null && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}

# ── Voices ───────────────────────────────────────────────────────────────────────────────

# The sentence a designed voice says for its reference: long enough for the speaker encoder
# (~8 s), German, with the sounds a German answer has.
REF_TEXT='Hallo, ich bin Helena. Ich helfe dir bei deinen Projekten, Aufgaben und Terminen. Sag einfach, was du brauchst.'

# Runs a qwentts tool on the GPU as the voice user.
as_voice() {
  run systemd-run --wait --pipe --collect --quiet --uid="$VOICE_USER" --gid="$VOICE_USER" \
    -p SupplementaryGroups="render video" -p Environment=HSA_ENABLE_SDMA=0 \
    -p ReadWritePaths="$VOICES" -p ReadOnlyPaths="$MODELS" "$@"
}

voice_encode() { # voice_encode <name>: <name>.wav → <name>.spk + <name>.rvq for the Base talker
  as_voice "$(qwentts_bin)/qwen-codec" --model "$(model_path "$TTS_CODEC")" \
    --talker "$(model_path "$TTS_MODEL")" -i "$VOICES/$1.wav"
  [ "$DRY_RUN" = 1 ] || { [ -f "$VOICES/$1.spk" ] && [ -f "$VOICES/$1.rvq" ]; } \
    || die "qwen-codec wrote no $1.spk/$1.rvq"
}

voice_name_ok() { echo "$1" | grep -Eq '^[a-z][a-z0-9-]{0,31}$' || die "a voice name is a–z, 0–9 and -"; }

voice_design() { # voice_design <name> <description>
  voice_name_ok "$1"
  design=$(model_path qwen3-tts-1.7b-voicedesign)
  [ "$DRY_RUN" = 1 ] || [ -f "$design" ] || die "pull the design model first: $0 models pull qwen3-tts-1.7b-voicedesign"
  run install -d -o "$VOICE_USER" -g "$VOICE_USER" -m 0750 "$VOICES"
  printf '%s' "$REF_TEXT" | put "$VOICES/$1.txt" 0640 "$VOICE_USER:$VOICE_USER"
  as_voice sh -c "exec '$(qwentts_bin)/qwen-tts' --model '$design' --codec '$(model_path "$TTS_CODEC")' \
    --instruct \"\$1\" --lang German --seed 7 -o '$VOICES/$1.wav' < '$VOICES/$1.txt'" sh "$2"
  voice_encode "$1"
  say "voice $1 designed; restart helena-voice-tts to offer it (systemctl restart helena-voice-tts)"
}

voice_clone() { # voice_clone <name> <wav> <transcript>
  voice_name_ok "$1"
  [ -f "$2" ] && [ -f "$3" ] || die "need a reference WAV and its transcript"
  run install -d -o "$VOICE_USER" -g "$VOICE_USER" -m 0750 "$VOICES"
  run install -o "$VOICE_USER" -g "$VOICE_USER" -m 0640 "$2" "$VOICES/$1.wav"
  run install -o "$VOICE_USER" -g "$VOICE_USER" -m 0640 "$3" "$VOICES/$1.txt"
  voice_encode "$1"
  say "voice $1 cloned; restart helena-voice-tts to offer it"
}

# ── Commands ─────────────────────────────────────────────────────────────────────────────

status() {
  for unit in helena-voice-stt helena-voice-tts; do
    say "$unit: $(systemctl is-active "$unit" 2>/dev/null || true)"
  done
  say "ear:    $(curl -sf -m 3 "http://127.0.0.1:$STT_PORT/v1/health" || echo 'not answering')"
  say "voice:  $(curl -sf -m 3 "http://127.0.0.1:$TTS_PORT/v1/models" || echo 'not answering')"
  say "voices: $(curl -sf -m 3 "http://127.0.0.1:$TTS_PORT/v1/audio/voices" || echo '-')"
  say "built:  $( [ -x "$(whisper_bin)/whisper-server" ] && echo whisper.cpp || echo '-') $( [ -x "$(qwentts_bin)/tts-server" ] && echo qwentts.cpp || echo '-')"
  models_verify || true
}

install_all() {
  if [ "$STT_BACKEND" = rocm ] || [ "$TTS_BACKEND" = rocm ]; then
    [ -x "$ROCM_VENV/bin/rocm-sdk" ] || [ "$DRY_RUN" = 1 ] || die "ROCm is missing: run install.sh install first"
  fi
  command -v g++ >/dev/null || [ "$DRY_RUN" = 1 ] || die "g++ is missing"
  ensure_user
  run install -d -m 0755 "$DATA"
  run install -d -o root -g "$VOICE_USER" -m 0750 "$MODELS"
  run install -d -o "$VOICE_USER" -g "$VOICE_USER" -m 0750 "$VOICES"
  models_pull "$STT_MODEL"
  models_pull "$VAD_MODEL"
  models_pull "$TTS_MODEL"
  models_pull "$TTS_CODEC"
  build_whisper
  build_qwentts
  write_units
  run systemctl daemon-reload
  run systemctl disable --now helena-voice-stt.service helena-voice-tts.service
  run systemctl enable --now helena-voice-stt-proxy.socket helena-voice-tts-proxy.socket
  if [ "$DRY_RUN" = 0 ]; then
    wait_health "$STT_PORT" /v1/health || die "helena-voice-stt does not answer (journalctl -u helena-voice-stt)"
    wait_health "$TTS_PORT" /health || die "helena-voice-tts does not answer (journalctl -u helena-voice-tts)"
  fi
  say "voice installed. Next (README.md \"Voice\"): apply.sh firewall (the voice ACL), register"
  say "the servers in Helena (voice-register.ts), then Lokale KI → Transkription / Vorlesen."
}

uninstall() {
  run systemctl disable --now helena-voice-stt-proxy.socket helena-voice-tts-proxy.socket 2>/dev/null || true
  run systemctl stop helena-voice-stt-proxy.service helena-voice-tts-proxy.service 2>/dev/null || true
  run systemctl disable --now helena-voice-stt.service helena-voice-tts.service 2>/dev/null || true
  run rm -f "$UNITS/helena-voice-stt.service" "$UNITS/helena-voice-tts.service" \
    "$UNITS/helena-voice-stt-proxy.socket" "$UNITS/helena-voice-tts-proxy.socket" \
    "$UNITS/helena-voice-stt-proxy.service" "$UNITS/helena-voice-tts-proxy.service" "$LIB/voice-register-voices"
  run systemctl daemon-reload
  run rm -rf "$BIN"
  if [ "$PURGE" = 1 ]; then
    run rm -rf "$DATA"
    run userdel "$VOICE_USER" 2>/dev/null || true
  else
    say "kept the models and voices in $DATA (--purge removes them)"
  fi
}

IFS='
'
# shellcheck disable=SC2086 # split on the newlines only
set -- $args
unset IFS
case "$command" in
  status) status ;;
  install) install_all ;;
  uninstall) uninstall ;;
  models)
    case "${1:-list}" in
      list) models_list ;;
      pull) [ -n "${2:-}" ] || die "models pull <name>"; ensure_user; models_pull "$2" ;;
      verify) models_verify ;;
      *) die "models list | pull <name> | verify" ;;
    esac ;;
  voice)
    case "${1:-list}" in
      design) [ $# -ge 3 ] || die 'voice design <name> "<description>"'; voice_design "$2" "$3" ;;
      clone) [ $# -ge 4 ] || die "voice clone <name> <wav> <transcript>"; voice_clone "$2" "$3" "$4" ;;
      list) ls "$VOICES" 2>/dev/null | sed -n 's/\.spk$//p' ;;
      remove) [ -n "${2:-}" ] || die "voice remove <name>"; voice_name_ok "$2"; run rm -f "$VOICES/$2".* ;;
      *) die "voice design | clone | list | remove" ;;
    esac ;;
esac
