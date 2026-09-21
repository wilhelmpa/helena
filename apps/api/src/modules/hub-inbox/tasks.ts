import { db, hubInboxEvent, hubInboxThread, issueActivity, projectColumn } from '@repo/db';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { enqueueCommentAddedActions } from '#modules/actions/queue';
import { createIssue } from '#modules/issues/service';
import { getProjectById } from '#modules/projects/service';
import { HttpError } from '#shared/lib';
import { exactSourceUrl } from './service';

interface ClaimedTicket {
  id: string;
  projectId: number;
  subject: string;
  sender: string;
  channel: string;
  account: string;
  externalThreadId: string;
  priority: string | null;
  sourceId: number;
  automationActorUserId: string | null;
}

export async function createInboxTask(
  threadId: string,
  actorUserId: string | null = null,
): Promise<{ issueId: number; sequenceNumber: number }> {
  const claimed = await claimTicket(threadId);
  if (!claimed) {
    const [existing] = await db
      .select({ issueId: hubInboxThread.issueId })
      .from(hubInboxThread)
      .where(eq(hubInboxThread.id, threadId));
    if (existing?.issueId != null) {
      const [row] = await db.execute<{ issueId: number; sequenceNumber: number }>(sql`
        SELECT id AS "issueId", sequence_number AS "sequenceNumber"
          FROM issue WHERE id = ${existing.issueId}
      `);
      if (row) return row;
    }
    throw new HttpError(409, 'Inbox task is already being created');
  }

  try {
    const project = await getProjectById(claimed.projectId);
    if (!project) throw new HttpError(400, 'Assigned project no longer exists');
    const [column] = await db
      .select({ id: projectColumn.id })
      .from(projectColumn)
      .where(eq(projectColumn.projectId, project.id))
      .orderBy(asc(projectColumn.position), asc(projectColumn.id))
      .limit(1);
    if (!column) throw new HttpError(400, 'Assigned project has no state');

    const title = (claimed.subject.trim() || `Message from ${claimed.sender}`).slice(0, 300);
    const externalUrl = exactSourceUrl(claimed.channel, claimed.account, claimed.externalThreadId);
    const sourceName = claimed.channel === 'mail' ? 'Mail' : 'WhatsApp';
    const description = externalUrl
      ? `Source: ${sourceName}\n\n[Open source thread](${externalUrl})`
      : `Source: ${sourceName}`;
    const runActorUserId = actorUserId ?? claimed.automationActorUserId;
    const created = await createIssue(
      project,
      {
        columnId: column.id,
        title,
        description,
        priority: claimed.priority,
        labelIds: [],
      },
      runActorUserId,
      {
        afterInsert: async (tx, issueId) => {
          const [event] = await tx
            .select({ id: hubInboxEvent.id })
            .from(hubInboxEvent)
            .where(
              and(
                eq(hubInboxEvent.sourceId, claimed.sourceId),
                eq(hubInboxEvent.externalThreadId, claimed.externalThreadId),
                isNull(hubInboxEvent.issueActivityId),
              ),
            )
            .orderBy(desc(hubInboxEvent.receivedAt), desc(hubInboxEvent.id))
            .limit(1);
          if (event) {
            const [activity] = await tx
              .insert(issueActivity)
              .values({ issueId, kind: 'comment', actorName: 'Inbox', body: description })
              .returning({ id: issueActivity.id });
            await tx
              .update(hubInboxEvent)
              .set({ issueActivityId: activity!.id, updatedAt: new Date() })
              .where(and(eq(hubInboxEvent.id, event.id), isNull(hubInboxEvent.issueActivityId)));
            await enqueueCommentAddedActions({
              tx,
              projectId: project.id,
              issueId,
              actorUserId: runActorUserId,
              columnId: column.id,
              rootEventId: event.id,
            });
          }
          const linked = await tx
            .update(hubInboxThread)
            .set({
              issueId,
              ticketStatus: 'created',
              status: 'assigned',
              updatedAt: new Date(),
            })
            .where(
              and(eq(hubInboxThread.id, claimed.id), eq(hubInboxThread.ticketStatus, 'running')),
            )
            .returning({ id: hubInboxThread.id });
          if (linked.length !== 1) throw new HttpError(409, 'Inbox task link changed');
        },
      },
    );
    return { issueId: created.id, sequenceNumber: created.sequenceNumber };
  } catch (error) {
    await db
      .update(hubInboxThread)
      .set({
        ticketStatus: 'failed',
        nextTicketAt: new Date(Date.now() + 60_000),
        updatedAt: new Date(),
      })
      .where(and(eq(hubInboxThread.id, claimed.id), eq(hubInboxThread.ticketStatus, 'running')));
    throw error;
  }
}

export async function processInboxTasks(): Promise<void> {
  const rows = (await db.execute(sql`
    SELECT t.id
      FROM hub_inbox_thread t
      JOIN hub_inbox_source s ON s.id = t.source_id
     WHERE t.ticket_status = 'pending'
       AND t.issue_id IS NULL
       AND t.project_id IS NOT NULL
       AND t.next_ticket_at <= now()
       AND t.ticket_attempts < 3
       AND s.enabled = true
       AND s.auto_create_tasks = true
     ORDER BY t.next_ticket_at, t.id
     LIMIT 10
  `)) as unknown as { id: string }[];
  for (const row of rows) {
    try {
      await createInboxTask(row.id);
    } catch (error) {
      const kind = error instanceof HttpError ? `HTTP ${error.status}` : 'internal error';
      console.error(`[background] inbox task creation failed (${kind})`);
    }
  }
}

async function claimTicket(threadId: string): Promise<ClaimedTicket | null> {
  const rows = (await db.execute(sql`
    UPDATE hub_inbox_thread t
       SET ticket_status = 'running',
           ticket_attempts = t.ticket_attempts + 1,
           next_ticket_at = now() + interval '60 seconds',
           updated_at = now()
      FROM hub_inbox_source s
     WHERE t.id = ${threadId}
       AND s.id = t.source_id
       AND t.issue_id IS NULL
       AND t.project_id IS NOT NULL
       AND t.ticket_status IN ('none', 'pending', 'failed', 'skipped')
    RETURNING t.id, t.project_id AS "projectId", t.subject, t.sender,
              t.source_id AS "sourceId", s.automation_actor_user_id AS "automationActorUserId",
              s.channel, s.account, t.external_thread_id AS "externalThreadId", t.priority
  `)) as unknown as ClaimedTicket[];
  return rows[0] ?? null;
}
