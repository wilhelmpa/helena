import { Elysia } from 'elysia';
import { guards } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { requireUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { isAgentUser } from '../core/service';
import { agentParams } from '../model';
import { agentForPerson } from '../people-access';
import { listMemoryRevisions } from '../memory/service';
import {
  MemoryRevisionListResponse,
  ProposalCountResponse,
  ProposalListResponse,
  ProposalResponse,
  memoryRevisionQuery,
  proposalDecisionBody,
  proposalListQuery,
  proposalParams,
} from './model';
import { countPendingProposals, decideProposal, listProposals } from './service';

// Changes an agent's runtime raised for the owner's decision (memory writes, runtime
// updates), and the history of an agent's memory. People only.
async function person(user: { id: string; role?: string | null } | null | undefined) {
  const current = requireUser(user);
  if (await isAgentUser(current.id)) throw new HttpError(403, 'Only a person can decide');
  return { id: current.id, isOwner: current.role === 'god' };
}

export const agentProposalRoutes = new Elysia({
  name: 'agent-proposals',
  detail: { tags: ['Agent Proposals'] },
})
  .use(authContext)
  .use(guards)

  .get(
    '/agent-proposals',
    async ({ user, query }) => listProposals(await person(user), query.status ?? 'pending'),
    {
      query: proposalListQuery,
      response: { 200: ProposalListResponse, ...accessErrors },
      detail: {
        summary: 'List runtime proposals',
        description:
          "Memory writes an agent's runtime held back and runtime updates, waiting or decided, " +
          'that the caller may decide.',
      },
    },
  )

  .get(
    '/agent-proposals/count',
    async ({ user }) => ({ count: await countPendingProposals(await person(user)) }),
    {
      response: { 200: ProposalCountResponse, ...accessErrors },
      detail: { summary: 'Count the runtime proposals waiting for the caller' },
    },
  )

  .post(
    '/agent-proposals/:proposalId/decision',
    async ({ user, params, body }) =>
      decideProposal(await person(user), params.proposalId, body.approved, body.note ?? null),
    {
      params: proposalParams,
      body: proposalDecisionBody,
      response: { 200: ProposalResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Decide on a runtime proposal',
        description:
          "Approve or reject. An approved memory write is written by the agent's runner on its " +
          'next sync; an approved runtime update starts the update.',
      },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/memory/revisions',
    async ({ params, membership, query }) => {
      await agentForPerson(params.agentId, membership);
      return listMemoryRevisions(params.agentId, query.file, query.limit ?? 50);
    },
    {
      params: agentParams,
      query: memoryRevisionQuery,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: MemoryRevisionListResponse, ...commonErrors },
      detail: {
        summary: "List the versions of an agent's memory",
        description:
          'Every version of MEMORY.md and USER.md Helena has seen, newest first: written by ' +
          'the agent and approved, written by a person, or found in the runtime.',
      },
    },
  );
