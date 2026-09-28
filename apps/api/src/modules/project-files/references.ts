import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  agentChatMessage,
  agentChatThread,
  aiAgent,
  db,
  issue,
  issueAttachment,
  project,
  user,
  vaultEntry,
} from '@repo/db';
import type { AuthUser } from '#shared/access';
import { knowledgeReach } from '#modules/knowledge/reach';
import { relativePath, joinPath } from './paths';
import type { FileRoot } from './roots';

// References disclose only what this same caller could open: task permissions and
// conversation ownership are independent of access to the underlying file.
export async function fileReferences(
  root: FileRoot,
  path: string,
  caller: AuthUser,
  viaMcp: boolean,
) {
  const empty = {
    author: null as string | null,
    authorKind: null as 'agent' | 'user' | null,
    runId: null as number | null,
    links: [] as { kind: string; title: string; href: string }[],
  };
  if (!root.vaultPath) return empty;
  const full = joinPath(root.vaultPath, relativePath(path));
  const [entry] = await db.select().from(vaultEntry).where(eq(vaultEntry.path, full));
  let author = entry?.lastAuthor ?? null;
  const authorKind: 'agent' | 'user' | null = author?.startsWith('agent:')
    ? 'agent'
    : author?.startsWith('user:')
      ? 'user'
      : null;
  if (author?.startsWith('user:')) {
    const [person] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, author.slice(5)));
    author = person?.name ?? null;
  } else if (author?.startsWith('agent:')) {
    const [agent] = await db
      .select({ name: user.name })
      .from(aiAgent)
      .innerJoin(user, eq(user.id, aiAgent.userId))
      .where(eq(aiAgent.id, Number(author.slice(6))));
    author = agent?.name ?? null;
  }
  const reach = await knowledgeReach(caller, viaMcp);
  const rows = await db
    .select({
      id: issue.id,
      projectId: project.id,
      key: project.key,
      number: issue.sequenceNumber,
      title: issue.title,
    })
    .from(issueAttachment)
    .innerJoin(issue, eq(issue.id, issueAttachment.issueId))
    .innerJoin(project, eq(project.id, issue.projectId))
    .where(eq(issueAttachment.vaultPath, full));
  const links = rows
    .filter((row) => reach.projects.get(row.projectId)?.has('work_items'))
    .map((row) => ({
      kind: 'ticket',
      title: `${row.key}-${row.number}: ${row.title}`,
      href: `/project/${encodeURIComponent(row.key)}/issue/${row.number}`,
    }));
  const chats = await db
    .selectDistinct({
      id: agentChatThread.id,
      title: agentChatThread.title,
      agentId: agentChatThread.agentId,
    })
    .from(agentChatThread)
    .innerJoin(agentChatMessage, eq(agentChatMessage.threadId, agentChatThread.id))
    .where(
      and(
        eq(agentChatThread.userId, caller.id),
        isNull(agentChatThread.deletedAt),
        sql`${agentChatMessage.attachments} @> ${JSON.stringify([{ kind: 'file', path: full }])}::jsonb`,
      ),
    )
    .limit(50);
  links.push(
    ...chats.map((chat) => ({
      kind: 'chat',
      title: chat.title || 'Chat',
      href: `/chat?agent=${chat.agentId}&thread=${encodeURIComponent(chat.id)}`,
    })),
  );
  return { author, authorKind, runId: entry?.lastRunId ?? null, links };
}
