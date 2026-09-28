# Prepared Whisper activation through Helena

Follow-up to Point 7b, based on `4613f3117e514985f502e0c56de7b856297eaaed`.
This change exposes the existing fixed 1.9.4 operator through the normal Update
Center apply/action-history path. No source acquisition, build, GPU run or live
installation was performed while implementing it.

## Actual boundary

Only `local-ai/whisper-cpp` at 1.9.4 can be applied. Other local-AI software and
models remain check-only. The source advertises apply only when the root helper
reports the exact prepared version and an unexpired maintenance authorization.
A missing/old helper, missing build/voice proof, changed artifact, unknown
installed version, newer unprepared release or interrupted operation prevents
apply. The UI shows preparation, maintenance or recovery requirements.

The root spool action accepts only `action=whisper-ui`, `version=1.9.4` and the
existing request id. Paths, corpus, commands, source URLs and units cannot be
provided by the API. It runs the installed bridge with `/usr/bin/python3 -E -s`.
The bridge calls the unchanged `whisper_update.acceptance(..., activate=True)`:
fresh baseline, private candidate, comparison, exact unit switch and live speech
proof, with the existing automatic rollback. Successful completion requires the
persisted transaction phase `active`; a failed/partial rollback remains failed.
The existing action history includes running status, error and bounded result
with phase, speech-proof status and rollback artifact. It does not fabricate
percentage progress or call an incomplete build ready.

## Readiness and Root authorization

The existing operator must first have prepared and successfully verified 1.9.4,
using the fixed corpus directory `/var/lib/helena-whisper-corpus`. The bridge
rechecks the installed root-owned scripts, exact build/commit/settings and binary
hashes, baseline/candidate corpus hash and passing comparison, old binaries,
STT unit hash, TTS identity/unit hashes and model/voice metadata. Model-content
hashing is not added to the existing metadata contract.

Root then grants one five-minute admission window:

```sh
sudo /usr/bin/python3 -E -s /usr/local/lib/helena-whisper-update/whisper_ui.py authorize --corpus-sha256 ACTUAL_REVIEWED_MANIFEST_SHA256
```

This stores a root-only authorization bound to the complete verified proof.
It permits a single activation to start within five minutes. Root must keep the
reviewed GPU/voice window clear until that action and any recovery finish;
expiry is not a timer that kills work. The three existing heavy-job locks do
not exclude all live inference, and this bridge does not claim otherwise.
It does not stop Qwen, TTS, models or unrelated jobs.

In the normal authenticated UI: **Jetzt prüfen**, inspect the Whisper version
and readiness, choose **Aktualisieren**, then follow that action to completion.
The helper repeats readiness after exclusive admission; a stale UI row cannot
bypass expiry or changed proof. A busy transcription is refused without killing
it. No login, credential or model change is part of this operation.

## Voice admission and failure handling

Helena transcription holds PostgreSQL shared transaction advisory lock
`(748220, 13306)` from admission until the full HTTP response body is processed.
The native action acquires the matching exclusive lock without waiting. A new
transcription during activation receives HTTP 503 `voice-maintenance`.

Database connection loss cannot itself prove that the external transcription
has ended. Each admitted native request therefore creates a token under
`/var/lib/helena-updates/spool/voice-requests` before checking the root marker.
The callback removes its token only after successful full work completion,
even if its surrounding DB transaction rejected earlier. Transport errors,
invalid/incomplete responses or API process death retain the token for Root
reconciliation; they cannot silently make an update eligible.

Before inference, the updater publishes the root-only persistent marker
`/var/lib/helena-updates/voice-maintenance.json`, then verifies the request
directory is empty and heartbeats its exclusive DB connection. A request that
publishes later must see the marker before HTTP. This closes the connection-loss
admission race. The marker survives process and host restart. Normal completed
activation or verified automatic rollback clears only the marker belonging to
that exact action; uncertain restoration or candidate cleanup leaves it held.
TTS is unaffected. No marker or request token is removed by a timeout janitor.

For an interrupted activation, Root inspects the action and transaction, uses
the existing pinned operator's `cleanup`/`rollback` as required, and obtains a
fresh successful voice verification. Then:

```sh
sudo /usr/bin/python3 -E -s /usr/local/lib/helena-whisper-update/whisper_ui.py resume --corpus-sha256 ACTUAL_REVIEWED_MANIFEST_SHA256
```

`resume` does not execute inference. An old/health-only recovery needs a newer
matching verified speech proof than the interrupted UI action. Active recovery
requires exact current unit hash, build and preserved TTS/model state. Unknown
transaction phases, changed markers and incomplete candidate cleanup are refused.

Retained request tokens have no automatic deletion endpoint. Root must first
establish whether the original request/process is still running and prove the
backend is no longer processing it. Preserve the reviewed token as evidence by
moving that exact file out of the admission directory; do not blanket-clear it
or infer completion from PID reuse, file age or an HTTP timeout. Recheck no new
requests and the real voice baseline before authorizing another window.

## Installation and Root acceptance

The ordinary update-helper refresh installs all three modules in
`/usr/local/lib/helena-whisper-update` (root-owned directory 0755, files 0644)
and the request directory owned by `volition-plan`, mode 0770. That directory
is inside the API's existing writable update spool. The maintenance marker's
parent stays root-owned, API read-only. `deploy.sh` refreshes when any of the
three modules changes. Deployment performs no build or speech check and creates
no authorization window.

Root must deploy the API admission code and matching bridge together, prove the
actual API service can create/finish a synthetic request token under its systemd
sandbox, and compare installed scripts before authorizing any window. Complete
the exact Linux full gate first. Then retain evidence for:

- Missing proof/window: status readable, no Apply; unauthorized user denied.
- Running transcription: Apply refused; the request completes normally.
- Authorized exact 1.9.4: UI action, candidate/live speech evidence, preserved
  TTS/voice/models, installed version refresh and retained rollback record.
- Expired/tampered preparation and uncertain recovery: no false success.
- Database loss/HTTP failure/process interruption: request/marker remains held
  until the documented verified recovery; no restart of unrelated services.

The added real PostgreSQL/HTTP integration test keeps a transcription response
body open, proves exclusive admission is denied, then proves admission is
released after body completion. Update Center integration tests cover god-only
apply, exact spool dispatch and successful versus failed rollback history.
These Linux/private-DB cases were authored but not executed in this Mac-only task.
Local tests cover the native bridge, state binding, expiry, marker ownership,
late tokens, lost connection, recovery fences and a mocked DB lifecycle whose
outer transaction rejects before the actual HTTP work completes. Root's live
build/corpus/GPU/restore acceptance remains separate.

## Local validation and review

Final Mac checks: 50 update-helper tests, 76 Whisper tests (including 17 bridge
cases), five existing Voice tests and six TS status/spool/lifecycle tests all
pass. API typecheck passes using the existing local dependency cache with
`--preserveSymlinks`; no dependency was installed. Scoped API ESLint, web-app
ESLint for all ten changed locale files, Prettier, shell syntax and diff checks
pass. The real PostgreSQL admission/body-lifetime and god-only action-history
cases above remain unrun until Root's private Linux gate.

Independent source review closed the discovered DB-loss admission race, API
systemd write-path mismatch, current-action recovery attribution and active-unit
hash check. The final UI bridge SHA256 is
`b21d56eb32a38ad887baf8d3ef8cde4b0966303d0921bf7f26e9547b2e9b35c4`.
Review and offline checks are not a claim of installed code or live speech proof.
