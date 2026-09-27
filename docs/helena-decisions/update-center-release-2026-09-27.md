# Point 7b release and Root acceptance

Prepared 2026-09-27 on Point 7, `70a3cee4b2daf5e46b536c751c8c775121bd9bdf`.
Branch `codex/release-update-center-final`; product/operator head
`3ec9967ec07da63f83d0ae59a8f532c7994277ae`. Root gates and deploys this separate
candidate only after Points 4, 5, 6 and 7 are accepted. The cumulative prepared
branch is not a deployment target. No download, installation, server access,
GPU work, credential access or live update occurred during this assembly.

## Composition and dependencies

All product changes come from reviewed `codex/release-prepared` at `2d334045`.
No package, lockfile, database schema or migration changes are added here.
Point 7 ancestry supplies the deployed Mail tests, provisioning/runner changes,
token keeper, managed Codex launcher and existing update-helper fixture drain.

| Prepared source | This release | Scope |
| --- | --- | --- |
| `9590701c` (original `e0ceb80d`) | `d8e35aa4` | Five host-tool applies, helper refresh, offline Hermes check |
| `d18fa87a` (original `fe944cc2`) | `ffbc2f74` | Durable host-tool rollback snapshots |
| `9aaad2a1` (original `fff9aff0`) | `9852e042` | Initial UI read failure and GET-only retry |
| `27706e79` (original `ea16fbc4`) | `f0601976` | Fail closed on APT metadata failure |
| `7834a673` (original `2c7609bc`) | `cfb0cc6c` | APT freshness across helper/API/UI |
| `cd42d708` | `58d87f87` | Typed freshness fixture |
| `49bc6a97` | `b4e7c406` | Retry fixture includes freshness |
| `817c35cc` (original `985e2e92`) | `8b10c5e6` | Verified uv/uvx pair activation and rollback |
| `03d2833e` (original `d2c5e3a8`) | `3c234792` | Running Whisper version/status, no apply |
| `6b7cf756` (original `cb8c6edc`) | `e441beea` | Unknown installed version never means current |
| `ce6235b9`, `d1a23206` | `e3b5a656`, `29d6e2ca` | Eden Date fixture corrections |
| `86846b74` (original `5005f03f`) | `4c4af5f8` | Pinned Whisper prerequisites |
| `a093b07f` (original `78bda933`) | `a3df6ca8` | Synthetic corpus/voice acceptance operator |
| `e997f684` (original `16bb8324`) | `3ec9967e` | Pinned Whisper build/activation/rollback operator |

Integration resolutions: `deploy.sh` keeps the inherited security-audit refresh
and adds Hermes refresh exactly as in the prepared source. The unrelated
`final-ui-acceptance.md` status edit was omitted; no product hunk was dropped.
Of 65 changed files, 55 are byte-identical to `2d334045`; the ten `localAi.json`
files differ only in the excluded future JEV keys. Their Whisper keys match.

Local evidence: 47 update-helper tests, 59 Whisper tests, five existing voice
tests, five APT inventory tests, three Whisper status tests and seven web format
tests pass. The pure Whisper test uses a temporary tsconfig pointing `@helena/sdk`
to the actual `packages/sdk/src/updates.ts`, without SDK mocks. Bun emitted its
non-fatal temporary-config directory warning. Hermes helper: eight pass, six
cannot pass on macOS because existing backup code requires GNU `cp --reflink=auto`.
No portability change was made to the Linux helper. Shell syntax and diff checks
pass. API integration, real React UI tests, type/lint/format and the complete
Linux release gate remain Root's gate for this exact candidate.

## Deployment and installed-code proof

Use the normal exact-candidate trial merge/full gate/affected-service review/
fast-forward/deploy sequence. Preserve active work and existing tmux/browser/
Lemonade identities. Do not use a blanket streaming-chat prohibition for the
code deployment. Record reconnect/recovery for every affected service.

`deploy.sh` refreshes the existing update and Hermes helpers without a package
upgrade, fetch, release-track change or broad installer. After deployment:

```sh
sudo cmp /srv/volition/source/plan/deployment/volition-stack/native/updates/helena-update /usr/local/libexec/helena-update
sudo cmp /srv/volition/source/plan/deployment/volition-stack/native/updates/host_tools.py /usr/local/libexec/host_tools.py
sudo cmp /srv/volition/source/plan/deployment/volition-stack/native/hermes-update/helena-hermes-update /usr/local/libexec/helena-hermes-update
stat -c '%U %G %a %n' /usr/local/libexec/helena-update /usr/local/libexec/host_tools.py /usr/local/libexec/helena-hermes-update
sudo /usr/local/libexec/helena-update inventory
```

All comparisons must pass; root ownership, helpers 0755/module 0644. Inventory
must report exactly six `hostToolApply` ids: bun, node, code-server, wetty,
kasmvnc, uv. This supersedes the older five-id acceptance note. No broad
reinstallation if comparison fails: investigate the failed refresh.

## Actual Update Center execution

Use the existing authenticated Administrator → Updates UI (`/god/updates`, also
available in Server). Read state with `GET /god/update-center`; **Jetzt prüfen**
starts `POST /god/update-center/check`. Wait for completion and inspect persistent
`apt.refreshedAt`, `refreshAttemptedAt`, `refreshError` and `listsUpdatedAt`.
A recent global check or repository mtime alone does not prove APT freshness.
Failed metadata refresh must retain the prior good time and visible error, and
must prevent APT installation. Test failure paths offline, not by breaking live
package sources. Initial UI retry must only reread state, not start an update.

Root already has the owner's system-update authorization. Apply each selected
item through its normal dialog/action history, then wait for the action's final
state. The existing routes are `POST /god/update-center/items/:itemId/apply`
with `{ "scope": "item" }`, followed by
`GET /god/update-center/actions/:actionId`. Use actual item ids from current
state. The API records the action; APT also requires its configured pre-update DB dump.
Direct helper commands do not establish that UI/history/backup proof.

Historical approved targets below must be rechecked immediately before apply.
Do not downgrade, reinstall a current component or silently substitute a new
unreviewed target. Preserve the signed Debian sources, holds and exact pins.

| Item | Historical target and authenticated source | Smoke and affected services |
| --- | --- | --- |
| `host-tools/code-server` | 4.138.0 → 4.139.1; official `coder/code-server` tag `v4.139.1`, `code-server-4.139.1-linux-amd64.tar.gz`, 222167474 bytes, SHA256 `53029be6c5781b7bca49b815fcc9a2a3fc111813ad8c9965b2c0f0d2985a0674` | Only active `volition-code.service`; open an existing project file and editor terminal in Helena |
| `host-tools/uv` | 0.12.17 → 0.12.19; official `astral-sh/uv` tag `0.12.19`, `uv-x86_64-unknown-linux-gnu.tar.gz`, 19831732 bytes, SHA256 `23bf5552d220e0842b65c862097b2ebaeba0064b74eda5e565e77fd25969d8c8` | Both `/usr/local/bin/uv --version` and `/usr/local/bin/uvx --version`; shared current pointer; no service restart; compare `uv pip check --python /var/lib/volition/hermes/venv/bin/python` with its pre-update baseline |
| `apt/nodejs` | nodejs/libnode115/nodejs-doc, `20.19.2+dfsg-1+deb13u2` → `20.19.2+dfsg-1+deb13u3`; freshly signed Debian security index | Package versions, `/usr/bin/node --version`, Runner and active work recovery; managed `/usr/local/bin/node` stays 24.21.0; API/Web/terminal/browser checks and `sudo needrestart -b -r l` |

The two archive hashes/sizes are inherited from the source audit `641e3146`
(and its prepared copy `a21173c9`), not freshly fetched during assembly. Helpers
revalidate official metadata and bytes. Preserve the recorded source/digest,
old/new resolved executable, restarted unit set, result `smoke`, action id,
backup path and `rollbackArtifact` with its hash. Never log credentials.

Host-tool apply checks the global queue before download and again under SHARE
locks during activation; a busy response is a deferred update, not permission
to kill the owner's job. Code-server also needs its editor/build work checked;
uv needs no concurrent Hermes update/build. Let affected work complete and retry
normally. APT has no equivalent queue lock/drain: Root must coordinate the actual
package window, keep the existing Runner's `/usr/bin/node` use in scope, and
validate recovery. Do not claim autonomous APT concurrency safety from these
changes. Fresh simulation should confirm the exact three-package group and no
new/removal packages; review any changed candidate set before applying it.

Host-tool switch/restart/smoke failure restores the exact links and Kasm drop-in
from a root-only fsynced `rollback-*.json` under `/opt/helena/host-tools/<tool>`.
If the process dies, Root verifies that snapshot and fixed paths, restores only
its recorded links/drop-in and previously active units, then repeats the product
smoke. There is no generic rollback CLI: see
[the exact recovery procedure](host-tool-update-acceptance.md#defined-recovery-artifacts).
Keep both versions and all records. APT has no automatic rollback: before apply,
verify availability of the old exact `.deb` artifacts and host backup; a DB dump
alone cannot restore packages. Recovery uses the recorded exact old versions
and reviewed dependency simulation. Preserve package caches; no autoremove.

## Current components and newer canaries

In the UI, use **Hermes → lokal aktualisieren**, backed by
`POST /god/update-center/hermes/refresh-local`, to compare cached refs. Installed
`da443117` is ahead of stable 0.21.5/v2026.9.24 and must show no update. Preserve
release tracking/local reasoning patch; do not use semver alone to downgrade this
canary. llama.cpp b11166 is likewise newer than the audited stable v0.5.0.

Managed Codex 0.157.1 already exists in the inherited release. Check the UI row,
`/usr/local/bin/codex` resolution and a sanitized version probe, then a new Home
and development Codex tab. Existing sessions must remain attached; do not kill
them or touch their real CODEX_HOME. See
[codex-owner-runtime-update.md](codex-owner-runtime-update.md) for exact commands
and local-Qwen/MFA limits. Newer managed CLI versions use the existing UI source
`cli-runtimes` and installer; rollback is
`/usr/local/share/helena/runtimes/install-cli-runtimes.sh rollback codex`.

The audited current Bun 1.4.2, managed Node 24.21.0, KasmVNC 1.5.0, Wetty 3.2.2,
Claude/ACP, Lemonade/FLM, ROCm and Qwen TTS need fresh status evidence, not forced
updates. Keep all model/default/device choices. Future host-tool scopes remain
Bun → API/worker; Node → web/provisioning/project terminal/browser router;
Wetty → project terminal; Kasm → active displays and their active paired Chromium.
A capability can be proven without manufacturing an unnecessary upgrade.

## Whisper: separate CPU, GPU and live acceptance

The UI truthfully reports `local-ai/whisper-cpp` using the running executable
path. It does not offer Apply. The independent operator is prepared but is not
installed by this release's deploy hook. Root follows
[whisper-1.9.4-update-package.md](whisper-1.9.4-update-package.md):

1. Install its reviewed `whisper_update.py` and `whisper_acceptance.py` together
   root-owned under `/usr/local/lib/helena-whisper-update` (directory 0755,
   files 0644). Check Python namespace support. `python3 -E -s … plan` is read-only.
2. Acquire only official `ggml-org/whisper.cpp` commit
   `927cfce34f31707e17f2bff35c349632fb9e2c3a` in the new source directory described
   there. The tag is unsigned and has no prebuilt publisher HIP artifact.
3. Reserve the CPU build slot, recheck memory/disk, run its exact `prepare`
   command. Existing ROCm/gfx1151, two jobs, MemoryMax 8 GiB, network/devices
   disabled. This produces evidence, not a GPU acceptance.
4. Provide and review the pinned synthetic German corpus; old historical audio
   is absent. Reserve a separate voice/GPU window, preserve Qwen/TTS and all
   models, run exact `verify` and `activate` with the reviewed corpus hash.
   Baseline, candidate and post-activation speech must pass; health alone is
   insufficient. Only STT may restart, TTS voice `helena` stays unchanged.
5. Keep transaction/build/corpus/unit hashes and actual German WER/latency/VAD
   evidence. Prove a real Helena Voice interaction. Record the specified live
   restoration drill; `rollback` after interrupted activation restores exact
   unit/binary but `restored-health-only` still needs recorded speech proof.
   `cleanup` stops only the recorded private candidate. Never replay uncertain
   phases or run the old `voice.sh install` over accepted 1.9.4.

No source acquisition, build, corpus, GPU or live restoration evidence exists in
this assembly. Root records outcomes centrally; no Point-7b-complete claim until
the UI gap below and actual accepted updates are resolved.

## Smallest separate follow-up for Whisper in Helena

Assign a separate reviewed change after this assembly. Reuse the existing update
source, item dialog, root spool and action history; do not add another updater UI.
The first bounded UI Apply may activate only Root-prepared/reviewed 1.9.4, with
fresh baseline/candidate/live checks. Automatic preparation for arbitrary future
releases remains out of scope.

- `deployment/volition-stack/native/updates/helena-update`: advertise a fixed
  Whisper capability only after verifying installed root-owned operator, exact
  build/source/binary manifest and Root-reviewed corpus hash; dispatch a strictly
  allowlisted version/action using fixed trusted paths, never API URLs/commands/
  model or corpus paths. Persist actionable progress/errors in the current spool.
- `deployment/volition-stack/native/updates/install.sh`: copy both reviewed
  operator modules to their fixed root-owned directory on refresh. Add the
  scoped `deploy.sh` trigger when those two source files change. Do not build,
  acquire sources, run inference or activate STT during code deployment.
- `apps/api/src/modules/local-ai/whisper-update.ts` and `integrations.ts`: derive
  `applicable` from exact helper readiness; add `apply`/`progress` dispatch only
  for `whisper-cpp` and its proven target. All other local-AI/model candidates
  remain rejected. Use existing helper progress/backup and action results.
- `apps/api/src/modules/updates/sources/vendors.ts` plus inventory DTO if needed:
  bounded typed readiness/version/proof status. Existing update rows show why
  preparation is incomplete. Amend ten `localAi.json` messages and existing
  action/detail components only if the standard hint/result display is inadequate.
- Tests: helper absent/old, wrong target, tampered build/corpus, unknown component,
  non-owner rejection, failed voice proof/rollback, successful UI action/history
  and refresh to actual installed version. Retain operator recovery fences and
  TTS/model immutability; no test-only readiness bypass on live.

This follow-up must also choose a real voice maintenance admission contract.
The operator's point-in-time established-connection check and its package lock
do not drain application Voice traffic or coordinate other GPU jobs. Exposing
unconditional `applicable=true` would not meet the owner requirement safely.
