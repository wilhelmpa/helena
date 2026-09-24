#!/bin/sh
# Helena local AI, the measurements behind the model choice (docs/helena-decisions/local-ai-platform.md
# §5, §7). Run in the maintenance window, after install.sh and `install.sh models pull`.
#
#   sudo ./bench.sh speed <name> [--rocm]     llama-bench of a models.tsv model at 0, 32k and 64k
#                                             context (Vulkan; --rocm: the ROCm backend as well)
#   sudo ./bench.sh evals <chat> [<embed>]    the task-class evals through Lemonade (as the API
#                                             runs them), JSON next to the CSVs
#   sudo ./bench.sh parallel <gpu> <npu>      GPU and NPU generating at once: what each loses to
#                                             the shared memory bus
#
# Results: /var/lib/helena-ai/bench/. Every run is bounded (systemd-run MemoryMax, nice) so the
# live services keep their memory; nothing here changes the installation.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
OPT=/opt/helena-ai
MODELS=/var/lib/helena-ai/models
OUT=/var/lib/helena-ai/bench
KEY=/etc/helena-ai/api-key
CHECKOUT=${HELENA_CHECKOUT:-/srv/volition/source/plan}
PORT=13305
stamp=$(date +%Y%m%d-%H%M%S)

say() { printf '%s\n' "$*"; }
die() { say "bench.sh: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run as root"
mkdir -p "$OUT"

line() { grep -v '^#' "$here/models.tsv" | awk -F '\t' -v n="$1" '$1 == n'; }

# The first file of a models.tsv model, where install.sh placed it.
model_file() {
  l=$(line "$1"); [ -n "$l" ] || die "no model $1 in models.tsv"
  repo=$(echo "$l" | cut -f4) commit=$(echo "$l" | cut -f5) file=$(echo "$l" | cut -f6 | cut -d, -f1)
  path="$MODELS/hub/models--$(echo "$repo" | sed 's#/#--#')/snapshots/$commit/$file"
  [ -e "$path" ] || die "$1 is not pulled ($here/install.sh models pull $1)"
  printf '%s\n' "$path"
}

bounded() {
  systemd-run --wait --pipe --collect --quiet --uid=lemonade --gid=lemonade \
    -p SupplementaryGroups="render video" -p MemoryMax=8G -p Nice=10 -p LimitMEMLOCK=infinity "$@"
}

speed() {
  name=$1 rocm=${2:-}
  file=$(model_file "$name")
  for backend in vulkan $( [ "$rocm" = --rocm ] && echo rocm ); do
    bin=$(ls -d "$OPT/llamacpp/$backend-"* 2>/dev/null | head -n 1)
    [ -n "$bin" ] || { say "no $backend backend in $OPT/llamacpp"; continue; }
    csv="$OUT/$name-$backend-$stamp.csv"
    say "== $name on $backend (0 / 32k / 64k context) → $csv"
    # --mmap 0: the weights go to VRAM without passing through the page cache for long.
    bounded env LD_LIBRARY_PATH="$bin" "$bin/llama-bench" -m "$file" -ngl 99 -fa 1 --mmap 0 \
      -d 0,32768,65536 -p 512 -n 128 -r 2 -o csv > "$csv"
    awk -F, 'NR == 1 { for (i = 1; i <= NF; i++) h[$i] = i } NR > 1 { printf "  depth %-6s %-6s %8.1f tok/s\n", $h["\"n_depth\""], ($h["\"n_prompt\""] == "\"0\"" ? "tg" : "pp"), $h["\"avg_ts\""] }' "$csv" | tr -d '"'
  done
}

evals() {
  chat=$1 embed=${2:-}
  json="$OUT/evals-$chat-$stamp.json"
  say "== evals of $chat${embed:+ and $embed} through Lemonade → $json"
  # As the API's user: it reads the key (group volition-plan), and Bun runs the repository's
  # own eval code.
  set -- --base "http://127.0.0.1:$PORT/api/v1" --key-file "$KEY" --model "$chat" --json "$json"
  [ -z "$embed" ] || set -- "$@" --embed-model "$embed"
  (cd "$CHECKOUT" && sudo -u volition-plan -H /usr/local/bin/bun apps/api/src/scripts/local-ai-eval.ts "$@")
}

generate() {
  model=$1 tokens=$2
  curl -fsS --max-time 600 -H "Authorization: Bearer $(cat "$KEY")" -H 'content-type: application/json' \
    "http://127.0.0.1:$PORT/api/v1/chat/completions" \
    -d "{\"model\":\"$model\",\"max_tokens\":$tokens,\"temperature\":0,\"messages\":[{\"role\":\"user\",\"content\":\"Schreibe eine ausführliche Geschichte über einen Leuchtturm.\"}]}" |
    python3 -c 'import json,sys; d=json.load(sys.stdin); t=d.get("timings") or {}; u=d.get("usage") or {}; print(t.get("predicted_per_second") or u.get("completion_tokens"))'
}

parallel() {
  gpu=$1 npu=$2
  say "== $gpu (GPU) alone"; a=$(generate "$gpu" 256)
  say "== $npu (NPU) alone"; b=$(generate "$npu" 256)
  say "== both at once"
  generate "$gpu" 256 > "$OUT/par-gpu-$stamp" & p=$!
  generate "$npu" 256 > "$OUT/par-npu-$stamp"
  wait "$p"
  say "GPU alone: $a tok/s, together: $(cat "$OUT/par-gpu-$stamp") tok/s"
  say "NPU alone: $b tok/s, together: $(cat "$OUT/par-npu-$stamp") tok/s"
  say "(Numbers are tok/s where the server reports timings, else the token count.)"
}

case "${1:-}" in
  speed) [ -n "${2:-}" ] || die "speed <name>"; speed "$2" "${3:-}" ;;
  evals) [ -n "${2:-}" ] || die "evals <chat> [<embed>]"; evals "$2" "${3:-}" ;;
  parallel) [ -n "${3:-}" ] || die "parallel <gpu model> <npu model>"; parallel "$2" "$3" ;;
  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
