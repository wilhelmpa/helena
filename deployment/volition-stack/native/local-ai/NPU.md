# Small NPU models beside the GPU

`volition-npu` runs as `lemonade` with `HOME=/var/lib/lemonade` and the existing FLM model store.
It exposes the authenticated OpenAI endpoint `http://127.0.0.1:13306/v1`; port 13307 is the internal FLM endpoint.
The service allows `/dev/accel/accel0`, denies KFD and DRI, caps memory at 8 GiB and disallows swap.
The installer uses only installed binaries and models, preserves its key and model selection, and enables the guarded unit without starting it.
The key is `/etc/helena/volition-npu.key`, readable through `volition-plan-secrets`.
The isolation launcher forwards port 13306 through `/run/volition-agents/volition-npu.sock`.

## Profiles and API

`GET /god/local-ai/default` returns the two profiles and the durable operation.
The existing owner-only `POST /god/local-ai/default/preview` and `/apply` accept:

```json
{"model":"helena-local/Qwen3.8-27B-GGUF","profile":"local-27b-npu"}
```

Use the registered Halogen model with `profile: "local-halogen"` to stop the NPU.
`POST /god/local-ai/default/resume` with `{}` advances the journal; `{"rollback":true}` restores the previous pair and policy.
The API maintenance loop also resumes operations.
The profile picker and the background-role binding in the model-schema UI belong to Claude; this change only supplies the backend contract.

The host selects installed `qwen3.5:4b`, then `qwen3.5:2b`, with respective budgets of 7 and 5 GiB including embedding/context overhead.
Admission reserves 12 GiB for the application and voice services and 28 GiB for a newly loaded 27B GPU model.
It credits at most the managed Halogen's 72 GiB lock and rechecks actual available memory before GPU startup, after the GPU probe and again before FLM starts.
Insufficient memory or a failed NPU probe restores the previous profile through the same journal.
No 9B or 35B model is accepted.

Triage/classification, decisions and Embedding-Gemma embeddings are NPU candidates.
Every candidate remains off until its current operation's eval passes; previously disabled classes remain disabled.
Triage and decisions also run their existing production logprob evals with a five-second request timeout.
A failed class falls back through the existing configured/cloud path; a failed initial NPU probe restores the prior GPU profile.
Summaries, routines, reflection, helpers, voice and larger tasks remain on the GPU.
The NPU gateway limits output to 1024 tokens and rejects model changes, download paths and requests during maintenance.
CLI eval reports do not promote routes; the central operation persists and gates its own evals.

## Installation and verification (Claude, after integration)

Run from the integrated repository as root, with the API maintenance operation idle:

```sh
install -m 644 deployment/volition-stack/native/server/hostd/helena_host/model_server.py /usr/local/lib/helena/hostd/helena_host/model_server.py
systemctl try-restart helena-hostd.service
deployment/volition-stack/native/local-ai/npu-install.sh --dry-run install
deployment/volition-stack/native/local-ai/npu-install.sh install
systemd-run --wait --pipe --collect --unit=volition-npu-register -p User=volition-plan -p Group=volition -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan /usr/local/bin/bun apps/api/src/scripts/register-npu.ts
```

Integrate the changed `isolation/launcher.json` forwarding entry into the installed launcher configuration through its usual installer.
Apply the paired profile via the authenticated API, wait for phase `done`, and read the selected model from `maintenance.active.npu`.
Run the following with that model (`qwen3.5:2b` when selected instead), from a shell able to read both local model keys:

```sh
npu_model=qwen3.5:4b
out=/home/wilhelmpa/agent-work/codex-tasks/123b-npu-measurements
mkdir -p "$out"
python3 deployment/volition-stack/native/local-ai/npu-bench.py --npu-model "$npu_model" --gpu-key-file /etc/helena/local-ai.key --lock /home/wilhelmpa/agent-work/halogen-bench.lock --output "$out/parallel.json"
flock /home/wilhelmpa/agent-work/halogen-bench.lock /usr/local/bin/bun apps/api/src/scripts/local-ai-eval.ts --npu --base http://127.0.0.1:13306/v1 --key-file /etc/helena/volition-npu.key --model "$npu_model" --embed-model embed-gemma:300m --classes triage,decisions,embeddings --json "$out/classes.json"
systemctl show volition-npu.service -p User -p MemoryMax -p MemorySwapMax -p DevicePolicy -p DeviceAllow -p InaccessiblePaths
```

The benchmark records individual and parallel timings, GPU before/after latency, tokens per second and device file descriptors for every process in the service cgroup.
It fails if the NPU device is absent, KFD/DRI is open, or median GPU latency increases; repeat measurements only to investigate a measured regression.
Parallel measurements belong to the 27B profile; Halogen's profile keeps the NPU off.
Actual NPU execution, tool/readout compatibility and performance still require these hardware measurements.

For removal, switch back to the Halogen profile first, then run `npu-install.sh uninstall`; model files, keys and registration are retained.
