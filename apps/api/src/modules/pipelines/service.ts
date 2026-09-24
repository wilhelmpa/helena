import {
  db,
  helenaSchedule,
  pipeline,
  pipelineVersion,
  project as projectTable,
  projectPipeline,
  user,
} from '@repo/db';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { getLimits } from '#shared/limits';
import { defaultTimezone } from '#modules/engine/settings';
import { minCronIntervalSeconds } from '#modules/routines/cron';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import {
  issueMessage,
  validateDefinition,
  type DefinitionIssue,
  type PipelineDefinition,
} from './definition';
import {
  loadProjectContext,
  projectIssues,
  resolveRoles,
  type ProjectContext,
} from './project-context';

export interface ProjectRef {
  id: number;
  key: string;
  teamId: number;
}

type PipelineRow = typeof pipeline.$inferSelect;

export function withMessages(issues: DefinitionIssue[]) {
  return issues.map((issue) => ({ ...issue, message: issueMessage(issue) }));
}

// A definition as the client sent it, or a 400 naming the first problems.
export function checkedDefinition(raw: unknown, template: boolean): PipelineDefinition {
  const { definition, issues } = validateDefinition(raw, { template });
  if (!definition || issues.length > 0)
    throw new HttpError(
      400,
      `The workflow is invalid: ${withMessages(issues)
        .slice(0, 3)
        .map((issue) => issue.message)
        .join('; ')}`,
      'invalid_definition',
    );
  return definition;
}

async function latestDefinition(row: PipelineRow): Promise<PipelineDefinition> {
  const [version] = await db
    .select({ definition: pipelineVersion.definition })
    .from(pipelineVersion)
    .where(and(eq(pipelineVersion.pipelineId, row.id), eq(pipelineVersion.version, row.version)));
  return version!.definition as PipelineDefinition;
}

async function toDto(row: PipelineRow, definition?: PipelineDefinition) {
  const [owner] = row.projectId
    ? await db
        .select({ key: projectTable.key })
        .from(projectTable)
        .where(eq(projectTable.id, row.projectId))
    : [];
  return {
    id: row.id,
    teamId: row.teamId,
    projectId: row.projectId,
    projectKey: owner?.key ?? null,
    name: row.name,
    description: row.description,
    version: row.version,
    definition: definition ?? (await latestDefinition(row)),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export type PipelineDto = Awaited<ReturnType<typeof toDto>>;

export async function getPipelineRow(pipelineId: number): Promise<PipelineRow | null> {
  const [row] = await db.select().from(pipeline).where(eq(pipeline.id, pipelineId));
  return row ?? null;
}

export async function getPipeline(pipelineId: number): Promise<PipelineDto> {
  const row = await getPipelineRow(pipelineId);
  if (!row) throw new HttpError(404, 'Workflow not found');
  return toDto(row);
}

// The templates of the team's library in Home.
export async function listTemplates(teamId: number): Promise<PipelineDto[]> {
  const rows = await db
    .select()
    .from(pipeline)
    .where(and(eq(pipeline.teamId, teamId), isNull(pipeline.projectId)))
    .orderBy(asc(pipeline.name), asc(pipeline.id));
  return Promise.all(rows.map((row) => toDto(row)));
}

export async function createPipeline(input: {
  teamId: number;
  projectId: number | null;
  name: string;
  description?: string;
  definition: unknown;
  userId: string;
}): Promise<PipelineDto> {
  const definition = checkedDefinition(input.definition, input.projectId === null);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(pipeline)
      .values({
        teamId: input.teamId,
        projectId: input.projectId,
        name: input.name.trim(),
        description: input.description?.trim() ?? '',
        createdBy: input.userId,
      })
      .returning();
    await tx.insert(pipelineVersion).values({
      pipelineId: created!.id,
      version: 1,
      definition,
      createdBy: input.userId,
    });
    // A project's own workflow is its project's from the start; it runs once enabled.
    if (input.projectId !== null)
      await tx
        .insert(projectPipeline)
        .values({ projectId: input.projectId, pipelineId: created!.id, updatedBy: input.userId });
    return created!;
  });
  return toDto(row, definition);
}

// Saves the name, the description and, when it changed, the definition as a new
// version. Runs keep the version they started with.
export async function updatePipeline(
  pipelineId: number,
  patch: { name?: string; description?: string; definition?: unknown; baseVersion?: number },
  userId: string,
): Promise<PipelineDto> {
  const row = await getPipelineRow(pipelineId);
  if (!row) throw new HttpError(404, 'Workflow not found');
  if (patch.baseVersion !== undefined && patch.baseVersion !== row.version)
    throw new HttpError(
      409,
      `The workflow was saved as version ${row.version} in the meantime`,
      'stale_version',
    );
  const definition =
    patch.definition === undefined
      ? undefined
      : checkedDefinition(patch.definition, row.projectId === null);
  // jsonb stores keys in an order of its own, so the stored definition is read again
  // the way a new one is before the two are compared.
  const stored = validateDefinition(await latestDefinition(row), { template: false }).definition;
  const changed = definition !== undefined && JSON.stringify(definition) !== JSON.stringify(stored);
  const updated = await db.transaction(async (tx) => {
    const [saved] = await tx
      .update(pipeline)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
        ...(changed ? { version: sql`${pipeline.version} + 1` } : {}),
        updatedAt: new Date(),
      })
      .where(eq(pipeline.id, pipelineId))
      .returning();
    if (changed)
      await tx.insert(pipelineVersion).values({
        pipelineId,
        version: saved!.version,
        definition: definition!,
        createdBy: userId,
      });
    return saved!;
  });
  if (changed) await syncPipelineSchedules(updated, definition!);
  return toDto(updated);
}

export async function deletePipeline(pipelineId: number): Promise<void> {
  const row = await getPipelineRow(pipelineId);
  if (!row) throw new HttpError(404, 'Workflow not found');
  // Its schedules go with it (on delete cascade).
  await db.delete(pipeline).where(eq(pipeline.id, pipelineId));
}

export async function listVersions(pipelineId: number) {
  const rows = await db
    .select({
      id: pipelineVersion.id,
      version: pipelineVersion.version,
      createdByName: user.name,
      createdAt: pipelineVersion.createdAt,
    })
    .from(pipelineVersion)
    .leftJoin(user, eq(user.id, pipelineVersion.createdBy))
    .where(eq(pipelineVersion.pipelineId, pipelineId))
    .orderBy(desc(pipelineVersion.version));
  return rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
}

export async function getVersion(pipelineId: number, version: number) {
  const [row] = await db
    .select()
    .from(pipelineVersion)
    .where(and(eq(pipelineVersion.pipelineId, pipelineId), eq(pipelineVersion.version, version)));
  if (!row) throw new HttpError(404, 'Workflow version not found');
  return { version: row.version, definition: row.definition, createdAt: iso(row.createdAt) };
}

async function projectOf(projectId: number): Promise<ProjectRef> {
  const [row] = await db
    .select({ id: projectTable.id, key: projectTable.key, teamId: projectTable.teamId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId));
  if (!row) throw new HttpError(404, 'Project not found');
  return row;
}

// The workflows a project can use: every template of its team's library and its own
// workflows, each with whether the project runs it, the agents that fill its roles
// there and what keeps it from running.
export async function listProjectPipelines(project: ProjectRef) {
  const [rows, context] = await Promise.all([
    db
      .select({ pipeline, usage: projectPipeline })
      .from(pipeline)
      .leftJoin(
        projectPipeline,
        and(eq(projectPipeline.pipelineId, pipeline.id), eq(projectPipeline.projectId, project.id)),
      )
      .where(
        and(
          eq(pipeline.teamId, project.teamId),
          or(isNull(pipeline.projectId), eq(pipeline.projectId, project.id)),
        ),
      )
      .orderBy(asc(pipeline.name), asc(pipeline.id)),
    loadProjectContext(project),
  ]);
  return Promise.all(
    rows.map(async ({ pipeline: row, usage }) => {
      const dto = await toDto(row);
      const roles = usage?.roles ?? {};
      return {
        pipeline: dto,
        source: row.projectId === null ? ('template' as const) : ('project' as const),
        enabled: usage?.enabled ?? false,
        roles,
        ...projectState(dto.definition, roles, context),
      };
    }),
  );
}

function projectState(
  definition: PipelineDefinition,
  roles: Record<string, number>,
  context: ProjectContext,
) {
  return {
    resolvedRoles: resolveRoles(definition.roles, roles, context).map((role) => ({
      key: role.key,
      name: role.name,
      source: role.source,
      agent: role.agent && {
        id: role.agent.id,
        username: role.agent.username,
        name: role.agent.name,
        role: role.agent.role,
        capabilities: role.agent.capabilities,
      },
    })),
    issues: withMessages(projectIssues(definition, roles, context)),
  };
}

// A workflow usable in the project: a template of its team, or its own.
export async function usablePipeline(project: ProjectRef, pipelineId: number) {
  const row = await getPipelineRow(pipelineId);
  if (
    !row ||
    row.teamId !== project.teamId ||
    (row.projectId !== null && row.projectId !== project.id)
  )
    throw new HttpError(404, 'Workflow not found');
  return row;
}

// Enables or disables a workflow in the project and sets the agents of its roles. A
// workflow that cannot run in the project is not enabled.
export async function setProjectPipeline(
  project: ProjectRef,
  pipelineId: number,
  input: { enabled: boolean; roles: Record<string, number> },
  userId: string,
) {
  const row = await usablePipeline(project, pipelineId);
  const definition = await latestDefinition(row);
  const context = await loadProjectContext(project);
  const unknownRole = Object.keys(input.roles).find(
    (key) => !definition.roles.some((role) => role.key === key),
  );
  if (unknownRole) throw new HttpError(400, `The workflow has no role ${unknownRole}`);
  const unknownAgent = Object.values(input.roles).find(
    (agentId) => !context.agents.some((agent) => agent.id === agentId),
  );
  if (unknownAgent !== undefined)
    throw new HttpError(400, 'An agent of the role mapping does not work in this project');
  if (input.enabled) {
    const issues = projectIssues(definition, input.roles, context);
    if (issues.length > 0)
      throw new HttpError(
        409,
        `The workflow cannot run in this project: ${issueMessage(issues[0])}`,
        'not_runnable',
      );
    await assertCadence(project.teamId, definition);
  }
  const [usage] = await db
    .insert(projectPipeline)
    .values({
      projectId: project.id,
      pipelineId,
      enabled: input.enabled,
      roles: input.roles,
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: [projectPipeline.projectId, projectPipeline.pipelineId],
      set: { enabled: input.enabled, roles: input.roles, updatedBy: userId, updatedAt: new Date() },
    })
    .returning();
  await syncSchedule(project, row, usage!, definition);
  await bumpControlPlaneRevision(project.id);
  return {
    pipeline: await toDto(row, definition),
    source: row.projectId === null ? ('template' as const) : ('project' as const),
    enabled: usage!.enabled,
    roles: usage!.roles,
    ...projectState(definition, usage!.roles, context),
  };
}

async function assertCadence(teamId: number, definition: PipelineDefinition): Promise<void> {
  const { trigger } = definition;
  if (trigger.type !== 'schedule') return;
  const shortest = minCronIntervalSeconds(trigger.cron, trigger.timezone);
  const { minScheduleIntervalSeconds } = await getLimits({ teamId });
  if (minScheduleIntervalSeconds > 0 && shortest < minScheduleIntervalSeconds)
    throw new HttpError(
      400,
      `A schedule runs at most once every ${Math.ceil(minScheduleIntervalSeconds / 60)} minutes`,
    );
}

// Keeps the schedule of a workflow with a schedule trigger in step with its use in the
// project: a schedule while it is enabled, none otherwise. Every fire runs the
// workflow's newest version on a task it creates, for the member who enabled it.
async function syncSchedule(
  project: ProjectRef,
  row: PipelineRow,
  usage: typeof projectPipeline.$inferSelect,
  definition: PipelineDefinition,
): Promise<void> {
  const { trigger } = definition;
  const [existing] = await db
    .select({ id: helenaSchedule.id, cron: helenaSchedule.cron, timezone: helenaSchedule.timezone })
    .from(helenaSchedule)
    .where(and(eq(helenaSchedule.projectId, project.id), eq(helenaSchedule.pipelineId, row.id)));
  if (!usage.enabled || trigger.type !== 'schedule') {
    if (existing) await db.delete(helenaSchedule).where(eq(helenaSchedule.id, existing.id));
    return;
  }
  const values = {
    title: trigger.title,
    cron: trigger.cron,
    timezone: trigger.timezone || (await defaultTimezone()),
    enabled: true,
    actorUserId: usage.updatedBy ?? row.createdBy,
    updatedAt: new Date(),
  };
  // A new schedule, or one given another time, starts afresh.
  const restart =
    !existing || existing.cron !== values.cron || existing.timezone !== values.timezone;
  const id = existing?.id ?? randomUUID();
  if (existing)
    await db
      .update(helenaSchedule)
      .set({ ...values, ...(restart ? { firedThrough: new Date() } : {}) })
      .where(eq(helenaSchedule.id, id));
  else
    await db.insert(helenaSchedule).values({
      id,
      projectId: project.id,
      kind: 'workflow',
      pipelineId: row.id,
      createdBy: usage.updatedBy,
      firedThrough: new Date(),
      ...values,
    });
}

async function syncPipelineSchedules(row: PipelineRow, definition: PipelineDefinition) {
  const usages = await db
    .select()
    .from(projectPipeline)
    .where(eq(projectPipeline.pipelineId, row.id));
  for (const usage of usages)
    await syncSchedule(await projectOf(usage.projectId), row, usage, definition);
}

// Brings the schedules of every workflow in line with its use in the projects: a
// schedule for each enabled use of a workflow with a schedule trigger, none otherwise.
// For the move from Mastra (scripts/import-mastra-schedules.ts) and after a restore.
// Answers how many workflows it looked at.
export async function syncAllPipelineSchedules(): Promise<number> {
  const used = await db
    .selectDistinct({ pipelineId: projectPipeline.pipelineId })
    .from(projectPipeline);
  for (const { pipelineId } of used) {
    const row = await getPipelineRow(pipelineId);
    if (row) await syncPipelineSchedules(row, await latestDefinition(row));
  }
  return used.length;
}

// Checks a definition as the editor holds it: always on its own, and against a project
// when it is that project's workflow or the editor names one.
export async function validateForEditor(
  input: { definition: unknown; template: boolean; roles?: Record<string, number> },
  project: ProjectRef | null,
) {
  const { definition, issues } = validateDefinition(input.definition, {
    template: input.template,
  });
  if (!definition || !project) return { issues: withMessages(issues) };
  const context = await loadProjectContext(project);
  return {
    issues: withMessages([...issues, ...projectIssues(definition, input.roles ?? {}, context)]),
  };
}

// What the editor offers in its pickers. A template of the library has no project, so
// only the team's template agents and models apply.
export async function editorContext(teamId: number, project: ProjectRef | null) {
  const context = await loadProjectContext(project ?? { id: 0, key: '', teamId });
  return {
    models: context.models,
    templates: context.templates,
    agents: project ? context.agents : [],
    members: project ? context.members : [],
    statuses: project ? context.statuses : [],
    labels: project ? context.labels : [],
    areas: project ? context.areas : [],
  };
}
