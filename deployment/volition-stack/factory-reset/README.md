# Factory first-run reset

`factory-reset.mjs` removes the current Volition application state and credentials while preserving source repositories, SSH, Cloudflare, the Plan schema, and the Drizzle migration history. It does not create an owner.

The command is a dry run unless both destructive flags are present:

```bash
node deployment/volition-stack/factory-reset/factory-reset.mjs --json
node deployment/volition-stack/factory-reset/factory-reset.mjs --dry-run --json
node deployment/volition-stack/factory-reset/factory-reset.mjs \
  --apply \
  --confirm ERASE_ALL_VOLITION_DATA_AND_ACCESS \
  --json
```

There is no backup or rollback gate. Apply deletes the Restic repository, backup staging, reset markers, Hermes fresh-state files, and application data. Recovery after apply requires reinstalling or reconfiguring the affected application. The script never prints generated secret values.

An interrupted apply can be run again with the same command. Preflight accepts only the exact original service-secret inventory or the exact post-reset inventory (`github_known_hosts` plus the newly generated `plan_mastra_control_token`). A stopped existing Plan database is started only after the non-database resume checks pass. Root-owned entries inside an already allowlisted data directory are cleared through an isolated Docker helper that mounts only that exact directory; paths outside the literal allowlists remain blocked.

## Result

- Plan retains every public table and `drizzle.__drizzle_migrations`, but every public table has zero rows. This includes users, accounts, sessions, passkeys, teams, projects, agents, tasks, API keys, app secrets, OAuth, SCIM, inbox, workflow, and Mastra tables.
- Plan Garage has a new technical credential set and an empty attachment bucket. Old agent, integration, auth, encryption, database, Garage, and S3 credentials no longer work.
- Plan API and web run behind the existing Cloudflare owner route. The worker, provisioning service, Hermes runner, SCIM automation, inbox jobs, and agent writers stay stopped and disabled.
- Vaultwarden stays installed and runs with a blank database. `SIGNUPS_ALLOWED=true` permits the deliberate first owner registration. Set it back to `false` and recreate Vaultwarden immediately after that registration.
- Nextcloud, Mastra, the code workspace, Hermes, and the standalone browser have empty persistent state. They stay stopped until their fresh setup step. The generated `/home/pw/services/volition-workspaces` tree is removed. The canonical Plan repository, Hermes source, and `/home/pw/Projekte` remain; workspace Codex, Claude, Copilot, code-server, and browser profiles are removed.
- Hermes units, package, state, connectors, caches, sandbox containers, and the reviewed trash entries are removed using the existing decommission allowlist. Host `~/.codex` is preserved for active control.
- Restic data, local dumps, backup markers, reset markers, checkpoint archives, test-compose containers/volumes, and backup/offsite units are removed.
- Host GitHub CLI and deploy credentials are removed. Repository contents and Git metadata remain. SSH and Cloudflare configuration remain unchanged.

## First registration

The source path is verified before reset. With no `app_setting` row, registration defaults to `open`. The first user receives role `god` when the user count is zero, and the post-create hook creates that user's personal team. The check is count based, so make exactly one registration request. The existing gateway limits the public Plan route to the Cloudflare owner, but registration must still be serialized. After the owner exists, close Plan registration before enabling any other route or writer.

## Execution sequence

1. Record the exact HEAD of each protected repository and validate the full Plan public-table allowlist.
2. Stop application writers before clearing state; Hermes is reinstalled and bootstrapped before acceptance.
3. Clear application state, then install and validate the Hermes runtime and runner.
4. Truncate all Plan public tables in one transaction, preserve migrations, and rotate the database password.
5. Clear Garage, residual Plan volumes, Nextcloud, Mastra, workspace, Hermes, browser, and Vaultwarden state.
6. Remove old user and service credentials, Restic, checkpoints, markers, and local backups. Generate only the new Plan/Garage and Mastra-control technical values required to run the blank Plan service.
7. Start Plan database, Garage, API, web, and blank Vaultwarden. Keep all application writers and the other applications stopped.
8. Verify zero Plan rows, preserved migrations, zero Vaultwarden users, fresh Hermes state and absent backups, disabled writers, the owner gateway route, and unchanged repository HEADs.

The reset is intentionally irreversible. A failure before the Plan transaction leaves existing data unchanged. A failure after that transaction stops the sequence and must be repaired from the reported postcondition; no automatic rollback is attempted.

## Tests

```bash
node --check deployment/volition-stack/factory-reset/factory-reset.mjs
node --test deployment/volition-stack/factory-reset/test/factory-reset.test.mjs
node deployment/volition-stack/factory-reset/factory-reset.mjs --json
```
