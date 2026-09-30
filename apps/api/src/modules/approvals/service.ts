import {
  db,
  agentRun,
  aiAgent,
  approvalRequest,
  issue,
  project,
  projectMember,
  teamRole,
  user,
} from '@repo/db';
import { alias } from 'drizzle-orm/pg-core';
import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { enqueueAgentRun } from '#modules/agents/core/run-queue';
import { decide } from '#modules/autopilot/engine';
import { categoryOfApprovalKind, type ActionScope } from '@helena/policy';
import { approvalScope } from './scope';
import { listMemberContexts, toMemberContext, type MemberRole } from '#modules/members/service';
import { notifyApprovalRequested } from '#modules/notifications/service';
import { enqueueTelegramApproval } from '#modules/telegram/channel';
import { HttpError, iso, pgErrorCode } from '#shared/lib';
import { hasPermission, type PermissionAction, type PermissionResource } from '#shared/permissions';
import { publishDomainEvent } from '#shared/helena';

export type ApprovalKind =
  'send' | 'publish' | 'pay' | 'delete' | 'write' | 'execute' | 'credentials' | 'budget' | 'other';
export type RequestKind = Exclude<ApprovalKind, 'budget'>;
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalDto {
  id: number;
  projectId: number;
  projectKey: string;
  projectName: string;
  agentId: number;
  agentName: string;
  agentUsername: string;
  runId: number | null;
  issueId: number | null;
  issueSequenceNumber: number | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  kind: ApprovalKind;
  action: string;
  details: string;
  command: string | null;
  category: string | null;
  scope: ActionScope | null;
  autopilotLevel: number | null;
  policyReason: string | null;
  payload: Record<string, unknown> | null;
  status: ApprovalStatus;
  decidedByUserId: string | null;
  decidedByName: string | null;
  note: string | null;
  decidedAt: string | null;
  followUpRunId: number | null;
  createdAt: string;
}

// The person who decides is who a request needs; the agent that asks reads its own.
export const DECIDE_PERMISSION: [PermissionResource, PermissionAction] = ['ai_agents', 'edit'];

const agentUser = alias(user, 'agent_user');
const decider = alias(user, 'decider');

type Database = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function selectApprovals(database: Database = db) {
  return database
    .select({
      id: approvalRequest.id,
      projectId: approvalRequest.projectId,
      projectKey: project.key,
      projectName: project.name,
      agentId: approvalRequest.agentId,
      agentName: agentUser.name,
      agentUsername: aiAgent.username,
      runId: approvalRequest.runId,
      issueId: approvalRequest.issueId,
      issueSequenceNumber: issue.sequenceNumber,
      issueTitle: issue.title,
      kind: approvalRequest.kind,
      action: approvalRequest.action,
      details: approvalRequest.details,
      command: approvalRequest.command,
      category: approvalRequest.category,
      autopilotLevel: approvalRequest.autopilotLevel,
      policyReason: approvalRequest.policyReason,
      payload: approvalRequest.payload,
      status: approvalRequest.status,
      decidedByUserId: approvalRequest.decidedByUserId,
      decidedByName: decider.name,
      note: approvalRequest.decisionNote,
      decidedAt: approvalRequest.decidedAt,
      followUpRunId: approvalRequest.followUpRunId,
      createdAt: approvalRequest.createdAt,
    })
    .from(approvalRequest)
    .innerJoin(project, eq(project.id, approvalRequest.projectId))
    .innerJoin(aiAgent, eq(aiAgent.id, approvalRequest.agentId))
    .innerJoin(agentUser, eq(agentUser.id, aiAgent.userId))
    .leftJoin(issue, eq(issue.id, approvalRequest.issueId))
    .leftJoin(decider, eq(decider.id, approvalRequest.decidedByUserId));
}

type ApprovalRow = Awaited<ReturnType<typeof selectApprovals>>[number];

function toDto(row: ApprovalRow): ApprovalDto {
  const payload = (row.payload as Record<string, unknown> | null) ?? null;
  return {
    ...row,
    issueIdentifier:
      row.issueSequenceNumber == null ? null : `${row.projectKey}-${row.issueSequenceNumber}`,
    kind: row.kind as ApprovalKind,
    scope:
      payload?.actionScope === 'workspace' || payload?.actionScope === 'external'
        ? payload.actionScope
        : null,
    payload,
    status: row.status as ApprovalStatus,
    decidedAt: row.decidedAt ? iso(row.decidedAt) : null,
    createdAt: iso(row.createdAt),
  };
}

export async function getApproval(
  id: number,
  database: Database = db,
): Promise<ApprovalDto | null> {
  const [row] = await selectApprovals(database).where(eq(approvalRequest.id, id));
  return row ? toDto(row) : null;
}

// What the access macro needs: the project to check and the agent that may read it.
export async function getApprovalAccess(
  id: number,
): Promise<{ projectId: number; agentUserId: string } | null> {
  const [row] = await db
    .select({ projectId: approvalRequest.projectId, agentUserId: aiAgent.userId })
    .from(approvalRequest)
    .innerJoin(aiAgent, eq(aiAgent.id, approvalRequest.agentId))
    .where(eq(approvalRequest.id, id));
  return row ?? null;
}

// The agent a caller is, when it is one of the team's agents.
export async function getCallingAgent(
  userId: string,
  teamId: number,
): Promise<{ id: number; userId: string } | null> {
  const [row] = await db
    .select({ id: aiAgent.id, userId: aiAgent.userId })
    .from(aiAgent)
    .where(and(eq(aiAgent.userId, userId), eq(aiAgent.teamId, teamId)));
  return row ?? null;
}

// The projects in which the user holds the permission, owners included.
export async function projectsWithPermission(
  userId: string,
  [resource, action]: [PermissionResource, PermissionAction],
): Promise<{ id: number; key: string; name: string; teamId: number }[]> {
  const rows = await db
    .select({
      id: project.id,
      key: project.key,
      name: project.name,
      teamId: project.teamId,
      role: projectMember.role,
      permissions: teamRole.permissions,
    })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .leftJoin(teamRole, eq(teamRole.id, projectMember.roleId))
    .where(eq(projectMember.userId, userId))
    .orderBy(project.key);
  return rows
    .filter((row) =>
      hasPermission(
        toMemberContext(row.role as MemberRole, row.permissions).permissions,
        resource,
        action,
      ),
    )
    .map(({ id, key, name, teamId }) => ({ id, key, name, teamId }));
}

// The run a request comes from: a claimed, unfinished run of the agent in the project,
// on the issue the agent names when it names one. A runner can execute several runs of
// one agent at once and a chat can ask as well, so a request is tied to a run only when
// exactly one run matches.
async function askingRun(agentId: number, projectId: number, issueId: number | undefined) {
  const rows = await db
    .select({ id: agentRun.id, issueId: agentRun.issueId })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.agentId, agentId),
        eq(agentRun.projectId, projectId),
        eq(agentRun.status, 'pending'),
        isNotNull(agentRun.startedAt),
        issueId == null ? undefined : eq(agentRun.issueId, issueId),
      ),
    )
    .limit(2);
  return rows.length === 1 ? rows[0]! : null;
}

// The people who may decide the project's requests, agents left out.
export async function deciders(projectId: number): Promise<string[]> {
  const contexts = await listMemberContexts(projectId);
  const ids = [...contexts]
    .filter(([, context]) => hasPermission(context.permissions, ...DECIDE_PERMISSION))
    .map(([userId]) => userId);
  if (ids.length === 0) return [];
  const agents = await db
    .select({ userId: aiAgent.userId })
    .from(aiAgent)
    .where(inArray(aiAgent.userId, ids));
  const agentIds = new Set(agents.map((row) => row.userId));
  return ids.filter((id) => !agentIds.has(id));
}

// Records an agent's request. A second identical request of the same run answers with
// the first one, so a model that repeats its call does not fill the inbox.
export async function createApprovalRequest(input: {
  projectId: number;
  agent: { id: number; userId: string };
  kind: RequestKind;
  action: string;
  details?: string;
  command?: string;
  scope?: ActionScope;
  issueId?: number;
  payload?: Record<string, unknown>;
}): Promise<{ approval: ApprovalDto; created: boolean }> {
  if (input.issueId != null) {
    const [row] = await db
      .select({ id: issue.id })
      .from(issue)
      .where(and(eq(issue.id, input.issueId), eq(issue.projectId, input.projectId)));
    if (!row) throw new HttpError(400, 'The issue is not in this project');
  }
  const run = await askingRun(input.agent.id, input.projectId, input.issueId);
  const issueId = input.issueId ?? run?.issueId ?? null;
  const action = input.action.trim();
  const command = input.command?.trim() || null;
  const category = categoryOfApprovalKind(input.kind);
  const scope = await approvalScope({ ...input, category, action, command });
  const view = await decide({
    adapter: 'approval',
    agentId: input.agent.id,
    projectId: input.projectId,
    runId: run?.id ?? null,
    category,
    scope,
    tool: 'request_approval',
    summary: action,
  });

  const [requestingAgent] = await db
    .select({ role: aiAgent.agentRole })
    .from(aiAgent)
    .where(eq(aiAgent.id, input.agent.id));
  const homeApproved = requestingAgent?.role === 'home' && view.outcome === 'allow';
  let id: number;
  try {
    const [created] = await db
      .insert(approvalRequest)
      .values({
        projectId: input.projectId,
        agentId: input.agent.id,
        runId: run?.id ?? null,
        issueId,
        kind: input.kind,
        action,
        details: input.details?.trim() ?? '',
        command,
        category,
        payload: { ...input.payload, actionScope: scope },
        autopilotLevel: view.level,
        policyReason: view.reason,
        ...(homeApproved
          ? {
              status: 'approved' as const,
              decidedAt: new Date(),
              decisionNote: 'Home access; audit only',
            }
          : {}),
      })
      .returning({ id: approvalRequest.id });
    id = created!.id;
  } catch (err) {
    if (!run || pgErrorCode(err) !== '23505') throw err;
    const [existing] = await db
      .select({ id: approvalRequest.id })
      .from(approvalRequest)
      .where(
        and(
          eq(approvalRequest.runId, run.id),
          eq(approvalRequest.status, 'pending'),
          eq(approvalRequest.kind, input.kind),
          eq(approvalRequest.action, action),
          command == null ? isNull(approvalRequest.command) : eq(approvalRequest.command, command),
        ),
      );
    const approval = existing ? await getApproval(existing.id) : null;
    if (!approval) throw new HttpError(409, 'The matching approval changed; request it again');
    return { approval, created: false };
  }

  if (homeApproved) return { approval: (await getApproval(id))!, created: true };

  await publishDomainEvent({
    type: 'helena.approval.requested',
    projectId: input.projectId,
    subject: `approvals/${id}`,
    actor: `agent:${input.agent.id}`,
    data: {
      approvalId: id,
      kind: input.kind,
      projectId: input.projectId,
      agentId: input.agent.id,
      issueId,
      runId: run?.id ?? null,
    },
  });
  await enqueueTelegramApproval(id, await deciders(input.projectId)).catch(() => {
    console.warn('[telegram] could not queue approval notice');
  });
  if (issueId != null) {
    await notifyApprovalRequested({
      projectId: input.projectId,
      issueId,
      agentUserId: input.agent.userId,
      recipientUserIds: await deciders(input.projectId),
      action,
    });
  }
  return { approval: (await getApproval(id))!, created: true };
}

// The prompt of the run a decision queues. framePrompt adds what to do with it.
function decisionPrompt(
  request: { id: number; kind: string; action: string; details: string; command: string | null },
  decision: { approved: boolean; deciderName: string; note: string | null },
): string {
  return [
    `Approval request #${request.id} (${request.kind}): ${request.action}`,
    ...(request.details ? ['', 'Details:', request.details] : []),
    ...(request.command ? ['', 'Command:', request.command] : []),
    '',
    `Decision: ${decision.approved ? 'approved' : 'rejected'} by ${decision.deciderName}`,
    ...(decision.note ? [`Note: ${decision.note}`] : []),
  ].join('\n');
}

// Stores the decision and queues the agent's follow-up run in one transaction, so a
// decided request always has its run. 409 when someone decided it first.
export async function decideApprovalRequest(
  id: number,
  deciderUserId: string,
  input: { approved: boolean; note?: string },
  database: Database = db,
): Promise<ApprovalDto> {
  const note = input.note?.trim() || null;
  await database.transaction(async (tx) => {
    const [decided] = await tx
      .update(approvalRequest)
      .set({
        status: input.approved ? 'approved' : 'rejected',
        decidedByUserId: deciderUserId,
        decisionNote: note,
        decidedAt: new Date(),
      })
      .where(and(eq(approvalRequest.id, id), eq(approvalRequest.status, 'pending')))
      .returning();
    if (!decided) throw new HttpError(409, 'This request has already been decided');
    // A budget card has its own answers (raise, continue once, keep stopped).
    if (decided.kind === 'budget')
      throw new HttpError(409, 'A budget card is decided with its own actions');
    if ((decided.payload as Record<string, unknown> | null)?.type === 'trading-strategy') {
      const [owner] = await tx
        .select({ role: projectMember.role })
        .from(projectMember)
        .where(
          and(
            eq(projectMember.projectId, decided.projectId),
            eq(projectMember.userId, deciderUserId),
          ),
        );
      if (owner?.role !== 'owner')
        throw new HttpError(403, 'Only a project owner can decide a paper strategy approval.');
    }
    if ((decided.payload as Record<string, unknown> | null)?.type === 'volition-root') {
      const { rootOwner, assertRootApprovalPending } = await import('#modules/root-access/service');
      if ((await rootOwner(decided.agentId)) !== deciderUserId)
        throw new HttpError(403, 'Only the instance owner may approve root commands');
      if (input.approved) await assertRootApprovalPending(id);
      return;
    }
    const [person] = await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, deciderUserId));
    // The follow-up resumes the session of the run that asked, so the agent goes on with
    // the plan it made there (owner, 2026-09-24: after an approval the rest of the task
    // was left undone).
    const [origin] =
      decided.runId == null
        ? []
        : await tx
            .select({ id: agentRun.id, agentId: agentRun.agentId, sessionId: agentRun.sessionId })
            .from(agentRun)
            .where(eq(agentRun.id, decided.runId));
    const runId = await enqueueAgentRun(
      {
        agentId: decided.agentId,
        projectId: decided.projectId,
        issueId: decided.issueId,
        sourceActivityId: null,
        trigger: 'approval',
        prompt: decisionPrompt(decided, {
          approved: input.approved,
          deciderName: person?.name ?? 'a person',
          note,
        }),
        ...(origin?.sessionId &&
          origin.agentId === decided.agentId && {
            continueSession: { runId: origin.id, sessionId: origin.sessionId },
          }),
      },
      tx,
    );
    await tx
      .update(approvalRequest)
      .set({ followUpRunId: runId })
      .where(eq(approvalRequest.id, id));
    await publishDomainEvent(
      {
        type: 'helena.approval.decided',
        projectId: decided.projectId,
        subject: `approvals/${id}`,
        actor: `user:${deciderUserId}`,
        data: {
          approvalId: id,
          kind: decided.kind,
          projectId: decided.projectId,
          agentId: decided.agentId,
          issueId: decided.issueId,
          runId: decided.runId,
          decision: input.approved ? 'approved' : 'rejected',
          decidedBy: deciderUserId,
        },
      },
      tx,
    );
  });
  const { executeRootApproval } = await import('#modules/root-access/service');
  if (database === db) await executeRootApproval(id, input.approved);
  return (await getApproval(id, database))!;
}

// What Hermes' approval guard lets a run execute: the commands of the calling agent's
// approved requests whose decision queued this run.
export async function listApprovedCommands(agentId: number, runId: number): Promise<string[]> {
  const rows = await db
    .select({ command: approvalRequest.command })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.agentId, agentId),
        eq(approvalRequest.followUpRunId, runId),
        eq(approvalRequest.status, 'approved'),
        isNotNull(approvalRequest.command),
      ),
    )
    .orderBy(approvalRequest.id);
  return rows.map((row) => row.command!);
}

// The requests of the projects in which the user may decide, or null for none.
// `projectKey`, when given, narrows to that one project — but only when it is
// among the projects the user may decide in; anything else (no permission there,
// or no such project) is treated the same as an empty result, so the caller never
// learns from this whether a project it cannot see exists.
async function decidableWhere(
  userId: string,
  status: 'pending' | 'decided',
  projectKey?: string,
): Promise<SQL | null> {
  const projects = await projectsWithPermission(userId, DECIDE_PERMISSION);
  const projectIds =
    projectKey == null
      ? projects.map((p) => p.id)
      : projects.filter((p) => p.key === projectKey).map((p) => p.id);
  if (projectIds.length === 0) return null;
  return and(
    inArray(approvalRequest.projectId, projectIds),
    status === 'pending'
      ? eq(approvalRequest.status, 'pending')
      : sql`${approvalRequest.status} <> 'pending'`,
  )!;
}

async function countWhere(where: SQL): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(approvalRequest)
    .where(where);
  return row?.n ?? 0;
}

// Newest first.
export async function listApprovals(
  userId: string,
  status: 'pending' | 'decided',
  window: { limit: number; offset: number },
  projectKey?: string,
): Promise<{ items: ApprovalDto[]; total: number }> {
  const where = await decidableWhere(userId, status, projectKey);
  if (!where) return { items: [], total: 0 };
  const [rows, total] = await Promise.all([
    selectApprovals()
      .where(where)
      .orderBy(desc(approvalRequest.id))
      .limit(window.limit)
      .offset(window.offset),
    countWhere(where),
  ]);
  return { items: rows.map(toDto), total };
}

export async function countPendingApprovals(userId: string, projectKey?: string): Promise<number> {
  const where = await decidableWhere(userId, 'pending', projectKey);
  return where ? countWhere(where) : 0;
}

// The projects the caller may decide approvals in, for the global list's project
// filter. Same set `decidableWhere` restricts to, so the filter never offers a
// project the caller could not already see requests from.
export async function listApprovalProjects(
  userId: string,
): Promise<{ id: number; key: string; name: string }[]> {
  return (await projectsWithPermission(userId, DECIDE_PERMISSION)).map(({ id, key, name }) => ({
    id,
    key,
    name,
  }));
}
