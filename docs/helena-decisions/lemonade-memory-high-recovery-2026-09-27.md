# Lemonade memory pressure recovery — 2026-09-27

Lemonade uses `MemoryHigh=11G` (11,811,160,064 bytes) and
`MemoryMax=12G` (12,884,901,888 bytes). The high threshold gives the observed
resident set enough room to serve requests. The hard memory limit remains 12 GiB.

The source is `deployment/volition-stack/native/local-ai/systemd/lemond-helena.conf`.
`local-ai/install.sh` copies that file to
`/etc/systemd/system/lemond.service.d/helena.conf`. The separate STT/TTS limits,
preload list, model parameters, pins and offline configuration are unchanged.

## Live evidence

Root recorded the incident and the bounded recovery in
`/var/lib/helena/hardening/backup/lemonade-memory-recovery-20260927`.
The observations below were reported by Root from that probe. This source change
does not run the probe or restart a service.

Before recovery, `lemond` was active and port 13305 was listening, but both
`HEAD /live` and unauthenticated `HEAD /api/v1/health` timed out after two seconds.
The thread sample showed 128 sleeping threads in two futex groups, an idle accept thread, and
two hot threads. The service cgroup consumed approximately one CPU second per
second in system time, with no user-time increase in the sampled interval.

| Measurement | Before the runtime change | After the runtime change |
| --- | --- | --- |
| `MemoryHigh` | 10,737,418,240 bytes | 11,811,160,064 bytes |
| `MemoryMax` | 12,884,901,888 bytes | 12,884,901,888 bytes |
| `memory.current` | 10,824,290,304 bytes | approximately 10.824 GB |
| `memory.events:high` increase | 564 in one second | 1 in twelve seconds |
| Service CPU time increase | 0.991 seconds in one second | 0.60 seconds in twelve seconds |
| Memory PSI `full avg10` | 12.38% | 5.53% |
| `HEAD /live` | HTTP 000 / timeout | HTTP 200 |
| Unauthenticated `HEAD /api/v1/health` | HTTP 000 / timeout | HTTP 401 |

The earlier memory-pressure sample also recorded `full avg60=22.44%` and
152,261 microseconds of full-stall time in one second. These are different
measurement windows from `avg10`. The host reported critical CPU temperature
of 96.9°C before recovery. The successful probe reported about 12.96 GB of host
available memory; it did not establish a post-recovery temperature result.

Root held all three heavy-work locks and verified no active Helena work before
changing the runtime property once. The probe required at least 8 GiB host
available memory, the expected old thresholds and service identity. It recorded
the before-state durably, changed only `MemoryHigh`, then checked service identity,
OOM counters, available memory and the HTTP results over twelve seconds.

PID 3336 and invocation ID `4204312cc3044330969ad6ca38b8d447` were unchanged.
There was no service restart, model load or unload, inference, GPU reset, or
change to `MemoryMax`. Root subsequently observed three idle, nonstreaming
standard residents: pinned `Qwen3.6-35B-A3B-MTP-GGUF`, pinned
`Qwen3-Embedding-0.6B-GGUF`, and unpinned `whisper-v3-turbo-FLM`.

## Interpretation and operating limits

The kernel puts a cgroup above `memory.high` under reclaim pressure and throttles
its processes. The `high` event counter counts this path. `memory.max` provides
the separate hard limit. The measured pressure and recovery after changing only
the high threshold support memory reclaim/throttling as the immediate cause of
this HTTP outage. See the
[kernel memory-controller interface](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files).

This observation covers the resident set and idle recovery above. It does not
establish a leak diagnosis, capacity for additional models, or stability under
all context lengths and concurrent inference. Extra model loads still require
the normal memory, temperature, residency, offline-cache and in-flight checks.
Qwen3.8 acceptance remains separate.

Persist this threshold through the reviewed source and normal Root gate. The
successful runtime override remains documented until the persistent setting is
verified; no timer restores 10 GiB while usage remains above that threshold.
Before removing the runtime override, Root must verify the installed persistent
11 GiB setting so it cannot reintroduce the stalled 10 GiB configuration.
Only the MemoryHigh override owned by this recovery may be removed; unrelated
systemd overrides must remain intact.

The service stayed running, so Root can capture actual model parameters and
pins before further inference. Raw health output includes process launch data;
retain only the reviewed secret-free projection. A successful HEAD check alone
does not prove a complete model baseline or an inference/tool round trip.
