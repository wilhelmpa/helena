import { randomUUID } from 'node:crypto';
import {
  db,
  project,
  projectProvisioningJob,
  projectView,
  projectViewFavorite,
  projectViewFolder,
} from '@repo/db';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  DEFAULT_VIEWS,
  allTasksSuffixes,
  defaultNames,
  defaultViewNames,
} from '@helena/locales/defaults';
import { HttpError, iso, num, rethrowDuplicate } from '#shared/lib';
import type { Locale } from '#modules/user-preferences/locale';
import { projectLocale } from '#modules/user-preferences/service';
import { areaFolderSlug, assertAreaFolder, uniqueAreaFolder } from './area-folder';

export interface ViewRow {
  id: number;
  projectId: number;
  folderId: number | null;
  name: string;
  icon: string | null;
  filters: unknown;
  display: unknown;
  position: number;
  // Unguessable token for the public read-only share link, or null when the view
  // is not shared.
  shareToken: string | null;
  // Whether the share link exposes the full issues (assignees, labels, custom
  // fields, activity) or only their title, description, state, type, priority,
  // dates, subtasks and links.
  shareExtended: boolean;
  createdAt: string;
}

function mapView(row: typeof projectView.$inferSelect): ViewRow {
  return {
    id: row.id,
    projectId: row.projectId,
    folderId: row.folderId,
    name: row.name,
    icon: row.icon,
    filters: row.filters,
    display: row.display,
    position: num(row.position),
    shareToken: row.shareToken,
    shareExtended: row.shareExtended,
    createdAt: iso(row.createdAt),
  };
}

export interface UserViewRow extends ViewRow {
  favorite: boolean;
}

export interface ViewFolderRow {
  id: number;
  projectId: number;
  name: string;
  folder: string;
  position: number;
  createdAt: string;
}

function mapFolder(row: typeof projectViewFolder.$inferSelect): ViewFolderRow {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    folder: row.folder,
    position: num(row.position),
    createdAt: iso(row.createdAt),
  };
}

export async function listViewFolders(projectId: number): Promise<ViewFolderRow[]> {
  const rows = await db
    .select()
    .from(projectViewFolder)
    .where(eq(projectViewFolder.projectId, projectId))
    .orderBy(projectViewFolder.position, projectViewFolder.id);
  return rows.map(mapFolder);
}

export async function getViewFolder(id: number): Promise<ViewFolderRow | null> {
  const [row] = await db.select().from(projectViewFolder).where(eq(projectViewFolder.id, id));
  return row ? mapFolder(row) : null;
}

export async function createViewFolder(
  projectId: number,
  input: { name: string; folder?: string },
): Promise<ViewFolderRow> {
  const name = input.name.trim();
  if (!name) throw new HttpError(400, 'Folder name is required');
  return db.transaction(async (tx) => {
    const taken = await areaFolders(tx, projectId);
    const folder = input.folder ?? uniqueAreaFolder(areaFolderSlug(name), taken);
    assertAreaFolder(folder, taken);
    const [{ pos }] = await tx
      .select({ pos: sql<number>`COALESCE(MAX(${projectViewFolder.position}) + 1, 0)` })
      .from(projectViewFolder)
      .where(eq(projectViewFolder.projectId, projectId));
    const row = await tx
      .insert(projectViewFolder)
      .values({ projectId, name, folder, position: Number(pos) })
      .returning()
      .then(([created]) => created)
      .catch((err: unknown) => rethrowDuplicate(err, 'area'));
    await queueAreaProvisioning(tx, projectId);
    return mapFolder(row);
  });
}

// A folder that still follows the area's name follows a rename too; one set by hand
// stays until it is changed by hand.
export async function updateViewFolder(
  id: number,
  patch: { name?: string; folder?: string },
): Promise<ViewFolderRow | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(projectViewFolder)
      .where(eq(projectViewFolder.id, id))
      .for('update');
    if (!current) return null;
    const name = patch.name?.trim() ?? current.name;
    if (!name) throw new HttpError(400, 'Folder name is required');
    const taken = await areaFolders(tx, current.projectId, id);
    const follows = current.folder === uniqueAreaFolder(areaFolderSlug(current.name), taken);
    const folder =
      patch.folder ?? (follows ? uniqueAreaFolder(areaFolderSlug(name), taken) : current.folder);
    if (folder !== current.folder) assertAreaFolder(folder, taken);
    const row = await tx
      .update(projectViewFolder)
      .set({ name, folder })
      .where(eq(projectViewFolder.id, id))
      .returning()
      .then(([updated]) => updated)
      .catch((err: unknown) => rethrowDuplicate(err, 'area'));
    if (folder !== current.folder || name !== current.name) {
      await queueAreaProvisioning(tx, current.projectId);
    }
    return mapFolder(row);
  });
}

export async function deleteViewFolder(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(projectViewFolder)
      .where(eq(projectViewFolder.id, id))
      .returning({ projectId: projectViewFolder.projectId });
    if (row) await queueAreaProvisioning(tx, row.projectId);
  });
}

async function areaFolders(
  tx: Transaction,
  projectId: number,
  exceptId?: number,
): Promise<Set<string>> {
  const rows = await tx
    .select({ folder: projectViewFolder.folder })
    .from(projectViewFolder)
    .where(
      and(
        eq(projectViewFolder.projectId, projectId),
        exceptId === undefined ? undefined : ne(projectViewFolder.id, exceptId),
      ),
    );
  return new Set(rows.map((row) => row.folder));
}

// The worker sends the project's current areas, names included, with every
// provisioning request, so a change to them only has to make the request new: a retry
// of the old one with other contents would be refused by the integration service.
async function queueAreaProvisioning(tx: Transaction, projectId: number): Promise<void> {
  await tx
    .update(projectProvisioningJob)
    .set({
      id: randomUUID(),
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      result: null,
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(projectProvisioningJob.projectId, projectId));
}

function assertExactIds(actual: number[], ordered: number[], subject: string): void {
  if (new Set(ordered).size !== ordered.length) {
    throw new HttpError(400, `${subject} order contains duplicate ids`);
  }
  const expected = [...actual].sort((a, b) => a - b);
  const received = [...ordered].sort((a, b) => a - b);
  if (expected.length !== received.length || expected.some((id, index) => id !== received[index])) {
    throw new HttpError(400, `${subject} order must contain every id exactly once`);
  }
}

export async function reorderViewFolders(
  projectId: number,
  orderedIds: number[],
): Promise<ViewFolderRow[]> {
  const rows = await db
    .select({ id: projectViewFolder.id })
    .from(projectViewFolder)
    .where(eq(projectViewFolder.projectId, projectId));
  assertExactIds(
    rows.map((row) => row.id),
    orderedIds,
    'Folder',
  );
  await db.transaction(async (tx) => {
    for (const [position, id] of orderedIds.entries()) {
      await tx.update(projectViewFolder).set({ position }).where(eq(projectViewFolder.id, id));
    }
  });
  return listViewFolders(projectId);
}

export async function listViews(projectId: number, userId: string): Promise<UserViewRow[]> {
  const rows = await db
    .select({ row: projectView, favoriteUserId: projectViewFavorite.userId })
    .from(projectView)
    .leftJoin(projectViewFolder, eq(projectViewFolder.id, projectView.folderId))
    .leftJoin(
      projectViewFavorite,
      and(eq(projectViewFavorite.viewId, projectView.id), eq(projectViewFavorite.userId, userId)),
    )
    .where(eq(projectView.projectId, projectId))
    .orderBy(
      sql`${projectView.folderId} IS NOT NULL`,
      projectViewFolder.position,
      projectView.position,
      projectView.id,
    );
  return rows.map(({ row, favoriteUserId }) => ({
    ...mapView(row),
    favorite: favoriteUserId !== null,
  }));
}

export async function isFavoriteView(viewId: number, userId: string): Promise<boolean> {
  const rows = await db
    .select({ viewId: projectViewFavorite.viewId })
    .from(projectViewFavorite)
    .where(and(eq(projectViewFavorite.viewId, viewId), eq(projectViewFavorite.userId, userId)));
  return rows.length > 0;
}

export async function addFavoriteView(viewId: number, userId: string): Promise<void> {
  await db.insert(projectViewFavorite).values({ viewId, userId }).onConflictDoNothing();
}

export async function removeFavoriteView(viewId: number, userId: string): Promise<void> {
  await db
    .delete(projectViewFavorite)
    .where(and(eq(projectViewFavorite.viewId, viewId), eq(projectViewFavorite.userId, userId)));
}

export async function createView(input: {
  projectId: number;
  folderId?: number | null;
  name: string;
  icon?: string | null;
  filters?: unknown;
  display?: unknown;
}): Promise<ViewRow> {
  return db.transaction(async (tx) => {
    if (input.folderId != null) await assertFolderInProject(input.folderId, input.projectId, tx);
    const [{ pos }] = await tx
      .select({ pos: sql<number>`COALESCE(MAX(${projectView.position}) + 1, 0)` })
      .from(projectView)
      .where(
        and(
          eq(projectView.projectId, input.projectId),
          input.folderId == null
            ? isNull(projectView.folderId)
            : eq(projectView.folderId, input.folderId),
        ),
      );
    const [row] = await tx
      .insert(projectView)
      .values({
        projectId: input.projectId,
        folderId: input.folderId ?? null,
        name: input.name.trim(),
        icon: input.icon ?? null,
        filters: input.filters ?? {},
        display: input.display ?? {},
        position: Number(pos),
      })
      .returning();
    await enqueueBoardProvisioning(tx, input.projectId, [row.id]);
    return mapView(row);
  });
}

export async function getView(id: number): Promise<ViewRow | null> {
  const rows = await db.select().from(projectView).where(eq(projectView.id, id));
  return rows[0] ? mapView(rows[0]) : null;
}

export async function updateView(
  id: number,
  patch: {
    name?: string;
    icon?: string | null;
    filters?: unknown;
    display?: unknown;
    folderId?: number | null;
  },
): Promise<ViewRow | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(projectView).where(eq(projectView.id, id));
    if (!current) return null;
    const set: Partial<typeof projectView.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.filters !== undefined) set.filters = patch.filters;
    if (patch.display !== undefined) set.display = patch.display;
    if (patch.folderId !== undefined && patch.folderId !== current.folderId) {
      if (patch.folderId != null)
        await assertFolderInProject(patch.folderId, current.projectId, tx);
      const [{ pos }] = await tx
        .select({ pos: sql<number>`COALESCE(MAX(${projectView.position}) + 1, 0)` })
        .from(projectView)
        .where(
          and(
            eq(projectView.projectId, current.projectId),
            patch.folderId == null
              ? isNull(projectView.folderId)
              : eq(projectView.folderId, patch.folderId),
          ),
        );
      set.folderId = patch.folderId;
      set.position = Number(pos);
    }
    if (Object.keys(set).length === 0) return mapView(current);
    const [row] = await tx.update(projectView).set(set).where(eq(projectView.id, id)).returning();
    if (!row) return null;
    if (patch.name !== undefined || patch.folderId !== undefined)
      await enqueueBoardProvisioning(tx, current.projectId, [id]);
    return mapView(row);
  });
}

export async function deleteView(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(projectView)
      .where(eq(projectView.id, id))
      .returning({ projectId: projectView.projectId });
    if (row) await enqueueBoardProvisioning(tx, row.projectId, []);
  });
}

export async function reorderViews(
  projectId: number,
  folderId: number | null,
  orderedIds: number[],
  userId: string,
): Promise<UserViewRow[]> {
  if (folderId != null) await assertFolderInProject(folderId, projectId);
  const rows = await db
    .select({ id: projectView.id })
    .from(projectView)
    .where(
      and(
        eq(projectView.projectId, projectId),
        folderId == null ? isNull(projectView.folderId) : eq(projectView.folderId, folderId),
      ),
    );
  assertExactIds(
    rows.map((row) => row.id),
    orderedIds,
    'View',
  );
  await db.transaction(async (tx) => {
    for (const [position, id] of orderedIds.entries()) {
      await tx
        .update(projectView)
        .set({ position })
        .where(and(eq(projectView.id, id), eq(projectView.projectId, projectId)));
    }
  });
  return listViews(projectId, userId);
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function explicitLayout(display: unknown): unknown {
  return display && typeof display === 'object' && !Array.isArray(display)
    ? (display as { layout?: unknown }).layout
    : undefined;
}

function isUnfiltered(filters: unknown): boolean {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return true;
  const entries = Object.entries(filters);
  return entries.every(
    ([key, value]) => key === 'conditions' && Array.isArray(value) && value.length === 0,
  );
}

function withLayout(display: unknown, layout: string): Record<string, unknown> {
  return {
    ...(display && typeof display === 'object' && !Array.isArray(display) ? display : {}),
    layout,
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Recognizes a project's default view under its name in any language, including the
// bracketed form it gets beside a filtered view of the plain name ("List (All tasks)",
// "Liste (Alle Aufgaben 2)").
function defaultViewMatcher(key: (typeof DEFAULT_VIEWS)[number]['key']) {
  const names = defaultViewNames(key);
  const plain = new Set(names.map((name) => name.toLowerCase()));
  const generated = new RegExp(
    `^(?:${names.map(escapeRegExp).join('|')}) \\((?:${allTasksSuffixes()
      .map(escapeRegExp)
      .join('|')})(?: [2-9][0-9]*)?\\)$`,
    'i',
  );
  return (name: string) => plain.has(name.toLowerCase()) || generated.test(name);
}

// Makes sure the project has its default views (the board and the list of all tasks). A
// view that already is one, in whatever language it was named, is kept; a missing one is
// created in `locale`, or in the project's language when the caller has none.
export async function ensureDefaultProjectViews(
  tx: Transaction,
  projectId: number,
  locale?: Locale,
): Promise<{ ids: number[]; changed: boolean }> {
  const [lockedProject] = await tx
    .select({ id: project.id })
    .from(project)
    .where(eq(project.id, projectId))
    .for('update');
  if (!lockedProject) throw new HttpError(404, 'Project not found');
  const current = await tx
    .select()
    .from(projectView)
    .where(eq(projectView.projectId, projectId))
    .orderBy(projectView.position, projectView.id);
  const ids: number[] = [];
  let changed = false;
  let nextPosition = current.reduce((max, view) => Math.max(max, Number(view.position)), -1) + 1;
  // The project's language is looked up only when a view is named.
  let language = locale;
  const names = async () => defaultNames((language ??= await projectLocale(projectId, tx))).views;

  for (const expected of DEFAULT_VIEWS) {
    const isDefault = defaultViewMatcher(expected.key);
    const named = current.find((view) => isDefault(view.name) && isUnfiltered(view.filters));
    const projectBoard =
      expected.layout === 'kanban'
        ? current.find(
            (view) => view.name.toLowerCase() === 'project board' && isUnfiltered(view.filters),
          )
        : undefined;
    const existing = named ?? projectBoard;
    if (existing) {
      const set: Partial<typeof projectView.$inferInsert> = {};
      if (projectBoard?.id === existing.id && !named) set.name = (await names())[expected.key];
      if (explicitLayout(existing.display) !== expected.layout) {
        set.display = withLayout(existing.display, expected.layout);
      }
      if (Object.keys(set).length) {
        await tx.update(projectView).set(set).where(eq(projectView.id, existing.id));
        changed = true;
      }
      existing.name = set.name ?? existing.name;
      existing.display = set.display ?? existing.display;
      ids.push(existing.id);
      continue;
    }
    const { [expected.key]: base, allTasks } = await names();
    const taken = new Set(current.map((view) => view.name.toLowerCase()));
    let name = base;
    if (taken.has(name.toLowerCase())) name = `${base} (${allTasks})`;
    let suffix = 2;
    while (taken.has(name.toLowerCase())) name = `${base} (${allTasks} ${suffix++})`;
    const [created] = await tx
      .insert(projectView)
      .values({
        projectId,
        name,
        filters: {},
        display: { layout: expected.layout },
        position: nextPosition++,
      })
      .returning({ id: projectView.id });
    current.push({
      id: created.id,
      projectId,
      folderId: null,
      name,
      icon: null,
      filters: {},
      display: { layout: expected.layout },
      position: nextPosition - 1,
      shareToken: null,
      shareExtended: false,
      createdAt: new Date(),
    });
    ids.push(created.id);
    changed = true;
  }
  return { ids, changed };
}

export async function backfillDefaultProjectViews(
  projectId: number,
  userId: string,
): Promise<UserViewRow[]> {
  await db.transaction(async (tx) => {
    const result = await ensureDefaultProjectViews(tx, projectId);
    const [job] = await tx
      .select({ requestedResources: projectProvisioningJob.requestedResources })
      .from(projectProvisioningJob)
      .where(eq(projectProvisioningJob.projectId, projectId));
    const missingResource = result.ids.some(
      (id) => !job?.requestedResources.includes(`board:${id}`),
    );
    if (result.changed || missingResource) {
      await enqueueBoardProvisioning(tx, projectId, result.ids);
    }
  });
  return listViews(projectId, userId);
}

export async function enqueueBoardProvisioning(
  tx: Transaction,
  projectId: number,
  viewIds: number[],
): Promise<void> {
  const resources = [...new Set(viewIds)].map((id) => `board:${id}`);
  const [job] = await tx
    .select()
    .from(projectProvisioningJob)
    .where(eq(projectProvisioningJob.projectId, projectId))
    .for('update');
  if (!job) {
    if (resources.length) {
      await tx.insert(projectProvisioningJob).values({ projectId, requestedResources: resources });
    }
    return;
  }
  const existingBoardIds = job.requestedResources.flatMap((resource) => {
    const match = /^board:([1-9][0-9]{0,9})$/.exec(resource);
    return match ? [Number(match[1])] : [];
  });
  const boardIds = [...new Set([...existingBoardIds, ...viewIds])];
  const liveBoards = boardIds.length
    ? await tx
        .select({ id: projectView.id })
        .from(projectView)
        .where(and(eq(projectView.projectId, projectId), inArray(projectView.id, boardIds)))
    : [];
  if (liveBoards.length > 200)
    throw new HttpError(409, 'A project may provision at most 200 boards');
  const requestedResources = [
    ...job.requestedResources.filter((resource) => !resource.startsWith('board:')),
    ...liveBoards.map(({ id }) => `board:${id}`),
  ];
  if (requestedResources.length > 256) throw new HttpError(409, 'Too many provisioning resources');
  // Without a changed or new board there is nothing for the provisioner to do.
  if (
    !resources.length &&
    requestedResources.length === job.requestedResources.length &&
    requestedResources.every((resource) => job.requestedResources.includes(resource))
  ) {
    return;
  }
  await tx
    .update(projectProvisioningJob)
    .set({
      id: randomUUID(),
      requestedResources,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      result: null,
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(projectProvisioningJob.id, job.id));
}

async function assertFolderInProject(
  folderId: number,
  projectId: number,
  client: Pick<Transaction, 'select'> | typeof db = db,
): Promise<void> {
  const [folder] = await client
    .select({ id: projectViewFolder.id })
    .from(projectViewFolder)
    .where(and(eq(projectViewFolder.id, folderId), eq(projectViewFolder.projectId, projectId)));
  if (!folder) throw new HttpError(400, 'View folder does not belong to this project');
}
