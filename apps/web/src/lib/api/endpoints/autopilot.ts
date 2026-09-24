import { request } from '@/lib/api/core/client';
import { pageQuery, type Page, type PageParams } from '@/lib/api/core/paging';
import type { ActionCategory, ActionScope } from '@helena/sdk/web';

// Helena's Autopilot (mirrors apps/api modules/autopilot/model.ts): how independently the
// agents of a project act, their budgets, and the log of the policy engine's decisions.

// The action categories in rising risk and where an action lands (@helena/sdk, D-C1).
export { ACTION_CATEGORIES, type ActionCategory, type ActionScope } from '@helena/sdk/web';

export const AUTOPILOT_LEVELS = [0, 1, 2, 3] as const;
export type AutopilotLevel = (typeof AUTOPILOT_LEVELS)[number];

export type PolicyOutcome = 'allow' | 'needs-approval' | 'deny';
export type PolicyReason =
  | 'always-allowed'
  | 'level-allows'
  | 'approved'
  | 'level-requires-approval'
  | 'hard-block'
  | 'budget-exhausted'
  | 'policy';
export type LevelSource = 'project' | 'agent' | 'agent-raised' | 'default';

export interface LevelRule {
  category: ActionCategory;
  scope: ActionScope | null;
  outcome: PolicyOutcome;
  reason: PolicyReason;
}

export interface LevelRules {
  level: AutopilotLevel;
  key: string;
  rules: LevelRule[];
}

export const BUDGET_METRICS = ['tokens', 'cost', 'time'] as const;
export type BudgetMetric = (typeof BUDGET_METRICS)[number];
export const BUDGET_PERIODS = ['day', 'month'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export interface BudgetStatus {
  id: number;
  scope: 'agent' | 'project';
  agentId: number | null;
  projectId: number | null;
  metric: BudgetMetric;
  period: BudgetPeriod;
  // Tokens, euros or seconds.
  limit: number;
  used: number;
  remaining: number;
  ratio: number;
  periodStart: string;
  warned: boolean;
  reached: boolean;
  graceRuns: number;
  unpricedTokens: number;
}

export interface BudgetInput {
  metric: BudgetMetric;
  period: BudgetPeriod;
  limit: number | null;
}

export interface EffectiveLevel {
  level: AutopilotLevel;
  source: LevelSource;
}

export interface ProjectAutopilot {
  level: AutopilotLevel;
  levels: LevelRules[];
  budgets: BudgetStatus[];
  agents: {
    id: number;
    name: string;
    username: string;
    agentLevel: AutopilotLevel | null;
    raise: boolean;
    effective: EffectiveLevel;
    paused: boolean;
  }[];
}

export interface Usage {
  tokens: number;
  cost: number;
  unpricedTokens: number;
  seconds: number;
}

export interface AgentAutopilot {
  agentLevel: AutopilotLevel | null;
  raise: boolean;
  paused: boolean;
  pauseReason: string | null;
  projects: {
    id: number;
    key: string;
    name: string;
    projectLevel: AutopilotLevel;
    effective: EffectiveLevel;
    budgets: BudgetStatus[];
  }[];
  budgets: BudgetStatus[];
  usage: { today: Usage; month: Usage };
  levels: LevelRules[];
}

export interface PolicyDecisionEntry {
  id: number;
  agentId: number | null;
  agentName: string | null;
  runId: number | null;
  chatMessageId: number | null;
  adapter: string;
  tool: string | null;
  category: ActionCategory;
  scope: ActionScope | null;
  outcome: PolicyOutcome;
  level: AutopilotLevel;
  levelSource: LevelSource;
  reason: PolicyReason;
  summary: string | null;
  createdAt: string;
}

export const getProjectAutopilot = (projectKey: string) =>
  request<ProjectAutopilot>(`/projects/${projectKey}/autopilot`);

export const setProjectAutopilotLevel = (projectKey: string, level: AutopilotLevel) =>
  request<ProjectAutopilot>(`/projects/${projectKey}/autopilot`, {
    method: 'PUT',
    body: JSON.stringify({ level }),
  });

export const setProjectBudgets = (projectKey: string, budgets: BudgetInput[]) =>
  request<ProjectAutopilot>(`/projects/${projectKey}/autopilot/budgets`, {
    method: 'PUT',
    body: JSON.stringify({ budgets }),
  });

export const listPolicyDecisions = (
  projectKey: string,
  params: PageParams,
  outcome?: PolicyOutcome,
) => {
  return request<Page<PolicyDecisionEntry>>(
    `/projects/${projectKey}/autopilot/decisions${pageQuery(params, { outcome })}`,
  );
};

export const getAgentAutopilot = (teamId: number, agentId: number) =>
  request<AgentAutopilot>(`/teams/${teamId}/ai-agents/${agentId}/autopilot`);

export const setAgentAutopilotLevel = (
  teamId: number,
  agentId: number,
  input: { level: AutopilotLevel | null; raise?: boolean },
) =>
  request<AgentAutopilot>(`/teams/${teamId}/ai-agents/${agentId}/autopilot`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

export const setAgentBudgets = (teamId: number, agentId: number, budgets: BudgetInput[]) =>
  request<AgentAutopilot>(`/teams/${teamId}/ai-agents/${agentId}/autopilot/budgets`, {
    method: 'PUT',
    body: JSON.stringify({ budgets }),
  });

export type BudgetCardAction = 'raise' | 'once' | 'keep';

export const decideBudgetCard = (
  approvalId: number,
  input: { action: BudgetCardAction; limit?: number; note?: string },
) =>
  request<unknown>(`/approvals/${approvalId}/budget`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

// ---- model prices (Administrator → Modellpreise) ------------------------------------

export interface ModelPriceSettings {
  usdToEur: number;
  importedAt: string | null;
  importedFrom: 'snapshot' | 'models.dev' | null;
}

export interface ModelPrice {
  model: string;
  provider: string | null;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number | null;
  cacheWritePerMTok: number | null;
  currency: 'EUR';
  source: 'models.dev' | 'manual';
  estimate: true;
  updatedAt: string;
  usd: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | null;
}

export interface ModelPriceList {
  items: ModelPrice[];
  settings: ModelPriceSettings;
}

export interface ManualPriceInput {
  provider?: string | null;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number | null;
  cacheWritePerMTok?: number | null;
}

export const listModelPrices = () => request<ModelPriceList>('/model-prices');

export const setModelPrice = (model: string, input: ManualPriceInput) =>
  request<ModelPrice>(`/god/model-prices/${encodeURIComponent(model)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

export const resetModelPrice = (model: string) =>
  request<void>(`/god/model-prices/${encodeURIComponent(model)}`, { method: 'DELETE' });

export const importModelPrices = (from: 'models.dev' | 'snapshot') =>
  request<{ imported: number; keptManual: number; settings: ModelPriceSettings }>(
    '/god/model-prices/import',
    { method: 'POST', body: JSON.stringify({ from }) },
  );

export const setModelPriceRate = (usdToEur: number) =>
  request<ModelPriceSettings>('/god/model-prices/settings', {
    method: 'PUT',
    body: JSON.stringify({ usdToEur }),
  });
