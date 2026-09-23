import { db, hubInboxSource, hubInboxThread, issue, project } from '@repo/db';
import { and, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';

export interface HubInboxCursor {
  ts: string;
  id: string;
}

export interface HubInboxFilters {
  teamId: number;
  projectId?: number;
  channel?: 'mail' | 'whatsapp';
  status?: 'new' | 'assigned' | 'waiting' | 'done';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  needsReview?: boolean;
  cursor?: HubInboxCursor | null;
  limit?: number;
}

export async function listHubInboxSources(teamId: number) {
  const rows = await db
    .select()
    .from(hubInboxSource)
    .where(eq(hubInboxSource.teamId, teamId))
    .orderBy(hubInboxSource.channel, hubInboxSource.account);
  return rows.map(mapSource);
}

function mapSource(row: typeof hubInboxSource.$inferSelect) {
  return {
    id: row.id,
    teamId: row.teamId,
    channel: row.channel as 'mail' | 'whatsapp',
    account: row.account,
    enabled: row.enabled,
    status: row.status as 'disabled' | 'connecting' | 'connected' | 'error',
    confidenceThreshold: row.confidenceThreshold,
    autoCreateTasks: row.autoCreateTasks,
    autoTaskProjectId: row.autoTaskProjectId,
    lastSyncAt: row.lastSyncAt ? iso(row.lastSyncAt) : null,
    lastSuccessAt: row.lastSuccessAt ? iso(row.lastSuccessAt) : null,
    lastError: row.lastError,
  };
}

export async function getHubInboxSource(id: number) {
  const [row] = await db.select().from(hubInboxSource).where(eq(hubInboxSource.id, id));
  return row ?? null;
}

export async function updateHubInboxSource(
  id: number,
  patch: {
    enabled?: boolean;
    confidenceThreshold?: number;
    autoCreateTasks?: boolean;
    autoTaskProjectId?: number | null;
    automationActorUserId?: string | null;
  },
) {
  const set: Partial<typeof hubInboxSource.$inferInsert> = { updatedAt: new Date() };
  if (patch.enabled !== undefined) {
    set.enabled = patch.enabled;
    set.status = patch.enabled ? 'connecting' : 'disabled';
    set.nextSyncAt = new Date();
  }
  if (patch.confidenceThreshold !== undefined) set.confidenceThreshold = patch.confidenceThreshold;
  if (patch.autoCreateTasks !== undefined) set.autoCreateTasks = patch.autoCreateTasks;
  if (patch.autoTaskProjectId !== undefined) set.autoTaskProjectId = patch.autoTaskProjectId;
  if (patch.automationActorUserId !== undefined)
    set.automationActorUserId = patch.automationActorUserId;
  await db.update(hubInboxSource).set(set).where(eq(hubInboxSource.id, id));
  const row = await getHubInboxSource(id);
  return row ? mapSource(row) : null;
}

export async function listHubInboxThreads(filters: HubInboxFilters) {
  const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);
  const where: SQL[] = [eq(hubInboxThread.teamId, filters.teamId)];
  if (filters.projectId != null) where.push(eq(hubInboxThread.projectId, filters.projectId));
  if (filters.channel) where.push(eq(hubInboxSource.channel, filters.channel));
  if (filters.status) where.push(eq(hubInboxThread.status, filters.status));
  if (filters.priority) where.push(eq(hubInboxThread.priority, filters.priority));
  if (filters.needsReview) where.push(eq(hubInboxThread.triageStatus, 'needs_review'));
  if (filters.cursor) {
    const date = new Date(filters.cursor.ts);
    if (!Number.isFinite(date.getTime())) throw new HttpError(400, 'Invalid cursor');
    where.push(
      or(
        lt(hubInboxThread.receivedAt, date),
        and(eq(hubInboxThread.receivedAt, date), lt(hubInboxThread.id, filters.cursor.id)),
      )!,
    );
  }
  const rows = await db
    .select({
      id: hubInboxThread.id,
      teamId: hubInboxThread.teamId,
      sourceId: hubInboxThread.sourceId,
      channel: hubInboxSource.channel,
      account: hubInboxSource.account,
      externalThreadId: hubInboxThread.externalThreadId,
      sender: hubInboxThread.sender,
      subject: hubInboxThread.subject,
      snippet: hubInboxThread.snippet,
      receivedAt: hubInboxThread.receivedAt,
      messageCount: hubInboxThread.messageCount,
      projectId: hubInboxThread.projectId,
      projectKey: project.key,
      projectName: project.name,
      issueId: hubInboxThread.issueId,
      issueSequenceNumber: issue.sequenceNumber,
      issueIdentifier: sql<
        string | null
      >`CASE WHEN ${issue.id} IS NULL THEN NULL ELSE ${project.key} || '-' || ${issue.sequenceNumber} END`,
      issueTitle: issue.title,
      status: hubInboxThread.status,
      priority: hubInboxThread.priority,
      triageSummary: hubInboxThread.triageSummary,
      triageStatus: hubInboxThread.triageStatus,
      lastTriageError: hubInboxThread.lastTriageError,
      confidence: hubInboxThread.confidence,
      confidenceThreshold: hubInboxSource.confidenceThreshold,
      requiresAction: hubInboxThread.requiresAction,
      ticketStatus: hubInboxThread.ticketStatus,
    })
    .from(hubInboxThread)
    .innerJoin(hubInboxSource, eq(hubInboxSource.id, hubInboxThread.sourceId))
    .leftJoin(project, eq(project.id, hubInboxThread.projectId))
    .leftJoin(issue, eq(issue.id, hubInboxThread.issueId))
    .where(and(...where))
    .orderBy(desc(hubInboxThread.receivedAt), desc(hubInboxThread.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map((row) => ({
    ...row,
    externalUrl: exactSourceUrl(row.channel, row.externalThreadId),
    channel: row.channel as 'mail' | 'whatsapp',
    status: row.status as 'new' | 'assigned' | 'waiting' | 'done',
    priority: row.priority as 'low' | 'medium' | 'high' | 'urgent' | null,
    triageStatus: row.triageStatus as
      'pending' | 'queued' | 'running' | 'succeeded' | 'needs_review' | 'failed' | 'skipped',
    ticketStatus: row.ticketStatus as
      'none' | 'pending' | 'running' | 'created' | 'failed' | 'skipped',
    receivedAt: iso(row.receivedAt),
  }));
  const last = page.at(-1);
  return {
    items: page,
    nextCursor:
      hasMore && last ? ({ ts: last.receivedAt, id: last.id } satisfies HubInboxCursor) : null,
  };
}

export async function getHubInboxThread(id: string) {
  const [row] = await db
    .select({
      id: hubInboxThread.id,
      teamId: hubInboxThread.teamId,
      projectId: hubInboxThread.projectId,
      issueId: hubInboxThread.issueId,
      ticketStatus: hubInboxThread.ticketStatus,
    })
    .from(hubInboxThread)
    .where(eq(hubInboxThread.id, id));
  return row ?? null;
}

export async function updateHubInboxThread(
  id: string,
  patch: {
    status?: 'new' | 'assigned' | 'waiting' | 'done';
    projectId?: number | null;
    issueId?: number | null;
  },
) {
  const set: Partial<typeof hubInboxThread.$inferInsert> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.projectId !== undefined) {
    set.projectId = patch.projectId;
    set.issueId = null;
    set.ticketStatus = 'none';
    if (patch.projectId == null) set.status = 'new';
    else set.status = 'assigned';
  }
  if (patch.issueId !== undefined) {
    set.issueId = patch.issueId;
    set.ticketStatus = patch.issueId == null ? 'none' : 'created';
    if (patch.issueId != null) set.status = 'assigned';
  }
  await db.update(hubInboxThread).set(set).where(eq(hubInboxThread.id, id));
  return getHubInboxThread(id);
}

export async function retryHubInboxTriage(id: string): Promise<boolean> {
  const rows = await db
    .update(hubInboxThread)
    .set({
      triageStatus: 'pending',
      triageRunId: null,
      triageGeneration: sql`${hubInboxThread.triageGeneration} + 1`,
      triageAttempts: 0,
      nextTriageAt: new Date(),
      lastTriageError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(hubInboxThread.id, id),
        inArray(hubInboxThread.triageStatus, ['failed', 'needs_review']),
      ),
    )
    .returning({ id: hubInboxThread.id });
  return rows.length === 1;
}

export async function resolveInboxProject(teamId: number, projectId: number) {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)));
  return row ?? null;
}

export async function resolveInboxIssue(teamId: number, issueId: number) {
  const [row] = await db
    .select({ issueId: issue.id, projectId: project.id })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .where(and(eq(issue.id, issueId), eq(project.teamId, teamId)));
  return row ?? null;
}

export function parseHubInboxCursor(value?: string): HubInboxCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<HubInboxCursor>;
    if (typeof parsed.ts !== 'string' || typeof parsed.id !== 'string') {
      throw new HttpError(400, 'Invalid cursor');
    }
    return { ts: parsed.ts, id: parsed.id };
  } catch {
    throw new HttpError(400, 'Invalid cursor');
  }
}

// The thread in Plan's inbox a mail event came from; the mail importer names it
// "mail-thread:<id>".
export function exactSourceUrl(channel: string, threadId: string): string | null {
  const match = channel === 'mail' ? /^mail-thread:(\d+)$/.exec(threadId) : null;
  return match ? `/inbox?thread=${match[1]}` : null;
}
