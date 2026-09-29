#!/bin/sh
# Helena local AI: the embedding model on a server of its own. Since Halogen holds the GPU
# (native/halogen, docs/helena-decisions/halogen.md), Lemonade is stopped; the semantic search
# still needs Qwen3-Embedding-0.6B. This runs just that model (about 1 GB) in one llama-server
# from the pinned build install.sh made (/opt/helena-ai/llamacpp), on 127.0.0.1:13308 with the
# local AI key, under the name Lemonade served it with, so the vectors in the index stay valid.
#
#   sudo ./embed.sh status
#   sudo ./embed.sh [--dry-run] install        (writes and starts helena-embed.service)
#   sudo ./embed.sh [--dry-run] uninstall
#
# The model is models.tsv's `Qwen3-Embedding-0.6B-GGUF` (pinned commit and SHA-256): place it
# with `install.sh models pull Qwen3-Embedding-0.6B-GGUF` if it is missing (639 MB). Then point
# Helena at it: apps/api/src/scripts/local-ai-register.ts --embeddings (README.md).
set -eu
here=$(cd "$(dirname "$0")" && pwd)

NAME=Qwen3-Embedding-0.6B-GGUF
PORT=13308
# Two slots of 8,192 tokens each; an embedding needs its whole input in one micro-batch.
CTX=16384
UBATCH=8192
LLAMA_TAG=b11166
BACKEND=${HELENA_EMBED_BACKEND:-vulkan}
case "$BACKEND" in rocm|vulkan) ;; *) echo "embed.sh: HELENA_EMBED_BACKEND must be rocm or vulkan" >&2; exit 2 ;; esac
CATALOG=$here/models.tsv

R=${HELENA_AI_TEST_ROOT:-}
OPT=$R/opt/helena-ai
HUB=$R/var/lib/helena-ai/models/hub
KEY=$R/etc/helena/local-ai.key
UNIT=$R/etc/systemd/system/helena-embed.service

DRY_RUN=0
command=
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    status|install|uninstall|render) command=$1 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$command" ] || { sed -n '2,16p' "$0"; exit 2; }

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY_RUN" = 1 ]; then say "would: $*"; else "$@"; fi; }
die() { say "embed.sh: $*" >&2; exit 1; }
put() {
  if [ "$DRY_RUN" = 1 ]; then say "would write $1 (0644 root:root):"; sed 's/^/    /'; return; fi
  tmp=$(mktemp "$1.XXXXXX")
  cat > "$tmp"
  chmod 0644 "$tmp"
  mv "$tmp" "$1"
}
case "$command" in status|render) readonly_command=1 ;; *) readonly_command=0 ;; esac
[ "$(id -u)" = 0 ] || [ "$DRY_RUN" = 1 ] || [ "$readonly_command" = 1 ] || die "run as root"
[ -z "$R" ] || [ "$DRY_RUN" = 1 ] || [ "$readonly_command" = 1 ] || die "HELENA_AI_TEST_ROOT is for --dry-run only"

line=$(grep -v '^#' "$CATALOG" | awk -F '\t' -v n="$NAME" '$1 == n')
[ -n "$line" ] || die "$NAME is not in models.tsv"
REPO=$(printf '%s' "$line" | cut -f4)
COMMIT=$(printf '%s' "$line" | cut -f5)
FILE=$(printf '%s' "$line" | cut -f6)
BYTES=$(printf '%s' "$line" | cut -f7)
SUM=$(printf '%s' "$line" | cut -f9)
REPO_DIR=$HUB/models--$(printf '%s' "$REPO" | sed 's#/#--#')
MODEL=$REPO_DIR/snapshots/$COMMIT/$FILE
LLAMA=$OPT/llamacpp/$BACKEND-$LLAMA_TAG/llama-server

render_unit() {
  # The paths inside the unit are the machine's, never the test root's.
  sed -e "s#@LLAMA@#/opt/helena-ai/llamacpp/$BACKEND-$LLAMA_TAG/llama-server#g" \
    -e "s#@MODEL@#/var/lib/helena-ai/models/hub/models--$(printf '%s' "$REPO" | sed 's#/#--#')/snapshots/$COMMIT/$FILE#g" \
    -e "s#@ALIAS@#$NAME#g" -e "s#@PORT@#$PORT#g" -e "s#@CTX@#$CTX#g" -e "s#@UBATCH@#$UBATCH#g" \
    -e "s#@GPU_DEVICE@#$( [ "$BACKEND" = rocm ] && printf 'DeviceAllow=/dev/kfd rw' || true )#g" \
    -e "s#@ROCBLAS@#$( [ "$BACKEND" = rocm ] && printf 'Environment=ROCBLAS_USE_HIPBLASLT=1' || true )#g" \
    "$here/systemd/helena-embed.service.in"
}

model_ok() {
  blob=$REPO_DIR/blobs/$SUM
  [ -f "$blob" ] && [ "$(stat -c %s "$blob")" = "$BYTES" ] && [ "$(readlink -f "$MODEL" 2>/dev/null)" = "$(readlink -f "$blob")" ]
}

install_embed() {
  [ -x "$LLAMA" ] || [ "$DRY_RUN" = 1 ] || die "no llama-server at $LLAMA (install.sh install builds it)"
  [ -s "$KEY" ] || [ "$DRY_RUN" = 1 ] || die "no key at $KEY (install.sh install writes it)"
  getent passwd lemonade >/dev/null || [ "$DRY_RUN" = 1 ] || die "no user lemonade (install.sh install creates it with the package)"
  if model_ok; then say "have $NAME ($REPO @ ${COMMIT%${COMMIT#????????}})"; else
    [ "$DRY_RUN" = 1 ] || die "$NAME is missing: $here/install.sh models pull $NAME (639 MB)"
    say "would need: $here/install.sh models pull $NAME"
  fi
  render_unit | put "$UNIT"
  run systemctl daemon-reload
  run systemctl enable helena-embed.service
  run systemctl restart helena-embed.service
  if [ "$DRY_RUN" = 0 ]; then
    i=0
    until curl -fsS --max-time 3 -H "Authorization: Bearer $(cat "$KEY")" "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1; do
      i=$((i + 1)); [ $i -lt 60 ] || die "helena-embed did not answer on 127.0.0.1:$PORT"; sleep 1
    done
  fi
  say "Installed. Point Helena at it: apps/api/src/scripts/local-ai-register.ts --embeddings"
}

status() {
  enabled=$(systemctl is-enabled helena-embed 2>/dev/null) || true
  active=$(systemctl is-active helena-embed 2>/dev/null) || true
  say "unit:          ${enabled:-not installed}, ${active:-inactive}"
  say "model:         $(model_ok && echo "$NAME present" || echo "$NAME MISSING")"
  if [ -f "$UNIT" ]; then render_unit | cmp -s - "$UNIT" && say "unit file:     current" || say "unit file:     differs from this script (re-run install)"; fi
  if [ -r "$KEY" ]; then
    models=$(curl -fsS --max-time 3 -H "Authorization: Bearer $(cat "$KEY")" "http://127.0.0.1:$PORT/v1/models" 2>/dev/null || true)
    say "answers:       $([ -n "$models" ] && printf '%s' "$models" | python3 -c 'import json,sys; print(", ".join(m.get("id","?") for m in json.load(sys.stdin).get("data",[])))' 2>/dev/null || echo "no answer on 127.0.0.1:$PORT")"
  else
    say "answers:       (run as root to use the key)"
  fi
}

uninstall() {
  run systemctl disable --now helena-embed.service || true
  run rm -f "$UNIT"
  run systemctl daemon-reload
  say "Removed. The model stays in the store; Helena's search answers from full text until another embedding server is set."
}

case "$command" in
  status) status ;;
  install) install_embed ;;
  uninstall) uninstall ;;
  render) render_unit ;;
esac
