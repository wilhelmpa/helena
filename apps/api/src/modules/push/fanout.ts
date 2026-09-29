import type { CoreEvent, HelenaEvent } from '@helena/sdk';
import { formatPush } from '@helena/locales/push';
import { agentChatMessage, aiAgent, db, getDisplayName, issue, project, user } from '@repo/db';
import { eq } from 'drizzle-orm';
import { deciders, getApproval } from '#modules/approvals/service';
import { notificationCategory } from './categories';
import { approvalsPath, activityPath, chatPath, issuePath } from './paths';
import { instanceOwners, isLooking, pushTo } from './recipients';

// Pushes for what happens, as a subscriber of Helena's domain events (docs/helena-decisions/
// push.md): an agent asks for an approval (Freigaben, to everyone who may decide), an agent's
// chat answer is ready while its person is not looking at Helena (Agenten-Antworten), a chat
// answer or a run failed (Braucht dich, to the person or the owners). The subscriber only
// queues; the drain sends. It runs in the api right after the event, so a failure here is
// logged and never fails the change that caused it.

export const PUSH_EVENT_PATTERNS = [
  'helena.approval.requested',
  'helena.chat.message',
  'helena.run.failed',
] as const;

// A snippet of an answer for the lock screen: Markdown marks and runs of space removed.
export function answerSnippet(content: string, max = 180): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>*\-+\s]+/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...plain];
  return chars.length <= max ? plain : `${chars.slice(0, max - 1).join('')}…`;
}

async function agentName(agentId: number | null): Promise<string> {
  if (agentId == null) return getDisplayName();
  // An agent's name is its member's.
  const [row] = await db
    .select({ name: user.name })
    .from(aiAgent)
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .where(eq(aiAgent.id, agentId));
  return row?.name ?? (await getDisplayName());
}

async function projectKey(projectId: number | null): Promise<string | null> {
  if (projectId == null) return null;
  const [row] = await db
    .select({ key: project.key })
    .from(project)
    .where(eq(project.id, projectId));
  return row?.key ?? null;
}

async function approvalRequested(event: CoreEvent<'helena.approval.requested'>): Promise<void> {
  const category = notificationCategory('approvals');
  if (!category) return;
  const approval = await getApproval(event.data.approvalId);
  if (!approval || approval.status !== 'pending') return;
  const people = await deciders(approval.projectId);
  const where = approval.issueIdentifier ?? approval.projectName;
  await pushTo(people, category, {
    dedupeKey: `approval:${approval.id}`,
    tag: `approval:${approval.id}`,
    url: approvalsPath(),
    renotify: true,
    requireInteraction: true,
    at: new Date(event.time),
    render: (locale) => ({
      title: formatPush(locale, 'approval.title', { agent: approval.agentName }),
      body: formatPush(locale, where ? 'approval.bodyWhere' : 'approval.body', {
        action: approval.action,
        where: where ?? '',
      }),
    }),
  });
}

async function chatAnswered(event: CoreEvent<'helena.chat.message'>): Promise<void> {
  const data = event.data;
  if (data.role !== 'assistant' || !data.userId) return;
  const failed = data.status === 'failed';
  const category = notificationCategory(failed ? 'needs-you' : 'agent-replies');
  if (!category) return;
  // The person sees the answer arrive: no push.
  if (await isLooking(data.userId)) return;
  const [name, key, message] = await Promise.all([
    agentName(data.agentId),
    projectKey(data.projectId),
    db
      .select({ content: agentChatMessage.content })
      .from(agentChatMessage)
      .where(eq(agentChatMessage.id, data.messageId))
      .then((rows) => rows[0]),
  ]);
  const location = { agent: data.agentId, thread: data.threadId };
  const url = key ? `/project/${key}${chatPath(location)}` : chatPath(location);
  const snippet = answerSnippet(message?.content ?? '');
  await pushTo([data.userId], category, {
    dedupeKey: `chat:${data.messageId}:${data.status}`,
    // One notification per thread: the next answer replaces it.
    tag: `chat:${data.threadId}`,
    url,
    at: new Date(event.time),
    render: (locale) =>
      failed
        ? {
            title: formatPush(locale, 'chatFailed.title', { agent: name }),
            body: formatPush(locale, 'chatFailed.body'),
          }
        : {
            title: formatPush(locale, 'reply.title', { agent: name }),
            body: snippet || formatPush(locale, 'reply.empty'),
          },
  });
}

async function runFailed(event: CoreEvent<'helena.run.failed'>): Promise<void> {
  const category = notificationCategory('needs-you');
  if (!category) return;
  const data = event.data;
  const [name, task] = await Promise.all([
    agentName(data.agentId),
    data.issueId == null
      ? Promise.resolve(undefined)
      : db
          .select({ title: issue.title, seq: issue.sequenceNumber, key: project.key })
          .from(issue)
          .innerJoin(project, eq(project.id, issue.projectId))
          .where(eq(issue.id, data.issueId))
          .then((rows) => rows[0]),
  ]);
  await pushTo(await instanceOwners(), category, {
    dedupeKey: `run:${data.runId}:failed`,
    tag: `run:${data.runId}`,
    url: task ? issuePath(task.key, task.seq) : activityPath(),
    at: new Date(event.time),
    render: (locale) => ({
      title: formatPush(locale, 'runFailed.title', { agent: name }),
      body: task ? `${task.key}-${task.seq} ${task.title}` : formatPush(locale, 'runFailed.noTask'),
    }),
  });
}

export async function onPushEvent(event: HelenaEvent): Promise<void> {
  try {
    if (event.type === 'helena.approval.requested') {
      await approvalRequested(event as CoreEvent<'helena.approval.requested'>);
    } else if (event.type === 'helena.chat.message') {
      await chatAnswered(event as CoreEvent<'helena.chat.message'>);
    } else if (event.type === 'helena.run.failed') {
      await runFailed(event as CoreEvent<'helena.run.failed'>);
    }
  } catch (error) {
    console.error(`[push] ${event.type} not queued:`, error);
  }
}
