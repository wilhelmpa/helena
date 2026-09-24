# Local AI on the Strix Halo (Kingston): runbook

Decision and reasons: `docs/helena-decisions/local-ai-platform.md`. Everything here is an optional
host service; Helena works unchanged without it. Nothing runs on its own: the orchestrator runs
each step in a maintenance window, after the RAID resync (`cat /proc/mdstat` shows `[UU]`).

| Script | What it does |
|---|---|
| `kernel.sh` | trixie-backports pinned low; kernel `7.1.8+deb13-amd64` and `firmware-amd-graphics 20260810` at exact versions; one test boot through UEFI `BootNext`; verify, promote, rollback |
| `install.sh` | Lemonade Server 2026.39.1 on `127.0.0.1:13305` with a key, llama.cpp (Vulkan b10825, ROCm b1324 optional), FastFlowLM 1.0.6 + XRT 2.25 (NPU), the forwarder for isolated agents, the pinned model store |
| `bench.sh` | llama-bench at 0/32k/64k context, the task-class evals, GPU+NPU in parallel |
| `models.tsv` | every model with repository commit and SHA-256 of each file |
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
   firmware or ring-timeout errors, the 96 GiB carve-out seen, KFD `cwsr_size`, no failed units,
   the Helena and isolation units active, every DKMS module built for both kernels.
   `BootNext` not taken (still 6.12)? The firmware ignored it: pick "Debian (Kernel-Test)" once
   in the firmware boot menu (needs a keyboard and a screen), or leave it on 6.12.
4. **Promote**: `sudo ./kernel.sh promote`. 6.12 stays installed and in the GRUB menu, with its
   own security updates from trixie.
5. **Fans (hub/server-admin)**: `install-fan-control.sh install` after the promote, so DKMS builds
   `ec_su_axb35` and `ryzen_smu` for 7.1.8. Then `sudo ./kernel.sh dkms` builds them for 6.12 too
   (the fallback kernel keeps fan control). A module that does not build on 7.1: fans stay on the
   EC's own control (safe); report it.
6. **Local AI**: `sudo ./install.sh --dry-run --rocm-backend install`, then without `--dry-run`.
   It refuses without `/dev/accel/accel0` (pass `--no-npu` for a GPU-only setup on 6.12).
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
8. **Measure and choose**: for every candidate
   `sudo ./bench.sh speed <name> --rocm` and `sudo ./bench.sh evals <name> Qwen3-Embedding-0.6B-GGUF`;
   `sudo ./bench.sh parallel Qwen3.6-35B-A3B-MTP-GGUF qwen3.5-2b-FLM`. Numbers go into the
   decision doc §5; losers are removed (`rm -rf /var/lib/helena-ai/models/hub/models--<repo>`).
   In Helena, run the evals of each class on the chosen model (Lokale KI → "Auswerten"), then
   the owner switches local AI on.
9. **Laya on the GPU** (hub/browser-task's `native/laya/install.sh`, after its merge):
   `sudo native/laya/install.sh install --rocm` (diff in the decision doc §4.6).

## Rollback

- Kernel, before promote: nothing to do; the next reboot is 6.12. After promote:
  `sudo ./kernel.sh rollback`, reboot; `--purge` (on 6.12) also removes 7.1.8 and puts the old
  firmware back. An unbootable 7.1.8 after promote: pick "Debian GNU/Linux, with Linux 6.12…" in
  GRUB's "Advanced options", then `rollback`.
- Local AI: switch the master off in Helena (instant; agents back on their models), or
  `sudo ./install.sh uninstall` (`--purge` also removes key, models and downloads).

## What stays where

| Path | Owner | What |
|---|---|---|
| `/etc/helena/local-ai.key` | root:volition-plan 0640 | the key (API reads it; Lemonade gets it as a systemd credential) |
| `/usr/local/lib/helena-ai/` | root | `lemond-start`, `lemonade-defaults.json` |
| `/opt/helena-ai/llamacpp/` | root | pinned llama.cpp backends |
| `/var/lib/helena-ai/models/hub/` | lemonade | pinned models (Hugging Face cache layout) |
| `/var/lib/helena-ai/kernel/` | root | verify reports, rollback firmware |
| `/etc/systemd/system/lemond.service.d/helena.conf` | root | loopback, key, limits, no network |
| `/etc/systemd/system/helena-ai-proxy.{socket,service}` | root | the forwarder for isolated agents |
| `/etc/apt/sources.list.d/helena-backports.sources`, `/etc/apt/preferences.d/helena-{backports,ai}` | root | backports at priority 1, Helena's packages at exact versions |
