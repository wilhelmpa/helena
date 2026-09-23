import { Elysia } from 'elysia';
import { guards } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import type { TeamMembership } from '#shared/access';
import { HttpError } from '#shared/lib';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { agentInTeam, agentScopeOf } from '../core/service';
import { SkillResponse } from '../skills/model';
import {
  LearnedSkillResponse,
  RuntimeActionListResponse,
  RuntimeActionResponse,
  agentParams,
  createRuntimeActionBody,
  learnedSkillQuery,
  promoteLearnedSkillBody,
} from './model';
import {
  getLearnedSkill,
  listRuntimeActions,
  promoteLearnedSkill,
  queueRuntimeAction,
} from './service';

async function requireAgent(agentId: number, membership: TeamMembership) {
  if (!(await agentInTeam(agentId, membership.teamId, agentScopeOf(membership)))) {
    throw new HttpError(404, 'Agent not found');
  }
}

// What an external agent learned in its runtime: the content of the skills it created,
// and the owner's decisions on them and on its memory, which its runner carries out on
// its next sync. None of these routes is an MCP tool: an agent does not decide on what
// it or another agent learned.
export const agentLearningRoutes = new Elysia({
  name: 'agent-learning',
  detail: { tags: ['Agent Learning'] },
})
  .use(authContext)
  .use(guards)

  .get(
    '/teams/:teamId/ai-agents/:agentId/learned-skills/content',
    async ({ params, membership, query }) => {
      await requireAgent(params.agentId, membership);
      return getLearnedSkill(params.agentId, query.path);
    },
    {
      params: agentParams,
      query: learnedSkillQuery,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: LearnedSkillResponse, ...commonErrors },
      detail: {
        summary: 'Read a learned skill',
        description:
          'The SKILL.md and Markdown files of a skill the agent created, as its runner last ' +
          'reported them.',
      },
    },
  )

  .post(
    '/teams/:teamId/ai-agents/:agentId/learned-skills/promote',
    async ({ params, membership, body, set }) => {
      await requireAgent(params.agentId, membership);
      set.status = 201;
      return promoteLearnedSkill(membership.teamId, params.agentId, body.path);
    },
    {
      params: agentParams,
      body: promoteLearnedSkillBody,
      teamPermission: ['agent_skills', 'create'],
      response: { 201: SkillResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Take a learned skill into the library',
        description:
          "Copies a skill the agent created into the team's skill library and enables it on " +
          "the agent. The runner then writes it as one of Plan's skills and discards the " +
          "agent's own copy.",
      },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/runtime-actions',
    async ({ params, membership }) => {
      await requireAgent(params.agentId, membership);
      return listRuntimeActions(params.agentId);
    },
    {
      params: agentParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: RuntimeActionListResponse, ...accessErrors },
      detail: {
        summary: "List the actions waiting for an agent's runtime",
        description: 'The actions the runner has not carried out yet, and the ones that failed.',
      },
    },
  )

  .post(
    '/teams/:teamId/ai-agents/:agentId/runtime-actions',
    async ({ params, membership, body, set }) => {
      await requireAgent(params.agentId, membership);
      set.status = 201;
      return queueRuntimeAction(params.agentId, body);
    },
    {
      params: agentParams,
      body: createRuntimeActionBody,
      teamPermission: ['ai_agents', 'edit'],
      response: { 201: RuntimeActionResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: "Queue an action for an agent's runtime",
        description:
          'Discard or pin a skill the agent created, or write one of its memory files. The ' +
          'runner carries it out on its next sync. A memory write names the version it was ' +
          'made on and fails when the agent changed the file since.',
      },
    },
  );
