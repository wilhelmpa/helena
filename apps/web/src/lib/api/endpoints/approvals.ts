import { request } from '@/lib/api/core/client';
import { pageQuery, type Page, type PageParams } from '@/lib/api/core/paging';

export type ApprovalKind =
  'send' | 'publish' | 'pay' | 'delete' | 'write' | 'execute' | 'credentials' | 'budget' | 'other';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface BudgetCardPayload {
  budgetId?: number;
  scope?: 'agent' | 'project';
  metric?: 'tokens' | 'cost' | 'time';
  period?: 'day' | 'month';
  limit?: number;
  used?: number;
  agentId?: number | null;
  projectId?: number | null;
}
export type ApprovalListStatus = 'pending' | 'decided';

export interface ApprovalRequest {
  id: number;
  projectId: number;
  projectKey: string;
  projectName: string;
  agentId: number;
  agentName: string;
  agentUsername: string;
  runId: number | null;
  issueId: number | null;
  issueSequenceNumber: number | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  kind: ApprovalKind;
  action: string;
  details: string;
  // The exact command the agent may run once the request is approved.
  command: string | null;
  // What Helena's policy engine said about the action: its category, the Autopilot level
  // that applied and why a person decides (autopilot.reason.<code>).
  category?: string | null;
  scope?: 'workspace' | 'external' | null;
  autopilotLevel?: number | null;
  policyReason?: string | null;
  // A budget card's budget ('budget' kind): metric, period, limit, use.
  payload?: BudgetCardPayload | null;
  status: ApprovalStatus;
  decidedByUserId: string | null;
  decidedByName: string | null;
  note: string | null;
  decidedAt: string | null;
  followUpRunId: number | null;
  createdAt: string;
}

export interface ApprovalDecision {
  approved: boolean;
  note?: string;
}

export interface ApprovalProject {
  id: number;
  key: string;
  name: string;
}

export const listApprovals = (
  params: PageParams,
  status: ApprovalListStatus,
  projectKey?: string,
) => request<Page<ApprovalRequest>>(`/approvals${pageQuery(params, { status, projectKey })}`);

export const getPendingApprovalCount = (projectKey?: string) =>
  request<{ count: number }>(
    `/approvals/pending-count${projectKey ? `?projectKey=${encodeURIComponent(projectKey)}` : ''}`,
  );

// The projects the caller may decide approvals in, behind the global page's project
// filter and the per-project nav badge.
export const listApprovalProjects = () => request<ApprovalProject[]>('/approvals/projects');

// One approval request by id — what the chat's approval card reads to show its
// current status and, once it is decided, who decided it.
export const getApproval = (id: number) => request<ApprovalRequest>(`/approvals/${id}`);

export const decideApproval = (id: number, decision: ApprovalDecision) =>
  request<ApprovalRequest>(`/approvals/${id}/decision`, {
    method: 'POST',
    body: JSON.stringify(decision),
  });
