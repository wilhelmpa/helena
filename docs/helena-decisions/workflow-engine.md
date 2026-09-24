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
| Cron | dynamic, database-backed schedules: create/update/pause/resume/delete/trigger at runtime, IANA time zone, exactly-once per scheduled time (`sched-<name>-<time>` IDs), automatic backfill | via Vercel Cron / framework | `schedule(name, cron, data, {tz})`, one polling clock | static `crontab` (with backfill), not per user at runtime |
| Queues / concurrency | database-backed queues, per-worker/global concurrency, partitions | per world | yes | yes |
| Runs in-process in Bun, no build step | yes — verified (see below) | no: needs the Nitro/rollup compiler plugin, steps run as separate requests | yes | yes |
| Extra service | none (a `helena_engine` schema in the same database) | none with the Postgres world, but a framework build | none | none |

Temporal, Inngest, Hatchet and Trigger.dev were not evaluated further: each needs a server of its own, which §3b rules out without a very strong reason.

## Choice: DBOS Transact

DBOS is the only in-process library that covers the whole block: durable, checkpointed workflows, long waits, signals into waiting workflows, cancel/fork for "Erneut versuchen", and dynamic time-zoned cron schedules with exactly-once firing. pg-boss and graphile-worker are good queues, but with either one Helena would have to hand-roll exactly the part that is hard (a durable state machine with checkpoints, recovery and replay), which §3b forbids. The Workflow DevKit needs a compiler step and a supported framework; Helena's API is plain Bun + Elysia.

Verified on Kingston with Bun 1.4.2 and Postgres 17 (`~/agent-work/dbos-spike`): steps, `recv`/`send`, durable `sleep`, idempotent start by workflow ID, `forkWorkflow` from the failed step (earlier outputs reused, the failed step re-run), `cancelWorkflow`, database-backed queues, dynamic schedules in Europe/Berlin, and recovery after `kill -9` in the middle of a sleep (the restarted process finished the workflow; the completed steps did not run again).

Supporting standards:

- **croner** (MIT, already a dependency) to validate cron expressions and show the next run in the UI; DBOS fires the schedules itself.
- **CloudEvents 1.0** as the shape of Helena's domain events (`specversion`, `id`, `source`, `type`, `subject`, `time`, `data`). Only the format is adopted; the `cloudevents` npm SDK is not needed for an in-process bus (its engines field stops at Node 24).
- **Standard Webhooks** (`standardwebhooks`, MIT) to sign what the webhook step sends and to verify what the webhook trigger receives (`webhook-id`, `webhook-timestamp`, `webhook-signature`).

## How Helena sits on top (the thin layer)

- **One DBOS workflow interprets every Helena run** (`helena.run`): builder workflows, agent teams and routine fires are all runs of a definition (`pipeline_run` with its pinned definition). The interpreter walks the steps; every step execution is a sequence of named DBOS steps (`helena:<step>#<iteration>:<op>`), so a restart continues inside a step and a retry forks the workflow at the first operation of the failed step.
- **Step types and trigger types are registries** (`apps/api/src/modules/engine/registry.ts`, shaped for `@helena/sdk`): agent task, approval, wait, condition, task action, notify, webhook, delegate (routines) and agent team are built-in step types registered through the same API a plugin uses; manual, task events, schedule, webhook, mail arrival and delegation to a coordinator are built-in trigger types. A plugin adds a type without touching the engine.
- **Helena's tables stay the source of truth for people**: `pipeline_run` and `pipeline_run_step` hold the history the UI shows, `helena_schedule` holds routines and workflow schedules. DBOS's tables (`helena_engine` schema) hold only execution state.
- **Waiting is signalled, not polled**: an agent run that finishes, an approval that is decided and a cancel reach the waiting workflow through `DBOS.send`; a long `recv` timeout is only the safety net.
- **Approvals ask the policy engine** (`decide(agent, project, actionCategory)` from hub/autopilot) through one seam, `engine/policy.ts`; until that lands, a step approval always waits for a person, as before.
- **Catch-up policy** on top of DBOS's backfill: every missed time is fired once by DBOS; Helena runs only the newest one ("run once") or records it as missed ("skip missed", the default, with a ten-minute grace like before).

## Operational notes and risks

- DBOS creates and migrates its schema `helena_engine` when the API starts (`systemDatabaseSchemaName`). The API's database role owns the database, so no manual DDL is needed.
- `applicationVersion` is fixed (`HELENA_ENGINE_VERSION`, default `helena-engine-1`) so pending workflows are recovered after a deploy; the interpreter must stay replay-compatible, and a change to its order of operations uses `DBOS.patch()`.
- Each API replica needs its own `HELENA_ENGINE_EXECUTOR_ID` (default: the host name). A restarted replica recovers its own workflows; a replica that is gone for good is recovered by the engine janitor on another replica (it re-enqueues the pending workflows of executors whose heartbeat stopped).
- DBOS talks to Postgres with `pg` (its own pool, 10 connections), next to Helena's `postgres` pool.
- DBOS Conductor (the hosted management plane) is not used; Helena's own UI shows runs, steps, schedules and the engine's health.
