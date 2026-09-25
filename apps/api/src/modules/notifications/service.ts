import {
  aiAgent,
  db,
  notification,
  pipelineRun,
  projectMember,
  user,
  issue,
  issueActivity,
  project,
  projectColumn,
  type ActivityPayload,
} from '@repo/db';
import { and, desc, eq, gte, inArray, lt, or, sql, isNull } from 'drizzle-orm';
import { addedMentionHandles, resolveMentionHandles, type MentionedUsers } from '#shared/mentions';
import { autoWatchIssue, watcherUserIds } from '#modules/issues/watchers';
import { activeRoutineRun, type RoutineOfRun } from '#modules/routines/agent-runs';
import { iso } from '#shared/lib';
import { enqueueOutbound } from './outbound';

// Inbox notifications. A notification is one (recipient, event) row: a user is told
// about an issue they are involved in. What happens on the issue ('commented',
// 'state_changed') goes to its watchers (issue_watcher, see modules/issues/watchers.ts);
// what is addressed to one person ('assigned', 'mentioned') goes to them whether
// they watch the issue or not, and subscribes them to it. The actor is never
// notified about their own action, and only project members receive notifications,
// so agent bot users (assigned via delegate, not members) are excluded.

export const NOTIFICATION_TYPES = [
  'assigned',
  'mentioned',
  'commented',
  'state_changed',
  'approval_requested',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NewNotificationRow {
  userId: string;
  projectId: number;
  issueId: number;
  sourceActivityId: number | null;
  type: NotificationType;
  actorUserId: string | null;
}

// Keeps only the ids that are members of the project. Filters out non-members (an
// agent's bot user is assigned via delegate but is not a member) and users who have
// lost access.
async function keepProjectMembers(projectId: number, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ userId: projectMember.userId })
    .from(projectMember)
    .where(and(eq(projectMember.projectId, projectId), inArray(projectMember.userId, ids)));
  return new Set(rows.map((r) => r.userId));
}

async function actorName(id: string | null): Promise<string | null> {
  if (id == null) return null;
  const rows = await db.select({ name: user.name }).from(user).where(eq(user.id, id));
  return rows[0]?.name ?? null;
}

async function insertNotifications(rows: NewNotificationRow[], detail?: string): Promise<void> {
  if (rows.length === 0) return;
  const name = await actorName(rows[0].actorUserId);
  await db.insert(notification).values(rows.map((r) => ({ ...r, actorName: name })));
  await deliver(rows, name, detail);
}

// Fan out to the project's enabled delivery channels (email, Telegram). Best-effort:
// a delivery failure must not break the inbox insert or the domain mutation.
async function deliver(rows: NewNotificationRow[], name: string | null, detail?: string) {
  try {
    await enqueueOutbound(rows, name, detail);
  } catch (err) {
    console.error('[notifications] outbound enqueue failed:', err);
  }
}

// ---- a routine's work is quiet ------------------------------------------------------
// A routine's run leaves its result in the routine's task (docs/helena-decisions/
// routine-mentions.md): what an agent writes there while it works on a routine's run — a
// comment, a status change — tells none of the task's watchers. A person it mentions is
// told at most once a day per routine, in the routine's time zone; the other mentions of
// that day stay in the task. A comment that asks for an answer the agent cannot go on
// without (a blocked question) always reaches the people it mentions, and a failed run or
// an approval request reach people by their own ways, as ever.

// The routine whose run the author of a write works on, when the author is an agent in one.
function routineRunOfActor(issueId: number, actorUserId: string | null) {
  return actorUserId ? activeRoutineRun(issueId, actorUserId) : Promise.resolve(null);
}

// Inserts the 'mentioned' rows of a routine run's write, leaving out every person an
// agent already mentioned on a task of the same routine today. The check and the insert
// hold a lock per routine, so two agents of one fire mentioning the same person at once
// still tell them once. Answers the rows it kept.
async function insertRoutineMentions(
  rows: NewNotificationRow[],
  routine: RoutineOfRun,
  issueId: number,
): Promise<NewNotificationRow[]> {
  if (rows.length === 0) return [];
  const name = await actorName(rows[0].actorUserId);
  const zone = routine.timezone ?? 'UTC';
  const kept = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`routine-mentions:${routine.scheduleId ?? routine.fireId}`}, 0))`,
    );
    const tasks = routine.scheduleId
      ? inArray(
          notification.issueId,
          tx
            .select({ id: pipelineRun.issueId })
            .from(pipelineRun)
            .where(
              and(eq(pipelineRun.kind, 'routine'), eq(pipelineRun.scheduleId, routine.scheduleId)),
            ),
        )
      : eq(notification.issueId, issueId);
    const told = await tx
      .selectDistinct({ userId: notification.userId })
      .from(notification)
      .innerJoin(aiAgent, eq(aiAgent.userId, notification.actorUserId))
      .where(
        and(
          eq(notification.type, 'mentioned'),
          inArray(
            notification.userId,
            rows.map((row) => row.userId),
          ),
          gte(
            notification.createdAt,
            sql`(date_trunc('day', now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone})`,
          ),
          tasks,
        ),
      );
    const already = new Set(told.map((row) => row.userId));
    const fresh = rows.filter((row) => !already.has(row.userId));
    if (fresh.length > 0)
      await tx.insert(notification).values(fresh.map((row) => ({ ...row, actorName: name })));
    return fresh;
  });
  if (kept.length > 0) await deliver(kept, name);
  return kept;
}

// The mentions of a write an agent made in a routine's run: told as above, and only the
// people told are subscribed to the task by it.
async function notifyRoutineMentions(
  projectId: number,
  issueId: number,
  rows: NewNotificationRow[],
  routine: RoutineOfRun,
  asksForInput: boolean,
): Promise<void> {
  if (asksForInput) {
    await autoWatchIssue(
      projectId,
      issueId,
      rows.map((row) => row.userId),
    );
    await insertNotifications(rows);
    return;
  }
  const kept = await insertRoutineMentions(rows, routine, issueId);
  await autoWatchIssue(
    projectId,
    issueId,
    kept.map((row) => row.userId),
  );
}

// Fan out a new comment. Mentioned members get a 'mentioned' notification; the
// watchers get 'commented'. A mentioned user gets only the 'mentioned' one. The
// comment author is never notified. Commenting and being mentioned both subscribe
// to the issue, so the watchers are resolved after that.
//
// An agent's comment in a routine's run keeps quiet (see above): no watcher is told, and
// a mention reaches a person once a day per routine unless `asksForInput`.
export async function notifyComment(
  projectId: number,
  comment: { issueId: number; id: number; actorUserId: string | null; body: string | null },
  mentionedUsers: MentionedUsers,
  opts?: { asksForInput?: boolean },
): Promise<void> {
  const actor = comment.actorUserId;
  const mentioned = new Set([...mentionedUsers.memberIds, ...mentionedUsers.agentUserIds]);
  const routine = await routineRunOfActor(comment.issueId, actor);
  if (routine) {
    const rows = [...mentioned]
      .filter((userId) => userId !== actor)
      .map((userId) => ({
        userId,
        projectId,
        issueId: comment.issueId,
        sourceActivityId: comment.id,
        type: 'mentioned' as const,
        actorUserId: actor,
      }));
    await notifyRoutineMentions(
      projectId,
      comment.issueId,
      rows,
      routine,
      opts?.asksForInput === true,
    );
    return;
  }
  await autoWatchIssue(projectId, comment.issueId, [actor, ...mentioned]);
  const watchers = await watcherUserIds(projectId, comment.issueId);

  const rows: NewNotificationRow[] = [];
  for (const userId of mentioned) {
    if (userId === actor) continue;
    rows.push({
      userId,
      projectId,
      issueId: comment.issueId,
      sourceActivityId: comment.id,
      type: 'mentioned',
      actorUserId: actor,
    });
  }
  for (const userId of watchers) {
    if (userId === actor || mentioned.has(userId)) continue;
    rows.push({
      userId,
      projectId,
      issueId: comment.issueId,
      sourceActivityId: comment.id,
      type: 'commented',
      actorUserId: actor,
    });
  }
  await insertNotifications(rows);
}

// Fan out the mentions an edit newly added to a comment. The handles the comment
// already named are filtered out by the caller, so an edit never re-pings them, and
// the watchers hear nothing (unlike a new comment, which would send 'commented').
// Being mentioned subscribes to the issue, the same as in a new comment.
export async function notifyEditedCommentMentions(
  projectId: number,
  comment: { issueId: number; id: number; actorUserId: string | null },
  mentionedUsers: MentionedUsers,
): Promise<void> {
  const mentioned = [...mentionedUsers.memberIds, ...mentionedUsers.agentUserIds].filter(
    (userId) => userId !== comment.actorUserId,
  );
  if (mentioned.length === 0) return;
  const rows = mentioned.map((userId) => ({
    userId,
    projectId,
    issueId: comment.issueId,
    sourceActivityId: comment.id,
    type: 'mentioned' as const,
    actorUserId: comment.actorUserId,
  }));
  const routine = await routineRunOfActor(comment.issueId, comment.actorUserId);
  if (routine) {
    await notifyRoutineMentions(projectId, comment.issueId, rows, routine, false);
    return;
  }
  await autoWatchIssue(projectId, comment.issueId, mentioned);
  await insertNotifications(rows);
}

// Fan out the mentions an issue's description or markdown custom field gained. Only
// the handles the write added are reached, so re-saving a text keeps quiet about the
// people it already named. Being mentioned subscribes to the issue, the same as it
// does in a comment. Only the members named are reached: the text describes the work
// rather than addressing anyone, so an agent named in it is neither notified nor
// given a run — an agent is addressed in a comment, or given an issue by delegation.
export async function notifyTextMentions(input: {
  projectId: number;
  issueId: number;
  actorUserId: string | null;
  // The change-log entry the write recorded, so the inbox item links to it.
  sourceActivityId: number | null;
  before: string;
  after: string;
}): Promise<void> {
  const { projectId, issueId, actorUserId: actor } = input;
  const handles = addedMentionHandles(input.before, input.after);
  if (handles.length === 0) return;
  const { memberIds } = await resolveMentionHandles(projectId, handles);
  if (memberIds.length === 0) return;
  await autoWatchIssue(projectId, issueId, memberIds);
  await insertNotifications(
    memberIds
      .filter((userId) => userId !== actor)
      .map((userId) => ({
        userId,
        projectId,
        issueId,
        sourceActivityId: input.sourceActivityId,
        type: 'mentioned' as const,
        actorUserId: actor,
      })),
  );
}

// Fan out issue field changes recorded by an update. A new assignee (if a member and
// not the actor) gets 'assigned'; a status change notifies the issue's watchers with
// 'state_changed'. The actor is never notified. Being assigned subscribes to the
// issue, and stays that way when the issue is later handed to someone else. A `quiet`
// change (a routine reopening its task) and a status change an agent makes in a routine's
// run tell no watcher.
export async function notifyIssueChange(input: {
  projectId: number;
  issueId: number;
  actorUserId: string | null;
  assignedUserId?: string | null;
  assignedActivityId?: number | null;
  statusChanged?: boolean;
  statusActivityId?: number | null;
  quiet?: boolean;
}): Promise<void> {
  const { projectId, issueId, actorUserId: actor } = input;
  const rows: NewNotificationRow[] = [];

  if (input.assignedUserId) {
    await autoWatchIssue(projectId, issueId, [input.assignedUserId]);
    if (input.assignedUserId !== actor) {
      const members = await keepProjectMembers(projectId, [input.assignedUserId]);
      if (members.has(input.assignedUserId)) {
        rows.push({
          userId: input.assignedUserId,
          projectId,
          issueId,
          sourceActivityId: input.assignedActivityId ?? null,
          type: 'assigned',
          actorUserId: actor,
        });
      }
    }
  }

  if (
    input.statusChanged &&
    !input.quiet &&
    !(await routineRunOfActor(input.issueId, input.actorUserId))
  ) {
    const assigned = input.assignedUserId ?? null;
    const watchers = await watcherUserIds(projectId, issueId);
    for (const userId of watchers) {
      // Skip the actor and anyone already told they were just assigned.
      if (userId === actor || userId === assigned) continue;
      rows.push({
        userId,
        projectId,
        issueId,
        sourceActivityId: input.statusActivityId ?? null,
        type: 'state_changed',
        actorUserId: actor,
      });
    }
  }

  await insertNotifications(rows);
}

// Tells the people who may decide an agent's approval request that it arrived. The
// inbox row points at the request's issue, so a request made outside an issue is only
// shown on the approvals page. `action` is what the agent asks to do, carried into the
// email and Telegram text.
export async function notifyApprovalRequested(input: {
  projectId: number;
  issueId: number;
  agentUserId: string;
  recipientUserIds: string[];
  action: string;
}): Promise<void> {
  await insertNotifications(
    input.recipientUserIds.map((userId) => ({
      userId,
      projectId: input.projectId,
      issueId: input.issueId,
      sourceActivityId: null,
      type: 'approval_requested' as const,
      actorUserId: input.agentUserId,
    })),
    input.action,
  );
}

// --- Inbox read + mutations ------------------------------------------------------

// A notification enriched with the issue and project it points at, so the inbox can
// render a row (identifier, title, project, actor, status) without extra calls.
export interface NotificationRow {
  id: number;
  type: NotificationType;
  actorUserId: string | null;
  actorName: string | null;
  readAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  issueId: number;
  issueSeq: number;
  issueTitle: string;
  issueStateType: string;
  projectId: number;
  projectKey: string;
  projectName: string;
  // Only a 'state_changed' event has them, and only while its activity row lives.
  fromState: string | null;
  toState: string | null;
}

export interface NotificationCursor {
  ts: string;
  id: number;
}

export interface NotificationPage {
  items: NotificationRow[];
  nextCursor: NotificationCursor | null;
}

export interface NotificationFilters {
  types?: NotificationType[];
  fromUserId?: string;
  projectId?: number;
  includeRead?: boolean;
  includeSnoozed?: boolean;
}

function mapRow(r: {
  id: number;
  type: string;
  actorUserId: string | null;
  actorName: string | null;
  readAt: Date | null;
  snoozedUntil: Date | null;
  createdAt: Date;
  issueId: number;
  issueSeq: number;
  issueTitle: string;
  issueStateType: string;
  projectId: number;
  projectKey: string;
  projectName: string;
  payload: ActivityPayload | null;
}): NotificationRow {
  const stateChange = r.type === 'state_changed';
  return {
    id: r.id,
    type: r.type as NotificationType,
    actorUserId: r.actorUserId,
    actorName: r.actorName,
    readAt: r.readAt ? iso(r.readAt) : null,
    snoozedUntil: r.snoozedUntil ? iso(r.snoozedUntil) : null,
    createdAt: iso(r.createdAt),
    issueId: r.issueId,
    issueSeq: r.issueSeq,
    issueTitle: r.issueTitle,
    issueStateType: r.issueStateType,
    projectId: r.projectId,
    projectKey: r.projectKey,
    projectName: r.projectName,
    fromState: stateChange ? (r.payload?.from?.value ?? null) : null,
    toState: stateChange ? (r.payload?.to?.value ?? null) : null,
  };
}

// One page of a user's inbox, newest first, keyset-paged on (created_at, id).
// Only projects the user is still a member of: the row carries the issue title, its
// current state and the project name read at query time, so a removed member must
// not reach them. includeRead defaults to true (the inbox shows read notifications
// too); a snoozed notification (snoozed_until still in the future) is hidden unless
// includeSnoozed. limit is clamped to 1..100.
export async function listNotifications(
  userId: string,
  opts: { before?: NotificationCursor | null; limit?: number; filters?: NotificationFilters } = {},
): Promise<NotificationPage> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const before = opts.before ?? null;
  const f = opts.filters ?? {};
  const conds = [eq(notification.userId, userId)];
  if (f.types && f.types.length) conds.push(inArray(notification.type, f.types));
  if (f.fromUserId) conds.push(eq(notification.actorUserId, f.fromUserId));
  if (f.projectId != null) conds.push(eq(notification.projectId, f.projectId));
  if (f.includeRead === false) conds.push(isNull(notification.readAt));
  if (!f.includeSnoozed)
    conds.push(or(isNull(notification.snoozedUntil), lt(notification.snoozedUntil, sql`now()`))!);
  if (before)
    conds.push(
      sql`(${notification.createdAt}, ${notification.id}) < (${before.ts}::timestamptz, ${before.id}::integer)`,
    );

  const rows = await db
    .select({
      id: notification.id,
      type: notification.type,
      actorUserId: notification.actorUserId,
      actorName: notification.actorName,
      readAt: notification.readAt,
      snoozedUntil: notification.snoozedUntil,
      createdAt: notification.createdAt,
      cursorTs: sql<string>`${notification.createdAt}::text`,
      issueId: issue.id,
      issueSeq: issue.sequenceNumber,
      issueTitle: issue.title,
      issueStateType: projectColumn.stateType,
      projectId: project.id,
      projectKey: project.key,
      projectName: project.name,
      payload: issueActivity.payload,
    })
    .from(notification)
    .innerJoin(
      projectMember,
      and(eq(projectMember.projectId, notification.projectId), eq(projectMember.userId, userId)),
    )
    .innerJoin(issue, eq(issue.id, notification.issueId))
    .innerJoin(project, eq(project.id, notification.projectId))
    .innerJoin(projectColumn, eq(projectColumn.id, issue.columnId))
    .leftJoin(issueActivity, eq(issueActivity.id, notification.sourceActivityId))
    .where(and(...conds))
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(mapRow),
    nextCursor: hasMore && last ? { ts: last.cursorTs, id: last.id } : null,
  };
}

// The number of unread, non-snoozed notifications for the inbox badge, optionally
// scoped to one project. Counts only what listNotifications shows.
export async function unreadCount(userId: string, projectId?: number): Promise<number> {
  const conds = [
    eq(notification.userId, userId),
    isNull(notification.readAt),
    or(isNull(notification.snoozedUntil), lt(notification.snoozedUntil, sql`now()`)),
  ];
  if (projectId != null) conds.push(eq(notification.projectId, projectId));
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notification)
    .innerJoin(
      projectMember,
      and(eq(projectMember.projectId, notification.projectId), eq(projectMember.userId, userId)),
    )
    .where(and(...conds));
  return row?.n ?? 0;
}

// Marks one of the user's notifications read or unread. Returns false if no such
// notification belongs to the user.
export async function setNotificationRead(
  userId: string,
  id: number,
  read: boolean,
): Promise<boolean> {
  const rows = await db
    .update(notification)
    .set({ readAt: read ? sql`now()` : null })
    .where(and(eq(notification.id, id), eq(notification.userId, userId)))
    .returning({ id: notification.id });
  return rows.length > 0;
}

// Marks every unread notification of the user read, optionally scoped to a project.
// Returns how many were updated.
export async function markAllRead(userId: string, projectId?: number): Promise<number> {
  const conds = [eq(notification.userId, userId), isNull(notification.readAt)];
  if (projectId != null) conds.push(eq(notification.projectId, projectId));
  const rows = await db
    .update(notification)
    .set({ readAt: sql`now()` })
    .where(and(...conds))
    .returning({ id: notification.id });
  return rows.length;
}

// Snoozes one of the user's notifications until the given time (null clears it).
// Returns false if no such notification belongs to the user.
export async function snoozeNotification(
  userId: string,
  id: number,
  until: Date | null,
): Promise<boolean> {
  const rows = await db
    .update(notification)
    .set({ snoozedUntil: until })
    .where(and(eq(notification.id, id), eq(notification.userId, userId)))
    .returning({ id: notification.id });
  return rows.length > 0;
}

// Deletes one of the user's notifications. Returns false if it did not belong to
// the user.
export async function deleteNotification(userId: string, id: number): Promise<boolean> {
  const rows = await db
    .delete(notification)
    .where(and(eq(notification.id, id), eq(notification.userId, userId)))
    .returning({ id: notification.id });
  return rows.length > 0;
}

export type DeleteScope = 'all' | 'read' | 'read-completed';

// Bulk-deletes the user's notifications by scope: all, all read, or all read whose
// issue is in a completed or canceled column. Scoped to one project when projectId
// is given (the per-project inbox). Returns how many were deleted.
export async function deleteNotifications(
  userId: string,
  scope: DeleteScope,
  projectId?: number,
): Promise<number> {
  const conds = [eq(notification.userId, userId)];
  if (projectId != null) conds.push(eq(notification.projectId, projectId));
  if (scope === 'read' || scope === 'read-completed')
    conds.push(sql`${notification.readAt} is not null`);
  if (scope === 'read-completed') {
    // read notifications whose issue sits in a completed/canceled column.
    const completedIssues = db
      .select({ id: issue.id })
      .from(issue)
      .innerJoin(projectColumn, eq(projectColumn.id, issue.columnId))
      .where(inArray(projectColumn.stateType, ['completed', 'canceled']));
    conds.push(inArray(notification.issueId, completedIssues));
  }
  const rows = await db
    .delete(notification)
    .where(and(...conds))
    .returning({ id: notification.id });
  return rows.length;
}
