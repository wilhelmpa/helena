import {
  db,
  project,
  projectAction,
  projectColumn,
  projectTemplate,
  projectView,
  projectViewFolder,
} from '@repo/db';
import { and, asc, eq } from 'drizzle-orm';
import { HttpError, iso, rethrowDuplicate } from '#shared/lib';
import {
  validateWorkflowDefinition,
  legacyWorkflow,
  workflowLegacyFields,
  workflowTrigger,
} from '#modules/actions/workflow';
import { enqueueBoardProvisioning, ensureDefaultProjectViews } from '#modules/views/service';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type TemplateKind = 'project' | 'board';

interface TemplateState {
  name: string;
  stateType: string;
  color: string;
  position: number;
}
interface TemplateFolder {
  key: string;
  name: string;
  position: number;
}
interface TemplateView {
  name: string;
  folderKey: string | null;
  icon: string | null;
  filters: unknown;
  display: unknown;
  position: number;
}
interface TemplateWorkflow {
  name: string;
  icon: string;
  enabled: boolean;
  position: number;
  workflow: unknown;
}
interface TemplateDefinition {
  version: 1;
  states: TemplateState[];
  folders: TemplateFolder[];
  views: TemplateView[];
  workflows: TemplateWorkflow[];
}

export interface ProjectTemplateRow {
  id: number;
  teamId: number;
  kind: TemplateKind;
  name: string;
  description: string;
  createdBy: string | null;
  stateCount: number;
  folderCount: number;
  viewCount: number;
  workflowCount: number;
  createdAt: string;
  updatedAt: string;
}

export async function listProjectTemplates(projectId: number): Promise<ProjectTemplateRow[]> {
  const teamId = await projectTeamId(projectId);
  const rows = await db
    .select()
    .from(projectTemplate)
    .where(eq(projectTemplate.teamId, teamId))
    .orderBy(asc(projectTemplate.kind), asc(projectTemplate.name));
  return rows.map(mapTemplate);
}

export async function getProjectTemplate(id: number) {
  const [row] = await db.select().from(projectTemplate).where(eq(projectTemplate.id, id));
  return row ?? null;
}

export async function captureProjectTemplate(input: {
  projectId: number;
  createdBy: string;
  name: string;
  description?: string;
  kind: TemplateKind;
}): Promise<ProjectTemplateRow> {
  const teamId = await projectTeamId(input.projectId);
  const definition = await captureDefinition(input.projectId);
  try {
    const [row] = await db
      .insert(projectTemplate)
      .values({
        teamId,
        createdBy: input.createdBy,
        kind: input.kind,
        name: input.name.trim(),
        description: input.description?.trim() ?? '',
        definition,
      })
      .returning();
    return mapTemplate(row);
  } catch (error) {
    rethrowDuplicate(error, 'A template with this name and kind already exists');
  }
}

export async function updateProjectTemplate(
  projectId: number,
  templateId: number,
  patch: { name?: string; description?: string },
): Promise<ProjectTemplateRow | null> {
  const teamId = await projectTeamId(projectId);
  const set: Partial<typeof projectTemplate.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.description !== undefined) set.description = patch.description.trim();
  try {
    const [row] = await db
      .update(projectTemplate)
      .set(set)
      .where(and(eq(projectTemplate.id, templateId), eq(projectTemplate.teamId, teamId)))
      .returning();
    return row ? mapTemplate(row) : null;
  } catch (error) {
    rethrowDuplicate(error, 'A template with this name and kind already exists');
  }
}

export async function deleteProjectTemplate(
  projectId: number,
  templateId: number,
): Promise<boolean> {
  const teamId = await projectTeamId(projectId);
  const rows = await db
    .delete(projectTemplate)
    .where(and(eq(projectTemplate.id, templateId), eq(projectTemplate.teamId, teamId)))
    .returning({ id: projectTemplate.id });
  return rows.length > 0;
}

export async function applyProjectTemplate(
  projectId: number,
  templateId: number,
): Promise<{
  states: number;
  folders: number;
  views: number;
  workflows: number;
  requestedResources: string[];
}> {
  return db.transaction((tx) => applyProjectTemplateInTransaction(tx, projectId, templateId));
}

export async function applyProjectTemplateInTransaction(
  tx: Transaction,
  projectId: number,
  templateId: number,
) {
  const [target, template] = await Promise.all([
    tx
      .select({ teamId: project.teamId, key: project.key })
      .from(project)
      .where(eq(project.id, projectId)),
    tx.select().from(projectTemplate).where(eq(projectTemplate.id, templateId)),
  ]);
  if (!target[0] || !template[0] || target[0].teamId !== template[0].teamId)
    throw new HttpError(404, 'Project template not found');
  const definition = validateDefinition(template[0].definition);
  const stateIds = await applyStates(tx, projectId, definition.states);
  const folders = await applyFolders(tx, projectId, definition.folders);
  const boardResources = await applyViews(tx, projectId, definition.views, folders, stateIds);
  boardResources.push(...(await ensureDefaultProjectViews(tx, projectId)).ids);
  await applyWorkflows(tx, projectId, definition.workflows, stateIds);
  const stableBoardResources = [...new Set(boardResources)];
  if (stableBoardResources.length)
    await enqueueBoardProvisioning(tx, projectId, stableBoardResources);
  return {
    states: definition.states.length,
    folders: definition.folders.length,
    views: definition.views.length,
    workflows: definition.workflows.length,
    requestedResources: stableBoardResources.map((viewId) => `board:${viewId}`),
  };
}

async function captureDefinition(projectId: number): Promise<TemplateDefinition> {
  const [states, folders, views, workflows] = await Promise.all([
    db
      .select()
      .from(projectColumn)
      .where(eq(projectColumn.projectId, projectId))
      .orderBy(projectColumn.position),
    db
      .select()
      .from(projectViewFolder)
      .where(eq(projectViewFolder.projectId, projectId))
      .orderBy(projectViewFolder.position),
    db
      .select()
      .from(projectView)
      .where(eq(projectView.projectId, projectId))
      .orderBy(projectView.position),
    db
      .select()
      .from(projectAction)
      .where(eq(projectAction.projectId, projectId))
      .orderBy(projectAction.position),
  ]);
  const names = new Map(states.map((state) => [state.id, state.name]));
  const folderKeys = new Map(folders.map((folder) => [folder.id, `folder-${folder.id}`]));
  return {
    version: 1,
    states: states.map(({ name, stateType, color, position }) => ({
      name,
      stateType,
      color,
      position,
    })),
    folders: folders.map(({ id, name, position }) => ({
      key: folderKeys.get(id)!,
      name,
      position: Number(position),
    })),
    views: views.map((view) => ({
      name: view.name,
      folderKey: view.folderId == null ? null : (folderKeys.get(view.folderId) ?? null),
      icon: view.icon,
      filters: replaceStateIds(view.filters, names),
      display: view.display,
      position: Number(view.position),
    })),
    workflows: workflows.map((action) => ({
      name: action.name,
      icon: action.icon,
      enabled: action.enabled,
      position: Number(action.position),
      workflow: replaceStateIds(
        action.workflow ??
          legacyWorkflow(
            action.trigger as 'manual' | 'issue_state_changed' | 'issue_comment_added',
            action.condition,
            action.effect,
          ),
        names,
      ),
    })),
  };
}

async function applyStates(tx: Transaction, projectId: number, states: TemplateState[]) {
  const current = await tx
    .select()
    .from(projectColumn)
    .where(eq(projectColumn.projectId, projectId));
  const ids = new Map<string, number>();
  let next = current.reduce((max, state) => Math.max(max, state.position), -1) + 1;
  for (const state of states) {
    const existing = current.find((row) => row.name.toLowerCase() === state.name.toLowerCase());
    if (existing) {
      ids.set(state.name, existing.id);
      continue;
    }
    const [created] = await tx
      .insert(projectColumn)
      .values({
        projectId,
        name: state.name,
        stateType: state.stateType,
        color: state.color,
        position: next++,
      })
      .returning({ id: projectColumn.id });
    ids.set(state.name, created.id);
  }
  return ids;
}

async function applyFolders(tx: Transaction, projectId: number, folders: TemplateFolder[]) {
  const current = await tx
    .select()
    .from(projectViewFolder)
    .where(eq(projectViewFolder.projectId, projectId));
  const ids = new Map<string, number>();
  let next = current.reduce((max, folder) => Math.max(max, Number(folder.position)), -1) + 1;
  for (const folder of folders) {
    const existing = current.find((row) => row.name.toLowerCase() === folder.name.toLowerCase());
    if (existing) ids.set(folder.key, existing.id);
    else {
      const [created] = await tx
        .insert(projectViewFolder)
        .values({ projectId, name: folder.name, position: next++ })
        .returning({ id: projectViewFolder.id });
      ids.set(folder.key, created.id);
    }
  }
  return ids;
}

async function applyViews(
  tx: Transaction,
  projectId: number,
  views: TemplateView[],
  folders: Map<string, number>,
  states: Map<string, number>,
) {
  const current = await tx.select().from(projectView).where(eq(projectView.projectId, projectId));
  const viewIds: number[] = [];
  for (const view of views) {
    const folderId = view.folderKey == null ? null : (folders.get(view.folderKey) ?? null);
    const values = {
      folderId,
      icon: view.icon,
      filters: restoreStateIds(view.filters, states),
      display: view.display,
    };
    const existing = current.find(
      (row) => row.name.toLowerCase() === view.name.toLowerCase() && row.folderId === folderId,
    );
    if (existing) {
      await tx.update(projectView).set(values).where(eq(projectView.id, existing.id));
      viewIds.push(existing.id);
    } else {
      const [created] = await tx
        .insert(projectView)
        .values({ projectId, name: view.name, position: view.position, ...values })
        .returning({ id: projectView.id });
      viewIds.push(created.id);
    }
  }
  return viewIds;
}

async function applyWorkflows(
  tx: Transaction,
  projectId: number,
  workflows: TemplateWorkflow[],
  states: Map<string, number>,
) {
  const current = await tx
    .select()
    .from(projectAction)
    .where(eq(projectAction.projectId, projectId));
  for (const saved of workflows) {
    const workflow = validateWorkflowDefinition(restoreStateIds(saved.workflow, states));
    const legacy = workflowLegacyFields(workflow);
    const values = {
      icon: saved.icon,
      enabled: saved.enabled,
      trigger: workflowTrigger(workflow),
      condition: legacy.condition,
      effect: legacy.effect,
      workflow,
    };
    const existing = current.find((row) => row.name.toLowerCase() === saved.name.toLowerCase());
    if (existing)
      await tx.update(projectAction).set(values).where(eq(projectAction.id, existing.id));
    else
      await tx
        .insert(projectAction)
        .values({ projectId, name: saved.name, position: saved.position, ...values });
  }
}

function validateDefinition(raw: unknown): TemplateDefinition {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new HttpError(400, 'Template definition is invalid');
  const value = raw as Partial<TemplateDefinition>;
  if (
    value.version !== 1 ||
    !Array.isArray(value.states) ||
    value.states.length > 25 ||
    !Array.isArray(value.folders) ||
    value.folders.length > 25 ||
    !Array.isArray(value.views) ||
    value.views.length > 50 ||
    !Array.isArray(value.workflows) ||
    value.workflows.length > 50 ||
    JSON.stringify(raw).length > 256_000
  )
    throw new HttpError(400, 'Template definition is invalid');
  const text = (candidate: unknown, max: number) =>
    typeof candidate === 'string' && candidate.trim().length > 0 && candidate.length <= max;
  const positions = (candidate: unknown) =>
    typeof candidate === 'number' && Number.isFinite(candidate);
  if (
    value.states.some(
      (state) =>
        !state ||
        !text(state.name, 100) ||
        !['backlog', 'unstarted', 'started', 'completed', 'canceled'].includes(state.stateType) ||
        !/^#[0-9a-f]{6}$/i.test(state.color) ||
        !positions(state.position),
    ) ||
    value.folders.some(
      (folder) =>
        !folder || !text(folder.key, 64) || !text(folder.name, 100) || !positions(folder.position),
    ) ||
    value.views.some(
      (view) =>
        !view ||
        !text(view.name, 100) ||
        (view.folderKey !== null && !text(view.folderKey, 64)) ||
        !positions(view.position),
    ) ||
    value.workflows.some(
      (workflow) =>
        !workflow ||
        !text(workflow.name, 120) ||
        typeof workflow.enabled !== 'boolean' ||
        !positions(workflow.position),
    )
  )
    throw new HttpError(400, 'Template definition is invalid');
  return value as TemplateDefinition;
}

function replaceStateIds(value: unknown, names: Map<number, string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => replaceStateIds(entry, names));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === 'columnId' && typeof entry === 'number' && names.has(entry)
        ? `state:${names.get(entry)}`
        : key === 'values' && record.field === 'status' && Array.isArray(entry)
          ? entry.map((item) =>
              typeof item === 'number' && names.has(item) ? `state:${names.get(item)}` : item,
            )
          : replaceStateIds(entry, names),
    ]),
  );
}

function restoreStateIds(value: unknown, states: Map<string, number>): unknown {
  if (typeof value === 'string' && value.startsWith('state:'))
    return states.get(value.slice(6)) ?? value;
  if (Array.isArray(value)) return value.map((entry) => restoreStateIds(entry, states));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, restoreStateIds(entry, states)]),
  );
}

function mapTemplate(row: typeof projectTemplate.$inferSelect): ProjectTemplateRow {
  const definition = validateDefinition(row.definition);
  return {
    id: row.id,
    teamId: row.teamId,
    kind: row.kind as TemplateKind,
    name: row.name,
    description: row.description,
    createdBy: row.createdBy,
    stateCount: definition.states.length,
    folderCount: definition.folders.length,
    viewCount: definition.views.length,
    workflowCount: definition.workflows.length,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function projectTeamId(projectId: number): Promise<number> {
  const [row] = await db
    .select({ teamId: project.teamId })
    .from(project)
    .where(eq(project.id, projectId));
  if (!row) throw new HttpError(404, 'Project not found');
  return row.teamId;
}
