import {
  db,
  agentRun,
  agentChatMessage,
  agentChatThread,
  aiAgent,
  approvalRequest,
  helenaGoalTask,
  helenaProjectGoalLink,
  helenaBudget,
  issue,
  notification,
  organizationAgentAssignment,
  organizationDepartment,
  organizationGoal,
  organizationProjectAssignment,
  project,
  projectMember,
  user,
} from '@repo/db';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { createComment } from '#modules/issues/activity';
import { issueWhy } from '#modules/project-goals/ladder';
import {
  metricValue,
  periodStart,
  usageSince,
  type BudgetMetric,
  type BudgetPeriod,
  type UsageTotals,
} from './usage';

// Budgets of tasks, agents, projects, goals and departments: tokens, euros and seconds per UTC
// day, week or month. At 80 % heartbeats slow down; at 100 % new work stops and the
// owner gets an approval card.

type Database = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type BudgetRow = typeof helenaBudget.$inferSelect;

export const WARN_RATIO = 0.8;

export interface BudgetStatus {
  id: number;
  scope: 'issue' | 'agent' | 'project' | 'goal' | 'department';
  agentId: number | null;
  issueId: number | null;
  projectId: number | null;
  departmentId: number | null;
  goalId: number | null;
  metric: BudgetMetric;
  period: BudgetPeriod;
  limit: number;
  used: number;
  remaining: number;
  // used / limit.
  ratio: number;
  periodStart: string;
  warned: boolean;
  reached: boolean;
  throttled: boolean;
  // Runs that may still start past the limit in this period ("Einmalig fortsetzen"), and
  // the runs that started on it, which finish unhindered.
  graceRuns: number;
  graceRunIds: number[];
  // For a cost budget: tokens of models the price table has no price for, which count
  // nothing here.
  unpricedTokens: number;
}

function sameStart(value: Date | null, start: Date): boolean {
  return value != null && value.getTime() === start.getTime();
}

function toStatus(row: BudgetRow, usage: UsageTotals | undefined): BudgetStatus {
  const metric = row.metric as BudgetMetric;
  const period = row.period as BudgetPeriod;
  const start = periodStart(period);
  const used = usage ? metricValue(usage, metric) : 0;
  const limit = row.limitValue;
  return {
    id: row.id,
    scope:
      row.issueId != null
        ? 'issue'
        : row.agentId != null
          ? 'agent'
          : row.projectId != null
            ? 'project'
            : row.goalId != null
              ? 'goal'
              : 'department',
    agentId: row.agentId,
    issueId: row.issueId,
    projectId: row.projectId,
    departmentId: row.departmentId,
    goalId: row.goalId,
    metric,
    period,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    ratio: limit > 0 ? used / limit : 0,
    periodStart: start.toISOString(),
    warned: sameStart(row.warnedFor, start),
    reached: used >= limit,
    throttled: limit > 0 && used >= limit * WARN_RATIO && used < limit,
    graceRuns: sameStart(row.graceFor, start) ? row.graceRuns : 0,
    graceRunIds: sameStart(row.graceFor, start) ? (row.graceRunIds ?? []) : [],
    unpricedTokens: metric === 'cost' ? (usage?.unpricedTokens ?? 0) : 0,
  };
}

// The status of budgets for the requested scopes.
export async function budgetStatuses(targets: {
  agentIds?: number[];
  issueIds?: number[];
  projectIds?: number[];
  departmentIds?: number[];
  goalIds?: number[];
}): Promise<BudgetStatus[]> {
  const agentIds = targets.agentIds ?? [];
  const issueIds = targets.issueIds ?? [];
  const projectIds = targets.projectIds ?? [];
  const departmentIds = targets.departmentIds ?? [];
  const goalIds = targets.goalIds ?? [];
  if (
    issueIds.length === 0 &&
    agentIds.length === 0 &&
    projectIds.length === 0 &&
    departmentIds.length === 0 &&
    goalIds.length === 0
  )
    return [];
  const rows = await db
    .select()
    .from(helenaBudget)
    .where(
      or(
        agentIds.length > 0 ? inArray(helenaBudget.agentId, agentIds) : undefined,
        issueIds.length > 0 ? inArray(helenaBudget.issueId, issueIds) : undefined,
        projectIds.length > 0 ? inArray(helenaBudget.projectId, projectIds) : undefined,
        departmentIds.length > 0 ? inArray(helenaBudget.departmentId, departmentIds) : undefined,
        goalIds.length > 0 ? inArray(helenaBudget.goalId, goalIds) : undefined,
      ),
    )
    .orderBy(helenaBudget.id);
  if (rows.length === 0) return [];
  const wantAgents = [...new Set(rows.flatMap((r) => (r.agentId != null ? [r.agentId] : [])))];
  const wantIssues = [...new Set(rows.flatMap((r) => (r.issueId != null ? [r.issueId] : [])))];
  const wantProjects = [
    ...new Set(rows.flatMap((r) => (r.projectId != null ? [r.projectId] : []))),
  ];
  const wantDepartments = [
    ...new Set(rows.flatMap((r) => (r.departmentId != null ? [r.departmentId] : []))),
  ];
  const wantGoals = [...new Set(rows.flatMap((r) => (r.goalId != null ? [r.goalId] : [])))];
  const scopes = {
    issue: wantIssues,
    agent: wantAgents,
    project: wantProjects,
    goal: wantGoals,
    department: wantDepartments,
  } as const;
  const usage = new Map<string, Map<number, UsageTotals>>();
  await Promise.all(
    (Object.entries(scopes) as [keyof typeof scopes, number[]][]).flatMap(([scope, ids]) =>
      (['day', 'week', 'month'] as BudgetPeriod[])
        .filter((period) => ids.length > 0 && rows.some((row) => row.period === period))
        .map(async (period) => {
          usage.set(`${scope}:${period}`, await usageSince(scope, ids, periodStart(period)));
        }),
    ),
  );
  return rows.map((row) => {
    const scope =
      row.issueId != null
        ? 'issue'
        : row.agentId != null
          ? 'agent'
          : row.projectId != null
            ? 'project'
            : row.goalId != null
              ? 'goal'
              : 'department';
    const id = row.issueId ?? row.agentId ?? row.projectId ?? row.goalId ?? row.departmentId!;
    return toStatus(row, usage.get(`${scope}:${row.period}`)?.get(id));
  });
}

const METRIC_TEXT: Record<BudgetMetric, string> = {
  tokens: 'token',
  cost: 'cost',
  time: 'time',
};

function number(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

// "110 of 100 tokens", "€1.20 of €1.00", "12 of 10 min".
function usedOf(metric: BudgetMetric, used: number, limit: number): string {
  if (metric === 'cost') return `€${used.toFixed(2)} of €${limit.toFixed(2)}`;
  if (metric === 'time') return `${number(used / 60)} of ${number(limit / 60)} min`;
  return `${number(used)} of ${number(limit)} tokens`;
}

// The reason an exhausted budget gives, in the words the pause reason and the comments use.
// Starts with "Budget reached" so a pause it caused can be told apart.
export function budgetReason(
  status: BudgetStatus,
  projectKey?: string | null,
  departmentName?: string | null,
): string {
  const periodText =
    status.period === 'day' ? 'Daily' : status.period === 'week' ? 'Weekly' : 'Monthly';
  const of =
    status.scope === 'issue'
      ? ` of task #${status.issueId}`
      : status.scope === 'project' && projectKey
        ? ` of project ${projectKey}`
        : status.scope === 'goal'
          ? ` of goal #${status.goalId}`
          : status.scope === 'department' && departmentName
            ? ` of department ${departmentName}`
            : '';
  const when =
    status.period === 'day'
      ? 'today (UTC)'
      : status.period === 'week'
        ? 'this week (UTC)'
        : 'this month (UTC)';
  return (
    `${BUDGET_REASON_PREFIX}: ${periodText.toLowerCase()} ${METRIC_TEXT[status.metric]} budget${of}, ` +
    `${usedOf(status.metric, status.used, status.limit)} used ${when}.`
  );
}

export const BUDGET_REASON_PREFIX = 'Budget reached';

export function isBudgetPause(reason: string | null | undefined): boolean {
  return reason?.startsWith(BUDGET_REASON_PREFIX) === true;
}

// Who a notice about an agent on an issue of the project goes to, as the handles a
// comment mentions them by: the preferred person while they are a member of the
// project, otherwise the project's owners.
export async function noticeRecipients(
  projectId: number,
  preferredUserId: string | null,
): Promise<string[]> {
  const members = await db
    .select({ id: user.id, username: user.username, role: projectMember.role })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .where(and(eq(projectMember.projectId, projectId), isNotNull(user.username)));
  const preferred = members.find((member) => member.id === preferredUserId);
  const recipients = preferred ? [preferred] : members.filter((m) => m.role === 'owner');
  return recipients.map((member) => `@${member.username}`);
}

interface AgentFacts {
  role: string;
  id: number;
  teamId: number;
  userId: string;
  ownerUserId: string | null;
  pausedAt: Date | null;
  pauseReason: string | null;
}

async function agentFacts(agentId: number, database: Database = db): Promise<AgentFacts | null> {
  const [row] = await database
    .select({
      id: aiAgent.id,
      role: aiAgent.agentRole,
      teamId: aiAgent.teamId,
      userId: aiAgent.userId,
      ownerUserId: aiAgent.ownerUserId,
      pausedAt: aiAgent.pausedAt,
      pauseReason: aiAgent.pauseReason,
    })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  return row ?? null;
}

async function projectKeyOf(projectId: number): Promise<string | null> {
  const [row] = await db
    .select({ key: project.key })
    .from(project)
    .where(eq(project.id, projectId));
  return row?.key ?? null;
}

// Project ownership wins; a project without an assignment follows the agent's department.
async function departmentOfWork(
  agentId: number,
  projectId: number | null,
): Promise<{ id: number; name: string } | null> {
  const [row] = await db
    .select({
      id: organizationDepartment.id,
      name: organizationDepartment.name,
    })
    .from(aiAgent)
    .leftJoin(
      organizationProjectAssignment,
      projectId == null
        ? sql`false`
        : and(
            eq(organizationProjectAssignment.projectId, projectId),
            eq(organizationProjectAssignment.teamId, aiAgent.teamId),
          ),
    )
    .leftJoin(
      organizationAgentAssignment,
      and(
        eq(organizationAgentAssignment.agentId, aiAgent.id),
        eq(organizationAgentAssignment.teamId, aiAgent.teamId),
      ),
    )
    .leftJoin(
      organizationDepartment,
      eq(
        organizationDepartment.id,
        sql`coalesce(${organizationProjectAssignment.departmentId}, ${organizationAgentAssignment.departmentId})`,
      ),
    )
    .where(eq(aiAgent.id, agentId));
  return row?.id == null ? null : { id: row.id, name: row.name! };
}

async function goalIdsOfIssue(issueId: number | null): Promise<number[]> {
  if (issueId == null) return [];
  const [task] = await db
    .select({ parentId: issue.parentId, initiativeId: issue.initiativeId })
    .from(issue)
    .where(eq(issue.id, issueId));
  if (!task) return [];
  const [direct] = await db
    .select({ goalId: helenaGoalTask.goalId })
    .from(helenaGoalTask)
    .where(eq(helenaGoalTask.issueId, issueId));
  const [parent] =
    direct || task.parentId == null
      ? []
      : await db
          .select({ goalId: helenaGoalTask.goalId })
          .from(helenaGoalTask)
          .where(eq(helenaGoalTask.issueId, task.parentId));
  const [initiative] =
    direct || parent || task.initiativeId == null
      ? []
      : await db
          .select({ goalId: helenaProjectGoalLink.goalId })
          .from(helenaProjectGoalLink)
          .where(eq(helenaProjectGoalLink.initiativeId, task.initiativeId));
  const goalId =
    direct?.goalId ?? parent?.goalId ?? initiative?.goalId ?? (await issueWhy(issueId))?.goal?.id;
  if (goalId == null) return [];
  const ids: number[] = [];
  let current: number | null = goalId;
  while (current != null && !ids.includes(current) && ids.length < 32) {
    ids.push(current);
    const [goal]: { parentId: number | null }[] = await db
      .select({ parentId: organizationGoal.parentGoalId })
      .from(organizationGoal)
      .where(eq(organizationGoal.id, current));
    current = goal?.parentId ?? null;
  }
  return ids;
}

async function issueIdOfRun(runId: number | null | undefined): Promise<number | null> {
  if (runId == null) return null;
  const [run] = await db
    .select({ issueId: agentRun.issueId })
    .from(agentRun)
    .where(eq(agentRun.id, runId));
  return run?.issueId ?? null;
}

async function issueIdOfChat(messageId: number | null | undefined): Promise<number | null> {
  if (messageId == null) return null;
  const [row] = await db
    .select({ issueId: agentChatThread.issueId })
    .from(agentChatMessage)
    .innerJoin(agentChatThread, eq(agentChatThread.id, agentChatMessage.threadId))
    .where(eq(agentChatMessage.id, messageId));
  return row?.issueId ?? null;
}

// Pauses the agent unless it already is. True when this call paused it.
export async function pauseForBudget(
  agentId: number,
  reason: string,
  database: Database = db,
): Promise<boolean> {
  const rows = await database
    .update(aiAgent)
    .set({ pausedAt: new Date(), pauseReason: reason })
    .where(and(eq(aiAgent.id, agentId), isNull(aiAgent.deletedAt), isNull(aiAgent.pausedAt)))
    .returning({ id: aiAgent.id });
  return rows.length > 0;
}

// Marks a period's warning (or reached limit) as sent; true for the one call that did.
async function claimOnce(
  id: number,
  column: 'warnedFor' | 'reachedFor',
  start: Date,
  database: Database = db,
): Promise<boolean> {
  const target = column === 'warnedFor' ? helenaBudget.warnedFor : helenaBudget.reachedFor;
  const rows = await database
    .update(helenaBudget)
    .set({ [column]: start, updatedAt: new Date() })
    .where(
      and(
        eq(helenaBudget.id, id),
        or(isNull(target), sql`${target} <> ${start.toISOString()}::timestamptz`),
      ),
    )
    .returning({ id: helenaBudget.id });
  return rows.length > 0;
}

// Files the owner's card for a budget that was reached: an approval request of kind
// 'budget' in the project the work was in. One pending card per budget.
async function fileBudgetCard(
  status: BudgetStatus,
  agentId: number,
  projectId: number,
  issueId: number | null,
  reason: string,
  database: Database,
): Promise<void> {
  const [pending] = await database
    .select({ id: approvalRequest.id })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.kind, 'budget'),
        eq(approvalRequest.status, 'pending'),
        sql`(${approvalRequest.payload}->>'budgetId')::int = ${status.id}`,
      ),
    );
  if (pending) return;
  await database.insert(approvalRequest).values({
    projectId,
    agentId,
    issueId,
    kind: 'budget',
    category: null,
    action: reason,
    details: '',
    policyReason: 'budget-exhausted',
    payload: {
      budgetId: status.id,
      scope: status.scope,
      metric: status.metric,
      period: status.period,
      limit: status.limit,
      used: status.used,
      periodStart: status.periodStart,
      agentId: status.agentId,
      issueId: status.issueId,
      projectId: status.projectId,
      departmentId: status.departmentId,
      goalId: status.goalId,
    },
  });
  if (issueId != null) {
    const agent = await agentFacts(agentId, database);
    const members = await database
      .select({
        userId: projectMember.userId,
        role: projectMember.role,
      })
      .from(projectMember)
      .where(eq(projectMember.projectId, projectId));
    const preferred = members.find((member) => member.userId === agent?.ownerUserId);
    const recipients = preferred
      ? [preferred]
      : members.filter((member) => member.role === 'owner');
    if (recipients.length > 0)
      await database.insert(notification).values(
        recipients.map((recipient) => ({
          userId: recipient.userId,
          projectId,
          issueId,
          sourceActivityId: null,
          type: 'approval_requested',
          actorUserId: agent?.userId ?? null,
        })),
      );
  }
}

// Warns at 80 % and files a card for every budget reached at 100 %, once per period.
export async function enforceBudgets(
  agentId: number,
  projectId: number | null,
  issueId: number | null,
): Promise<string | null> {
  const department = await departmentOfWork(agentId, projectId);
  const goalIds = await goalIdsOfIssue(issueId);
  const statuses = await budgetStatuses({
    issueIds: issueId == null ? [] : [issueId],
    agentIds: [agentId],
    projectIds: projectId == null ? [] : [projectId],
    departmentIds: department == null ? [] : [department.id],
    goalIds,
  });
  if (statuses.length === 0) return null;
  const agent = await agentFacts(agentId);
  if (!agent || agent.role === 'home') return null;
  const key = projectId == null ? null : await projectKeyOf(projectId);

  for (const status of statuses) {
    if (status.reached || status.ratio < WARN_RATIO || status.warned) continue;
    if (issueId == null || projectId == null) continue;
    if (!(await claimOnce(status.id, 'warnedFor', new Date(status.periodStart)))) continue;
    const handles = await noticeRecipients(
      projectId,
      status.scope === 'agent' ? agent.ownerUserId : null,
    );
    const percent = Math.floor(status.ratio * 100);
    await createComment({
      issueId,
      actorUserId: agent.userId,
      body: [
        ...handles,
        `Heads-up: ${percent} % of my ${status.period === 'day' ? 'daily' : status.period === 'week' ? 'weekly' : 'monthly'} ` +
          `${METRIC_TEXT[status.metric]} budget${status.scope === 'issue' ? ` of task #${status.issueId}` : status.scope === 'project' && key ? ` of project ${key}` : status.scope === 'goal' ? ` of goal #${status.goalId}` : status.scope === 'department' && department ? ` of department ${department.name}` : ''} ` +
          `is used (${usedOf(status.metric, status.used, status.limit)}). ` +
          'I stop taking new work when it is used up.',
      ].join(' '),
    });
  }

  const reached = statuses.filter((status) => status.reached);
  if (reached.length === 0) return null;
  const blocking = reached.filter((status) => status.graceRuns === 0);
  if (blocking.length === 0) return null;

  const first = blocking.find((status) => status.scope === 'agent') ?? blocking[0]!;
  const reason = budgetReason(first, key, department?.name);
  // Home chats have no execution project, but their reached department budget still
  // needs an Inbox card. Prefer the team's Home project, then its first project.
  let noticeProjectId = projectId;
  if (noticeProjectId == null) {
    const [home] = await db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.teamId, agent.teamId))
      .orderBy(sql`case when ${project.key} = 'HOME' then 0 else 1 end`, project.id)
      .limit(1);
    noticeProjectId = home?.id ?? null;
  }
  if (noticeProjectId == null) {
    if (first.scope === 'agent') await pauseForBudget(agentId, reason);
    return reason;
  }
  const { paused, filed } = await db.transaction(async (tx) => {
    let filed = false;
    for (const status of blocking) {
      if (!(await claimOnce(status.id, 'reachedFor', new Date(status.periodStart), tx))) continue;
      await fileBudgetCard(
        status,
        agentId,
        noticeProjectId,
        issueId,
        budgetReason(status, key, department?.name),
        tx,
      );
      filed = true;
    }
    const paused = first.scope === 'agent' ? await pauseForBudget(agentId, reason, tx) : false;
    return { paused, filed };
  });
  if ((paused || filed) && issueId != null) {
    const handles = await noticeRecipients(
      noticeProjectId,
      first.scope === 'agent' ? agent.ownerUserId : null,
    );
    await createComment({
      issueId,
      actorUserId: agent.userId,
      body: [
        ...handles,
        first.scope === 'agent'
          ? `I am paused and take no new work. ${reason}`
          : `The work of project ${key ?? ''} is on hold. ${reason}`,
        'Raise the budget or let me continue once from the card in Approvals.',
      ].join(' '),
    });
  }
  return reason;
}

// A heartbeat may be slowed before it queues more work. Project ownership takes
// precedence over the agent's department, as it does for the hard stop.
export async function heartbeatBudgetThrottled(
  agentId: number,
  projectId: number | null,
  issueId: number | null = null,
): Promise<boolean> {
  const department = projectId == null ? null : await departmentOfWork(agentId, projectId);
  const goalIds = await goalIdsOfIssue(issueId);
  const statuses = await budgetStatuses({
    issueIds: issueId == null ? [] : [issueId],
    agentIds: [agentId],
    projectIds: projectId == null ? [] : [projectId],
    departmentIds: department == null ? [] : [department.id],
    goalIds,
  });
  return statuses.some((status) => status.throttled);
}

// A claimed run that started past a used-up budget on "continue once": the grace is spent
// on it, and it finishes unhindered.
export async function useGrace(
  agentId: number,
  projectId: number,
  runId: number,
): Promise<boolean> {
  return reserveBudgetGrace(agentId, projectId, runId, await issueIdOfRun(runId));
}

// Run ids are positive; negative message ids keep chat reservations in a separate namespace.
export async function useChatGrace(
  agentId: number,
  projectId: number | null,
  messageId: number,
): Promise<boolean> {
  return reserveBudgetGrace(agentId, projectId, -messageId, await issueIdOfChat(messageId));
}

async function reserveBudgetGrace(
  agentId: number,
  projectId: number | null,
  workId: number,
  issueId: number | null,
): Promise<boolean> {
  if ((await agentFacts(agentId))?.role === 'home') return true;
  const department = await departmentOfWork(agentId, projectId);
  const goalIds = await goalIdsOfIssue(issueId);
  const statuses = await budgetStatuses({
    issueIds: issueId == null ? [] : [issueId],
    agentIds: [agentId],
    projectIds: projectId == null ? [] : [projectId],
    departmentIds: department == null ? [] : [department.id],
    goalIds,
  });
  const exhausted = new Error('No budget grace remains');
  try {
    await db.transaction(async (tx) => {
      for (const status of statuses.filter((s) => s.reached).sort((a, b) => a.id - b.id)) {
        const [current] = await tx
          .select()
          .from(helenaBudget)
          .where(eq(helenaBudget.id, status.id))
          .for('update');
        if (!current) continue;
        if (
          sameStart(current.graceFor, new Date(status.periodStart)) &&
          current.graceRunIds?.includes(workId)
        )
          continue;
        const rows = await tx
          .update(helenaBudget)
          .set({
            graceRuns: sql`${helenaBudget.graceRuns} - 1`,
            graceRunIds: sql`${helenaBudget.graceRunIds} || ${JSON.stringify([workId])}::jsonb`,
          })
          .where(
            and(
              eq(helenaBudget.id, status.id),
              eq(helenaBudget.graceFor, new Date(status.periodStart)),
              sql`${helenaBudget.graceRuns} > 0`,
            ),
          )
          .returning({ id: helenaBudget.id });
        if (rows.length === 0) throw exhausted;
      }
    });
    return true;
  } catch (error) {
    if (error === exhausted) return false;
    throw error;
  }
}

// The projects whose budgets are used up without a run left to continue on, among the
// given ones. A claim skips their runs, so the agent still works in its other projects.
export async function heldProjects(projectIds: number[], agentId?: number): Promise<number[]> {
  if (agentId != null && (await agentFacts(agentId))?.role === 'home') return [];
  if (projectIds.length === 0) return [];
  const assignments = await db
    .select({
      projectId: organizationProjectAssignment.projectId,
      departmentId: organizationProjectAssignment.departmentId,
    })
    .from(organizationProjectAssignment)
    .where(inArray(organizationProjectAssignment.projectId, projectIds));
  const agentDepartment =
    agentId == null ? null : ((await departmentOfWork(agentId, null))?.id ?? null);
  const departmentByProject = new Map(
    projectIds.map((projectId) => [
      projectId,
      assignments.find((row) => row.projectId === projectId)?.departmentId ?? agentDepartment,
    ]),
  );
  const statuses = await budgetStatuses({
    projectIds,
    departmentIds: [
      ...new Set([...departmentByProject.values()].flatMap((id) => (id == null ? [] : [id]))),
    ],
  });
  const held = new Set(
    statuses
      .filter((status) => status.scope === 'project' && status.reached && status.graceRuns === 0)
      .map((status) => status.projectId!),
  );
  for (const [projectId, departmentId] of departmentByProject) {
    if (
      statuses.some(
        (status) =>
          status.departmentId === departmentId && status.reached && status.graceRuns === 0,
      )
    ) {
      held.add(projectId);
    }
  }
  return [...held];
}

// Whether an applicable budget is used up for good right now. The
// policy engine denies every action but reading and reporting then.
export async function budgetExhausted(
  agentId: number | null,
  projectId: number | null,
  runId?: number | null,
  chatMessageId?: number | null,
): Promise<BudgetStatus | null> {
  if (agentId != null && (await agentFacts(agentId))?.role === 'home') return null;
  const department = agentId == null ? null : await departmentOfWork(agentId, projectId);
  const workId = runId ?? (chatMessageId == null ? null : -chatMessageId);
  const issueId = runId == null ? await issueIdOfChat(chatMessageId) : await issueIdOfRun(runId);
  const goalIds = await goalIdsOfIssue(issueId);
  const statuses = await budgetStatuses({
    issueIds: issueId == null ? [] : [issueId],
    agentIds: agentId == null ? [] : [agentId],
    projectIds: projectId == null ? [] : [projectId],
    departmentIds: department == null ? [] : [department.id],
    goalIds,
  });
  return (
    statuses.find(
      (status) => status.reached && !(workId != null && status.graceRunIds.includes(workId)),
    ) ?? null
  );
}

export interface BudgetInput {
  metric: BudgetMetric;
  period: BudgetPeriod;
  // Null removes the budget.
  limit: number | null;
}

export type BudgetTarget =
  | { issueId: number }
  | { agentId: number }
  | { projectId: number }
  | { goalId: number }
  | { departmentId: number };

// Sets the budgets named; the ones not named stay as they are. An agent whose budget
// pause no longer holds takes work again, and a pending card of a budget that is no longer
// reached is closed as raised.
export async function setBudgets(
  teamId: number,
  target: BudgetTarget,
  entries: BudgetInput[],
  deciderUserId: string | null,
): Promise<void> {
  for (const entry of entries) {
    const where = and(
      'issueId' in target
        ? eq(helenaBudget.issueId, target.issueId)
        : 'agentId' in target
          ? eq(helenaBudget.agentId, target.agentId)
          : 'projectId' in target
            ? eq(helenaBudget.projectId, target.projectId)
            : 'goalId' in target
              ? eq(helenaBudget.goalId, target.goalId)
              : eq(helenaBudget.departmentId, target.departmentId),
      eq(helenaBudget.metric, entry.metric),
      eq(helenaBudget.period, entry.period),
    );
    if (entry.limit == null) {
      await db.delete(helenaBudget).where(where);
      continue;
    }
    const updated = await db
      .update(helenaBudget)
      .set({ limitValue: entry.limit, updatedAt: new Date() })
      .where(where)
      .returning({ id: helenaBudget.id });
    if (updated.length === 0) {
      await db.insert(helenaBudget).values({
        teamId,
        ...('issueId' in target
          ? { issueId: target.issueId }
          : 'agentId' in target
            ? { agentId: target.agentId }
            : 'projectId' in target
              ? { projectId: target.projectId }
              : 'goalId' in target
                ? { goalId: target.goalId }
                : { departmentId: target.departmentId }),
        metric: entry.metric,
        period: entry.period,
        limitValue: entry.limit,
      });
    }
  }
  await settleBudgets(target, deciderUserId);
}

// After a budget changed: closes the cards of budgets no longer reached and lets an agent
// that a budget paused work again once none of its budgets holds it.
export async function settleBudgets(
  target: BudgetTarget,
  deciderUserId: string | null,
): Promise<void> {
  const statuses = await budgetStatuses(
    'issueId' in target
      ? { issueIds: [target.issueId] }
      : 'agentId' in target
        ? { agentIds: [target.agentId] }
        : 'projectId' in target
          ? { projectIds: [target.projectId] }
          : 'goalId' in target
            ? { goalIds: [target.goalId] }
            : { departmentIds: [target.departmentId] },
  );
  const open = await db
    .select({ id: approvalRequest.id, payload: approvalRequest.payload })
    .from(approvalRequest)
    .where(and(eq(approvalRequest.kind, 'budget'), eq(approvalRequest.status, 'pending')));
  for (const card of open) {
    const budgetId = (card.payload as { budgetId?: number } | null)?.budgetId;
    const status = statuses.find((s) => s.id === budgetId);
    const belongs =
      'issueId' in target
        ? (card.payload as { issueId?: number | null })?.issueId === target.issueId
        : 'agentId' in target
          ? (card.payload as { agentId?: number | null })?.agentId === target.agentId
          : 'projectId' in target
            ? (card.payload as { projectId?: number | null })?.projectId === target.projectId
            : 'goalId' in target
              ? (card.payload as { goalId?: number | null })?.goalId === target.goalId
              : (card.payload as { departmentId?: number | null })?.departmentId ===
                target.departmentId;
    if (!belongs) continue;
    if (status && status.reached && status.graceRuns === 0) continue;
    await db
      .update(approvalRequest)
      .set({
        status: 'approved',
        decidedByUserId: deciderUserId,
        decidedAt: new Date(),
        decisionNote: 'raised',
      })
      .where(and(eq(approvalRequest.id, card.id), eq(approvalRequest.status, 'pending')));
    if (budgetId != null) {
      await db.update(helenaBudget).set({ reachedFor: null }).where(eq(helenaBudget.id, budgetId));
    }
  }
  if (!('agentId' in target)) return;
  const agent = await agentFacts(target.agentId);
  if (!agent?.pausedAt || !isBudgetPause(agent.pauseReason)) return;
  if (statuses.some((status) => status.reached && status.graceRuns === 0)) return;
  await db
    .update(aiAgent)
    .set({ pausedAt: null, pauseReason: null })
    .where(eq(aiAgent.id, target.agentId));
}

// "Einmalig fortsetzen": one more run may start past the limit in this period. An agent the
// budget paused takes work again for it.
export async function continueOnce(budgetId: number): Promise<BudgetRow> {
  const [row] = await db.select().from(helenaBudget).where(eq(helenaBudget.id, budgetId));
  if (!row) throw new HttpError(404, 'Budget not found');
  const start = periodStart(row.period as BudgetPeriod);
  const [updated] = await db
    .update(helenaBudget)
    .set({
      graceFor: start,
      graceRuns: sql`CASE WHEN ${helenaBudget.graceFor} = ${start.toISOString()}::timestamptz
        THEN ${helenaBudget.graceRuns} + 1 ELSE 1 END`,
      graceRunIds: sql`CASE WHEN ${helenaBudget.graceFor} = ${start.toISOString()}::timestamptz
        THEN ${helenaBudget.graceRunIds} ELSE '[]'::jsonb END`,
      // Reached again after that run, the budget files a new card.
      reachedFor: null,
      updatedAt: new Date(),
    })
    .where(eq(helenaBudget.id, budgetId))
    .returning();
  if (row.agentId != null) {
    const agent = await agentFacts(row.agentId);
    if (agent?.pausedAt && isBudgetPause(agent.pauseReason)) {
      await db
        .update(aiAgent)
        .set({ pausedAt: null, pauseReason: null })
        .where(eq(aiAgent.id, row.agentId));
    }
  }
  return updated!;
}

export async function getBudget(budgetId: number): Promise<BudgetRow | null> {
  const [row] = await db.select().from(helenaBudget).where(eq(helenaBudget.id, budgetId));
  return row ?? null;
}
