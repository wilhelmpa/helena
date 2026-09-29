# Central runtime: merge and acceptance

The runtime remains disabled unless `HELENA_NATIVE_RUNTIME=on`. This branch contains backend,
runner and test changes only. The UI integration belongs to Claude's design-system branch.

## Migration

The Release 11 integration uses `0218_volition_runtime`; its SQL matches the incoming
`0208_helena_runtime`, with a snapshot generated from the Release 11 schema.
The destination keeps 0208 for `agent_run_archive`. Follow the migration clash rule
in `CLAUDE.md` if another destination has already occupied 0218:

1. Retain the destination's Drizzle journal and snapshots, including `agent_run_archive`.
2. Keep the incoming runtime table definitions in `packages/db/src/schema/helena-runtime.ts`
   and its schema export. Save the contents of the incoming runtime SQL outside the checkout,
   then remove that incoming SQL and its branch snapshot.
3. In `packages/db`, run the locally installed Drizzle generator with
   `./node_modules/.bin/drizzle-kit generate --name=volition_runtime`.
   Use the next number that the **merged destination journal** produces; do not reserve 0209.
4. Put the saved runtime SQL into the generated migration. Generate again and require
   `No schema changes`. Test migrations on a new private database before the merge gate.

No new tables are needed for nightly consolidation or chat handover. They use the existing
memory revisions, proposals, system jobs and chat messages.

## Backend behavior

- Engine job `helena.memory-consolidation` runs at 03:00 Europe/Berlin while the native
  runtime is enabled. It merges up to 200 previous daily notes into `MEMORY.md`, preserving
  existing text, deduplicating against memory and accessible facts, and withholding possible
  contradictions using the fact store's existing heuristic. Conflicts stay in the notes;
  this is not a semantic truth verdict. Content exceeding the memory limit stays in the notes.
- The agent's memory approval setting applies. Approvals create native database revisions;
  stale proposals fail with 409. Daily note writes are serialized, and consolidation checks
  its baseline before writing. Engine steps are recorded per agent.
- Chat escalation inserts an explicit handover and a queued assistant turn in the same
  conversation. The target must be an available Claude Code or Codex agent in the same team
  and, for a project chat, a member of that project; a Home handover requires all-project scope. Retries do not enqueue a second turn.
  Streaming, stopping and the target model work through the existing chat API.
- Central escalation rules originate from `hub/halogen-integration`, commit `0ead5b673`.
  Their pure normalizer and decision function are shared in `@helena/sdk`; the API module
  re-exports them. `/god/escalation` remains the sole rule editor. `snapshot.helena.escalation.central`
  carries the rules; the agent dialog contributes only its mode/target pin. Task pins precede
  agent pins and project pins. The global disabled switch wins.

## Targeted validation

`deployment/volition-stack/native/tests/runtime-isolation.test.sh` builds the runner bundle
and runs it with a private Linux network, PID and mount namespace using bubblewrap. It tests
process death and file-session resume, SIGINT, a deadline, a refused model port followed by a
working fixture provider, and denied writes when the policy API is unavailable. Neither the
live checkout nor the host home is mounted; no systemd unit or Halogen process is modified.

Run the native API integration suites on a private test Postgres, the loop/runner tests,
the coding and browser evals sequentially against Halogen, workspace typecheck/lint/Prettier,
and the complete Web lint. Keep the feature switch off until Claude finishes the UI and
its browser acceptance in light/dark and desktop/mobile views.

## UI work for Claude

Present central escalation rules and only agent pins in the shared settings components;
show consolidation outcomes and pending/stale revisions in the memory editor; verify the
handover, subsequent answer and cancellation in the existing chat. The backend stores the
handover as ordinary chat text, so no new visual component is introduced here.
