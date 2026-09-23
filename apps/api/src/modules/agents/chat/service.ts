import {
  db,
  agentChatCatalog,
  agentChatEvent,
  agentChatFavorite,
  agentChatMessage,
  agentChatThread,
} from '@repo/db';
import { and, asc, desc, eq, gt, inArray, notExists, sql } from 'drizzle-orm';
import { setTimeout as sleep } from 'node:timers/promises';
import { HttpError, intEnv, iso } from '#shared/lib';
import { deleteContextUsage, recordContextUsage, type ContextUsage } from '../chat-usage';
import { deleteFavorite, FAVORITES_LIMIT } from '../chat-favorites';
import {
  likePattern,
  searchTerm,
  snippetOf,
  summarize,
  type ThreadListOpts,
  type ThreadRow,
} from '../chat-history';
import { appendTextPart } from '../chat-parts';
import type { ChatMessagePage, ChatPart, ChatThreadPage } from '../model';
import { newChatThreadId } from '../core/runtime/thread-ids';
import { touchRunner, type RunnerAgent } from '../runner/service';
import type { AgUiEventBody, ChatMessageStatus } from './model';

export type ChatCatalogModel = {
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevels: string[];
  thinkingDefault: string | null;
};

// Chat with an external agent. The answer is produced by a runner on the operator's
// machine, so it cannot be generated in this process the way an internal agent's is:
// the member's message is stored, an empty answer is queued next to it, and the runner
// claims that answer, reports AG-UI events as its coding agent produces them, and
// closes it. The browser reads the same events back through the chat routes.
//
// The feed is deliberately separate from agent_run: a chat turn has no issue, is not
// retried after a failure the way an autonomous run is, and is claimed by a call that
// waits for work instead of polling for it.

// Tuning, env-overridable. The lease matches the run queue's: a coding agent can work
// for minutes, and the lease has to outlast a quiet stretch or the answer is handed to
// another runner mid-flight.
export const agentChatConfig = {
  leaseSeconds: () => intEnv('AGENT_CHAT_LEASE_SECONDS', 300),
  maxAttempts: () => intEnv('AGENT_CHAT_MAX_ATTEMPTS', 3),
  maxLiveTurnsPerThread: () => intEnv('AGENT_CHAT_MAX_LIVE_TURNS_PER_THREAD', 1),
  sendLimit: () => intEnv('AGENT_CHAT_SEND_LIMIT', 10),
  sendWindowSeconds: () => intEnv('AGENT_CHAT_SEND_WINDOW_SECONDS', 60),
  streamLimit: () => intEnv('AGENT_CHAT_STREAM_LIMIT', 30),
  streamWindowSeconds: () => intEnv('AGENT_CHAT_STREAM_WINDOW_SECONDS', 60),
  streamConcurrentLimit: () => intEnv('AGENT_CHAT_STREAM_CONCURRENT_LIMIT', 4),
  // How long a claim waits for work before it answers "nothing", and how often it looks
  // while it waits. The wait is what makes an answer start the moment it is sent.
  claimWaitMs: () => intEnv('AGENT_CHAT_CLAIM_WAIT_MS', 25_000),
  claimPollMs: () => intEnv('AGENT_CHAT_CLAIM_POLL_MS', 500),
  streamPollMs: () => intEnv('AGENT_CHAT_STREAM_POLL_MS', 300),
};

const PAGE_SIZE = 25;
const TITLE_LIMIT = 80;
// How much of an answer is kept as its text. A reply nobody would read to the end is
// still bounded, the way a run's output is.
const ANSWER_LIMIT = 100_000;
// Events handed out per read. A stream that falls behind catches up over several reads
// instead of loading everything an agent has said in one go.
const EVENT_PAGE = 500;

// The statuses an answer can still be worked on in: a runner claims either, and only
// these take events, heartbeats and a result.
const LIVE_STATUSES = ['pending', 'streaming'];

// The caller's conversations with one external agent: the favorites group, the hits of
// a search, or one page of the rest of them, newest first.
export async function listThreads(
  userId: string,
  agentId: number,
  opts: ThreadListOpts = {},
): Promise<ChatThreadPage> {
  if (opts.favorites) return favoriteThreads(userId, agentId);
  const term = searchTerm(opts.q);
  const page = opts.page ?? 0;
  const rows = term
    ? await searchThreads(userId, agentId, term, page)
    : await unstarredPage(userId, agentId, page);
  const hasMore = rows.length > PAGE_SIZE;
  const items = await summarize(hasMore ? rows.slice(0, PAGE_SIZE) : rows);
  return { items, nextPage: hasMore ? page + 1 : null };
}

// The conversations the caller starred, newest first, in one go.
async function favoriteThreads(userId: string, agentId: number): Promise<ChatThreadPage> {
  const rows = await db
    .select(threadColumns)
    .from(agentChatThread)
    .innerJoin(agentChatFavorite, eq(agentChatFavorite.threadId, agentChatThread.id))
    .where(
      and(
        eq(agentChatThread.agentId, agentId),
        eq(agentChatThread.userId, userId),
        eq(agentChatFavorite.userId, userId),
      ),
    )
    .orderBy(desc(agentChatThread.updatedAt))
    .limit(FAVORITES_LIMIT);
  return {
    items: await summarize(rows.map((row) => ({ ...row, favorite: true }))),
    nextPage: null,
  };
}

const threadColumns = {
  id: agentChatThread.id,
  title: agentChatThread.title,
  cliSessionId: agentChatThread.cliSessionId,
  model: agentChatThread.model,
  thinkingLevel: agentChatThread.thinkingLevel,
  createdAt: agentChatThread.createdAt,
  updatedAt: agentChatThread.updatedAt,
};

// One page of the conversations that are not starred, newest first, with one row over
// the page to tell whether there is another. The starred ones are left out because the
// group above the list already holds them.
async function unstarredPage(userId: string, agentId: number, page: number): Promise<ThreadRow[]> {
  const rows = await db
    .select(threadColumns)
    .from(agentChatThread)
    .where(
      and(
        eq(agentChatThread.agentId, agentId),
        eq(agentChatThread.userId, userId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(agentChatFavorite)
            .where(
              and(
                eq(agentChatFavorite.userId, userId),
                eq(agentChatFavorite.threadId, agentChatThread.id),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(agentChatThread.updatedAt))
    .limit(PAGE_SIZE + 1)
    .offset(page * PAGE_SIZE);
  return rows.map((row) => ({ ...row, favorite: false }));
}

// The conversations whose title or messages contain the term. A tool call is not
// searched: its arguments and its result are events of their own, and the message text
// holds only what the agent wrote.
//
// The snippet is cut from the newest matching message, in the database — an answer runs
// to ANSWER_LIMIT characters. The rank puts a title hit first, then the ones where the
// member's own message matches, then the ones matching only in the agent's reply.
async function searchThreads(
  userId: string,
  agentId: number,
  term: string,
  page: number,
): Promise<ThreadRow[]> {
  const like = likePattern(term);
  const snippet = snippetOf(sql`msg.content`, term);
  const rows = await db.execute(sql`
    SELECT t.id,
           t.title,
           t.cli_session_id AS "cliSessionId",
           t.model,
           t.thinking_level AS "thinkingLevel",
           t.created_at AS "createdAt",
           t.updated_at AS "updatedAt",
           f.thread_id IS NOT NULL AS favorite,
           hit.snippet,
           CASE
             WHEN t.title ILIKE ${like} THEN 1
             WHEN coalesce(hit.user_match, false) THEN 2
             ELSE 3
           END AS rank
    FROM agent_chat_thread t
    LEFT JOIN agent_chat_favorite f ON f.thread_id = t.id AND f.user_id = t.user_id
    LEFT JOIN LATERAL (
      SELECT bool_or(msg.role = 'user') AS user_match,
             (array_agg(${snippet} ORDER BY msg.id DESC))[1] AS snippet
      FROM agent_chat_message msg
      WHERE msg.thread_id = t.id AND msg.content ILIKE ${like}
    ) hit ON true
    WHERE t.agent_id = ${agentId}
      AND t.user_id = ${userId}
      AND (t.title ILIKE ${like} OR hit.snippet IS NOT NULL)
    ORDER BY rank, t.updated_at DESC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${page * PAGE_SIZE}
  `);
  return rows as unknown as ThreadRow[];
}

// Whether the conversation is the caller's own, and with this agent where the caller
// names one. False is a 404 for everything a thread is addressed by.
export async function ownsThread(
  threadId: string,
  userId: string,
  agentId?: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: agentChatThread.id })
    .from(agentChatThread)
    .where(
      and(
        eq(agentChatThread.id, threadId),
        eq(agentChatThread.userId, userId),
        ...(agentId != null ? [eq(agentChatThread.agentId, agentId)] : []),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// One page of a thread's transcript, oldest first within the page, page 0 being the
// newest — the shape the chat history loads backwards from. Null when the thread is not
// the caller's, which the route maps to a 404.
export async function getThreadMessages(
  threadId: string,
  userId: string,
  page = 0,
): Promise<ChatMessagePage | null> {
  if (!(await ownsThread(threadId, userId))) return null;
  const rows = await db
    .select()
    .from(agentChatMessage)
    .where(eq(agentChatMessage.threadId, threadId))
    .orderBy(desc(agentChatMessage.id))
    .limit(PAGE_SIZE + 1)
    .offset(page * PAGE_SIZE);
  const hasMore = rows.length > PAGE_SIZE;
  const turns = (hasMore ? rows.slice(0, PAGE_SIZE) : rows).reverse();
  const newest = page === 0 ? turns.at(-1) : undefined;
  const activeAnswer =
    newest?.role === 'assistant' && (newest.status === 'pending' || newest.status === 'streaming')
      ? {
          messageId: newest.id,
          status: newest.status as 'pending' | 'streaming',
          createdAt: iso(newest.createdAt),
        }
      : undefined;
  const answers = await readAnswerParts(
    turns.filter((r) => r.role === 'assistant').map((r) => r.id),
  );
  const items = turns
    .map((r) => ({
      id: String(r.id),
      role: r.role as 'user' | 'assistant',
      parts:
        r.role === 'assistant'
          ? (answers.get(r.id) ?? [])
          : [{ type: 'text' as const, text: r.content }],
      createdAt: iso(r.createdAt),
      ...(r.status === 'canceled' ? { stopped: true } : {}),
    }))
    // An answer whose runner has reported nothing yet has nothing to show; the browser
    // is streaming it.
    .filter((m) => m.parts.length > 0);
  return {
    items,
    nextPage: hasMore ? page + 1 : null,
    ...(activeAnswer && { activeAnswer }),
  };
}

// The event types a transcript is made of: the answer's text, and the tool calls with
// what each was given and answered. The lifecycle events say nothing the reader sees.
const TRANSCRIPT_EVENTS = [
  'TEXT_MESSAGE_CONTENT',
  'TOOL_CALL_START',
  'TOOL_CALL_ARGS',
  'TOOL_CALL_RESULT',
];

// Rebuilds each answer's parts from the events its runner reported. A call's start is
// what puts it between the stretches of text around it; its arguments and result are
// filled in afterwards, and stay unset for a runner that reports neither.
async function readAnswerParts(messageIds: number[]): Promise<Map<number, ChatPart[]>> {
  const parts = new Map<number, ChatPart[]>();
  if (messageIds.length === 0) return parts;
  const rows = await db
    .select({
      messageId: agentChatEvent.messageId,
      type: sql<string>`${agentChatEvent.payload}->>'type'`,
      delta: sql<string | null>`${agentChatEvent.payload}->>'delta'`,
      content: sql<string | null>`${agentChatEvent.payload}->>'content'`,
      toolCallId: sql<string | null>`${agentChatEvent.payload}->>'toolCallId'`,
      toolCallName: sql<string | null>`${agentChatEvent.payload}->>'toolCallName'`,
    })
    .from(agentChatEvent)
    .where(
      and(
        inArray(agentChatEvent.messageId, messageIds),
        inArray(sql`${agentChatEvent.payload}->>'type'`, TRANSCRIPT_EVENTS),
      ),
    )
    .orderBy(asc(agentChatEvent.id));
  // The call an answer's arguments and result belong to, by the id the runner gave it.
  const calls = new Map<string, Extract<ChatPart, { type: 'tool' }>>();
  for (const row of rows) {
    const message = parts.get(row.messageId) ?? [];
    parts.set(row.messageId, message);
    const callKey = `${row.messageId}:${row.toolCallId}`;
    switch (row.type) {
      case 'TEXT_MESSAGE_CONTENT':
        appendTextPart(message, row.delta ?? '');
        break;
      case 'TOOL_CALL_START': {
        const started = {
          type: 'tool' as const,
          toolCallId: row.toolCallId ?? '',
          toolName: row.toolCallName ?? '',
        };
        message.push(started);
        calls.set(callKey, started);
        break;
      }
      case 'TOOL_CALL_ARGS': {
        const call = calls.get(callKey);
        if (call && row.delta) call.args = (call.args ?? '') + row.delta;
        break;
      }
      case 'TOOL_CALL_RESULT': {
        const call = calls.get(callKey);
        if (call && row.content) call.result = row.content;
        break;
      }
    }
  }
  return parts;
}

// Renames one of the caller's conversations. False when it is not theirs, which the
// route maps to a 404.
export async function renameThread(
  threadId: string,
  userId: string,
  title: string,
): Promise<boolean> {
  const rows = await db
    .update(agentChatThread)
    .set({ title: title.slice(0, TITLE_LIMIT), updatedAt: new Date() })
    .where(and(eq(agentChatThread.id, threadId), eq(agentChatThread.userId, userId)))
    .returning({ id: agentChatThread.id });
  return rows.length > 0;
}

export async function deleteThread(threadId: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(agentChatThread)
    .where(and(eq(agentChatThread.id, threadId), eq(agentChatThread.userId, userId)))
    .returning({ id: agentChatThread.id });
  if (rows.length === 0) return false;
  await deleteContextUsage(threadId);
  await deleteFavorite(threadId);
  return true;
}

// Stores the member's message and queues the answer next to it. A thread id continues
// that conversation; without one a thread is created, titled after the message. Null
// when the thread named is not the caller's.
export async function sendMessage(input: {
  agentId: number;
  userId: string;
  prompt: string;
  threadId?: string;
  model?: string | null;
  thinkingLevel?: string | null;
}): Promise<{ threadId: string; messageId: number } | null> {
  const { agentId, userId, prompt } = input;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`agent-chat-send:${agentId}:${userId}`}, 0))`,
    );
    const [recent] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(agentChatMessage)
      .innerJoin(agentChatThread, eq(agentChatThread.id, agentChatMessage.threadId))
      .where(
        and(
          eq(agentChatMessage.agentId, agentId),
          eq(agentChatMessage.role, 'user'),
          eq(agentChatThread.userId, userId),
          sql`${agentChatMessage.createdAt} > now() - make_interval(secs => ${agentChatConfig.sendWindowSeconds()})`,
        ),
      );
    if (Number(recent?.count ?? 0) >= agentChatConfig.sendLimit()) {
      throw new HttpError(429, 'Too many chat messages. Wait before sending another.');
    }

    let threadId = input.threadId;
    const settings = await validateChatSettings(agentId, input.model, input.thinkingLevel);
    if (threadId) {
      const rows = await tx
        .select({ id: agentChatThread.id })
        .from(agentChatThread)
        .where(
          and(
            eq(agentChatThread.id, threadId),
            eq(agentChatThread.agentId, agentId),
            eq(agentChatThread.userId, userId),
          ),
        )
        .limit(1);
      if (!rows[0]) return null;
      const [live] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(agentChatMessage)
        .where(
          and(
            eq(agentChatMessage.threadId, threadId),
            eq(agentChatMessage.role, 'assistant'),
            inArray(agentChatMessage.status, LIVE_STATUSES),
          ),
        );
      if (Number(live?.count ?? 0) >= agentChatConfig.maxLiveTurnsPerThread()) {
        throw new HttpError(429, 'Wait for the current answer before sending another message.');
      }
      await tx
        .update(agentChatThread)
        .set({ updatedAt: new Date(), ...settings })
        .where(eq(agentChatThread.id, threadId));
    } else {
      threadId = newChatThreadId(agentId, userId);
      await tx.insert(agentChatThread).values({
        id: threadId,
        agentId,
        userId,
        title: prompt.slice(0, TITLE_LIMIT),
        ...settings,
      });
    }
    await tx.insert(agentChatMessage).values({
      threadId,
      agentId,
      role: 'user',
      content: prompt,
      status: 'success',
    });
    const answer = await tx
      .insert(agentChatMessage)
      .values({ threadId, agentId, role: 'assistant' })
      .returning({ id: agentChatMessage.id });
    return { threadId, messageId: answer[0].id };
  });
}

export interface ClaimedChat {
  id: number;
  threadId: string;
  prompt: string;
  systemPrompt: string;
  attempts: number;
  sessionId: string | null;
  model: string | null;
  thinkingLevel: string | null;
}

// The claim's raw row: the answer plus what the prompts are built from.
interface ClaimedRow {
  id: number;
  threadId: string;
  attempts: number;
  sessionId: string | null;
  model: string | null;
  thinkingLevel: string | null;
}

// Fails answers handed out too many times without a result, so a chat whose runner
// keeps dying ends visibly instead of being served forever. Called once per claim, not
// once per look at the feed: a claim waits for work and looks many times.
async function expireExhausted(agentId: number): Promise<void> {
  await db
    .update(agentChatMessage)
    .set({
      status: 'failed',
      lastError: 'Runner did not report a result',
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(agentChatMessage.agentId, agentId),
        inArray(agentChatMessage.status, LIVE_STATUSES),
        sql`${agentChatMessage.attempts} >= ${agentChatConfig.maxAttempts()}`,
        sql`${agentChatMessage.nextAttemptAt} <= now()`,
      ),
    );
}

// Waits for the agent's next answer to produce and hands it over under a lease, or null
// when none turns up in time. Waiting instead of polling is what makes an answer start
// the moment it is sent.
export async function claimNextMessage(agent: RunnerAgent): Promise<ClaimedChat | null> {
  await touchRunner(agent.id);
  await expireExhausted(agent.id);
  const deadline = Date.now() + agentChatConfig.claimWaitMs();
  for (;;) {
    const message = await claimMessage(agent);
    if (message) return message;
    if (Date.now() >= deadline) return null;
    await sleep(agentChatConfig.claimPollMs());
  }
}

// Takes the agent's next due answer, or null when it has none. Claiming clears whatever
// a previous attempt produced: the answer is generated again from the start, and the
// browser would otherwise read the abandoned half twice.
async function claimMessage(agent: RunnerAgent): Promise<ClaimedChat | null> {
  const rows = await db.execute(sql`
    UPDATE agent_chat_message m
    SET attempts = m.attempts + 1,
        status = 'streaming',
        content = '',
        started_at = coalesce(m.started_at, now()),
        next_attempt_at = now() + make_interval(secs => ${agentChatConfig.leaseSeconds()})
    WHERE m.id = (
      SELECT id FROM agent_chat_message q
      WHERE q.agent_id = ${agent.id}
        AND q.role = 'assistant'
        AND q.status IN ('pending', 'streaming')
        AND q.next_attempt_at <= now()
      ORDER BY q.next_attempt_at, q.id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING
      m.id,
      m.thread_id AS "threadId",
      m.attempts,
      (SELECT cli_session_id FROM agent_chat_thread t WHERE t.id = m.thread_id) AS "sessionId"
      , (SELECT model FROM agent_chat_thread t WHERE t.id = m.thread_id) AS "model"
      , (SELECT thinking_level FROM agent_chat_thread t WHERE t.id = m.thread_id) AS "thinkingLevel"
  `);
  const row = (rows as unknown as ClaimedRow[])[0];
  if (!row) return null;
  await db.delete(agentChatEvent).where(eq(agentChatEvent.messageId, row.id));
  const question = await readQuestion(row.threadId, row.id);
  return {
    id: row.id,
    threadId: row.threadId,
    prompt: question,
    systemPrompt: '',
    attempts: row.attempts,
    sessionId: row.sessionId,
    model: row.model,
    thinkingLevel: row.thinkingLevel,
  };
}

export async function publishChatCatalog(
  agentId: number,
  models: ChatCatalogModel[],
): Promise<void> {
  await db
    .insert(agentChatCatalog)
    .values({ agentId, models })
    .onConflictDoUpdate({
      target: agentChatCatalog.agentId,
      set: { models, updatedAt: new Date() },
    });
}

export async function readChatCatalog(agentId: number): Promise<{
  models: ChatCatalogModel[];
  updatedAt: string | null;
}> {
  const [row] = await db
    .select({
      models: agentChatCatalog.models,
      updatedAt: agentChatCatalog.updatedAt,
    })
    .from(agentChatCatalog)
    .where(eq(agentChatCatalog.agentId, agentId))
    .limit(1);
  return {
    models: (row?.models as ChatCatalogModel[] | undefined) ?? [],
    updatedAt: row ? iso(row.updatedAt) : null,
  };
}

async function validateChatSettings(
  agentId: number,
  model: string | null | undefined,
  thinkingLevel: string | null | undefined,
): Promise<{ model?: string | null; thinkingLevel?: string | null }> {
  if (model === undefined && thinkingLevel === undefined) return {};
  if (model === null) {
    if (thinkingLevel) throw new HttpError(400, 'A thinking level needs a model');
    return { model: null, thinkingLevel: null };
  }
  const catalog = await readChatCatalog(agentId);
  const selected = catalog.models.find((entry) => entry.id === model);
  if (!selected) throw new HttpError(400, 'The selected model is not available');
  if (thinkingLevel && !selected.thinkingLevels.includes(thinkingLevel)) {
    throw new HttpError(400, 'The selected thinking level is not available for this model');
  }
  return { model, thinkingLevel: thinkingLevel ?? null };
}

// Binds a thread to the session its runner started, addressed through the answer being
// produced so the runner needs no separate lookup. The first report wins: a retry of the
// same answer starts a new session, and rebinding would strand the one already recorded.
async function readQuestion(threadId: string, beforeMessageId: number): Promise<string> {
  const rows = await db
    .select({ content: agentChatMessage.content })
    .from(agentChatMessage)
    .where(
      and(
        eq(agentChatMessage.threadId, threadId),
        sql`${agentChatMessage.id} < ${beforeMessageId}`,
        sql`length(${agentChatMessage.content}) > 0`,
      ),
    )
    .orderBy(desc(agentChatMessage.id))
    .limit(1);
  return rows[0]?.content ?? '';
}

// When a claimed answer falls back to the feed unless the runner reports again.
function leaseUntil() {
  return sql`now() + make_interval(secs => ${agentChatConfig.leaseSeconds()})`;
}

// The answer a runner call addresses: this agent's, and not finished yet.
function liveAnswer(agentId: number, messageId: number) {
  return and(
    eq(agentChatMessage.id, messageId),
    eq(agentChatMessage.agentId, agentId),
    inArray(agentChatMessage.status, LIVE_STATUSES),
  );
}

// Whether the answer a runner call addressed was stopped from the chat, as opposed to
// not being this agent's or having ended some other way.
async function wasCanceled(agentId: number, messageId: number): Promise<boolean> {
  const rows = await db
    .select({ status: agentChatMessage.status })
    .from(agentChatMessage)
    .where(and(eq(agentChatMessage.id, messageId), eq(agentChatMessage.agentId, agentId)))
    .limit(1);
  return rows[0]?.status === 'canceled';
}

// Records what the runner reported. Text deltas also grow the answer's own text, so the
// transcript reads correctly even if the browser never watched the stream.
export async function appendEvents(
  agentId: number,
  messageId: number,
  events: AgUiEventBody[],
  sessionId?: string,
): Promise<ChatAck | null> {
  const stored = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(agentChatMessage)
      .set({
        content: sql`left(${agentChatMessage.content} || ${textOf(events)}, ${ANSWER_LIMIT})`,
        nextAttemptAt: leaseUntil(),
      })
      .where(liveAnswer(agentId, messageId))
      .returning({ threadId: agentChatMessage.threadId });
    if (!claimed[0]) return false;

    await tx.insert(agentChatEvent).values(events.map((event) => ({ messageId, payload: event })));
    if (sessionId) {
      // The session id and the first events must become durable together. Otherwise a
      // process crash between two writes can leave a completed transcript that starts a
      // new Hermes session on its next turn.
      await tx
        .update(agentChatThread)
        .set({ cliSessionId: sessionId })
        .where(
          and(
            eq(agentChatThread.id, claimed[0].threadId),
            sql`${agentChatThread.cliSessionId} IS NULL`,
          ),
        );
    }
    return true;
  });
  if (!stored) return (await wasCanceled(agentId, messageId)) ? { canceled: true } : null;
  return { canceled: false };
}

function textOf(events: AgUiEventBody[]): string {
  return events.map((e) => (e.type === 'TEXT_MESSAGE_CONTENT' ? e.delta : '')).join('');
}

export async function heartbeatMessage(
  agentId: number,
  messageId: number,
): Promise<ChatAck | null> {
  await touchRunner(agentId);
  const rows = await db
    .update(agentChatMessage)
    .set({ nextAttemptAt: leaseUntil() })
    .where(liveAnswer(agentId, messageId))
    .returning({ id: agentChatMessage.id });
  if (rows.length > 0) return { canceled: false };
  return (await wasCanceled(agentId, messageId)) ? { canceled: true } : null;
}

// Stops the answer on the member's word. Terminal, like a failure: no claim, retry or
// lease extension looks at a canceled row again, so the runner learns of the stop on
// its next report and nothing hands the answer out afterwards. True once the answer is
// the caller's, whether or not it was still running — pressing stop as it ends is not
// an error.
export async function cancelMessage(
  messageId: number,
  agentId: number,
  userId: string,
): Promise<boolean> {
  const owned = await db
    .select({ id: agentChatMessage.id })
    .from(agentChatMessage)
    .innerJoin(agentChatThread, eq(agentChatThread.id, agentChatMessage.threadId))
    .where(
      and(
        eq(agentChatMessage.id, messageId),
        eq(agentChatMessage.agentId, agentId),
        eq(agentChatThread.userId, userId),
      ),
    )
    .limit(1);
  if (!owned[0]) return false;
  await db
    .update(agentChatMessage)
    .set({ status: 'canceled', finishedAt: new Date() })
    .where(liveAnswer(agentId, messageId));
  return true;
}

// Closes the answer. A failure is terminal: the runner ran the command and it failed,
// so serving the same answer again would only repeat it.
export async function finishMessage(
  agentId: number,
  messageId: number,
  result: {
    status: 'success' | 'failed';
    error?: string | null;
    usage?: ContextUsage | null;
  },
): Promise<boolean> {
  await touchRunner(agentId);
  const rows = await db
    .update(agentChatMessage)
    .set({
      status: result.status,
      lastError:
        result.status === 'failed' ? (result.error?.slice(0, 500) ?? 'Answer failed') : null,
      finishedAt: new Date(),
    })
    .where(liveAnswer(agentId, messageId))
    .returning({
      id: agentChatMessage.id,
      threadId: agentChatMessage.threadId,
    });
  if (rows.length > 0) {
    // Undefined is a runner that said nothing about the context — an older one, or a
    // command that reports no counts at all — and the thread keeps the number it has.
    if (result.usage !== undefined) {
      await recordContextUsage(rows[0].threadId, agentId, result.usage);
    }
    return true;
  }
  // Stopped from the chat while the command was ending: the answer is already closed,
  // so there is nothing to record and nothing wrong.
  return wasCanceled(agentId, messageId);
}

// What a runner is told on every report: whether the answer it is producing was stopped.
export interface ChatAck {
  canceled: boolean;
}

export interface ChatEventPage {
  items: { id: number; event: AgUiEventBody }[];
  status: ChatMessageStatus;
  error: string | null;
  nextCursor: number | null;
  // Whether reading again from nextCursor returns more of what is already stored, as
  // opposed to waiting for the agent to say something new.
  hasMore: boolean;
}

// The answer's events after the given cursor, with the answer's own state so a reader
// knows whether more are coming. Null when the answer is not the caller's.
export async function readEvents(
  messageId: number,
  agentId: number,
  userId: string,
  after = 0,
): Promise<ChatEventPage | null> {
  const rows = await db
    .select({
      status: agentChatMessage.status,
      lastError: agentChatMessage.lastError,
    })
    .from(agentChatMessage)
    .innerJoin(agentChatThread, eq(agentChatThread.id, agentChatMessage.threadId))
    .where(
      and(
        eq(agentChatMessage.id, messageId),
        eq(agentChatMessage.agentId, agentId),
        eq(agentChatThread.userId, userId),
      ),
    )
    .limit(1);
  const message = rows[0];
  if (!message) return null;
  const eventRows = await db
    .select({ id: agentChatEvent.id, payload: agentChatEvent.payload })
    .from(agentChatEvent)
    .where(and(eq(agentChatEvent.messageId, messageId), gt(agentChatEvent.id, after)))
    .orderBy(asc(agentChatEvent.id))
    .limit(EVENT_PAGE + 1);
  const hasMore = eventRows.length > EVENT_PAGE;
  const events = hasMore ? eventRows.slice(0, EVENT_PAGE) : eventRows;
  return {
    items: events.map((e) => ({ id: e.id, event: e.payload as AgUiEventBody })),
    status: message.status as ChatMessageStatus,
    error: message.lastError,
    nextCursor: events.at(-1)?.id ?? null,
    hasMore,
  };
}
