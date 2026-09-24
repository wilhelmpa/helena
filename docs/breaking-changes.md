# Breaking changes

Each release that removes or moves an API path is listed here, newest first. A script
or an MCP client that calls the API by path needs the replacement. The web app is
released with the API and needs no change.

## Mastra removed: workflows run in the api

Builder workflows, the agent team, routines and workflow schedules run in the api now, on
the Helena engine: DBOS Transact, with its state in the schema `helena_engine` of the api's
database, which the api creates and migrates when it starts. Mastra, Mastra Studio, the
Hermes team bridge and their tokens are gone. The migration `0173_helena_engine` drops the
`mastra_*` tables and the `mastra-*` project settings; every run keeps its history in
`pipeline_run`, and routines and workflow schedules are rows of `helena_schedule`.

| Removed | Replacement |
| --- | --- |
| `POST /internal/orchestration/agent-run`, `.../agent-run/status`, `.../agent-run/cancel`, `.../task-sync`, `.../routine`, `.../heartbeat`, `.../pipeline` (called by the team bridge) | none: the engine runs in the api process |
| `GET` and `POST /projects/:projectKey/control-plane/workflows/:workflowId/schedules`, `PATCH` and `DELETE .../schedules/:scheduleId`, `POST .../schedules/:scheduleId/:action`, `GET .../schedules/:scheduleId/triggers` | the `schedule` trigger of a builder workflow; routines keep `/projects/:projectKey/routines` |
| `POST /projects/:projectKey/control-plane/workflows/:workflowId/runs` | `POST /issues/:issueId/agent-team` starts the agent team on a task (it also starts when a task is delegated to a coordinator); a builder workflow starts from its trigger or `POST /issues/:issueId/pipeline-runs` |
| `POST /projects/:projectKey/control-plane/workflows/:workflowId/runs/:runId/approval` | `POST /pipeline-runs/:runId/approval` for the approval step of a workflow run |
| Studio below `/mastra/` | the workflow pages and Home → Systemzustand |

The other `/projects/:projectKey/control-plane/workflows` routes (list, settings, runs, retry,
cancel) stay and now answer from the engine. New are the public webhook trigger
`POST /hooks/workflows/:hookId` (Standard Webhooks signature), its management at
`/projects/:projectKey/pipelines/:pipelineId/hook`, the signing secret of webhook steps at
`/projects/:projectKey/workflow-signing-secret`, `GET /workflow-engine/types`,
`GET /workflow-engine/settings`, `GET` and `PUT /god/engine` (the instance time zone), and
`GET /projects/:projectKey/routines/:routineId/runs` (MCP `list_routine_runs`).

The health overview (`GET /god/system-health`) reports the services `runner`, `engine`,
`provisioning` and `worker` and the janitors `run-janitor`, `resume-janitor` and
`engine-maintenance`; `mastra`, `bridge`, `stage-janitor` and `workflow-schedules` are gone.

Removed from the deployment: the units `volition-mastra`, `volition-hermes-team-bridge` and
their `-dev` variants, `deployment/volition-stack/optional/mastra-studio/`, the nginx
snippet `volition-mastra-studio.conf` with `conf.d/volition-mastra-gateway.conf`, and the
integration service's `/internal/mastra/events` and `/internal/mastra/inbox/classify` routes
with the classifier socket. The integration service's inbox triage has no classifier until
one on Hermes exists; its runs fail with "No inbox classifier is configured." Its
connections report no longer probes Nextcloud.

Removed environment variables: `MASTRA_CONTROL_URL` and `MASTRA_CONTROL_TOKEN_FILE` (api and
worker), `PIPELINE_START_POLL_INTERVAL_MS`, `AGENT_TEAM_START_POLL_INTERVAL_MS`,
`STAGE_JANITOR_INTERVAL_MS` and `WORKFLOW_SCHEDULE_SYNC_INTERVAL_MS` (api); `MASTRA_INBOX_URL`,
`MASTRA_INBOX_TOKEN_FILE`, `MASTRA_INBOX_ORGANIZATION_REF`, `MASTRA_INBOX_PROJECT_REF`,
`MASTRA_INBOX_CAPABILITY_REF`, `MASTRA_INBOX_CLASSIFIER_SOCKET`, `MASTRA_EVENT_INGRESS_ENABLED`,
`MASTRA_EVENT_URL`, `MASTRA_EVENT_TOKEN_FILE`, `MASTRA_CONTROL_ENABLED`,
`MASTRA_CONTROL_TOKEN_FILE`, `INBOX_TRIAGE_CONTROL_PLANE` and `NEXTCLOUD_INTERNAL_URL`
(integration service); `HERMES_TEAM_TOKEN_FILE` and `HERMES_TEAM_SOCKET` (team bridge); and
the Mastra service's own `MASTRA_*` and `STUDIO_*` settings. An unknown variable is ignored,
so a stale line does no harm. The engine's settings are optional: `HELENA_ENGINE=off`,
`HELENA_ENGINE_DATABASE_URL`, `HELENA_ENGINE_SCHEMA`, `HELENA_ENGINE_POOL_SIZE`,
`HELENA_ENGINE_VERSION` (keep it fixed across deploys), `HELENA_ENGINE_EXECUTOR_ID` (one per
api replica; the compose files fix it to `api`), `HELENA_ENGINE_LOG_LEVEL`,
`HELENA_ENGINE_POLL_MS`, `HELENA_ENGINE_WAIT_SECONDS`, `HELENA_ENGINE_TICK_MS`,
`HELENA_ENGINE_MAINTENANCE_MS` and `HELENA_TIMEZONE` (see `.env.example`).

Upgrading a native host: `deployment/volition-stack/native/deploy.sh` stops and removes the
Mastra and bridge units before it migrates, and takes the Studio route out of the nginx site.
Remove by hand afterwards: `/etc/volition/mastra-control.token`,
`/etc/volition/mastra-gateway.token`, `/etc/volition/hermes-team.token`,
`/var/lib/volition/mastra` (Studio's SQLite database), the `volition-mastra` user, and any
`MASTRA_*` line in `/etc/volition/plan.env`. The legacy Docker stack's control token file
is now `.secrets/plan_control_token` (it was `plan_mastra_control_token`).

## Agent schedules become routines

Plan runs no schedules of its own. A schedule is a routine: an engine schedule that
creates a task delegated to an agent, or reopens one, on its cron.

| Removed | Replacement |
| --- | --- |
| `GET /projects/:projectKey/agent-schedules` | `GET /projects/:projectKey/routines` |
| `POST /projects/:projectKey/agent-schedules` | `POST /projects/:projectKey/routines` |
| `PATCH /projects/:projectKey/agent-schedules/:scheduleId` | `PATCH /projects/:projectKey/routines/:routineId` |
| `DELETE /projects/:projectKey/agent-schedules/:scheduleId` | `DELETE /projects/:projectKey/routines/:routineId` |
| `POST /projects/:projectKey/agent-schedules/:scheduleId/run` | `POST /projects/:projectKey/routines/:routineId/run` |
| `GET /projects/:projectKey/agent-schedules/:scheduleId/runs` and the two `.../cancel` routes | none: the work of a routine is a task, and its runs are the runs of that task |

A routine takes `agentId`, `title`, `instructions`, `mode` (`new`, or `reopen` with
`taskId`), `cron` and `timezone` (default `Europe/Berlin`); a create also takes an
`idempotencyKey`. Its id is a string. `GET /routines` lists the routines of every project
whose agents you may read. Over MCP, `list_routines`, `create_routine`, `update_routine`,
`delete_routine` and `run_routine` replace the eight `*_agent_schedule*` tools.

A project copy no longer takes `include.schedules`. The schedules of a project workflow
run for real, and their `timezone` is optional with the same default.

## MCP access moves to the team

Whether MCP reaches a project is now set on the team that owns it, not on the project.
A team carries an `mcpEnabled` switch, and each of its projects is either in the reach
or out of it.

`PATCH /projects/:projectKey/settings` no longer takes `mcpEnabled`. `PATCH
/teams/:teamId/mcp` takes both settings instead, and answers with the current state:

```
PATCH /teams/:teamId/mcp
{ "enabled": true, "projects": [{ "projectId": 12, "enabled": false }] }
```

The switch is written by an owner or a manager of the team. It is read from
`GET /teams` (`mcpEnabled` per team) and `GET /teams/:teamId/projects` (`mcpEnabled`
per project); `GET /projects/:projectKey/settings` reports both as read-only fields,
`mcpEnabled` and `teamMcpEnabled`. A project is reachable over MCP only while both
are on.

The team's own resources — its agents, skills, configured tools, roles and
integration credentials — follow the team switch as well. With it off, every
`/teams/:teamId/...` call over MCP answers 403, and `list_teams` stops listing the
team.

## Agents, skills, tools and integration credentials move to the team

An AI agent belongs to a team. So do the skill library, the configured tools and the
integration credentials, and every project of the team shares them. The routes moved
with them: `:projectKey` becomes `:teamId`. The response shapes do not change.

`GET /teams` lists the teams you belong to and gives the id these paths take.

| Removed                                                            | Replacement                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| `/projects/:projectKey/ai-agents`                                   | `/teams/:teamId/ai-agents`                                    |
| `/projects/:projectKey/ai-agents/:agentId`                          | `/teams/:teamId/ai-agents/:agentId`                           |
| `/projects/:projectKey/ai-agents/:agentId/regenerate-key`           | `/teams/:teamId/ai-agents/:agentId/regenerate-key`            |
| `/projects/:projectKey/ai-agents/:agentId/runs`                     | `/teams/:teamId/ai-agents/:agentId/runs`                      |
| `/projects/:projectKey/ai-agents/:agentId/skills`                   | `/teams/:teamId/ai-agents/:agentId/skills`                    |
| `/projects/:projectKey/ai-agents/:agentId/tool-configs`             | `/teams/:teamId/ai-agents/:agentId/tool-configs`              |
| `/projects/:projectKey/ai-agents/tools`                             | `/teams/:teamId/ai-agents/tools`                              |
| `/projects/:projectKey/agent-skills`                                | `/teams/:teamId/agent-skills`                                 |
| `/projects/:projectKey/agent-skills/:skillId`                       | `/teams/:teamId/agent-skills/:skillId`                        |
| `/projects/:projectKey/agent-skills/:skillId/markdown`              | `/teams/:teamId/agent-skills/:skillId/markdown`               |
| `/projects/:projectKey/agent-skills/:skillId/references`            | `/teams/:teamId/agent-skills/:skillId/references`             |
| `/projects/:projectKey/agent-skills/:skillId/references/content`    | `/teams/:teamId/agent-skills/:skillId/references/content`     |
| `/projects/:projectKey/agent-skills/github/discover`                | `/teams/:teamId/agent-skills/github/discover`                 |
| `/projects/:projectKey/agent-tools`                                 | `/teams/:teamId/agent-tools`                                  |
| `/projects/:projectKey/agent-tools/:agentToolId`                    | `/teams/:teamId/agent-tools/:agentToolId`                     |
| `/projects/:projectKey/integrations`                                | `/teams/:teamId/integrations`                                 |
| `/projects/:projectKey/integrations/:credentialId`                  | `/teams/:teamId/integrations/:credentialId`                   |
| `/projects/:projectKey/integrations/catalog`                        | `/teams/:teamId/integrations/catalog`                         |
| `/projects/:projectKey/integrations/models/:provider`               | `/teams/:teamId/integrations/models/:provider`                |
| `/projects/:projectKey/integrations/options`                        | `/teams/:teamId/integrations/options`                         |

`PUT /teams/:teamId/ai-agents/:agentId/projects` is new. It replaces the set of team
projects an agent works in.

The agent chat, the schedules and the paths that start a run stay project-scoped, and
their paths do not change.

### Over MCP

The tools keep their names. Those that manage agents, skills, tools or credentials
take a `teamId` in place of a `projectKey`. The API key gives the team, so an agent
and a person who belongs to one team send no `teamId`. A person in several teams
sends it, and reads the ids from the new `list_teams` tool.

### Runner scope

`runnerScope` on an agent accepts `owner` or `team`. The value `project` is renamed
to `team`, and the migration updates the existing rows. A client that sends `project`
is rejected. Only the name changes: the field still selects which runs an external
agent's runner receives, the runs of the owner only or the runs of every member.

### Roles

Every agent has a team role. An agent may do only the actions that it was granted and
that its role permits. An action the role refuses answers 403 during the run, and the
action picker marks it before the run.
