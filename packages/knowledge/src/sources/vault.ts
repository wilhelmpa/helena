import { and, asc, eq, gt, gte, inArray, like, ne, or, type SQL } from 'drizzle-orm';
import { db, knowledgeItem, project, vaultEntry, vaultLink } from '@repo/db';
import { belowPattern, frontmatterTags, locateVaultPath, pathOrBelow } from '@repo/vault';
import { reindexItems } from '../indexer';
import type { KnowledgeItem, KnowledgeLink, KnowledgeScope, KnowledgeSource } from '@helena/sdk';
import { taskTarget } from '../text';
import {
  cursorId,
  instanceHome,
  iso,
  nextCursor,
  pageLimit,
  routes,
  type InstanceHome,
} from './common';

// The vault's notes and files (a board's .canvas too), from the vault's own index
// (vault_entry), which the API and the worker's watcher keep in line with the files.
// Folders are not items. Who reads a path follows the vault's rules
// (apps/api/src/modules/knowledge/scope.ts): a project's folder by the project's
// documents permission, Home/ by the instance owner and the Home agent, Templates/ by
// everyone of the team, Private/ by the instance owner alone.

// The resource a reader needs for Home's own folder of the vault: only the instance
// owner and the Home agent hold it (the API's reach), not every team owner.
export const HOME_VAULT_RESOURCE = 'home_vault';

type EntryRow = typeof vaultEntry.$inferSelect & {
  teamId: number | null;
  projectKey: string | null;
};

function scopeOf(row: EntryRow, home: InstanceHome): KnowledgeScope | null {
  const location = locateVaultPath(row.path);
  switch (location.scope) {
    case 'project':
      return row.projectId !== null && row.teamId !== null
        ? {
            teamId: row.teamId,
            projectId: row.projectId,
            visibility: 'project',
            permission: 'documents',
          }
        : null;
    case 'private':
      return home.ownerId !== null && home.teamId !== null
        ? { teamId: home.teamId, projectId: null, visibility: 'private', ownerId: home.ownerId }
        : null;
    case 'templates':
      return home.teamId !== null
        ? { teamId: home.teamId, projectId: null, visibility: 'team', permission: null }
        : null;
    default:
      return home.teamId !== null
        ? {
            teamId: home.teamId,
            projectId: null,
            visibility: 'team',
            permission: HOME_VAULT_RESOURCE,
          }
        : null;
  }
}

// Where a captured note came from, as its properties name it (Obsidian's web clipper
// writes `source`, older notes `url` or the German `quelle`).
function originOf(frontmatter: Record<string, unknown>): string | null {
  for (const key of ['source', 'url', 'quelle']) {
    const value = frontmatter[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function hrefOf(row: EntryRow): string {
  if (row.kind === 'note') return routes.note(row.path);
  if (row.path.toLowerCase().endsWith('.canvas')) return routes.board(row.path);
  return routes.file(row.path);
}

function toItem(row: EntryRow, links: KnowledgeLink[], home: InstanceHome): KnowledgeItem | null {
  const scope = scopeOf(row, home);
  if (!scope) return null;
  const changed = iso(row.mtime ?? row.indexedAt);
  const tags = frontmatterTags(row.frontmatter);
  return {
    id: row.path,
    title: row.title,
    text: row.text ?? '',
    href: hrefOf(row),
    mimeType: row.mime ?? undefined,
    scope,
    provenance: {
      createdAt: changed,
      updatedAt: changed,
      author: row.lastAuthor,
      origin: originOf(row.frontmatter),
      runId: row.lastRunId,
    },
    metadata: {
      kind: row.kind,
      path: row.path,
      projectKey: row.projectKey,
      tags,
      extraction: row.extractionStatus,
      sizeBytes: row.sizeBytes,
    },
    links,
  };
}

async function linksOf(ids: number[]): Promise<Map<number, KnowledgeLink[]>> {
  const byEntry = new Map<number, KnowledgeLink[]>();
  if (ids.length === 0) return byEntry;
  const rows = await db
    .select({ entryId: vaultLink.entryId, kind: vaultLink.kind, target: vaultLink.target })
    .from(vaultLink)
    .where(and(inArray(vaultLink.entryId, ids), ne(vaultLink.kind, 'note')));
  for (const row of rows) {
    const link: KnowledgeLink =
      row.kind === 'task'
        ? { target: taskTarget(row.target), kind: 'mentions' }
        : { target: row.target, kind: 'related' };
    byEntry.set(row.entryId, [...(byEntry.get(row.entryId) ?? []), link]);
  }
  return byEntry;
}

async function entries(where: SQL | undefined, limit?: number): Promise<EntryRow[]> {
  const query = db
    .select({
      entry: vaultEntry,
      teamId: project.teamId,
      projectKey: project.key,
    })
    .from(vaultEntry)
    .leftJoin(project, eq(project.id, vaultEntry.projectId))
    .where(and(ne(vaultEntry.kind, 'folder'), where))
    .orderBy(asc(vaultEntry.id));
  const rows = limit ? await query.limit(limit) : await query;
  return rows.map((row) => ({ ...row.entry, teamId: row.teamId, projectKey: row.projectKey }));
}

async function toItems(rows: EntryRow[]): Promise<KnowledgeItem[]> {
  if (rows.length === 0) return [];
  const home = await instanceHome();
  const links = await linksOf(rows.map((row) => row.id));
  return rows
    .map((row) => toItem(row, links.get(row.id) ?? [], home))
    .filter((item): item is KnowledgeItem => item !== null);
}

export const vaultSource: KnowledgeSource = {
  id: 'vault',
  label: { i18n: 'knowledge.source.vault' },
  icon: 'file-text',
  async list(ctx) {
    const limit = pageLimit(ctx);
    const rows = await entries(
      and(
        gt(vaultEntry.id, cursorId(ctx)),
        ctx.since ? gte(vaultEntry.indexedAt, ctx.since) : undefined,
      ),
      limit,
    );
    return { items: await toItems(rows), cursor: nextCursor(rows, limit, (row) => row.id) };
  },
  async get(id) {
    const [item] = await toItems(await entries(eq(vaultEntry.path, id)));
    return item ?? null;
  },
  async present(ids) {
    if (ids.length === 0) return [];
    const rows = await db
      .select({ path: vaultEntry.path })
      .from(vaultEntry)
      .where(and(inArray(vaultEntry.path, ids), ne(vaultEntry.kind, 'folder')));
    return rows.map((row) => row.path);
  },
  async resolveLink(ref) {
    const target = ref
      .replace(/^\[\[|\]\]$/g, '')
      .split('|')[0]!
      .split('#')[0]!
      .trim();
    if (!target) return null;
    const [row] = await db
      .select({ path: vaultEntry.path })
      .from(vaultEntry)
      .where(inArray(vaultEntry.path, [target, `${target}.md`]))
      .limit(1);
    return row?.path ?? null;
  },
};

// Brings the vault items at and below the given paths up to date at once: after a write
// through the API, so the search shows it before the worker's next catch-up.
export async function reindexVaultPaths(paths: string[]): Promise<void> {
  const ids = new Set<string>();
  for (const relative of new Set(paths.filter(Boolean))) {
    const [onDisk, indexed] = await Promise.all([
      db
        .select({ path: vaultEntry.path })
        .from(vaultEntry)
        .where(and(ne(vaultEntry.kind, 'folder'), pathOrBelow(relative))),
      db
        .select({ itemId: knowledgeItem.itemId })
        .from(knowledgeItem)
        .where(
          and(
            eq(knowledgeItem.source, 'vault'),
            or(
              eq(knowledgeItem.itemId, relative),
              like(knowledgeItem.itemId, belowPattern(relative)),
            ),
          ),
        ),
    ]);
    for (const row of onDisk) ids.add(row.path);
    for (const row of indexed) ids.add(row.itemId);
  }
  if (ids.size > 0) await reindexItems(vaultSource, [...ids]);
}
