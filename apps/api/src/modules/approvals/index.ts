import { Elysia } from 'elysia';
import { mcpTool } from '#mcp/generate';
import { isAgentUser } from '#modules/agents/core/service';
import { authContext } from '#shared/auth-context';
import {
  assertMcpEnabled,
  assertPermission,
  requireProjectAccess,
  requireUser,
} from '#shared/access';
import { assertMcpAllowed, requiresPermission } from '#shared/guards';
import { HttpError } from '#shared/lib';
import { isMcpRequest } from '#shared/mcp-request';
import { paginate } from '#shared/pagination';
import { commonErrors, errors } from '#shared/responses';
import {
  ApprovalPageResponse,
  ApprovalResponse,
  PendingCountResponse,
  WorkflowGateListResponse,
  approvalParams,
  createApprovalBody,
  decisionBody,
  listApprovalsQuery,
} from './model';
import {
  DECIDE_PERMISSION,
  countPendingApprovals,
  createApprovalRequest,
  decideApprovalRequest,
  getApproval,
  getApprovalAccess,
  getCallingAgent,
  listApprovals,
} from './service';
import { listWorkflowGates } from './workflow-gates';

// Agents ask here before they act outside Plan; the people who may decide answer from
// one inbox that also holds the Mastra workflow runs waiting at an approval gate.
export const approvalRoutes = new Elysia({
  name: 'approvals',
  detail: { tags: ['Approvals'] },
})
  .use(authContext)
  .macro({
    // The agent calling a :projectKey route, which must be one of the project's team.
    requestingAgent(_enabled: boolean) {
      return {
        async resolve({ params, user, request }) {
          const project = await requireProjectAccess(
            (params as { projectKey: string }).projectKey,
            user,
          );
          assertMcpEnabled(project, isMcpRequest(request.headers));
          const agent = await getCallingAgent(requireUser(user).id, project.teamId);
          if (!agent) throw new HttpError(403, 'Only an agent can request an approval');
          return { project, agent };
        },
      };
    },
    // One request by id: the agent that made it reads it, a person who may decide reads
    // and decides it. An agent never decides, whatever its role grants: the request
    // exists so that a person does.
    approval(action: 'read' | 'decide') {
      return {
        async resolve({ params, user, request }) {
          const approvalId = Number((params as { approvalId: string }).approvalId);
          const access = await getApprovalAccess(approvalId);
          if (!access) throw new HttpError(404, 'Approval request not found');
          const callerId = requireUser(user).id;
          if (action === 'decide' || access.agentUserId !== callerId)
            await assertPermission(access.projectId, user, ...DECIDE_PERMISSION);
          if (action === 'decide' && (await isAgentUser(callerId)))
            throw new HttpError(403, 'Only a person can decide an approval request');
          await assertMcpAllowed(access.projectId, request.headers);
          return { approvalId };
        },
      };
    },
  })
  .post(
    '/projects/:projectKey/approvals',
    async ({ project, agent, body, set }) => {
      const { approval, created } = await createApprovalRequest({
        projectId: project.id,
        agent,
        ...body,
      });
      set.status = created ? 201 : 200;
      return approval;
    },
    {
      requestingAgent: true,
      body: createApprovalBody,
      response: { 200: ApprovalResponse, 201: ApprovalResponse, ...commonErrors },
      detail: {
        summary: 'Request an approval',
        description:
          'Ask a person to approve an action outside Plan before you take it: sending a ' +
          'message or email, publishing, paying, or deleting something. Describe the action ' +
          'in one line and give every detail the person needs to decide. Then end your run ' +
          'without taking the action: Plan starts a new run of yours with the decision and ' +
          'its note once the request is approved or rejected. Returns the request with its ' +
          'id and status; asking again for the same action in the same run returns the ' +
          'existing request.',
        ...mcpTool('request_approval'),
      },
    },
  )
  .get('/approvals/:approvalId', async ({ approvalId }) => (await getApproval(approvalId))!, {
    approval: 'read',
    params: approvalParams,
    response: { 200: ApprovalResponse, ...commonErrors },
    detail: {
      summary: 'Get an approval request',
      description:
        'Read one approval request: its status (pending, approved, rejected), who decided ' +
        'it and the note they left.',
      ...mcpTool('get_approval'),
    },
  })
  .post(
    '/approvals/:approvalId/decision',
    ({ approvalId, body, user }) => decideApprovalRequest(approvalId, requireUser(user).id, body),
    {
      approval: 'decide',
      params: approvalParams,
      body: decisionBody,
      response: { 200: ApprovalResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Decide an approval request',
        description:
          'Approve or reject a pending request, with an optional note. Queues a run of the ' +
          'agent that carries the decision and the note.',
        ...requiresPermission(DECIDE_PERMISSION),
      },
    },
  )
  .get(
    '/approvals',
    ({ query, user }) =>
      paginate(query, (window) =>
        listApprovals(requireUser(user).id, query.status ?? 'pending', window),
      ),
    {
      query: listApprovalsQuery,
      response: { 200: ApprovalPageResponse, ...errors(400, 401) },
      detail: {
        summary: 'List approval requests',
        description:
          'The approval requests of every project in which the caller may decide them, newest first.',
      },
    },
  )
  .get(
    '/approvals/pending-count',
    async ({ user }) => ({ count: await countPendingApprovals(requireUser(user).id) }),
    {
      response: { 200: PendingCountResponse, ...errors(401) },
      detail: {
        summary: 'Count pending approval requests',
        description:
          'How many requests wait for a decision in the projects in which the caller may decide them.',
      },
    },
  )
  .get('/approvals/workflow-gates', ({ user }) => listWorkflowGates(requireUser(user).id), {
    response: { 200: WorkflowGateListResponse, ...errors(401) },
    detail: {
      summary: 'List workflow approval gates',
      description:
        'The Mastra workflow runs suspended at their approval gate, in every project in ' +
        'which the caller may decide them. `complete` is false when the workflows of a ' +
        'project could not be read.',
    },
  });
