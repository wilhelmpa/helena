# Kingston: Halogen host memory policy

Research and read-only measurement: 2026-09-29, Halogen 0.14.2, Debian kernel
7.1.8+deb13-amd64, 131017316 KiB RAM, one NUMA node, 32 logical CPUs.
This is a reproducible serving baseline, not a measured global optimum.
No kernel setting, service, container or boot configuration was changed during this work.

## Policy and evidence

| Setting | Repository policy and reason |
|---|---|
| Weight locking | Unit defaults to `HALOGEN_WEIGHTS_LOCK=1`, `LimitMEMLOCK=infinity`, Podman `--ulimit memlock=-1:-1`; existing `halogen.conf` can override with `0`. Takes effect at the next planned start. |
| Compaction | Preserve Kingston's `vm.compaction_proactiveness=0` as the existing mitigation, pending A/B validation against `20`; this does not disable direct compaction or all kcompactd work. |
| Free reserve / swap | Preserve `vm.min_free_kbytes=1048576`, `vm.swappiness=10` on this 128 GB host. These exact values have no demonstrated Halogen optimum. The reserve does not guarantee contiguous blocks; low swappiness is not weight locking. |
| THP | Persist `enabled=madvise`, `defrag=madvise`. Explicit hugepage requests can still reclaim/compact synchronously. `defrag=defer` is a future latency experiment, not a validated winner. |
| HugeTLB | No pre-reserved pool (`nr_hugepages=0` observed). HugeTLB requires application mappings and removes memory from general use; the reviewed Halogen interface documents no such allocation path. Reserving a large pool is therefore unjustified. |
| Watermarks | Keep observed `watermark_scale_factor=10`; direct-reclaim deltas justify a separate experiment with `100`, not an automatic change. |
| NUMA / reclaim | Keep observed `zone_reclaim_mode=0`, `numa_balancing=0`; one node offers no inter-node placement choice. No numactl binding. |
| CPU | All 32 policies already use `amd-pstate-epp`, governor/EPP `performance`; leave them unchanged. EPP is a hardware performance/energy hint, not a guaranteed GPU throughput improvement. |
| IRQ / affinity | Engine allowed CPUs `0-31`, amdgpu IRQ 162 affinity `0-31`. Leave scheduler/IRQ affinity unchanged: no measured contention supporting a fixed CPU mask. |
| cgroup | Retain delegated split cgroups, no new MemoryHigh/MemoryMax, MemoryMin, CPUQuota or OOM adjustment. Finite memory.high throttles/reclaims; memory.max can OOM. Bound competing workloads separately after measuring their demand. |

The [Halogen README](https://github.com/peonist-ai/halogen-flash-server/blob/main/README.md#give-it-a-machine-of-its-own)
documents opt-in mlock since 0.13.2, pressure tests and the resulting OOM tradeoff;
GPU registration alone leaves weights reclaimable to the kernel.
It also reports that disabling proactive compaction did not cure stalls and delayed startup.
The [flag reference](https://github.com/peonist-ai/halogen-flash-server/blob/main/docs/FLAGS.md)
says flags are startup-only; `WEIGHTS_LOCK` is described in the README rather than its table.

Kernel sources: [VM controls](https://docs.kernel.org/admin-guide/sysctl/vm.html),
[THP](https://docs.kernel.org/admin-guide/mm/transhuge.html),
[HugeTLB](https://docs.kernel.org/admin-guide/mm/hugetlbpage.html),
[amd-pstate](https://docs.kernel.org/admin-guide/pm/amd-pstate.html),
[IRQ affinity](https://docs.kernel.org/core-api/irq/irq-affinity.html),
[cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory).
Our choice to retain untested settings and reject speculative affinity/hugepage changes is an
inference from those mechanisms and the observations below, not a vendor benchmark result.

## Read-only baseline measurement

Existing `/tmp/hbench.py`, invoked through `~/agent-work/heavy.sh timeout 240 python3
/tmp/hbench.py`, issued four short greedy, non-thinking streaming requests (400-token cap)
and one synthetic log prompt (120-token cap), sequentially against localhost:8731.
No cache flush, competing allocation, model reload or configuration change was performed.

| Request | Input / output tokens | TTFT seconds | Decode tok/s | Wall seconds |
|---|---:|---:|---:|---:|
| RAID | 30 / 143 | 0.69 | 32.8 | 5.0 |
| Python | 42 / 400 | 0.54 | 41.5 | 10.2 |
| Local AI | 34 / 400 | 0.50 | 32.5 | 12.8 |
| TypeScript | 36 / 400 | 2.84 | 26.5 | 17.9 |
| Synthetic log | 28425 / 44 | 33.28 | 36.2 | 34.5 |

Short-request mean decode: **33.3 tok/s**; long input/TTFT: **854 tok/s**.
The existing bench measures HTTP timings, not engine-only prefill; tokenization, queueing,
cache reuse and first-token work can affect TTFT, and its decode formula includes the first token.
These are single-run serving observations, not an isolated A/B or a throughput guarantee.

| Observation | Before (00:04:35 CEST) | After (00:05:56 CEST) | Delta |
|---|---:|---:|---:|
| `/health` seconds, status ok, idle | 1.0080 | 1.0091 | +0.0011 |
| `compact_stall` | 57812 | 57815 | +3 |
| `compact_fail` | 42957 | 42957 | 0 |
| `compact_success` | 14855 | 14858 | +3 |
| `compact_daemon_wake` | 39872 | 39872 | 0 |
| `allocstall_normal` | 103697 | 105079 | +1382 |
| `allocstall_movable` | 743740 | 753051 | +9311 |
| `pgscan_direct` pages | 243231296 | 245021297 | +1790001 |
| `pswpin` / `pswpout` pages | 7840129 / 14835821 | 7846367 / 14844508 | +6238 / +8687 |
| MemFree KiB | 2789688 | 1664904 | -1124784 |
| MemAvailable KiB | 79252328 | 77682408 | -1569920 |
| Mlocked KiB | 0 | 0 | 0 |

Counters are host-wide; attribution to Halogen alone is not possible.
Engine PID 1274648 had RSS 75897284 KiB, VmLck 0 and unlimited soft/hard memlock.
GTT used was 39832043520 bytes out of 128849018880 (37.10 / 120 GiB), a host-wide snapshot.
The unit's memory.current was only 2515664896 bytes; do not size its cap from that number:
file-cache charges can belong to their original cgroup, and driver accounting is separate.
Its memory.events and memory PSI totals were zero at inspection despite host-wide reclaim.

The task's historical baseline is a 46-second PING silence, compact_stall +470 and health
timeouts up to 10 seconds on September 28; those are supplied observations, not reproduced here.
`journalctl -u helena-halogen --since 2026-09-28 -g 'has not answered PING'` could not access
the system journal as this user. An empty result is **not** evidence of zero PING stalls.
Raw benchmark and before/after JSON: `~/agent-work/codex-tasks/87-messung/`.
There is no post-tuning speed measurement: live changes were prohibited.

## Installation and later validation

`install.sh --dry-run install` previews the two files under `/etc/sysctl.d/` and
`/etc/tmpfiles.d/`, their scoped `sysctl -p FILE` / `systemd-tmpfiles --create FILE`
application and the new unit. Normal `install` performs them, preserves existing model
settings and leaves an active Halogen running unless `--restart` is supplied.
The system sysctl/tmpfiles services reapply the files at boot; the installer never rewrites GRUB.
`status` reports file drift separately from runtime drift, inspects engine memlock/VmLck,
and shows CPU, auxiliary VM and cgroup values without changing them.
Matching file contents do not guarantee runtime values: later boot services may override them.

For the operator's later maintenance window (none executed here):

1. Review the dry run, then apply the installer as root under the usual installation policy;
   it also manages image/assets/network/firewall, so inspect those steps too.
2. When no request is active or queued, perform one planned service restart to enable mlock;
   check `checkpoint: locked` in its journal and the engine's VmLck/limits with `status`.
   Confirm enough real host memory remains; locking can expose pressure as OOM rather than a hang.
3. Repeat the same bench and counter/journal window; compare cold/warm cache conditions
   explicitly. Do not claim a prefill gain from an exact repeated cached prompt.
4. With weights locked, test one variable per window: proactive compaction `0` versus kernel
   default `20` (include startup time), then watermarks `10` versus proposed `100` if direct
   reclaim persists, then THP defrag `madvise` versus `defer`. The latter two do not require a
   service restart; all are unperformed live changes requiring a separate maintenance decision.
   Keep only changes that reduce stalls without unacceptable serving regressions.

Rollback weight locking by setting `HALOGEN_WEIGHTS_LOCK=0` in the existing settings file and
restarting only in a maintenance window. Restore previous sysctl/tmpfiles files and their
previous runtime values to roll back host policy; removing files alone does not reset runtime.
Uninstall retains the host policy even with `--purge`, because other services share it.

## Kernel command line: separate confirmed step

Observed boot arguments: `ttm.pages_limit=31457280 amdgpu.noretry=0 iommu=pt`.
The TTM ceiling is 120 GiB at 4096-byte pages, not a reservation; current GTT use does not
justify increasing it. Preserve this baseline rather than copying reference-machine sizes.
[Halogen's reference-host discussion](https://github.com/peonist-ai/halogen-flash-server/blob/main/README.md#the-host-settings-these-numbers-were-measured-on)
reports a 13–16% prefill improvement for `amd_iommu=off`, but the other boot flags are not
independently A/B validated; `noretry=0` can turn a mapping fault into a silent hang.
The [Strix Halo guide](https://github.com/hogeheer499-commits/strix-halo-guide#step-12-choose-the-iommu-policy)
keeps IOMMU enabled for normal use and treats disabling it as an optional desktop benchmark
profile, with NPU/suspend and DMA-isolation costs.

Only after a separate explicit decision: review current GRUB arguments, replace the IOMMU
policy without leaving contradictory flags, regenerate GRUB and reboot once in a maintenance
window; benchmark before/after, confirm required devices still work and retain the previous
boot entry for rollback. No GRUB fragment is installed automatically. HugeTLB boot reservations,
additional amdgpu flags and CPU isolation flags have no supporting Kingston measurement here.
