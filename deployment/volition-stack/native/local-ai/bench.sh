#!/bin/sh
# Helena local AI, the measurements behind the model choice (docs/helena-decisions/local-ai-platform.md
# §5, §7). Run in the maintenance window, after install.sh and `install.sh models pull`.
#
#   sudo ./bench.sh speed <name>              llama-bench of a models.tsv model on every installed
#                                             backend: ROCm (hipBLASLt off and on) and Vulkan;
#                                             pp512/pp8192/pp32768, tg128 empty and at 32k depth
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
KEY=/etc/helena/local-ai.key
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
    -p SupplementaryGroups="render video" -p MemoryMax=12G -p Nice=10 -p LimitMEMLOCK=infinity "$@"
}

# One llama-bench run, JSON out; $1 = label, $2 = binary folder, the rest = environment.
bench_run() {
  label=$1 bin=$2; shift 2
  json="$OUT/$name-$label-$stamp.json"
  say "== $name on $label → $json"
  # -fa on: flash attention (rocWMMA on ROCm, coopmat on Vulkan). -lm none: weights read into
  # VRAM without mmap, as Lemonade loads them (install.sh). -r 3: three repetitions, mean ± sd.
  # pp512/pp8192/pp32768 = prompt processing (what an agent's long context costs), tg128 =
  # generation empty and at 32k depth (a long session).
  bounded env "$@" "$bin/llama-bench" -m "$file" -ngl 99 -fa on -lm none -r 3 -o json \
    -p 512,8192,32768 -n 128 > "$json.0"
  bounded env "$@" "$bin/llama-bench" -m "$file" -ngl 99 -fa on -lm none -r 3 -o json \
    -p 0 -n 128 -d 32768 > "$json.1"
  python3 - "$json.0" "$json.1" > "$json" <<'PY'
import json, sys
rows = [r for f in sys.argv[1:] for r in json.load(open(f))]
for r in rows:
    test = f"pp{r['n_prompt']}" if r["n_prompt"] else f"tg{r['n_gen']}"
    if r.get("n_depth"): test += f"@d{r['n_depth']}"
    print(f"  {test:<12} {r['avg_ts']:9.1f} ± {r['stddev_ts']:.1f} tok/s", file=sys.stderr)
json.dump(rows, sys.stdout, indent=1)
PY
  rm -f "$json.0" "$json.1"
}

speed() {
  name=$1
  file=$(model_file "$name")
  rocm=$(ls -d "$OPT/llamacpp/rocm-"* 2>/dev/null | head -n 1)
  vulkan=$(ls -d "$OPT/llamacpp/vulkan-"* 2>/dev/null | head -n 1)
  # ROCBLAS_USE_HIPBLASLT: rocBLAS hands its GEMMs to hipBLASLt (0 = rocBLAS' own kernels).
  # llama.cpp uses them for the unquantized/large-batch products; the drop-in keeps the faster.
  [ -z "$rocm" ] || bench_run rocm "$rocm" ROCBLAS_USE_HIPBLASLT=0
  [ -z "$rocm" ] || bench_run rocm-hipblaslt "$rocm" ROCBLAS_USE_HIPBLASLT=1
  # Vulkan's prebuilt binaries find their libraries next to them.
  [ -z "$vulkan" ] || bench_run vulkan "$vulkan" LD_LIBRARY_PATH="$vulkan"
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
  speed) [ -n "${2:-}" ] || die "speed <name>"; speed "$2" ;;
  evals) [ -n "${2:-}" ] || die "evals <chat> [<embed>]"; evals "$2" "${3:-}" ;;
  parallel) [ -n "${3:-}" ] || die "parallel <gpu model> <npu model>"; parallel "$2" "$3" ;;
  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
