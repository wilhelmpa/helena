import { request } from '@/lib/api/core/client';
import type { LocalizedLabel } from '@/lib/api/endpoints/browserTask';

// Typed decisions (apps/api/src/modules/decisions, docs/helena-decisions/decisions.md): the
// classes' settings and evals, the decision log, and the model router's switches.

export interface DecisionEval {
  id: number;
  classId: string;
  credentialId: number | null;
  backendLabel: string;
  model: string | null;
  threshold: number;
  questions: number;
  answered: number;
  correct: number;
  correctAnswered: number;
  precision: number | null;
  coverage: number | null;
  accuracy: number | null;
  passed: boolean;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  inputTokens: number;
  costEur: number | null;
  failures: {
    case: string;
    question: string;
    expected: string[];
    got: string | null;
    confidence: number | null;
  }[];
  details: {
    sweep?: { threshold: number; precision: number | null; coverage: number }[];
    byQuestion?: Record<
      string,
      { questions: number; answered: number; correct: number; correctAnswered: number }
    >;
    minPrecision?: number;
    minCoverage?: number;
  };
  error: string | null;
  status: 'running' | 'done' | 'failed' | 'stale';
  createdAt: string;
  finishedAt: string | null;
}

export interface DecisionClassView {
  id: string;
  label: LocalizedLabel;
  description: LocalizedLabel | null;
  input: { store: 'never' | 'optional'; cloud: 'allowed' | 'never' };
  defaults: { threshold: number; timeoutMs: number };
  eval: { cases: number; minPrecision: number; minCoverage: number } | null;
  setting: {
    enabled: boolean;
    credentialId: number | null;
    fallbackCredentialId: number | null;
    threshold: number;
    thresholdCustom: number | null;
    timeoutMs: number;
    timeoutCustom: number | null;
    storeInput: boolean;
    config: Record<string, unknown>;
  };
  latestEval: DecisionEval | null;
  canEnable: { ok: boolean; reason: string | null };
  stats: {
    total: number;
    decided: number;
    unsure: number;
    failed: number;
    corrected: number;
    wrong: number;
    latencyP50Ms: number | null;
    costEur: number;
  };
}

export interface DecisionConnectionOption {
  id: number;
  label: string;
  provider: string;
  model: string;
  local: boolean;
  projectKey: string | null;
  status: string | null;
}

export interface DecisionClassPatch {
  enabled?: boolean;
  credentialId?: number | null;
  fallbackCredentialId?: number | null;
  threshold?: number | null;
  timeoutMs?: number | null;
  storeInput?: boolean;
  config?: Record<string, unknown>;
}

export const listDecisionClasses = (teamId: number) =>
  request<{ classes: DecisionClassView[]; connections: DecisionConnectionOption[] }>(
    `/teams/${teamId}/decisions/classes`,
  );

export const updateDecisionClass = (teamId: number, classId: string, patch: DecisionClassPatch) =>
  request<DecisionClassView>(`/teams/${teamId}/decisions/classes/${encodeURIComponent(classId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const startDecisionEval = (
  teamId: number,
  classId: string,
  input: { credentialId?: number | null; threshold?: number | null } = {},
) =>
  request<DecisionEval>(`/teams/${teamId}/decisions/classes/${encodeURIComponent(classId)}/evals`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const listDecisionEvals = (teamId: number, classId?: string) =>
  request<{ evals: DecisionEval[] }>(
    `/teams/${teamId}/decisions/evals${classId ? `?classId=${encodeURIComponent(classId)}` : ''}`,
  );

export const cancelDecisionEval = (teamId: number, evalId: number) =>
  request<void>(`/teams/${teamId}/decisions/evals/${evalId}`, { method: 'DELETE' });

export interface DecisionLogEntry {
  id: number;
  classId: string;
  subject: string | null;
  questionId: string;
  kind: string;
  options: string[];
  choice: string | null;
  probabilities: Record<string, number> | null;
  confidence: number | null;
  threshold: number;
  status: string;
  backend: string | null;
  model: string | null;
  latencyMs: number | null;
  inputTokens: number;
  costEur: number | null;
  error: string | null;
  inputText: string | null;
  outcome: string | null;
  outcomeSource: string | null;
  projectKey: string | null;
  agentId: number | null;
  createdAt: string;
}

export const listDecisionLog = (
  teamId: number,
  query: { classId?: string; status?: string; before?: number; limit?: number } = {},
) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== '') params.set(key, String(value));
  const qs = params.toString();
  return request<{ items: DecisionLogEntry[]; nextBefore: number | null }>(
    `/teams/${teamId}/decisions/log${qs ? `?${qs}` : ''}`,
  );
};

export const correctDecision = (teamId: number, decisionId: number, outcome: string) =>
  request<void>(`/teams/${teamId}/decisions/log/${decisionId}/outcome`, {
    method: 'POST',
    body: JSON.stringify({ outcome }),
  });

export interface ModelRoute {
  fromModel: string;
  toModel: string;
  routed: boolean;
  tier: string | null;
  confidence: number | null;
  needsContext: number | null;
  reason: string;
}

export interface RouterOverview {
  agents: {
    id: number;
    name: string;
    model: string | null;
    enabled: boolean;
    allowUpgrade: boolean;
  }[];
  projects: { id: number; key: string; name: string; enabled: boolean }[];
  recent: (ModelRoute & {
    id: number;
    agentId: number;
    runId: number | null;
    chatMessageId: number | null;
    createdAt: string;
  })[];
}

export const getRouterOverview = (teamId: number) =>
  request<RouterOverview>(`/teams/${teamId}/model-router`);

export const setAgentRouter = (
  teamId: number,
  agentId: number,
  body: { enabled?: boolean; allowUpgrade?: boolean },
) =>
  request<{ enabled: boolean; allowUpgrade: boolean }>(
    `/teams/${teamId}/model-router/agents/${agentId}`,
    { method: 'PUT', body: JSON.stringify(body) },
  );

export const setProjectRouter = (teamId: number, projectId: number, enabled: boolean) =>
  request<{ enabled: boolean }>(`/teams/${teamId}/model-router/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
