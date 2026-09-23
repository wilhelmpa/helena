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

- An issue delegated to an agent whose organization role is `coordinator` starts the workflow instead of queueing a run for that agent. When the start fails, Plan queues the run for the coordinator as for any other delegation.
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
  "attempt": 1
}
```

It returns the `stageResultSchema` from `src/mastra/team-contracts.ts`. A repeated idempotency key must return the same logical execution and must not create another Hermes session or Plan mutation. The bridge queues each stage as a Plan agent run through `/internal/orchestration/agent-run` with the stage `policy`; Plan stores `maxTurns` and `runBudgetSeconds` on the run and the Hermes runner passes them to `hermes chat`.

Plan refuses a stage with HTTP 409 while the stage's agent is paused, and pauses it first when one of its token ceilings or the project's is reached; the error names the reason. The bridge answers the stage request with the same status and a `message` carrying that error, and the Mastra step fails with it. A run in which the agent marked its task blocked ends as `success` with `blockedQuestion` set in the status document; the bridge fails that stage with HTTP 409 `hermes_run_blocked` and the question, since the run's output is no stage result.

### Cancellation

A canceled workflow run fires the abort signal of the running step. Mastra aborts the stage request and makes no further attempt, which closes the socket connection. The bridge then stops polling and cancels the stage's Plan run through `/internal/orchestration/agent-run/cancel`:

```json
{ "runId": 7, "projectRef": "project:KEY" }
```

It requires the same bearer as the other internal orchestration routes. Plan sets a `pending` run to `canceled` with `finishedAt` and moves the project's control-plane revision; a finished run keeps its outcome. The answer is the same status document `/internal/orchestration/agent-run/status` returns, so a repeated cancel gets the same answer. A runner executing the run learns of the cancel from its next heartbeat, which answers `{ "canceled": true }`: it interrupts the Hermes process group, kills it after five seconds, and reports nothing for the run. A stopping Mastra process closes the connection as well; the canceled run is queued again when Mastra continues the stage after its start.

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
- `start` creates a project-scoped run with the event ID as run ID and starts it without waiting for it to finish.
- `runs` and `run` expose stored status, checkpoints and history for one project. `runs` with a `taskRef` returns the runs whose payload names that task, searched among the project's 200 newest runs of the workflow.
- `retry` runs a failed run again from its failed step with Mastra time travel (`/workflows/:id/time-travel`), with the input the step failed with: a step of a loop ran with the output of its previous iteration. The steps before it keep their stored results. Like `start`, it does not wait for the run.
- `resume` continues a run suspended at an approval with `{ approved, decidedBy, note }`, in the step the run is suspended in (`approval-gate` when the run names none). Like `start`, it does not wait for the run.
- `cancel` stops a non-terminal run and cancels the Plan run of the stage it waits for (see Cancellation).
- `delete-project-schedules` deletes the schedules of every workflow of one project. Plan's worker calls it for a deleted project before provisioning moves the project to the trash, and retries the deletion while it fails.
- schedule operations create, read, update, pause, resume, run and delete Mastra schedules. `scheduleKey` is idempotent within one project and workflow; omission selects the `default` key. The fires of a schedule Plan creates are real runs, in Europe/Berlin unless the schedule names another time zone. `schedules` lists the schedules of one project (`projectRef`) or of several (`projectRefs`), each with `lastRun`: its newest fire, a manual run included, with run id, fire time, status, output and error. `schedule` reads one schedule of the project and workflow. `update-schedule` changes the cron and the time zone and, with `payload`, the input of the fires.

When Mastra starts, it continues the runs that were active when it stopped, each from the step it was in (`restartActiveRuns` in `src/mastra/index.ts`). The built server does not do this on its own. A continued stage asks the bridge for the same idempotency key.

Business schedules exist only in Mastra. Hermes cron is limited to Hermes-internal maintenance and must not start Plan workflows.

## Workflow builder

`plan-pipeline` runs the workflows members put together in Plan (Home → Workflows, and the Workflows page of a project). Plan stores a workflow in versions: a trigger, the roles its agent steps name, and an ordered list of steps (agent, approval, condition, task action, wait); a condition holds a lane of steps for each answer. A project uses a template of the team's library or its own workflow and names the agents of its roles. The definition and its validation are in `apps/api/src/modules/pipelines/definition.ts`; Mastra reads only what decides where a run goes (`src/mastra/pipeline-contracts.ts`). See [`docs/volition/workflow-builder-contract.md`](../../../../docs/volition/workflow-builder-contract.md) for the definition format, validation and versioning; this section covers only how Mastra executes a run.

Plan writes every run it starts, by hand, as a test run or for a task event (task created, assigned, moved to a status, given a label), before it calls `start` with the run id as event id and `{ "schemaVersion": 1, "pipelineId": 12 }` as payload. A start the control plane does not accept is retried by the api's background loop. A workflow with a schedule trigger has a Mastra schedule of `plan-pipeline` per project while it is enabled there (`scheduleKey` `pipeline-<id>`); each fire carries the same payload, and a fire that starts more than ten minutes late is skipped.

The workflow has three steps:

1. `prepare-pipeline` asks Plan to `begin` the run. Plan answers the task and the definition of the version the run pinned; for a schedule fire it creates the task and the run first, once per run id.
2. `run-pipeline-step` is a loop that executes one step per iteration. Every iteration is a checkpoint: Mastra continues a run after a restart in the step it was in, and a retry starts at the step that failed. A run executes at most 200 steps.
3. `finish-pipeline` tells Plan that the run succeeded or ended at a rejected approval.

Plan evaluates and applies every step and records its result; Mastra decides which step follows and never touches Plan's data. It calls `POST /internal/hermes/team/pipeline` on the bridge, which passes `{ "schemaVersion": 1, "operation", "runId", "projectRef", "stepId", "iteration", "seq", ... }` unchanged to `POST /internal/orchestration/pipeline` in Plan. `iteration` counts the executions of the step in the run (a rework loop reaches a step again), `seq` the step executions of the run. Plan answers an operation asked again for the same execution with what the first one did:

| Operation | Plan does | Answer |
|---|---|---|
| `begin` | Marks the run running | `{ run: { id, pipelineId, pipelineName, version, taskRef, dryRun }, definition }` |
| `agent` | Resolves the agent of the step's role in the project, renders the instruction with the task and the recorded results, and records the step as running. A failed or canceled execution asked again is a new attempt; the queued run of the old one is canceled. | `{ dryRun, attempt, idempotencyKey, agentRef, taskRef, prompt, timeoutSeconds, policy }` |
| `condition` | Evaluates the outcome of the previous agent, approval or action step, a keyword in its summary, or a field of the task | `{ matched }` |
| `action` | Sets the status, labels or assignee, adds a comment or creates a subtask, as the system actor `Workflow`. A change a workflow makes starts no workflow. | `{ summary }` |
| `approval` | `phase: wait` records the step as waiting with its rendered message; `phase: decided` records the decision and its note | `{ message }` |
| `wait` | Fixes the wake time at the first request: after a delay, or at the step's time of day (Berlin) on the task's due or start date | `{ wakeAt }`, null to go on at once |
| `record` | Records the result of an agent or wait execution, or the failure of any step | `{}` |
| `finish` | Marks the run succeeded, rejected or failed; a canceled run stays canceled | `{}` |

An agent step asks `agent`, then `POST /internal/hermes/team/pipeline-agent` with `{ idempotencyKey, projectRef, taskRef, agentRef, prompt, timeoutSeconds, policy }`. The bridge queues the Plan run through `/internal/orchestration/agent-run` with that key, waits for it like a stage and answers `{ agentRunId, outcome, summary }`: `success` with the end of the agent's answer, `blocked` with the question the agent asked, or `failed`. The idempotency key is the SHA-256 of run, step, iteration and attempt, so a continued step waits for the same Plan run and a retried one queues a new one. `policy` carries the step's `maxTurns` and `runBudgetSeconds`, lowered to the agent's own limits, and its `model`; Plan stores them on the run and accepts only a model an agent of the team runs. The pause and the token ceilings of Plan refuse the run like a stage. A step that times out, or whose Mastra run is canceled, cancels its Plan run. A failed or blocked agent step fails the Mastra run unless the next step is a condition on the outcome.

An approval step suspends the run in `run-pipeline-step`. Plan lists the waiting step on its Approvals page; the person's decision reaches Mastra through `resume`, and the resumed step records it with `approval` (`phase: decided`). A rejection ends the run, or sends it back to an earlier step on its path until the step's `maxLoops` are used up. The note is available to the later steps as `{{step.<id>.note}}`.

A wait step sleeps in the step until its wake time; a continued run sleeps what is left. A test run (`dryRun`) records every step and evaluates conditions, simulates agent steps, task actions and approvals, and does not wait.

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
