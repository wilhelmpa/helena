import {
  aiAgent,
  db,
  organizationAgentAssignment,
  organizationDepartment,
  organizationGoal,
  organizationProjectAssignment,
  project,
  projectMember,
  team,
  user,
} from '@repo/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { HttpError, iso, rethrowDuplicate } from '#shared/lib';

export type GoalStatus = 'planned' | 'active' | 'achieved' | 'paused';

type TransactionCallback = Parameters<typeof db.transaction>[0];
type Transaction = Parameters<TransactionCallback>[0];

function normalizeOrganizationRuntimeState(value: unknown): {
  adapter: string | null;
  status: 'offline' | 'online' | 'degraded';
  appliedRevision: string | null;
  capabilities: string[];
  detail: string | null;
  reportedAt: string | null;
} {
  if (!value || typeof value !== 'object') {
    return {
      adapter: null,
      status: 'offline',
      appliedRevision: null,
      capabilities: [],
      detail: null,
      reportedAt: null,
    };
  }
  const state = value as Record<string, unknown>;
  return {
    adapter: typeof state.adapter === 'string' ? state.adapter : null,
    status: state.status === 'online' || state.status === 'degraded' ? state.status : 'offline',
    appliedRevision: typeof state.appliedRevision === 'string' ? state.appliedRevision : null,
    capabilities: Array.isArray(state.capabilities)
      ? state.capabilities.filter((item): item is string => typeof item === 'string')
      : [],
    detail: typeof state.detail === 'string' ? state.detail : null,
    reportedAt: typeof state.reportedAt === 'string' ? state.reportedAt : null,
  };
}

async function lockTeam(tx: Transaction, teamId: number): Promise<void> {
  const rows = await tx.execute(sql`select id from ${team} where id = ${teamId} for update`);
  if (rows.length === 0) throw new HttpError(404, 'Team not found');
}

async function requireDepartment(
  tx: Transaction,
  teamId: number,
  departmentId: number | null | undefined,
): Promise<void> {
  if (departmentId == null) return;
  const [row] = await tx
    .select({ id: organizationDepartment.id })
    .from(organizationDepartment)
    .where(
      and(eq(organizationDepartment.id, departmentId), eq(organizationDepartment.teamId, teamId)),
    )
    .limit(1);
  if (!row) throw new HttpError(400, 'Department does not belong to this team');
}

async function requireProject(
  tx: Transaction,
  teamId: number,
  projectId: number | null | undefined,
): Promise<void> {
  if (projectId == null) return;
  const [row] = await tx
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)))
    .limit(1);
  if (!row) throw new HttpError(400, 'Project does not belong to this team');
}

async function requireAgent(tx: Transaction, teamId: number, agentId: number): Promise<void> {
  const [row] = await tx
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId)))
    .limit(1);
  if (!row) throw new HttpError(404, 'Agent not found');
}

async function requireGoal(
  tx: Transaction,
  teamId: number,
  goalId: number | null | undefined,
): Promise<void> {
  if (goalId == null) return;
  const [row] = await tx
    .select({ id: organizationGoal.id })
    .from(organizationGoal)
    .where(and(eq(organizationGoal.id, goalId), eq(organizationGoal.teamId, teamId)))
    .limit(1);
  if (!row) throw new HttpError(400, 'Goal does not belong to this team');
}

async function assertGoalAcyclic(
  tx: Transaction,
  teamId: number,
  goalId: number,
  parentGoalId: number | null,
): Promise<void> {
  if (parentGoalId == null) return;
  if (parentGoalId === goalId) throw new HttpError(400, 'A goal cannot contain itself');
  const rows = await tx
    .select({ id: organizationGoal.id, parentGoalId: organizationGoal.parentGoalId })
    .from(organizationGoal)
    .where(eq(organizationGoal.teamId, teamId));
  const parents = new Map(rows.map((row) => [row.id, row.parentGoalId]));
  let current: number | null = parentGoalId;
  const visited = new Set<number>();
  while (current != null) {
    if (current === goalId) throw new HttpError(400, 'Goal hierarchy cannot cycle');
    if (visited.has(current)) throw new HttpError(400, 'Goal hierarchy already contains a cycle');
    visited.add(current);
    current = parents.get(current) ?? null;
  }
}

async function assertDepartmentAcyclic(
  tx: Transaction,
  teamId: number,
  departmentId: number,
  parentId: number | null,
): Promise<void> {
  if (parentId == null) return;
  if (parentId === departmentId) throw new HttpError(400, 'A department cannot contain itself');
  const rows = await tx
    .select({ id: organizationDepartment.id, parentId: organizationDepartment.parentId })
    .from(organizationDepartment)
    .where(eq(organizationDepartment.teamId, teamId));
  const parents = new Map(rows.map((row) => [row.id, row.parentId]));
  let current: number | null = parentId;
  const visited = new Set<number>();
  while (current != null) {
    if (current === departmentId) throw new HttpError(400, 'Department hierarchy cannot cycle');
    if (visited.has(current))
      throw new HttpError(409, 'Department hierarchy already contains a cycle');
    visited.add(current);
    current = parents.get(current) ?? null;
  }
}

async function assertReportingAcyclic(
  tx: Transaction,
  teamId: number,
  agentId: number,
  managerId: number | null,
): Promise<void> {
  if (managerId == null) return;
  if (managerId === agentId) throw new HttpError(400, 'An agent cannot report to itself');
  const rows = await tx
    .select({
      agentId: organizationAgentAssignment.agentId,
      managerId: organizationAgentAssignment.reportsToAgentId,
    })
    .from(organizationAgentAssignment)
    .where(eq(organizationAgentAssignment.teamId, teamId));
  const managers = new Map(rows.map((row) => [row.agentId, row.managerId]));
  managers.set(agentId, managerId);
  let current: number | null = managerId;
  const visited = new Set<number>();
  while (current != null) {
    if (current === agentId) throw new HttpError(400, 'Agent reporting lines cannot cycle');
    if (visited.has(current))
      throw new HttpError(409, 'Agent reporting lines already contain a cycle');
    visited.add(current);
    current = managers.get(current) ?? null;
  }
}

function nonBlank(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new HttpError(400, `${label} cannot be blank`);
  return result;
}

export async function getOrganization(teamId: number) {
  const [departments, goals, agents, agentProjects, projects] = await Promise.all([
    db
      .select({
        id: organizationDepartment.id,
        name: organizationDepartment.name,
        description: organizationDepartment.description,
        parentId: organizationDepartment.parentId,
        position: organizationDepartment.position,
        createdAt: organizationDepartment.createdAt,
        updatedAt: organizationDepartment.updatedAt,
      })
      .from(organizationDepartment)
      .where(eq(organizationDepartment.teamId, teamId))
      .orderBy(asc(organizationDepartment.position), asc(organizationDepartment.name)),
    db
      .select({
        id: organizationGoal.id,
        title: organizationGoal.title,
        description: organizationGoal.description,
        departmentId: organizationGoal.departmentId,
        projectId: organizationGoal.projectId,
        parentGoalId: organizationGoal.parentGoalId,
        status: organizationGoal.status,
        targetDate: organizationGoal.targetDate,
        createdAt: organizationGoal.createdAt,
        updatedAt: organizationGoal.updatedAt,
      })
      .from(organizationGoal)
      .where(eq(organizationGoal.teamId, teamId))
      .orderBy(asc(organizationGoal.title)),
    db
      .select({
        id: aiAgent.id,
        userId: aiAgent.userId,
        name: user.name,
        username: aiAgent.username,
        kind: aiAgent.kind,
        departmentId: organizationAgentAssignment.departmentId,
        reportsToAgentId: organizationAgentAssignment.reportsToAgentId,
        roleTitle: organizationAgentAssignment.roleTitle,
        runtimeAgentId: organizationAgentAssignment.runtimeAgentId,
        runtimeState: aiAgent.runtimeState,
      })
      .from(aiAgent)
      .innerJoin(user, eq(user.id, aiAgent.userId))
      .leftJoin(
        organizationAgentAssignment,
        and(
          eq(organizationAgentAssignment.agentId, aiAgent.id),
          eq(organizationAgentAssignment.teamId, teamId),
        ),
      )
      .where(eq(aiAgent.teamId, teamId))
      .orderBy(asc(user.name)),
    db
      .select({
        agentId: aiAgent.id,
        id: project.id,
        key: project.key,
        name: project.name,
        instructions: projectMember.description,
      })
      .from(aiAgent)
      .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
      .innerJoin(project, eq(project.id, projectMember.projectId))
      .where(and(eq(aiAgent.teamId, teamId), eq(project.teamId, teamId)))
      .orderBy(asc(project.key)),
    db
      .select({
        id: project.id,
        key: project.key,
        name: project.name,
        description: project.description,
        departmentId: organizationProjectAssignment.departmentId,
        instructions: organizationProjectAssignment.instructions,
      })
      .from(project)
      .leftJoin(
        organizationProjectAssignment,
        and(
          eq(organizationProjectAssignment.projectId, project.id),
          eq(organizationProjectAssignment.teamId, teamId),
        ),
      )
      .where(eq(project.teamId, teamId))
      .orderBy(asc(project.key)),
  ]);

  const projectsByAgent = new Map<number, typeof agentProjects>();
  for (const entry of agentProjects) {
    const values = projectsByAgent.get(entry.agentId) ?? [];
    values.push(entry);
    projectsByAgent.set(entry.agentId, values);
  }

  return {
    teamId,
    departments: departments.map((row) => ({
      ...row,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    goals: goals.map((row) => ({
      ...row,
      status: row.status as GoalStatus,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    agents: agents.map((row) => ({
      ...row,
      kind: row.kind as 'external' | 'internal',
      roleTitle: row.roleTitle ?? '',
      runtimeState: normalizeOrganizationRuntimeState(row.runtimeState),
      projects: (projectsByAgent.get(row.id) ?? []).map(({ agentId: _agentId, ...entry }) => entry),
    })),
    projects: projects.map((row) => ({ ...row, instructions: row.instructions ?? '' })),
  };
}

export async function createDepartment(
  teamId: number,
  input: { name: string; description?: string; parentId?: number | null; position?: number },
) {
  try {
    return await db.transaction(async (tx) => {
      await lockTeam(tx, teamId);
      await requireDepartment(tx, teamId, input.parentId);
      const [row] = await tx
        .insert(organizationDepartment)
        .values({
          teamId,
          name: nonBlank(input.name, 'Department name'),
          description: input.description?.trim() ?? '',
          parentId: input.parentId ?? null,
          position: input.position ?? 0,
        })
        .returning();
      return { ...row!, createdAt: iso(row!.createdAt), updatedAt: iso(row!.updatedAt) };
    });
  } catch (error) {
    rethrowDuplicate(error, 'A department with this name');
  }
}

export async function updateDepartment(
  teamId: number,
  departmentId: number,
  patch: {
    name?: string;
    description?: string;
    parentId?: number | null;
    position?: number;
  },
) {
  try {
    return await db.transaction(async (tx) => {
      await lockTeam(tx, teamId);
      const [existing] = await tx
        .select({ id: organizationDepartment.id })
        .from(organizationDepartment)
        .where(
          and(
            eq(organizationDepartment.id, departmentId),
            eq(organizationDepartment.teamId, teamId),
          ),
        )
        .limit(1);
      if (!existing) throw new HttpError(404, 'Department not found');
      if (patch.parentId !== undefined) {
        await requireDepartment(tx, teamId, patch.parentId);
        await assertDepartmentAcyclic(tx, teamId, departmentId, patch.parentId);
      }
      const [row] = await tx
        .update(organizationDepartment)
        .set({
          ...(patch.name !== undefined ? { name: nonBlank(patch.name, 'Department name') } : {}),
          ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
          ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
          ...(patch.position !== undefined ? { position: patch.position } : {}),
          updatedAt: new Date(),
        })
        .where(eq(organizationDepartment.id, departmentId))
        .returning();
      return { ...row!, createdAt: iso(row!.createdAt), updatedAt: iso(row!.updatedAt) };
    });
  } catch (error) {
    rethrowDuplicate(error, 'A department with this name');
  }
}

export async function deleteDepartment(teamId: number, departmentId: number): Promise<boolean> {
  const rows = await db
    .delete(organizationDepartment)
    .where(
      and(eq(organizationDepartment.id, departmentId), eq(organizationDepartment.teamId, teamId)),
    )
    .returning({ id: organizationDepartment.id });
  return rows.length > 0;
}

export async function createGoal(
  teamId: number,
  input: {
    title: string;
    description?: string;
    departmentId?: number | null;
    projectId?: number | null;
    parentGoalId?: number | null;
    status?: GoalStatus;
    targetDate?: string | null;
  },
) {
  return db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    await requireDepartment(tx, teamId, input.departmentId);
    await requireProject(tx, teamId, input.projectId);
    await requireGoal(tx, teamId, input.parentGoalId);
    const [row] = await tx
      .insert(organizationGoal)
      .values({
        teamId,
        title: nonBlank(input.title, 'Goal title'),
        description: input.description?.trim() ?? '',
        departmentId: input.departmentId ?? null,
        projectId: input.projectId ?? null,
        parentGoalId: input.parentGoalId ?? null,
        status: input.status ?? 'planned',
        targetDate: input.targetDate ?? null,
      })
      .returning();
    return {
      ...row!,
      status: row!.status as GoalStatus,
      createdAt: iso(row!.createdAt),
      updatedAt: iso(row!.updatedAt),
    };
  });
}

export async function updateGoal(
  teamId: number,
  goalId: number,
  patch: {
    title?: string;
    description?: string;
    departmentId?: number | null;
    projectId?: number | null;
    parentGoalId?: number | null;
    status?: GoalStatus;
    targetDate?: string | null;
  },
) {
  return db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    await requireDepartment(tx, teamId, patch.departmentId);
    await requireProject(tx, teamId, patch.projectId);
    await requireGoal(tx, teamId, patch.parentGoalId);
    if (patch.parentGoalId !== undefined) {
      await assertGoalAcyclic(tx, teamId, goalId, patch.parentGoalId);
    }
    const [row] = await tx
      .update(organizationGoal)
      .set({
        ...(patch.title !== undefined ? { title: nonBlank(patch.title, 'Goal title') } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
        ...(patch.departmentId !== undefined ? { departmentId: patch.departmentId } : {}),
        ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
        ...(patch.parentGoalId !== undefined ? { parentGoalId: patch.parentGoalId } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.targetDate !== undefined ? { targetDate: patch.targetDate } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(organizationGoal.id, goalId), eq(organizationGoal.teamId, teamId)))
      .returning();
    if (!row) throw new HttpError(404, 'Goal not found');
    return {
      ...row,
      status: row.status as GoalStatus,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  });
}

export async function deleteGoal(teamId: number, goalId: number): Promise<boolean> {
  const rows = await db
    .delete(organizationGoal)
    .where(and(eq(organizationGoal.id, goalId), eq(organizationGoal.teamId, teamId)))
    .returning({ id: organizationGoal.id });
  return rows.length > 0;
}

export async function setAgentAssignment(
  teamId: number,
  agentId: number,
  input: {
    departmentId?: number | null;
    reportsToAgentId?: number | null;
    roleTitle?: string;
    runtimeAgentId?: string | null;
  },
) {
  return db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    await requireAgent(tx, teamId, agentId);
    await requireDepartment(tx, teamId, input.departmentId);
    if (input.reportsToAgentId != null) await requireAgent(tx, teamId, input.reportsToAgentId);
    await assertReportingAcyclic(tx, teamId, agentId, input.reportsToAgentId ?? null);
    const [row] = await tx
      .insert(organizationAgentAssignment)
      .values({
        teamId,
        agentId,
        departmentId: input.departmentId ?? null,
        reportsToAgentId: input.reportsToAgentId ?? null,
        roleTitle: input.roleTitle?.trim() ?? '',
        runtimeAgentId: input.runtimeAgentId ?? null,
      })
      .onConflictDoUpdate({
        target: [organizationAgentAssignment.teamId, organizationAgentAssignment.agentId],
        set: {
          departmentId: input.departmentId ?? null,
          reportsToAgentId: input.reportsToAgentId ?? null,
          roleTitle: input.roleTitle?.trim() ?? '',
          runtimeAgentId: input.runtimeAgentId ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row!;
  });
}

export async function clearAgentAssignment(teamId: number, agentId: number): Promise<boolean> {
  const rows = await db
    .delete(organizationAgentAssignment)
    .where(
      and(
        eq(organizationAgentAssignment.teamId, teamId),
        eq(organizationAgentAssignment.agentId, agentId),
      ),
    )
    .returning({ agentId: organizationAgentAssignment.agentId });
  return rows.length > 0;
}

export async function setProjectAssignment(
  teamId: number,
  projectId: number,
  input: { departmentId?: number | null; instructions?: string },
) {
  return db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    await requireProject(tx, teamId, projectId);
    await requireDepartment(tx, teamId, input.departmentId);
    const [row] = await tx
      .insert(organizationProjectAssignment)
      .values({
        teamId,
        projectId,
        departmentId: input.departmentId ?? null,
        instructions: input.instructions?.trim() ?? '',
      })
      .onConflictDoUpdate({
        target: [organizationProjectAssignment.teamId, organizationProjectAssignment.projectId],
        set: {
          departmentId: input.departmentId ?? null,
          instructions: input.instructions?.trim() ?? '',
          updatedAt: new Date(),
        },
      })
      .returning();
    return row!;
  });
}

export async function setAgentProjectInstructions(
  teamId: number,
  agentId: number,
  projectId: number,
  instructions: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const [agent] = await tx
      .select({ userId: aiAgent.userId })
      .from(aiAgent)
      .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId)))
      .limit(1);
    if (!agent) throw new HttpError(404, 'Agent not found');
    await requireProject(tx, teamId, projectId);
    const [updated] = await tx
      .update(projectMember)
      .set({ description: instructions.trim() })
      .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, agent.userId)))
      .returning({ projectId: projectMember.projectId });
    if (!updated) throw new HttpError(404, 'Agent is not assigned to this project');
  });
}

export async function clearProjectAssignment(teamId: number, projectId: number): Promise<boolean> {
  const rows = await db
    .delete(organizationProjectAssignment)
    .where(
      and(
        eq(organizationProjectAssignment.teamId, teamId),
        eq(organizationProjectAssignment.projectId, projectId),
      ),
    )
    .returning({ projectId: organizationProjectAssignment.projectId });
  return rows.length > 0;
}
