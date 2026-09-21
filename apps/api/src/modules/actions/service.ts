import { db, projectAction, projectActionRun, projectActionRunStep, user } from '@repo/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { HttpError, iso, num } from '#shared/lib';
import {
  legacyWorkflow,
  validateWorkflowDefinition,
  WorkflowValidationError,
  workflowLegacyFields,
  workflowTrigger,
  type ActionNode,
  type ConditionNode,
  type WorkflowDefinition,
  type WorkflowTrigger,
} from './workflow';

// Manual actions: saved macros on a project. condition is a filter set deciding
// which issues the action applies to (empty = always); effect is a partial issue
// patch applied in one update. Both jsonb blobs are owned by the UI; this layer
// stores and returns them without inspecting their shape.

export interface ActionRow {
  id: number;
  projectId: number;
  name: string;
  icon: string;
  enabled: boolean;
  trigger: WorkflowTrigger;
  condition: ConditionNode['config'];
  effect: ActionNode['config'];
  workflow: WorkflowDefinition;
  position: number;
  createdAt: string;
}

function mapAction(row: typeof projectAction.$inferSelect): ActionRow {
  const workflow = validatedWorkflow(
    row.workflow,
    row.trigger as ActionRow['trigger'],
    row.condition,
    row.effect,
  );
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    icon: row.icon,
    enabled: row.enabled,
    trigger: row.trigger as ActionRow['trigger'],
    condition: workflowLegacyFields(workflow).condition,
    effect: workflowLegacyFields(workflow).effect,
    workflow,
    position: num(row.position),
    createdAt: iso(row.createdAt),
  };
}

export async function listActions(projectId: number): Promise<ActionRow[]> {
  const rows = await db
    .select()
    .from(projectAction)
    .where(eq(projectAction.projectId, projectId))
    .orderBy(projectAction.position, projectAction.id);
  return rows.map(mapAction);
}

// New actions go to the end of the list (max position + 1). condition/effect are
// stored verbatim in the jsonb columns.
export async function createAction(input: {
  projectId: number;
  name: string;
  icon?: string;
  enabled?: boolean;
  trigger?: ActionRow['trigger'];
  condition?: unknown;
  effect?: unknown;
  workflow?: unknown;
}): Promise<ActionRow> {
  const workflow = validatedWorkflow(
    input.workflow,
    input.trigger ?? 'manual',
    input.condition,
    input.effect,
  );
  const legacy = workflowLegacyFields(workflow);
  const [{ pos }] = await db
    .select({ pos: sql<number>`COALESCE(MAX(${projectAction.position}) + 1, 0)` })
    .from(projectAction)
    .where(eq(projectAction.projectId, input.projectId));
  const [row] = await db
    .insert(projectAction)
    .values({
      projectId: input.projectId,
      name: input.name,
      icon: input.icon ?? '',
      enabled: input.enabled ?? true,
      trigger: workflowTrigger(workflow),
      condition: legacy.condition,
      effect: legacy.effect,
      workflow,
      position: Number(pos),
    })
    .returning();
  return mapAction(row);
}

export async function getAction(id: number): Promise<ActionRow | null> {
  const rows = await db.select().from(projectAction).where(eq(projectAction.id, id));
  return rows[0] ? mapAction(rows[0]) : null;
}

// Updates only the provided fields. condition/effect are replaced wholesale (not
// merged), since the UI always sends the full blob.
export async function updateAction(
  id: number,
  patch: {
    name?: string;
    icon?: string;
    enabled?: boolean;
    trigger?: ActionRow['trigger'];
    condition?: unknown;
    effect?: unknown;
    workflow?: unknown;
  },
): Promise<ActionRow | null> {
  const set: Partial<typeof projectAction.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.workflow !== undefined) {
    const workflow = validatedWorkflow(
      patch.workflow,
      patch.trigger ?? 'manual',
      patch.condition,
      patch.effect,
    );
    const legacy = workflowLegacyFields(workflow);
    set.workflow = workflow;
    set.trigger = workflowTrigger(workflow);
    set.condition = legacy.condition;
    set.effect = legacy.effect;
  } else if (
    patch.trigger !== undefined ||
    patch.condition !== undefined ||
    patch.effect !== undefined
  ) {
    const current = await getAction(id);
    if (!current) return null;
    const workflow = legacyWorkflow(
      patch.trigger ?? current.trigger,
      patch.condition ?? current.condition,
      patch.effect ?? current.effect,
    );
    const legacy = workflowLegacyFields(workflow);
    set.workflow = workflow;
    set.trigger = workflowTrigger(workflow);
    set.condition = legacy.condition;
    set.effect = legacy.effect;
  }
  if (Object.keys(set).length === 0) return getAction(id);
  const [row] = await db.update(projectAction).set(set).where(eq(projectAction.id, id)).returning();
  return row ? mapAction(row) : null;
}

export async function deleteAction(id: number): Promise<void> {
  await db.delete(projectAction).where(eq(projectAction.id, id));
}

// Sets each action's position to its index in orderedIds, in one transaction, so
// the order the UI sends is stored exactly. Ids not on the project are ignored.
export async function reorderActions(
  projectId: number,
  orderedIds: number[],
): Promise<ActionRow[]> {
  await db.transaction(async (tx) => {
    for (const [position, id] of orderedIds.entries()) {
      await tx
        .update(projectAction)
        .set({ position })
        .where(and(eq(projectAction.id, id), eq(projectAction.projectId, projectId)));
    }
  });
  return listActions(projectId);
}

export interface ActionRunRow {
  id: string;
  actionId: number | null;
  projectId: number;
  issueId: number | null;
  issueIdentifier: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actionName: string;
  trigger: ActionRow['trigger'];
  fromColumnId: number;
  fromColumnName: string | null;
  toColumnId: number;
  toColumnName: string | null;
  depth: number;
  status: 'pending' | 'running' | 'succeeded' | 'skipped' | 'failed';
  attempts: number;
  lastError: string | null;
  result: { changedFields: string[] } | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  steps?: ActionRunStepRow[];
}

export interface ActionRunStepRow {
  nodeId: string;
  nodeType: 'trigger' | 'condition' | 'action';
  status: 'pending' | 'running' | 'succeeded' | 'skipped' | 'failed';
  result: unknown;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

const actionRunColumns = {
  id: projectActionRun.id,
  actionId: projectActionRun.actionId,
  projectId: projectActionRun.projectId,
  issueId: projectActionRun.issueId,
  issueIdentifier: sql<string | null>`(
    SELECT p.key || '-' || i.sequence_number
      FROM issue i JOIN project p ON p.id = i.project_id
     WHERE i.id = ${projectActionRun.issueId}
  )`,
  actorUserId: projectActionRun.actorUserId,
  actorName: user.name,
  actionName: projectActionRun.actionName,
  trigger: projectActionRun.trigger,
  fromColumnId: projectActionRun.fromColumnId,
  fromColumnName: sql<string | null>`(
    SELECT name FROM project_column c WHERE c.id = ${projectActionRun.fromColumnId}
  )`,
  toColumnId: projectActionRun.toColumnId,
  toColumnName: sql<string | null>`(
    SELECT name FROM project_column c WHERE c.id = ${projectActionRun.toColumnId}
  )`,
  depth: projectActionRun.depth,
  status: projectActionRun.status,
  attempts: projectActionRun.attempts,
  lastError: projectActionRun.lastError,
  result: projectActionRun.result,
  startedAt: projectActionRun.startedAt,
  finishedAt: projectActionRun.finishedAt,
  createdAt: projectActionRun.createdAt,
};

function mapActionRun(row: {
  id: string;
  actionId: number | null;
  projectId: number;
  issueId: number | null;
  issueIdentifier: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actionName: string;
  trigger: string;
  fromColumnId: number;
  fromColumnName: string | null;
  toColumnId: number;
  toColumnName: string | null;
  depth: number;
  status: string;
  attempts: number;
  lastError: string | null;
  result: { changedFields: string[] } | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}): ActionRunRow {
  return {
    ...row,
    trigger: row.trigger as ActionRunRow['trigger'],
    status: row.status as ActionRunRow['status'],
    startedAt: row.startedAt ? iso(row.startedAt) : null,
    finishedAt: row.finishedAt ? iso(row.finishedAt) : null,
    createdAt: iso(row.createdAt),
  };
}

export async function listActionRuns(projectId: number): Promise<ActionRunRow[]> {
  const rows = await db
    .select(actionRunColumns)
    .from(projectActionRun)
    .leftJoin(user, eq(user.id, projectActionRun.actorUserId))
    .where(eq(projectActionRun.projectId, projectId))
    .orderBy(desc(projectActionRun.createdAt), desc(projectActionRun.id))
    .limit(50);
  return rows.map(mapActionRun);
}

export async function getActionRun(id: string): Promise<ActionRunRow | null> {
  const [row] = await db
    .select(actionRunColumns)
    .from(projectActionRun)
    .leftJoin(user, eq(user.id, projectActionRun.actorUserId))
    .where(eq(projectActionRun.id, id));
  if (!row) return null;
  const steps = await db
    .select()
    .from(projectActionRunStep)
    .where(eq(projectActionRunStep.runId, id))
    .orderBy(projectActionRunStep.startedAt, projectActionRunStep.nodeId);
  return {
    ...mapActionRun(row),
    steps: steps.map((step) => ({
      nodeId: step.nodeId,
      nodeType: step.nodeType as ActionRunStepRow['nodeType'],
      status: step.status as ActionRunStepRow['status'],
      result: step.result,
      lastError: step.lastError,
      startedAt: step.startedAt ? iso(step.startedAt) : null,
      finishedAt: step.finishedAt ? iso(step.finishedAt) : null,
    })),
  };
}

function validatedWorkflow(
  workflow: unknown,
  trigger: ActionRow['trigger'],
  condition: unknown,
  effect: unknown,
): WorkflowDefinition {
  try {
    return workflow == null
      ? legacyWorkflow(trigger, condition ?? { conditions: [] }, effect ?? {})
      : validateWorkflowDefinition(workflow);
  } catch (error) {
    if (error instanceof WorkflowValidationError) throw new HttpError(400, error.message);
    throw error;
  }
}
