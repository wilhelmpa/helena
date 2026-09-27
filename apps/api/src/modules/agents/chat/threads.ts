import { db, agentChatThread } from '@repo/db';
import { and, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { checkPermission, type AuthUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { getIssueProjectId } from '#modules/issues/service';
import { addFavorite, removeFavorite } from '../chat-favorites';
import { likePattern, searchTerm, snippetOf, type ThreadMatch } from '../chat-history';
import { deleteThread } from './service';

// Every chat of a member across the agents, the way the chat list shows them: Home lists
// all of them, a project its own. Only the member's own chats are listed, and a
// project's chats only while the member is in the project.

export type ChatListView = 'active' | 'archived' | 'trash';

export interface ChatSummary {
  id: string;
  title: string | null;
  agent: { id: number; name: string; username: string };
  teamId: number;
  project: { id: number; key: string; name: string } | null;
  issue: { id: number; identifier: string; title: string } | null;
  pinned: boolean;
  running: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  snippet?: string;
  match?: ThreadMatch;
  createdAt: string;
  updatedAt: string;
  // The model and reasoning level the chat was last sent with (null: the agent's own
  // default), and the coding-agent session an external agent's runner keeps for it —
  // so reopening a chat restores its settings and can name the session to resume.
  model: string | null;
  thinkingLevel: string | null;
  cliSessionId: string | null;
  jevFirstStage: 'inherit' | 'on' | 'off';
  // The context size after the chat's last completed answer (see the agent_chat_usage
  // comment in the schema): absent while no answer has completed, null where the agent
  // reports no usable counts. The `/usage` command is the one reader of this on a
  // single chat; the list itself does not show it.
  contextTokens?: number | null;
}

export interface ChatFilter {
  projectId?: number;
  agentId?: number;
  issueId?: number;
  threadId?: string;
  q?: string;
  // `any` reads a chat wherever it is listed.
  view?: ChatListView | 'any';
}

interface ChatRow {
  id: string;
  title: string | null;
  agentId: number;
  agentName: string;
  agentUsername: string;
  teamId: number;
  projectId: number | null;
  projectKey: string | null;
  projectName: string | null;
  issueId: number | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  pinned: boolean;
  running: boolean;
  archivedAt: Date | string | null;
  deletedAt: Date | string | null;
  snippet: string | null;
  rank: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  model: string | null;
  thinkingLevel: string | null;
  cliSessionId: string | null;
  jevFirstStage: 'inherit' | 'on' | 'off';
  hasUsage: boolean;
  contextTokens: number | null;
}

const iso = (value: Date | string) => new Date(value).toISOString();

function summary(row: ChatRow): ChatSummary {
  return {
    id: row.id,
    title: row.title || null,
    agent: { id: row.agentId, name: row.agentName, username: row.agentUsername },
    teamId: row.teamId,
    project:
      row.projectId != null
        ? { id: row.projectId, key: row.projectKey!, name: row.projectName! }
        : null,
    issue:
      row.issueId != null
        ? { id: row.issueId, identifier: row.issueIdentifier!, title: row.issueTitle! }
        : null,
    pinned: row.pinned,
    running: row.running,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    deletedAt: row.deletedAt ? iso(row.deletedAt) : null,
    ...(row.snippet ? { snippet: row.snippet } : {}),
    ...(row.rank != null ? { match: (['title', 'user', 'assistant'] as const)[row.rank - 1] } : {}),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    model: row.model ?? null,
    thinkingLevel: row.thinkingLevel ?? null,
    cliSessionId: row.cliSessionId ?? null,
    jevFirstStage: row.jevFirstStage,
    ...(row.hasUsage ? { contextTokens: row.contextTokens } : {}),
  };
}

// The part of the query the list and its count share. A search adds the newest matching
// message of the chat, from any of its branches; the rank puts a title hit first, then a
// hit in the member's own words, then one only in an answer.
function chatQuery(userId: string, filter: ChatFilter) {
  const term = searchTerm(filter.q);
  const like = term ? likePattern(term) : null;
  const view = filter.view ?? 'active';
  const conditions: SQL[] = [
    sql`t.user_id = ${userId}`,
    sql`(t.project_id IS NULL OR EXISTS (
      SELECT 1 FROM project_member pm WHERE pm.project_id = t.project_id AND pm.user_id = ${userId}
    ))`,
    ...(view === 'trash' ? [sql`t.deleted_at IS NOT NULL`] : []),
    ...(view === 'active' || view === 'archived' ? [sql`t.deleted_at IS NULL`] : []),
    ...(view === 'active' ? [sql`t.archived_at IS NULL`] : []),
    ...(view === 'archived' ? [sql`t.archived_at IS NOT NULL`] : []),
    ...(filter.projectId != null ? [sql`t.project_id = ${filter.projectId}`] : []),
    ...(filter.agentId != null ? [sql`t.agent_id = ${filter.agentId}`] : []),
    ...(filter.issueId != null ? [sql`t.issue_id = ${filter.issueId}`] : []),
    ...(filter.threadId != null ? [sql`t.id = ${filter.threadId}`] : []),
    ...(like ? [sql`(t.title ILIKE ${like} OR hit.snippet IS NOT NULL)`] : []),
  ];
  const hit = term
    ? sql`LEFT JOIN LATERAL (
        SELECT bool_or(msg.role = 'user') AS user_match,
               (array_agg(${snippetOf(sql`msg.content`, term)} ORDER BY msg.id DESC))[1] AS snippet
        FROM agent_chat_message msg
        WHERE msg.thread_id = t.id AND msg.content ILIKE ${like}
      ) hit ON true`
    : sql`LEFT JOIN LATERAL (SELECT NULL::boolean AS user_match, NULL::text AS snippet) hit ON true`;
  return {
    hit,
    where: sql.join(conditions, sql` AND `),
    rank: like
      ? sql`CASE WHEN t.title ILIKE ${like} THEN 1 WHEN coalesce(hit.user_match, false) THEN 2 ELSE 3 END`
      : sql`NULL::int`,
    order: like ? sql`rank, pinned DESC, t.updated_at DESC` : sql`pinned DESC, t.updated_at DESC`,
  };
}

async function readChats(
  userId: string,
  filter: ChatFilter,
  window: { limit: number; offset: number },
): Promise<ChatSummary[]> {
  const { hit, where, rank, order } = chatQuery(userId, filter);
  const rows = await db.execute(sql`
    SELECT t.id,
           t.title,
           t.agent_id AS "agentId",
           u.name AS "agentName",
           a.username AS "agentUsername",
           a.team_id AS "teamId",
           p.id AS "projectId",
           p.key AS "projectKey",
           p.name AS "projectName",
           i.id AS "issueId",
           ip.key || '-' || i.sequence_number AS "issueIdentifier",
           i.title AS "issueTitle",
           f.thread_id IS NOT NULL AS pinned,
           EXISTS (
             SELECT 1 FROM agent_chat_message lm
             WHERE lm.thread_id = t.id AND lm.role = 'assistant' AND lm.status IN ('pending', 'streaming')
           ) AS running,
           t.archived_at AS "archivedAt",
           t.deleted_at AS "deletedAt",
           hit.snippet,
           ${rank} AS rank,
           t.created_at AS "createdAt",
           t.updated_at AS "updatedAt",
           t.model,
           t.jev_first_stage AS "jevFirstStage",
           t.thinking_level AS "thinkingLevel",
           t.cli_session_id AS "cliSessionId",
           cu.thread_id IS NOT NULL AS "hasUsage",
           CASE WHEN cu.input_tokens IS NULL THEN NULL
                ELSE cu.input_tokens + COALESCE(cu.output_tokens, 0) END AS "contextTokens"
    FROM agent_chat_thread t
    JOIN ai_agent a ON a.id = t.agent_id
    JOIN "user" u ON u.id = a.user_id
    LEFT JOIN project p ON p.id = t.project_id
    LEFT JOIN issue i ON i.id = t.issue_id
    LEFT JOIN project ip ON ip.id = i.project_id
    LEFT JOIN agent_chat_favorite f ON f.thread_id = t.id AND f.user_id = t.user_id
    LEFT JOIN agent_chat_usage cu ON cu.thread_id = t.id
    ${hit}
    WHERE ${where}
    ORDER BY ${order}
    LIMIT ${window.limit} OFFSET ${window.offset}
  `);
  return (rows as unknown as ChatRow[]).map(summary);
}

export async function listChats(
  userId: string,
  filter: ChatFilter,
  window: { limit: number; offset: number },
): Promise<{ items: ChatSummary[]; total: number }> {
  const { hit, where } = chatQuery(userId, filter);
  const [count] = (await db.execute(
    sql`SELECT count(*)::int AS total FROM agent_chat_thread t ${hit} WHERE ${where}`,
  )) as unknown as { total: number }[];
  return { items: await readChats(userId, filter, window), total: count?.total ?? 0 };
}

// One chat of the caller, wherever it is listed, or null.
export async function getChat(threadId: string, userId: string): Promise<ChatSummary | null> {
  const [chat] = await readChats(userId, { threadId, view: 'any' }, { limit: 1, offset: 0 });
  return chat ?? null;
}

async function ownedThread(threadId: string, userId: string) {
  const [thread] = await db
    .select({ id: agentChatThread.id, agentId: agentChatThread.agentId })
    .from(agentChatThread)
    .where(and(eq(agentChatThread.id, threadId), eq(agentChatThread.userId, userId)));
  return thread ?? null;
}

// Renames, archives or restores from the archive, and links a task. Linking needs the
// right to read the task. False when the chat is not the caller's.
export async function updateChat(
  threadId: string,
  user: AuthUser,
  patch: {
    title?: string;
    archived?: boolean;
    issueId?: number | null;
    jevFirstStage?: 'inherit' | 'on' | 'off';
  },
): Promise<boolean> {
  if (!(await ownedThread(threadId, user.id))) return false;
  if (patch.jevFirstStage !== undefined && !(await getChat(threadId, user.id))) return false;
  if (patch.issueId != null) {
    const projectId = await getIssueProjectId(patch.issueId);
    if (projectId == null || !(await checkPermission(projectId, user, 'work_items', 'read'))) {
      throw new HttpError(404, 'Task not found');
    }
  }
  await db
    .update(agentChatThread)
    .set({
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.jevFirstStage !== undefined && {
        jevFirstStage: patch.jevFirstStage,
        jevFirstStageRevision: sql`${agentChatThread.jevFirstStageRevision} + 1`,
      }),
      ...(patch.archived !== undefined && { archivedAt: patch.archived ? new Date() : null }),
      ...(patch.issueId !== undefined && { issueId: patch.issueId }),
    })
    .where(eq(agentChatThread.id, threadId));
  return true;
}

export async function setChatPinned(
  threadId: string,
  userId: string,
  pinned: boolean,
): Promise<boolean> {
  const thread = await ownedThread(threadId, userId);
  if (!thread) return false;
  if (pinned) await addFavorite(userId, thread.agentId, threadId);
  else await removeFavorite(userId, threadId);
  return true;
}

// Moves the chat to the trash, where it stays restorable.
export async function trashChat(threadId: string, userId: string): Promise<boolean> {
  const rows = await db
    .update(agentChatThread)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(agentChatThread.id, threadId),
        eq(agentChatThread.userId, userId),
        isNull(agentChatThread.deletedAt),
      ),
    )
    .returning({ id: agentChatThread.id });
  return rows.length > 0;
}

export async function restoreChat(threadId: string, userId: string): Promise<boolean> {
  const rows = await db
    .update(agentChatThread)
    .set({ deletedAt: null })
    .where(
      and(
        eq(agentChatThread.id, threadId),
        eq(agentChatThread.userId, userId),
        isNotNull(agentChatThread.deletedAt),
      ),
    )
    .returning({ id: agentChatThread.id });
  return rows.length > 0;
}

// Deletes a chat in the trash for good, with its messages.
export async function purgeChat(threadId: string, userId: string): Promise<boolean> {
  const [thread] = await db
    .select({ id: agentChatThread.id })
    .from(agentChatThread)
    .where(
      and(
        eq(agentChatThread.id, threadId),
        eq(agentChatThread.userId, userId),
        isNotNull(agentChatThread.deletedAt),
      ),
    );
  if (!thread) return false;
  return deleteThread(threadId, userId);
}
