import { Elysia } from 'elysia';
import { guards } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { requireUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import { agentParams } from '../model';
import { agentForPerson } from '../people-access';
import { assertSessionVisible, resolveSessions } from './session-access';
import { askRuntime, getRuntimeRequest, queueRuntimeRequest } from '../runtime-requests/service';
import {
  CuratorStatusResponse,
  curatorActionBody,
  HealthResponse,
  LogLinesResponse,
  QueuedResponse,
  RuntimeRequestStateResponse,
  SessionPageResponse,
  SessionSearchResponse,
  SessionsResponse,
  TranscriptResponse,
  VersionResponse,
  logsQuery,
  requestParams,
  sessionParams,
  sessionsQuery,
  transcriptQuery,
} from './model';

// What an agent's runtime keeps on its own, read through its runner: its sessions with their
// full transcripts, its logs, its health and version, its curator. People and authorized
// Home/all-project/owner delegates may inspect them within their own team.
const failures = { ...commonErrors, ...errors(409, 502, 503, 504) };
const HEALTH_TIMEOUT_MS = 100_000;

export const runtimeViewRoutes = new Elysia({
  name: 'agent-runtime-views',
  detail: { tags: ['Agent Runtime'] },
})
  .use(authContext)
  .use(guards)

  .get(
    '/teams/:teamId/ai-agents/:agentId/runtime/sessions',
    async ({ params, membership, query, user }) => {
      const { projectIds } = await agentForPerson(params.agentId, membership);
      const userId = requireUser(user).id;
      const viewer = { userId, projectIds };
      const q = query.q?.trim();
      if (q) {
        const hits = await askRuntime<typeof SessionSearchResponse.static>(
          params.agentId,
          { op: 'sessions.search', query: q, limit: query.limit ?? 20 },
          { userId, viewer },
        );
        const seen = await resolveSessions(
          params.agentId,
          hits.map((hit) => hit.sessionId),
          viewer,
        );
        return {
          hits: hits
            .filter((hit) => seen.get(hit.sessionId)?.visible)
            .map((hit) => ({
              ...hit,
              session: hit.session && {
                ...hit.session,
                link: seen.get(hit.sessionId)?.link ?? null,
              },
            })),
        };
      }
      const page = await askRuntime<typeof SessionPageResponse.static>(
        params.agentId,
        { op: 'sessions.list', limit: query.limit ?? 25, offset: query.offset ?? 0 },
        { userId, viewer },
      );
      const seen = await resolveSessions(
        params.agentId,
        page.sessions.map((session) => session.id),
        viewer,
      );
      const sessions = page.sessions
        .filter((session) => seen.get(session.id)?.visible)
        .map((session) => ({ ...session, link: seen.get(session.id)?.link ?? null }));
      // The runtime counts every session; the ones hidden on this page come off the total.
      return {
        page: { sessions, total: page.total - (page.sessions.length - sessions.length) },
      };
    },
    {
      params: agentParams,
      query: sessionsQuery,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: SessionsResponse, ...failures },
      detail: {
        'x-access': 'agent-inspector',
        summary: "List or search an agent's runtime sessions",
        description:
          'Without `q` a page of the sessions the runtime keeps, newest first; with `q` the ' +
          'sessions whose messages match. Only the sessions the person may read: of runs in ' +
          'their projects, of their own chats, and, for someone who sees the whole team, the ' +
          'sessions {appName} did not start. Each names its run or chat when {appName} knows it.',
      },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/runtime/sessions/:sessionId',
    async ({ params, membership, query, user }) => {
      const { projectIds } = await agentForPerson(params.agentId, membership);
      await assertSessionVisible(params.agentId, params.sessionId, {
        userId: requireUser(user).id,
        projectIds,
      });
      return askRuntime<typeof TranscriptResponse.static>(
        params.agentId,
        {
          op: 'sessions.transcript',
          sessionId: params.sessionId,
          offset: query.offset ?? 0,
          limit: query.limit ?? 500,
        },
        { userId: requireUser(user).id },
      );
    },
    {
      params: sessionParams,
      query: transcriptQuery,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: TranscriptResponse, ...failures },
      detail: {
        'x-access': 'agent-inspector',
        summary: 'Read the transcript of a session',
        description:
          'Every message with its reasoning, tool calls with arguments and results, times and ' +
          "the session's token counts, redacted by the runtime and the runner.",
      },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/runtime/logs',
    async ({ params, membership, query, user }) => {
      const { projectIds } = await agentForPerson(params.agentId, membership);
      // The whole log carries every session's lines: for someone who sees the whole team.
      if (query.sessionId) {
        await assertSessionVisible(params.agentId, query.sessionId, {
          userId: requireUser(user).id,
          projectIds,
        });
      } else if (projectIds !== undefined) {
        throw new HttpError(403, "Only people who see the whole team read an agent's whole log");
      }
      return askRuntime<typeof LogLinesResponse.static>(
        params.agentId,
        {
          op: 'logs.read',
          sessionId: query.sessionId ?? null,
          lines: query.lines ?? 200,
          level: query.level ?? null,
        },
        { userId: requireUser(user).id },
      );
    },
    {
      params: agentParams,
      query: logsQuery,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: LogLinesResponse, ...failures },
      detail: {
        'x-access': 'agent-inspector',
        summary: "Read an agent's runtime log",
        description: 'The last lines of the runtime log, of one session when named, redacted.',
      },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/runtime/health',
    async ({ params, membership, user }) => {
      await agentForPerson(params.agentId, membership);
      return askRuntime<typeof HealthResponse.static>(
        params.agentId,
        { op: 'health.check' },
        { userId: requireUser(user).id, timeoutMs: HEALTH_TIMEOUT_MS },
      );
    },
    {
      params: agentParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: HealthResponse, ...failures },
      detail: {
        'x-access': 'agent-inspector',
        summary: "Check an agent's runtime (hermes doctor)",
      },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/runtime/version',
    async ({ params, membership, user }) => {
      await agentForPerson(params.agentId, membership);
      return askRuntime<typeof VersionResponse.static>(
        params.agentId,
        { op: 'version.read' },
        { userId: requireUser(user).id },
      );
    },
    {
      params: agentParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: VersionResponse, ...failures },
      detail: {
        'x-access': 'agent-inspector',
        summary: "Read the version of an agent's runtime",
      },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/runtime/curator',
    async ({ params, membership, user }) => {
      await agentForPerson(params.agentId, membership);
      return askRuntime<typeof CuratorStatusResponse.static>(
        params.agentId,
        { op: 'curator.status' },
        { userId: requireUser(user).id },
      );
    },
    {
      params: agentParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: CuratorStatusResponse, ...failures },
      detail: {
        'x-access': 'agent-inspector',
        summary: "Read the state of an agent's skill curator",
      },
    },
  )

  .post(
    '/teams/:teamId/ai-agents/:agentId/runtime/curator/run',
    async ({ params, membership, user, set }) => {
      await agentForPerson(params.agentId, membership);
      set.status = 202;
      return {
        requestId: await queueRuntimeRequest(
          params.agentId,
          { op: 'curator.run' },
          requireUser(user).id,
        ),
      };
    },
    {
      params: agentParams,
      teamPermission: ['ai_agents', 'edit'],
      response: { 202: QueuedResponse, ...failures },
      detail: {
        'x-access': 'agent-inspector',
        summary: "Run an agent's skill curator now",
        description:
          'Queues a curator review in the runtime; read its outcome with the request route.',
      },
    },
  )

  .post(
    '/teams/:teamId/ai-agents/:agentId/runtime/curator',
    async ({ params, membership, user, body }) => {
      await agentForPerson(params.agentId, membership);
      return askRuntime<typeof CuratorStatusResponse.static>(
        params.agentId,
        { op: 'curator.set', action: body.action, skill: body.skill },
        { userId: requireUser(user).id },
      );
    },
    {
      params: agentParams,
      body: curatorActionBody,
      teamPermission: ['ai_agents', 'edit'],
      response: { 200: CuratorStatusResponse, ...failures },
      detail: {
        'x-access': 'agent-inspector',
        summary: "Pin or unpin a skill for an agent's curator",
        description:
          'A pinned skill is never archived or changed by the curator. Whether the curator ' +
          "works at all is the agent's learning setting. Answers the curator's state afterwards.",
      },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/runtime/requests/:requestId',
    async ({ params, membership }) => {
      await agentForPerson(params.agentId, membership);
      const state = await getRuntimeRequest(params.agentId, params.requestId);
      if (!state) throw new HttpError(404, 'Request not found');
      return state;
    },
    {
      params: requestParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: RuntimeRequestStateResponse, ...commonErrors },
      detail: {
        'x-access': 'agent-inspector',
        summary: 'Read the state of a queued runtime request',
      },
    },
  );
