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
  eigene Downloads. Darunter llama.cpp auf der GPU und FastFlowLM auf der NPU.
- **ROCm ist der Standard auf der GPU** („eher ROCm richtig“): AMDs **ROCm 10.0.0** (TheRock,
  gfx1151 wird nativ unterstützt, kein Trick mit `HSA_OVERRIDE`) als **ein** Baum für llama.cpp
  und PyTorch (Laya), jede Datei per Hash festgelegt (≈ 2,1 GB Download, 8 GB auf der Platte).
  llama.cpp bauen wir dafür selbst (b11166, HIP für gfx1151, Flash-Attention über rocWMMA);
  Lemonades eigenes ROCm-llama.cpp hätte ein zweites, älteres ROCm mitgebracht. **Vulkan** bleibt
  als gemessener Vergleich und Rückfall. Gemessen (kleines Modell, 6.12): ROCm liest lange
  Prompts bis 2,4× schneller (32k Token: 2.491 statt 1.052 t/s), Vulkan erzeugt Text ~25 %
  schneller. Pro Modell entscheidet der Bench im Wartungsfenster.
- **Auf dem jetzigen Kernel 6.12 sieht ROCm nur 15,5 GiB** statt der 96 GiB VRAM. Der Kernel 7.1.8
  soll das beheben; `kernel.sh verify` und `install.sh status` prüfen es. Zeigt auch 7.1.8 nur
  15,5 GiB, laufen die großen Modelle auf Vulkan (das sieht die 96 GiB schon heute).
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
- **Angebunden (2026-09-25, hub/local-ai-wiring):** Embeddings, Hermes-Hilfsaufrufe, Transkription,
  Vorlesen, Entscheidungen und neu: **Zusammenfassungen** (die Update-Digests), **Routinen** (der
  Lauf, den eine Routine startet), **Erster Plan des Koordinators** (die Planungsstufe eines
  Agenten-Teams, nur der erste Versuch) und **Reflexion nach Läufen** (nur kurze Sitzungen). Jede
  mit dem eingestellten Modell als Rückfall; der Lauf zeigt, ob lokal lief und warum nicht.
  **Triage** hat keine eigene Arbeit mehr: Was Helena einordnet, macht „Entscheidungen“.
  Routinen, Koordinator und Reflexion **handeln** (Werkzeuge, Aufgaben, Gedächtnis): Sie brauchen
  eine neue Auswertung (Version 2) und sind nie Teil des Hauptschalters; vor dem Einschalten
  §7.1 „Bevor der Owner einschaltet“ lesen.
- **Nach einem Neustart** lädt `helena-ai-preload.service` die Modelle der eingeschalteten
  Arten und hält sie im Speicher (`install.sh models preload set …`), statt dass die erste Anfrage
  ~50 s auf das Laden wartet.

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

**ROCm on 6.12 (2026-09-25, ROCm 10.0.0 from AMD's pip index in `~/agent-work`, no install):**
`rocminfo` lists gfx1151, the KFD node has `cwsr_size 19185664` and `ctl_stack_size 16384` (Debian
backported the CWSR fix, so Lemonade's "Linux kernel missing support" check passes), PyTorch
2.13.0+rocm10.0.0 runs a matrix product on the GPU (HIP 7.15; fp16 GEMM 16.8 TFLOPS under load).
**But KFD offers only 16,638,812,160 B (15.5 GiB) of GPU memory**: half the OS memory (GTT), not
the carve-out (`torch.cuda.mem_get_info` agrees). Vulkan sees 114 GiB (VRAM + GTT). On 6.12 ROCm
could hold the workhorse (23.8 GB) only in part; the 7.1.8 trial must show the carve-out in KFD
(§4.3.3).

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
| Config | `LEMONADE_DEFAULTS_PATH` file: `offline`, `no_fetch_executables`, no broadcast, no update checks, telemetry off, `max_loaded_models: 4`, `llamacpp.backend: rocm` with `rocm_bin`/`vulkan_bin` pointing at our builds, `llamacpp.args: --load-mode none` (llama.cpp b11166 replaced `--no-mmap` with `--load-mode`; the weights are read into VRAM instead of sitting in the 31 GB page cache) |
| Depends | `libcpp-httplib0.41` 0.41.0+ds-3~bpo13+1 (backports) |

How Lemonade 2026.39.1 runs llama.cpp (read in its source, `llamacpp_server.cpp`,
`backend_utils.cpp`, `system_info.cpp`): `backend: rocm` means its `rocm-stable` channel; a path in
`llamacpp.rocm_bin` replaces the download (its own would be `lemonade-sdk/llama.cpp` b10820 built on
**TheRock 7.14.0**, plus a TheRock runtime it installs itself). Without that runtime it only puts
the binary's folder on `LD_LIBRARY_PATH`; our binaries carry their RUNPATH, so nothing else is
needed. It passes `-m`, `--ctx-size`, `--port`, `--jinja`, `--metrics`, `--parallel 1` and, per
model, `--mmproj`/`--spec-type draft-mtp`; and it refuses ROCm on gfx1151 when KFD lacks
`cwsr_size`/`ctl_stack_size` (present on 6.12.107 already).

### 4.2 llama.cpp: one release, two backends

| | ROCm (default) | Vulkan (comparison, fallback) |
|---|---|---|
| Release | **b11166** (commit `a72e04ab`, 2026-09-24), the same tag for both, so a comparison is fair | same |
| Binary | **built by `install.sh`** from the tag's source (`llama.cpp-b11166.tar.gz`, sha256 `1f8d18ea…`, and the commit inside checked with `git get-tar-commit-id`) against ROCm 10.0.0 below; 5 min with `-j 4` on Kingston | the project's `llama-b11166-bin-ubuntu-vulkan-x64.tar.gz`, sha256 `69e26c5e…`, RUNPATH `$ORIGIN` |
| Where | `/opt/helena-ai/llamacpp/rocm-b11166` | `/opt/helena-ai/llamacpp/vulkan-b11166` |
| License | MIT | MIT |

Per model, `bench.sh speed` measures both (ROCm with hipBLASLt off and on) and `models.tsv`'s last
column saves the winner, which `install.sh models load` hands Lemonade (`llamacpp_backend`).
`install.sh --no-rocm` is the Vulkan-only install (no ROCm tree, no build).

Rejected: Lemonade's `rocm-stable` download (TheRock 7.14 and b10820: a second, older ROCm beside
the one PyTorch needs); `lemonade-sdk/llamacpp-rocm` b1324 (its own ROCm inside, 397 MB, nightly
channel, no source pin); ggml-org's prebuilt HIP builds (Ubuntu, several ROCm versions, not gfx1151
only, no rocWMMA flash attention).

### 4.3 ROCm (the owner: "ROCm und Kernel gut machen, Vulkan auch anschauen, aber eher ROCm richtig")

#### 4.3.1 Which ROCm

| Option | Verdict |
|---|---|
| **AMD ROCm 10.0.0 "TheRock" wheels** from `stable.repo.amd.com/rocm/whl-next/` into one venv `/opt/helena-ai/rocm-10.0.0` (Python 3.13 from Debian): `rocm-sdk-core` (414.7 MB), `-libraries` (143.3 MB, rocBLAS, hipBLAS, **hipBLASLt**), `-devel` (598.0 MB, clang/hipcc, CMake configs, rocWMMA headers), `-device-gfx1151` (173.7 MB), `torch 2.13.0+rocm10.0.0` (202.6 MB), `amd-torch-device-gfx1151` (50.1 MB), `triton` (427.4 MB), cmake 4.1.2, ninja 1.13.0 | **Chosen.** One tree for the llama.cpp build **and** PyTorch (Laya): the same HIP runtime, the same device libraries. AMD's own stable channel, gfx1151 native. Every file hash-pinned (`rocm-requirements.txt`, 20 packages, installed with `--require-hashes`; AMD's index publishes no hashes of its own). ≈ 2.1 GB download, 8.0 GB installed (measured). No `/opt/rocm`, no apt source, nothing in the system's library path; `uninstall` keeps it for Laya, `--purge` removes it. |
| AMD ROCm 10.0.0 for Debian 13 (apt, `amdrocm10.0-gfx1151`, ~675 MB download, 5.6 GB installed) | Rejected for now: PyTorch for ROCm 10 exists only as wheels bundling the SDK wheels, so Laya would bring the same ROCm a second time; an apt source and packages outside Helena's pins. |
| Lemonade's TheRock 7.14.0 runtime + its llama.cpp b10820 | Rejected: an older ROCm, and again not the one PyTorch uses. |
| repo.radeon.com apt (7.0–7.2) | Rejected: jammy/noble only. |
| Debian's own ROCm (HIP 5.7) | Rejected: too old for gfx1151. |
| PyTorch.org's `rocm7.2` wheel (6.2 GB, every architecture) | Rejected: size, and a third ROCm. |

#### 4.3.2 Measured (Kingston, 6.12.107, 2026-09-25; Qwen3-0.6B Q8_0, b11166 both, `-fa on -lm none`, 3–5 repetitions; other agents' tests ran meanwhile, load 9–16)

| Test | ROCm, hipBLASLt off | ROCm, hipBLASLt on | Vulkan (RADV, mesa 25.0.7) |
|---|---|---|---|
| pp512 | 11,823 ± 3,006 | 12,415 ± 1,539 | **13,331** ± 70 |
| pp2048 | 10,569 ± 1,482 | 9,725 ± 2,413 | **10,753** ± 64 |
| pp8192 | 6,785 ± 54 | 6,776 ± 46 | 5,090 ± 94 |
| pp32768 | 2,491 ± 4 | **2,499** ± 13 | 1,052 ± 4 |
| tg128 | 207 ± 15 | 204 ± 13 | **265** ± 2 |
| pp8192 without flash attention | – | 1,509 ± 29 | – |

- **Long prompts belong to ROCm:** 1.33× at 8k, 2.4× at 32k — what Hermes' ≥ 64k contexts and
  agent sessions spend their time on. rocWMMA flash attention is why: without it ROCm drops to
  1,509 t/s at 8k (4.5× slower).
- **Generation is faster on Vulkan** (~25 % on this model); short prompts are even. For a
  background class with long inputs and short outputs (summaries, triage, compression) ROCm wins;
  for long answers Vulkan may. The bench on the real candidates (`bench.sh speed`, maintenance
  window) decides per model, with ROCm as the default.
- hipBLASLt makes no difference on a quantized model (llama.cpp's own MMQ kernels do those
  products); it is on (`ROCBLAS_USE_HIPBLASLT=1`) for the F16/BF16 products (vision projector,
  embedding models), and `bench.sh` keeps measuring both.
- A tiny model under shared load overstates noise and understates bandwidth effects; the
  35B/120B numbers will differ. Not a verdict yet, the method.

#### 4.3.3 The driver work, step by step

What ROCm on gfx1151 needs, what Kingston has, and what changes. Nothing here is done by an agent:
the orchestrator runs the scripts in the maintenance window.

1. **Kernel 7.1.8 from trixie-backports** (`kernel.sh`, §2–3). The inbox `amdgpu` with KFD (no
   `amdgpu-dkms`: AMD ships it for Ubuntu/RHEL only, and ROCm 10 works with the inbox driver),
   the CWSR fix (on 6.12.107 too), and the APU memory handling that should give KFD the
   carve-out instead of the GTT.
2. **Firmware 20260810** (`firmware-amd-graphics` from backports): the GC 11.5.1 MES/PSP blobs of
   2026-02/05/08 (hangs under compute load were fixed there) and `amdnpu/17f0_11/npu_7.sbin`.
3. **IOMMU stays on** (Translated, the default). No `amd_iommu=off` (it switches off the NPU) and
   no `iommu=pt` (nothing measured to gain on an APU).
4. **Memory: nothing to change.** The fixed 96 GiB carve-out is the owner's choice and stays. The
   usual Strix Halo recipe (`amdgpu.gttsize`, `ttm.pages_limit`, `ttm.page_pool_size`, a 512 MB
   carve-out) is for machines that feed the GPU from system memory; here it would take memory the
   OS (31 GB) needs. So: **no kernel parameters, no modprobe options.**
5. **Verify the kernel** (`kernel.sh verify`): `/dev/kfd`, KFD lists gfx1151 (`gfx_target_version
   110501`), `cwsr_size` and `ctl_stack_size` set, no amdgpu ring timeouts, and — as a warning —
   a KFD memory bank ≥ 64 GiB (the carve-out). If only the warning remains: promote anyway (the
   NPU needs 7.1.8), ROCm keeps the small models and the big ones load with `llamacpp_backend:
   vulkan` (`models.tsv`), until a later kernel changes it.
6. **ROCm user space** (`install.sh`): the venv above, as root, `go-w`; then **llama.cpp's HIP
   build** with: `GGML_HIP=ON`; `AMDGPU_TARGETS=gfx1151` (this GPU only); `GGML_HIP_ROCWMMA_FATTN=ON`
   (§4.3.2); ROCm's clang as the C/C++/HIP compiler and `HIP_PATH`/`ROCM_PATH`/`CMAKE_PREFIX_PATH`
   = the SDK tree (`rocm-sdk path --root`); `LLAMA_CURL=OFF`; build number and commit stamped;
   `CMAKE_BUILD_RPATH=$ORIGIN;<SDK>/lib` so the binaries resolve every ROCm library (TheRock's own
   libdrm/libnuma/zstd included, checked with `ldd`) without `LD_LIBRARY_PATH`. Each flag is
   commented in `install.sh`.
7. **Run-time environment** (Lemonade's drop-in): `ROCBLAS_USE_HIPBLASLT=1` and nothing else.
   Deliberately absent: `HSA_OVERRIDE_GFX_VERSION` (gfx1151 is native; an override would hide a
   wrong runtime), `HSA_ENABLE_SDMA=0` (copies work), `GGML_CUDA_ENABLE_UNIFIED_MEMORY` (the
   weights live in the carve-out), `HIP_VISIBLE_DEVICES` (one GPU). The service has `render` and
   `video`; agents never get `/dev/kfd` (they reach Lemonade through the socket).
8. **Verify ROCm** (`install.sh status`, as Lemonade's user): ROCm version, `rocminfo` shows
   gfx1151, KFD memory in GiB with "the carve-out: ok" or "only GTT", a HIP smoke test (a matrix
   product through PyTorch compared with the CPU's), `llama-cli --list-devices` shows the ROCm
   device, `amd-smi` names the ASIC.
9. **Measure** (`bench.sh speed <model>`): ROCm (hipBLASLt off/on) and Vulkan, pp512/pp8192/pp32768,
   tg128 empty and at 32k depth; the winner per model goes into `models.tsv`.
10. **Back out:** `install.sh --no-rocm install` (Vulkan only, Lemonade reconfigured), or
    `uninstall [--purge]`; the kernel through `kernel.sh rollback` before promote.

### 4.4 Vulkan driver

mesa 25.0.7 (trixie) runs gfx1151 (measured, §1, §4.3.2). trixie-backports has **mesa
26.1.6-1~bpo13+1** with much better RADV performance on Strix Halo; it touches the whole graphics
stack (libllvm19, libdrm), so it is a separate, measured step after the kernel: run `bench.sh speed`
before and after. Not part of `install.sh`. Vulkan needs no environment either (RADV is picked by
itself; `AMD_VULKAN_ICD` stays unset).

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

### 4.6 PyTorch-ROCm for Laya (`native/laya/install.sh install --rocm`)

hub/browser-task's Laya installer (merged into the hub) sets up `/opt/helena/laya/venv` with
PyTorch 2.14.0 **CPU** and `laya==0.3.20` (Apache-2.0, needs `torch>=2.0`). Its `--rocm` option
(built here, on the merged file) uses **the same ROCm tree** as llama.cpp instead of a second one:

- a `.pth` line puts `/opt/helena-ai/rocm-10.0.0`'s site-packages behind Laya's own, and a uv
  override (`torch; sys_platform == "never"`) keeps `torch` out of Laya's resolution, so nothing
  downloads a second PyTorch/ROCm; a CPU torch of an earlier install is removed first;
- a drop-in `helena-laya.service.d/rocm.conf`: `HELENA_LAYA_DEVICE=cuda` (ROCm's PyTorch calls
  the GPU `cuda`), `PrivateDevices=no` with `DevicePolicy=closed` and only `/dev/kfd` +
  `/dev/dri/renderD128`, groups render/video, memory 6G/8G (ROCm's mapped libraries count);
- `helena_laya_serve.py` reads `HELENA_LAYA_DEVICE` and falls back to the CPU when PyTorch sees no
  GPU; `status` prints `torch.version.hip`; `install` without `--rocm` returns to the CPU.

Verified on Kingston in `~/agent-work` (2026-09-25, 6.12, no install): Laya's venv 159 MB with no
torch of its own, `torch 2.13.0+rocm10.0.0` from the shared tree, `cuda` available; the server from
this branch loaded the pinned `laya-browser` v10s checkpoint on the GPU in 3.7 s (CPU 8.9 s) and
answered the installer's probe identically (`CLICK` 0.9712 on both). Latency per decision was ~6 s
on both devices while other agents' tests held the load at 20–34 — inconclusive, and a sign the
time goes outside the forward pass (reported to hub/browser-task). The CPU stays the default until
a quiet measurement shows the GPU faster; the GPU is one flag away.

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

Ruled out: GLM-5.3-Flash (≥ 86.7 GiB), DeepSeek-V4-Flash (IQ2 only, exclusive), Nemotron 3 Super
(NVIDIA licence, 14 t/s), Qwen3.8-Flash-Next (125B-A6B plus a 51B n-gram table and an MTP module,
~180B effective; Qwen Community License 1.0, not OSI; the only GGUF is a 1-bit build of ~123 GB).
The update source watches that family and a Qwen4 MoE (`MODEL_WATCH`), so a smaller or distilled
release shows up as "neues Modell verfügbar" (§9). A review of this very machine (Bosgame M5,
"The Stack", 2026-09-21) confirms the class: MoE models reach conversational speed, dense 70B
models crawl at 4–5 t/s, and prompt processing is the bottleneck for long contexts.

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
llama.cpp Vulkan 31 MB + source 38 MB, ROCm 10.0.0 with PyTorch ≈ 2.1 GB (8.0 GB installed; Laya
shares it). Losers are deleted after
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
run) — migration `0179_helena_local_ai` (after hub/dashboard's 0178); the policy is one `app_setting`
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
- **A local server that stops never blocks** (found in the live E2E test: with `lemond` stopped a
  chat on a local model hung for more than five minutes, the profile had `fallback_providers: []`
  and Hermes parked the turn in its auto-recovery):
  - *At the start:* the API asks the server before it hands a run or chat answer a local model
    (its last status when younger than 15 s, else one status call with a 2 s timeout). A server
    that does not answer, or local AI, its server or its model being off, hands the model the
    agent runs on without local AI: its own model, or the runtime's default when its own is local
    (`chooseModelNow`). The run's or answer's model check records it at once.
  - *During a turn:* while local AI is on, the runner puts that cloud model first in the profile's
    `fallback_providers` (its catalog names the provider; for the runtime's default it reads the
    deployment's config.yaml), before the chain the owner configured (`withLocalFallback`). Hermes
    skips an entry that is the backend that just failed, so a run on the cloud model loses
    nothing. A refused connection makes Hermes retry (`agent.api_max_retries`, 3) and then switch,
    in well under a minute; Hermes has no per-provider connect timeout or retry count, so the local
    provider gets `stale_timeout_seconds: 240` and `request_timeout_seconds: 900` for a server
    that accepts and hangs.
  - *Shown:* the model check carries `fallback: {from, reason}` (`off`, `down`, `failed`, the
    last when the session ran on a non-local provider although a local model was asked for), which
    is no mismatch; the chat answer and the run say "gpt-6-luna statt Qwen3.6-… · lokaler Server
    nicht erreichbar".
- **Kinds of work that run as an agent's turn** (a digest, a routine's task, a coordinator's
  first plan: `agent_run.work_class`, migration 0182; a reflection: asked for by the API when the
  run ends): the claim asks `classModelNow(class)`. While the master switch and the class are on,
  the class's unit allowed, its model's newest eval passed **in the class's current eval
  version** and its server answering (the same 15 s / 2 s check as above), the run starts on the
  class's local model with no reasoning level of its own (the provider's `extra_body` says how the
  local model thinks, §6.7), and the model check says `source: 'local'` with the class. Otherwise
  it runs on the model it runs on without local AI: the run's own (the digest's cheapest model,
  a workflow step's) or the agent's, with its reasoning; a server that did not answer is named
  (`fallback: down`). During the turn the profile's fallback chain starts with the agent's own
  cloud model (above), so a local failure mid-turn lands there (`fallback: failed`), not on the
  run's own model when that differs (the digest's) — accepted: one managed configuration per
  profile; a per-run chain would need a second one. These classes offer `off` and `prefer` only
  (`LocalAiTaskClass.modes`): the fallback chain is always there, so `only` could not be kept
  (the same holds for `hermes-helpers`, whose helpers fall back to the main model).
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

### 6.6 The interface other branches build on (stable)

For hub/decisions (`decide()` over `decisionBackends`, with a local "logit readout" backend) and any
later consumer. These names stay; additions will be optional fields only.

**(a) A task class: its tier and its fallback.** A consumer registers its kinds of work; it never
edits the policy or builds its own switch.

```ts
// in a plugin's setup (the internal helena.local-ai plugin does the same for its classes)
ctx.localAiTaskClasses.register({
  id: 'mail-classify',              // /^[a-z][a-z0-9-]{0,47}$/, the policy's key
  label: { de: 'Mails einordnen', en: 'Classify mail' },
  unit: 'npu',                      // the default tier: 'gpu' | 'npu' | 'cpu'
  capability: 'chat',               // what the model must do (LocalModelCapability)
  priority: 'background',           // 'interactive' | 'browser' | 'background' | 'batch'
  experimental: false,              // true: labelled "Experimentell", never in the master's set
  inMasterDefault: false,           // switched on by the master switch's first "on"
  wired: true,                      // false: listed as planned, cannot leave "Aus"
  evaluate: async (ctx) => …,       // LocalAiEvalContext → LocalAiEvalResult (fixed cases, 0–1)
  threshold: 0.85,                  // the score a model needs before the class may leave "Aus"
});
```

At call time, one question — where does this run now, or why not:

```ts
import { resolveLocalRoute, readModelServerKey } from '@repo/db';
const result = await resolveLocalRoute({ classId: 'mail-classify', unit: 'npu', capability: 'chat' });
// { route: { server, model, modelId, unit, mode } }  or  { refusal, mode }
// refusal: 'master-off' | 'class-off' | 'unit-off' | 'no-server' | 'server-down' | 'no-model'
//        | 'eval-failed' (the model's newest eval for the class failed, e.g. after an update)
```

- The **tier** is the class's `unit` by default; the model the owner picked for the class (or the
  server's first loaded model with the capability) decides the real unit, and a unit the owner
  switched off refuses (`unit-off`).
- **Fallback is the caller's** and follows `mode`: a refusal with `off`/`prefer` means "use your
  configured path now" (cloud model, Jev Cloud, Laya — whatever the consumer had); with `only` it
  means "wait, never leave the machine". After a route, an error, a timeout or an unusable answer
  in `prefer` also goes to the configured path; in `only` it retries later.
- The master switch off answers `master-off` for every class at once: nothing local runs, and
  nothing local is left behind (the consumer keeps no copy of the route).
- **The eval gate holds after switching on:** when a model's newest eval for a class fails (a
  model updated and evaluated again), that class stops routing to it (`eval-failed`; Hermes'
  helpers leave the profile) while its switch stays on, and the card says why. A passing eval
  brings it back. Start lists it as a red problem ("Braucht dich").
- The **Jev / Laya (experimentell)** switch on the card is separate from the classes: it sets
  hub/browser-task's instance "Browser-Steuerung" (`PUT /god/browser-control`). A decisions backend
  that wants the same switch reads that setting; it does not add a second one.
- Admin routes (owner only): `GET /god/local-ai` (policy, classes, servers, evals),
  `GET /god/local-ai/status`, `PATCH /god/local-ai/policy`, `POST /god/local-ai/evals`.

**(b) The local endpoint.**

| | |
|---|---|
| Base | `http://127.0.0.1:13305/api/v1` (Lemonade; OpenAI-compatible). The same address inside an isolated agent unit (§6.4). Other servers: the base URL of their `helena_model_server` row |
| Key | `Authorization: Bearer <key>`; in the API `readModelServerKey(route.server)` (never logged, never in a response); in an agent's run `HELENA_MODEL_SERVER_KEY_<SLUG>` |
| Model | the server's own id (`route.model`, e.g. `Qwen3.6-35B-A3B-GGUF`); Helena's id is `helena-<slug>/<model>` (`parseLocalModelId`) |
| Routes | `/chat/completions`, `/completions`, `/embeddings`, `/audio/transcriptions` (NPU Whisper), `/responses`, `/models`, `/health` |
| Thinking | off by default on Lemonade's models (§6.7); a call that wants it sends `chat_template_kwargs.enable_thinking: true` (`localThinkingFields` in the SDK) |
| Body | forwarded to llama-server unchanged (Lemonade 2026.39.1 only adds the `max_tokens` alias and trims oversized JSON-schema bounds of tools), so llama.cpp's own fields pass: `chat_template_kwargs`, `n_probs`, `grammar`, `json_schema` |

**Logprobs: available on the GPU models.** Verified 2026-09-25 on llama-server b11166 — our ROCm
build and the Vulkan build alike — with Qwen3-0.6B, asking "A = ja, B = nein":

- `/v1/chat/completions` with `"logprobs": true, "top_logprobs": 5, "max_tokens": 1,
  "temperature": 0` → `choices[0].logprobs.content[0].top_logprobs = [{token, logprob, bytes}, …]`
  (OpenAI's shape): `A` 0.972, `B` 0.027 on ROCm; `A` 0.978, `B` 0.021 on Vulkan.
- `/v1/completions` with `"logprobs": 5` answers in the **same `content` shape**, not OpenAI's
  legacy `tokens`/`token_logprobs` arrays; and the first token carries the leading space (`" A"`).
- The probabilities are the model's distribution before sampling (llama.cpp's default,
  `post_sampling_probs: false`), so temperature does not change them.
- For an option readout: options as single tokens, `max_tokens: 1`, thinking off
  (`"chat_template_kwargs": {"enable_thinking": false}` for Qwen3), read the first position's
  `top_logprobs`. The numbers differ between backends in the second decimal; compare options
  within one answer, never across backends.
- Through Lemonade: passes by its source (`chat_completion` → `forward_request`, body intact);
  checked live in the maintenance window with the real models. **NPU models (FastFlowLM) are not
  verified to return logprobs**: route logit readouts to GPU models (`unit: 'gpu'`).

### 6.7 Thinking (reasoning models)

**Found live (2026-09-25, Qwen3.6-35B-A3B-MTP through Lemonade):** summaries 0.25, reflection 0.25
and hermes-helpers 0.00 failed with "no JSON summary" / lost facts. Qwen3.6 reasons by default and
spent the eval's `max_tokens` (800/900) on `reasoning_content`: the same summary prompt took 430
tokens with thinking (1,129 characters of reasoning) and 48 without, with the JSON right, about 9×
faster. Embeddings 0.90, triage 0.94, routines 1.00 and coordinator-triage 1.00 passed as they were.

| Where | How thinking is set |
|---|---|
| **Lemonade's default** | every llama.cpp model starts with `--chat-template-kwargs '{"enable_thinking":false}'` (`install.sh`, `llamacpp.args`): no thinking unless a request asks. llama-server merges a request's `chat_template_kwargs` over this default (b11166 `server-common.cpp`), and a request's `reasoning_effort: "none"` also switches it off |
| **Helena's own calls** | each task class declares `thinking: off \| low \| medium \| high` (SDK `LocalAiTaskClass.thinking`, `off` when absent); every call sends it (`localThinkingFields`: `chat_template_kwargs.enable_thinking`, plus `reasoning_effort` for templates with levels). The evals run each class the same way (`openAiEvalContext`, the API's "Auswerten", `local-ai-eval.ts`, which takes `--thinking` to compare). Off: hermes-helpers, summaries, reflection, decisions. Low: triage, routines, coordinator-triage (they passed with thinking) |
| **Hermes' helper calls** (compression, image descriptions) | Hermes builds them itself and they carry nothing, so they run on Lemonade's default: off |
| **An agent on a local model** | its turns think: the runner writes `extra_body: {chat_template_kwargs: {enable_thinking: true}}` on the named provider `helena-<slug>`. Hermes adds a provider's `extra_body` to the agent's own turns only (never to auxiliary calls: `auxiliary_client` reads only the task's own `extra_body`), and removes it again when it falls back to another provider (`_rescope_fallback_extra_body`) |

Rejected:

- **The helper task's own `auxiliary.<task>.extra_body`** (or `reasoning_effort: none`): Hermes sends
  the task's `extra_body` to every fallback in its chain (`_fallback_request_kwargs`), i.e. to the
  agent's main model. A Codex or Claude endpoint refuses `chat_template_kwargs` and would fail the
  very fallback that protects the helpers.
- **A Lemonade model variant** (`Qwen3.6-35B-A3B-MTP-GGUF-nothink` with `--reasoning-budget 0`):
  Lemonade runs one llama-server per model id, so two ids on one checkpoint load the weights twice
  (2 × 23.8 GB of VRAM, a second KV cache) and compete in its LRU of four.
- **A top-level `enable_thinking`**: Lemonade turns it into a `/no_think` prompt prefix
  (hub/decisions' finding); the chat template's own switch is the reliable one.

gpt-oss (harmony) always reasons; its level comes through `reasoning_effort` (`low` for classes on
`low`). Mistral Small 4 is measured as it comes.

Live: after `install.sh install` (it rewrites `lemonade-defaults.json` and restarts `lemond`,
which unloads the models), `install.sh status` names each running llama-server with "thinking off
unless asked". The provider's `extra_body` reaches the agents' profiles with the deploy (the
runner bundle is rebuilt; the runner rewrites every profile whose snapshot changed).

## 7. The policy ("Lokale KI")

### 7.1 Task classes

| Class | Default unit | Needs | Wired to (producer) | Modes | Eval (threshold), version | Thinking | In the master's first set |
|---|---|---|---|---|---|---|---|
| `embeddings` | NPU/GPU | embeddings | the knowledge index (`useEmbeddingRoute`, API + worker) | off/prefer/only | retrieval top-1, 10 DE/EN questions (0.8), v1 | – | yes |
| `hermes-helpers` | GPU | chat | Hermes' `auxiliary.compression`/`vision` (runner `local-ai.ts`) | off/prefer | compression keeps every fact, 3 cases (0.75), v1 | off | yes |
| `summaries` | GPU | chat | the update center's **digest runs** (`updates/digest.ts`: `work_class`) | off/prefer | German JSON summaries with every fact, 4 cases, room to think (0.75), **v2** | low | yes |
| `triage` | NPU | chat | **none** — covered by `decisions` (below) | – | 16 labels DE/EN (0.85), v1 | low | yes (never on: unwired) |
| `transcription` | NPU | transcription | the chat's dictation and conversation mode (`voice.md`) | off/prefer/only | – | – | yes |
| `speech` | CPU | speech | the conversation mode's reading aloud (`voice.md`) | off/prefer/only | – (the owner listens) | – | no |
| `routines` | GPU | tools | the run a **routine's fire** starts (engine `delegate` step → `createIssue`/`updateIssue` → `enqueueDelegateRun` with `work_class`) | off/prefer | right tool + arguments among **22 tools**, 8 cases (0.9), **v2** | low | no |
| `reflection` | GPU | chat | the **turn after a run** (`requestReflection`: the answer to the run's result names the model; runner `reflect.ts`), only after a run that read ≤ 64k tokens in all | off/prefer | its own: the right fact kept with `memory`/`skill_manage`, nothing of a trivial task, never a secret, 6 cases (0.85), **v2** | low | no |
| `coordinator-triage` | GPU | tools | an agent team's **coordinate stage, first attempt** (`agent-team.ts` `queueStage`); a retry runs on the coordinator's model | off/prefer | its own: the stage's real prompt and parser, the right specialists and order, 5 cases (0.8), **v2** | low | no |
| `decisions` (hub/decisions) | GPU | chat | `decide()`: mail classifier, model router, receipts, engine step "Entscheidung" | off/prefer/only | 24 typed questions (0.85), v1 | off | no |

**Class → producer, how it runs.** Work Helena sends itself (embeddings, voice, decisions) calls
the local server from the API or worker (`resolveLocalRoute`). Work that is an **agent's turn**
(summaries, routines, coordinator-triage, reflection) is a Hermes run: the producer only says what
the work is (`WORK_CLASS`, `modules/local-ai/work-classes.ts`; stored as `agent_run.work_class`),
and the **claim** decides local or configured (`classModelNow`, §6.3). Such a turn thinks on the
local model (the provider's `extra_body`), so these classes declare `thinking: low` and their evals
run that way.

**What else was looked for and is not there (2026-09-25):** no run, chat, activity or mail
summaries exist in Helena (chat titles are the owner's, Hermes' title generation is off); the only
model-written summary is the update digest. "Nightly reflection" does not exist either: Helena
reflects right after a run, in its session. The hub inbox's triage (`apps/worker/src/hub-inbox-*`)
calls an external integration service from the Mastra era (`INBOX_INTEGRATION_URL`, unset: the
worker does nothing) — dead code to remove with hub/oss-packaging's deletion list.

**Triage: one home, `decisions`.** Everything Helena classifies runs through `decide()` (the mail
classifier `helena.mail`, the model router, receipts, the engine step "Entscheidung"), which reaches
local AI through the class `decisions` with a logit readout on a GPU model. A second class for the
same work would be a second switch for one thing. **Proposal:** retire `triage` (remove it from
`BUILTIN_TASK_CLASSES`, the presets and the messages; a stored `triage` setting is ignored), and
let a new kind of classification register a decision class. Until the owner or orchestrator agrees,
`triage` stays listed, unwired, with a description that says so.

**Bevor der Owner einschaltet (routines, coordinator-triage, reflection):**
- **Sie handeln.** Ein Routinen-Lauf arbeitet mit allen Werkzeugen des Agenten (Aufgaben, Mail,
  Browser, Shell). Der Plan des Koordinators wird von Helena geprüft (erlaubte Spezialisten, gültige
  Abhängigkeiten), aber der Lauf hätte Werkzeuge. Die Reflexion schreibt ins Gedächtnis und in
  Skills, die jeder spätere Lauf liest. Die Autopilot-Stufe und die Freigaben gelten genauso wie
  auf dem Cloud-Modell: Senden, Veröffentlichen, Löschen, Bezahlen brauchen weiter eine Freigabe.
- **Die alten Auswertungen zählen nicht mehr (Version 2).** Die bestandenen Werte von heute früh
  (routines 1.00, coordinator-triage 1.00 auf qwen3.5-2b-FLM; reflection 1.00 auf Qwen3.6 mit der
  Zusammenfassungs-Auswertung) maßen etwas anderes: vier Werkzeuge statt 22, eine Werkzeugwahl statt
  eines Team-Plans, eine Zusammenfassung statt Gedächtnis und Skills. Neu auswerten (Lokale KI →
  „Auswerten“), bevor eingeschaltet wird.
- **Auf der GPU, nicht auf der NPU.** Ein Agenten-Lauf braucht ≥ 64k Kontext (Hermes) und liest
  15–40k Token Systemprompt und Werkzeuge, bevor er anfängt. `qwen3.5-2b-FLM` ist in `models.tsv`
  mit 8k Kontext eingetragen (Lemonade meldet 65536, den Serverstandard) und ist ein 2B-Modell;
  empfohlen ist Qwen3.6-35B-A3B für alle drei, als Modell der Klasse gewählt.
- **Reflexion nur bei kurzen Läufen.** Hermes meldet keine Kontextgröße, nur was der ganze Lauf
  gelesen hat (alle Aufrufe zusammen); das begrenzt die Sitzung nach oben. Lokal also nur nach
  Läufen, die höchstens 64k gelesen haben: ein Fehler nach wenigen Schritten, Nacharbeit. Ein Lauf
  mit vielen Werkzeugaufrufen liest weit mehr und reflektiert auf seinem eigenen Modell. Budget
  lokal 240 s statt 120 s; der Runner des Agenten wartet so lange mit dem nächsten Lauf. Besser
  würde es mit einem Hermes-Patch, der die Kontextgröße des letzten Aufrufs im `result` meldet
  (`compressor.last_prompt_tokens`): dann könnte die Grenze die Sitzung selbst sein.
- **Mitten im Lauf** fällt ein lokaler Fehler auf das Cloud-Modell des Agenten zurück (Hermes'
  `fallback_providers`), der Lauf zeigt „… statt Qwen3.6 · lokal fehlgeschlagen“.
- **Die GPU wird geteilt.** Lemonade bedient ein Modell mit `--parallel 1`: Ein langer lokaler
  Lauf lässt eine Entscheidung (Modellwahl mit 5 s Budget) warten, die dann auf das eingestellte
  Modell ausweicht. Nichts bricht, aber die Modellwahl stuft in der Zeit nicht herab.

Modes: **Aus** · **Lokal bevorzugt** (local first, the configured model on failure) · **Nur lokal**
(for work that must not leave the machine; not offered where the work is an agent's turn, whose
fallback chain always holds the configured model: the API answers 400). A class leaves "Aus" only
when it is wired and the newest eval of its model, in the class's eval version, passed (the API
answers 409 otherwise). Presets: **Sparsam** (everything
that passed), **Ausgewogen** (helpers, embeddings, summaries, triage, transcription), **Qualität**
(embeddings and transcription only), **Eigene**. The master switch's first "on" applies the first
set, as far as its evals passed. Units can be switched off one by one (a class whose model runs on
a switched-off unit falls back).

**Real work stays on Claude/Codex:** coding, long agent tasks, the Home master, interactive chats,
anything with side effects outside Helena — unless the owner picks a local model for an agent, or
switches on `routines`/`coordinator-triage` (below), which are real work on purpose and therefore
never part of the master switch.

**Eval versions** (`LocalAiTaskClass.evalVersion`, `helena_local_ai_eval.eval_version`,
migration 0182): a class whose eval changes raises its version; an eval of an older version is
"Auswertung nötig" (the class cannot be switched on) and a class already on stops routing to that
model (`failedEvalModels(class, version)`) until the new eval passed. Version 2 on 2026-09-25:
summaries (thinks, 2,500 tokens), routines (22 tools), reflection and coordinator-triage (their
own evals).

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

**First live run (2026-09-25, Kingston, kernel 7.1.8, ROCm; `bench.sh evals
Qwen3.6-35B-A3B-MTP-GGUF Qwen3-Embedding-0.6B-GGUF`, run by the orchestrator):** embeddings 0.90,
triage 0.94, routines 1.00, coordinator-triage 1.00 passed; hermes-helpers 0.00, summaries 0.25 and
reflection 0.25 failed because the model thought until `max_tokens` ran out (§6.7). The rerun with
each class's `thinking` replaces these numbers.

### 7.4 Scheduling and priorities

**Loaded at start (hub/local-ai-wiring).** Lemonade loads a model on its first request and
unloads everything when it stops; after a reboot the first run or decision on the workhorse waited
~50 s (a decision with a 5 s budget fell back). `helena-ai-preload.service` (a oneshot after
`lemond`, `PartOf` it, `WantedBy` it; a throwaway user with the key as a credential, loopback
only) runs the installer's copy `install.sh models preload run`: it loads and **pins** (Lemonade's
LRU never evicts a pinned model) the GPU models listed in `/etc/helena/local-ai-preload`, with the
same options as `models load` (context, backend, thinking off unless asked). `models preload set`
checks the list: llama.cpp models of the catalog, pulled, and together within the VRAM budget (the
GPU's memory minus 6 GiB; per model weights + 5 % + 2.5 GB of KV cache: Qwen3.6-35B-A3B ≈ 27 GB,
Qwen3-Embedding ≈ 3 GB, gpt-oss-120b ≈ 69 GB — the workhorse, the embeddings and gpt-oss together
do not fit, so gpt-oss stays on demand unless a class uses it). `run` loads what fits in list
order and fails the unit for anything that did not load. NPU models (FastFlowLM) are not
preloaded: they take system RAM (~31 GB for the OS) and load in seconds. The list is the models of
the switched-on classes; it is set by the operator (Helena's API has no write access to `/etc`);
Kingston on 2026-09-25: `Qwen3.6-35B-A3B-MTP-GGUF Qwen3-Embedding-0.6B-GGUF`.

**A load is never read as "down".** The claim's 2 s check asks Lemonade's `/health` (and
`/system-stats`, which may fail without effect). Lemonade 2026.39.1 releases its load mutex while a
backend starts ("Release lock before slow backend startup", `router.cpp`), and `/health` only
takes it briefly to list the loaded models, on a thread pool of ≥ 32; so `/health` answers during a
50 s GPU load or an NPU model's first load. The request that needs the model waits for the load
(Hermes' `stale_timeout_seconds` 240 s, the voice's 90 s), a request for another model waits
behind it (Lemonade loads one model at a time).

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
decision-model connection it is off and links to Zugänge. It uses browser-task's own queries, so
the card and Administrator → Browser-Steuerung show the same state.

**On Start** (hub/dashboard's contract, `docs/helena-decisions/dashboard.md`): a figure tile
"Lokale KI" (owner, group `system`, order 55): An/Aus, the GPU's load as a bar, the model in
memory or "Server nicht erreichbar" in red; a click opens this card in a dialog (master switch,
units, kinds of work, Jev / Laya). Hidden until a model server is set up. Red problems go to
"Braucht dich" through a `needsYouSources` entry (order 18, after the machine's and the host
audit's), only while local AI is on: an enabled server that does not answer, and a switched-on
class whose model failed its newest eval (§6.6). Both link to Administrator → Lokale KI.

**On Administrator → Server** (hub/server-admin): the host capability `local-ai` (area
`overview`, order 50) gives one health line per enabled server (`localAiServerUp`/`Down`, amber
when down: the agents fall back, and the red line is the one in "Braucht dich"), and the
`server-section` `local-ai` shows this card under the machine's own sections.

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
| hub/update-center (merged) | `UpdateSource` `local-ai`, check only: Lemonade and FastFlowLM versions (GitHub Atom feeds), each model's installed revision vs its repository's newest, a newer model of the same family (Qwen3.6 → Qwen3.7), and the watch list (`MODEL_WATCH`: Qwen Flash-Next, Qwen4 MoE) as "neues Modell verfügbar"; switching stays an owner click after a new eval | registered by `helena.local-ai` (`provides.updateSources`) | – |
| hub/server-admin (merged) | `HostCapability` `local-ai` on the overview and the `server-section` with the card (§7.5) | registered by `helena.local-ai` (API) and `extensions/serverSections` (web); messages `server.health.localAiServerUp/Down` in 10 locales | its fan installer builds DKMS for the running kernel only: `kernel.sh dkms` after it |
| hub/dashboard | the figure tile and the red problems (§7.5) | merged into this branch with the tile; click-checked (tile off/on/down, dialog, both problems, phone) | – (migration renumbered to 0179) |
| hub/browser-task (merged) | the Jev toggle uses its instance setting; Laya `--rocm` (§4.6) | the toggle uses its queries (`useInstanceBrowserControlQuery`, same cache as its page); `--rocm` built into its merged installer and server | its owner reviews the Laya change |
| hub/decisions | `decide()` with a local "logit readout" backend on this endpoint | the interface of §6.6 (class registration, `resolveLocalRoute`, the endpoint, logprobs verified) | it registers its own classes (router, mail, receipts); no decision classes here |
| hub/second-brain (merged) | the local embedding route | `useEmbeddingRoute(localAiEmbeddingRoute)` in API and worker | the owner's pgvector/embedding decision (§5.4) |

## 10. Honest limits

- Hermes needs ≥ 64k context; a 64k prompt takes ~2 min at 535 t/s prefill on the workhorse and
  ~5 min on the heavy model: long interactive chats stay on the subscriptions.
- GPU, NPU and CPU share ~256 GB/s: measured elsewhere, NPU decode loses ~6 % and GPU decode ~14 %
  when both run (1.42× overall throughput); a second GPU model costs far more than an NPU sidecar.
- The NPU is 3–4× slower than the GPU but frugal; it takes system RAM, not VRAM.
- ROCm on gfx1151 is not validated by AMD on Debian (its matrix lists Ubuntu); we run AMD's own
  distribution-neutral wheels, pinned, and keep Vulkan measured beside it. On 6.12 KFD gives
  ROCm only the GTT (15.5 GiB); whether 7.1.8 gives it the carve-out is checked, not assumed.
- ROCm generates ~25 % slower than Vulkan on the tiny model; the default is ROCm for its prefill,
  and a model whose bench says otherwise loads on Vulkan.
- The MTP workhorse may not combine `--mmproj` with several slots yet; the fallback is pinned.
- Lemonade pins model downloads to `main` only; Helena's installer pins by commit and runs
  Lemonade offline, so a repository change upstream never changes a running model.

## 11. Open owner decisions

1. Maintenance window for kernel → verify → promote (a reboot; RAID resync must be done).
2. mesa 26.1.6 from backports (after the kernel; measured).
3. None for ROCm: it is part of `install.sh` (owner ~00:25, "eher ROCm richtig"; ≈ 2.1 GB download,
   8 GB on disk). If 7.1.8's KFD still offers only the GTT, the big models run on Vulkan (§4.3.3).
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
Lemonade's source at v2026.39.1 (`src/cpp/server/backends/llamacpp/llamacpp_server.cpp`,
`backends/backend_utils.cpp`, `system_info.cpp`, `runtime_config.cpp`: rocm channel, `rocm_bin`,
TheRock runtime paths, the gfx1151 CWSR check, request forwarding);
github.com/lemonade-sdk/llamacpp-rocm; ggml-org/llama.cpp releases b10825/b11166 and b11166's
`CMakeLists.txt`/`cmake/build-info.cmake`; AMD's wheel index `stable.repo.amd.com/rocm/whl-next/`
(file sizes by HEAD); PyPI `laya` 0.3.20 metadata; hub/browser-task `native/laya/install.sh` at
`0046e9f0`;
local-llm-benchmarks.dev; kyuz0.github.io/amd-strix-halo-toolboxes; slb350.github.io/strix-benchmarks;
kyuz0 terminal-bench-mini; euroeval.com (German, 2026-09-20); sleepingrobots.com Lemonade NPU on
Strix Halo; hogeheer499-commits/strix-halo-guide; Hugging Face API for every pinned repository;
Hermes Agent docs (providers, configuration, fallback providers) in `/srv/volition/source/hermes`.
