# Runbook: retire the Hermes dashboard (`volition-hermes-serve`)

Everything the dashboard offered that matters for managed agents is in Helena now
(`docs/helena-hermes-parity.md`: 115 routes in Helena, 172 not needed). This runbook takes the
dashboard off the live host and says how to bring it back.

The unit is not part of the repository: it was set up by hand on Kingston. It runs
`hermes dashboard` on 127.0.0.1:9119 with `HERMES_DESKTOP=1`, and nginx proxies it at
`/hermes/` behind Helena's auth. Two side effects of the dashboard go away with it, both on
purpose:

- **Hermes cron ticker.** `HERMES_DESKTOP=1` starts Hermes' own cron ticker. Helena withholds
  Hermes cron (routines and workflows run recurring work), so nothing should depend on it; the
  runner reports stray jobs as a warning on the agent.
- **Curator tick.** Helena's runtime janitor now asks every agent whose curator is on for a
  review once a week (`AGENT_CURATOR_INTERVAL_HOURS`, default 168), through the runner.

## 0. Preconditions

1. `hub/hermes-in-helena` is merged and live: migrations `0168_agent_usage` and
   `0169_glass_box_runs` applied, the runner bundle rebuilt and `volition-hermes-runner`
   restarted.
2. Every Hermes agent reports the new capabilities (runtime state `capabilities` contains
   `sessions`, `transcripts`, `logs`, `health`, `version`, `curator`, `estop`, `update`):
   ```bash
   sudo -u postgres psql -d itsaplan -Atc "select username, runtime_state->'capabilities' ? 'sessions' from ai_agent where kind='external' and not template"
   ```
3. A check in the browser as the owner, on one agent: Läufe (open a run: Verlauf, Transkript,
   Log), Sitzungen (list, search, open), Gedächtnis, Verbrauch, Laufzeit (version, "Prüfen",
   Kurator, Log). The console stays free of errors.
4. Nobody uses the dashboard any more (ask the owner). Its chats are in the Hermes sessions
   and stay readable in Helena (Agent → Sitzungen) for people who see the whole team.

## 1. Look before changing anything

```bash
systemctl status volition-hermes-serve --no-pager | head -5
sudo ss -ltnp "sport = :9119"
grep -n "location /hermes/" /etc/nginx/sites-available/volition.conf
```

Do not print the unit's environment or credential files; copy them as they are.

## 2. Back up

```bash
ts=$(date +%Y%m%d-%H%M)
sudo cp -a /etc/systemd/system/volition-hermes-serve.service /etc/systemd/volition-hermes-serve.service.bak-$ts
[ -d /etc/systemd/system/volition-hermes-serve.service.d ] && \
  sudo cp -a /etc/systemd/system/volition-hermes-serve.service.d /etc/systemd/volition-hermes-serve.service.d.bak-$ts
sudo cp -a /etc/nginx/sites-available/volition.conf /etc/nginx/volition.conf.bak-$ts
```

(If `systemctl cat volition-hermes-serve` shows the unit elsewhere, for example under
`/etc/systemd/system/multi-user.target.wants` as a link or in `/lib/systemd/system`, back up
that path instead.)

## 3. Stop and mask the service

```bash
sudo systemctl disable --now volition-hermes-serve.service
sudo systemctl mask volition-hermes-serve.service
sudo ss -ltnp "sport = :9119"   # must print nothing
```

## 4. Remove the `/hermes/` proxy

Delete the whole `location /hermes/ { … }` block from
`/etc/nginx/sites-available/volition.conf` (it proxies to 127.0.0.1:9119), then:

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -s -o /dev/null -w "%{http_code}\n" http://kingston-server.local/hermes/   # Helena's 404 page, not a 502
```

## 5. Check Helena

1. Agent → Laufzeit → Kurator → "Jetzt ausführen" answers; the report shows the run.
2. Agent → Sitzungen lists the sessions; a transcript opens.
3. A mention of an agent in an issue starts a run whose timeline streams live.
4. Home → Dienste shows the runner online.
5. `journalctl -u volition-plan-api --since -10min | grep -i "runtime-janitor"` shows no errors;
   Administrator → system health lists "Laufzeit-Aufräumdienst" as healthy.

## 6. Rollback

```bash
sudo systemctl unmask volition-hermes-serve.service
sudo systemctl enable --now volition-hermes-serve.service
sudo cp -a /etc/nginx/volition.conf.bak-<ts> /etc/nginx/sites-available/volition.conf
sudo nginx -t && sudo systemctl reload nginx
```

## 7. Repository clean-up afterwards

- `deployment/volition-stack/native/nginx/install-hermes-guard.sh` (+ its test and README
  paragraph) hardens the `/hermes/` block and is obsolete once the block is gone.
- `deployment/helena-rename/rename-map.json` renames `volition-hermes-serve` to
  `helena-hermes-dashboard`; drop both entries.
- `deployment/volition-stack/integration/hermes-runner/README.md` ("Hermes cron", "Learning")
  describes the dashboard's cron ticker and its config reading; rewrite to "no dashboard".
- `deployment/volition-stack/isolation/proof/harness.py` lists port 9119 among the ports an
  agent must not reach; it can stay (a closed port passes) or be removed.
- Update `~/volition/CLAUDE.md` (live state) and the owner's notes.
