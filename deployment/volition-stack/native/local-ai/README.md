# Local AI on the Strix Halo (Kingston): runbook

Decision and reasons: `docs/helena-decisions/local-ai-platform.md`. Everything here is an optional
host service; Helena works unchanged without it. Nothing runs on its own: the orchestrator runs
each step in a maintenance window, after the RAID resync (`cat /proc/mdstat` shows `[UU]`).

| Script | What it does |
|---|---|
| `kernel.sh` | trixie-backports pinned low; kernel `7.1.8+deb13-amd64` and `firmware-amd-graphics 20260810` at exact versions; one test boot through UEFI `BootNext`; verify, promote, rollback |
| `install.sh` | Lemonade Server 2026.39.1 on `127.0.0.1:13305` with a key; ROCm 10.0.0 + PyTorch (one hash-pinned tree, `/opt/helena-ai/rocm-10.0.0`); llama.cpp b11166 built for gfx1151 on it (default) and the Vulkan build of the same tag; FastFlowLM 1.0.6 + XRT 2.25 (NPU); the forwarder for isolated agents; the pinned model store. `status` includes the ROCm checks |
| `rocm-requirements.txt` | the ROCm/PyTorch wheels with their SHA-256 (`--require-hashes`) |
| `bench.sh` | llama-bench ROCm (hipBLASLt off/on) vs Vulkan: pp512/pp8192/pp32768, tg128 empty and at 32k; the task-class evals; GPU+NPU in parallel |
| `models.tsv` | every model with repository commit and SHA-256 of each file |
| `voice.sh` | German Whisper on CPU (12 threads, `--no-gpu`) and Qwen3-TTS on ROCm by default; proxy sockets on `127.0.0.1:13306/13307` start backend ports `14306/14307` on demand; `HELENA_VOICE_STT_BACKEND` and `HELENA_VOICE_TTS_BACKEND` select `cpu` or `rocm` |
| `voice-models.tsv`, `voice-register-voices` | the voice models (commit + SHA-256) and the start hook that registers the voices |
| `embed.sh` | Qwen3-Embedding-0.6B on `127.0.0.1:13308`, Vulkan by default (`HELENA_EMBED_BACKEND=rocm` selects ROCm); same model name, so the index's vectors stay valid |
| `tests/` | `python3 -m unittest discover -s deployment/volition-stack/native/local-ai/tests` |

## Order

Check that no agent run or chat answer is in flight before every reboot or service restart
(Home → Aktivität; `sudo ss -ltnp "sport = :3000"` shows one API).

1. **Kernel, prepared** (no reboot):
   ```sh
   sudo ./kernel.sh status
   sudo ./kernel.sh --dry-run prepare && sudo ./kernel.sh prepare
   sudo ./kernel.sh --dry-run install && sudo ./kernel.sh install
   ```
   `prepare` sets `GRUB_DEFAULT=saved` and pins the running 6.12 entry by name first, so
   installing 7.1.8 never changes the default. `install` keeps the old firmware package in
   `/var/lib/helena-ai/kernel/rollback/`.
2. **Test boot** (once): `sudo ./kernel.sh trial`, then reboot. The firmware boots the trial
   entry once (`BootNext`) and clears it. If 7.1.8 panics (`panic=30`) or hangs, the next reset
   (power button if it hangs) comes back on 6.12 by itself. No monitor is needed.
3. **Verify** on 7.1.8: `sudo ./kernel.sh verify` (report in `/var/lib/helena-ai/kernel/`):
   RAID `[UU]`, ESP-B = ESP-A, amdgpu + amdxdna loaded, `/dev/accel/accel0`, IOMMU on, no
   firmware or ring-timeout errors, the 96 GiB carve-out seen, `/dev/kfd`, KFD lists gfx1151 with
   `cwsr_size` + `ctl_stack_size`, no failed units, the Helena and isolation units active, every
   DKMS module built for both kernels. A **warning** (not a failure) when KFD still offers ROCm
   only the GTT (< 64 GiB): promote anyway; the big models then load on Vulkan (decision §4.3.3).
   `BootNext` not taken (still 6.12)? The firmware ignored it: pick "Debian (Kernel-Test)" once
   in the firmware boot menu (needs a keyboard and a screen), or leave it on 6.12.
4. **Promote**: `sudo ./kernel.sh promote`. 6.12 stays installed and in the GRUB menu, with its
   own security updates from trixie.
5. **Fans (hub/server-admin)**: `install-fan-control.sh install` after the promote, so DKMS builds
   `ec_su_axb35` and `ryzen_smu` for 7.1.8. Then `sudo ./kernel.sh dkms` builds them for 6.12 too
   (the fallback kernel keeps fan control). A module that does not build on 7.1: fans stay on the
   EC's own control (safe); report it.
6. **Local AI**: `sudo ./install.sh --dry-run install`, then without `--dry-run` (≈ 2.3 GB of
   downloads: ROCm + PyTorch 2.1 GB, llama.cpp source and Vulkan build, Lemonade, FastFlowLM; the
   HIP build takes ~5 min with 4 jobs). It refuses without `/dev/accel/accel0` (pass `--no-npu` for
   a GPU-only setup on 6.12; `--no-rocm` for Vulkan only). Then `sudo ./install.sh status`: ROCm
   10.0.0, `rocminfo` gfx1151, KFD memory "the carve-out: ok", HIP smoke "ok", llama.cpp lists the
   ROCm device, Lemonade healthy.
   Register it in Helena: Administrator → Lokale KI → "Server hinzufügen" (defaults are right), or
   ```sh
   sudo systemd-run --wait --pipe --collect --uid=volition-plan \
     -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan \
     /usr/local/bin/bun apps/api/src/scripts/local-ai-register.ts
   ```
   With agent isolation on, re-run `native/isolation.sh sync` so the launcher config has the
   `localai` forward (`127.0.0.1:13305` in every agent unit).
7. **Models** (owner OK given 2026-09-24 for the eval set), one at a time, each checked:
   ```sh
   sudo ./install.sh models list
   sudo ./install.sh models pull Qwen3.6-35B-A3B-MTP-GGUF && sudo ./install.sh models load Qwen3.6-35B-A3B-MTP-GGUF
   sudo ./install.sh models verify
   ```
   Pull the large ones (gpt-oss-120b 63 GB, Mistral Small 4 75 GB) only while nothing else is
   heavy: each read passes through the ~31 GB page cache.

   **Loaded at start:** Lemonade loads a model on its first request (~50 s for the workhorse),
   and a restart or reboot unloads everything. The GPU models Helena's switched-on kinds of work
   use (Lokale KI: their class's model) are loaded and pinned whenever Lemonade starts, by
   `helena-ai-preload.service` (installed and enabled by `install`; a oneshot after `lemond`,
   `PartOf` it, as a throwaway user with the key as a credential):
   ```sh
   sudo ./install.sh models preload list
   sudo ./install.sh --dry-run models preload set Qwen3.6-35B-A3B-MTP-GGUF Qwen3-Embedding-0.6B-GGUF
   sudo ./install.sh models preload set Qwen3.6-35B-A3B-MTP-GGUF Qwen3-Embedding-0.6B-GGUF
   sudo systemctl restart helena-ai-preload.service   # or: sudo ./install.sh models preload run
   ```
   `set` refuses a list over the VRAM budget (the GPU's memory minus 6 GiB; per model its
   weights + 5 % + 2.5 GB of KV cache: the workhorse ≈ 27 GB, gpt-oss-120b ≈ 69 GB, so both
   together with the embeddings do not fit), a model not pulled, and NPU models (FastFlowLM loads
   those on demand in seconds; they take system RAM). Pinned models are never evicted by
   Lemonade's LRU; `models load` for a benchmark still works next to them while VRAM allows,
   otherwise stop `helena-ai-preload.service` first (`systemctl stop` unloads nothing; unload with
   Lemonade's `/unload` or restart `lemond`, which loads the list again). After changing a class's
   model in Helena, `set` the list again. `models pull` restarts `lemond` only while nothing is
   loaded: with a preload list, restart it yourself before loading a newly pulled model.
8. **Measure and choose**: for every candidate
   `sudo ./bench.sh speed <name>` (ROCm and Vulkan; the faster backend per model goes into
   `models.tsv`'s last column, then `models load` again) and
   `sudo ./bench.sh evals <name> Qwen3-Embedding-0.6B-GGUF` (each class with its own thinking;
   a fourth argument `off`/`low` runs all classes with that level, to compare);
   `sudo ./bench.sh parallel Qwen3.6-35B-A3B-MTP-GGUF qwen3.5-2b-FLM`. Numbers go into the
   decision doc §5; losers are removed (`rm -rf /var/lib/helena-ai/models/hub/models--<repo>`).
   In Helena, run the evals of each class on the chosen model (Lokale KI → "Auswerten"), then
   the owner switches local AI on.
## Voice (hub/voice-2)

After step 6 (ROCm is there), in a quiet moment (no deploy, no full test: the two HIP builds take
~10 min with 4 jobs), once the owner approved the downloads (`docs/helena-decisions/voice-2.md`
§6, ≈ 3.1 GB with the voice-design model):

```sh
sudo ./voice.sh --dry-run install && sudo ./voice.sh install     # models, builds, units, proxy sockets
sudo ../hardening/apply.sh firewall                               # the new `voice` loopback ACL
sudo ../hardening/apply.sh --apply firewall && sudo ../hardening/apply.sh --apply confirm firewall
sudo ./voice.sh models pull qwen3-tts-1.7b-voicedesign            # 1.18 GB, only to design voices
sudo ./voice.sh voice design helena "A warm, friendly female voice in her early thirties with clear, natural standard German pronunciation. Calm, relaxed conversational pace, pleasant and slightly smiling."
sudo systemctl restart helena-voice-tts && sudo ./voice.sh status   # "voices: … helena …"
sudo systemd-run --wait --pipe --collect --uid=volition-plan \
  -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan \
  /usr/local/bin/bun apps/api/src/scripts/voice-register.ts           # helena-stt, helena-tts
```

Then in Helena (Administrator → Lokale KI): Transkription → `helena-stt/whisper`, Vorlesen →
`helena-tts/qwen3-tts` (both "Lokal bevorzugt"), Sprache → Stimme `helena`. The voice reply:
run the eval of "Sprachantwort (schnell)" on `helena-local/Qwen3.6-35B-A3B-MTP-GGUF`, then switch
it to "Lokal bevorzugt". Check: `node scripts/voice-live-check.mjs <recording.wav> VOL` through
the headless driver (transcription and speech timings), then a spoken turn in the chat — the
dot's tooltip shows where the time went.

Rollback: Lokale KI → Transkription/Vorlesen back to their previous model or "Aus" (instant);
`sudo ./voice.sh uninstall` (`--purge` also removes the models, the voices and the user).

## Rollback

- Kernel, before promote: nothing to do; the next reboot is 6.12. After promote:
  `sudo ./kernel.sh rollback`, reboot; `--purge` (on 6.12) also removes 7.1.8 and puts the old
  firmware back. An unbootable 7.1.8 after promote: pick "Debian GNU/Linux, with Linux 6.12…" in
  GRUB's "Advanced options", then `rollback`.
- Local AI: switch the master off in Helena (instant; agents back on their models), or
  `sudo ./install.sh uninstall` (`--purge` also removes key, models, downloads and the ROCm tree,
  which plain `uninstall` keeps for other local AI workloads). ROCm alone: `sudo ./install.sh --no-rocm install`
  (Lemonade back on Vulkan).

## What stays where

| Path | Owner | What |
|---|---|---|
| `/etc/helena/local-ai.key` | root:volition-plan 0640 | the key (API reads it; Lemonade gets it as a systemd credential) |
| `/usr/local/lib/helena-ai/` | root | `lemond-start`, `lemonade-defaults.json`, the installer's copy and `models.tsv` for `helena-ai-preload.service` |
| `/etc/helena/local-ai-preload` | root 0644 | the models loaded and pinned when Lemonade starts (`models preload set`) |
| `/var/lib/helena-ai/config/model-options.json` | API user, world readable | per-model backend, MTP/DFlash and slot settings saved by `PUT /god/local-ai/servers/:id/models/:model/options`; `models load <id>` and preloads read these on every load |
| `/etc/systemd/system/helena-ai-preload.service` | root | loads them after `lemond` starts |
| `/opt/helena-ai/llamacpp/{rocm,vulkan}-b11166/` | root | llama.cpp: our HIP build for gfx1151, the Vulkan build |
| `/opt/helena-ai/rocm-10.0.0/` | root | ROCm 10.0.0 + PyTorch 2.13 venv (8 GB), shared by local AI workloads |
| `/var/lib/helena-ai/models/hub/` | lemonade | pinned models (Hugging Face cache layout) |
| `/var/lib/helena-ai/kernel/` | root | verify reports, rollback firmware |
| `/etc/systemd/system/lemond.service.d/helena.conf` | root | loopback, key, limits, no network |
| `/etc/systemd/system/helena-ai-proxy.{socket,service}` | root | the forwarder for isolated agents |
| `/etc/apt/sources.list.d/helena-backports.sources`, `/etc/apt/preferences.d/helena-{backports,ai}` | root | backports at priority 1, Helena's packages at exact versions |
| `/opt/helena-ai/voice/{whisper-1.8.4,qwentts-6a3e91283}/` | root | the voice servers (voice.sh) |
| `/var/lib/helena-voice/{models,voices}/` | root:helena-voice / helena-voice | the voice models, the designed or cloned voices (`.spk`, `.rvq`, `.txt`, `.wav`) |
| `/etc/systemd/system/helena-voice-{stt,tts}.service` | root | the two servers, loopback only, sandboxed |
