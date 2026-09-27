# Whisper 1.9.4 update package

Status: preparation only, 2026-09-27. Root owns every eventual source acquisition,
build, GPU acceptance and live activation. No new binary has been built or started.
Base: `7097f594`; isolated branch `codex/whisper-update-package-20260927`.

## Verified prerequisites

Read-only inventory on Kingston:

- Active `helena-voice-stt.service` and `helena-voice-tts.service`, both running as
  `helena-voice`. Existing STT executables are root-owned in
  `/opt/helena-ai/voice/whisper-1.8.4`; server 60,219,264 bytes, CLI 59,894,168 bytes.
- `/var/cache/helena-ai/downloads/whisper.cpp-1.8.4.tar.gz` is cached. The build
  directory is empty; the target 1.9.4 source is not cached there.
- Existing `/opt/helena-ai/rocm-10.0.0/bin` provides CMake 4.1.2 and Ninja
  `1.13.0.git.kitware.jobserver-pipe-1`. Ninja is absent from the ordinary PATH;
  no package installation is needed. System CMake is 3.31.6.
- Existing SDK root is
  `/opt/helena-ai/rocm-10.0.0/lib/python3.13/site-packages/_rocm_sdk_devel`.
  Its AMD clang is version 23.0.0git, source commit
  `8f497e0992fb7513f7f78a6f6b6f1056c375e961`.
  HIP headers and hip/hipBLAS/rocBLAS CMake packages exist. Git and ffmpeg exist.
- Approximately 1.3 TiB disk and 12 GiB host memory were available at inventory
  time. Recheck before building; use two compile jobs and an 8 GiB memory ceiling.
- The historical `~/agent-work/voice-2/data` corpus is absent on Kingston.
  Its old measurement report alone cannot satisfy a new release's acceptance.

## Exact source and build boundary

The only source target is official `ggml-org/whisper.cpp` commit
`927cfce34f31707e17f2bff35c349632fb9e2c3a`, release 1.9.4. The annotated release tag
is unsigned; no claim of publisher signing or a prebuilt HIP asset is made.
Acquire this exact Git object over the official HTTPS origin, verify object
integrity and HEAD, and record the source and resulting local binary hashes.
Do not infer a trusted publisher checksum from the downloaded bytes themselves.

Build with the existing ROCm SDK, `gfx1151`, project `BUILD_SHARED_LIBS=OFF`,
`GGML_STATIC=OFF`, HIP enabled, native host tuning disabled, and no curl/SDL or
network dependency resolution. Build under an unprivileged account with network
and GPU devices unavailable. Keep the old installed tree intact.
The pinned upstream [HIP build](https://github.com/ggml-org/whisper.cpp/blob/927cfce34f31707e17f2bff35c349632fb9e2c3a/ggml/src/ggml-hip/CMakeLists.txt)
requires HIP/ROCm 6.1 or later and rejects full static ROCm linking. Its GPU target
handling accepts the existing `gfx1151` configuration.

## Acceptance and activation boundary

Root must provide a reproducible manifest of synthetic German speech WAVs,
expected text and SHA-256 values. Silence/noise WAVs can be generated without a
speech model. Do not use owner recordings. Reuse the same files for the old STT
baseline and the private candidate. Test German speech, VAD silence/noise,
repeated requests and recovery after malformed input through
`/v1/audio/transcriptions`; record accuracy and latency against the baseline.
The pinned [server source](https://github.com/ggml-org/whisper.cpp/blob/927cfce34f31707e17f2bff35c349632fb9e2c3a/examples/server/server.cpp)
retains the request/inference path controls and a `/v1/health` endpoint for this
configuration. Health alone is insufficient acceptance.

Only after acceptance may Root change the STT executable. Preserve the complete
old STT unit durably before mutation, detect unexpected edits, and restore that
exact unit automatically if activation or post-activation speech checks fail.
A crash recovery command must use the same persisted record. TTS, voices,
model files, model registration, JEV and Qwen selections are outside this package.

## Operator package

`deployment/volition-stack/native/local-ai/whisper_update.py` is a fixed-version
operator tool. Its companion `whisper_acceptance.py` uses only Python's standard
library. Install reviewed copies together in a root-owned, non-writable directory
such as `/usr/local/lib/helena-whisper-update`, with mode 0755 for the directory and
0644 for both files. Use `/usr/bin/python3 -E -s` to ignore Python environment and
user packages. Kingston needs Python 3.12 or later for `os.setns`; the current
ROCm layout separately embeds Python 3.13.

The tool has no download operation and never runs `voice.sh install`.
`plan` prints fixed settings and is read-only. All other commands require root,
root-owned installed scripts, and an exclusive package lock. This lock coordinates
only this package. Root must still reserve the host build slot, check in-flight
work, keep the voice maintenance window clear, and respect the deployment order.
The established-connection check is a point-in-time guard, not a traffic drain.

### Source acquisition, performed by Root after package review

Use a new dedicated root-owned directory outside the live checkout. Fetch only
the approved source object; no submodule or package installation is needed. A
concrete sequence for the operator's root shell is:

```sh
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_NO_REPLACE_OBJECTS=1 GIT_TERMINAL_PROMPT=0
install -d -m 0755 /var/cache/helena-ai/whisper-source-1.9.4
git -C /var/cache/helena-ai/whisper-source-1.9.4 init
git -C /var/cache/helena-ai/whisper-source-1.9.4 remote add origin https://github.com/ggml-org/whisper.cpp.git
git -C /var/cache/helena-ai/whisper-source-1.9.4 -c core.hooksPath=/dev/null fetch --depth=1 origin 927cfce34f31707e17f2bff35c349632fb9e2c3a
git -C /var/cache/helena-ai/whisper-source-1.9.4 -c core.hooksPath=/dev/null checkout --detach 927cfce34f31707e17f2bff35c349632fb9e2c3a
```

This sequence is for a new directory; inspect an existing directory instead of
resetting or removing it. The helper requires the exact HEAD and official origin,
runs `git fsck --strict`, then exports the pinned Git object directly. It does not
build working-tree edits or run checkout filters. An archive hash records the
local exported bytes; the immutable Git object is the source pin.

### Build and inspect

After rechecking memory/disk and reserving `~/agent-work/heavy.sh --class test`,
Root may run the installed helper through the documented privileged operator path:

```sh
/usr/bin/python3 -E -s /usr/local/lib/helena-whisper-update/whisper_update.py plan
/usr/bin/python3 -E -s /usr/local/lib/helena-whisper-update/whisper_update.py prepare --source-repo /var/cache/helena-ai/whisper-source-1.9.4
```

The CPU build uses a transient DynamicUser service with two compile jobs,
CPUQuota=200%, MemoryMax=8G, TasksMax=64, RuntimeMaxSec=5400, PrivateNetwork=yes and
PrivateDevices=yes. Source directories are explicitly readable under umask 077.
The current CMake/Ninja/clang paths and `gfx1151` are fixed; configure runs without
FetchContent network resolution. No executable is started during artifact
validation, including `--help`, because upstream initializes backends before
parsing command-line arguments.

`readelf` must confirm x86-64, ROCm library search path, HIP/rocBLAS/hipBLAS
dependencies, and no shared project libraries. The helper then installs the two
executables and `build.json` in `/opt/helena-ai/voice/whisper-1.9.4` by an atomic
directory rename. A repeated prepare verifies the existing manifest and binary
hashes. Unknown or changed contents fail closed. The previous 1.8.4 directory is
preserved. This proves artifact integrity, not successful GPU inference.

Build logs (last 1 MiB per stream), source/build locations and the transient unit
name are recorded in `/var/lib/helena-whisper-update/1.9.4`. Normal failures stop
the build unit. After a killed operator process, inspect `build-attempt.json` and
stop only its named build service before another heavy job. Build/source trees
remain available for diagnosis; permanent cleanup remains the owner's action.

### Synthetic corpus and thresholds

No audio corpus is bundled. Restore the historical synthetic files from an
approved backup, or have Root generate a new corpus using already-installed local
speech voices, without changing Helena's TTS/models or fetching another voice.
Review each spoken sentence against its transcript before pinning the manifest.
Use at least three distinct German sentences, for example:

- `Bitte zeige mir die offenen Aufgaben für morgen.`
- `Erstelle einen Termin am Dienstag um vierzehn Uhr.`
- `Welche Projekte benötigen diese Woche meine Aufmerksamkeit?`

Include a separate digital-silence file and deterministic low-level noise file.
All WAVs must be mono, 16 kHz, signed PCM16, 0.25–20 seconds; three or more speech
cases plus silence and noise, 5–8 distinct files, at most 4 MiB total. Use flat
lowercase names and no symlinks. `manifest.json` has this structure, expanded to
all actual files with their independently checked hashes:

```json
{
  "schemaVersion": 1,
  "synthetic": true,
  "language": "de",
  "reviewedBy": "Root review reference and date",
  "fixtures": [
    {
      "id": "german-tasks",
      "kind": "speech",
      "file": "german-tasks.wav",
      "sha256": "REPLACE_WITH_ACTUAL_64_CHARACTER_SHA256",
      "expectedText": "Bitte zeige mir die offenen Aufgaben für morgen."
    }
  ]
}
```

Silence/noise entries use their respective `kind` and an empty `expectedText`.
Record the final manifest SHA-256 in Root's review evidence; pass that value
explicitly. The loader retains the verified audio bytes for all requests.

Each server receives three rounds of speech, both VAD files, malformed audio,
and another speech request after the rejection. Health checks surround recovery.
German normalization preserves words, numbers and umlauts. Acceptance requires
aggregate WER ≤10%, each case ≤20%, stable repeated text, empty VAD transcripts,
p50 ≤2 s and p95 ≤4 s. Candidate regression is limited to 2 percentage points WER
and 1.25× baseline latency plus 100 ms. Requests have a hard 20-second deadline,
responses a 64 KiB cap and a whole run a 180-second deadline. Both baseline and
candidate must pass; incomplete or inconsistent evidence is rejected.

### GPU verification, activation and recovery

Only Root runs these phases in the reserved voice maintenance window. They use
the GPU and temporarily load a second copy of the existing STT model. TTS must
remain running; verify available host/VRAM capacity first. The helper rejects
unexpected binaries, drop-ins, unloaded unit edits, model paths or lifecycle hooks.
It preserves the existing STT arguments, VAD, flash attention and model choices.

```sh
/usr/bin/python3 -E -s /usr/local/lib/helena-whisper-update/whisper_update.py verify --corpus /var/lib/helena-whisper-corpus --corpus-sha256 ACTUAL_REVIEWED_MANIFEST_SHA256
/usr/bin/python3 -E -s /usr/local/lib/helena-whisper-update/whisper_update.py activate --corpus /var/lib/helena-whisper-corpus --corpus-sha256 ACTUAL_REVIEWED_MANIFEST_SHA256
```

The candidate uses `Type=exec`, receives a private network namespace and binds port 13316 only
inside that namespace. Root's verification process enters the checked candidate
namespace temporarily and returns in a finally block. The host's existing Voice
ACL covers only 13306/13307; no unprotected host port is opened and no firewall
rules are changed. The candidate service is stopped after verification.

`activate` repeats fresh baseline/candidate checks, writes and fsyncs the complete
rollback record, replaces only the executable path in the STT unit, restarts STT,
and performs the speech checks again on the live port. It records binary hashes,
unit hashes, corpus evidence and TTS process/unit plus model/voice file metadata.
These metadata checks do not claim full model-content hashing. Any startup,
accuracy, latency or preservation failure triggers exact-unit restoration and
old-server speech verification. TTS is never restarted by the helper.

After an interrupted activation, use the durable record:

```sh
/usr/bin/python3 -E -s /usr/local/lib/helena-whisper-update/whisper_update.py rollback
```

Rollback refuses an externally changed unit or previous binary. Explicit recovery
restores 1.8.4 and checks health; its `restored-health-only` status deliberately
requires a separate recorded speech re-verification. Automatic rollback records
`restored-verified` only after speech checks pass. After an interrupted private
verification, this command stops only the hash-matching recorded candidate:

```sh
/usr/bin/python3 -E -s /usr/local/lib/helena-whisper-update/whisper_update.py cleanup
```

Keep `transaction.json`, `verified.json`, `baseline.json`, `candidate.json`,
`live.json` and any `rollback.json` with Root's acceptance evidence. The existing
system-update inventory derives the installed Whisper version from the running
executable path. This package does not enable a generic Whisper update button or
change unrelated UI. Never run the old `voice.sh install` over an accepted update;
its separate installation pin remains 1.8.4.

## Prepared validation and remaining proof

The package's 59 local offline tests pass. They cover source pin/origin rejection,
archive traversal, restrictive umask, namespace restoration, dirty loaded-unit
state, saved rollback ordering, failed startup/transcription and external-change
refusal, plus the corpus/HTTP/WER/VAD/repeated-request gates. No real network
request, CPU build, GPU inference or live activation was part of these tests.
An independent source review found five concrete issues; namespace isolation,
explicit directory modes, bounded health transport, loaded-unit consistency and
`Type=exec` close them. The final source review has no remaining findings.
The five existing `test_voice.py` tests also pass. A broader 85-test local run
has 80 passes and five unchanged `test_kernel.py` failures because its GNU
`sed -i` calls are incompatible with macOS BSD sed. No kernel code was changed;
the Linux-only remainder was not rerun on Kingston during Root's fullgate freeze.

Still required: exact source acquisition, installed Python namespace capability,
real ROCm build, reviewed synthetic corpus, baseline/candidate/live measurements,
and a recorded live restoration drill. The absent corpus and unbuilt binary are
explicit prerequisites, not accepted proof. Root alone records those results and
updates the shared handoff after the ordered live step.
