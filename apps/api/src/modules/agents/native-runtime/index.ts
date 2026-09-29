import './consolidation';
import { Elysia } from 'elysia';
import { guards } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { requireUser } from '#shared/access';
import { isMcpRequest } from '#shared/mcp-request';
import { commonErrors, errors } from '#shared/responses';
import { mcpTool } from '#mcp/generate';
import { runnerAuth } from '../runner-auth';
import { nativeRuntimeEnabled } from '../core/service';
import { agentParams } from '../model';
import { agentForPerson } from '../people-access';
import { correctFact, factCaller, factFeedback, factStore, listFactsForOwner } from './facts';
import { addNote, listNotes, memoryState, proposeMemory } from './memory';
import {
  appendItemsBody,
  compactionBody,
  createSessionBody,
  factCorrectionBody,
  FactFeedbackResponse,
  factFeedbackBody,
  FactListResponse,
  factParams,
  FactStoreResponse,
  factStoreBody,
  MemoryProposalResponse,
  memoryProposalBody,
  MemoryStateResponse,
  noteBody,
  NotesResponse,
  OkResponse,
  RuntimesResponse,
  SessionIdResponse,
  SessionResponse,
  sessionParams,
  teamFactParams,
} from './model';
import { appendItems, compactSession, createSession, loadSession } from './sessions';

// Helena's own agent loop (docs/helena-decisions/zentrale-laufzeit.md). Three groups:
//   /agent-runtime/sessions, /agent-runtime/memory  the loop's own, with the agent's key
//   /agent-facts                                    the fact store, a tool of Helena's MCP
//                                                   server for every runtime
//   /teams/:teamId/…/facts, …/memory/notes          what the memory editor shows and corrects

export const nativeRuntimeRoutes = new Elysia({
  name: 'agent-native-runtime',
  detail: { tags: ['Agent Runtime'] },
})
  .use(runnerAuth)
  .post(
    '/agent-runtime/sessions',
    ({ agent, body }) =>
      createSession(agent, {
        kind: body.kind,
        model: body.model ?? null,
        runId: body.runId ?? null,
        threadId: body.threadId ?? null,
      }),
    {
      runnerAgent: true,
      body: createSessionBody,
      response: { 200: SessionIdResponse, ...errors(400, 401, 403) },
      detail: { summary: "Start a session of Helena's own agent loop" },
    },
  )
  .get(
    '/agent-runtime/sessions/:sessionId',
    ({ agent, params }) => loadSession(agent, params.sessionId),
    {
      runnerAgent: true,
      params: sessionParams,
      response: { 200: SessionResponse, ...errors(401, 403, 404) },
      detail: { summary: 'Read a session of the calling agent, to resume it' },
    },
  )
  .post(
    '/agent-runtime/sessions/:sessionId/items',
    async ({ agent, params, body }) => {
      await appendItems(agent, params.sessionId, body.items);
      return { ok: true };
    },
    {
      runnerAgent: true,
      params: sessionParams,
      body: appendItemsBody,
      response: { 200: OkResponse, ...errors(400, 401, 403, 404) },
      detail: { summary: 'Append messages to a session (idempotent per sequence number)' },
    },
  )
  .post(
    '/agent-runtime/sessions/:sessionId/compaction',
    async ({ agent, params, body }) => {
      await compactSession(agent, params.sessionId, body.summary, body.compactedThrough);
      return { ok: true };
    },
    {
      runnerAgent: true,
      params: sessionParams,
      body: compactionBody,
      response: { 200: OkResponse, ...errors(400, 401, 403, 404) },
      detail: { summary: "Record the summary that stands for a session's older messages" },
    },
  )
  .get('/agent-runtime/memory', ({ agent }) => memoryState(agent.id), {
    runnerAgent: true,
    response: { 200: MemoryStateResponse, ...errors(401, 403) },
    detail: { summary: "Read the calling agent's memory and recent daily notes" },
  })
  .post(
    '/agent-runtime/memory/notes',
    async ({ agent, body }) => {
      await addNote(agent.id, body.text);
      return { ok: true };
    },
    {
      runnerAgent: true,
      body: noteBody,
      response: { 200: OkResponse, ...errors(400, 401, 403) },
      detail: { summary: "Add a line to the calling agent's note of today" },
    },
  )
  .post(
    '/agent-runtime/memory/proposals',
    ({ agent, body }) => proposeMemory(agent.id, body.file, body.content),
    {
      runnerAgent: true,
      body: memoryProposalBody,
      response: { 200: MemoryProposalResponse, ...errors(400, 401, 403) },
      detail: {
        summary: 'Write MEMORY.md or USER.md',
        description:
          'A new version of a memory file of the calling agent; it waits for the owner while the ' +
          "agent's memory writes need approval.",
      },
    },
  )

  .use(authContext)
  .use(guards)
  // Whether an agent can be put on Helena's own loop here (the switch HELENA_NATIVE_RUNTIME):
  // the agent editor offers it only then.
  .get(
    '/agent-runtimes',
    ({ user }) => {
      requireUser(user);
      return { helena: nativeRuntimeEnabled() };
    },
    {
      response: { 200: RuntimesResponse, ...errors(401) },
      detail: { summary: 'List the optional runtimes this instance offers' },
    },
  )
  .post(
    '/agent-facts',
    async ({ user, request, body }) => {
      const caller = await factCaller(requireUser(user), isMcpRequest(request.headers));
      const runId = Number(request.headers.get('x-helena-run')) || null;
      return factStore(caller, body, { ...(runId && { runId }), userId: caller.userId });
    },
    {
      body: factStoreBody,
      response: { 200: FactStoreResponse, ...commonErrors },
      detail: {
        summary: 'Keep and query facts',
        description:
          'The fact store: short facts you or other agents learned, with trust that grows when a fact is ' +
          'confirmed or helps and shrinks when it is contradicted or does not help. Keep only what is not ' +
          'obvious and helps later; never a secret. Search before you ask the person something again.',
        ...mcpTool('fact_store', { idempotentHint: false, openWorldHint: false }, 'write'),
      },
    },
  )
  .post(
    '/agent-facts/:factId/feedback',
    async ({ user, request, params, body }) => {
      const caller = await factCaller(requireUser(user), isMcpRequest(request.headers));
      return factFeedback(caller, params.factId, body.helpful);
    },
    {
      params: factParams,
      body: factFeedbackBody,
      response: { 200: FactFeedbackResponse, ...commonErrors },
      detail: {
        summary: 'Rate a fact',
        description: "Say whether a fact you used helped. It trains the fact's trust.",
        ...mcpTool('fact_feedback', { idempotentHint: false, openWorldHint: false }, 'write'),
      },
    },
  )
  .get(
    '/teams/:teamId/ai-agents/:agentId/facts',
    async ({ params, membership }) => {
      await agentForPerson(params.agentId, membership);
      return listFactsForOwner(params.teamId, params.agentId);
    },
    {
      params: agentParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: FactListResponse, ...commonErrors },
      detail: { summary: 'List the facts an agent keeps' },
    },
  )
  .get(
    '/teams/:teamId/ai-agents/:agentId/memory/notes',
    async ({ params, membership }) => {
      await agentForPerson(params.agentId, membership);
      return listNotes(params.agentId);
    },
    {
      params: agentParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: NotesResponse, ...commonErrors },
      detail: { summary: "List an agent's daily notes, newest first" },
    },
  )
  .patch(
    '/teams/:teamId/facts/:factId',
    ({ params, body }) => correctFact(params.teamId, params.factId, body),
    {
      params: teamFactParams,
      body: factCorrectionBody,
      teamPermission: ['ai_agents', 'edit'],
      response: { 200: FactStoreResponse, ...commonErrors },
      detail: { summary: 'Correct a fact', description: 'Its text, its trust or its category.' },
    },
  )
  .delete(
    '/teams/:teamId/facts/:factId',
    ({ params }) => correctFact(params.teamId, params.factId, { remove: true }),
    {
      params: teamFactParams,
      teamPermission: ['ai_agents', 'edit'],
      response: { 200: FactStoreResponse, ...commonErrors },
      detail: { summary: 'Remove a fact', description: 'The fact is hidden, not deleted.' },
    },
  );
