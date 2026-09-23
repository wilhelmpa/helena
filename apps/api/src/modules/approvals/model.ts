import { t } from 'elysia';
import { pageQueryFields, pageResponse } from '#shared/pagination';

export const ApprovalKind = t.Union(
  [
    t.Literal('send'),
    t.Literal('publish'),
    t.Literal('pay'),
    t.Literal('delete'),
    t.Literal('other'),
  ],
  { description: 'What kind of outward action it is.' },
);

export const ApprovalStatus = t.Union([
  t.Literal('pending'),
  t.Literal('approved'),
  t.Literal('rejected'),
]);

export const ApprovalResponse = t.Object({
  id: t.Number(),
  projectId: t.Number(),
  projectKey: t.String(),
  projectName: t.String(),
  agentId: t.Number(),
  agentName: t.String(),
  agentUsername: t.String(),
  runId: t.Nullable(t.Number()),
  issueId: t.Nullable(t.Number()),
  issueSequenceNumber: t.Nullable(t.Number()),
  issueIdentifier: t.Nullable(t.String()),
  issueTitle: t.Nullable(t.String()),
  kind: ApprovalKind,
  action: t.String(),
  details: t.String(),
  status: ApprovalStatus,
  decidedByUserId: t.Nullable(t.String()),
  decidedByName: t.Nullable(t.String()),
  note: t.Nullable(t.String()),
  decidedAt: t.Nullable(t.String()),
  // The run the decision queued for the agent.
  followUpRunId: t.Nullable(t.Number()),
  createdAt: t.String(),
});

export const ApprovalPageResponse = pageResponse(ApprovalResponse);

export const PendingCountResponse = t.Object({ count: t.Number() });

// A Mastra workflow run suspended at its approval gate.
export const WorkflowGateResponse = t.Object({
  projectId: t.Number(),
  projectKey: t.String(),
  projectName: t.String(),
  workflowId: t.String(),
  workflowName: t.String(),
  runId: t.String(),
  reason: t.Nullable(t.String()),
  summary: t.Nullable(t.String()),
  // The descriptions of the effects the approval releases.
  effects: t.Array(t.String()),
  createdAt: t.Nullable(t.String()),
});

export const WorkflowGateListResponse = t.Object({
  items: t.Array(WorkflowGateResponse),
  // False when the workflows of at least one project could not be read.
  complete: t.Boolean(),
});

export const approvalParams = t.Object({
  approvalId: t.Numeric({ description: 'Approval request id from request_approval.' }),
});

export const createApprovalBody = t.Object({
  kind: ApprovalKind,
  action: t.String({
    minLength: 1,
    maxLength: 300,
    description: 'The action in one line, e.g. "Send the offer email to jane@example.com".',
  }),
  details: t.Optional(
    t.String({
      maxLength: 8000,
      description:
        'Everything the person needs to decide: recipients, the full text, amounts, what gets deleted.',
    }),
  ),
  issueId: t.Optional(
    t.Integer({
      description: 'The issue the action belongs to. Defaults to the issue of the current run.',
    }),
  ),
});

export const decisionBody = t.Object({
  approved: t.Boolean(),
  note: t.Optional(t.String({ maxLength: 2000 })),
});

export const listApprovalsQuery = t.Object({
  status: t.Optional(
    t.Union([t.Literal('pending'), t.Literal('decided')], {
      description: 'pending (default) or decided.',
    }),
  ),
  ...pageQueryFields,
});
