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
} from '@repo/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { InboxSyncSource, InboxTriageResult } from './hub-inbox-contract';

export interface ClaimedInboxThread {
  id: string;
  sourceId: number;
  teamId: number;
  channel: 'mail' | 'whatsapp';
  account: string;
  externalThreadId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: Date;
  triageRunId: string | null;
  triageGeneration: number;
  triageAttempts: number;
  projectId: number | null;
  issueId: number | null;
  confidenceThreshold: number;
  autoCreateTasks: boolean;
  autoTaskProjectId: number | null;
}

export async function sourceCursors(teamId: number): Promise<Record<string, string | null>> {
  const rows = await db
    .select({ account: hubInboxSource.account, cursor: hubInboxSource.cursor })
    .from(hubInboxSource)
    .where(and(eq(hubInboxSource.teamId, teamId), eq(hubInboxSource.enabled, true)));
  return Object.fromEntries(rows.map((row) => [row.account, row.cursor]));
}

export async function saveSyncSources(
  teamId: number,
  sources: InboxSyncSource[],
  syncIntervalMs: number,
): Promise<number> {
  let inserted = 0;
  for (const source of sources) {
    inserted += await db.transaction(async (tx) => {
      const now = new Date();
      const [saved] = await tx
        .insert(hubInboxSource)
        .values({
          teamId,
          channel: source.channel,
          account: source.account,
          status: source.status,
          cursor: source.cursor,
          lastSyncAt: now,
          lastSuccessAt: source.status === 'connected' ? now : null,
          lastError: source.error,
          nextSyncAt: new Date(now.getTime() + syncIntervalMs),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [hubInboxSource.teamId, hubInboxSource.channel, hubInboxSource.account],
          set: {
            status: source.status,
            cursor: source.cursor,
            lastSyncAt: now,
            lastSuccessAt:
              source.status === 'connected' ? now : sql`${hubInboxSource.lastSuccessAt}`,
            lastError: source.error,
            nextSyncAt: new Date(now.getTime() + syncIntervalMs),
            updatedAt: now,
          },
        })
        .returning({ id: hubInboxSource.id, enabled: hubInboxSource.enabled });
      if (!saved?.enabled || source.events.length === 0) return 0;
      const rows = await tx
        .insert(hubInboxEvent)
        .values(
          source.events.map((event) => ({
            sourceId: saved.id,
            teamId,
            externalEventId: event.externalEventId,
            externalThreadId: event.externalThreadId,
            externalMessageId: event.externalMessageId,
            sender: event.sender,
            subject: event.subject,
            snippet: event.snippet,
            receivedAt: new Date(event.receivedAt),
          })),
        )
        .onConflictDoNothing()
        .returning({ id: hubInboxEvent.id });
      return rows.length;
    });
  }
  return inserted;
}

export async function markSourcesSyncError(
  teamId: number,
  error: string,
  syncIntervalMs: number,
): Promise<void> {
  await db
    .update(hubInboxSource)
    .set({
      status: 'error',
      lastSyncAt: new Date(),
      lastError: error.slice(0, 500),
      nextSyncAt: new Date(Date.now() + syncIntervalMs),
      updatedAt: new Date(),
    })
    .where(and(eq(hubInboxSource.teamId, teamId), eq(hubInboxSource.enabled, true)));
}

interface ClaimedEvent {
  id: string;
  sourceId: number;
  teamId: number;
  externalThreadId: string;
  externalMessageId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: Date;
  channel: 'mail' | 'whatsapp';
  account: string;
  autoCreateTasks: boolean;
  automationActorUserId: string | null;
}

export async function materializeInboxEvents(limit = 100): Promise<number> {
  await db.execute(sql`
    UPDATE hub_inbox_event
       SET status = 'failed',
           last_error = 'Worker lease expired too many times',
           updated_at = now()
     WHERE status = 'running'
       AND attempts >= 3
       AND next_attempt_at <= now()
  `);
  const claimed = (await db.execute(sql`
    UPDATE hub_inbox_event e
       SET status = 'running',
           attempts = e.attempts + 1,
           next_attempt_at = now() + interval '60 seconds',
           updated_at = now()
     WHERE e.id IN (
       SELECT id FROM hub_inbox_event
        WHERE status IN ('pending', 'running')
          AND attempts < 3
          AND next_attempt_at <= now()
        ORDER BY received_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
     )
    RETURNING e.id, e.source_id AS "sourceId", e.team_id AS "teamId",
      e.external_thread_id AS "externalThreadId",
      e.external_message_id AS "externalMessageId", e.sender, e.subject, e.snippet,
      e.received_at AS "receivedAt"
  `)) as unknown as Omit<
    ClaimedEvent,
    'channel' | 'account' | 'autoCreateTasks' | 'automationActorUserId'
  >[];
  if (claimed.length === 0) return 0;
  const sourceIds = [...new Set(claimed.map((event) => event.sourceId))];
  const sources = await db
    .select({
      id: hubInboxSource.id,
      channel: hubInboxSource.channel,
      account: hubInboxSource.account,
      autoCreateTasks: hubInboxSource.autoCreateTasks,
      automationActorUserId: hubInboxSource.automationActorUserId,
    })
    .from(hubInboxSource)
    .where(inArray(hubInboxSource.id, sourceIds));
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const events = claimed.flatMap((event): ClaimedEvent[] => {
    const source = sourceMap.get(event.sourceId);
    if (!source || (source.channel !== 'mail' && source.channel !== 'whatsapp')) return [];
    return [
      {
        ...event,
        channel: source.channel,
        account: source.account,
        autoCreateTasks: source.autoCreateTasks,
        automationActorUserId: source.automationActorUserId,
      },
    ];
  });
  const groups = new Map<string, ClaimedEvent[]>();
  for (const event of events) {
    const key = `${event.sourceId}\0${event.externalThreadId}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  await db.transaction(async (tx) => {
    for (const group of groups.values()) {
      const latest = [...group].sort(
        (left, right) => new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime(),
      )[0]!;
      const [savedThread] = await tx
        .insert(hubInboxThread)
        .values({
          sourceId: latest.sourceId,
          teamId: latest.teamId,
          externalThreadId: latest.externalThreadId,
          latestExternalMessageId: latest.externalMessageId,
          sender: latest.sender,
          subject: latest.subject,
          snippet: latest.snippet,
          externalUrl: sourceUrl(latest.channel, latest.account, latest.externalThreadId),
          receivedAt: new Date(latest.receivedAt),
          messageCount: group.length,
        })
        .onConflictDoUpdate({
          target: [hubInboxThread.sourceId, hubInboxThread.externalThreadId],
          set: {
            latestExternalMessageId: sql`CASE WHEN excluded.received_at >= ${hubInboxThread.receivedAt} THEN excluded.latest_external_message_id ELSE ${hubInboxThread.latestExternalMessageId} END`,
            sender: sql`CASE WHEN excluded.received_at >= ${hubInboxThread.receivedAt} THEN excluded.sender ELSE ${hubInboxThread.sender} END`,
            subject: sql`CASE WHEN excluded.received_at >= ${hubInboxThread.receivedAt} THEN excluded.subject ELSE ${hubInboxThread.subject} END`,
            snippet: sql`CASE WHEN excluded.received_at >= ${hubInboxThread.receivedAt} THEN excluded.snippet ELSE ${hubInboxThread.snippet} END`,
            externalUrl: sql`CASE WHEN excluded.received_at >= ${hubInboxThread.receivedAt} THEN excluded.external_url ELSE ${hubInboxThread.externalUrl} END`,
            receivedAt: sql`GREATEST(excluded.received_at, ${hubInboxThread.receivedAt})`,
            messageCount: sql`${hubInboxThread.messageCount} + ${group.length}`,
            status: sql`CASE WHEN ${hubInboxThread.issueId} IS NOT NULL OR ${hubInboxThread.projectId} IS NOT NULL THEN 'assigned' ELSE 'new' END`,
            triageStatus: 'pending',
            triageRunId: null,
            triageGeneration: sql`${hubInboxThread.triageGeneration} + 1`,
            triageAttempts: 0,
            nextTriageAt: new Date(),
            lastTriageError: null,
            updatedAt: new Date(),
          },
        })
        .returning({ issueId: hubInboxThread.issueId });
      if (savedThread?.issueId != null) {
        const [linkedIssue] = await tx
          .select({ projectId: issue.projectId, columnId: issue.columnId })
          .from(issue)
          .where(eq(issue.id, savedThread.issueId));
        const body = linkedIssueMessage(latest.channel, latest.account, latest.externalThreadId);
        for (const event of group) {
          const [activity] = await tx
            .insert(issueActivity)
            .values({ issueId: savedThread.issueId, kind: 'comment', actorName: 'Inbox', body })
            .returning({ id: issueActivity.id });
          await tx
            .update(hubInboxEvent)
            .set({ issueActivityId: activity!.id, updatedAt: new Date() })
            .where(eq(hubInboxEvent.id, event.id));
          if (linkedIssue && event.autoCreateTasks && event.automationActorUserId != null) {
            await enqueueInboxCommentActions(tx, {
              rootEventId: event.id,
              projectId: linkedIssue.projectId,
              issueId: savedThread.issueId,
              actorUserId: event.automationActorUserId,
              columnId: linkedIssue.columnId,
            });
          }
        }
      }
    }
    const ids = claimed.map((event) => event.id);
    await tx
      .update(hubInboxEvent)
      .set({ status: 'succeeded', lastError: null, updatedAt: new Date() })
      .where(inArray(hubInboxEvent.id, ids));
  });
  return claimed.length;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function enqueueInboxCommentActions(
  tx: Transaction,
  input: {
    rootEventId: string;
    projectId: number;
    issueId: number;
    actorUserId: string;
    columnId: number;
  },
): Promise<void> {
  const actions = await tx
    .select()
    .from(projectAction)
    .where(
      and(
        eq(projectAction.projectId, input.projectId),
        eq(projectAction.enabled, true),
        eq(projectAction.trigger, 'issue_comment_added'),
      ),
    );
  if (actions.length === 0) return;
  await tx
    .insert(projectActionRun)
    .values(
      actions.map((action) => ({
        actionId: action.id,
        projectId: input.projectId,
        issueId: input.issueId,
        actorUserId: input.actorUserId,
        actionName: action.name,
        trigger: 'issue_comment_added',
        fromColumnId: input.columnId,
        toColumnId: input.columnId,
        rootEventId: input.rootEventId,
        depth: 0,
        condition: action.condition,
        effect: action.effect,
        workflow: action.workflow,
      })),
    )
    .onConflictDoNothing();
}

export async function claimInboxThreads(limit = 10): Promise<ClaimedInboxThread[]> {
  const claimed = (await db.execute(sql`
    UPDATE hub_inbox_thread t
       SET triage_status = 'running',
           next_triage_at = now() + interval '60 seconds',
           updated_at = now()
     WHERE t.id IN (
       SELECT id FROM hub_inbox_thread
        WHERE (
          (triage_status = 'pending' AND triage_attempts < 3)
          OR (triage_status IN ('queued', 'running') AND triage_attempts < 120)
        ) AND next_triage_at <= now()
        ORDER BY next_triage_at, received_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
     )
    RETURNING t.id
  `)) as unknown as { id: string }[];
  if (claimed.length === 0) return [];
  const ids = claimed.map((row) => row.id);
  const rows = await db
    .select({
      id: hubInboxThread.id,
      sourceId: hubInboxThread.sourceId,
      teamId: hubInboxThread.teamId,
      channel: hubInboxSource.channel,
      account: hubInboxSource.account,
      externalThreadId: hubInboxThread.externalThreadId,
      sender: hubInboxThread.sender,
      subject: hubInboxThread.subject,
      snippet: hubInboxThread.snippet,
      receivedAt: hubInboxThread.receivedAt,
      triageRunId: hubInboxThread.triageRunId,
      triageGeneration: hubInboxThread.triageGeneration,
      triageAttempts: hubInboxThread.triageAttempts,
      projectId: hubInboxThread.projectId,
      issueId: hubInboxThread.issueId,
      confidenceThreshold: hubInboxSource.confidenceThreshold,
      autoCreateTasks: hubInboxSource.autoCreateTasks,
      autoTaskProjectId: hubInboxSource.autoTaskProjectId,
    })
    .from(hubInboxThread)
    .innerJoin(hubInboxSource, eq(hubInboxSource.id, hubInboxThread.sourceId))
    .where(inArray(hubInboxThread.id, ids));
  return rows.flatMap((row): ClaimedInboxThread[] =>
    row.channel === 'mail' || row.channel === 'whatsapp' ? [{ ...row, channel: row.channel }] : [],
  );
}

export async function triageContext(thread: ClaimedInboxThread) {
  const [messages, projects] = await Promise.all([
    db
      .select({
        sender: hubInboxEvent.sender,
        subject: hubInboxEvent.subject,
        snippet: hubInboxEvent.snippet,
        receivedAt: hubInboxEvent.receivedAt,
      })
      .from(hubInboxEvent)
      .where(
        and(
          eq(hubInboxEvent.sourceId, thread.sourceId),
          eq(hubInboxEvent.externalThreadId, thread.externalThreadId),
        ),
      )
      .orderBy(desc(hubInboxEvent.receivedAt))
      .limit(5),
    db
      .select({ key: project.key, name: project.name })
      .from(project)
      .where(eq(project.teamId, thread.teamId))
      .orderBy(project.key)
      .limit(100),
  ]);
  return {
    messages: messages.reverse().map((message) => ({
      ...message,
      receivedAt: message.receivedAt.toISOString(),
    })),
    projects,
  };
}

export async function recordTriageSubmission(thread: ClaimedInboxThread): Promise<boolean> {
  const rows = await db
    .update(hubInboxThread)
    .set({ triageAttempts: sql`${hubInboxThread.triageAttempts} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(hubInboxThread.id, thread.id),
        eq(hubInboxThread.triageGeneration, thread.triageGeneration),
      ),
    )
    .returning({ id: hubInboxThread.id });
  return rows.length > 0;
}

export async function queueTriageRun(
  thread: ClaimedInboxThread,
  runId: string,
  status: 'queued' | 'running',
): Promise<void> {
  const exhausted = thread.triageAttempts + 1 >= 120;
  await db
    .update(hubInboxThread)
    .set({
      triageStatus: exhausted ? 'failed' : status,
      triageRunId: exhausted ? null : runId,
      triageAttempts: sql`${hubInboxThread.triageAttempts} + 1`,
      nextTriageAt: new Date(Date.now() + (exhausted ? 0 : 5000)),
      lastTriageError: exhausted ? 'Triage run exceeded the polling limit' : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(hubInboxThread.id, thread.id),
        eq(hubInboxThread.triageGeneration, thread.triageGeneration),
      ),
    );
}

export async function completeTriage(
  thread: ClaimedInboxThread,
  result: InboxTriageResult,
): Promise<void> {
  const linked = thread.issueId != null;
  let route = !linked
    ? await resolveRoute(thread.teamId, result.projectKey, result.issueIdentifier)
    : { projectId: thread.projectId, issueId: thread.issueId, invalid: false };
  if (
    !linked &&
    result.requiresAction &&
    result.projectKey == null &&
    result.issueIdentifier == null &&
    thread.autoCreateTasks &&
    thread.autoTaskProjectId != null
  ) {
    route = await resolveFallbackProject(thread.teamId, thread.autoTaskProjectId);
  }
  const confident = result.confidence >= thread.confidenceThreshold;
  const validRoute = !result.requiresAction || route.projectId != null;
  const routable = linked ? confident : confident && validRoute && !route.invalid;
  const outsideAutomaticScope =
    !linked &&
    result.requiresAction &&
    thread.autoCreateTasks &&
    route.projectId !== thread.autoTaskProjectId;
  // A fresh message on an already-linked ticket is evidence for a person to review.
  // Never let the classifier silently clear that follow-up, even when it considers
  // the message irrelevant; the linked issue state itself remains untouched.
  const accepted = routable && !outsideAutomaticScope && !linked;
  const projectId = linked ? thread.projectId : routable ? route.projectId : null;
  const issueId = linked ? thread.issueId : routable ? route.issueId : null;
  const ticketStatus =
    issueId != null
      ? 'created'
      : accepted && result.requiresAction && projectId != null && thread.autoCreateTasks
        ? 'pending'
        : result.requiresAction
          ? 'skipped'
          : 'none';
  await db
    .update(hubInboxThread)
    .set({
      projectId,
      issueId,
      status: projectId == null ? 'new' : 'assigned',
      priority: result.priority,
      triageSummary: result.summary,
      triageStatus: accepted ? 'succeeded' : 'needs_review',
      triageRunId: null,
      lastTriageError: accepted
        ? null
        : linked
          ? 'Review required for a new message on a linked ticket'
          : route.invalid
            ? 'Triage route was invalid'
            : outsideAutomaticScope
              ? 'Review required for a project outside this source automation scope'
              : 'Review required',
      confidence: result.confidence,
      requiresAction: result.requiresAction,
      ticketStatus,
      nextTicketAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(hubInboxThread.id, thread.id),
        eq(hubInboxThread.triageGeneration, thread.triageGeneration),
      ),
    );
}

async function resolveFallbackProject(
  teamId: number,
  projectId: number,
): Promise<{ projectId: number | null; issueId: null; invalid: boolean }> {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)));
  return row
    ? { projectId: row.id, issueId: null, invalid: false }
    : { projectId: null, issueId: null, invalid: true };
}

export async function failTriage(thread: ClaimedInboxThread, error: string): Promise<void> {
  const retry = thread.triageAttempts + (thread.triageRunId ? 0 : 1) < 3;
  await db
    .update(hubInboxThread)
    .set({
      triageStatus: retry ? 'pending' : 'failed',
      triageRunId: null,
      nextTriageAt: new Date(Date.now() + (retry ? 15_000 : 0)),
      lastTriageError: error.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(hubInboxThread.id, thread.id),
        eq(hubInboxThread.triageGeneration, thread.triageGeneration),
      ),
    );
}

async function resolveRoute(
  teamId: number,
  projectKey: string | null,
  issueIdentifier: string | null,
): Promise<{ projectId: number | null; issueId: number | null; invalid: boolean }> {
  if (issueIdentifier) {
    const match = /^([A-Z0-9][A-Z0-9_-]{0,30})-(\d+)$/.exec(issueIdentifier);
    if (!match) return { projectId: null, issueId: null, invalid: true };
    const [row] = await db
      .select({ issueId: issue.id, projectId: project.id, projectKey: project.key })
      .from(issue)
      .innerJoin(project, eq(project.id, issue.projectId))
      .where(
        and(
          eq(project.teamId, teamId),
          eq(project.key, match[1]!),
          eq(issue.sequenceNumber, Number(match[2])),
        ),
      );
    if (!row || (projectKey && projectKey !== row.projectKey))
      return { projectId: null, issueId: null, invalid: true };
    return { projectId: row.projectId, issueId: row.issueId, invalid: false };
  }
  if (!projectKey) return { projectId: null, issueId: null, invalid: false };
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.teamId, teamId), eq(project.key, projectKey)));
  return row
    ? { projectId: row.id, issueId: null, invalid: false }
    : { projectId: null, issueId: null, invalid: true };
}

function sourceUrl(channel: 'mail' | 'whatsapp', account: string, threadId: string): string | null {
  if (channel !== 'mail') return null;
  return `https://mail.google.com/mail/u/${encodeURIComponent(account)}/#all/${encodeURIComponent(threadId)}`;
}

function linkedIssueMessage(
  channel: 'mail' | 'whatsapp',
  account: string,
  threadId: string,
): string {
  const url = sourceUrl(channel, account, threadId);
  return url
    ? `New mail message received in the linked inbox thread. [Open source thread](${url})`
    : 'New WhatsApp message received in the linked inbox thread.';
}
