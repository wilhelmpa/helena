import {
  db,
  agentChatCatalog,
  agentChatEvent,
  agentChatFavorite,
  agentChatMessage,
  agentChatThread,
  aiAgent,
  user,
} from '@repo/db';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, notExists, sql } from 'drizzle-orm';
import type { AutopilotLevel } from '@helena/policy';
import { resolveLevel } from '#modules/autopilot/levels';
import { assertProjectNotHeld } from '#modules/autopilot/service';
import { enforceBudgets } from '#modules/autopilot/budgets';
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
import { appendReasoningPart, appendTextPart } from '../chat-parts';
import type { ChatMessagePage, ChatPart, ChatThreadPage } from '../model';
import { newChatThreadId } from '../core/runtime/thread-ids';
import { touchRunner, type RunnerAgent } from '../runner/service';
import { modelCheckOf, type RunModelReport } from '../runtime-sync/model-check';
import type { AgUiEventBody, ChatMessageStatus } from './model';
import { questionText, imagePaths, type ChatAttachment } from './attachments';
import {
  buildTree,
  latestLeaf,
  newestMessage,
  pathTo,
  siblingsOf,
  type MessageTree,
} from './branches';

export type ChatCatalogModel = {
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevels: string[];
  thinkingDefault: string | null;
  provider?: string;
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
  streamPollMs: () => intEnv('AGENT_CHAT_STREAM_POLL_MS', 100),
  historyMessages: () => intEnv('AGENT_CHAT_HISTORY_MESSAGES', 20),
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
const isLive = (status: string) => LIVE_STATUSES.includes(status);

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
        isNull(agentChatThread.deletedAt),
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
        isNull(agentChatThread.deletedAt),
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
      AND t.deleted_at IS NULL
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

// The skeleton of a thread's messages, from which its branches are read.
export async function readTree(threadId: string): Promise<MessageTree> {
  const rows = await db
    .select({ id: agentChatMessage.id, parentId: agentChatMessage.parentId })
    .from(agentChatMessage)
    .where(eq(agentChatMessage.threadId, threadId));
  return buildTree(rows);
}

// The shown branch of a thread, oldest first.
async function shownPath(threadId: string): Promise<{ tree: MessageTree; path: number[] }> {
  const [thread] = await db
    .select({ activeMessageId: agentChatThread.activeMessageId })
    .from(agentChatThread)
    .where(eq(agentChatThread.id, threadId));
  const tree = await readTree(threadId);
  const leaf =
    thread?.activeMessageId != null && tree.has(thread.activeMessageId)
      ? thread.activeMessageId
      : newestMessage(tree);
  return { tree, path: pathTo(tree, leaf) };
}

// One page of the shown branch of a thread, oldest first within the page, page 0 being
// the newest — the shape the chat history loads backwards from. Null when the thread is
// not the caller's, which the route maps to a 404.
export async function getThreadMessages(
  threadId: string,
  userId: string,
  page = 0,
): Promise<ChatMessagePage | null> {
  if (!(await ownsThread(threadId, userId))) return null;
  const { tree, path } = await shownPath(threadId);
  const end = path.length - page * PAGE_SIZE;
  const ids = path.slice(Math.max(0, end - PAGE_SIZE), Math.max(0, end));
  const rows =
    ids.length > 0
      ? await db.select().from(agentChatMessage).where(inArray(agentChatMessage.id, ids))
      : [];
  const turns = ids.flatMap((id) => rows.filter((row) => row.id === id));
  const newest = page === 0 ? turns.at(-1) : undefined;
  const activeAnswer =
    newest?.role === 'assistant' && isLive(newest.status)
      ? {
          messageId: newest.id,
          agentId: newest.agentId,
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
      parentId: r.parentId == null ? null : String(r.parentId),
      siblingIds: siblingsOf(tree, r.id).map(String),
      agentId: r.agentId,
      ...(r.attachments ? { attachments: r.attachments as ChatAttachment[] } : {}),
      ...(r.role === 'assistant' && {
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        durationMs:
          r.startedAt && r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
      }),
      ...(r.status === 'canceled' ? { stopped: true } : {}),
      ...(r.status === 'failed'
        ? { error: r.lastError ?? 'The agent did not finish the answer' }
        : {}),
    }))
    // An answer whose runner has reported nothing yet has nothing to show; the browser
    // is streaming it. A failed one is kept for its error, so it can be tried again.
    .filter((m) => m.parts.length > 0 || m.error);
  return {
    items,
    nextPage: end - PAGE_SIZE > 0 ? page + 1 : null,
    ...(activeAnswer && { activeAnswer }),
  };
}

// The event types a transcript is made of: the answer's text, the model's reasoning, and
// the tool calls with what each was given and answered. The lifecycle events say nothing
// the reader sees.
const TRANSCRIPT_EVENTS = [
  'TEXT_MESSAGE_CONTENT',
  'THINKING_TEXT_MESSAGE_CONTENT',
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
      isError: sql<boolean | null>`(${agentChatEvent.payload}->>'isError')::boolean`,
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
      case 'THINKING_TEXT_MESSAGE_CONTENT':
        appendReasoningPart(message, row.delta ?? '');
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
        if (call && row.isError) call.isError = true;
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Refuses a send the member is making too fast. Held under the member's lock on the
// agent, so two sends in the same moment are counted one after the other.
async function assertSendRate(tx: Tx, agentId: number, userId: string) {
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
        eq(agentChatThread.userId, userId),
        // Every send and every retry queues one answer, so the answers count both.
        eq(agentChatMessage.role, 'assistant'),
        sql`${agentChatMessage.createdAt} > now() - make_interval(secs => ${agentChatConfig.sendWindowSeconds()})`,
      ),
    );
  if (Number(recent?.count ?? 0) >= agentChatConfig.sendLimit()) {
    throw new HttpError(429, 'Too many chat messages. Wait before sending another.');
  }
}

// Refuses a send into a thread whose answer is still being produced.
async function assertNoLiveAnswer(tx: Tx, threadId: string) {
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
}

// Refuses a send once the member already has maxConcurrentChats of this agent's
// answers actively streaming across every thread — the agent-level setting the owner
// configures in Helena (ai_agent.max_concurrent_chats, default 3), not an env ceiling.
// Only 'streaming' counts, not 'pending': a member may queue as many questions as the
// send-rate limit allows (assertSendRate), the runner works through them one lease at
// a time, and it is the runner actually producing several answers in parallel — not a
// pile of queued, unclaimed questions — that this setting bounds. Checked in the same
// transaction as assertNoLiveAnswer so a burst of sends cannot all pass the count at
// once.
async function assertConcurrencyLimit(
  tx: Tx,
  agentId: number,
  userId: string,
  maxConcurrentChats: number,
) {
  const [live] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(agentChatMessage)
    .innerJoin(agentChatThread, eq(agentChatThread.id, agentChatMessage.threadId))
    .where(
      and(
        eq(agentChatMessage.agentId, agentId),
        eq(agentChatThread.userId, userId),
        eq(agentChatMessage.role, 'assistant'),
        eq(agentChatMessage.status, 'streaming'),
      ),
    );
  if (Number(live?.count ?? 0) >= maxConcurrentChats) {
    throw new HttpError(
      409,
      `This agent is already answering ${maxConcurrentChats} of your chats. Wait for one to ` +
        'finish before sending another.',
    );
  }
}

async function assertNotPaused(agentId: number) {
  const [paused] = await db
    .select({ reason: aiAgent.pauseReason })
    .from(aiAgent)
    .where(and(eq(aiAgent.id, agentId), isNotNull(aiAgent.pausedAt)));
  if (paused)
    throw new HttpError(409, `The agent is paused${paused.reason ? `: ${paused.reason}` : '.'}`);
}

// The caller's live thread in the scope a route addresses: a project's chat, or Home
// with no project. Null when it is someone else's, of another scope, or deleted.
async function scopedThread(tx: Tx, threadId: string, userId: string, projectId: number | null) {
  const [thread] = await tx
    .select({ id: agentChatThread.id, activeMessageId: agentChatThread.activeMessageId })
    .from(agentChatThread)
    .where(
      and(
        eq(agentChatThread.id, threadId),
        eq(agentChatThread.userId, userId),
        projectId == null
          ? isNull(agentChatThread.projectId)
          : eq(agentChatThread.projectId, projectId),
        isNull(agentChatThread.deletedAt),
      ),
    )
    .for('update');
  return thread ?? null;
}

// Stores the member's message and queues the answer next to it. A thread id continues
// that conversation; without one a thread is created in the route's scope, titled
// after the message. The question follows `parentId` — the message the member answered
// from, or null for the first message of an edited conversation — and otherwise the
// message the thread shows last. The agent answering may be another one than the
// thread's own: an agent addressed with @ answers in the same thread.
//
// Null when the thread named is not the caller's. A paused agent takes no message: the
// member would wait for an answer that does not come.
export async function sendMessage(input: {
  agentId: number;
  userId: string;
  projectId: number | null;
  prompt: string;
  threadId?: string;
  parentId?: number | null;
  attachments?: ChatAttachment[];
  model?: string | null;
  thinkingLevel?: string | null;
  maxConcurrentChats: number;
}): Promise<{ threadId: string; messageId: number; userMessageId: number } | null> {
  const { agentId, userId, prompt } = input;
  await assertNotPaused(agentId);
  await assertProjectNotHeld(input.projectId);
  return db.transaction(async (tx) => {
    await assertSendRate(tx, agentId, userId);
    await assertConcurrencyLimit(tx, agentId, userId, input.maxConcurrentChats);
    let threadId = input.threadId;
    let parentId: number | null = null;
    const settings = await validateChatSettings(agentId, input.model, input.thinkingLevel);
    if (threadId) {
      const thread = await scopedThread(tx, threadId, userId, input.projectId);
      if (!thread) return null;
      await assertNoLiveAnswer(tx, threadId);
      parentId = input.parentId === undefined ? thread.activeMessageId : input.parentId;
      if (parentId != null && !(await isMessageOf(tx, threadId, parentId))) {
        throw new HttpError(400, 'The message to continue from is not part of this chat');
      }
    } else {
      threadId = newChatThreadId(agentId, userId);
      await tx.insert(agentChatThread).values({
        id: threadId,
        agentId,
        userId,
        projectId: input.projectId,
        title: prompt.slice(0, TITLE_LIMIT),
        ...settings,
      });
    }
    const [question] = await tx
      .insert(agentChatMessage)
      .values({
        threadId,
        agentId,
        parentId,
        role: 'user',
        content: prompt,
        status: 'success',
        attachments: input.attachments?.length ? input.attachments : null,
      })
      .returning({ id: agentChatMessage.id });
    const [answer] = await tx
      .insert(agentChatMessage)
      .values({ threadId, agentId, parentId: question.id, role: 'assistant' })
      .returning({ id: agentChatMessage.id });
    await tx
      .update(agentChatThread)
      .set({ activeMessageId: answer.id, archivedAt: null, updatedAt: new Date(), ...settings })
      .where(eq(agentChatThread.id, threadId));
    return { threadId, messageId: answer.id, userMessageId: question.id };
  });
}

// Queues another answer to a question of the thread, next to the answers it already
// has. The new answer becomes the one the thread shows.
export async function retryMessage(input: {
  agentId: number;
  userId: string;
  projectId: number | null;
  threadId: string;
  questionId: number;
  maxConcurrentChats: number;
}): Promise<{ threadId: string; messageId: number } | null> {
  await assertNotPaused(input.agentId);
  return db.transaction(async (tx) => {
    await assertSendRate(tx, input.agentId, input.userId);
    await assertConcurrencyLimit(tx, input.agentId, input.userId, input.maxConcurrentChats);
    const thread = await scopedThread(tx, input.threadId, input.userId, input.projectId);
    if (!thread) return null;
    await assertNoLiveAnswer(tx, input.threadId);
    const [question] = await tx
      .select({ role: agentChatMessage.role })
      .from(agentChatMessage)
      .where(
        and(
          eq(agentChatMessage.id, input.questionId),
          eq(agentChatMessage.threadId, input.threadId),
        ),
      );
    if (question?.role !== 'user') {
      throw new HttpError(400, 'Only a question of this chat can be answered again');
    }
    const [answer] = await tx
      .insert(agentChatMessage)
      .values({
        threadId: input.threadId,
        agentId: input.agentId,
        parentId: input.questionId,
        role: 'assistant',
      })
      .returning({ id: agentChatMessage.id });
    await tx
      .update(agentChatThread)
      .set({ activeMessageId: answer.id, updatedAt: new Date() })
      .where(eq(agentChatThread.id, input.threadId));
    return { threadId: input.threadId, messageId: answer.id };
  });
}

async function isMessageOf(tx: Tx, threadId: string, messageId: number): Promise<boolean> {
  const rows = await tx
    .select({ id: agentChatMessage.id })
    .from(agentChatMessage)
    .where(and(eq(agentChatMessage.id, messageId), eq(agentChatMessage.threadId, threadId)));
  return rows.length > 0;
}

// Shows another version of a message: the thread then shows that version and the newest
// conversation that continued from it. False when the thread or the message is not the
// caller's.
export async function showVersion(
  threadId: string,
  userId: string,
  messageId: number,
): Promise<boolean> {
  if (!(await ownsThread(threadId, userId))) return false;
  const tree = await readTree(threadId);
  if (!tree.has(messageId)) return false;
  await db
    .update(agentChatThread)
    .set({ activeMessageId: latestLeaf(tree, messageId) })
    .where(eq(agentChatThread.id, threadId));
  return true;
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
  images: string[];
  autopilotLevel: AutopilotLevel;
}

// The claim's raw row: the answer plus what the prompts are built from.
interface ClaimedRow {
  id: number;
  threadId: string;
  attempts: number;
  model: string | null;
  thinkingLevel: string | null;
  projectId: number | null;
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

// Takes the agent's next due answer, or null when it has none. A paused agent's answers
// wait. Claiming clears whatever a previous attempt produced: the answer is generated
// again from the start, and the browser would otherwise read the abandoned half twice.
async function claimMessage(agent: RunnerAgent): Promise<ClaimedChat | null> {
  const rows = await db.execute(sql`
    UPDATE agent_chat_message m
    SET attempts = m.attempts + 1,
        status = 'streaming',
        content = '',
        session_id = NULL,
        started_at = coalesce(m.started_at, now()),
        next_attempt_at = now() + make_interval(secs => ${agentChatConfig.leaseSeconds()})
    WHERE m.id = (
      SELECT id FROM agent_chat_message q
      WHERE q.agent_id = ${agent.id}
        AND q.role = 'assistant'
        AND q.status IN ('pending', 'streaming')
        AND q.next_attempt_at <= now()
        AND (SELECT paused_at FROM ai_agent a WHERE a.id = q.agent_id) IS NULL
      ORDER BY q.next_attempt_at, q.id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING
      m.id,
      m.thread_id AS "threadId",
      m.attempts,
      (SELECT model FROM agent_chat_thread t WHERE t.id = m.thread_id) AS "model",
      (SELECT thinking_level FROM agent_chat_thread t WHERE t.id = m.thread_id) AS "thinkingLevel",
      (SELECT project_id FROM agent_chat_thread t WHERE t.id = m.thread_id) AS "projectId"
  `);
  const row = (rows as unknown as ClaimedRow[])[0];
  if (!row) return null;
  await db.delete(agentChatEvent).where(eq(agentChatEvent.messageId, row.id));
  // The agent's instructions reach Hermes through the SOUL.md of its profile, so the
  // message carries no system prompt. A branch whose last answer is the last one of a
  // live session needs only the new question; any other gets the earlier turns of the
  // branch, which that session does not hold.
  const history = await readBranch(row.threadId, row.id);
  const question = history.pop();
  const sessionId = await resumableSession(row.threadId, history, agent.id);
  // A thread without its own model follows the agent's settings, the way a run does.
  const settings = row.model
    ? { model: row.model, thinkingLevel: row.thinkingLevel }
    : { model: agent.model, thinkingLevel: agent.thinkingLevel };
  await db
    .update(agentChatMessage)
    .set({ model: settings.model, sessionId })
    .where(eq(agentChatMessage.id, row.id));
  const attachments = (question?.attachments as ChatAttachment[] | null) ?? [];
  const text = questionText(question?.content ?? '', attachments);
  const earlier = sessionId ? [] : history.slice(-agentChatConfig.historyMessages());
  return {
    id: row.id,
    threadId: row.threadId,
    prompt: earlier.length > 0 ? frameChatPrompt(earlier, text, agent.id) : text,
    systemPrompt: '',
    attempts: row.attempts,
    sessionId,
    ...settings,
    images: imagePaths(attachments),
    autopilotLevel: (await resolveLevel(agent.id, row.projectId)).level,
  };
}

type BranchTurn = typeof agentChatMessage.$inferSelect & { agentName: string };

// The turns of the branch that leads to the claimed answer, oldest first, without the
// answer itself: the last of them is the question being answered. Turns with nothing to
// say — an answer that failed before writing — are left out.
async function readBranch(threadId: string, answerId: number): Promise<BranchTurn[]> {
  const tree = await readTree(threadId);
  const ids = pathTo(tree, answerId).slice(0, -1);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ message: agentChatMessage, agentName: user.name })
    .from(agentChatMessage)
    .innerJoin(aiAgent, eq(aiAgent.id, agentChatMessage.agentId))
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .where(inArray(agentChatMessage.id, ids));
  return ids.flatMap((id) => {
    const row = rows.find((candidate) => candidate.message.id === id);
    if (!row || (row.message.role === 'assistant' && !row.message.content)) return [];
    return [{ ...row.message, agentName: row.agentName }];
  });
}

// The session to resume: the one the branch's last answer ran in, when that answer was
// this agent's and the last one produced in the session. Otherwise the session holds a
// conversation other than this branch, and a fresh one is started.
async function resumableSession(
  threadId: string,
  history: BranchTurn[],
  agentId: number,
): Promise<string | null> {
  const last = [...history].reverse().find((turn) => turn.role === 'assistant');
  if (!last?.sessionId || last.agentId !== agentId) return null;
  const [latest] = await db
    .select({ id: sql<number>`max(${agentChatMessage.id})` })
    .from(agentChatMessage)
    .where(
      and(eq(agentChatMessage.threadId, threadId), eq(agentChatMessage.sessionId, last.sessionId)),
    );
  return latest?.id === last.id ? last.sessionId : null;
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

// A template runs nowhere, so no runner publishes a catalog of its own. Its model and
// reasoning are picked for the copies it will have, which run on the team's runners:
// it offers every model those runners published, newest catalog first.
export async function readTeamChatCatalog(teamId: number): Promise<{
  models: ChatCatalogModel[];
  updatedAt: string | null;
}> {
  const rows = await db
    .select({ models: agentChatCatalog.models, updatedAt: agentChatCatalog.updatedAt })
    .from(agentChatCatalog)
    .innerJoin(aiAgent, eq(aiAgent.id, agentChatCatalog.agentId))
    .where(and(eq(aiAgent.teamId, teamId), eq(aiAgent.template, false)))
    .orderBy(desc(agentChatCatalog.updatedAt));
  const models = new Map<string, ChatCatalogModel>();
  for (const row of rows) {
    for (const model of (row.models as ChatCatalogModel[] | null) ?? []) {
      if (!models.has(model.id)) models.set(model.id, model);
    }
  }
  return { models: [...models.values()], updatedAt: rows[0] ? iso(rows[0].updatedAt) : null };
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

// The earlier turns ahead of the question, for a session that does not hold them. An
// answer another agent gave is named by that agent.
function frameChatPrompt(history: BranchTurn[], question: string, agentId: number): string {
  const lines = ['Earlier in this conversation:', ''];
  for (const turn of history) {
    const speaker =
      turn.role === 'user' ? 'Person' : turn.agentId === agentId ? 'You' : turn.agentName;
    lines.push(
      `${speaker}: ${questionText(turn.content, turn.attachments as ChatAttachment[] | null)}`,
      '',
    );
  }
  lines.push('The person writes:', '', question);
  return lines.join('\n');
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
        ...(sessionId && { sessionId: sql`coalesce(${agentChatMessage.sessionId}, ${sessionId})` }),
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
    sessionLost?: boolean;
    model?: string;
    runtime?: RunModelReport;
  },
): Promise<boolean> {
  await touchRunner(agentId);
  const check = modelCheckOf(result.runtime);
  // What the session really ran on wins over what the command named on its first line.
  const model = result.runtime?.used?.model ?? result.model;
  if (result.status === 'failed' && result.sessionLost)
    return requeueWithoutSession(agentId, messageId);
  const rows = await db
    .update(agentChatMessage)
    .set({
      status: result.status,
      lastError:
        result.status === 'failed' ? (result.error?.slice(0, 500) ?? 'Answer failed') : null,
      finishedAt: new Date(),
      ...(model && { model: model.slice(0, 200) }),
      ...(check && { modelCheck: check }),
      ...(result.usage && {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      }),
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
    // What the answer spent counts against the agent's budgets (and the project's): one
    // used up stops the agent here, as a run's result does.
    const [thread] = await db
      .select({ projectId: agentChatThread.projectId })
      .from(agentChatThread)
      .where(eq(agentChatThread.id, rows[0].threadId));
    await enforceBudgets(agentId, thread?.projectId ?? null, null);
    return true;
  }
  // Stopped from the chat while the command was ending: the answer is already closed,
  // so there is nothing to record and nothing wrong.
  return wasCanceled(agentId, messageId);
}

// The session a thread was bound to no longer exists on the runner's machine. The thread
// is unbound and the answer handed out again at once, so the next claim sends the
// conversation to a fresh session. The attempts it already used still count, which ends
// a thread whose runner keeps failing.
async function requeueWithoutSession(agentId: number, messageId: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [lost] = await tx
      .select({ sessionId: agentChatMessage.sessionId })
      .from(agentChatMessage)
      .where(liveAnswer(agentId, messageId));
    const rows = await tx
      .update(agentChatMessage)
      .set({ status: 'pending', nextAttemptAt: new Date() })
      .where(liveAnswer(agentId, messageId))
      .returning({ threadId: agentChatMessage.threadId });
    if (rows.length === 0) return wasCanceled(agentId, messageId);
    const threadId = rows[0].threadId;
    if (lost?.sessionId) {
      await tx
        .update(agentChatMessage)
        .set({ sessionId: null })
        .where(
          and(
            eq(agentChatMessage.threadId, threadId),
            eq(agentChatMessage.sessionId, lost.sessionId),
          ),
        );
    }
    await tx
      .update(agentChatThread)
      .set({ cliSessionId: null })
      .where(eq(agentChatThread.id, threadId));
    return true;
  });
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
