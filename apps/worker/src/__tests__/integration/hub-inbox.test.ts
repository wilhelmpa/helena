import { beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  db,
  hubInboxEvent,
  hubInboxSource,
  hubInboxThread,
  issue,
  issueActivity,
  project,
  projectAction,
  projectActionRun,
  projectColumn,
  team,
  user,
} from '@repo/db';
import { eq } from 'drizzle-orm';
import {
  claimInboxThreads,
  completeTriage,
  materializeInboxEvents,
  queueTriageRun,
} from '../../hub-inbox-store';

beforeEach(async () => {
  await db.delete(team);
});

interface EventInput {
  externalEventId: string;
  externalThreadId: string;
  externalMessageId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string;
}

// The rows the mail importer writes for new inbox mail of an account with triage on.
async function recordEvents(teamId: number, events: EventInput[]): Promise<number> {
  const [source] = await db
    .insert(hubInboxSource)
    .values({ teamId, channel: 'mail', account: 'team@example.com', status: 'connected' })
    .onConflictDoUpdate({
      target: [hubInboxSource.teamId, hubInboxSource.channel, hubInboxSource.account],
      set: { updatedAt: new Date() },
    })
    .returning();
  const rows = await db
    .insert(hubInboxEvent)
    .values(
      events.map((event) => ({
        ...event,
        sourceId: source!.id,
        teamId,
        receivedAt: new Date(event.receivedAt),
      })),
    )
    .onConflictDoNothing()
    .returning();
  return rows.length;
}

describe('hub inbox store', () => {
  it('deduplicates repeated events and materializes one thread', async () => {
    const [owner] = await db.insert(team).values({ name: 'Inbox test' }).returning();
    const event = {
      externalEventId: 'mail:1',
      externalThreadId: 'mail-thread:1',
      externalMessageId: '<message-1@example.com>',
      sender: 'sender@example.com',
      subject: 'Support request',
      snippet: 'Please help',
      receivedAt: '2026-09-21T08:00:00.000Z',
    };

    expect(await recordEvents(owner.id, [event])).toBe(1);
    expect(await recordEvents(owner.id, [event])).toBe(0);
    expect(await materializeInboxEvents()).toBe(1);
    expect(await materializeInboxEvents()).toBe(0);

    const events = await db.select().from(hubInboxEvent);
    const threads = await db.select().from(hubInboxThread);
    expect(events).toHaveLength(1);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ messageCount: 1, externalUrl: null });

    await db
      .update(hubInboxThread)
      .set({ triageAttempts: 99, triageStatus: 'succeeded' })
      .where(eq(hubInboxThread.id, threads[0]!.id));
    expect(
      await recordEvents(owner.id, [
        {
          ...event,
          externalEventId: 'mail:2',
          externalMessageId: '<message-2@example.com>',
          receivedAt: '2026-09-21T08:05:00.000Z',
        },
      ]),
    ).toBe(1);
    expect(await materializeInboxEvents()).toBe(1);
    const [updated] = await db
      .select()
      .from(hubInboxThread)
      .where(eq(hubInboxThread.id, threads[0]!.id));
    expect(updated).toMatchObject({ triageStatus: 'pending', triageAttempts: 0, messageCount: 2 });
  });

  it('requires review below the source threshold and validates project routing locally', async () => {
    const [owner] = await db.insert(team).values({ name: 'Inbox test' }).returning();
    await db.insert(project).values({ teamId: owner.id, key: 'HELP', name: 'Helpdesk' });
    await recordEvents(owner.id, [
      {
        externalEventId: 'event-2',
        externalThreadId: 'thread-2',
        externalMessageId: 'message-2',
        sender: 'sender@example.com',
        subject: 'Question',
        snippet: 'Question text',
        receivedAt: '2026-09-21T09:00:00.000Z',
      },
    ]);
    await materializeInboxEvents();
    const [claimed] = await claimInboxThreads();
    expect(claimed).toBeDefined();
    await completeTriage(claimed!, {
      summary: 'Likely support task',
      priority: 'medium',
      requiresAction: true,
      projectKey: 'HELP',
      issueIdentifier: null,
      confidence: 0.5,
    });
    const [thread] = await db
      .select()
      .from(hubInboxThread)
      .where(eq(hubInboxThread.id, claimed!.id));
    expect(thread).toMatchObject({
      triageStatus: 'needs_review',
      projectId: null,
      issueId: null,
      ticketStatus: 'skipped',
    });
  });

  it('preserves an existing task link and bounds asynchronous triage polling', async () => {
    const [owner] = await db.insert(team).values({ name: 'Inbox test' }).returning();
    const [targetProject] = await db
      .insert(project)
      .values({ teamId: owner.id, key: 'HELP', name: 'Helpdesk' })
      .returning();
    const [column] = await db
      .insert(projectColumn)
      .values({ projectId: targetProject.id, name: 'Inbox', position: 0 })
      .returning();
    const [ticket] = await db
      .insert(issue)
      .values({
        projectId: targetProject.id,
        sequenceNumber: 1,
        columnId: column.id,
        title: 'Existing task',
      })
      .returning();
    const actorUserId = randomUUID();
    await db.insert(user).values({
      id: actorUserId,
      name: 'Inbox automation owner',
      email: `${actorUserId}@example.com`,
    });
    await recordEvents(owner.id, [
      {
        externalEventId: 'event-3',
        externalThreadId: 'thread-3',
        externalMessageId: 'message-3',
        sender: 'sender@example.com',
        subject: 'Follow-up',
        snippet: 'New untrusted routing instructions',
        receivedAt: '2026-09-21T10:00:00.000Z',
      },
    ]);
    await materializeInboxEvents();
    const [row] = await db.select().from(hubInboxThread);
    await db
      .update(hubInboxThread)
      .set({
        projectId: targetProject.id,
        issueId: ticket.id,
        ticketStatus: 'created',
        triageStatus: 'pending',
        status: 'done',
      })
      .where(eq(hubInboxThread.id, row!.id));
    const [source] = await db.select().from(hubInboxSource);
    await db
      .update(hubInboxSource)
      .set({ autoCreateTasks: true, automationActorUserId: actorUserId })
      .where(eq(hubInboxSource.id, source!.id));
    const [action] = await db
      .insert(projectAction)
      .values({
        projectId: targetProject.id,
        name: 'Mark inbox follow-up',
        trigger: 'issue_comment_added',
        condition: { conditions: [] },
        effect: { priority: 'high' },
      })
      .returning();
    const [replyEvent] = await db
      .insert(hubInboxEvent)
      .values({
        sourceId: source!.id,
        teamId: owner.id,
        externalEventId: 'event-3-reply',
        externalThreadId: 'thread-3',
        externalMessageId: 'message-3-reply',
        sender: 'sender@example.com',
        subject: 'Follow-up',
        snippet: 'A later reply',
        receivedAt: new Date('2026-09-21T10:05:00.000Z'),
      })
      .returning();
    await materializeInboxEvents();
    expect(await materializeInboxEvents()).toBe(0);
    const comments = await db
      .select()
      .from(issueActivity)
      .where(eq(issueActivity.issueId, ticket.id));
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ kind: 'comment', actorName: 'Inbox' });
    expect(comments[0]?.body).toBe('New mail message received in the linked inbox thread.');
    const queuedActions = await db
      .select()
      .from(projectActionRun)
      .where(eq(projectActionRun.issueId, ticket.id));
    expect(queuedActions).toHaveLength(1);
    expect(queuedActions[0]).toMatchObject({
      actionId: action!.id,
      actorUserId,
      trigger: 'issue_comment_added',
      rootEventId: replyEvent!.id,
      status: 'pending',
    });
    const [reopened] = await db.select().from(hubInboxThread).where(eq(hubInboxThread.id, row!.id));
    expect(reopened).toMatchObject({ status: 'assigned', ticketStatus: 'created' });
    const [unchangedTicket] = await db.select().from(issue).where(eq(issue.id, ticket.id));
    expect(unchangedTicket?.columnId).toBe(column.id);
    const [claimed] = await claimInboxThreads();
    await completeTriage(claimed!, {
      summary: 'A high-confidence irrelevant reply still needs linked-ticket review',
      priority: 'low',
      requiresAction: false,
      projectKey: null,
      issueIdentifier: null,
      confidence: 0.99,
    });
    const [preserved] = await db
      .select()
      .from(hubInboxThread)
      .where(eq(hubInboxThread.id, row!.id));
    expect(preserved).toMatchObject({
      projectId: targetProject.id,
      issueId: ticket.id,
      ticketStatus: 'created',
      triageStatus: 'needs_review',
      lastTriageError: 'Review required for a new message on a linked ticket',
    });

    await db
      .update(hubInboxThread)
      .set({ triageStatus: 'queued', triageAttempts: 119, nextTriageAt: new Date(0) })
      .where(eq(hubInboxThread.id, row!.id));
    const [lastPoll] = await claimInboxThreads();
    await queueTriageRun(lastPoll!, 'run-forever', 'running');
    const [bounded] = await db.select().from(hubInboxThread).where(eq(hubInboxThread.id, row!.id));
    expect(bounded).toMatchObject({
      triageStatus: 'failed',
      triageRunId: null,
      triageAttempts: 120,
      lastTriageError: 'Triage run exceeded the polling limit',
    });
  });

  it('auto-creates only inside the source project scope and falls back there without a route', async () => {
    const [owner] = await db.insert(team).values({ name: 'Inbox test' }).returning();
    const [fallback] = await db
      .insert(project)
      .values({ teamId: owner.id, key: 'PRIV', name: 'Private' })
      .returning();
    await db.insert(project).values({ teamId: owner.id, key: 'OTHER', name: 'Other' });
    await recordEvents(owner.id, [
      {
        externalEventId: 'event-4',
        externalThreadId: 'thread-4',
        externalMessageId: 'message-4',
        sender: 'sender@example.com',
        subject: 'Action needed',
        snippet: 'Please review',
        receivedAt: '2026-09-21T11:00:00.000Z',
      },
    ]);
    const [source] = await db.select().from(hubInboxSource);
    await db
      .update(hubInboxSource)
      .set({ autoCreateTasks: true, autoTaskProjectId: fallback!.id, confidenceThreshold: 0.9 })
      .where(eq(hubInboxSource.id, source!.id));
    await materializeInboxEvents();
    const [claimed] = await claimInboxThreads();
    await completeTriage(claimed!, {
      summary: 'Relevant action without a clear project',
      priority: 'medium',
      requiresAction: true,
      projectKey: null,
      issueIdentifier: null,
      confidence: 0.95,
    });
    const [fallbackThread] = await db
      .select()
      .from(hubInboxThread)
      .where(eq(hubInboxThread.id, claimed!.id));
    expect(fallbackThread).toMatchObject({
      projectId: fallback!.id,
      triageStatus: 'succeeded',
      ticketStatus: 'pending',
    });

    await db.insert(hubInboxEvent).values({
      sourceId: source!.id,
      teamId: owner.id,
      externalEventId: 'event-5',
      externalThreadId: 'thread-5',
      externalMessageId: 'message-5',
      sender: 'sender@example.com',
      subject: 'Other project',
      snippet: 'Route elsewhere',
      receivedAt: new Date('2026-09-21T11:05:00.000Z'),
    });
    await materializeInboxEvents();
    const [outside] = await claimInboxThreads();
    await completeTriage(outside!, {
      summary: 'Relevant but outside configured scope',
      priority: 'medium',
      requiresAction: true,
      projectKey: 'OTHER',
      issueIdentifier: null,
      confidence: 0.99,
    });
    const [review] = await db
      .select()
      .from(hubInboxThread)
      .where(eq(hubInboxThread.id, outside!.id));
    expect(review).toMatchObject({
      triageStatus: 'needs_review',
      ticketStatus: 'skipped',
      lastTriageError: 'Review required for a project outside this source automation scope',
    });

    await db
      .update(hubInboxSource)
      .set({ autoCreateTasks: false })
      .where(eq(hubInboxSource.id, source!.id));
    await db.insert(hubInboxEvent).values({
      sourceId: source!.id,
      teamId: owner.id,
      externalEventId: 'event-6',
      externalThreadId: 'thread-6',
      externalMessageId: 'message-6',
      sender: 'sender@example.com',
      subject: 'Review only',
      snippet: 'Automation is disabled',
      receivedAt: new Date('2026-09-21T11:10:00.000Z'),
    });
    await materializeInboxEvents();
    const [disabled] = await claimInboxThreads();
    await completeTriage(disabled!, {
      summary: 'Relevant but automatic ticket creation is disabled',
      priority: 'medium',
      requiresAction: true,
      projectKey: null,
      issueIdentifier: null,
      confidence: 0.99,
    });
    const [reviewOnly] = await db
      .select()
      .from(hubInboxThread)
      .where(eq(hubInboxThread.id, disabled!.id));
    expect(reviewOnly).toMatchObject({
      projectId: null,
      triageStatus: 'needs_review',
      ticketStatus: 'skipped',
    });
  });
});
