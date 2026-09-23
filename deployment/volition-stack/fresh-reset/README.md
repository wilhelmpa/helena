# Fresh data reset

This directory defines the destructive data reset that runs after the Plan
database/Garage reset and Hermes fresh-state bootstrap are complete.

The default command is a dry run:

```bash
./fresh-reset.py
```

It prints a secret-free JSON plan and the state of every required marker. It
does not stop services, rotate secrets, or modify data.

Create a short-lived marker for the latest verified encrypted Restic snapshot:

```bash
./fresh-reset.py --prepare-backup-marker
```

The marker contains snapshot identifiers, timestamps, reset versions, and a
digest of the required backup paths. It is valid for six hours. Marker
creation runs `restic check`, verifies the JSON `last-success` marker, selects
the newest snapshot across Restic path groups, and confirms every reset scope
is present in that exact snapshot. It does not modify the backup repository.

The required scope includes `current/mastra-data.tar`. Marker preparation
fails until the backup job captures the Mastra volume into that artifact.

Prepare requires four current markers and the explicit confirmation:

```bash
./fresh-reset.py --execute --confirm ERASE_VOLITION_FRESH_DATA
```

Required markers:

- `/home/pw/services/volition-backups/fresh-reset-marker.json`
- `/home/pw/services/volition-stack/reset-state/plan-reset.complete.json`
- - `/home/pw/services/volition-stack/reset-state/vault-ui-hidden.complete.json`

The Plan marker must confirm an empty Plan database, an empty reinitialized
Garage bucket, rotated Garage credentials, deleted plaintext DB backup and
legacy MinIO volumes, and exactly one technical HOME system scope with no
visible project. The fresh-state process must confirm the Hermes runtime is installed and its first-run state
erasure, trash purge, and hashed checkpoints. The Vault UI marker must match
the running Plan web image. Every marker uses reset version
`fresh-2026-09-22-v1` and names the same encrypted backup snapshot.

The command above is the destructive **prepare** phase. It rebuilds the services and writes only `/home/pw/services/volition-stack/reset-state/fresh-data-reset.prepared.json`. It never writes the completion marker. Repeating it with the same reset and script version returns `alreadyPrepared` without repeating any deletion.

After the rebuild, run the installed acceptance harness during the still-empty maintenance window:

```bash
./final_acceptance.py --execute --confirm RUN_VOLITION_FRESH_ACCEPTANCE
```

Its default invocation is a mutation-free dry run. Execute stops/restarts only the Hermes runner and standalone browser target, creates uniquely marked technical Plan rows, exercises the live runner and authenticated SSE endpoints, tests CDP/noVNC, deletes the technical Plan rows and exact Hermes test session, and writes the private `0600` marker only after cleanup succeeds. It never prints the agent key, Better Auth secret, temporary cookie, or provider credential. The marker `/home/pw/services/volition-stack/reset-state/fresh-runtime-acceptance.complete.json` is valid only when it:

- names reset `fresh-2026-09-22-v1`, script version `2`, and the same backup snapshot;
- contains the SHA-256 of the exact prepared marker;
- has `startedAt` at or after `preparedAt` and is no more than two hours old;
- records the exact Plan API/web image IDs plus hashes of the Hermes unit fragment and browser unit set;
- attests Plan run claim, heartbeat, and result; AG-UI stream plus terminal event; same-thread session resume; independent model and reasoning selection; Hermes active and profile persistence; and browser blank baseline, controlled restart, profile persistence, and noVNC WebSocket.

The marker also carries concrete `evidence` sections. `planRun` contains one run ID and ordered claim/heartbeat/success-result timestamps. `agUi` contains distinct first/second message IDs, one unchanged resumed session ID, frame count, `RUN_FINISHED`, `gpt-4.1`, and `medium`. `hermes` contains active/restart verification timestamps plus a SHA-256 profile marker. `browser` contains ordered blank/restart/persistence timestamps, a SHA-256 profile marker, loopback CDP `http://127.0.0.1:9223`, and loopback noVNC WebSocket `ws://127.0.0.1:6081/websockify`. All evidence timestamps must fall inside that acceptance run. Finalize recomputes the deployed Plan image IDs and Hermes/browser unit hashes and rejects drift since the acceptance.

Only then may the read-mostly finalize phase run:

```bash
./fresh-reset.py --finalize --confirm FINALIZE_VOLITION_FRESH_DATA
```

Finalize validates the bound E2E marker, reruns live drift checks, and writes `fresh-data-reset.complete.json` last. It does not repeat deletion or rotate secrets.

## Reset scope

- Mastra data volume and run state, including the exact `/home/pw/.mastra/analytics.json` file
- Nextcloud database, files, Redis, and former app password
- Vaultwarden state; Vault remains stopped and its local gateway route is removed
- Code workspace home and code-server user settings
- App-generated project workspaces under `/home/pw/services/volition-workspaces`
- Plaintext backup staging under `/home/pw/services/volition-backups/current`
- The versioned Paperless and legacy-app entries in the freedesktop trash
- Standalone Chromium profile
- Hermes sessions, memory, skills, cron jobs, caches, logs, test state, and credentials

The sole preserved Hermes credential is the existing Copilot credential pool.
It is held in memory during the reset and written into the fresh Hermes
`auth.json`. A temporary isolated Hermes home runs a one-line Copilot
acceptance check; the temporary home is removed afterwards. No credential
value is printed or passed as a command argument.

The reset rotates the Nextcloud database, admin, and Redis secret files with
atomic `0600` writes. Garage credential rotation belongs to the preceding Plan
reset because Garage metadata and credentials must be reinitialized together.

Cloudflare, SSH, the owner login, the canonical It's a Plan repository,
`/home/pw/Projekte`, the encrypted Restic repository, and its password file are
outside the reset allowlist. The sole backup-path exception is the exact
plaintext `current` staging directory. Its contents are deleted after the
encrypted snapshot scope and restore probes pass, while the private empty
directory remains. The generated repositories under
`/home/pw/services/volition-workspaces` are application data and are reset.

`legacy-trash-allowlist.json` names every Paperless or related legacy-app trash
entry that may be permanently removed. The script derives only the matching
`.trashinfo` names and checks that every allowlisted pair is absent. It never
empties either trash directory globally.

Vaultwarden stays stopped because a fresh instance with
`SIGNUPS_ALLOWED=false` has no usable owner. It is enabled only during a later
interactive owner setup.

Mastra starts from its current standalone Compose file. Its data volume is
recreated without adding an Hermes or Hermes IPC mount.

Backup and offsite timers are stopped before the first destructive operation.
The offsite timer starts after all fresh-service checks pass. The backup timer
stays stopped until `backup.sh` removes plaintext staging after every success
and failure path. Artifact sync, inbox watch, and the former Hermes
browser-ensure timer stay stopped until their fresh credentials and replacement
integrations are configured. A failed run leaves both backup timers stopped so
a partial reset is not captured as a valid fresh state.

The Vault UI requirement is fail-closed. The separate marker identifies the
deployed Plan web image that hides Vault. The reset removes the local gateway
route and verifies the restarted gateway. Vaultwarden remains stopped.

The completion marker is written only by Finalize after all post-rebuild E2E gates pass. Repeating Execute or Finalize for the same reset version validates the completion marker **and current live postconditions** (empty plaintext staging, Vault stopped and unrouted, legacy Plan volumes empty, backup timer inactive, Hermes runner active with Copilot-only model/reasoning configuration, healthy rebuilt containers, browser probe). Drift fails closed instead of returning success from JSON alone. A new reset requires a new reset and script version.

## Rollback

Before execution, rollback consists of removing these two installed artifact
directories; no application state has changed.

After Prepare starts, leave backup and offsite timers stopped until recovery
is complete. Use the `backupSnapshotId` shared by the four prerequisite
markers. Restore to a private staging directory first and run the existing
isolated database, Nextcloud, Garage, and Vault restore checks. Restore each
database together with its matching volume archive and secret set. Do not mix
the rotated Nextcloud or Garage secrets with an older database or metadata
archive. Restore the prior gateway config, Hermes home, browser profile,
workspace data, and app-generated project workspaces from the same snapshot.
Start application services only after the restore checks pass, then start the
backup and offsite timers.

## Tests

```bash
python3 -m unittest -v test_fresh_reset.py
```

The 29 tests cover harness dry-run and confirmation gates, JSON backup state, newest-snapshot selection, missing Mastra
backup scope, current/stale/mismatched/versioned markers, protected paths,
Copilot-only credential extraction, idempotent prepare/finalize, post-rebuild acceptance binding, live-drift guarded completion, and secret-free
dry-run output. They do not execute a reset.
