# Decision: the workflow engine (package D, "Helena engine instead of Mastra")

Status: decided 2026-09-24 · Owner rules: §3a "Helena als Framework" and §3b "Standards statt Eigenbau"

## What the building block has to do

Helena runs workflows of the builder, agent teams, recurring tasks (routines) and their schedules itself, so Mastra, its bridge and its tokens can go. Hermes stays the only external dependency besides Postgres. The engine has to:

- run a workflow durably: every step is checkpointed, a crash, restart or deploy continues at the step it was in, nothing runs twice;
- wait cheaply and for a long time: for an agent run (minutes to hours), an approval (days), a wait step (weeks);
- let a person cancel a run, retry a failed run from the failed step (earlier steps keep their results) and decide approvals;
- fire cron schedules in a time zone (Europe/Berlin by default), exactly once per scheduled time across replicas, with a catch-up policy after downtime;
- start runs from task events, webhooks and mail, idempotently;
- run in-process in the Bun API (`bun --watch` in dev mode, a plain Bun process in release mode), with no extra service.

## Candidates

| | DBOS Transact (TS) | Vercel Workflow DevKit | pg-boss | graphile-worker |
|---|---|---|---|---|
| What it is | Durable workflows as a library; state in Postgres | Durable functions via `"use workflow"`/`"use step"` directives | Job queue in Postgres | Job queue in Postgres |
| License | MIT | Apache-2.0 | MIT | MIT |
| Maturity / maintenance | 5.0.2, releases weekly, TS/Python/Go/Java SDKs, commercial backer | 4.x, very active, Vercel | 12.x, long-lived, very widely used | 0.18, long-lived, widely used |
| Durable step checkpoints, replay after a crash | yes (`runStep`, recovery on launch) | yes | no — each job is independent, the state machine would be ours | no — same |
| Long durable waits | `DBOS.sleep` (durable), `DBOS.recv` with timeout | `sleep`, hooks | delayed jobs (`startAfter`) | `run_at` |
| External signal into a waiting run (approval, agent run done) | `DBOS.send` / `DBOS.recv` | hooks / webhooks | would be ours | would be ours |
| Cancel, resume, retry from a step | `cancelWorkflow`, `resumeWorkflow`, `forkWorkflow(id, step)` | cancel; no fork | cancel job; no step history | remove job |
| Idempotent start | workflow ID + `duplicationPolicy` | run ID | `singletonKey` | `job_key` |
| Cron | dynamic, database-backed schedules: create/update/pause/resume/delete/trigger at runtime, IANA time zone, exactly-once per scheduled time (`sched-<name>-<time>` IDs), automatic backfill — but wall-clock matching across summer time (see "Schedules") | via Vercel Cron / framework | `schedule(name, cron, data, {tz})`, one polling clock | static `crontab` (with backfill), not per user at runtime |
| Queues / concurrency | database-backed queues, per-worker/global concurrency, partitions | per world | yes | yes |
| Runs in-process in Bun, no build step | yes — verified (see below) | no: needs the Nitro/rollup compiler plugin, steps run as separate requests | yes | yes |
| Extra service | none (a `helena_engine` schema in the same database) | none with the Postgres world, but a framework build | none | none |

Temporal, Inngest, Hatchet and Trigger.dev were not evaluated further: each needs a server of its own, which §3b rules out without a very strong reason.

## Choice: DBOS Transact

DBOS is the only in-process library that covers the whole block: durable, checkpointed workflows, long waits, signals into waiting workflows, cancel/fork for "Erneut versuchen", idempotent starts by workflow ID, and durable queues. pg-boss and graphile-worker are good queues, but with either one Helena would have to hand-roll exactly the part that is hard (a durable state machine with checkpoints, recovery and replay), which §3b forbids. The Workflow DevKit needs a compiler step and a supported framework; Helena's API is plain Bun + Elysia.

Verified on Kingston with Bun 1.4.2 and Postgres 17 (`~/agent-work/dbos-spike`): steps, `recv`/`send`, durable `sleep`, idempotent start by workflow ID, `forkWorkflow` from the failed step (earlier outputs reused, the failed step re-run), `cancelWorkflow`, database-backed queues, dynamic schedules in Europe/Berlin, and recovery after `kill -9` in the middle of a sleep (the restarted process finished the workflow; the completed steps did not run again).

Supporting standards:

- **croner** (MIT, already a dependency) computes the scheduled times: the next run the UI shows and the times the engine fires (see "Schedules" below).
- **CloudEvents 1.0** as the shape of Helena's domain events (`specversion`, `id`, `source`, `type`, `subject`, `time`, `data`). Only the format is adopted; the `cloudevents` npm SDK is not needed for an in-process bus (its engines field stops at Node 24).
- **Standard Webhooks** (`standardwebhooks`, MIT) to sign what the webhook step sends and to verify what the webhook trigger receives (`webhook-id`, `webhook-timestamp`, `webhook-signature`).

## How Helena sits on top (the thin layer)

- **One DBOS workflow interprets every Helena run** (`helena.run`): builder workflows, agent teams and routine fires are all runs of a definition (`pipeline_run` with its pinned definition). The interpreter walks the steps; every step execution is a sequence of named DBOS steps (`helena:<step>#<iteration>:<op>`), so a restart continues inside a step and a retry forks the workflow at the first operation of the failed step.
- **Step types and trigger types are registries.** Helena's own types (agent task, approval, wait, condition, task action, notify, webhook, delegate for routines, agent team; triggers manual, the task events, schedule, webhook, mail arrival, delegation, routine) implement the engine's interface in `apps/api/src/modules/engine/sdk.ts`, which gives a step the durable operations of its execution (`op`, `sleepUntil`, `waitForSignal`). A **plugin** registers its types in the framework's shape (`@helena/sdk` `WorkflowStepType` / `TriggerType`, through the plugin host into `registries.stepTypes` / `registries.triggerTypes`, framework handoff §8); the engine adapts each to its own interface (`engine/plugins.ts`), so the builder lists, checks and draws them and the interpreter runs them like its own:
  - a plugin step keeps its settings under `config`, checked against the type's `configSchema` (Standard Schema; its JSON Schema is the builder's form) and `validate`; its texts may hold `{{variables}}`, filled in before `execute`; its `outputs` are `{{step.<id>.<field>}}` for later steps;
  - `execute` runs as a recorded operation (replayed, not repeated); `completed` goes on (`next` jumps), `failed` is the outcome an outcome condition can branch on, `waiting` stores the run until `until` or the signal (`approval` id, agent `run` id, or a domain `event` type, `<type>@<subject>` for one subject), then `resume` gets the signal; a wake-up subscriber of the engine (`plugin_waits`) signals the waiting run, and a wait that times out checks approvals and agent runs itself;
  - a test run executes a plugin step of category `read` and records every other one as simulated;
  - a plugin trigger listens to domain events (patterns like `acme.*`) and answers the task and the variables of the run (kept as the run's `input.trigger`, which plugin steps read as `input.trigger`; the text `{{…}}` variables do not name them yet); a trigger that fires on a schedule of its own (`next`) is not run yet (the builder says so);
  - a plugin's type id is namespaced (`<plugin>.<name>`): Helena's names have no dot, so neither hides the other; the database accepts the framework's id format for step kinds and triggers.
  The example plugin `hello-helena` runs its step `hello-helena.greet` in a workflow with no change to the engine (`engine/__tests__/integration/plugin-types.test.ts`).
- **Helena's tables stay the source of truth for people**: `pipeline_run` and `pipeline_run_step` hold the history the UI shows, `helena_schedule` holds routines and workflow schedules. DBOS's tables (`helena_engine` schema) hold only execution state.
- **Waiting is signalled, not polled**: an agent run that finishes, an approval that is decided and a cancel reach the waiting workflow through `DBOS.send`; a long `recv` timeout is only the safety net.
- **The engine asks the framework's policy host** (orchestrator decision D-C1, `@helena/sdk` `decide` over `registries.policies`, where the Autopilot is the built-in evaluator `helena.autopilot`). Every step type has an action category (webhook `send`, task action `write`, notify `report`, a plugin step its declared one). Before every execution of a step above `report` the interpreter asks (`engine/policy.ts` `askStepPolicy`, a recorded operation): the agent is the one that started the run when an agent did; a run a person started is the person's action, which the Autopilot leaves to permissions, while a plugin's evaluator may still decide. "Deny" fails the step with the reason; "needs approval" opens an approval of its own (`<step>.approval`, on the Approvals page like an approval step): approved, the step executes; rejected, the run ends as rejected and the step is recorded as skipped. A test run is never asked about. The engine's own two questions stay behind one seam (`registry.ts` `setPolicyDecider`, default `defaultPolicy`): `run` before every agent run of a step or stage (the agent's pause and budgets decide; a refusal fails the step) and `approve` for an approval step (it waits for a person). They answer the same way as the Autopilot's `autopilotPolicyDecider`.
- **Schedules** (see below) fire through a DBOS workflow per scheduled time; the catch-up policy decides what the newest missed time does: it runs ("run once") or is recorded as missed ("skip missed", the default, with a ten-minute grace like before). Older missed times never run.

## Schedules: croner times, DBOS exactly-once

DBOS's dynamic schedules were the first choice and were built, then replaced after a test across the changes of summer time in Europe/Berlin. DBOS's cron matcher compares wall-clock fields, so a daily `30 2 * * *` fires **twice** on the day summer time ends (02:30 summer time and 02:30 winter time) and **not at all** on the day it begins (02:30 does not exist). The UI's "next run", computed with croner, disagreed with it on both days. A routine that creates a task at 02:30 would create two once a year and none once a year.

Helena therefore computes the times with croner, the same library the UI uses, and lets DBOS do what it is good at: running each fire exactly once. `helena_schedule.fired_through` holds the time up to which a schedule is handled. The engine's quick tick (every 3 s, `engine/janitor.ts`) takes, for every enabled schedule, the newest croner time after `fired_through` and at or before now, starts the DBOS workflow `helena.fire` with the ID `fire:<schedule>:<time>`, and then moves `fired_through` forward (only forward). So:

- replicas that tick at the same moment start the same workflow ID, and DBOS runs it once; the run itself has the ID `fire-<hash of schedule and time>` and a unique index on (schedule, time) on top;
- a crash between the start and the move of `fired_through` starts the same ID again on the next tick, which DBOS answers with the existing workflow;
- a clock set back finds `fired_through` in the future and fires nothing until the clock passes it;
- downtime, or a clock set forward, finds several missed times: only the newest counts, under the catch-up policy;
- creating a schedule, switching it on again and giving it another time or time zone set `fired_through` to that moment, so it starts afresh; a new title does not.

Croner fires every local time once: a time that does not exist when summer time begins fires an hour later (02:30 → 03:30 summer time), a time that happens twice when it ends fires the first time. The price is that an hourly schedule skips the repeated hour once a year (it fires at 02:00 summer time and next at 03:00 winter time); that is documented in the tests (`engine/__tests__/unit/schedules.test.ts`). The Administrator health overview counts schedules whose time passed more than five minutes ago without a fire ("overdue"), which catches a tick that stopped.

## The event transport (orchestrator decision D-C2)

Helena has one domain event bus, the framework's (`@helena/sdk`, `apps/api/src/shared/helena.ts`, `apps/worker/src/events.ts`). The engine is its durable transport, an `EventTransport`, with no table and no claim loop of its own:

- `append(events, tx)` stores each event as a DBOS workflow, once per process that serves it: `helena.event` on the queue `helena-events` for the api's engine (the workflow triggers) and `helena.worker-event` on `helena-events-worker` for the worker (the durable subscribers of its plugins, outgoing webhooks among them). It writes through DBOS's own SQL function `enqueue_workflow` in the change's transaction when one is passed, so an event exists exactly when its change does. The workflow id holds the event id (`event:<id>`, `worker-event:<id>`), so storing an event again changes nothing. (`packages/db/src/engine-events.ts`.)
- The api hands the bus this transport when its engine starts and takes it back when it stops (`engine/dbos.ts`), so an api without the engine (`HELENA_ENGINE=off`, most test files) runs every subscriber in process, as before the bus.
- The worker runs the DBOS runtime for its queue only (`listenQueues`, executor `<id>-worker`, `apps/worker/src/engine-delivery.ts`). It records which durable subscribers take an event, then runs each as one step with retries and backoff (`HELENA_EVENT_MAX_ATTEMPTS`, `HELENA_EVENT_RETRY_SECONDS`), so a subscriber runs once per event and again only after it failed; one that keeps failing delays only itself. An api replica listens only to the runs and its own event queue.
- The task triggers listen to the framework's core issue events (`helena.issue.created`, `.assigned`, `.state_changed` with `columnId`, `.label_changed` with `added`), which the issue service publishes once per change with the actor; a workflow's own change carries the actor `system:workflow` and starts no workflow. A mail that arrived is `helena.mail.received`. All go through the same bus. The engine's triggers are a subscriber of the api's queue (`subscribeDomainEvents` in `engine/registry.ts`); a routine that fires publishes `helena.routine.fired`. Events use the framework's CloudEvents 1.0 shape (`helenaproject`, `helenaactor` extension attributes).

## The other claim loops (to move onto the engine later, one at a time)

Helena has these queues and loops of its own besides the engine. Each keeps working as it is; each can later become a DBOS queue or workflow. Suggested order: the ones that do external I/O with retries first.

| Loop | Where | What it claims | Move to |
|---|---|---|---|
| Webhook deliveries | worker `store.ts` | `webhook_delivery` rows, retries with jitter | a DBOS queue per delivery (retries as step retries) |
| Connector actions (hub/access-center) | api `connectors/tools.ts` `processConnectorActions` | connector actions a person approved | a DBOS workflow per action, started by the approval's decision |
| Knowledge index (hub/second-brain) | worker `knowledge-indexer.ts` (poll per source, embeddings) | changes of every knowledge source | stays a poll per source (cursor based); the embedding pass could become a DBOS queue |
| Notification deliveries | worker `notification-delivery.ts` | `notification_delivery` (email, Telegram) | DBOS queue |
| Mail send | worker `mail/send.ts` | outgoing mail | DBOS workflow per message |
| Project provisioning / deprovisioning | worker `project-provisioning.ts` (two claims) | provisioning jobs | a DBOS workflow per job (steps: schedules off, provision call, record) |
| Hub inbox triage | worker `hub-inbox-store.ts` (two claims) | inbox events and threads | DBOS workflow per thread (needs a Hermes-based classifier first) |
| Mail sync | worker `mail/worker.ts` | accounts to sync | a DBOS scheduled workflow per account |
| Vault watcher / extraction | `packages/vault/src/watcher.ts` (`setInterval`) | files to index and extract | stays in process (file watching), extraction as a DBOS queue |
| Action runs | api `modules/actions/queue.ts` | project automation runs | a DBOS workflow per run (the automations could become builder workflows) |
| Hub inbox tasks | api `hub-inbox/tasks.ts` | tasks from inbox items | DBOS queue |
| Runner claims | api `agents/runner/service.ts` | `agent_run` rows, claimed by runners over HTTP | stays: the runner pulls; the engine already waits on these runs by signal |
| Chat claims | api `agents/chat/service.ts` | chat turns claimed by runners | stays (same pull model as the runner) |
| Run janitor, resume janitor, auto-archive, Autopilot decision log | api `background.ts` | expired runs, resume limits, stale issues, old policy decisions | DBOS scheduled workflows |

The loops share one helper now, `@helena/loop` (`startLoop`, `intEnv`), used by the api and the worker. Removed with Mastra: the pipeline-start retry loop, the agent-team start queue (`agent_team_start`), the stage janitor and the schedule sync loop. The engine's own passes run on the same helper: the quick tick (schedules, finished agent runs, lost starts, heartbeat) and the maintenance pass (runs of executors that are gone, pruning).

## Operational notes and risks

- DBOS creates and migrates its schema `helena_engine` when the API starts (`systemDatabaseSchemaName`). The API's database role owns the database, so no manual DDL is needed.
- `applicationVersion` is fixed (`HELENA_ENGINE_VERSION`, default `helena-engine-1`) so pending workflows are recovered after a deploy; the interpreter must stay replay-compatible, and a change to its order of operations uses `DBOS.patch()`.
- Each API replica needs its own `HELENA_ENGINE_EXECUTOR_ID` (default: the host name). A restarted replica recovers its own workflows; a replica that is gone for good is recovered by the engine janitor on another replica (it re-enqueues the pending workflows of executors whose heartbeat stopped).
- DBOS talks to Postgres with `pg` (its own pool, 10 connections), next to Helena's `postgres` pool.
- DBOS Conductor (the hosted management plane) is not used; Helena's own UI shows runs, steps, schedules and the engine's health.
