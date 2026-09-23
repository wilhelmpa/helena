# Agent orchestration contract

Mastra owns workflow definitions, event triggers, schedules, retries, checkpoints and run history. Hermes owns agent sessions, memory, skills, tools and model execution. Plan owns projects, human-visible tasks, review decisions and the orchestration configuration shown in its UI.

`agent.team.requested` starts `agent-team` with a project-scoped envelope. The payload contains one exact Plan task reference, one coordinator, the allowed specialist pool, acceptance criteria and a bounded execution policy. Model and reasoning are optional provider-neutral strings. Tests that exercise a model must use Luna with low reasoning.

The workflow persists five stages in Mastra:

1. `prepare-team` validates scope, membership and policy.
2. `coordinate` asks Hermes for assignments limited to the registered specialist pool.
3. `specialize` executes assignments through Hermes. Independent assignments may run in parallel.
4. `review` asks the coordinator to evaluate the evidence against every acceptance criterion.
5. `synchronize-plan` writes the reviewed summary and evidence to the exact task and sets `Review` or `Done`.

The default execution lease is 300 seconds with a 60-second heartbeat. Plan must reject a
requested bound that its runner cannot honor before it queues paid agent work.

Every Hermes stage uses a SHA-256 idempotency key derived from event, correlation, phase and assignment. Retries reuse the key. The bridge must return its execution ID, attempt, timestamps and a bounded lease containing `claimedAt`, `heartbeatAt` and `expiresAt`. Mastra rejects stale or mismatched responses. Mastra step outputs are the durable checkpoints and its stored run is the canonical run history.

## Private Hermes bridge

Mastra connects only through `/run/volition-ipc/hermes-team.sock`. Authentication is read from `HERMES_TEAM_TOKEN_FILE`, which must be below `/run/secrets`. Neither the workflow input nor its stored output contains the token.

`POST /internal/hermes/team/stages` accepts:

```json
{
  "schemaVersion": 1,
  "phase": "coordinate | specialize | review",
  "idempotencyKey": "64 hexadecimal characters",
  "projectRef": "project:KEY",
  "task": {},
  "agent": {},
  "assignment": {},
  "specialistResults": [],
  "policy": {},
  "execution": {},
  "attempt": 1
}
```

It returns the `stageResultSchema` from `src/mastra/team-contracts.ts`. A repeated idempotency key must return the same logical execution and must not create another Hermes session or Plan mutation.

`POST /internal/hermes/team/synchronize` accepts the exact project and task references, target state, summary, evidence and idempotency key. It returns the same idempotency key and `synchronizedAt`. The bridge must reject cross-project task references.

Plan controls the workflow through the existing Mastra control API:

- `catalog` lists definitions and ownership.
- `start` starts a project-scoped workflow with an explicit event ID.
- `runs` and `run` expose stored status, checkpoints and history for one project.
- `retry` restarts only failed runs with the same run ID.
- `cancel` stops a non-terminal run.
- schedule operations create, update, pause, resume, run and delete Mastra schedules. `scheduleKey` is idempotent within one project and workflow; omission selects the `default` key.

Business schedules exist only in Mastra. Hermes cron is limited to Hermes-internal maintenance and must not start Plan workflows.
