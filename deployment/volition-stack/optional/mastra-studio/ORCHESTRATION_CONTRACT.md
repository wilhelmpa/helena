# Agent orchestration contract

Mastra owns workflow definitions, event triggers, schedules, retries, checkpoints and run history. Hermes owns agent sessions, memory, skills, tools and model execution. Plan owns projects, human-visible tasks, review decisions and the orchestration configuration shown in its UI.

## Payload

`agent.team.requested` and Plan's control API start `agent-team` with a project-scoped envelope. The payload names one Plan task, one coordinator, the allowed specialist pool and a bounded execution policy:

```json
{
  "schemaVersion": 1,
  "task": {
    "taskRef": "task:KEY-12",
    "title": "Issue title",
    "objective": "Issue description",
    "acceptanceCriteria": ["One entry per checklist item of the description"],
    "labels": ["frontend"]
  },
  "coordinator": { "agentRef": "agent:hermes-key-coordinator", "role": "coordinator", "capabilities": [] },
  "specialists": [{ "agentRef": "agent:designer", "role": "specialist", "capabilities": ["frontend"] }],
  "policy": {
    "reviewRequired": true,
    "autonomy": "review",
    "maxTurns": 40,
    "runBudgetSeconds": 900
  },
  "execution": {}
}
```

| Policy field | Default | Meaning |
|---|---|---|
| `maxAttempts`, `initialBackoffMs`, `maxBackoffMs`, `backoffMultiplier` | 3, 1000, 30000, 2 | Retries of one bridge request with the same idempotency key. These are the only retries of a stage: the steps that run stages have no Mastra retries of their own. |
| `leaseSeconds`, `heartbeatSeconds` | 300, 60 | Bounds of the execution lease Hermes reports. Plan rejects bounds its runner cannot honor before it queues paid agent work. |
| `timeoutSeconds` | 900 | How long the bridge waits for one stage, queue time included (30–7200). With `runBudgetSeconds` set, Mastra raises it to at least the budget plus 300 seconds, up to 7200. |
| `reviewRequired` | true | Whether the coordinator reviews the specialist results. |
| `autonomy` | `review` | `review` always leaves the task in Review. `done` moves it to Done when the coordinator review accepted the work. |
| `maxTurns` | unset | Hermes `--max-turns` of every stage (1–200). |
| `runBudgetSeconds` | unset | Hermes `--run-budget` of every stage (60–7200). |

Model and reasoning in `execution` are optional provider-neutral strings; Plan rejects a stage whose values differ from the agent's configuration. Tests that exercise a model must use Luna with low reasoning.

## Starting from Plan

Plan starts `agent-team` for an issue in two ways, both only when the project has the workflow enabled:

- An issue delegated to an agent whose organization role is `coordinator` starts the workflow instead of queueing a run for that agent. Plan records the start in `agent_team_start` with a new event id before it asks Mastra. When Mastra does not answer, or answers with a server error, it is not known whether the run started, so Plan asks again with the same event id, after 5 seconds and then up to every 5 minutes, until Mastra answers; `start` answers an event id it has with that run. When Mastra or Plan refuses the start (a 4xx answer), Plan queues the run for the coordinator as for any other delegation. A start is dropped when the issue is delegated to someone else before it is made, and while the agent-team run of an earlier start is still active for the issue: one agent-team run per issue at a time. An issue delegated again while its start waits for Mastra gets no second start.
- `POST /issues/:issueId/agent-team` starts it on request. The delegate leads when it is a coordinator, otherwise the project's only coordinator.

Plan builds the payload from the issue: `taskRef` is `task:<KEY>-<number>`, the objective is the description (the title when it is empty, at most 12000 characters), the acceptance criteria are the description's Markdown checklist items (`- [ ]`, `- [x]`) or one default criterion, and the labels are the issue's label names. The specialists are the project's external agents with the organization role `specialist` and their capabilities; without one the coordinator is its own specialist. The correlation ID is the task reference. `reviewRequired`, `autonomy`, `maxTurns` and `runBudgetSeconds` of the policy come from the project's `agent-team` configuration, which replaces the same fields of any policy the start request carries; a limit the project leaves unset keeps the one of the request. Plan waits at most 30 seconds for a start, since the control plane does not wait for the run. `GET /issues/:issueId/agent-team/runs` lists the runs whose payload names the issue.

## Stages

The workflow persists five stages in Mastra:

1. `prepare-team` validates scope, membership and policy.
2. `coordinate` routes the task. With one specialist, or when the task labels match the capabilities of exactly one specialist (case-insensitive), Mastra builds one delegation for that specialist without a coordinator stage and records a `route` entry in the stage history. Otherwise it asks the coordinator for assignments limited to the specialist pool. An assignment may list in `dependsOn` the assignment IDs that must finish first; Mastra rejects duplicate IDs, unknown dependencies and cycles.
3. `specialize` executes the assignments in dependency order. Assignments whose dependencies have finished run in parallel. A dependent assignment receives the summary and evidence of each assignment it depends on.
4. `review` asks the coordinator to evaluate the evidence against every acceptance criterion. It is skipped when `reviewRequired` is false.
5. `synchronize-plan` writes the summary and evidence to the exact task and sets Review, or Done under autonomy `done` with an accepted review. Without a review the summary is the specialist summaries.

Every Hermes stage uses a SHA-256 idempotency key derived from event, correlation, phase and assignment. Retries reuse the key. Plan queues the run of a key again when the key is asked for after the run failed or was canceled, so a retried or continued stage executes again; a finished run answers with its outcome. The bridge must return its execution ID, attempt, timestamps and a bounded lease containing `claimedAt`, `heartbeatAt` and `expiresAt`. Mastra rejects stale or mismatched responses. Mastra step outputs are the durable checkpoints and its stored run is the canonical run history.

## Private Hermes bridge

Mastra connects only through `/run/volition-ipc/hermes-team.sock`. Authentication is read from `HERMES_TEAM_TOKEN_FILE`, which must be below `/run/secrets`. Neither the workflow input nor its stored output contains the token. A stage request waits `timeoutSeconds` plus 30 seconds for the answer.

While the socket is missing, refuses connections or closes a connection (the bridge starts or restarts), Mastra sends the request again every two seconds, for a stage until its timeout and for a synchronization or routine request for five minutes. This does not count as an attempt. The bridge in turn waits out Plan not answering or answering with a server error until the stage's deadline; any other answer of Plan ends the request.

`POST /internal/hermes/team/stages` accepts:

```json
{
  "schemaVersion": 1,
  "phase": "coordinate | specialize | review",
  "idempotencyKey": "64 hexadecimal characters",
  "projectRef": "project:KEY",
  "task": {},
  "agent": {},
  "allowedSpecialists": [],
  "assignment": {},
  "dependencyResults": [{ "assignmentId": "...", "summary": "...", "evidence": [] }],
  "specialistResults": [],
  "policy": {},
  "execution": {},
  "workflowRunId": "the Mastra run that waits on the stage",
  "attempt": 1
}
```

It returns the `stageResultSchema` from `src/mastra/team-contracts.ts`. A repeated idempotency key must return the same logical execution and must not create another Hermes session or Plan mutation. The bridge queues each stage as a Plan agent run through `/internal/orchestration/agent-run` with the stage `policy`; Plan stores `maxTurns` and `runBudgetSeconds` on the run and the Hermes runner passes them to `hermes chat`. Plan stores `workflowRunId` with the key; its janitor cancels a pending stage run whose workflow run was canceled or no longer exists.

Plan refuses a stage with HTTP 409 while the stage's agent is paused, and pauses it first when one of its token ceilings or the project's is reached; the error names the reason. The bridge answers the stage request with the same status and a `message` carrying that error, and the Mastra step fails with it. A run in which the agent marked its task blocked ends as `success` with `blockedQuestion` set in the status document; the bridge fails that stage with HTTP 409 `hermes_run_blocked` and the question, since the run's output is no stage result.

### Cancellation

A canceled workflow run fires the abort signal of the running step. Mastra aborts the stage request, makes no further attempt, and sends `POST /internal/hermes/team/stages/cancel`:

```json
{ "schemaVersion": 1, "idempotencyKey": "64 hexadecimal characters", "projectRef": "project:KEY" }
```

The bridge passes it to `/internal/orchestration/agent-run/cancel`, which takes either that key or the run:

```json
{ "runId": 7, "projectRef": "project:KEY" }
```

It requires the same bearer as the other internal orchestration routes. Plan sets a `pending` run to `canceled` with `finishedAt` and moves the project's control-plane revision; a finished run keeps its outcome. The answer is the same status document `/internal/orchestration/agent-run/status` returns, so a repeated cancel gets the same answer. A runner executing the run learns of the cancel from its next heartbeat, which answers `{ "canceled": true }`: it interrupts the Hermes process group, kills it after five seconds, and reports nothing for the run.

A closed connection only makes the bridge stop polling. A stopping Mastra process closes its connections without canceling anything, so the stage's Plan run keeps executing, and the stage Mastra continues after its start finds that run under the same key: it is executed once. A cancel that does not reach Plan is repaired by Plan's janitor (see above).

`POST /internal/hermes/team/synchronize` accepts the exact project and task references, target state, summary, evidence and idempotency key. It returns the same idempotency key and `synchronizedAt`. The bridge must reject cross-project task references.

## Routines

A routine is a Mastra schedule of the `agent-routine` workflow. Plan creates it from the Schedules page of a project with the work envelope as the schedule's input. The envelope's actor is the member who saved the routine last, and its payload names the routine:

```json
{
  "projectRef": "project:KEY",
  "agentRef": "agent:writer",
  "title": "Weekly report",
  "instructions": "Summarize the week.",
  "mode": "new",
  "taskRef": "task:KEY-12"
}
```

`mode` is `new` (every fire creates a task) or `reopen` (every fire reopens the task `taskRef` names); `taskRef` is present exactly for `reopen`.

The workflow has two steps:

1. `prepare-routine` takes the event id, the correlation id and the time of the fire from its run id, `sched_<scheduleId>_<fire time in ms>`. It writes the project as the resource id of the run, which a schedule fire starts without, so Plan lists the run with the runs of the project. A fire that starts more than ten minutes after its time is missed: Mastra fires a schedule that came due while it was stopped once when it starts again, and that fire changes nothing.
2. `dispatch-routine` names the routine's task, the one to reopen or, for `new`, the task recorded by the newest earlier fire of the same schedule, and sends the request below through the private bridge.

`POST /internal/hermes/team/routine` on the bridge passes the request to `POST /internal/orchestration/routine` in Plan, with the same bearer as the other internal orchestration routes:

```json
{
  "schemaVersion": 1,
  "idempotencyKey": "SHA-256 of the fire's event id, 64 hexadecimal characters",
  "projectRef": "project:KEY",
  "agentRef": "agent:writer",
  "title": "Weekly report",
  "instructions": "Summarize the week.",
  "mode": "new",
  "taskRef": "task:KEY-12",
  "actorId": "the Plan user id of the envelope's actor"
}
```

Plan answers `{ "idempotencyKey": "...", "outcome": "created | reopened | skipped", "taskRef": "task:KEY-13" }`:

- While the named task is open, neither in a completed or canceled state nor archived, the answer is `skipped` with that task, and nothing changes.
- `new` creates a task in the project's first unstarted state, with the title and the instructions as its description, delegated to the agent.
- `reopen` restores the task when it is archived, moves it to the first unstarted state, delegates it to the agent and adds a comment with the instructions.

The delegation goes through Plan's delegation path: it queues a run of the agent, or starts `agent-team` when the agent is a coordinator of a project that runs it. The agent has to react to delegation. The task is created or reopened for the actor while they are a member of the project. A repeated idempotency key answers what the first request did; the key with another request is refused with 409.

The run output is `{ "workflowId": "agent-routine", "correlationId", "projectRef", "status": "created | reopened | skipped | dry-run-complete", "taskRef", "skipReason": "task-open | missed | null" }`. Every finished fire records the routine's task, a skipped one included, so later fires keep skipping while that task is open. Fires older than 90 days are deleted (see Retention), so a `new` routine whose fires are more than 90 days apart does not find the task of its previous fire and creates a task on every fire.

The other scheduled workflows get the same per-fire ids: `agent-team` takes its event id, correlation id and time from the run id of a schedule fire and writes the project as its resource id. The evented engine, which runs schedule fires, stores the result record of the last step as the run result; mastra-control answers the output of such a run like that of any other.

## Plan control

Plan controls the workflow through the Mastra control API:

- `catalog` lists definitions and ownership.
- `start` creates a project-scoped run with the event ID as run ID and starts it without waiting for it to finish. An event ID it already has is answered with that run; a run that was created but never started, because a start failed between the two Mastra calls, is started then. Concurrent starts of one event ID share one pair of Mastra calls.
- `runs` and `run` expose stored status, checkpoints and history for one project. `runs` with a `taskRef` returns the runs whose payload names that task, searched among the project's 200 newest runs of the workflow.
- `retry` runs a failed run again from its failed step with Mastra time travel (`/workflows/:id/time-travel`). The steps before it keep their stored results. Like `start`, it does not wait for the run.
- `cancel` stops a non-terminal run and cancels the Plan run of the stage it waits for (see Cancellation).
- `delete-project-schedules` deletes the schedules of every workflow of one project. Plan's worker calls it for a deleted project before provisioning moves the project to the trash, and retries the deletion while it fails.
- schedule operations create, read, update, pause, resume, run and delete Mastra schedules. `scheduleKey` is idempotent within one project and workflow; omission selects the `default` key. The fires of a schedule Plan creates are real runs, in Europe/Berlin unless the schedule names another time zone. `schedules` lists the schedules of one project (`projectRef`) or of several (`projectRefs`), each with `lastRun`: its newest fire, a manual run included, with run id, fire time, status, output and error. `schedule` reads one schedule of the project and workflow. `update-schedule` changes the cron and the time zone and, with `payload`, the input of the fires.

When Mastra starts, it continues the runs that were active when it stopped, each from the step it was in (`restartActiveRuns` in `src/mastra/index.ts`). The built server does not do this on its own. A continued stage asks the bridge for the same idempotency key and waits for the Plan run it gets, which is still running, already finished, or queued again after it failed.

Business schedules exist only in Mastra. Hermes cron is limited to Hermes-internal maintenance and must not start Plan workflows.

## Retention

Mastra deletes workflow runs whose last change is more than 90 days old and the fire records of schedules older than 90 days (`retention` of the store in `src/mastra/index.ts`). It prunes when it starts and then once a day, at most 100000 rows per table and call; a larger backlog is deleted over the following days. Schedules themselves are kept. Plan lists only the runs Mastra still holds; the results of agent-team runs and routines are stored in Plan's tasks. LibSQL reuses the freed pages, so the database file stops growing but does not shrink; a `VACUUM` of the stopped database returns the space.

## Trust model

A request is not trusted because it comes from the same host. Every request that reaches Mastra carries a token, and each token is readable only by the Unix users of the services that need it.

| Listener | Accepts | Token holders |
|---|---|---|
| Mastra, `127.0.0.1:4112` | `Authorization: Bearer <upstream token>` on every `/mastra/api/*` route and the Studio control routes (`server.auth` with `SimpleAuth`). The Studio page and its static files need no token and hold no data. | `start.mjs` creates the upstream token on every start and passes it in the environment to the Mastra server and the proxy, both `volition-mastra`. It is never written to disk. |
| Proxy `127.0.0.1:4111`, `/internal/mastra/control` | `Authorization: Bearer` with `/etc/volition/mastra-control.token` | Plan API and Plan worker (`volition-plan`) |
| Proxy, `/internal/events` and `/internal/inbox/triage` | `Authorization: Bearer` with the token of `INBOX_ADAPTER_TOKEN_FILE`. Without that variable both routes are closed, as on Kingston. | none on Kingston |
| Proxy, Studio below `/mastra/` | `X-Volition-Gateway-Token` equal to `/etc/volition/mastra-gateway.token` | Nginx, which adds it to `/mastra/` requests after Plan's `/auth/verify/owner` accepted the session of the instance owner |
| Hermes bridge, `/run/volition-ipc/hermes-team.sock` | `Authorization: Bearer` with `/etc/volition/hermes-team.token`; the socket is `0600 volition-mastra` | Mastra and the bridge (`volition-mastra`) |

The proxy compares tokens in constant time and ignores identity headers such as `X-Volition-Auth` and `X-Auth-Request-Email`. It forwards only the upstream token to Mastra, never cookies, the gateway token or other credentials of the request. The control route calls the Mastra API directly with the upstream token; it does not pass through the Studio route checks.

The token files in `/etc/volition` are `0600 root`, and systemd delivers them with `LoadCredential=` to `/run/credentials/<unit>/`, which only the unit's user can read. Hermes runs, provisioning and the Hermes runner are `volition-hermes`, so no process of that user holds a Mastra token: a Hermes tool call can connect to `:4111` and `:4112` and both refuse it. For the same reason provisioning holds no Mastra token and the worker deletes the schedules of a deleted project. `plan-control.token`, the bearer of Plan's internal orchestration routes, is a separate token; provisioning holds it for the bootstrap routes.
