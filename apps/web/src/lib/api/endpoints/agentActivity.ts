import { request } from '@/lib/api/core/client';

export type AgentActivityKind = 'chat' | 'agent-run' | 'agent-team-run' | 'workflow-run';

// One entry of the agent timeline. The fields a kind does not have are null: a chat
// answer has no task and no token counts, a workflow run no agent.
export interface AgentActivityEntry {
  id: string;
  kind: AgentActivityKind;
  at: string;
  status: string;
  project: { id: number; key: string; name: string } | null;
  agent: { id: number; username: string; name: string } | null;
  issue: { id: number; identifier: string; sequenceNumber: number; title: string } | null;
  trigger: string | null;
  maxTurns: number | null;
  runBudgetSeconds: number | null;
  workflowId: string | null;
  workflowRunId: string | null;
  threadId: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  trashCounts?: { chat: number; vault: number };
}

export interface AgentActivityCursor {
  at: string;
  id: string;
}

export interface AgentActivityPage {
  items: AgentActivityEntry[];
  nextCursor: AgentActivityCursor | null;
}

export interface AgentActivityFilters {
  kind?: AgentActivityKind;
  agentId?: number;
  limit?: number;
}

export interface AgentUsage {
  since: string;
  inputTokens: number;
  outputTokens: number;
  closedTasks: number;
  tokensPerClosedTask: number | null;
}

function activityQuery(filters: AgentActivityFilters, cursor: AgentActivityCursor | null) {
  const q = new URLSearchParams();
  if (filters.kind) q.set('kind', filters.kind);
  if (filters.agentId) q.set('agentId', String(filters.agentId));
  if (filters.limit) q.set('limit', String(filters.limit));
  if (cursor) q.set('cursor', JSON.stringify(cursor));
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

// A project's timeline, or Home's across every project when projectKey is null.
export const listAgentActivity = (
  projectKey: string | null,
  filters: AgentActivityFilters,
  cursor: AgentActivityCursor | null,
) =>
  request<AgentActivityPage>(
    `${projectKey ? `/projects/${encodeURIComponent(projectKey)}` : ''}/agent-activity${activityQuery(filters, cursor)}`,
  );

export const getAgentUsage = (projectKey: string) =>
  request<AgentUsage>(`/projects/${encodeURIComponent(projectKey)}/agent-activity/usage`);
