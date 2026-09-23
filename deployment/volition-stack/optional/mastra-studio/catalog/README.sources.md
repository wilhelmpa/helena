# Catalog provenance

`flows.json` is presentation metadata for the executable registry in
`src/mastra/registry.ts`. It is not a second workflow engine and contains no
production data.

The executable contracts and safety boundaries are defined in:

- `src/mastra/contracts.ts`: shared input, output, effect, suspend, and resume schemas
- `src/mastra/effects.ts`: deterministic effect IDs and idempotency keys
- `src/mastra/registry.ts`: bounded effect workflows and approval gates
- `src/mastra/team-workflow.ts`: project coordinator, specialist execution, review and Plan synchronization
- `src/mastra/team-contracts.ts`: project team, lease, evidence and history schemas
- `src/mastra/adapters/hermes-team.ts`: private Hermes execution and idempotent Plan synchronization adapter
- `src/mastra/triggers.ts`: event-to-workflow registry
- `src/mastra/adapters/planner.ts`: provider-neutral dry-run planning adapter
- `src/mastra/adapters/classifier.ts`: provider-neutral, capability-scoped classifier adapter

Keep the catalog IDs aligned with `workflowIds`; the automated tests enforce the
executable registry and trigger mappings.
