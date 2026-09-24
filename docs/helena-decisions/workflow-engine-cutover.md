# Runbook: switching live from Mastra to the Helena engine

Package D ("Helena engine instead of Mastra"). Design in `workflow-engine.md`. The switch happens once, on Kingston, by the orchestrator. It takes about 20 minutes. Agents keep working during it. Workflow runs, agent-team runs and routines pause for a few minutes and then continue on the engine.

Everything below runs on Kingston (`ssh wilhelmpa@kingston-server.local`). Paths are the live ones as of 2026-09-24. Secrets are named by path only; nobody prints them.

## What changes

| Before | After |
|---|---|
| `volition-mastra.service` (Node, port 4111, LibSQL `/var/lib/volition/mastra/mastra.db`) and `volition-mastra-dev.service` | gone: the engine runs inside `volition-plan-api` (DBOS, schema `helena_engine` in database `itsaplan`) |
| `volition-hermes-team-bridge.service` (+ `-dev`, + `.wants`) | gone: agent-team stages are agent runs queued by the engine |
| `/etc/volition/mastra-control.token`, `/etc/volition/mastra-gateway.token`, `LoadCredential=mastra_control_token` in the api and worker units | gone |
| nginx `/etc/nginx/snippets/volition-mastra-studio.conf` (included in `/etc/nginx/sites-available/volition.conf`) and `/etc/nginx/conf.d/volition-mastra-gateway.conf` | gone: no `/mastra/` route. New public route on the api: `POST /hooks/workflows/:hookId` (webhook trigger), served through the existing api location |
| Routines in Mastra's `mastra_schedules` (live: 0 rows, checked 2026-09-24) | rows in `helena_schedule` |
| `mastra_*` tables in `itsaplan` (all empty) and 7 `project_setting` rows `mastra-agent-run:*` | dropped by migration `0168_helena_engine` |

The migration also drops `agent_team_start`, `pipeline_run.start_attempts/next_start_at`, `project_pipeline.schedule_id` and the unused `ai_agent` columns of the in-process runtime (`model_credential_id`, `tools`, `temperature`, `max_steps`, `api_key_*`, `memory_*`), and restricts `ai_agent.kind` to `external`. The old code cannot run on the migrated database. A rollback therefore restores the database dump (see "Rollback").

## 0. Before you start

1. `volition/hub` contains `hub/native-engine`. The full test suite is green against the baseline.
2. Nothing is mid-run that must not pause:
   ```sh
   sudo -u postgres psql -d itsaplan -c "select id, kind, status from pipeline_run where status in ('pending','running','waiting')"
   sudo -u postgres psql -d itsaplan -c "select count(*) from agent_run where status in ('pending','running')"
   ```
   Agent runs may keep going. Running Mastra workflow runs (agent teams) are not carried over. Let them finish, or cancel them in Settings → Workflows before step 2.
3. The API's database role `itsaplan` owns the database, so the engine creates its schema itself. Check it with `select datdba::regrole from pg_database where datname='itsaplan'`, which should return `itsaplan`.

## 1. Backups

```sh
ts=$(date +%Y%m%d-%H%M)
sudo install -d -m 0700 /var/backups/volition/cutover-$ts
# The database, with the Mastra mappings and tables the migration drops.
sudo -u postgres pg_dump -Fc itsaplan | sudo tee /var/backups/volition/cutover-$ts/itsaplan.dump >/dev/null
# A consistent copy of Mastra's own store (the routines live there).
sudo sqlite3 /var/lib/volition/mastra/mastra.db ".backup /var/backups/volition/cutover-$ts/mastra.db"
sudo sqlite3 /var/backups/volition/cutover-$ts/mastra.db "select count(*) from mastra_schedules"
```

## 2. Stop Mastra and the team bridge

```sh
sudo systemctl disable --now volition-mastra.service volition-hermes-team-bridge.service
sudo systemctl disable --now volition-hermes-team-bridge-dev.service 2>/dev/null || true
sudo systemctl stop volition-mastra-dev.service 2>/dev/null || true
```

From now on, a task delegated to a coordinator queues a direct run: the agent team is off until step 4. Routines do not fire.

## 3. Code and migration

Dev mode (current state: `dev-mode.conf` drop-ins, `bun --watch`):

The api and the worker stop first: `bun --watch` would otherwise start the new code on the old schema between the merge and the migration.

```sh
sudo systemctl stop volition-plan-api.service volition-plan-worker.service
cd /srv/volition/source/plan
git status --short            # clean apart from apps/web/next-env.d.ts; never reset or checkout here
git merge --ff-only volition/hub   # or: git merge hub/native-engine
bun install --frozen-lockfile
# The migration step of deploy.sh, by hand (the unit loads the env file itself):
sudo systemctl start volition-plan-migrate.service && systemctl status --no-pager volition-plan-migrate.service | tail -3
git -C /srv/volition/source/plan-dev merge --ff-only volition/native-chat-20260921
```

Then start them. The engine creates its schema `helena_engine` on the first start:

```sh
sudo systemctl start volition-plan-api.service volition-plan-worker.service
```

Release mode: run `deploy.sh`. Before the migration it stops, disables and removes the Mastra and team-bridge units (and their `-dev` units), takes the Studio include out of `/etc/nginx/sites-available/volition.conf` (restoring it if `nginx -t` refuses), then migrates, builds and restarts; it no longer builds or starts Mastra. Steps 2, the unit removal below and step 5's nginx part are then already done.

Then:

- Remove the Mastra credentials from the installed units. After the cleanup, the repo's `volition-plan-api.service` and `volition-plan-worker.service` no longer carry `LoadCredential=mastra_control_token` / `MASTRA_CONTROL_TOKEN_FILE`. Install them the way `deploy.sh` does, then run `sudo systemctl daemon-reload`.
- Remove the unit files: `/etc/systemd/system/volition-mastra.service`, `volition-mastra-dev.service`, `volition-hermes-team-bridge.service`, `volition-hermes-team-bridge-dev.service`, `volition-hermes-team-bridge.service.wants/`. Also remove the provisioning drop-ins `90-mastra-inbox.conf` and `91-mastra-control.conf` where they are installed. Then run `sudo systemctl daemon-reload`.
- Keep `volition-hermes-bootstrap.service` as it is. It requires `volition-plan-api.service`, not Mastra.

Check the engine:

```sh
sudo journalctl -u volition-plan-api -n 50 --no-pager | grep -i -E "engine|dbos"
sudo -u postgres psql -d itsaplan -c "select service, last_seen_at from service_heartbeat where service like 'engine%'"
sudo -u postgres psql -d itsaplan -c "select count(*) from helena_engine.workflow_status"
```

Home → Systemzustand shows "Helena-Motor" green, and "Motor-Wartung" runs within 5 minutes.

## 4. Routines and schedules

The script runs as the api's user with the api's environment. systemd loads `/etc/volition/plan.env`, so nobody reads it:

```sh
copy=/var/backups/volition/cutover-$ts/mastra.db
sudo install -o volition-plan -g volition -m 0600 $copy /var/lib/volition/mastra-import.db
run() {
  sudo systemd-run --pipe --wait --quiet --uid=volition-plan --gid=volition \
    --property=EnvironmentFile=/etc/volition/plan.env \
    --working-directory=/srv/volition/source/plan/apps/api \
    /usr/local/bin/bun src/scripts/import-mastra-schedules.ts --mastra-db /var/lib/volition/mastra-import.db "$@"
}
run            # dry run: prints what it would do
run --apply
sudo rm -f /var/lib/volition/mastra-import.db
```

(`bun` is wherever `volition-plan-api.service` runs it from.)

The script is idempotent:

- A second run prints "keep" for every routine.
- Imported routines start afresh. Times Mastra missed before the switch do not fire.
- It also rewrites the schedules of every enabled builder workflow with a schedule trigger, from Helena's own tables.

Then switch the agent team back on where it was on. The setting survived the migration (`project_workflow_assignment`), so nothing needs doing. Check it in Settings → Workflows → Eingebaute Workflows.

## 5. nginx and tokens

```sh
sudo sed -i.bak-cutover '/volition-mastra-studio.conf/d' /etc/nginx/sites-available/volition.conf
sudo rm -f /etc/nginx/snippets/volition-mastra-studio.conf /etc/nginx/conf.d/volition-mastra-gateway.conf
sudo nginx -t && sudo systemctl reload nginx
curl -o /dev/null -sS -w '%{http_code}\n' http://kingston-server.local/mastra/workflows   # 404 now
# The Mastra token files, by path only (do not print them):
sudo rm -f /etc/volition/mastra-control.token /etc/volition/mastra-gateway.token
```

When `nginx -t` fails, restore `/etc/nginx/sites-available/volition.conf.bak-cutover` and reload.

Left for later, harmless meanwhile (also in `docs/breaking-changes.md`): `/etc/volition/hermes-team.token`, the directory `/var/lib/volition/mastra` (after the backup of step 1), the system user `volition-mastra`, and `MASTRA_*` lines in `/etc/volition/plan.env`. The inbox triage of the integration service has no classifier after the switch (Mastra's was its only one); runs of it fail with "No inbox classifier is configured" until one on Hermes exists.

## 6. Acceptance (headless browser from the Mac, `~/volition/tools/hl.mjs`, console free of errors)

1. Home → Systemzustand: services runner, Helena-Motor, provisioning and worker are green. The engine line reads "Motor: 0 aktiv · …".
2. A test project, Zeitpläne:
   - Create a routine for an agent, then "Jetzt ausführen". A task appears and is delegated.
   - "Verlauf" shows the run as succeeded.
   - "Jetzt ausführen" again shows "Übersprungen: die vorige Aufgabe ist noch offen".
3. Settings → Workflows → Agent-Team on, then delegate a test task to the coordinator. The run shows the stages "Koordinator plant …". Cancel it, and "Erneut versuchen" works on a failed one.
4. Workflow builder: a workflow with agent, approval, notify and webhook steps. Test run, then a real run on a task. Approve the step in Freigaben.
5. Webhook trigger:
   - Workflows page, "Adresse erzeugen".
   - `curl -X POST -H "Authorization: Bearer <secret>" -H 'content-type: application/json' -d '{"title":"Hook test"}' http://kingston-server.local/api/hooks/workflows/<id>` returns 202. A task "Hook test" and a run appear.
6. Restart the api during a run that waits for an agent (`sudo systemctl restart volition-plan-api`). The run continues and finishes once.
7. Administrator → Allgemein → Helena-Motor → Zeitzone: set it, then check that a new routine shows it.

## Rollback

The migration removes tables and columns the old code needs, so a rollback restores the database. Everything the engine did after the switch is lost: runs, routine fires and new routines. Tasks and comments created after the switch are lost as well, because they live in the same database. Decide within the first hour.

1. `sudo systemctl stop volition-plan-api volition-plan-worker`
2. Restore the database:
   ```sh
   sudo -u postgres dropdb itsaplan_rollback 2>/dev/null
   sudo -u postgres createdb -O itsaplan itsaplan_rollback
   sudo -u postgres pg_restore -d itsaplan_rollback /var/backups/volition/cutover-$ts/itsaplan.dump
   sudo -u postgres psql -c "alter database itsaplan rename to itsaplan_engine_failed"
   sudo -u postgres psql -c "alter database itsaplan_rollback rename to itsaplan"
   ```
3. Put the code back:
   - Dev mode: in the live checkout, `git revert -m 1 <merge commit>`. Never reset.
   - Release mode: `deploy.sh` with the previous release.
4. Reinstall the Mastra units, drop-ins, credentials and nginx snippet from the previous release: `deploy.sh` does it, or `native/nginx/install-mastra-studio.sh` of that release. Then:
   ```sh
   sudo systemctl enable --now volition-hermes-team-bridge.service volition-mastra.service
   ```
   Mastra's own store was not touched, because the import read a copy.
5. Start the api and the worker. Home → Systemzustand shows Mastra and the bridge again.
