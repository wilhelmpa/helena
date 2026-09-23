import { request } from '@/lib/api/core/client';
import { pageQuery, type Page, type PageParams } from '@/lib/api/core/paging';

export type ApprovalKind = 'send' | 'publish' | 'pay' | 'delete' | 'other';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
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
  status: ApprovalStatus;
  decidedByUserId: string | null;
  decidedByName: string | null;
  note: string | null;
  decidedAt: string | null;
  followUpRunId: number | null;
  createdAt: string;
}

// A Mastra workflow run suspended at its approval gate.
export interface WorkflowGate {
  projectId: number;
  projectKey: string;
  projectName: string;
  workflowId: string;
  workflowName: string;
  runId: string;
  reason: string | null;
  summary: string | null;
  effects: string[];
  createdAt: string | null;
}

export interface WorkflowGateList {
  items: WorkflowGate[];
  // False when the workflows of at least one project could not be read.
  complete: boolean;
}

export interface ApprovalDecision {
  approved: boolean;
  note?: string;
}

export const listApprovals = (params: PageParams, status: ApprovalListStatus) =>
  request<Page<ApprovalRequest>>(`/approvals${pageQuery(params, { status })}`);

export const getPendingApprovalCount = () => request<{ count: number }>('/approvals/pending-count');

export const listWorkflowGates = () => request<WorkflowGateList>('/approvals/workflow-gates');

export const decideApproval = (id: number, decision: ApprovalDecision) =>
  request<ApprovalRequest>(`/approvals/${id}/decision`, {
    method: 'POST',
    body: JSON.stringify(decision),
  });
