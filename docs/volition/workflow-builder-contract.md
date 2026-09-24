# Workflow builder contract

This is the contract between Plan's workflow builder (Home → Workflows, and a project's
Workflows page) and the Helena engine, which runs the workflows inside Plan's API
(`apps/api/src/modules/engine/`): the shape of a pipeline definition, how Plan validates and
versions it, and what the engine does with it. The engine's design is in
[`docs/helena-decisions/workflow-engine.md`](../helena-decisions/workflow-engine.md).

Plan owns the definition, its validation and its version history
(`apps/api/src/modules/pipelines/`). Step types and trigger types are registries
(`apps/api/src/modules/engine/registry.ts`); the built-in ones register in
`engine/builtin/` through the same API a plugin uses, and a plugin adds a type without
touching the engine. The engine never calls a model provider: every LLM call a workflow
needs is one Hermes makes, queued as a normal Plan agent run, the same way as the stages of
the agent team.

## Definition format

A pipeline definition is `{ schemaVersion: 1, trigger, roles, steps }`
(`apps/api/src/modules/pipelines/definition.ts`, `PipelineDefinition`). `schemaVersion` is
literal `1` today; a future breaking change to the shape adds `2` and a reader that
branches on it, rather than mutating what `1` means.

### Trigger

One of:

| Type | Fields | Fires |
|---|---|---|
| `manual` | — | Only when a member starts a run by hand or as a test run. |
| `task_created` | — | A task is created in the project. |
| `task_assigned` | — | A task is assigned. |
| `status_changed` | `to: string \| null` | A task's status changes, to the named status or to any status when `to` is null. |
| `label_added` | `label: string` | A label is added to a task. |
| `schedule` | `cron`, `timezone`, `title` | The engine fires the schedule; Plan creates a task with `title` and runs the workflow on it. |
| `webhook` | `title` | A request to the workflow's hook, `POST /hooks/workflows/:hookId`, signed per Standard Webhooks with the hook's secret (or carrying it as a bearer token). Plan creates a task with `title`, or the request's own `title` field, and runs the workflow on it. The same `webhook-id` starts one run only. |
| `mail_received` | `from`, `subject` | A new mail of the project's accounts matches both filters (an empty filter matches every mail). Plan creates a task with the mail's subject and runs the workflow on it. |

Two more trigger types belong to built-in workflows only and are not offered in the
builder: `delegation` (a task delegated to a coordinator starts the agent team) and
`routine` (a routine's schedule fires).

A workflow with a `schedule` trigger gets a row in `helena_schedule` for exactly as long as
a project has it enabled; disabling or deleting the workflow removes it. A schedule that
names no time zone uses the instance's (Administrator → Allgemein → Helena-Motor →
Zeitzone). The engine fires each scheduled time once, computed with croner. The team's
`minScheduleIntervalSeconds` limit applies to the cron the same way it applies to routines
(`assertCadence` in `service.ts`). A webhook trigger's hook and secret are managed at
`/projects/:projectKey/pipelines/:pipelineId/hook`.

### Roles

Up to 12 roles, each `{ key, name, match }`. `key` is the stable identifier agent steps and
project role mappings reference (`^[a-z][a-z0-9-]{0,31}$`); `name` is what the builder
shows. `match` says how a project that sets no agent for the role resolves one:
`coordinator` (the project's coordinator), `capability` (the first agent with that
capability), `template` (a specific agent — only in a project's own workflow, never in a
library template, which must stay portable across projects), or `none` (the role stays
unresolved until a project maps it). A project's own role mapping
(`project_pipeline.roles`, role key → agent id) always wins over `match` when set.

### Steps

An ordered tree, at most 50 steps in total and 3 levels of condition nesting deep
(`LIMITS.steps`, `LIMITS.depth`). Every step has `id` (`^[a-z0-9][a-z0-9-]{0,39}$`, unique
across the whole definition) and `name`. The builder offers seven kinds:

- **`agent`** — `assignee` (`{ role }` or `{ agentId }` — a template may only use `role`),
  `instruction` (may hold `{{...}}` variables, see below), optional `maxTurns` and
  `runBudgetSeconds` (bounded by the same limits as the agent's own runtime policy),
  optional `model` (checked against the team's allowed models), `timeoutMinutes`
  (5–1440).
- **`approval`** — `message` (template text), `onReject`: either `{ action: "end" }` or
  `{ action: "goto", stepId, maxLoops }`. The rework target must be a step that comes
  before the approval on the path a run actually took to reach it, so a rejection cannot
  jump into an unrelated branch; `maxLoops` (1–10) bounds how often that loop can send the
  run back before it is treated as failed.
- **`condition`** — `condition` (see below), `then`/`else` (each a nested step list),
  `thenEnd`/`elseEnd` (whether that lane ends the run instead of falling through to the
  step after the condition).
- **`action`** — `action`: `set_status`, `add_labels`/`remove_labels`, `set_assignee`
  (`{ role }` or `{ userId }` — again, only `role` in a template), `comment` (templated
  body), or `create_subtask` (templated title/description). Applied as the system actor
  `Workflow`, which starts no further workflow, so two workflows cannot trigger each other.
- **`wait`** — either `{ kind: "delay", minutes }` (1–43200) or
  `{ kind: "until", field: "dueDate" | "startDate", time }` (`HH:MM`, in the instance's
  time zone), which sleeps until that time of day on the named date field of the task. The
  wait is durable: a restart of the API does not shorten or lose it.
- **`notify`** — `to` (`{ kind: "assignee" }`, `{ kind: "watchers" }` or
  `{ kind: "members", userIds }`) and `message` (template text). Posts a comment on the task
  that mentions them, which reaches their inbox, email or Telegram like any mention.
- **`webhook`** — `url` and `message` (template text). Posts the run, its task, the results
  so far and the message to the URL, signed per Standard Webhooks with the project's
  signing secret (`/projects/:projectKey/workflow-signing-secret`). `webhook-id` is the same
  for every try of one execution, so the receiver can drop a repeat. A 2xx answer is
  `success`, anything else `failed`. The URL must be public: a private or local address is
  refused.

Two step types are the engine's own and are not offered in the builder: **`delegate`**
(a routine's work: create a task for an agent or reopen one) and **`agent_team`** (the
coordinator plans, specialists work, the coordinator reviews; created for a task delegated
to a coordinator).

`condition` is one of: `{ kind: "outcome", outcomes: [...] }` (matches the outcome —
`success`/`failed`/`blocked` — of the closest step before it that produces a result: an
agent, approval or action step; a `wait` or another `condition` is transparent to this),
`{ kind: "keyword", keyword }` (a case-insensitive match against that same previous
result's summary), or `{ kind: "task", field, op, values }` (`status`, `statusType`,
`labels`, `area` or `priority`, compared `is`/`is_not` against up to 20 values).

### Variables

`instruction`, `message`, `action.body`, `action.title` and `action.description` may
contain `{{task.<field>}}` (`title`, `description`, `identifier`, `status`),
`{{previous.<field>}}` (`summary`, `outcome`, `note` of the closest step before it that
produces a result), or `{{step.<id>.<field>}}` naming any earlier step on the path the run
took to reach this one. Plan renders these server-side before it ever hands a prompt to
Hermes (`render.ts`); the agent run gets the rendered text only.

## Validation

`validateDefinition` (`definition.ts`) is the single source of truth; both the client
editor and every server write path call it, so a definition cannot be saved in a shape the
executor would not understand. It never executes anything in the definition — it only
walks the JSON and checks shape, references and limits — and it always returns every
problem it finds rather than stopping at the first one, each tagged with a `code`, the
`stepId` it belongs to (or `null` for the trigger, roles or the step list as a whole) and
the `field`. Checks include: required fields and length limits, unique step ids and role
keys, an assignee or `set_assignee` role that names a defined role, a rework target that
lies on the approval's own path, every `{{...}}` variable resolving to a real field of the
task, a real earlier step, or a step that actually comes before the one using it, cron
syntax and time zone validity, and steps that no run can ever reach (both lanes of a
condition end the run, so nothing after it in that lane is reachable).

A second layer, `projectIssues` (`project-context.ts`), checks a definition against one
project: does every role resolve to an agent that actually works there, do named statuses,
labels and areas exist, is the model on a step one the project's agents are allowed to run,
does a schedule respect the team's minimum interval. This layer only applies once a
definition is attached to a project — a library template is checked structurally only,
since it must stay valid for any project that might adopt it later — and `enabling` a
workflow in a project is refused (HTTP 409) while it has any such issue.

The engine reads a definition through the same registries: each step type's `read` checks
its fields for `validateDefinition` and gives the interpreter the step it executes, so what
validates is what runs. A step whose type is not registered is a validation error, and a run
of it fails instead of guessing.

## No code execution

A pipeline definition is data, not a program: there is no expression language, no
scripting step and no field anywhere in the schema that is interpreted as code. Condition
tests and template variables are a fixed, enumerated set the reader resolves by lookup
(`readCondition`, `variablesIn` in `definition.ts`) — a `{{...}}` that does not match one of
the known patterns is a validation error, not a runtime evaluation. Task actions are a
closed set of operations Plan applies with its normal service calls (the same ones a
person's UI action goes through), never a shell command, HTTP call or arbitrary mutation
the definition gets to describe. `create_subtask`, `comment` and the templated agent
instruction are the only places free text from a definition reaches anywhere: subtask
title/description and comment body are stored as plain task content exactly like a
person's own text, and the instruction is the prompt text of a normal Hermes agent run —
it grants that run no more than any other delegation already grants the agent that runs it.

## Versioning

`pipeline` holds the row's current `version` number; `pipeline_version` holds one
immutable, append-only row per version, `(pipelineId, version)` unique
(`packages/db/src/schema/pipelines.ts`). Saving a pipeline only creates a new version when
the definition actually changed — compared by re-reading and re-serializing both sides,
since Postgres `jsonb` does not preserve key order — so editing just the name or
description does not bump the version or touch history. `updatePipeline` takes an optional
`baseVersion`; if it does not match the row's current version, the save is refused with
HTTP 409 `stale_version` instead of silently overwriting a version another editor already
moved past. Every version keeps its author and timestamp
(`GET /pipelines/:id/versions`, `GET /pipelines/:id/versions/:version`), so the builder's
version history and diff view read directly from this table.

A run pins the exact version it started with: `pipeline_run.versionId` is a foreign key
into `pipeline_version`, not into `pipeline`, and the engine interprets the definition of
that row (a built-in run carries its definition in `pipeline_run.definition`). A workflow
edited mid-run does not change runs already in flight; a schedule's next fire, and any run started after the edit, picks up the
row's current version at start time. There is no "publish" step separate from saving — a
saved change is live for the next run immediately — so a workflow that must not change
mid-rollout should be edited by creating a new template/workflow rather than in place, and
project role mappings and enablement issues (`projectIssues`) are what actually gates
whether a project's workflow can run at all.

## How the engine executes it

One DBOS workflow, `helena.run`, interprets every run: it walks the pinned definition and
executes each step through its registered type (`apps/api/src/modules/engine/workflows.ts`).
Every step execution is a sequence of recorded operations named
`helena:<step>#<iteration>:<operation>`, so a restart of the API continues inside the step
it was in, and nothing that finished runs twice. Each step writes its row in
`pipeline_run_step`, which the run history shows.

- An agent step queues a normal Plan agent run and waits for it by a signal when the run
  finishes; a long timeout is only the safety net. An approval step waits the same way for
  the decision (`POST /pipeline-runs/:runId/approval`).
- Cancel (`POST /pipeline-runs/:runId/cancel`) stops the workflow and cancels the agent run
  it waits for. Retry (`POST /pipeline-runs/:runId/retry`) forks the workflow at the first
  operation of the failed step: earlier steps keep their results and the failed step runs
  again.
- Starts are idempotent: a run's workflow ID is derived from the run, a trigger that fires
  twice for the same event starts one run, and a workflow that still works on a task starts
  no second run on it.
- A dry run (test run) simulates every step without waiting, sending or calling an agent.

The engine decides *which* step runs next by walking the definition; each step type decides
and performs *what* the step does, with Plan's normal service calls. Only Plan writes task
data, resolves an agent or queues work for Hermes.
