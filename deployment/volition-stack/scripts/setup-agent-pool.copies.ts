// The owner's approved agent-pool decisions for this installation that more than one tool
// applies: setup-agent-pool.ops.ts (through the HTTP API) and the agent tuning
// (apps/api/src/scripts/agent-tuning.ts, through Helena's services). Plain data, no imports.

// copies: project copies that close the gaps of docs/volition-agent-pool-research.md C.
// VOL stands in for the company as a whole, which has no project of its own. A copy's handle
// is "<template>-<project key in lower case>" (copyTemplateIntoProject).
export const POOL_COPIES: readonly { template: string; projectKey: string }[] = [
  { template: 'content', projectKey: 'VERVE' },
  { template: 'qa', projectKey: 'VOL' },
  { template: 'qa', projectKey: 'VERVE' },
  { template: 'assistant', projectKey: 'FAM' },
  { template: 'assistant', projectKey: 'PRIV' },
  { template: 'finance', projectKey: 'PRIV' },
  { template: 'finance', projectKey: 'VOL' },
  { template: 'researcher', projectKey: 'VOL' },
];

// org: what every project coordinator should have.
export const POOL_COORDINATOR_SKILLS: readonly string[] = [
  'brainstorming',
  'dispatching-parallel-agents',
  'writing-plans',
  'receiving-code-review',
  'requesting-code-review',
  'verification-before-completion',
];
