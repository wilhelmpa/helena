import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { entityGuard, guards } from '#shared/guards';
import { paginate } from '#shared/pagination';
import { getIssueProjectId } from '#modules/issues/service';
import { getProjectByKey } from '#modules/projects/service';
import { requireUser, type TeamMembership } from '#shared/access';
import { noContent, sseFrame, sseResponse } from '#shared/http';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import { agentScopeOf, getAgentById, getAgentInProject, isTriggerableBy } from '../core/service';
import { runnerAuth } from '../runner-auth';
import { watchChatAnswer } from './wake';
import {
  ChatAckResponse,
  ChatEventsResponse,
  ChatListResponse,
  ChatSummaryResponse,
  chatListQuery,
  chatParams,
  deleteChatQuery,
  issueChatParams,
  showVersionBody,
  updateChatBody,
  ChatCatalogResponse,
  ClaimChatResponse,
  RetryChatResponse,
  SendChatResponse,
  agentParams,
  projectAgentParams,
  chatEventsBody,
  chatCatalogBody,
  chatEventsQuery,
  chatMessageParams,
  teamChatMessageParams,
  chatResultBody,
  retryChatBody,
  runnerMessageParams,
  sendChatBody,
  type AgUiEventBody,
  type ChatMessageStatus,
} from './model';
import {
  agentChatConfig,
  appendEvents,
  cancelMessage,
  claimNextMessage,
  finishMessage,
  heartbeatMessage,
  readEvents,
  readChatCatalog,
  readTeamChatCatalog,
  sendMessage,
  publishChatCatalog,
  retryMessage,
  showVersion,
} from './service';
import {
  getChat,
  listChats,
  purgeChat,
  restoreChat,
  setChatPinned,
  trashChat,
  updateChat,
} from './threads';
import { resolveAttachments } from './attachments';

// Chatting with an external agent: the member's side (send a message, follow the
// answer) and the runner's side (take the next answer to produce, report AG-UI events,
// close it). The answer comes from the operator's machine, so the two sides only ever
// meet in the database.

// How long one stream stays open with nothing arriving before it ends and lets the
// browser reconnect. An answer may legitimately wait a long time for a runner to come
// online, so this is a bound on the connection, not on the answer.
const STREAM_MAX_MS = 30 * 60_000;
const KEEPALIVE_MS = 15_000;

type StreamLimit = { startedAt: number; requests: number; active: number };
const streamLimits = new Map<string, StreamLimit>();

function acquireStream(userId: string): (() => void) | null {
  const now = Date.now();
  const windowMs = agentChatConfig.streamWindowSeconds() * 1000;
  for (const [key, value] of streamLimits) {
    if (value.active === 0 && now - value.startedAt >= windowMs) streamLimits.delete(key);
  }
  let limit = streamLimits.get(userId);
  if (!limit || now - limit.startedAt >= windowMs) {
    limit = { startedAt: now, requests: 0, active: 0 };
    streamLimits.set(userId, limit);
  }
  if (
    limit.requests >= agentChatConfig.streamLimit() ||
    limit.active >= agentChatConfig.streamConcurrentLimit()
  ) {
    return null;
  }
  limit.requests += 1;
  limit.active += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    limit.active = Math.max(0, limit.active - 1);
  };
}

async function* limitedStream(
  frames: AsyncIterable<string>,
  release: () => void,
): AsyncGenerator<string> {
  try {
    yield* frames;
  } finally {
    release();
  }
}

// The agent this route acts on, or a 404: one working in the project, or one of the
// team the caller may see.
async function requireProjectAgent(agentId: number, projectId: number) {
  const agent = await getAgentInProject(agentId, projectId);
  if (!agent) throw new HttpError(404, 'Agent not found');
  return agent;
}

async function requireTeamAgent(agentId: number, membership: TeamMembership) {
  const agent = await getAgentById(agentId, membership.teamId, agentScopeOf(membership));
  if (!agent) throw new HttpError(404, 'Agent not found');
  return agent;
}

export const agentChatRoutes = new Elysia({ name: 'agent-chat', detail: { tags: ['Agent Chat'] } })
  .use(authContext)
  .use(guards)
  .use(runnerAuth)
  .macro({
    chatIssue: entityGuard('work_items', 'Issue not found', (p) =>
      getIssueProjectId(Number(p.issueId)),
    ),
  })

  // The caller's chats across the agents. Every chat is its member's own, so these
  // routes read and change only the caller's rows.
  .get(
    '/chats',
    async ({ query, user }) => {
      const caller = requireUser(user);
      const project = query.projectKey ? await getProjectByKey(query.projectKey) : null;
      if (query.projectKey && !project) throw new HttpError(404, 'Project not found');
      return paginate(query, (window) =>
        listChats(
          caller.id,
          {
            projectId: project?.id,
            agentId: query.agentId,
            q: query.q,
            view: query.view,
          },
          window,
        ),
      );
    },
    {
      query: chatListQuery,
      response: { 200: ChatListResponse, ...commonErrors },
      detail: {
        summary: 'List chats',
        description:
          "The caller's chats with every agent, pinned ones first, then the newest. A search " +
          'ranks a title hit first.',
      },
    },
  )

  .get(
    '/chats/:threadId',
    async ({ params, user }) => {
      const chat = await getChat(params.threadId, requireUser(user).id);
      if (!chat) throw new HttpError(404, 'Chat not found');
      return chat;
    },
    {
      params: chatParams,
      response: { 200: ChatSummaryResponse, ...commonErrors },
      detail: { summary: 'Get a chat' },
    },
  )

  .patch(
    '/chats/:threadId',
    async ({ params, body, user }) => {
      if (!(await updateChat(params.threadId, requireUser(user), body))) {
        throw new HttpError(404, 'Chat not found');
      }
      return noContent();
    },
    {
      params: chatParams,
      body: updateChatBody,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Update a chat',
        description: 'Rename a chat, archive it or take it out of the archive, or link a task.',
      },
    },
  )

  .put(
    '/chats/:threadId/pin',
    async ({ params, user }) => {
      if (!(await setChatPinned(params.threadId, requireUser(user).id, true))) {
        throw new HttpError(404, 'Chat not found');
      }
      return noContent();
    },
    {
      params: chatParams,
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Pin a chat' },
    },
  )

  .delete(
    '/chats/:threadId/pin',
    async ({ params, user }) => {
      if (!(await setChatPinned(params.threadId, requireUser(user).id, false))) {
        throw new HttpError(404, 'Chat not found');
      }
      return noContent();
    },
    {
      params: chatParams,
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Unpin a chat' },
    },
  )

  .delete(
    '/chats/:threadId',
    async ({ params, query, user }) => {
      const caller = requireUser(user);
      const done = query.permanent
        ? await purgeChat(params.threadId, caller.id)
        : await trashChat(params.threadId, caller.id);
      if (!done) throw new HttpError(404, 'Chat not found');
      return noContent();
    },
    {
      params: chatParams,
      query: deleteChatQuery,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Delete a chat',
        description:
          'Move a chat to the trash, where it can be restored. With permanent, delete a chat ' +
          'that is in the trash for good.',
      },
    },
  )

  .post(
    '/chats/:threadId/restore',
    async ({ params, user }) => {
      if (!(await restoreChat(params.threadId, requireUser(user).id))) {
        throw new HttpError(404, 'Chat not found');
      }
      return noContent();
    },
    {
      params: chatParams,
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Restore a deleted chat' },
    },
  )

  .put(
    '/chats/:threadId/active',
    async ({ params, body, user }) => {
      if (!(await showVersion(params.threadId, requireUser(user).id, body.messageId))) {
        throw new HttpError(404, 'Chat not found');
      }
      return noContent();
    },
    {
      params: chatParams,
      body: showVersionBody,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Show another version of a message',
        description:
          'Show a version of an edited question or a regenerated answer, with the newest ' +
          'conversation that continued from it.',
      },
    },
  )

  .get(
    '/issues/:issueId/chats',
    async ({ params, user }) =>
      (
        await listChats(
          requireUser(user).id,
          { issueId: params.issueId, view: 'any' },
          { limit: 100, offset: 0 },
        )
      ).items.filter((chat) => chat.deletedAt == null),
    {
      params: issueChatParams,
      chatIssue: 'read',
      response: { 200: t.Array(ChatSummaryResponse), ...commonErrors },
      detail: { summary: "List the caller's chats linked to a task" },
    },
  )

  // Global Home chat. It is team-scoped because a fresh installation intentionally
  // has no project yet; the transcript itself is already keyed by agent and member.
  .post(
    '/teams/:teamId/ai-agents/:agentId/chat',
    async ({ params, membership, body, user }) => {
      const caller = requireUser(user);
      const agent = await requireTeamAgent(params.agentId, membership);
      if (agent.template) throw new HttpError(400, 'A template does not run');
      if (!isTriggerableBy(agent, caller.id)) {
        throw new HttpError(403, 'This agent only takes tasks from its owner');
      }
      const sent = await sendMessage({
        agentId: params.agentId,
        userId: caller.id,
        projectId: null,
        prompt: body.prompt,
        threadId: body.threadId,
        parentId: body.parentId,
        attachments: await resolveAttachments(caller, body.attachments ?? {}),
        model: body.model,
        thinkingLevel: body.thinkingLevel,
        maxConcurrentChats: agent.maxConcurrentChats,
      });
      if (!sent) throw new HttpError(404, 'Thread not found');
      return sent;
    },
    {
      body: sendChatBody,
      params: agentParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: SendChatResponse, ...commonErrors, ...errors(409, 429) },
      detail: { summary: 'Send a global Home chat message' },
    },
  )

  .post(
    '/teams/:teamId/ai-agents/:agentId/chat/retry',
    async ({ params, membership, body, user }) => {
      const caller = requireUser(user);
      const agent = await requireTeamAgent(params.agentId, membership);
      if (agent.template) throw new HttpError(400, 'A template does not run');
      if (!isTriggerableBy(agent, caller.id)) {
        throw new HttpError(403, 'This agent only takes tasks from its owner');
      }
      const retried = await retryMessage({
        agentId: params.agentId,
        userId: caller.id,
        projectId: null,
        threadId: body.threadId,
        questionId: body.questionId,
        maxConcurrentChats: agent.maxConcurrentChats,
      });
      if (!retried) throw new HttpError(404, 'Thread not found');
      return retried;
    },
    {
      body: retryChatBody,
      params: agentParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: RetryChatResponse, ...commonErrors, ...errors(409, 429) },
      detail: { summary: 'Answer a global Home chat question again' },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/chat/catalog',
    async ({ params, membership }) => {
      const agent = await requireTeamAgent(params.agentId, membership);
      return agent.template
        ? readTeamChatCatalog(membership.teamId)
        : readChatCatalog(params.agentId);
    },
    {
      params: agentParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: ChatCatalogResponse, ...commonErrors },
      detail: {
        summary: 'List global Home chat models',
        description:
          "The models and thinking levels the agent's runner last published. A template, " +
          "which runs nowhere, offers every model the team's runners published.",
      },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/chat/:messageId/events',
    async ({ params, membership, query, user }) => {
      const caller = requireUser(user);
      await requireTeamAgent(params.agentId, membership);
      const page = await readEvents(params.messageId, params.agentId, caller.id, query.after);
      if (!page) throw new HttpError(404, 'Message not found');
      return page;
    },
    {
      params: teamChatMessageParams,
      query: chatEventsQuery,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: ChatEventsResponse, ...commonErrors },
      detail: { summary: 'Read global Home answer events' },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/chat/:messageId/stream',
    async ({ params, membership, query, headers, user }) => {
      const caller = requireUser(user);
      await requireTeamAgent(params.agentId, membership);
      const after = resumeCursor(headers, query.after);
      if (!(await readEvents(params.messageId, params.agentId, caller.id, after))) {
        throw new HttpError(404, 'Message not found');
      }
      const release = acquireStream(caller.id);
      if (!release) throw new HttpError(429, 'Too many chat stream requests. Try again shortly.');
      return sseResponse(
        limitedStream(
          streamChatEvents(params.messageId, params.agentId, caller.id, after),
          release,
        ),
      );
    },
    {
      params: teamChatMessageParams,
      query: chatEventsQuery,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: t.Any(), ...commonErrors, ...errors(429) },
      detail: { summary: 'Stream a global Home answer' },
    },
  )

  .post(
    '/teams/:teamId/ai-agents/:agentId/chat/:messageId/cancel',
    async ({ params, membership, user }) => {
      const caller = requireUser(user);
      const agent = await requireTeamAgent(params.agentId, membership);
      if (!isTriggerableBy(agent, caller.id)) {
        throw new HttpError(403, 'This agent only takes tasks from its owner');
      }
      const ok = await cancelMessage(params.messageId, params.agentId, caller.id);
      if (!ok) throw new HttpError(404, 'Message not found');
      return noContent();
    },
    {
      params: teamChatMessageParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Stop a global Home answer' },
    },
  )

  .post(
    '/projects/:projectKey/ai-agents/:agentId/chat',
    async ({ params, project, body, user }) => {
      const caller = requireUser(user);
      const agent = await requireProjectAgent(params.agentId, project.id);
      if (!isTriggerableBy(agent, caller.id)) {
        throw new HttpError(403, 'This agent only takes tasks from its owner');
      }
      const sent = await sendMessage({
        agentId: params.agentId,
        userId: caller.id,
        projectId: project.id,
        prompt: body.prompt,
        threadId: body.threadId,
        parentId: body.parentId,
        attachments: await resolveAttachments(caller, body.attachments ?? {}),
        model: body.model,
        thinkingLevel: body.thinkingLevel,
        maxConcurrentChats: agent.maxConcurrentChats,
      });
      if (!sent) throw new HttpError(404, 'Thread not found');
      return sent;
    },
    {
      body: sendChatBody,
      params: projectAgentParams,
      permission: ['ai_agents', 'read'],
      response: { 200: SendChatResponse, ...commonErrors, ...errors(409, 429) },
      detail: {
        summary: 'Send a chat message',
        description:
          "Queue a message for the agent's runner and return the answer it will " +
          'produce. Follow the answer with the stream endpoint. A paused agent takes no ' +
          'message (409).',
      },
    },
  )

  .post(
    '/projects/:projectKey/ai-agents/:agentId/chat/retry',
    async ({ params, project, body, user }) => {
      const caller = requireUser(user);
      const agent = await requireProjectAgent(params.agentId, project.id);
      if (!isTriggerableBy(agent, caller.id)) {
        throw new HttpError(403, 'This agent only takes tasks from its owner');
      }
      const retried = await retryMessage({
        agentId: params.agentId,
        userId: caller.id,
        projectId: project.id,
        threadId: body.threadId,
        questionId: body.questionId,
        maxConcurrentChats: agent.maxConcurrentChats,
      });
      if (!retried) throw new HttpError(404, 'Thread not found');
      return retried;
    },
    {
      body: retryChatBody,
      params: projectAgentParams,
      permission: ['ai_agents', 'read'],
      response: { 200: RetryChatResponse, ...commonErrors, ...errors(409, 429) },
      detail: {
        summary: 'Answer a chat question again',
        description:
          'Queue another answer to a question of the thread. The answers of a question are ' +
          'its versions; the new one becomes the one the thread shows.',
      },
    },
  )

  .get(
    '/projects/:projectKey/ai-agents/:agentId/chat/catalog',
    async ({ params, project }) => {
      await requireProjectAgent(params.agentId, project.id);
      return readChatCatalog(params.agentId);
    },
    {
      params: projectAgentParams,
      permission: ['ai_agents', 'read'],
      response: { 200: ChatCatalogResponse, ...commonErrors },
      detail: {
        summary: 'List chat models',
        description: "Return the models and thinking levels last published by this agent's runner.",
      },
    },
  )

  // The answer's events after `after`, as plain JSON. What the stream serves, for a
  // client that reconnects and for one that would rather poll.
  .get(
    '/projects/:projectKey/ai-agents/:agentId/chat/:messageId/events',
    async ({ params, project, query, user }) => {
      const caller = requireUser(user);
      await requireProjectAgent(params.agentId, project.id);
      const page = await readEvents(params.messageId, params.agentId, caller.id, query.after);
      if (!page) throw new HttpError(404, 'Message not found');
      return page;
    },
    {
      params: chatMessageParams,
      query: chatEventsQuery,
      permission: ['ai_agents', 'read'],
      response: { 200: ChatEventsResponse, ...commonErrors },
      detail: { summary: 'Read answer events' },
    },
  )

  // The same events as Server-Sent Events, one `data:` line per JSON-encoded AG-UI
  // event, as the runner reports them. The connection is held open while the answer is
  // still being produced — including before a runner has taken it, which is what lets
  // the chat show that it is waiting.
  .get(
    '/projects/:projectKey/ai-agents/:agentId/chat/:messageId/stream',
    async ({ params, project, query, headers, user }) => {
      const caller = requireUser(user);
      await requireProjectAgent(params.agentId, project.id);
      // Checked before the stream starts, so an unknown answer is a 404 rather than a
      // stream that ends immediately.
      const after = resumeCursor(headers, query.after);
      if (!(await readEvents(params.messageId, params.agentId, caller.id, after))) {
        throw new HttpError(404, 'Message not found');
      }
      const release = acquireStream(caller.id);
      if (!release) throw new HttpError(429, 'Too many chat stream requests. Try again shortly.');
      return sseResponse(
        limitedStream(
          streamChatEvents(params.messageId, params.agentId, caller.id, after),
          release,
        ),
      );
    },
    {
      params: chatMessageParams,
      query: chatEventsQuery,
      permission: ['ai_agents', 'read'],
      response: {
        // The success body is an SSE stream returned as a raw Response, so it is not a
        // JSON shape the validator can describe.
        200: t.Any(),
        ...commonErrors,
        ...errors(429),
      },
      detail: { summary: 'Stream an answer' },
    },
  )

  // Stops the answer being produced. The runner learns of it on its next report and
  // kills the command; what the agent wrote before it stays in the transcript.
  .post(
    '/projects/:projectKey/ai-agents/:agentId/chat/:messageId/cancel',
    async ({ params, project, user }) => {
      const caller = requireUser(user);
      const agent = await requireProjectAgent(params.agentId, project.id);
      if (!isTriggerableBy(agent, caller.id)) {
        throw new HttpError(403, 'This agent only takes tasks from its owner');
      }
      const ok = await cancelMessage(params.messageId, params.agentId, caller.id);
      if (!ok) throw new HttpError(404, 'Message not found');
      return noContent();
    },
    {
      params: chatMessageParams,
      permission: ['ai_agents', 'read'],
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Stop an answer',
        description:
          'Stop the answer being produced for this message. Terminal: it is not claimed ' +
          'again and not retried.',
      },
    },
  )

  .post('/agent-chats/claim', async ({ agent }) => ({ message: await claimNextMessage(agent) }), {
    runnerAgent: true,
    response: { 200: ClaimChatResponse, ...errors(401, 403) },
    detail: {
      summary: 'Claim the next chat message',
      description:
        "Take the calling agent's next chat message to answer. The call waits for one " +
        'and returns message: null when none arrives. It is leased: report events, ' +
        'heartbeats, or a result, otherwise it is handed out again.',
    },
  })

  .post(
    '/agent-chats/catalog',
    async ({ agent, body }) => {
      await publishChatCatalog(agent.id, body.models);
      return noContent();
    },
    {
      runnerAgent: true,
      body: chatCatalogBody,
      response: { 204: t.Void(), ...errors(401, 403) },
      detail: {
        summary: 'Publish the runner model catalog',
        description:
          "Replace the calling agent's model catalog used for member chat configuration.",
      },
    },
  )

  .post(
    '/agent-chats/:messageId/events',
    async ({ agent, params, body }) => {
      const ack = await appendEvents(agent.id, params.messageId, body.events, body.sessionId);
      if (!ack) throw new HttpError(404, 'Message not found');
      return ack;
    },
    {
      runnerAgent: true,
      params: runnerMessageParams,
      body: chatEventsBody,
      response: { 200: ChatAckResponse, ...commonErrors },
      detail: {
        summary: 'Report answer events',
        description:
          'Append AG-UI events to a claimed answer: text deltas, tool calls, run ' +
          'lifecycle. Reporting also extends the lease, and binds the thread to the ' +
          'session when `sessionId` is given. Answers `canceled` when the member stopped ' +
          'the answer: kill the command and stop reporting.',
      },
    },
  )

  .post(
    '/agent-chats/:messageId/heartbeat',
    async ({ agent, params }) => {
      const ack = await heartbeatMessage(agent.id, params.messageId);
      if (!ack) throw new HttpError(404, 'Message not found');
      return ack;
    },
    {
      runnerAgent: true,
      params: runnerMessageParams,
      response: { 200: ChatAckResponse, ...commonErrors },
      detail: {
        summary: 'Extend an answer lease',
        description:
          'Keep a claimed answer leased while the runner is still working on it. Answers ' +
          '`canceled` when the member stopped the answer, which is how a runner writing ' +
          'nothing learns of it.',
      },
    },
  )

  .post(
    '/agent-chats/:messageId/result',
    async ({ agent, params, body }) => {
      const ok = await finishMessage(agent.id, params.messageId, body);
      if (!ok) throw new HttpError(404, 'Message not found');
      return noContent();
    },
    {
      runnerAgent: true,
      params: runnerMessageParams,
      body: chatResultBody,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Finish an answer',
        description: 'Close a claimed answer as success or failed. A failure is not retried.',
      },
    },
  );

// Where a stream picks up: after the event the reader saw last. The SSE standard sends
// that event's id back as the Last-Event-ID header when a client reconnects; `?after=` is
// how clients before it asked, accepted for one release.
function resumeCursor(headers: Record<string, string | undefined>, after: number | undefined) {
  const header = headers['last-event-id']?.trim();
  if (header && /^\d+$/.test(header)) return Number(header);
  return after ?? 0;
}

// The frames one stream sends: every event stored for the answer, in order, and then
// whatever arrives while it is still being produced. Each frame carries the event's id,
// which a client that reconnects passes back as `after` to resume where it stopped.
//
// The answer always ends on RUN_FINISHED or RUN_ERROR, synthesized when the runner
// reported neither, so a stream that closes without one means the connection dropped
// rather than the answer ending. Comment frames keep the connection alive through a
// proxy that would otherwise drop it while the agent is thinking.
async function* streamChatEvents(
  messageId: number,
  agentId: number,
  userId: string,
  after: number,
): AsyncGenerator<string> {
  const until = Date.now() + STREAM_MAX_MS;
  let cursor = after;
  let ended = false;
  let quietSince = Date.now();
  for (;;) {
    // Watched before reading, so a change that lands during the read wakes the next turn.
    const change = watchChatAnswer(messageId, agentChatConfig.streamPollMs());
    try {
      const page = await readEvents(messageId, agentId, userId, cursor);
      if (!page) return;
      for (const item of page.items) {
        if (item.event.type === 'RUN_ERROR' || item.event.type === 'RUN_FINISHED') ended = true;
        yield sseFrame(item.event, item.id);
      }
      if (page.nextCursor != null) {
        cursor = page.nextCursor;
        quietSince = Date.now();
      }
      // More is already stored than one read hands out: take it before deciding the
      // answer is over or waiting for the next change.
      if (page.hasMore) continue;
      if (page.status !== 'pending' && page.status !== 'streaming') {
        if (!ended) yield sseFrame(terminalEvent(page.status, page.error), cursor);
        return;
      }
      if (Date.now() >= until) return;
      if (Date.now() - quietSince >= KEEPALIVE_MS) {
        yield ': ping\n\n';
        quietSince = Date.now();
      }
      await change.next;
    } finally {
      change.stop();
    }
  }
}

// A stopped answer ends the stream the same way a finished one does: the stop was asked
// for, so it is not an error, and what the agent wrote before it is already in the frames
// the reader has.
function terminalEvent(status: ChatMessageStatus, error: string | null): AgUiEventBody {
  return status === 'failed'
    ? { type: 'RUN_ERROR', message: error ?? 'The agent did not finish the answer' }
    : { type: 'RUN_FINISHED' };
}
