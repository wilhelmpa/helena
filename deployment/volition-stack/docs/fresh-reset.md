# Plan fresh reset

`deployment/volition-stack/scripts/fresh-reset.mjs` inventories the Plan PostgreSQL database and can replace its domain state with one minimal Home-chat bootstrap. Running it without `--apply` is read-only.

## Target state

The database contains:

- the active instance owner `patrick.wilhelm@volition.one`;
- the owner's existing identity account, passkeys and current sessions;
- at most the non-secret `app_setting` row named `auth`;
- one team named `Home` with MCP enabled;
- one private technical project named `Home`, key `HOME`, with MCP enabled and optional project features disabled;
- one external agent named `Home Master`, username `master`, attached only to `HOME`;
- one non-expiring Better Auth API key for that agent, stored as a SHA-256 base64url hash in PostgreSQL;
- the plaintext key once, in `/home/pw/services/volition-stack/.secrets/itsaplan_home_master_agent_api_key` with mode `0600`; `volition-hermes-runner.service` consumes that file through `LoadCredential=itsaplan_api_key:...`.

Every other public database table is reset. This includes projects, issues, documents, attachment metadata, workflows, actions, cycles, schedules, runs, agents, skills, tools, integration credentials, Git connections, notifications, inbox state, SCIM state, OAuth clients/tokens and all `mastra_*` state. `app_secret` is emptied, including stored SMTP, Telegram, OIDC and SCIM credentials. Non-owner users and prior agent users are removed.

The Plan Garage store is rebuilt with empty `meta` and `data` directories. The S3 access key, S3 secret, Garage RPC secret, admin token and metrics token are rotated. The bootstrap recreates only the empty `planner-attachments` bucket. Its full S3 manifest must contain zero objects and zero bytes.

The named volume `itsaplan_db-backups`, which contains historical unencrypted pre-migration dumps, and the disabled MinIO volume `itsaplan_minio-data` are archived into the encrypted reset backup, cleared and retained as empty initialized volumes. Their prior contents exist only in the verified Restic snapshot after the reset completes.

The web runtime hides the technical project through `HOME_CHAT_PROJECT_KEY=HOME` and selects the agent through `MASTER_AGENT_USERNAME=master`. The apply mode refuses to run until the active `itsaplan-web-1` container has that configuration.

## Excluded state

The script changes the Plan PostgreSQL database, Plan Garage state, the two Garage values in `/home/pw/services/itsaplan/.env`, the Garage configuration tokens and the single Hermes runner credential file. It does not delete Nextcloud, Vaultwarden, Hermes, legacy runtime or host workspace data. It does not hide Vault navigation or clear `VAULT_URL`; therefore its completion marker does not claim `vaultUiHidden`.

## Inventory

From the repository root:

```bash
node deployment/volition-stack/scripts/fresh-reset.mjs --json
```

The report contains database counts, the current Garage object manifest summary and entry counts for both residual Plan volumes. It contains no identifiers, credential hashes or secret values. This is the default mode and performs no writes.

## Apply prerequisites

Do not run apply mode until the complete reset has been authorized.

1. Run the encrypted Volition backup and confirm that `/home/pw/services/volition-backups/last-success` was written after `restic check` succeeded. The backup pauses Mastra Studio while archiving `volition-mastra-studio_studio-data` as `current/mastra-data.tar`; it also includes `itsaplan_db-backups` and legacy `itsaplan_minio-data` in a dedicated residual-volume archive. Before writing the marker, the workflow restores the count manifest, Mastra archive and residual archive from the exact new snapshot. It requires a non-empty regular `mastra-data/studio.db`, rejects links and paths outside that root, validates the other artifacts, removes the temporary restore and deletes only the explicit staging allowlist. `/home/pw/services/volition-backups/current` must then be a private empty directory. The JSON marker contains the full 64-hex restic snapshot ID, UTC completion time, `restoreProbeVerified:true` and `plaintextStagingEmpty:true`. It must be owned by the operator, not group/world writable and no more than 24 hours old. A legacy timestamp-only marker is rejected.
2. Set `HOME_CHAT_PROJECT_KEY=HOME` and `MASTER_AGENT_USERNAME=master` for the web service, then recreate `itsaplan-web-1`. The script checks the running container rather than trusting a local environment file.
3. Stop `volition-hermes-runner.service`. The script refuses to rotate or replace a credential while the runner is active. The script itself stops Plan API, worker and bot writers while Garage and PostgreSQL are reset.
4. Confirm that `/home/pw/services/volition-stack/.secrets/itsaplan_home_master_agent_api_key` does not contain an unrelated credential. An exact completed target with its matching key is accepted as an idempotent no-op; any mismatch fails closed.
5. Run the inventory again and retain its output with the reset change record.

## Apply

The destructive command requires both acknowledgements:

```bash
node deployment/volition-stack/scripts/fresh-reset.mjs \
  --apply \
  --confirm RESET_PLAN_TO_HOME \
  --backup-marker /home/pw/services/volition-backups/last-success \
  --json
```

Apply mode:

1. validates the encrypted-backup success marker;
2. asks Restic for the exact full snapshot ID from the marker and restores that snapshot's `database-counts.json` plus `plan-residual-volumes.tar` into a temporary private directory; it validates the count manifest and confirms both named volumes are present in the archive, then removes the temporary plaintext restore. Invalid snapshot identity, missing data or an invalid restored artifact stops the reset before any mutation;
3. verifies the web runtime and stopped Hermes runner;
4. removes any old completion marker, stops Plan writers and Garage, then atomically moves the old Garage `meta` and `data` directories into a private same-filesystem rollback directory;
5. creates fresh Garage directories, rotates its credentials and configuration tokens, starts Garage and verifies the newly bootstrapped bucket is empty;
6. archives the two residual named volumes into the same private rollback directory, clears both and verifies zero entries;
7. creates the Hermes runner credential file exclusively with mode `0600`;
8. obtains a PostgreSQL advisory lock, locks all public tables, validates the owner and resets the database in one transaction;
9. verifies the exact database target, credential and empty residual volumes after commit;
10. starts the Plan API, verifies the complete S3 manifest is empty, starts the worker and removes the Garage and volume rollback data;
11. writes `/home/pw/services/volition-stack/reset-state/plan-reset.complete.json` last, as a private regular file.

Before the PostgreSQL commit, any failure restores the old Garage directories, `.env` values, configuration and both named-volume contents, removes the newly created master credential and restarts the original services. After the database commit an automatic cross-system rollback is no longer safe; any verification failure removes the completion marker and stops Plan writers. Recovery then uses the encrypted snapshot. The local rollback data is retained only until database, volume and object-store verification succeeds.

The completion marker contains `resetVersion:"fresh-2026-09-22-v1"`, a non-empty exact `scriptVersion`, the backup snapshot ID, `backupRestoreVerified:true`, `backupPlaintextStagingEmpty:true`, database target counts, `planDatabaseEmpty:true` and `userDataEmpty:true`. It attests the hidden technical scope with `homeSystemScopeReady:true`, `homeChatProjectKey:"HOME"`, `visibleProjectCount:0` and `ownerCount:1`. Garage rotation fields include the bucket name, zero object count and empty manifest digest. It also records `planDbBackupsRemoved:true`, `legacyMinioVolumeRemoved:true`, `planDbBackupVolumeCount:0` and `legacyMinioObjectCount:0`; “removed” refers to the prior contents, while the empty named volumes remain provisioned for Compose. It never contains credential values or hashes. A second apply is an idempotent no-op only when the database target, master credential, empty Garage manifest, empty residual volumes, empty plaintext backup staging and completion marker all agree. A partial target fails closed.

## Re-attest an already completed reset

If a later system backup must replace the snapshot referenced by an already valid completion marker, run the same guarded command with `--reattest` after the new backup marker exists:

```bash
node deployment/volition-stack/scripts/fresh-reset.mjs \
  --apply \
  --reattest \
  --confirm RESET_PLAN_TO_HOME \
  --backup-marker /home/pw/services/volition-backups/last-success \
  --json
```

This mode never resets the database, rotates credentials or rebuilds Garage. It requires the old private completion marker and its exact reset-time database counts, the matching existing master credential, the HOME core rows, an empty Garage manifest, empty residual volumes and empty plaintext staging. It permits post-reset operational rows only in `hub_inbox_source`, `hub_inbox_event`, `hub_inbox_thread`, `revision` and `user_preference`. Those rows must be attributable to the HOME team/project and target users, have no issue, activity, run or legacy-project references, and have been created at or after the original `completedAt`. Because `revision` has no timestamp, it is accepted only when its transaction ID matches a permitted timestamped Hub row. Every other residual table remains forbidden.

The new backup marker must be fresh and reference a different full snapshot ID. Restic must find and restore-probe that exact snapshot before the completion marker is atomically replaced. The original reset `completedAt` and database counts remain unchanged; `backupSnapshotId` is updated and `reattested:true`, `reattestedAt` and `previousBackupSnapshotId` are added. The JSON report returns `changed:false` and `reattested:true`.

## Tests

```bash
node --test deployment/volition-stack/scripts/test/fresh-reset.test.mjs
node --test deployment/volition-stack/scripts/test/fresh-reset-volumes.integration.mjs
node --check deployment/volition-stack/scripts/fresh-reset.mjs
```

The tests cover confirmation gates, backup-marker validation, exact-snapshot restore gating before mutation, exact target counts, SQL transaction and table locking, residual-volume isolation, dry-run behavior, one-time credential creation, idempotent replay, re-attestation, tampered/stale markers, missing restore verification, unsafe operational rows and cleanup after a failed transaction. The Docker integration test creates temporary named volumes with the same unprivileged ownership as the live database-backup volume, proves that both volumes clear completely, restores their data and ownership from the rollback archive, and clears them again. It never mounts the live volumes.
