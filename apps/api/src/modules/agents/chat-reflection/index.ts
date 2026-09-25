import { Elysia, t } from 'elysia';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import { guards } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { runnerAuth } from '../runner-auth';
import { reflectionBody, reflectionSaved, runClaimQuery } from '../runner/model';
import { getAgentById } from '../core/service';
import { claimChatReflection, finishChatReflection, listChatReflections } from './service';

const ChatReflectionClaimResponse = t.Object({
  reflection: t.Nullable(
    t.Object({
      id: t.Number(),
      threadId: t.String(),
      claim: t.Number({ description: 'Named on the result, so a stale report is refused.' }),
      sessionId: t.String({ description: "The chat's session, which the reflection continues." }),
      messageId: t.Number({ description: 'The latest answer of the chat.' }),
      prompt: t.String(),
      model: t.Nullable(t.String()),
      thinkingLevel: t.Nullable(t.String()),
      maxTurns: t.Number(),
      runBudgetSeconds: t.Number(),
    }),
  ),
});

const ChatReflectionListResponse = t.Array(
  t.Object({
    id: t.Number(),
    threadId: t.String(),
    threadTitle: t.Nullable(t.String()),
    reason: t.Union([t.Literal('idle'), t.Literal('turns')]),
    status: t.Union([
      t.Literal('pending'),
      t.Literal('running'),
      t.Literal('success'),
      t.Literal('failed'),
      t.Literal('canceled'),
    ]),
    turns: t.Number(),
    saved: t.Array(reflectionSaved),
    summary: t.Nullable(t.String()),
    error: t.Nullable(t.String()),
    tokens: t.Nullable(t.Number()),
    dueAt: t.String(),
    finishedAt: t.Nullable(t.String()),
  }),
);

// The runner's side of chat reflections (docs/helena-decisions/agent-context.md §5), with the
// agent's own API key, and the list the agent's learning settings show.
export const chatReflectionRoutes = new Elysia({
  name: 'agent-chat-reflections',
  detail: { tags: ['Agent Runner'] },
})
  .use(runnerAuth)
  .post(
    '/agent-chat-reflections/claim',
    async ({ agent }) => ({ reflection: await claimChatReflection(agent) }),
    {
      runnerAgent: true,
      response: { 200: ChatReflectionClaimResponse, ...errors(401, 403) },
      detail: {
        summary: 'Claim the next chat reflection',
        description:
          "Take the calling agent's next due reflection on a chat, or reflection: null. Run " +
          "the prompt in the chat's session with only the memory and skill tools and report " +
          'the result; it is leased and handed out again when no result arrives.',
      },
    },
  )
  .post(
    '/agent-chat-reflections/:id/result',
    async ({ agent, params, query, body }) => {
      if (!(await finishChatReflection(agent, params.id, query.claim, body))) {
        throw new HttpError(404, 'No chat reflection of this agent is out');
      }
      return noContent();
    },
    {
      runnerAgent: true,
      params: t.Object({ id: t.Numeric() }),
      query: runClaimQuery,
      body: reflectionBody,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Report a chat reflection',
        description: 'How the reflection went, what the agent saved and what it cost.',
      },
    },
  );

// The agent's latest chat reflections, for anyone who may read the agent.
export const chatReflectionListRoutes = new Elysia({
  name: 'agent-chat-reflection-list',
  detail: { tags: ['AI Agents'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/teams/:teamId/ai-agents/:agentId/chat-reflections',
    async ({ membership, params }) => {
      if (!(await getAgentById(params.agentId, membership.teamId))) {
        throw new HttpError(404, 'Agent not found');
      }
      return listChatReflections(params.agentId);
    },
    {
      params: t.Object({ teamId: t.Numeric(), agentId: t.Numeric() }),
      teamMember: true,
      response: { 200: ChatReflectionListResponse, ...commonErrors },
      detail: {
        summary: "List an agent's chat reflections",
        description: 'The latest reflections of the agent on its chats, newest first.',
      },
    },
  );
