# Volition Mastra control plane

## Fresh deployment

`MASTRA_FRESH_MODE=true` starts Studio with no registered workflows. It is an explicit reset mode. The deployment default registers the control-plane workflows. Stored runs are cleared separately during a fresh reset.

This project exposes three typed Mastra 1.67 workflows in Studio:

- `inbox-triage`
- `agent-team`
- `agent-routine`

Each workflow accepts the shared envelope in `src/mastra/contracts.ts`. With
`dryRun: true`, a run validates its input and calls neither Hermes nor Plan.
Recurring work is a routine (`agent-routine`) with an agent and instructions that
a member creates in Plan.

`inbox-triage` uses the provider-neutral `ClassifierAdapter` and capability
reference `inbox-triage.v1`. The adapter knows no provider, model, agent ID or
mail credential. It calls one authenticated private endpoint; the host-side
integration owns the current runtime implementation and validates the result.
The existing Plan worker remains the sole inbox and ticket writer.
`src/mastra/triggers.ts` maps supported event names to workflow IDs.

`agent-team` is the project-scoped agent orchestration workflow. Mastra owns its
trigger, retries, checkpoints, schedule and run history. Hermes executes the
coordinator and specialist stages through a private Unix-socket bridge. Plan
owns the exact task and receives the reviewed summary, evidence and final
`Review` or `Done` state. The complete request and response contract is in
`ORCHESTRATION_CONTRACT.md`.

`agent-routine` runs the routines of Plan's Schedules pages. Each fire asks Plan,
through the same bridge, to create a task delegated to an agent or to reopen the
routine's task, and is skipped while that task is open or when it starts more than
ten minutes late. Its contract is in `ORCHESTRATION_CONTRACT.md` as well.

## Private event ingress

`POST /internal/events` is an internal bearer-authenticated ingress for the
registered event names in `src/mastra/triggers.ts`. It accepts exactly:

```json
{
  "eventId": "stable-id",
  "eventType": "agent.team.requested",
  "organizationRef": "organization:volition",
  "projectRef": "project:PRIV",
  "actorRef": "service:plan-shadow",
  "capabilityRefs": ["hermes-team.v1", "plan-task-sync.v1"],
  "connectionRefs": [],
  "payload": { "projectKey": "PRIV" },
  "dryRun": true
}
```

`actorRef` is optional; all other fields are required. The HTTP body is limited
to 64 KiB and the payload to 48 KiB, with bounded nesting, collections, keys and
strings. Scope fields are forbidden inside `payload`; when `projectKey` is
present it must match `projectRef`. Unknown events and missing workflow
capabilities are rejected.

The ingress resolves `eventType` through the existing registry, uses `eventId`
as the Mastra run ID, and checks every registered workflow before starting.
An identical retry returns the existing run with `replayed: true`; reuse across
projects, event types or payloads returns `409`. Concurrent identical requests
share one start operation. The bearer is read by the front proxy from a mounted
secret (`INBOX_ADAPTER_TOKEN_FILE`) and is never forwarded into Mastra or the
workflow envelope. Without that variable the ingress is closed.

This endpoint is additive and shadow-safe. Existing inbox and Plan Action paths
continue unchanged until a separately verified migration.

## Verification

```sh
bun run test
bun run build
docker build -t volition/mastra-studio:control-plane-test .
```

The Mastra server accepts only the token `start.mjs` gives the front proxy. The
proxy serves Studio only with the gateway token Nginx adds for the instance owner,
limits workflow POST bodies to 128 KiB, and permits POST only for registered
workflow start/resume routes. Other mutation routes remain blocked. The trust model
is in `ORCHESTRATION_CONTRACT.md`.

Building this directory does not update the live Compose service. Deployment is
a separate operation.
