# Catalog provenance

`flows.json` is presentation metadata for the executable registry in
`src/mastra/registry.ts`. It is not a second workflow engine and contains no
production data.

The executable contracts and safety boundaries are defined in:

- `src/mastra/contracts.ts`: shared input, output, effect, suspend, and resume schemas
- `src/mastra/effects.ts`: deterministic effect IDs and idempotency keys
- `src/mastra/registry.ts`: six workflow definitions and approval gates
- `src/mastra/triggers.ts`: event-to-workflow registry
- `src/mastra/adapters/planner.ts`: provider-neutral dry-run planning adapter
- `src/mastra/adapters/classifier.ts`: provider-neutral, capability-scoped classifier adapter

Keep the catalog IDs aligned with `workflowIds`; the automated tests enforce the
executable registry and trigger mappings.
