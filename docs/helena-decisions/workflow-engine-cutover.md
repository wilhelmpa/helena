# Runbook: switching live from Mastra to the Helena engine

Package D ("Helena engine instead of Mastra"). Design in `workflow-engine.md`. The switch happens once, on Kingston, by the orchestrator, in release mode (dev mode ended on 2026-09-24; `deploy.sh` ships). It takes about 20 minutes. Agents keep working during it; the agent team of VOL and VERVE and every routine pause for a few minutes and then continue on the engine.

Everything below runs on Kingston (`ssh wilhelmpa@kingston-server.local`). Paths are the live ones as of 2026-09-24. Secrets are named by path only; nobody prints them.

Live state checked read-only on 2026-09-24 ~15:30: `pipeline_run` 0 rows, no enabled builder workflow, 173 migrations applied (0000–0172; `0173_helena_provider_limits` was being deployed right after), 7 `project_setting` rows `mastra-agent-run:*`, `mastra_schedules` in `/var/lib/volition/mastra/mastra.db` 0 rows, agent team on for VOL and VERVE (`project_workflow_assignment`). Running: `volition-mastra`, `volition-hermes-team-bridge` and `volition-hermes-team-bridge-dev` (the `-dev` bridge is pulled in by `volition-hermes-team-bridge.service.wants/`, so it kept running after dev mode ended).

## What changes

| Before | After |
|---|---|
| `volition-mastra.service` (Node, port 4111, LibSQL `/var/lib/volition/mastra/mastra.db`), `volition-mastra-dev.service` | gone: the engine runs inside `volition-plan-api` (DBOS, schema `helena_engine` in database `itsaplan`) |
| `volition-hermes-team-bridge.service`, `-dev`, `volition-hermes-team-bridge.service.wants/` | gone: agent-team stages are agent runs the engine queues |
| `LoadCredential=mastra_control_token` / `MASTRA_CONTROL_TOKEN_FILE` in the api and worker units; `MASTRA_EVENT_INGRESS_ENABLED` in the provisioning unit | gone (the repo's units no longer carry them; `deploy.sh` installs them) |
| `/etc/volition/mastra-control.token`, `/etc/volition/mastra-gateway.token` | moved into the cutover backup by hand (step 4) |
| nginx `include /etc/nginx/snippets/volition-mastra-studio.conf;` in `/etc/nginx/sites-available/volition.conf`, `/etc/nginx/conf.d/volition-mastra-gateway.conf` | gone: no `/mastra/` route. New public route on the api: `POST /hooks/workflows/:hookId` (webhook trigger), served through the existing api location |
| Routines in Mastra's `mastra_schedules` (live: 0 rows) | rows in `helena_schedule` |
| `mastra_*` tables in `itsaplan` (all empty) and the 7 `project_setting` rows `mastra-agent-run:*` | dropped by migration `0174_helena_engine` |

The migration also drops `agent_team_start`, `pipeline_run.start_attempts/next_start_at`, `project_pipeline.schedule_id` and the unused `ai_agent` columns of the in-process runtime (`model_credential_id`, `tools`, `temperature`, `max_steps`, `api_key_*`, `memory_*`), restricts `ai_agent.kind` to `external`, and widens the step kind and trigger names to the framework's type ids (a plugin's `acme.send`). The old code cannot run on the migrated database, so a rollback restores the database dump (see "Rollback").

## 0. Before you start

1. `volition/hub` contains `hub/native-engine`, merged by the migration clash rule (`0174_helena_engine` after `0173_helena_provider_limits`; a second `bunx drizzle-kit generate` in `packages/db` says "No schema changes"). `full-test.sh` is green against the baseline.
2. The live checkout is clean apart from `apps/web/next-env.d.ts` (`git -C /srv/volition/source/plan status --short`). Never reset or checkout there.
3. Nothing waits in Mastra that must not be lost. Mastra's agent-team runs are not carried over; their stage runs in Helena finish normally, the coordinator's next stage does not start. Check:
   ```sh
   sudo -u postgres psql -d itsaplan -Atc "select count(*) from agent_run a join project_setting s on s.key like 'mastra-agent-run:%' and (s.value->>'runId')::int = a.id where a.status = 'pending'"
   sudo -u postgres psql -d itsaplan -Atc "select count(*) from pipeline_run where status in ('pending','running','waiting')"
   ```
   Both 0: go. Otherwise wait for the stage runs, or cancel the task's agent team in the task's panel.
4. The API's database role owns the database, so the engine creates its schema itself: `sudo -u postgres psql -d itsaplan -Atc "select datdba::regrole from pg_database where datname='itsaplan'"` returns `itsaplan`.

## 1. Backups

```sh
ts=$(date +%Y%m%d-%H%M)
sudo install -d -m 0700 /var/backups/volition/cutover-$ts
# The database, with the Mastra mappings and tables the migration drops.
sudo -u postgres pg_dump -Fc itsaplan | sudo tee /var/backups/volition/cutover-$ts/itsaplan.dump >/dev/null
# A consistent copy of Mastra's own store (the routines live there).
sudo sqlite3 /var/lib/volition/mastra/mastra.db ".backup /var/backups/volition/cutover-$ts/mastra.db"
sudo sqlite3 -readonly /var/backups/volition/cutover-$ts/mastra.db "select count(*) from mastra_schedules"
# The units and nginx files deploy.sh removes, for the rollback.
sudo tar -C / -czf /var/backups/volition/cutover-$ts/units-nginx.tgz \
  etc/systemd/system/volition-mastra.service etc/systemd/system/volition-mastra-dev.service \
  etc/systemd/system/volition-hermes-team-bridge.service etc/systemd/system/volition-hermes-team-bridge-dev.service \
  etc/systemd/system/volition-hermes-team-bridge.service.wants \
  etc/systemd/system/volition-plan-api.service etc/systemd/system/volition-plan-worker.service \
  etc/systemd/system/volition-provisioning.service \
  etc/nginx/sites-available/volition.conf etc/nginx/snippets/volition-mastra-studio.conf \
  etc/nginx/conf.d/volition-mastra-gateway.conf
```

## 2. Deploy (release mode)

The api and the worker stop first, so the running old code never meets the migrated schema (the migration drops columns it reads). `deploy.sh` starts them again with the new code.

```sh
sudo systemctl stop volition-plan-api.service volition-plan-worker.service
sudo /srv/volition/source/plan/deployment/volition-stack/native/deploy.sh volition/hub 2>&1 | tee ~/agent-work/deploy-engine-$ts.log
git -C /srv/volition/source/plan-dev merge --ff-only volition/native-chat-20260921   # if the live branch moved
```

What `deploy.sh` does for this switch, in order:

1. fast-forwards the live checkout and runs `bun install --frozen-lockfile` (DBOS 5.0.2 and `standardwebhooks` come in, `@mastra/*` and `@ai-sdk/openai` go);
2. disables, stops and removes `volition-mastra`, `volition-hermes-team-bridge` and both `-dev` units (with their `.service.d` and `.service.wants`), then `daemon-reload`;
3. takes the Studio include out of `/etc/nginx/sites-available/volition.conf` and removes the Studio snippet and the gateway conf after `nginx -t` passes (restores the site file if it does not);
4. runs `volition-plan-migrate.service` (migration `0174_helena_engine`);
5. installs the api, worker, web and provisioning units from the repo (without the Mastra credential and env lines), `daemon-reload`, rebuilds the web release, and restarts api, worker, web and provisioning;
6. checks that every service runs and the api and web answer.

The runner is not rebuilt: this switch does not change `packages/runner`.

Check the engine:

```sh
sudo journalctl -u volition-plan-api -n 80 --no-pager | grep -iE "engine|dbos"      # "[engine] running"
sudo -u postgres psql -d itsaplan -Atc "select service, last_seen_at from service_heartbeat where service like 'engine%'"
sudo -u postgres psql -d itsaplan -Atc "select count(*) from helena_engine.workflow_status"
sudo journalctl -u volition-plan-worker -n 40 --no-pager | grep -i "event delivery"   # "[worker] event delivery running"
systemctl list-units --all | grep -iE "mastra|team-bridge"                           # nothing
```

Home → Systemzustand shows "Helena-Motor" green, and "Motor-Wartung" runs within 5 minutes.

## 3. Routines and schedules

The script runs as the api's user with the api's environment; systemd loads `/etc/volition/plan.env`, so nobody reads it. Live has no Mastra routine (0 rows), so this is a check that also rewrites the schedules of builder workflows from Helena's own tables:

```sh
copy=/var/backups/volition/cutover-$ts/mastra.db
sudo install -o volition-plan -g volition -m 0600 $copy /var/lib/volition/mastra-import.db
run() {
  sudo systemd-run --pipe --wait --quiet --uid=volition-plan --gid=volition \
    --property=EnvironmentFile=/etc/volition/plan.env \
    --working-directory=/srv/volition/source/plan/apps/api \
    /usr/local/bin/bun src/scripts/import-mastra-schedules.ts --mastra-db /var/lib/volition/mastra-import.db "$@"
}
run            # dry run: prints what it would do ("0 routines")
run --apply
sudo rm -f /var/lib/volition/mastra-import.db
```

The script is idempotent: a second run prints "keep" for every routine; imported routines start afresh (times Mastra missed before the switch do not fire).

The agent team stays on where it was (`project_workflow_assignment`: VOL and VERVE); check it in the project's Settings → Workflows → Eingebaute Workflows.

## 4. Leftovers by hand

```sh
# Mastra's token files, by path only (never print them), into the root-only backup for a rollback.
sudo mv /etc/volition/mastra-control.token /etc/volition/mastra-gateway.token /var/backups/volition/cutover-$ts/
# A provisioning drop-in of the compose era, if one is installed anywhere.
sudo find /etc/systemd/system -name '90-mastra-inbox.conf' -o -name '91-mastra-control.conf' | xargs -r sudo rm -f
sudo systemctl daemon-reload
curl -o /dev/null -sS -w '%{http_code}\n' http://kingston-server.local/mastra/workflows   # 404
```

Left for later, harmless meanwhile (also in `docs/breaking-changes.md`): `/etc/volition/hermes-team.token`, the directory `/var/lib/volition/mastra` (after the backup of step 1), the system user `volition-mastra`, and `MASTRA_*` lines in `/etc/volition/plan.env`. The inbox triage of the integration service has no classifier after the switch (Mastra's was its only one); it is off on live.

## 5. Acceptance (headless browser from the Mac, `~/volition/tools/hl.mjs`, console free of Helena errors)

1. Home → Systemzustand: runner, Helena-Motor, provisioning and worker are green; the engine line reads "Motor: 0 aktiv · …".
2. A test project, Zeitpläne: create a routine for an agent, "Jetzt ausführen": a task appears and is delegated; "Verlauf" shows the run as succeeded; "Jetzt ausführen" again shows "Übersprungen: die vorige Aufgabe ist noch offen".
3. VOL: delegate a test task to the coordinator. The run shows the stages "Koordinator plant …". Cancel it; "Erneut versuchen" works on a failed one.
4. Workflow builder: a workflow with agent, approval, notify and webhook steps. Test run, then a real run on a task; approve the step in Freigaben.
5. Webhook trigger: Workflows page, "Adresse erzeugen", then
   `curl -X POST -H "Authorization: Bearer <secret>" -H 'content-type: application/json' -d '{"title":"Hook test"}' http://kingston-server.local/api/hooks/workflows/<id>` returns 202; a task "Hook test" and a run appear.
6. Restart the api during a run that waits for an agent (`sudo systemctl restart volition-plan-api`): the run continues and finishes once.
7. Administrator → Allgemein → Helena-Motor → Zeitzone: set it; a new routine shows it.
8. Only when a plugin with a step type is switched on (none is on live): the builder's "Schritt" menu lists its steps under "Erweiterungen", and a run of one succeeds.

Clean up the test tasks afterwards or label them "E2E-Test".

## Rollback

The migration removes tables and columns the old code needs, so a rollback restores the database. Everything the engine did after the switch is lost: runs, routine fires, new routines, and tasks and comments created after the switch (same database). Decide within the first hour.

1. `sudo systemctl stop volition-plan-api volition-plan-worker`
2. Restore the database:
   ```sh
   sudo -u postgres dropdb --if-exists itsaplan_rollback
   sudo -u postgres createdb -O itsaplan itsaplan_rollback
   sudo -u postgres pg_restore -d itsaplan_rollback /var/backups/volition/cutover-$ts/itsaplan.dump
   sudo -u postgres psql -c "alter database itsaplan rename to itsaplan_engine_failed"
   sudo -u postgres psql -c "alter database itsaplan_rollback rename to itsaplan"
   ```
3. Put the code back: in the live checkout `git revert -m 1 <merge commit of hub/native-engine>` (never reset), commit, then `sudo deploy.sh volition/hub`. That reinstalls the old api/worker/provisioning units with the Mastra credential lines and runs the old migrations (none to run on the restored database).
4. Restore Mastra's units and nginx files from step 1 and start them:
   ```sh
   sudo tar -C / -xzf /var/backups/volition/cutover-$ts/units-nginx.tgz
   sudo systemctl daemon-reload && sudo nginx -t && sudo systemctl reload nginx
   sudo systemctl enable --now volition-mastra.service volition-hermes-team-bridge.service
   ```
   Put the token files of step 4 back: `sudo mv /var/backups/volition/cutover-$ts/mastra-*.token /etc/volition/`. Mastra's own store was never touched (the import read a copy).
5. Start the api and the worker. Home → Systemzustand shows Mastra and the bridge again.
