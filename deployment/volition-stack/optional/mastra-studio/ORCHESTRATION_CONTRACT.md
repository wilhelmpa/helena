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
| `maxAttempts`, `initialBackoffMs`, `maxBackoffMs`, `backoffMultiplier` | 3, 1000, 30000, 2 | Retries of one bridge request with the same idempotency key. |
| `leaseSeconds`, `heartbeatSeconds` | 300, 60 | Bounds of the execution lease Hermes reports. Plan rejects bounds its runner cannot honor before it queues paid agent work. |
| `timeoutSeconds` | 900 | How long the bridge waits for one stage, queue time included (30–7200). With `runBudgetSeconds` set, Mastra raises it to at least the budget plus 300 seconds, up to 7200. |
| `reviewRequired` | true | Whether the coordinator reviews the specialist results. |
| `autonomy` | `review` | `review` always leaves the task in Review. `done` moves it to Done when the coordinator review accepted the work. |
| `maxTurns` | unset | Hermes `--max-turns` of every stage (1–200). |
| `runBudgetSeconds` | unset | Hermes `--run-budget` of every stage (60–7200). |

Model and reasoning in `execution` are optional provider-neutral strings; Plan rejects a stage whose values differ from the agent's configuration. Tests that exercise a model must use Luna with low reasoning.

## Stages

The workflow persists five stages in Mastra:

1. `prepare-team` validates scope, membership and policy.
2. `coordinate` routes the task. With one specialist, or when the task labels match the capabilities of exactly one specialist (case-insensitive), Mastra builds one delegation for that specialist without a coordinator stage and records a `route` entry in the stage history. Otherwise it asks the coordinator for assignments limited to the specialist pool. An assignment may list in `dependsOn` the assignment IDs that must finish first; Mastra rejects duplicate IDs, unknown dependencies and cycles.
3. `specialize` executes the assignments in dependency order. Assignments whose dependencies have finished run in parallel. A dependent assignment receives the summary and evidence of each assignment it depends on.
4. `review` asks the coordinator to evaluate the evidence against every acceptance criterion. It is skipped when `reviewRequired` is false.
5. `synchronize-plan` writes the summary and evidence to the exact task and sets Review, or Done under autonomy `done` with an accepted review. Without a review the summary is the specialist summaries.

Every Hermes stage uses a SHA-256 idempotency key derived from event, correlation, phase and assignment. Retries reuse the key. The bridge must return its execution ID, attempt, timestamps and a bounded lease containing `claimedAt`, `heartbeatAt` and `expiresAt`. Mastra rejects stale or mismatched responses. Mastra step outputs are the durable checkpoints and its stored run is the canonical run history.

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

`POST /internal/hermes/team/synchronize` accepts the exact project and task references, target state, summary, evidence and idempotency key. It returns the same idempotency key and `synchronizedAt`. The bridge must reject cross-project task references.

## Plan control

Plan controls the workflow through the Mastra control API:

- `catalog` lists definitions and ownership.
- `start` starts a project-scoped workflow with an explicit event ID.
- `runs` and `run` expose stored status, checkpoints and history for one project.
- `retry` restarts only failed runs with the same run ID.
- `cancel` stops a non-terminal run.
- schedule operations create, update, pause, resume, run and delete Mastra schedules. `scheduleKey` is idempotent within one project and workflow; omission selects the `default` key.

Business schedules exist only in Mastra. Hermes cron is limited to Hermes-internal maintenance and must not start Plan workflows.
