import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { requireUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { paginate } from '#shared/pagination';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { isAgentUser } from '#modules/agents/core/service';
import { runnerAuth } from '#modules/agents/runner-auth';
import { getApproval } from '#modules/approvals/service';
import { approvalGuards } from '#modules/approvals/guards';
import { ApprovalResponse, approvalParams } from '#modules/approvals/model';
import type { AutopilotLevel } from '@helena/policy';
import { onTemplateRelevantChange } from '#modules/agents/core/template-sync';
import { setBudgets } from './budgets';
import { setAgentLevel, setProjectLevel } from './levels';
import {
  AgentAutopilotResponse,
  agentAutopilotParams,
  DecideResponse,
  DecisionPageResponse,
  ProjectAutopilotResponse,
  budgetDecisionBody,
  budgetsBody,
  decideBody,
  decisionsQuery,
  setAgentLevelBody,
  setLevelBody,
} from './model';
import {
  agentAutopilot,
  decideBudgetCard,
  decideForRuntime,
  listDecisions,
  projectAutopilot,
} from './service';

async function refuseAgentKey(userId: string): Promise<void> {
  if (await isAgentUser(userId)) throw new HttpError(403, 'An agent cannot change the Autopilot');
}

// Helena's Autopilot: how independently the agents of a project act, their budgets, the log
// of the policy engine's decisions, and the engine itself for the runtimes that ask it.
export const autopilotRoutes = new Elysia({ name: 'autopilot', detail: { tags: ['Autopilot'] } })
  .use(authContext)
  .use(guards)
  .use(approvalGuards)
  .use(runnerAuth)
  .get('/projects/:projectKey/autopilot', ({ project }) => projectAutopilot(project.id), {
    permission: ['ai_agents', 'read'],
    response: { 200: ProjectAutopilotResponse, ...accessErrors },
    detail: {
      summary: "Get the project's Autopilot",
      description:
        "The project's Autopilot level, what each level allows, the project's budgets with " +
        'what is used of them, and the level each of its agents works at.',
    },
  })
  .put(
    '/projects/:projectKey/autopilot',
    async ({ project, user, body }) => {
      await setProjectLevel(project.id, body.level as AutopilotLevel, requireUser(user).id);
      return projectAutopilot(project.id);
    },
    {
      permission: ['ai_agents', 'edit'],
      body: setLevelBody,
      response: { 200: ProjectAutopilotResponse, ...commonErrors },
      detail: {
        summary: "Set the project's Autopilot level",
        description:
          '0 the agents only propose, 1 consequential actions need approval, 2 they act and ' +
          'report, 3 autonomous within the budget. Agent keys are refused.',
      },
    },
  )
  .put(
    '/projects/:projectKey/autopilot/budgets',
    async ({ project, user, body }) => {
      const userId = requireUser(user).id;
      await refuseAgentKey(userId);
      await setBudgets(project.teamId, { projectId: project.id }, body.budgets, userId);
      return projectAutopilot(project.id);
    },
    {
      permission: ['ai_agents', 'edit'],
      body: budgetsBody,
      response: { 200: ProjectAutopilotResponse, ...commonErrors },
      detail: {
        summary: "Set the project's budgets",
        description:
          'Tokens, euros (estimated from the model prices) or seconds of work per UTC day or ' +
          'month for all agent work in the project. A null limit removes that budget; budgets ' +
          'not named stay. Agent keys are refused.',
      },
    },
  )
  .get(
    '/projects/:projectKey/autopilot/decisions',
    ({ project, query }) =>
      paginate(query, (window) => listDecisions(project.id, window, query.outcome)),
    {
      permission: ['ai_agents', 'read'],
      query: decisionsQuery,
      response: { 200: DecisionPageResponse, ...accessErrors },
      detail: {
        summary: "List the policy engine's decisions in the project",
        description:
          'Newest first: every action of an agent in the project that the engine decided on, ' +
          'except plain reads, with its category, the level that applied and why.',
      },
    },
  )
  .get(
    '/teams/:teamId/ai-agents/:agentId/autopilot',
    ({ membership, params }) => agentAutopilot(membership.teamId, params.agentId),
    {
      teamPermission: ['ai_agents', 'read'],
      params: agentAutopilotParams,
      response: { 200: AgentAutopilotResponse, ...accessErrors },
      detail: {
        summary: "Get an agent's Autopilot",
        description:
          "The agent's own level, the level it works at in each of its projects and where that " +
          "comes from, its budgets and its projects' budgets with what is left, and what it " +
          'used today and this month.',
      },
    },
  )
  .put(
    '/teams/:teamId/ai-agents/:agentId/autopilot',
    async ({ membership, params, body, user }) => {
      const agentId = params.agentId;
      const changed = await setAgentLevel(
        membership.teamId,
        agentId,
        { level: (body.level ?? null) as AutopilotLevel | null, raise: body.raise ?? false },
        { id: requireUser(user).id, isTeamOwner: membership.role === 'owner' },
      );
      if (!changed) throw new HttpError(404, 'Agent not found');
      return agentAutopilot(membership.teamId, agentId);
    },
    {
      teamPermission: ['ai_agents', 'edit'],
      params: agentAutopilotParams,
      body: setAgentLevelBody,
      response: { 200: AgentAutopilotResponse, ...commonErrors },
      detail: {
        summary: "Set an agent's own Autopilot level",
        description:
          'Null follows the project. The stricter of the agent level and the project level ' +
          "applies, unless raise is set, which only the team's owner may do. Agent keys are " +
          'refused.',
      },
    },
  )
  .put(
    '/teams/:teamId/ai-agents/:agentId/autopilot/budgets',
    async ({ membership, params, body, user }) => {
      const userId = requireUser(user).id;
      await refuseAgentKey(userId);
      const agentId = params.agentId;
      await agentAutopilot(membership.teamId, agentId);
      await setBudgets(membership.teamId, { agentId }, body.budgets, userId);
      await onTemplateRelevantChange(agentId, ['budgets']);
      return agentAutopilot(membership.teamId, agentId);
    },
    {
      teamManager: true,
      params: agentAutopilotParams,
      body: budgetsBody,
      response: { 200: AgentAutopilotResponse, ...commonErrors },
      detail: {
        summary: "Set an agent's budgets",
        description:
          'Tokens, euros (estimated) or seconds of work per UTC day or month for everything the ' +
          'agent does, runs and chats. A null limit removes that budget. Only team owners and managers can change it.',
      },
    },
  )
  .post(
    '/approvals/:approvalId/budget',
    async ({ approvalId, body, user }) => {
      const userId = requireUser(user).id;
      await decideBudgetCard(approvalId, userId, body);
      return (await getApproval(approvalId))!;
    },
    {
      approval: 'decide',
      params: approvalParams,
      body: budgetDecisionBody,
      response: { 200: ApprovalResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Decide a budget card',
        description:
          'The answer to a used-up budget: raise it to a new limit, let one more run start ' +
          'past it in this period, or keep the work stopped.',
      },
    },
  )
  .post('/agent-policy/decide', ({ agent, body }) => decideForRuntime(agent, body), {
    runnerAgent: true,
    body: decideBody,
    response: { 200: DecideResponse, ...commonErrors },
    detail: {
      summary: 'Ask the policy engine about a tool call',
      description:
        "What an agent's runtime asks before a tool call (Hermes' approval guard, the Claude " +
        'Code hook, the browser gateway): the engine classifies the call into an action ' +
        'category, applies the Autopilot level and the budgets, logs the decision, and answers ' +
        'allow, needs-approval or deny with the message to hand the agent.',
    },
  });
