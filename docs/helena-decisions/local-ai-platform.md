# Decision: local AI on Kingston (Strix Halo), and how Helena uses it

Status: accepted for the platform and the Helena integration; the model choice per task class is
decided by the evals in the maintenance window (§5, §7). Date: 2026-09-24. Branch: `hub/local-ai`.
Supersedes the platform parts of `local-models-strix-halo.md` (which assumed a separate Strix Halo
box on Ubuntu). Its analysis of Jev, Laya and the browser fast path stays valid and is owned by
hub/browser-task.

## 0. Kurzfassung (für den Owner)

- **Kingston ist der Strix Halo.** Die lokale KI läuft auf demselben Rechner wie Helena, als
  optionaler Dienst neben Helena: GPU (96 GiB VRAM), NPU und CPU gleichzeitig.
- **Kernel:** Debian-Backports-Kernel **7.1.8** mit Firmware **20260810**. Er bringt den NPU-Treiber
  (amdxdna) und die ROCm-Fixes für die GPU. Der Testboot geht über den einmaligen UEFI-`BootNext`:
  Auf dem RAID kann GRUB sich selbst nichts merken, `grub-reboot` hätte dort eine Bootschleife
  riskiert. Fällt 7.1.8 aus, startet der Rechner beim nächsten Reset von selbst wieder mit 6.12.
- **Ein Endpunkt:** Lemonade Server (AMD, Apache-2.0) auf `127.0.0.1:13305`, mit Schlüssel und ohne
  eigene Downloads. Darunter llama.cpp auf der GPU (Vulkan, ROCm optional) und FastFlowLM auf der
  NPU. **ROCm** kommt ohne Systeminstallation aus: Lemonades eigenes ROCm-llama.cpp bringt es mit,
  PyTorch-ROCm für Laya ebenfalls. AMDs ROCm 10.0 für Debian 13 bleibt eine Option für später.
- **Modelle:** Arbeitspferd **Qwen3.6-35B-A3B** (MoE, schnell, beste Werkzeug- und Deutsch-Werte
  seiner Klasse), schweres Modell **Qwen3.8-27B** (bestes Deutsch, nachts), dazu im Vergleich
  **gpt-oss-120b** und **Mistral Small 4**. Embeddings mit **Qwen3-Embedding-0.6B**, auf der NPU
  **Whisper V3 Turbo** und **Qwen3.5-2B** als Router. Die Auswertungen im Wartungsfenster
  entscheiden; wer verliert, wird wieder gelöscht.
- **In Helena:** Lokale Modelle stehen in jeder Modellauswahl (markiert „lokal“, Preis 0), solange
  die lokale KI an ist. Die Karte „Lokale KI“ hat einen Hauptschalter, Schalter je Einheit (GPU,
  NPU, CPU) und je Art von Arbeit, und einen eigenen Schalter „Jev / Laya (experimentell)“.
  **Lokale KI ersetzt nie ein eingestelltes Modell:** Sie wird zuerst versucht, und das eingestellte
  Modell antwortet, sobald sie aus, nicht erreichbar, zu langsam oder falsch ist. Hauptschalter aus
  heißt: alles sofort wie heute, keine lokale Konfiguration bleibt in den Agentenprofilen.
- **Eine Art von Arbeit lässt sich erst einschalten, wenn ihre Auswertung bestanden ist.** Die
  Auswertungen sind feste Fälle mit prüfbaren Antworten (richtiges Werkzeug, Fakten behalten,
  richtige Kategorie, richtiges Dokument), meist auf Deutsch.

## 1. The machine (verified 2026-09-24)

| | |
|---|---|
| Board | Bosgame M5 (Sixunited AXB35-02), AMD Ryzen AI Max+ 395, Radeon 8060S (gfx1151, 1002:1586), XDNA2 NPU (1022:17f0 rev 0x11) |
| Memory | 128 GB; BIOS carve-out 96 GiB VRAM (owner's choice, stays); the OS sees ~31 GB (Helena, Postgres, agents, 5 Chromium) |
| OS | Debian 13.7, kernel 6.12.107+deb13-amd64, grub 2.12, shim 16.1, Secure Boot off |
| Root | mdadm RAID 1 `/dev/md/helena-root` (ext4 7a3b588b-…); ESPs `/boot/efi` + `/boot/efi2` kept equal by `99helena-esp-sync`; firmware entries "Debian" and "Debian (Reserve)"; cmdline `panic=30` |
| GPU stack | mesa 25.0.7 (RADV gfx1151 works), firmware-amd-graphics 20250410-2, amdgpu loaded, no `/dev/accel` (6.12 has no amdxdna) |
| IOMMU | **on** (`iommu: Default domain type: Translated`, `/sys/class/iommu/ivhd0`). The NPU needs it; nothing to change in the BIOS |
| memlock | 8192 KiB (FastFlowLM needs unlimited: set per service) |
| `render` group | **empty**; `wilhelmpa` is not a member (not changed). `/dev/dri/renderD128` is `root:render 0660` |

**Measured on the current kernel (6.12, mesa 25.0.7), as `wilhelmpa` with the render group for
the process only (`sudo -u wilhelmpa -g render`), llama.cpp b11166 Vulkan, Qwen3-0.6B Q8_0 (604 MiB):**

| | pp512 | pp2048 | tg128 |
|---|---|---|---|
| GPU (RADV GFX1151, KHR_coopmat, 114,172 MiB visible = VRAM + GTT) | 13,157 t/s | 10,768 t/s | 268 t/s |
| CPU (8 threads, Zen 5, no GPU) | 987 t/s | – | 104 t/s (tg64) |

llama-server with `--jinja` answered an OpenAI tool call correctly (`get_weather{"city":"Berlin"}`,
248 t/s, 0.44 s) and refused a request without the key (401). The evals of §7 ran end to end
against Qwen3-0.6B (chat) and Qwen3-Embedding-0.6B (embeddings) through the same code Helena runs;
results in §7.3. GPU inference therefore works today; the kernel upgrade is for the NPU and ROCm.

## 2. Kernel and firmware

| Option | Verdict |
|---|---|
| **trixie-backports `linux-image-7.1.8+deb13-amd64` 7.1.8-1~bpo13+1** | **Chosen.** Signed Debian build; `CONFIG_DRM_ACCEL_AMDXDNA=m` (the module ships in `linux-modules-7.1.8+deb13-amd64`); has both KFD fixes ROCm needs on gfx1151 and `apu_prefer_gtt`; the 7.x amdxdna loads `npu_7.sbin` (protocol 7) first. Security updates through backports. |
| Stay on 6.12.107 | Rejected for the NPU (no amdxdna; it came in 6.14). GPU inference works, and 6.12.64+ carries the two KFD fixes, but AMD lists < 6.18.4 as unsupported for ROCm 7.2+ on Strix Halo. |
| `amdxdna-dkms` (Ubuntu PPA) | Rejected: Ubuntu-only packages, an out-of-tree driver to rebuild on every kernel. |
| The owner's CachyOS 6.18.5 config (`~/Projekte/Linux/Kernel_Configs`) | Rejected as the running kernel: a self-built kernel gets no security updates from Debian, and 6.18.y has an IOMMU-SVA regression that breaks amdxdna. |

Packages (all from trixie-backports, installed at exact versions, backports otherwise at priority 1):

| Package | Version | Download | Installed |
|---|---|---|---|
| `linux-image-7.1.8+deb13-amd64` (+ `linux-base-…`, `linux-binary-…`, `linux-modules-…`) | 7.1.8-1~bpo13+1 | 173.5 MB | 168 MiB |
| `linux-headers-7.1.8+deb13-amd64` (+ `-common`, `linux-kbuild-7.1.8+deb13`) | same | 14.3 MB | 73 MiB |
| `firmware-amd-graphics` | 20260810-1~bpo13+1 | 16.0 MB | 93 MiB |

- License: GPL-2.0 (kernel), firmware redistributable non-free (the Debian package).
- The new firmware carries `amdnpu/17f0_11/npu_7.sbin` → 1.1.2.65 (FastFlowLM needs ≥ 1.1.0.0; trixie's
  20250410 has only 1.0.0.166) and the GC 11.5.1 blobs of 2026-02/05/08 (MES fixes).
- **The firmware package serves both kernels.** A rollback of the GPU firmware therefore needs
  the old package: `kernel.sh install` saves `firmware-amd-graphics_20250410-2` first.
- `firmware-misc-nonfree` is not needed (amdnpu is in `firmware-amd-graphics`); `xrt-xocl-dkms`
  is the Alveo FPGA driver, **not** for the NPU (not installed).
- **Why no meta package:** `linux-image-amd64` stays on trixie (the 6.12 line and its security
  updates remain the fallback). A newer backports kernel is an owner decision: the update source
  (§9) reports it, and `kernel.sh` with new pins repeats the trial.

## 3. The test boot (why not `grub-reboot`)

`/boot/grub` lives on the md RAID. GRUB 2.12 reads its environment block there but cannot write
it ("diskfilter writes are not supported"), so `grub-reboot`'s `next_entry` would never be cleared:
every later boot, a `panic=30` reboot included, would take the new kernel again (a boot loop on a
broken kernel). `kernel.sh` instead:

1. `prepare`: `GRUB_DEFAULT=saved`, `grub-set-default` to the running 6.12 entry by id
   (`gnulinux-advanced-<uuid>>gnulinux-6.12.107+deb13-amd64-advanced-<uuid>`, read from grub.cfg),
   so installing 7.1.8 (newest = entry 0) never changes what boots.
2. `trial`: a second loader directory `\EFI\helena-ktest\` on ESP-A (copies of shim, grub, mm) whose
   grub.cfg sources the normal grub.cfg and only sets `default` to 7.1.8; a UEFI entry
   "Debian (Kernel-Test)" created **outside** BootOrder (`efibootmgr -C`), and `BootNext` to it.
   The firmware clears `BootNext` before it boots, so any following reset is the normal "Debian"
   entry with 6.12 as GRUB's saved default. No environment block is written.
3. `verify` → `promote` (`grub-set-default` 7.1.8, trial entry removed) or `rollback`.

Tested against a stub root (`tests/test_kernel.py`, 7 cases) and in dry-run against Kingston's
real grub.cfg (entry ids resolved correctly).

**DKMS:** none installed today (`dkms` absent). hub/server-admin adds `ec_su_axb35` and
`ryzen_smu` (DKMS, pinned). Order: kernel promoted first, then the fan installer builds them for
7.1.8; `kernel.sh dkms` builds every registered module for every installed kernel, so 6.12 keeps
fan control too. `kernel.sh verify` checks both kernels. If a module does not build on 7.1, the
fans stay on the EC's own control (safe); hub/server-admin's installer only builds for the running
kernel today (`dkms install` without `-k`) — reported to the orchestrator, not changed there.

## 4. The runtime stack

### 4.1 One endpoint: Lemonade Server

| | |
|---|---|
| Choice | **Lemonade Server 2026.39.1** (AMD, Apache-2.0), `lemonade-server_2026.39.1-debian13_amd64.deb`, 3,876,824 B, sha256 `cf68457d…d7e227` |
| Why | One OpenAI-compatible API (`/api/v1/chat/completions`, `/embeddings`, `/audio/*`, `/responses`) over llama.cpp (GPU), FastFlowLM (NPU) and whisper.cpp; model LRU; `/health` names every loaded model with its device; `/system-stats` gives GPU/NPU/CPU load; Debian 13 package |
| Rejected | Ollama (no NPU), bare llama-server per model (no LRU, one port per model), vLLM (experimental on gfx1151, only worth it at high concurrency) |
| Service | the package's `lemond.service` (user `lemonade`) with Helena's drop-in: `127.0.0.1:13305` only (`--host/--port` flags win over any config), `LEMONADE_API_KEY` from a systemd credential (`/etc/helena/local-ai.key`, root:volition-plan 0640), `IPAddressDeny=any` + `IPAddressAllow=localhost`, `ProtectSystem=strict`, `MemoryMax=12G`, `LimitMEMLOCK=infinity`, render/video groups |
| Config | `LEMONADE_DEFAULTS_PATH` file: `offline`, `no_fetch_executables`, no broadcast, no update checks, telemetry off, `max_loaded_models: 4`, pinned backend paths, `llamacpp.args: --no-mmap` (weights go to VRAM instead of sitting in the 31 GB page cache) |
| Depends | `libcpp-httplib0.41` 0.41.0+ds-3~bpo13+1 (backports) |

### 4.2 llama.cpp backends

- **Vulkan (default):** `llama-b10825-bin-ubuntu-vulkan-x64.tar.gz` (the build Lemonade pins),
  33,804,455 B, sha256 `4d0f4e35…5e447de5`, MIT. Best decode speed on Strix Halo.
- **ROCm (optional, `--rocm-backend`):** `lemonade-sdk/llamacpp-rocm` b1324 gfx1151 build with its
  own ROCm runtime inside, 397,076,324 B, sha256 `eced287d…6848eb0`, MIT. Faster prefill on some
  models; per model the bench decides (`models load` saves the backend with the model).
- Lemonade verifies no backend download itself; `install.sh` does (SHA-256) and points Lemonade at
  the extracted paths.

### 4.3 ROCm (the owner: "ROCm brauchen wir ohnehin")

| Option | Verdict |
|---|---|
| **No system ROCm; ROCm inside the consumers** (the llama.cpp ROCm build above, PyTorch's gfx1151 wheels for Laya) | **Chosen for now.** Nothing in `/opt/rocm` to keep in step; each consumer pins its runtime; needs only kernel 7.1.8 + render/video. |
| AMD ROCm 10.0.0 for Debian 13 (`stable.repo.amd.com/rocm/core/packages/debian13/`, `amdrocm10.0-gfx1151`: ~675 MB download, 5.6 GB installed, inbox driver) | Ready as the next step when a workload needs a shared runtime (vLLM, ComfyUI, own builds). Not validated by AMD for gfx1151 on Debian (the matrix lists Ubuntu 26.04/24.04.4 for Ryzen APUs). An `install.sh --system-rocm` is not built yet. |
| repo.radeon.com apt (7.0–7.2) | Rejected: jammy/noble only. |
| Debian's own ROCm (HIP 5.7) | Rejected: too old for gfx1151. |

### 4.4 Vulkan driver

mesa 25.0.7 (trixie) runs gfx1151 (measured, §1). trixie-backports has **mesa 26.1.6-1~bpo13+1**
with much better RADV performance on Strix Halo; it touches the whole graphics stack (libllvm19,
libdrm), so it is a separate, measured step after the kernel: run `bench.sh speed` before and
after. Not part of `install.sh` yet.

### 4.5 NPU: FastFlowLM + XRT

- **FastFlowLM 1.0.6** `fastflowlm_1.0.6_debian13_amd64.deb`, 43,776,040 B, sha256 `318e00f4…377142`,
  built on Debian 13 against backports XRT; Lemonade uses it with `flm.prefer_system: true`
  (Lemonade 2026.39.1 would otherwise fetch 1.0.5 itself).
- **XRT 2.25** from backports at `1:2.25.0-4~bpo13+1`: `libxrt2` (2.1 MB), `libxrt-npu2` (1.3 MB, the
  amdxdna plugin), `libxrt-utils` + `-npu` (`xrt-smi`, 2.7 MB).
- Needs: kernel ≥ 7.0 with amdxdna, NPU firmware ≥ 1.1.0.0, memlock unlimited (drop-in), IOMMU on
  (it is; never `amd_iommu=off`, which also disables the NPU).
- **License:** runtime MIT; the NPU kernels are proprietary binaries ("free for any use" in the
  README, a USD 10 M threshold still in `TERMS.md`). Never part of Helena's image; installed by
  the owner as a host service; "Powered by FastFlowLM" in the docs.
- NPU models live in system RAM (not VRAM): budget ~6 GB (§5.3).

### 4.6 PyTorch-ROCm for Laya (hub/browser-task's installer)

`native/laya/install.sh` lives on hub/browser-task (not merged at writing). The `--rocm` option to
add there, instead of a second installer:

```diff
+ROCM=0; [ "${2:-}" = --rocm ] && ROCM=1
-TORCH_INDEX=https://download.pytorch.org/whl/cpu
+TORCH_INDEX=https://download.pytorch.org/whl/cpu
+TORCH_SPEC="torch==$TORCH_VERSION"
+if [ "$ROCM" = 1 ]; then
+  [ -e /dev/kfd ] || die "no /dev/kfd: boot kernel 7.1.8 first (native/local-ai/kernel.sh)"
+  TORCH_INDEX=https://stable.repo.amd.com/rocm/whl-next/
+  TORCH_SPEC="torch[device-gfx1151]==2.13.0+rocm10.0.0"
+fi
-  uv pip install -q --python "$PREFIX/venv/bin/python" --index-url "$TORCH_INDEX" "torch==$TORCH_VERSION"
+  uv pip install -q --python "$PREFIX/venv/bin/python" --index-url "$TORCH_INDEX" "$TORCH_SPEC"
+  if [ "$ROCM" = 1 ]; then
+    install -d /etc/systemd/system/helena-laya.service.d
+    cat > /etc/systemd/system/helena-laya.service.d/rocm.conf <<EOF
+[Service]
+Environment=HELENA_LAYA_DEVICE=cuda
+PrivateDevices=no
+DevicePolicy=closed
+DeviceAllow=/dev/kfd rw
+DeviceAllow=/dev/dri/renderD128 rw
+SupplementaryGroups=render video
+MemoryHigh=6G
+MemoryMax=8G
+EOF
+  fi
```

and in `helena_laya_serve.py`: `device = os.environ.get("HELENA_LAYA_DEVICE", "cpu")`, falling
back to `"cpu"` when `torch.cuda.is_available()` is false (ROCm's PyTorch uses the `cuda` device
name). Download ≈ 1 GB (torch 202.6 MB, `amd_torch_device_gfx1151` 50.1 MB, rocm-sdk core 414.7 MB,
libraries 143.3 MB, device-gfx1151 173.7 MB; Python 3.13 wheels exist). PyTorch.org's own
`rocm7.2` wheel (6.2 GB, all architectures) is rejected for size. Laya on the GPU is untested
upstream; the CPU path stays the default until `bench` shows the GPU is faster per decision.

## 5. Models

### 5.1 What the evidence says (late September 2026)

GPU tier, llama.cpp on Strix Halo (local-llm-benchmarks.dev, kyuz0, slb350 strix-benchmarks,
Terminal-Bench-mini on Strix Halo, EuroEval German, vendor cards; details in the research notes
of this branch):

| Model | License | GGUF | pp / tg at 0 → 64k (t/s) | Agentic / tools | German (EuroEval rank) |
|---|---|---|---|---|---|
| **Qwen3.6-35B-A3B** (MTP) | Apache-2.0 | UD-Q4_K_XL 22.9 GB (+ mmproj 0.9 GB) | Vulkan pp 1750 → 535, tg 60.9 → 43.5; MTP tg 77.6 → 76.3 | TAU3 67.2, MCP-Atlas 62.8, TBM 0.58, tooling 53.5/65 | 3.5 sibling #5 |
| **Qwen3.8-27B** (dense) | Apache-2.0 | UD-Q4_K_XL 17.6 GB (+ mmproj) | ROCm pp 386 → 101, tg 11.6 → 9.5; MTP tg 22.4 → 18.5 | TBM 0.947, tooling 62.5, TB2.1 73.0 | **#4, best that fits** |
| gpt-oss-120b | Apache-2.0 | MXFP4 63.4 GB | RADV pp 720 → 146, tg 56.6 → 35.0 | combined 190; MMMLU 78.2 | #9 |
| Mistral Small 4 119B-A6B | Apache-2.0 | UD-Q4_K_XL 75.0 GB (3 files) + mmproj | pp 363, tg 40.3 | combined 184 (weak) | – |
| Gemma-4-26B-A4B | Apache-2.0 | 17.0 GB | pp 1325 → 470, tg 54.7 → 37.5 | tau2 68.2, strict JSON best, prompt-injection prone | #8 |

Ruled out: GLM-5.3-Flash (≥ 86.7 GiB), DeepSeek-V4-Flash (IQ2 only, exclusive), Qwen3.8-Flash-Next
(qwen-community licence, not OSI), Nemotron 3 Super (NVIDIA licence, 14 t/s).

### 5.2 Plan (to be confirmed by §7's evals on Kingston)

| Role | Model | Resident? | VRAM incl. KV |
|---|---|---|---|
| **Workhorse** (helpers, summaries, routines, coordinator first pass) | Qwen3.6-35B-A3B-MTP UD-Q4_K_XL + mmproj, 4 slots × 64k | kept loaded | ≈ 27 GiB (KV ≈ 20 KiB/token) |
| **Heavy** (nightly reflection, hard summaries) | Qwen3.8-27B UD-Q4_K_XL, 128k | on demand (LRU) | ≈ 26 GiB |
| Embeddings | Qwen3-Embedding-0.6B Q8_0 (1024 dims) | kept loaded | ≈ 0.7 GiB |
| Comparison only | gpt-oss-120b (63.4 GB), Mistral Small 4 (75 GB) | exclusive, during the evals | ≤ 80 GiB, alone |
| **Sum in normal operation** | | | **≈ 54 GiB of 96**, room for the ROCm/Laya experiments |

Mistral Small 4 and gpt-oss-120b cannot stay next to the workhorse with useful context; they are
measured alone and only win if they beat the workhorse clearly on the evals (then they replace it
and run alone). The caveat of the MTP build (`--mmproj` with `-np > 1` not yet supported) is
checked in the bench; the non-MTP repo is pinned as the fallback workhorse.

### 5.3 NPU (system RAM, budget ~6 GB)

| Model (Lemonade name) | Use | Size | License |
|---|---|---|---|
| `whisper-v3-turbo-FLM` | transcription | 0.65 GB | MIT |
| `qwen3.5-2b-FLM` | router / classifier (thinking off) | 3.1 GB (≈ 3.5 GB RSS) | Apache-2.0 |
| `embed-gemma-300m-FLM` | comparison only | 0.6 GB | **Gemma terms (not OSI)**: not the default |

≈ 5 GB RSS together. Whether three FLM processes share the NPU is checked in the bench
(FLM itself can serve LLM + ASR + embeddings in one process).

### 5.4 One embedding model

**Qwen3-Embedding-0.6B** (Apache-2.0, 1024 dims, reducible by MRL, 32k context, multilingual MTEB
64.3) on the GPU, for every index that uses local AI. It fits pgvector's HNSW limit (2,000 dims)
and hub/second-brain's `real[]` path. hub/second-brain's in-process default
(granite-embedding-97m, 384 dims) stays for installations without local AI; the vectors of the two
are separate spaces (the stored model id tells), so switching re-embeds. EmbeddingGemma is
excluded as the default for its licence (second-brain did the same). Upgrade path:
microsoft/harrier-oss-v1-0.6b (MIT, MTEB 69.0) after a German retrieval test.

### 5.5 Downloads (owner OK 2026-09-24 ~23:55: "triff du die richtige Auswahl")

All pinned in `native/local-ai/models.tsv` (commit + SHA-256 of every file):

| Model | Repository @ commit | Size |
|---|---|---|
| Qwen3.6-35B-A3B-MTP-GGUF | unsloth/Qwen3.6-35B-A3B-MTP-GGUF @ 5bc3e238 | 23.8 GB |
| Qwen3.6-35B-A3B-GGUF (fallback) | unsloth/Qwen3.6-35B-A3B-GGUF @ a483e9e6 | 23.3 GB |
| Qwen3.8-27B-GGUF | unsloth/Qwen3.8-27B-GGUF @ 4ca72078 | 18.5 GB |
| gpt-oss-120b-mxfp-GGUF | ggml-org/gpt-oss-120b-GGUF @ 238abdd2 | 63.4 GB |
| user.Mistral-Small-4-119B-GGUF | unsloth/Mistral-Small-4-119B-2603-GGUF @ bd93c721 | 75.0 GB |
| Qwen3-Embedding-0.6B-GGUF | Qwen/Qwen3-Embedding-0.6B-GGUF @ 370f27d7 | 0.6 GB |
| whisper-v3-turbo-FLM, qwen3.5-2b-FLM, embed-gemma-300m-FLM | FastFlowLM/*-NPU2 (pulled by FLM, checked after) | 0.65 / 3.1 / 0.6 GB |
| Qwen3-0.6B-GGUF (smoke test) | unsloth/Qwen3-0.6B-GGUF @ 50968a44 | 0.4 GB |

Plus the software: kernel 188 MB, firmware 16 MB, XRT 5 MB, Lemonade 3.9 MB, FastFlowLM 44 MB,
llama.cpp Vulkan 34 MB, ROCm build 397 MB, PyTorch-ROCm for Laya ≈ 1 GB. Losers are deleted after
the evals. Timing: only in the maintenance window (a 60–75 GB read now would thrash the page cache
of the live system).

## 6. Helena integration

### 6.1 Extension points (framework, §3a)

Two new registries in `@helena/sdk` (`local-ai.ts`), registered by the internal plugin
`helena.local-ai` like a plugin's would be:

- **`modelServers`** (`ModelServerType`): how Helena lists a server's models and reads its status.
  Built in: `lemonade` (models with engine, unit, abilities; loaded models with their device; GPU,
  NPU, CPU load) and `openai-compatible` (any server's `/models`). A plugin can add vLLM, Ollama,
  a LAN box.
- **`localAiTaskClasses`** (`LocalAiTaskClass`): a kind of work local AI may take, its default unit,
  the ability its model needs, its priority, whether it is experimental or wired, and its eval.

Data: `helena_model_server` (servers, last models and status), `helena_local_ai_eval` (every eval
run) — migration `0176_helena_local_ai` (renumber on merge); the policy is one `app_setting`
(`localAi.policy`). The key is never stored in a table: a key file below `/etc/helena` (the
installer's; any other path is refused, so no setting can make Helena send another file's
content) or the Administrator's key encrypted in `app_secret`.

### 6.2 Model ids and providers

A local model is `helena-<slug>/<model>` (`helena-local/Qwen3.6-35B-A3B-MTP-GGUF`): never confused
with a subscription model, and the runner knows the provider without a catalog. For Hermes the
server is a **named provider** `providers.helena-<slug>` (`base_url`, `key_env`,
`transport: chat_completions`, `context_length ≥ 65536`, the model list, `discover_models: false`),
written by the runner's profile contribution `local-ai` into the **managed** configuration
(`HERMES_MANAGED_DIR`; never the shared config.yaml, which is a symlink). A run on a local model
starts `hermes --provider helena-local --model <model>`. The key reaches the agent as
`HELENA_MODEL_SERVER_KEY_<SLUG>`, read before each run and chat answer from
`GET /agent-runtime/model-server-keys` (like the MCP secrets).

### 6.3 Never replace a configured model

- **Master switch off** (default): the runtime snapshot carries no `localAi` → the runner rewrites
  every profile without it (the snapshot revision changes); the pickers list no local model; the
  key route answers `{}`; a run or chat whose model is a local id is handed the agent default
  (`model: null`), exactly as without local AI.
- **Explicit choice:** with local AI on, local models appear in every Hermes agent's picker and the
  team template picker, marked "lokal" under the heading "Lokale KI". An agent the owner sets to
  one runs on it; Hermes' `fallback_providers` (the owner's fallback models) take over when the
  server fails.
- **Helper calls** (task class `hermes-helpers`, wired): `auxiliary.compression` and, with a vision
  model, `auxiliary.vision` point at the local model with `fallback_chain: [{provider: main}]` —
  the agent's own model answers whenever the local one fails. Session titles stay off (Helena's
  profiles never pay for them, `learning.ts`).
- **Embeddings** (wired): the knowledge index uses the local embedding model while the class is on
  (`useEmbeddingRoute`, API and worker). While the server is down the same model stays chosen
  (other vectors are another space): search answers from full text, the indexer retries.
- **Which model answered** is on every run already (the model check: configured vs used, with
  the provider); a local provider reads "lokal".
- Price: `price()` answers 0 for a local provider or id (`source: 'local'`), so budgets and the
  usage ledger count local tokens at nothing; the card shows the local share of tokens.
- Availability: the existing `helena_model_availability` applies unchanged (runtime `hermes`,
  provider `helena-local`), so a local model the server refuses leaves the pickers like any other.

### 6.4 Isolated agents

Agent units have their own network namespace (`PrivateNetwork`). `launcher.json` gets a third
forward, `localai: 13305` → `/run/volition-agents/helena-ai.sock`, listed in the new
`optionalSockets` (bound with `-`: a machine without local AI starts its agents as before). The
socket is `helena-ai-proxy.socket` + systemd's own `systemd-socket-proxyd` (no new code), group
`volition-agents`, mode 0660, to Lemonade on the host's loopback. So `http://127.0.0.1:13305` is
the same address inside and outside a unit. Tests: `isolation/tests/test_isolation.py`
(optional bind, core sockets still required, invalid `optionalSockets` refused).

### 6.5 Codex and Claude Code

Not wired yet (the pickers offer local models to Hermes agents only). Codex: a
`model_providers.helena-local` entry (`wire_api = "responses"`; Lemonade serves `/v1/responses`)
through the runner's Codex arguments; Claude Code: `ANTHROPIC_BASE_URL` to Lemonade's
`/v1/messages` (first version, simple tools) — experimental only. Both after the evals show a local
model worth it.

## 7. The policy ("Lokale KI")

### 7.1 Task classes

| Class | Default unit | Needs | Wired | Eval (threshold) | In the master's first set |
|---|---|---|---|---|---|
| `embeddings` | NPU/GPU | embeddings | **yes** | retrieval top-1, 10 DE/EN questions (0.8) | yes |
| `hermes-helpers` | GPU | chat | **yes** | compression keeps every fact, 3 cases (0.75) | yes |
| `summaries` (digests, run/activity/mail summaries, briefings) | GPU | chat | planned | German JSON summaries with every fact, 4 cases (0.75) | yes |
| `triage` (classification, routing) | NPU | chat | planned | 16 labels DE/EN (0.85) | yes |
| `transcription` (dictation, voice mode) | NPU | transcription | planned | – | yes |
| `routines` (routine agents, local-first) | GPU | tools | planned | right tool + arguments, 8 cases (0.9) | no |
| `reflection` (nightly, heavy model) | GPU | chat | planned | as summaries (0.85) | no |
| `coordinator-triage` (first pass, escalates) | GPU | tools | planned | as routines (0.9) | no |

Modes: **Aus** · **Lokal bevorzugt** (local first, the configured model on failure) · **Nur lokal**
(for work that must not leave the machine). A class leaves "Aus" only when it is wired and the
newest eval of its model passed (the API answers 409 otherwise). Presets: **Sparsam** (everything
that passed), **Ausgewogen** (helpers, embeddings, summaries, triage, transcription), **Qualität**
(embeddings and transcription only), **Eigene**. The master switch's first "on" applies the first
set, as far as its evals passed. Units can be switched off one by one (a class whose model runs on
a switched-off unit falls back).

**Real work stays on Claude/Codex:** coding, long agent tasks, the Home master, interactive chats,
anything with side effects outside Helena — unless the owner picks a local model for an agent.

**Planned classes and their wiring** (next steps, one per branch merge, each only after its eval
numbers): `summaries` → the update-center digest run (hub/update-center picks its "small model";
a local id there with the digest's current model as fallback); `routines` and `coordinator-triage`
→ per-run local-first: `agent_run.work_class` set by the engine, the claim hands a local model with
`localFallback`, and the runner starts Hermes with a second managed directory that adds
`fallback_providers: [configured model, …]` (the normal one stays untouched); `transcription` →
the chat's dictation posts audio to `/audio/transcriptions` instead of the browser's speech API
(which needs HTTPS); `triage` → an engine step type "Einordnen" on the router model.

### 7.2 Evals (the harness)

`apps/api/src/modules/local-ai/evals.ts`: fixed cases with answers a program checks (no model
judges a model), mostly German, run in the API ("Auswerten" per class and model; results in
`helena_local_ai_eval` with score, median latency, tokens/s and the failed cases) or from the
command line against any server (`apps/api/src/scripts/local-ai-eval.ts`, used by `bench.sh evals`).

### 7.3 Harness proven with the tiny models (Kingston, 2026-09-24, llama.cpp b11166 Vulkan)

| Class | Model | Score / threshold | Median latency | tok/s |
|---|---|---|---|---|
| hermes-helpers (3 compressions) | Qwen3-0.6B Q8_0 | 0.67 / 0.75 failed (c2 lost "02:00") | 1296 ms | 201 |
| summaries | Qwen3-0.6B | 0.50 / 0.75 failed (lost `gpt-6-terra`, "Redundanz") | 1489 ms | 200 |
| triage | Qwen3-0.6B | 0.69 / 0.85 failed (questions read as ops) | 647 ms | 192 |
| routines | Qwen3-0.6B | 0.88 / 0.9 failed (project `PRIV` missed once) | 646 ms | 209 |
| embeddings | Qwen3-Embedding-0.6B Q8_0 | 0.90 / 0.8 passed (q2 "return policy days" missed) | 154 ms | – |

As intended, a 0.6B model fails the real work and the harness says where. The full evals on the
candidates of §5 run in the maintenance window (`bench.sh evals`), and their numbers replace this
table.

### 7.4 Scheduling and priorities

Interactive (a person waits) > browser steps > background > nightly batch. Today Lemonade runs each
llama-server with `--parallel 1` (requests to one model queue); the workhorse gets
`--parallel 4` via its saved load options once the bench shows the KV budget holds. The heavy model
loads on demand for the nightly batch (LRU, `max_loaded_models: 4`). **Proposal for hub/server-admin
(not built there):** while local AI is busy (GPU > 50 % for 5 min, from `/god/local-ai/status`),
Helena asks the power capability for "Leistung", and back to "Ausgewogen" after 15 idle minutes;
an event `helena.local-ai.busy` on the bus is the hook.

### 7.5 The card and the Jev toggle

`LocalAiCard` (self-contained: its own queries, owner only) — master switch, GPU/NPU/CPU tiles
(state, load, VRAM, loaded models, a switch each), the wired classes with their switch or the
reason they cannot be switched on, the tokens that stayed local, the server's latency, a link to
the settings. **"Jev / Laya (experimentell)"** is a separate switch, off by default, never part of
the master switch: it sets the instance default of hub/browser-task's "Browser-Steuerung"
(`PUT /god/browser-control`, decision model with the configured or the first connection of the
owner's team; off = "Standard"); projects on "Wie in den Voreinstellungen" follow it. Without a
decision-model connection it is off and links to Zugänge. Until hub/browser-task is merged the
route answers 404 and the switch hides itself. The card goes onto Start through hub/dashboard's
widget registry once its contract is published; until then it is on Administrator → Lokale KI.

## 8. Security

Loopback only; a key on every request (Lemonade refuses without); the key is readable by root and
the API's group, reaches Lemonade as a systemd credential and agents only as an environment
variable of the run that uses a local model; Lemonade's service may reach nothing but localhost
(`IPAddressDeny`), downloads happen only in `install.sh` with SHA-256 checks; FastFlowLM's own
server (no auth, CORS on) listens on localhost where agents in isolation cannot reach it; IOMMU
stays on; the forwarder socket is for the agents' group only. Model weights are safetensors/GGUF
only; nothing runs with `trust_remote_code`.

## 9. Other branches

| Branch | What connects | Done here | To do at merge |
|---|---|---|---|
| hub/update-center | `UpdateSource` "Lokale KI": Lemonade and FastFlowLM versions (GitHub Atom feeds), each model's installed revision vs the pinned repo's newest, and a newer model of the same family (Qwen3.6 → Qwen3.7) as "neues Modell verfügbar" | `modules/local-ai/integrations.ts` (`localAiUpdateSource`, contract mirrored) | register it in `helena.local-ai` (`provides.updateSources`), drop the mirror |
| hub/server-admin | `HostCapability` `local-ai` (area `local-ai`, health lines per server) and the `admin-section` slot with `LocalAiSettingsView` | `localAiHostCapability` (mirrored), the view is mountable | register both; messages `server.health.local-ai.server-{up,down}`; `dkms install -k` for every kernel |
| hub/dashboard | the card as a `DashboardWidget` | `LocalAiCard` self-contained | register it once the contract is published |
| hub/browser-task | the Jev toggle uses its instance setting; Laya `--rocm` (§4.6) | toggle against its routes | hand the diff over |
| hub/second-brain (merged) | the local embedding route | `useEmbeddingRoute(localAiEmbeddingRoute)` in API and worker | the owner's pgvector/embedding decision (§5.4) |

## 10. Honest limits

- Hermes needs ≥ 64k context; a 64k prompt takes ~2 min at 535 t/s prefill on the workhorse and
  ~5 min on the heavy model: long interactive chats stay on the subscriptions.
- GPU, NPU and CPU share ~256 GB/s: measured elsewhere, NPU decode loses ~6 % and GPU decode ~14 %
  when both run (1.42× overall throughput); a second GPU model costs far more than an NPU sidecar.
- The NPU is 3–4× slower than the GPU but frugal; it takes system RAM, not VRAM.
- ROCm on gfx1151 is unofficial on Debian; the Vulkan path is the default for that reason.
- The MTP workhorse may not combine `--mmproj` with several slots yet; the fallback is pinned.
- Lemonade pins model downloads to `main` only; Helena's installer pins by commit and runs
  Lemonade offline, so a repository change upstream never changes a running model.

## 11. Open owner decisions

1. Maintenance window for kernel → verify → promote (a reboot; RAID resync must be done).
2. mesa 26.1.6 from backports (after the kernel; measured).
3. System ROCm 10.0 (§4.3) — only when a workload needs it.
4. The embedding model for the knowledge index with local AI (§5.4: Qwen3-Embedding-0.6B) and
   pgvector (hub/second-brain).
5. After the evals: which classes to switch on, and the preset.

## 12. Sources

Debian: trixie-backports `Packages`/`Contents`/`InRelease` (2026-09-24), salsa kernel-team config
`debian/7.1.8-1_bpo13+1`, xrt changelog; kernel.org `drivers/accel/amdxdna` v7.1.8; linux-firmware
history of `amdnpu/17f0_11`; fdo drm/amd #5009; ROCm docs (Strix Halo system optimization,
compatibility matrix, install, RDNA3.5, PyTorch install); ROCm/ROCm #5590, #5724, #6165;
github.com/ROCm/FastFlowLM (README, TERMS.md, docs, releases v1.0.5–v1.0.6, Dockerfile,
debian/rules, model_list.json); github.com/lemonade-sdk/lemonade v2026.39.1 (defaults.json,
backend_versions.json, server_models.json, lemond.service.in, docs/api, fastflowlm backend);
github.com/lemonade-sdk/llamacpp-rocm; ggml-org/llama.cpp releases b10825/b11166;
local-llm-benchmarks.dev; kyuz0.github.io/amd-strix-halo-toolboxes; slb350.github.io/strix-benchmarks;
kyuz0 terminal-bench-mini; euroeval.com (German, 2026-09-20); sleepingrobots.com Lemonade NPU on
Strix Halo; hogeheer499-commits/strix-halo-guide; Hugging Face API for every pinned repository;
Hermes Agent docs (providers, configuration, fallback providers) in `/srv/volition/source/hermes`.
