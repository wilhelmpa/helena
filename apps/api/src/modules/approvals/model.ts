import { t } from 'elysia';
import { pageQueryFields, pageResponse } from '#shared/pagination';

// The kinds an agent asks for: the action categories a person decides on (Helena's Autopilot,
// docs/helena-decisions/policy-engine.md), and 'other' for anything else.
export const RequestKind = t.Union(
  [
    t.Literal('send'),
    t.Literal('publish'),
    t.Literal('pay'),
    t.Literal('delete'),
    t.Literal('write'),
    t.Literal('execute'),
    t.Literal('credentials'),
    t.Literal('other'),
  ],
  {
    description:
      'What kind of action it is: send (mail, messages, anything outside Helena), publish ' +
      '(push, deploy, release), pay, delete, write (a change the Autopilot level holds back), ' +
      'execute (a risky command or code), credentials (keys, tokens, grants) or other.',
  },
);

// A request is one of those, or 'budget': the card Helena files for the owner when a budget
// is used up.
export const ApprovalKind = t.Union([...RequestKind.anyOf, t.Literal('budget')]);

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
  command: t.Nullable(t.String()),
  // The policy engine's view: the action category, the Autopilot level that applied and why
  // a person decides (a reason code the app translates: level-requires-approval,
  // hard-block, budget-exhausted, policy, level-allows).
  category: t.Nullable(t.String()),
  autopilotLevel: t.Nullable(t.Number()),
  policyReason: t.Nullable(t.String()),
  // A budget card's budget: its metric, period, limit and use.
  payload: t.Nullable(t.Record(t.String(), t.Unknown())),
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
  kind: RequestKind,
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
  command: t.Optional(
    t.String({
      minLength: 1,
      maxLength: 32000,
      description:
        'The exact command or code a blocked terminal or execute_code call was about to run. ' +
        'Once approved, the run with the decision may run exactly this.',
    }),
  ),
  issueId: t.Optional(
    t.Integer({
      description: 'The issue the action belongs to. Defaults to the issue of the current run.',
    }),
  ),
});

export const approvedCommandsParams = t.Object({ runId: t.Numeric() });

export const ApprovedCommandsResponse = t.Array(t.String());

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
  projectKey: t.Optional(
    t.String({ description: 'Narrow the list to one project the caller may decide in.' }),
  ),
  ...pageQueryFields,
});

export const pendingCountQuery = t.Object({
  projectKey: t.Optional(t.String({ description: 'Count only the requests of this project.' })),
});

export const ApprovalProjectResponse = t.Array(
  t.Object({
    id: t.Number(),
    key: t.String(),
    name: t.String(),
  }),
);
