# Hermes dashboard → Helena: parity map

Status: 2026-09-24 · Branch `hub/hermes-in-helena` (package C, "Gläserne Läufe")

The Hermes dashboard (`hermes dashboard`, run by `volition-hermes-serve.service` on
127.0.0.1:9119, proxied at `/hermes/`) was the only place to see what Hermes keeps for an
agent: sessions and transcripts, memory, skills, curator, logs, health, updates. This map
goes through **every route** the dashboard serves (Hermes v0.21.4, 287 routes from
`hermes_cli/web_routers/*`, `dashboard_auth`, `memory_oauth`, `web_server_dashboard`) and
marks each one:

- **in Helena**: where Helena offers it now (per agent on the agent page, per run in the
  run view, instance-wide in Administrator → Agenten-Laufzeit, or elsewhere);
- **nicht nötig**: why Helena does not need it.

Result: **115 in Helena, 172 nicht nötig, 0 open.** With this, the dashboard can be retired;
the runbook is `deployment/volition-stack/docs/retire-hermes-dashboard.md`.

## How Helena reads what Hermes keeps

Helena never opens Hermes' files. The agent's runner is the bridge
(`packages/runner/src/readers`, decision `docs/helena-decisions/glass-box-runs.md`):

- Helena queues a **runtime request** (`agent_runtime_request`), the runner claims it with a
  waiting call, answers it with the runtime's own interfaces and Helena's waiting request
  reads the answer. Requests are sized (pages, 6 MB answer cap on the runner, 8 MB on the
  API), time out (503 when the runner is offline, 504 when it does not answer in time) and
  are pruned after 15 minutes.
- **Hermes reader:** `hermes sessions export --redact`, `hermes_state.SessionDB` read-only
  (list, full-text search) through a small Python bridge, `hermes logs agent --session`,
  `hermes doctor`, `hermes --version`, `hermes curator status|run|pin|unpin`,
  `hermes pause|resume` (emergency stop). **Claude Code / Codex readers** read their JSONL
  session files, filtered to the agent's working directory (sessions, transcripts; no logs,
  doctor or curator there).
- Everything leaving the runner is redacted twice: Hermes' own `--redact`, then the runner's
  redactor (the exact secrets the runner handed the agent, secretlint's rules, key/token
  patterns).
- Under agent isolation the runner performs the reads as the project's user through the
  launcher (`profile-helper` op `runtime-request`), so the design holds once agents run as
  their own users.
- **Who sees what:** people only (an agent never reads transcripts through these routes). A
  run's session follows the run's project, a chat's session belongs to the person who
  chatted, a session Helena did not start (terminal) and the whole runtime log are for
  people who see the whole team. Memory and approvals follow the existing agent ACL
  (team owner/manager, Administrator for instance-wide proposals).

## What was added to Helena for parity

| Area | Where | What |
|---|---|---|
| Runs ("Gläserner Lauf") | Agent → Läufe, deep link `?agent=&tab=runs&run=` | live timeline (AG-UI events streamed by the runner) and replay, transcript of the run's session, its log lines, model check, blocked question, reflection, tokens/time/cost, "Ab hier fortsetzen" (a new run resumes the session with an instruction) |
| Sessions | Agent → Sitzungen | every session the reader may see, named after its run or chat, full-text search, full transcript (text, reasoning, tool calls with arguments and results), "Lauf öffnen" |
| Memory | Agent → Gedächtnis; Freigaben | the files as the runtime holds them, edit/clear, the agent's writes held as diffs on the approvals page (setting "Gedächtnis-Änderungen freigeben", default on), every version kept |
| Skills | Agent → Einstellungen → Fähigkeiten | bundled, installed and learned skills in one list, a switch per skill (`skills.disabled`) |
| Curator | Agent → Laufzeit → Kurator | state/report, run now, pin/unpin; pause is the agent's learning setting; Helena asks each enabled curator for a weekly review |
| Usage | Agent → Verbrauch; Administrator → Agenten-Laufzeit → Verbrauch | token ledger `agent_usage` (OTel GenAI counts), cost in € from the model price table (hub/autopilot), by agent/model/project/day |
| Logs, health, version | Agent → Laufzeit | log with level filter, `hermes doctor`, version incl. local commits |
| Hermes update | Administrator → Agenten-Laufzeit → Hermes | check (commits and local patches), request → approval card → root helper installs with backup, smoke test and rollback, log |
| Fallback models | Agent form (own list) and Administrator (instance default) | written to `fallback_providers` through the `hermes-settings` profile contribution |
| Session retention | Administrator → Agenten-Laufzeit → Sitzungen | `sessions.retention_days` (Hermes default 90) |
| Emergency stop | Administrator, account menu, banner on every page | no claims, runs in flight are released at their next heartbeat and resume their session later, chat answers stop, `hermes pause` on every runner; "Agenten fortsetzen" lifts it |

## Route by route

### dashboard_auth/routes

| Route | Status | Where / why |
|---|---|---|
| `GET /api/auth/me` | nicht nötig | Helena's own sign-in (better-auth, passkeys, LAN rule, TOTP step-up) guards everything; there is no second login. |
| `GET /api/auth/providers` | nicht nötig | Helena's own sign-in (better-auth, passkeys, LAN rule, TOTP step-up) guards everything; there is no second login. |
| `GET /auth/callback` | nicht nötig | Helena's own sign-in (better-auth, passkeys, LAN rule, TOTP step-up) guards everything; there is no second login. |
| `GET /auth/login` | nicht nötig | Helena's own sign-in (better-auth, passkeys, LAN rule, TOTP step-up) guards everything; there is no second login. |
| `GET /auth/native/authorize` | nicht nötig | Helena's own sign-in (better-auth, passkeys, LAN rule, TOTP step-up) guards everything; there is no second login. |
| `GET /login` | nicht nötig | Helena's own sign-in (better-auth, passkeys, LAN rule, TOTP step-up) guards everything; there is no second login. |
| `POST /api/auth/ws-ticket` | nicht nötig | Helena's own sign-in (better-auth, passkeys, LAN rule, TOTP step-up) guards everything; there is no second login. |
| `POST /auth/logout` | nicht nötig | Helena's own sign-in (better-auth, passkeys, LAN rule, TOTP step-up) guards everything; there is no second login. |
| `POST /auth/native/refresh` | nicht nötig | Helena's own sign-in (better-auth, passkeys, LAN rule, TOTP step-up) guards everything; there is no second login. |
| `POST /auth/native/token` | nicht nötig | Helena's own sign-in (better-auth, passkeys, LAN rule, TOTP step-up) guards everything; there is no second login. |
| `POST /auth/password-login` | nicht nötig | Helena's own sign-in (better-auth, passkeys, LAN rule, TOTP step-up) guards everything; there is no second login. |

### memory_oauth

| Route | Status | Where / why |
|---|---|---|
| `GET /{provider}/oauth/status` | nicht nötig | External memory providers (Honcho, mem0 …) are not used: Hermes keeps its built-in MEMORY.md/USER.md, which Helena shows and approves (agent → Gedächtnis). |
| `POST /{provider}/oauth/start` | nicht nötig | External memory providers (Honcho, mem0 …) are not used: Hermes keeps its built-in MEMORY.md/USER.md, which Helena shows and approves (agent → Gedächtnis). |

### actions

| Route | Status | Where / why |
|---|---|---|
| `GET /api/actions/{name}/status` | in Helena | The state of the one long action that matters (the Hermes update) is shown in Administrator → Agenten-Laufzeit; curator runs report through the runtime request (Laufzeit → Kurator). |
| `GET /api/gateway/migrate/plan` | nicht nötig | Hermes' messaging gateway is not run: runs and chats come from Helena through the runner, messages go out through Helena's own Telegram/mail. |
| `GET /api/hermes/update/check` | in Helena | Administrator → Agenten-Laufzeit → Hermes → "Nach Updates suchen": the runner asks the root helper, which fetches upstream and lists the commits and the local patches carried over. |
| `GET /api/hermes/update/receipt` | in Helena | Administrator → Agenten-Laufzeit → Hermes: the latest update with its state and full log (and the proposal on Freigaben → Entschieden). |
| `POST /api/gateway/drain` | nicht nötig | Hermes' messaging gateway is not run: runs and chats come from Helena through the runner, messages go out through Helena's own Telegram/mail. |
| `POST /api/gateway/migrate` | nicht nötig | Hermes' messaging gateway is not run: runs and chats come from Helena through the runner, messages go out through Helena's own Telegram/mail. |
| `POST /api/gateway/restart` | nicht nötig | Hermes' messaging gateway is not run: runs and chats come from Helena through the runner, messages go out through Helena's own Telegram/mail. |
| `POST /api/hermes/update` | in Helena | Administrator → Agenten-Laufzeit → "Update anfordern" raises an approval (Freigaben); approving it has the root helper install with backup, smoke test and automatic rollback. |

### analytics

| Route | Status | Where / why |
|---|---|---|
| `GET /api/analytics/models` | in Helena | The same usage report grouped by model (agent → Verbrauch → Modelle; Administrator → Verbrauch → Modelle). |
| `GET /api/analytics/usage` | in Helena | Agent → Verbrauch (per model, day, project) and Administrator → Agenten-Laufzeit → Verbrauch (per agent, model, project, day), from Helena's token ledger `agent_usage` with cost in € by the model price table. |
| `GET /api/config/raw` | in Helena | Helena owns the profile's configuration (runtime policy, hermes-sync profile contributions); agent → Einstellungen → Profil shows what is managed and any drift. Raw YAML is not shown: it is generated. |
| `PUT /api/config/raw` | nicht nötig | Editing the generated config.yaml by hand would be reverted by the next sync (and shown as drift); every setting that matters is a field in Helena. |

### audio

| Route | Status | Where / why |
|---|---|---|
| `GET /api/audio/elevenlabs/voices` | nicht nötig | Voice selection for Hermes’ TTS providers is not used; Helena reads aloud with the browser’s voices. |
| `GET /api/audio/voice-config` | nicht nötig | Voice selection for Hermes’ TTS providers is not used; Helena reads aloud with the browser’s voices. |
| `GET /api/audio/voice-live/status` | nicht nötig | Hermes' realtime voice sessions are not used; Helena's voice mode works in the chat. |
| `POST /api/audio/speak` | in Helena | The chat composer's dictation, read-aloud and voice mode (browser speech, see the chat parity list); Hermes' own audio endpoints are not needed for that. |
| `POST /api/audio/transcribe` | in Helena | The chat composer's dictation, read-aloud and voice mode (browser speech, see the chat parity list); Hermes' own audio endpoints are not needed for that. |
| `POST /api/audio/tts-lease` | in Helena | The chat composer's dictation, read-aloud and voice mode (browser speech, see the chat parity list); Hermes' own audio endpoints are not needed for that. |
| `POST /api/audio/voice-live/session` | nicht nötig | Hermes' realtime voice sessions are not used; Helena's voice mode works in the chat. |
| `WEBSOCKET /api/audio/speak-stream` | nicht nötig | Streaming TTS of the dashboard; see voice mode above. |

### chat_ws

| Route | Status | Where / why |
|---|---|---|
| `WEBSOCKET /api/console` | in Helena | The owner terminal in Helena (Home → Terminal: Shell, Claude Code, Codex). |
| `WEBSOCKET /api/events` | in Helena | Agent chat in Helena (panel and page) streams AG-UI events from the runner; runs stream their timeline to the run view (Gläserner Lauf, live). |
| `WEBSOCKET /api/pty` | in Helena | The owner terminal in Helena (Home → Terminal). |
| `WEBSOCKET /api/pub` | in Helena | Agent chat in Helena (panel and page) streams AG-UI events from the runner; runs stream their timeline to the run view (Gläserner Lauf, live). |
| `WEBSOCKET /api/ws` | in Helena | Agent chat in Helena (panel and page) streams AG-UI events from the runner; runs stream their timeline to the run view (Gläserner Lauf, live). |

### config_env

| Route | Status | Where / why |
|---|---|---|
| `DELETE /api/env` | in Helena | Secrets live in Zugänge (encrypted) and are granted per agent/project; the runner passes them at run time. Helena never shows a stored secret again. |
| `DELETE /api/providers/custom-endpoints/{endpoint_id}` | nicht nötig | Model endpoints are the runner's catalog (deployment) and team model keys (Team → Integrationen); an agent picks a model from that catalog in Helena. |
| `GET /api/config` | in Helena | Agent settings (model, reasoning, toolsets, MCP, learning, memory approval, skills, fallback models) and Administrator → Agenten-Laufzeit (instance defaults) are the configuration; the runner writes it into the profile. |
| `GET /api/config/defaults` | in Helena | Agent settings (model, reasoning, toolsets, MCP, learning, memory approval, skills, fallback models) and Administrator → Agenten-Laufzeit (instance defaults) are the configuration; the runner writes it into the profile. |
| `GET /api/config/schema` | in Helena | Agent settings (model, reasoning, toolsets, MCP, learning, memory approval, skills, fallback models) and Administrator → Agenten-Laufzeit (instance defaults) are the configuration; the runner writes it into the profile. |
| `GET /api/egress/status` | in Helena | Agent egress rules (hub/agent-isolation, migration 0164) and the browser gateway's address block; shown on the agent and in Home → Browser. |
| `GET /api/env` | in Helena | Secrets live in Zugänge (encrypted) and are granted per agent/project; the runner passes them at run time. Helena never shows a stored secret again. |
| `GET /api/providers/custom-endpoints` | nicht nötig | Model endpoints are the runner's catalog (deployment) and team model keys (Team → Integrationen); an agent picks a model from that catalog in Helena. |
| `POST /api/env/reveal` | nicht nötig | Deliberately not offered: a stored secret is never shown again (safety rule). |
| `POST /api/providers/custom-endpoints` | nicht nötig | Model endpoints are the runner's catalog (deployment) and team model keys (Team → Integrationen); an agent picks a model from that catalog in Helena. |
| `POST /api/providers/custom-endpoints/validate` | nicht nötig | Model endpoints are the runner's catalog (deployment) and team model keys (Team → Integrationen); an agent picks a model from that catalog in Helena. |
| `POST /api/providers/custom-endpoints/{endpoint_id}/activate` | nicht nötig | Model endpoints are the runner's catalog (deployment) and team model keys (Team → Integrationen); an agent picks a model from that catalog in Helena. |
| `POST /api/providers/validate` | nicht nötig | Model keys are validated where they are entered (Team → Integrationen / Zugänge). |
| `PUT /api/config` | in Helena | Saving the agent form or the Administrator defaults; the runner applies it on its next sync. |
| `PUT /api/env` | in Helena | Secrets live in Zugänge (encrypted) and are granted per agent/project; the runner passes them at run time. Helena never shows a stored secret again. |

### cron

| Route | Status | Where / why |
|---|---|---|
| `DELETE /api/cron/jobs/{job_id}` | nicht nötig | Hermes cron is withheld on purpose: recurring work is a routine in Helena (Zeitpläne) or a workflow; the runner never passes the cronjob toolset and reports stray jobs as a warning on the agent. |
| `GET /api/cron/blueprints` | nicht nötig | Hermes cron is withheld on purpose: recurring work is a routine in Helena (Zeitpläne) or a workflow; the runner never passes the cronjob toolset and reports stray jobs as a warning on the agent. |
| `GET /api/cron/delivery-targets` | nicht nötig | Hermes cron is withheld on purpose: recurring work is a routine in Helena (Zeitpläne) or a workflow; the runner never passes the cronjob toolset and reports stray jobs as a warning on the agent. |
| `GET /api/cron/jobs` | nicht nötig | Hermes cron is withheld on purpose: recurring work is a routine in Helena (Zeitpläne) or a workflow; the runner never passes the cronjob toolset and reports stray jobs as a warning on the agent. |
| `GET /api/cron/jobs/{job_id}` | nicht nötig | Hermes cron is withheld on purpose: recurring work is a routine in Helena (Zeitpläne) or a workflow; the runner never passes the cronjob toolset and reports stray jobs as a warning on the agent. |
| `GET /api/cron/jobs/{job_id}/runs` | nicht nötig | Hermes cron is withheld on purpose: recurring work is a routine in Helena (Zeitpläne) or a workflow; the runner never passes the cronjob toolset and reports stray jobs as a warning on the agent. |
| `POST /api/cron/blueprints/instantiate` | nicht nötig | Hermes cron is withheld on purpose: recurring work is a routine in Helena (Zeitpläne) or a workflow; the runner never passes the cronjob toolset and reports stray jobs as a warning on the agent. |
| `POST /api/cron/fire` | nicht nötig | Hermes cron is withheld on purpose: recurring work is a routine in Helena (Zeitpläne) or a workflow; the runner never passes the cronjob toolset and reports stray jobs as a warning on the agent. |
| `POST /api/cron/jobs` | nicht nötig | Hermes cron is withheld on purpose: recurring work is a routine in Helena (Zeitpläne) or a workflow; the runner never passes the cronjob toolset and reports stray jobs as a warning on the agent. |
| `POST /api/cron/jobs/{job_id}/pause` | nicht nötig | Hermes cron is withheld on purpose: recurring work is a routine in Helena (Zeitpläne) or a workflow; the runner never passes the cronjob toolset and reports stray jobs as a warning on the agent. |
| `POST /api/cron/jobs/{job_id}/resume` | nicht nötig | Hermes cron is withheld on purpose: recurring work is a routine in Helena (Zeitpläne) or a workflow; the runner never passes the cronjob toolset and reports stray jobs as a warning on the agent. |
| `POST /api/cron/jobs/{job_id}/trigger` | nicht nötig | Hermes cron is withheld on purpose: recurring work is a routine in Helena (Zeitpläne) or a workflow; the runner never passes the cronjob toolset and reports stray jobs as a warning on the agent. |
| `PUT /api/cron/jobs/{job_id}` | nicht nötig | Hermes cron is withheld on purpose: recurring work is a routine in Helena (Zeitpläne) or a workflow; the runner never passes the cronjob toolset and reports stray jobs as a warning on the agent. |

### dashboard_ui

| Route | Status | Where / why |
|---|---|---|
| `DELETE /api/dashboard/agent-plugins/{name:path}` | in Helena | Hermes plugins an agent needs (Helena’s approval guard, browser tools) are linked and repaired by the runner through profile contributions and shown as drift/restored on the agent; installing others by hand is not offered. |
| `GET /api/dashboard/font` | nicht nötig | The dashboard's own look and its UI plugins; Helena has its own design. |
| `GET /api/dashboard/plugins` | nicht nötig | The dashboard's own look and its UI plugins; Helena has its own design. |
| `GET /api/dashboard/plugins/catalog` | nicht nötig | The dashboard's own look and its UI plugins; Helena has its own design. |
| `GET /api/dashboard/plugins/hub` | nicht nötig | The dashboard's own look and its UI plugins; Helena has its own design. |
| `GET /api/dashboard/plugins/rescan` | nicht nötig | The dashboard's own look and its UI plugins; Helena has its own design. |
| `GET /api/dashboard/themes` | nicht nötig | The dashboard's own look and its UI plugins; Helena has its own design. |
| `GET /dashboard-plugins/{plugin_name}/{file_path:path}` | nicht nötig | Static files of the dashboard's UI plugins. |
| `POST /api/dashboard/agent-plugins/install` | in Helena | Hermes plugins an agent needs (Helena’s approval guard, browser tools) are linked and repaired by the runner through profile contributions and shown as drift/restored on the agent; installing others by hand is not offered. |
| `POST /api/dashboard/agent-plugins/{name:path}/disable` | in Helena | Hermes plugins an agent needs (Helena’s approval guard, browser tools) are linked and repaired by the runner through profile contributions and shown as drift/restored on the agent; installing others by hand is not offered. |
| `POST /api/dashboard/agent-plugins/{name:path}/enable` | in Helena | Hermes plugins an agent needs (Helena’s approval guard, browser tools) are linked and repaired by the runner through profile contributions and shown as drift/restored on the agent; installing others by hand is not offered. |
| `POST /api/dashboard/agent-plugins/{name:path}/update` | in Helena | Hermes plugins an agent needs (Helena’s approval guard, browser tools) are linked and repaired by the runner through profile contributions and shown as drift/restored on the agent; installing others by hand is not offered. |
| `POST /api/dashboard/plugins/{name:path}/visibility` | nicht nötig | The dashboard's own look and its UI plugins; Helena has its own design. |
| `PUT /api/dashboard/font` | nicht nötig | The dashboard's own look and its UI plugins; Helena has its own design. |
| `PUT /api/dashboard/plugin-providers` | nicht nötig | The dashboard's own look and its UI plugins; Helena has its own design. |
| `PUT /api/dashboard/theme` | nicht nötig | The dashboard's own look and its UI plugins; Helena has its own design. |

### files

| Route | Status | Where / why |
|---|---|---|
| `DELETE /api/files` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `GET /api/files` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `GET /api/files/download` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `GET /api/files/read` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `GET /api/files/stream` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `GET /api/fs/default-cwd` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `GET /api/fs/download` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `GET /api/fs/git-root` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `GET /api/fs/list` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `GET /api/fs/read-data-url` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `GET /api/fs/read-text` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `GET /api/media` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `POST /api/chat/image-upload` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `POST /api/files/mkdir` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `POST /api/files/upload` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `POST /api/files/upload-stream` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |
| `POST /api/fs/write-text` | in Helena | Dateien (knowledge vault, project files, attachments, read ACL) and the Code tool (code-server) per project; chat attachments in the composer. |

### git

| Route | Status | Where / why |
|---|---|---|
| `GET /api/git/base-branches` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `GET /api/git/branches` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `GET /api/git/file-diff` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `GET /api/git/gh-auth` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `GET /api/git/review/commit-context` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `GET /api/git/review/diff` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `GET /api/git/review/list` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `GET /api/git/review/rev-parse` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `GET /api/git/review/ship-info` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `GET /api/git/status` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `GET /api/git/worktrees` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `POST /api/git/branch/switch` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `POST /api/git/review/commit` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `POST /api/git/review/create-pr` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `POST /api/git/review/pr-list` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `POST /api/git/review/push` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `POST /api/git/review/revert` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `POST /api/git/review/stage` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `POST /api/git/review/unstage` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `POST /api/git/worktree/add` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |
| `POST /api/git/worktree/remove` | nicht nötig | Git work happens in the Code tool (code-server) and the owner terminal; a git-provider link per project is planned separately (not part of the dashboard's retirement). |

### local_models

| Route | Status | Where / why |
|---|---|---|
| `DELETE /api/local-models/models/{model_id}` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `GET /api/local-models/catalog` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `GET /api/local-models/hardware` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `GET /api/local-models/jobs` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `GET /api/local-models/jobs/{job_id}` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `GET /api/local-models/search` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `GET /api/local-models/search/files` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `GET /api/local-models/status` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `POST /api/local-models/activate` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `POST /api/local-models/download` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `POST /api/local-models/download-browsed` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `POST /api/local-models/eject` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `POST /api/local-models/quickstart` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `POST /api/local-models/runtime/install` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `POST /api/local-models/server` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |
| `POST /api/local-models/sideload` | nicht nötig | No local models yet (owner: after Helena is finished, Strix Halo). Revisit then as a model provider in the catalog. |

### mcp

| Route | Status | Where / why |
|---|---|---|
| `DELETE /api/mcp/oauth/flows/{flow_id}` | in Helena | MCP/OAuth connections belong to the access center (Zugänge & Verbindungen, hub/access-center); the owner signs in there himself. |
| `DELETE /api/mcp/servers/{name}` | in Helena | Home → MCPs: remove a server; per agent: turn it off. |
| `GET /api/mcp/catalog` | in Helena | Home → MCPs (team library) and agent → Fähigkeiten → MCP-Server (enabled per agent, runtime servers on/off). |
| `GET /api/mcp/oauth/callback/{server_name:path}` | in Helena | MCP/OAuth connections belong to the access center (Zugänge & Verbindungen, hub/access-center); the owner signs in there himself. |
| `GET /api/mcp/oauth/flows/{flow_id}` | in Helena | MCP/OAuth connections belong to the access center (Zugänge & Verbindungen, hub/access-center); the owner signs in there himself. |
| `GET /api/mcp/servers` | in Helena | Home → MCPs (team library) and agent → Fähigkeiten → MCP-Server (enabled per agent, runtime servers on/off). |
| `POST /api/mcp/catalog/install` | in Helena | Home → MCPs: add a server from the library presets. |
| `POST /api/mcp/servers` | in Helena | Home → MCPs: add/edit a server of the library; per agent in the agent form. |
| `POST /api/mcp/servers/{name}/auth` | in Helena | MCP/OAuth connections belong to the access center (Zugänge & Verbindungen, hub/access-center); the owner signs in there himself. |
| `POST /api/mcp/servers/{name}/test` | in Helena | Home → MCPs → test a server. |
| `PUT /api/mcp/servers` | in Helena | Home → MCPs: add/edit a server of the library; per agent in the agent form. |
| `PUT /api/mcp/servers/{name}/enabled` | in Helena | Agent → Fähigkeiten → MCP-Server switch. |

### memory_providers

| Route | Status | Where / why |
|---|---|---|
| `GET /api/memory/providers/{name}/config` | nicht nötig | External memory providers are not used (built-in memory only). |
| `POST /api/memory/providers/{name}/setup` | nicht nötig | External memory providers are not used (built-in memory only). |
| `PUT /api/memory/providers/{name}/config` | nicht nötig | External memory providers are not used (built-in memory only). |

### messaging

| Route | Status | Where / why |
|---|---|---|
| `DELETE /api/messaging/telegram/onboarding/{pairing_id}` | nicht nötig | Hermes' Telegram/WhatsApp gateway is not run; Helena sends notifications through its own Telegram bot (Administrator → Telegram) and mail. |
| `DELETE /api/messaging/whatsapp/onboarding/{pairing_id}` | nicht nötig | Hermes' Telegram/WhatsApp gateway is not run; Helena sends notifications through its own Telegram bot (Administrator → Telegram) and mail. |
| `GET /api/messaging/platforms` | nicht nötig | Hermes' Telegram/WhatsApp gateway is not run; Helena sends notifications through its own Telegram bot (Administrator → Telegram) and mail. |
| `GET /api/messaging/telegram/onboarding/{pairing_id}` | nicht nötig | Hermes' Telegram/WhatsApp gateway is not run; Helena sends notifications through its own Telegram bot (Administrator → Telegram) and mail. |
| `GET /api/messaging/whatsapp/onboarding/{pairing_id}` | nicht nötig | Hermes' Telegram/WhatsApp gateway is not run; Helena sends notifications through its own Telegram bot (Administrator → Telegram) and mail. |
| `POST /api/messaging/platforms/{platform_id}/test` | nicht nötig | Hermes' Telegram/WhatsApp gateway is not run; Helena sends notifications through its own Telegram bot (Administrator → Telegram) and mail. |
| `POST /api/messaging/telegram/onboarding/start` | nicht nötig | Hermes' Telegram/WhatsApp gateway is not run; Helena sends notifications through its own Telegram bot (Administrator → Telegram) and mail. |
| `POST /api/messaging/telegram/onboarding/{pairing_id}/apply` | nicht nötig | Hermes' Telegram/WhatsApp gateway is not run; Helena sends notifications through its own Telegram bot (Administrator → Telegram) and mail. |
| `POST /api/messaging/whatsapp/onboarding/start` | nicht nötig | Hermes' Telegram/WhatsApp gateway is not run; Helena sends notifications through its own Telegram bot (Administrator → Telegram) and mail. |
| `POST /api/messaging/whatsapp/onboarding/{pairing_id}/apply` | nicht nötig | Hermes' Telegram/WhatsApp gateway is not run; Helena sends notifications through its own Telegram bot (Administrator → Telegram) and mail. |
| `PUT /api/messaging/platforms/{platform_id}` | nicht nötig | Hermes' Telegram/WhatsApp gateway is not run; Helena sends notifications through its own Telegram bot (Administrator → Telegram) and mail. |

### models

| Route | Status | Where / why |
|---|---|---|
| `GET /api/model/auxiliary` | nicht nötig | Hermes' auxiliary model (titles, curator, compression) keeps Hermes' default; Helena turns model-written titles off and runs reflection in the run's own session. |
| `GET /api/model/info` | in Helena | Agent → Einstellungen → Modell und Reasoning (the model catalog the runner reports); every run shows the model it was configured with and the one it ran on. |
| `GET /api/model/moa` | nicht nötig | Mixture-of-agents is not used; delegation happens through Helena (Home → coordinator → specialist). |
| `GET /api/model/options` | in Helena | Agent → Einstellungen → Modell und Reasoning (the model catalog the runner reports); every run shows the model it was configured with and the one it ran on. |
| `GET /api/model/recommended-default` | nicht nötig | Helena's catalog and the agent default decide; no recommendation needed. |
| `POST /api/model/set` | in Helena | Agent → Einstellungen → Modell (per agent, or "Agent-Standard"). |
| `PUT /api/model/moa` | nicht nötig | Mixture-of-agents is not used; delegation happens through Helena (Home → coordinator → specialist). |

### oauth

| Route | Status | Where / why |
|---|---|---|
| `DELETE /api/providers/oauth/sessions/{session_id}` | nicht nötig | Signing in to model providers (Claude subscription, Codex) is done by the owner in the owner terminal; Helena never performs logins (safety rule). |
| `DELETE /api/providers/oauth/{provider_id}` | nicht nötig | Signing in to model providers (Claude subscription, Codex) is done by the owner in the owner terminal; Helena never performs logins (safety rule). |
| `GET /api/providers/oauth` | nicht nötig | Signing in to model providers (Claude subscription, Codex) is done by the owner in the owner terminal; Helena never performs logins (safety rule). |
| `GET /api/providers/oauth/{provider_id}/poll/{session_id}` | nicht nötig | Signing in to model providers (Claude subscription, Codex) is done by the owner in the owner terminal; Helena never performs logins (safety rule). |
| `POST /api/providers/oauth/{provider_id}/start` | nicht nötig | Signing in to model providers (Claude subscription, Codex) is done by the owner in the owner terminal; Helena never performs logins (safety rule). |
| `POST /api/providers/oauth/{provider_id}/submit` | nicht nötig | Signing in to model providers (Claude subscription, Codex) is done by the owner in the owner terminal; Helena never performs logins (safety rule). |

### ops

| Route | Status | Where / why |
|---|---|---|
| `DELETE /api/credentials/pool/{provider}/{index}` | nicht nötig | Model credentials come from the runner descriptor (deployment) and Zugänge; Helena never lists or rotates them in the UI. |
| `DELETE /api/ops/hooks` | nicht nötig | Hooks are managed by the runner: the approval guard replaces --yolo and is kept in place by profile contributions. |
| `DELETE /api/webhooks/{name}` | nicht nötig | Work reaches agents through Helena (mentions, assignment, field triggers, routines, workflows), not through Hermes webhooks. |
| `GET /api/credentials/pool` | nicht nötig | Model credentials come from the runner descriptor (deployment) and Zugänge; Helena never lists or rotates them in the UI. |
| `GET /api/memory` | in Helena | Agent → Gedächtnis: MEMORY.md and USER.md as the runtime holds them, pending writes as diffs, every version. |
| `GET /api/ops/backup/download` | nicht nötig | Backups are a deployment concern (deployment/volition-stack/backup, owner deferred); the vault and profiles are covered there. |
| `GET /api/ops/checkpoints` | nicht nötig | Hermes' file checkpoints stay Hermes' own; runs work in project areas under git. |
| `GET /api/ops/hooks` | nicht nötig | Hooks are managed by the runner: the approval guard replaces --yolo and is kept in place by profile contributions. |
| `GET /api/pairing` | nicht nötig | Messaging pairing belongs to the gateway, which is not run. |
| `GET /api/webhooks` | nicht nötig | Work reaches agents through Helena (mentions, assignment, field triggers, routines, workflows), not through Hermes webhooks. |
| `POST /api/credentials/pool` | nicht nötig | Model credentials come from the runner descriptor (deployment) and Zugänge; Helena never lists or rotates them in the UI. |
| `POST /api/gateway/start` | nicht nötig | Hermes' messaging gateway is not run. |
| `POST /api/gateway/stop` | nicht nötig | Hermes' messaging gateway is not run. |
| `POST /api/memory/reset` | in Helena | Agent → Gedächtnis → "Leeren" (per file) or "Bearbeiten". |
| `POST /api/ops/backup` | nicht nötig | Backups are a deployment concern (deployment/volition-stack/backup, owner deferred); the vault and profiles are covered there. |
| `POST /api/ops/checkpoints/prune` | nicht nötig | Hermes' file checkpoints stay Hermes' own; runs work in project areas under git. |
| `POST /api/ops/doctor` | in Helena | Agent → Laufzeit → Zustand → "Prüfen" (hermes doctor through the runner). |
| `POST /api/ops/hooks` | nicht nötig | Hooks are managed by the runner: the approval guard replaces --yolo and is kept in place by profile contributions. |
| `POST /api/ops/import` | nicht nötig | Profiles are created by Helena and the runner (agent pool, templates); importing foreign profiles is not offered. |
| `POST /api/ops/import-upload` | nicht nötig | Profiles are created by Helena and the runner (agent pool, templates); importing foreign profiles is not offered. |
| `POST /api/ops/security-audit` | nicht nötig | Security comes from agent isolation, the approval guard and the doctor check; no separate audit screen. |
| `POST /api/pairing/approve` | nicht nötig | Messaging pairing belongs to the gateway, which is not run. |
| `POST /api/pairing/clear-pending` | nicht nötig | Messaging pairing belongs to the gateway, which is not run. |
| `POST /api/pairing/revoke` | nicht nötig | Messaging pairing belongs to the gateway, which is not run. |
| `POST /api/webhooks` | nicht nötig | Work reaches agents through Helena (mentions, assignment, field triggers, routines, workflows), not through Hermes webhooks. |
| `POST /api/webhooks/enable` | nicht nötig | Work reaches agents through Helena (mentions, assignment, field triggers, routines, workflows), not through Hermes webhooks. |
| `PUT /api/memory/provider` | nicht nötig | External memory providers are not used. |
| `PUT /api/webhooks/{name}/enabled` | nicht nötig | Work reaches agents through Helena (mentions, assignment, field triggers, routines, workflows), not through Hermes webhooks. |

### profiles

| Route | Status | Where / why |
|---|---|---|
| `DELETE /api/profiles/{name}` | in Helena | Deleting an agent in Helena. |
| `GET /api/profiles` | in Helena | Agents (Home → Agenten, Organisation): every agent is one Hermes profile, created and kept by Helena and the runner. |
| `GET /api/profiles/active` | nicht nötig | There is no single "active" profile: each agent runs in its own. |
| `GET /api/profiles/projects/tree` | nicht nötig | Projects are Helena's; the agent works in the project areas Helena assigns. |
| `GET /api/profiles/sessions` | in Helena | Agent → Sitzungen (only the sessions the reader may see). |
| `GET /api/profiles/sessions/sidebar` | in Helena | Agent → Sitzungen (only the sessions the reader may see). |
| `GET /api/profiles/{name}/desktop-overlay` | nicht nötig | Dashboard-only UI. |
| `GET /api/profiles/{name}/setup-command` | nicht nötig | Setup is the runner's (descriptor + bootstrap). |
| `GET /api/profiles/{name}/soul` | in Helena | Agent → Einstellungen → Anweisungen/SOUL (runtime policy files); the runner writes SOUL.md with what Helena adds. |
| `PATCH /api/profiles/{name}` | in Helena | Agent name and description in the agent form. |
| `POST /api/profiles` | in Helena | Creating an agent in Helena (Agentenpool/templates); the runner provisions its profile. |
| `POST /api/profiles/active` | nicht nötig | There is no single "active" profile: each agent runs in its own. |
| `POST /api/profiles/import` | nicht nötig | See export. |
| `POST /api/profiles/sessions/pull-requests` | nicht nötig | Git provider integration is separate (see git). |
| `POST /api/profiles/{name}/describe-auto` | nicht nötig | Descriptions are written by people (or come from templates). |
| `POST /api/profiles/{name}/export` | nicht nötig | Agents move as template bundles (template-bundles decision), not as raw profile archives. |
| `POST /api/profiles/{name}/open-terminal` | in Helena | Owner terminal (Home → Terminal). |
| `PUT /api/profiles/{name}/description` | in Helena | Agent name and description in the agent form. |
| `PUT /api/profiles/{name}/model` | in Helena | Agent → Einstellungen → Modell. |
| `PUT /api/profiles/{name}/soul` | in Helena | Agent → Einstellungen → Anweisungen/SOUL (runtime policy files); the runner writes SOUL.md with what Helena adds. |

### sessions

| Route | Status | Where / why |
|---|---|---|
| `DELETE /api/sessions/empty` | in Helena | Administrator → Agenten-Laufzeit → Sitzungen aufbewahren (sessions.retention_days, Hermes prunes); single deletes are not offered, the transcripts are the audit trail of the runs. |
| `DELETE /api/sessions/{session_id}` | in Helena | Administrator → Agenten-Laufzeit → Sitzungen aufbewahren (sessions.retention_days, Hermes prunes); single deletes are not offered, the transcripts are the audit trail of the runs. |
| `GET /api/sessions` | in Helena | Agent → Sitzungen: newest first, each named after its run or chat, filtered by Helena’s access rules. |
| `GET /api/sessions/empty/count` | in Helena | Administrator → Agenten-Laufzeit → Sitzungen aufbewahren (sessions.retention_days, Hermes prunes); single deletes are not offered, the transcripts are the audit trail of the runs. |
| `GET /api/sessions/search` | in Helena | Agent → Sitzungen → search over every message. |
| `GET /api/sessions/stats` | in Helena | Agent → Verbrauch (tokens, time, cost). |
| `GET /api/sessions/{session_id}` | in Helena | Agent → Sitzungen → a session's full transcript (OTel GenAI messages: text, reasoning, tool calls with arguments and results), redacted twice. |
| `GET /api/sessions/{session_id}/export` | in Helena | Agent → Sitzungen → a session's full transcript (OTel GenAI messages: text, reasoning, tool calls with arguments and results), redacted twice. |
| `GET /api/sessions/{session_id}/latest-descendant` | in Helena | The runner reports the session a run ended in (a compression moves it); "Ab hier fortsetzen" resumes that one. |
| `GET /api/sessions/{session_id}/messages` | in Helena | Agent → Sitzungen → a session's full transcript (OTel GenAI messages: text, reasoning, tool calls with arguments and results), redacted twice. |
| `GET /api/sessions/{session_id}/messages/around` | in Helena | Agent → Sitzungen → a session's full transcript (OTel GenAI messages: text, reasoning, tool calls with arguments and results), redacted twice. |
| `GET /api/sessions/{session_id}/timeline` | in Helena | Run view → Verlauf (live AG-UI timeline and replay) and → Transkript. |
| `PATCH /api/sessions/{session_id}` | nicht nötig | Sessions are named after their run or chat in Helena; renaming is not needed. |
| `POST /api/sessions/bulk-delete` | in Helena | Administrator → Agenten-Laufzeit → Sitzungen aufbewahren (sessions.retention_days, Hermes prunes); single deletes are not offered, the transcripts are the audit trail of the runs. |
| `POST /api/sessions/import` | nicht nötig | Foreign sessions are not imported. |
| `POST /api/sessions/owner-backfill` | nicht nötig | Ownership comes from Helena (run project, chat user), not from Hermes. |
| `POST /api/sessions/prune` | in Helena | Administrator → Agenten-Laufzeit → Sitzungen aufbewahren (sessions.retention_days, Hermes prunes); single deletes are not offered, the transcripts are the audit trail of the runs. |

### skills

| Route | Status | Where / why |
|---|---|---|
| `GET /api/skills` | in Helena | Agent → Fähigkeiten → Skills (bundled, installed and learned in one list) and Home → Skills (the team's library). |
| `GET /api/skills/content` | in Helena | Home → Skills (library skills) and the learned-skill dialog on the agent. |
| `GET /api/skills/hub/official` | in Helena | Agentenpool and the skill import (curated import, pinned sources); the Hermes skills hub itself is not browsed. |
| `GET /api/skills/hub/preview` | in Helena | Agentenpool and the skill import (curated import, pinned sources); the Hermes skills hub itself is not browsed. |
| `GET /api/skills/hub/scan` | in Helena | Agentenpool and the skill import (curated import, pinned sources); the Hermes skills hub itself is not browsed. |
| `GET /api/skills/hub/search` | in Helena | Agentenpool and the skill import (curated import, pinned sources); the Hermes skills hub itself is not browsed. |
| `GET /api/skills/hub/sources` | in Helena | Agentenpool and the skill import (curated import, pinned sources); the Hermes skills hub itself is not browsed. |
| `POST /api/skills` | in Helena | Home → Skills: create/edit a library skill; the runner materializes it into every profile that has it. |
| `POST /api/skills/hub/install` | in Helena | Agentenpool and the skill import (curated import, pinned sources); the Hermes skills hub itself is not browsed. |
| `POST /api/skills/hub/uninstall` | in Helena | Agentenpool and the skill import (curated import, pinned sources); the Hermes skills hub itself is not browsed. |
| `POST /api/skills/hub/update` | in Helena | Agentenpool and the skill import (curated import, pinned sources); the Hermes skills hub itself is not browsed. |
| `PUT /api/skills/content` | in Helena | Home → Skills: create/edit a library skill; the runner materializes it into every profile that has it. |
| `PUT /api/skills/toggle` | in Helena | Agent → Fähigkeiten → Skills: a switch per skill (Hermes skills.disabled, saved with the agent). |

### status

| Route | Status | Where / why |
|---|---|---|
| `DELETE /api/learning/node` | in Helena | Learned skills (agent → Fähigkeiten, with keep/archive/promote) and memory (agent → Gedächtnis); no graph view. |
| `GET /api/curator` | in Helena | Agent → Laufzeit → Kurator (state and report). |
| `GET /api/health` | in Helena | Home → Dienste (runner, bridge, worker) and agent → Laufzeit → Zustand. |
| `GET /api/health/idle` | in Helena | Home → Dienste (runner, bridge, worker) and agent → Laufzeit → Zustand. |
| `GET /api/host/identity` | nicht nötig | Host facts of the dashboard; Helena runs on the same host and shows services on Home. |
| `GET /api/learning/graph` | in Helena | Learned skills (agent → Fähigkeiten, with keep/archive/promote) and memory (agent → Gedächtnis); no graph view. |
| `GET /api/learning/node` | in Helena | Learned skills (agent → Fähigkeiten, with keep/archive/promote) and memory (agent → Gedächtnis); no graph view. |
| `GET /api/logs` | in Helena | Agent → Laufzeit → Log (filter by level) and run view → Log (the lines of that session), redacted. |
| `GET /api/portal` | nicht nötig | Host facts of the dashboard; Helena runs on the same host and shows services on Home. |
| `GET /api/ssh/ownership` | nicht nötig | Host facts of the dashboard; Helena runs on the same host and shows services on Home. |
| `GET /api/status` | in Helena | Agent row (runner online/offline, profile sync state) and Home → Dienste. |
| `GET /api/system/stats` | nicht nötig | Host load is outside the agent runtime; Administrator → system health covers Helena’s own jobs. |
| `POST /api/curator/run` | in Helena | Agent → Laufzeit → Kurator → "Jetzt ausführen"; Helena also asks every enabled curator for a weekly review (runtime janitor), which the dashboard used to tick. |
| `POST /api/health/retirement` | nicht nötig | The dashboard's own shutdown hook; retired by the runbook instead. |
| `POST /api/ops/config-migrate` | nicht nötig | Config migrations run with the Hermes update (the helper's smoke test) and the runner's sync. |
| `POST /api/ops/debug-share` | nicht nötig | Debug bundles leave the host; not wanted. Logs and transcripts are readable in Helena. |
| `POST /api/ops/dump` | nicht nötig | Debug bundles leave the host; not wanted. Logs and transcripts are readable in Helena. |
| `POST /api/ops/prompt-size` | in Helena | Context size per chat answer and per run (chat composer, run list). |
| `PUT /api/curator/paused` | in Helena | Agent → Einstellungen → Fähigkeiten → Lernen → Kurator (the runner writes the pause); pinning a skill: Laufzeit → Kurator → Anheften. |
| `PUT /api/learning/node` | in Helena | Learned skills (agent → Fähigkeiten, with keep/archive/promote) and memory (agent → Gedächtnis); no graph view. |

### tools

| Route | Status | Where / why |
|---|---|---|
| `GET /api/tools/computer-use/status` | nicht nötig | Computer use is not granted; agents use the browser gateway (Home → Browser, per project). |
| `GET /api/tools/terminal/backends` | nicht nötig | The terminal backend is the isolation setup's (deployment, isolation.sh). |
| `GET /api/tools/toolsets` | in Helena | Agent → Fähigkeiten → Toolsets (on/off per agent; the reported inventory). |
| `GET /api/tools/toolsets/{name}/config` | nicht nötig | Toolset providers and keys stay the runner's/deployment's; keys go through Zugänge. |
| `GET /api/tools/toolsets/{name}/models` | nicht nötig | Toolset providers and keys stay the runner's/deployment's; keys go through Zugänge. |
| `POST /api/tools/computer-use/permissions/grant` | nicht nötig | Computer use is not granted; agents use the browser gateway (Home → Browser, per project). |
| `POST /api/tools/toolsets/{name}/post-setup` | nicht nötig | Toolset providers and keys stay the runner's/deployment's; keys go through Zugänge. |
| `PUT /api/tools/terminal/backend` | nicht nötig | The terminal backend is the isolation setup's (deployment, isolation.sh). |
| `PUT /api/tools/toolsets/{name}` | in Helena | Agent → Fähigkeiten → Toolsets switch. |
| `PUT /api/tools/toolsets/{name}/env` | nicht nötig | Toolset providers and keys stay the runner's/deployment's; keys go through Zugänge. |
| `PUT /api/tools/toolsets/{name}/model` | nicht nötig | Toolset providers and keys stay the runner's/deployment's; keys go through Zugänge. |
| `PUT /api/tools/toolsets/{name}/provider` | nicht nötig | Toolset providers and keys stay the runner's/deployment's; keys go through Zugänge. |

### web_server_dashboard

| Route | Status | Where / why |
|---|---|---|
| `GET /assets/{filename}.css` | nicht nötig | The dashboard's single-page app. |
| `GET /{full_path:path}` | nicht nötig | The dashboard's single-page app. |
