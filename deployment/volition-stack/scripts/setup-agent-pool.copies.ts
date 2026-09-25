// The owner's approved agent-pool decisions for this installation that more than one tool
// applies: setup-agent-pool.ops.ts (through the HTTP API) and the agent tuning
// (apps/api/src/scripts/agent-tuning.ts, through Helena's services). Plain data, no imports.

// copies: project copies that close the gaps of docs/volition-agent-pool-research.md C.
// VOL stands in for the company as a whole, which has no project of its own. A copy's handle
// is "<template>-<project key in lower case>" (copyTemplateIntoProject). VERVE has a whole team,
// one per area (owner, 2026-09-25: "Leg für Verve eine ganze Orga gemäß der Area-Bereiche an"):
// `area` is the folder of the project area the copy works in.
export const POOL_COPIES: readonly { template: string; projectKey: string; area?: string }[] = [
  { template: 'qa', projectKey: 'VOL' },
  { template: 'assistant', projectKey: 'FAM' },
  { template: 'assistant', projectKey: 'PRIV' },
  { template: 'finance', projectKey: 'PRIV' },
  { template: 'finance', projectKey: 'VOL' },
  { template: 'researcher', projectKey: 'VOL' },
  { template: 'shopify-dev', projectKey: 'VERVE', area: 'dev' },
  { template: 'qa', projectKey: 'VERVE', area: 'dev' },
  { template: 'devops', projectKey: 'VERVE', area: 'dev' },
  { template: 'code-reviewer', projectKey: 'VERVE', area: 'dev' },
  { template: 'content', projectKey: 'VERVE', area: 'marketing' },
  { template: 'market-analyst', projectKey: 'VERVE', area: 'marketing' },
  { template: 'designer', projectKey: 'VERVE', area: 'marketing' },
  { template: 'assistant', projectKey: 'VERVE', area: 'support' },
  { template: 'tech-writer', projectKey: 'VERVE', area: 'support' },
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
