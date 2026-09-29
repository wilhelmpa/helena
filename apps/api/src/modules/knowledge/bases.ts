import { Elysia, t } from 'elysia';
import { and, asc, eq, ne } from 'drizzle-orm';
import { db, vaultEntry } from '@repo/db';
import {
  compileBaseExpression,
  compileBaseFilter,
  commitVaultPaths,
  composeNote,
  indexVaultPaths,
  isNotePath,
  locateVaultPath,
  parseBase,
  readVaultFile,
  serializeBase,
  writeVaultFile,
  type BaseItem,
  type BaseView,
  UnsupportedBaseExpression,
} from '@repo/vault';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import { vaultGuard } from './guard';
import { readableEntries, type VaultScope } from './scope';
import { reindexVaultItems, vaultCall } from './service';

const path = t.String({ minLength: 1, maxLength: 1024, description: 'Vault path ending in .base' });
const sha = t.String({ pattern: '^[a-f0-9]{64}$' });
const baseQuery = t.Object({ path });
const templateQuery = t.Object({
  path: t.String({ minLength: 1, maxLength: 1024, description: 'Proposed new .md note path' }),
});
const rowsQuery = t.Object({
  path,
  view: t.Optional(t.String({ maxLength: 120, description: 'View name; defaults to first view' })),
  page: t.Optional(t.Numeric({ minimum: 1, maximum: 10001, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 200, default: 50 })),
});
const baseBody = t.Object({
  path,
  content: t.String({ maxLength: 2_000_000 }),
  expectedSha: t.Optional(t.Nullable(sha)),
});
const baseResponse = t.Object({
  path: t.String(),
  content: t.String(),
  sha256: sha,
  definition: t.Any(),
});
const rowsResponse = t.Object({
  path: t.String(),
  view: t.Object({ name: t.String(), type: t.String(), order: t.Array(t.String()) }),
  total: t.Number(),
  page: t.Number(),
  pageSize: t.Number(),
  rows: t.Array(
    t.Object({
      path: t.String(),
      file: t.Object({
        path: t.String(),
        name: t.String(),
        basename: t.String(),
        folder: t.String(),
        ext: t.String(),
        ctime: t.Nullable(t.String()),
        mtime: t.Nullable(t.String()),
      }),
      note: t.Record(t.String(), t.Any()),
      formula: t.Record(t.String(), t.Any()),
      values: t.Record(t.String(), t.Any()),
    }),
  ),
});

function assertBasePath(relative: string): void {
  if (!/\.base$/i.test(relative)) throw new HttpError(400, 'A Base path ends in .base');
}

export async function readBase(relative: string) {
  assertBasePath(relative);
  const file = await readVaultFile(relative, 2 * 1024 * 1024);
  const content = file.bytes.toString('utf8');
  if (content.includes('\0')) throw new HttpError(400, 'A Base must be text');
  return {
    path: relative,
    content,
    sha256: file.sha256,
    definition: parseBase(content).definition,
  };
}

export async function writeBase(
  scope: VaultScope,
  relative: string,
  content: string,
  expectedSha: string | null,
) {
  assertBasePath(relative);
  const parsed = parseBase(content);
  const bytes = Buffer.from(serializeBase(parsed));
  const saved = await writeVaultFile(relative, bytes, expectedSha);
  await indexVaultPaths([relative], { author: scope.actor.ref, runId: scope.actor.runId });
  await commitVaultPaths(
    [relative],
    `${saved.created ? 'Create' : 'Update'} ${relative}`,
    scope.author,
    {
      trailers: { 'Volition-Actor': scope.actor.ref },
    },
  );
  await reindexVaultItems([relative]);
  return {
    path: relative,
    content: bytes.toString('utf8'),
    sha256: saved.sha256,
    definition: parsed.definition,
  };
}

function selectedView(views: BaseView[], name?: string): BaseView {
  const view = name ? views.find((candidate) => candidate.name === name) : views[0];
  if (!view) throw new HttpError(404, 'Base view not found');
  if (!['table', 'cards', 'list'].includes(view.type)) {
    throw new HttpError(422, `Unsupported Base view: ${view.type}`);
  }
  return view;
}

function sortSpec(value: unknown): { property: string; descending: boolean }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new UnsupportedBaseExpression(JSON.stringify(value));
  return value.map((part) => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) {
      throw new UnsupportedBaseExpression(JSON.stringify(part));
    }
    const candidate = part as Record<string, unknown>;
    if (
      typeof candidate.property !== 'string' ||
      (candidate.direction !== 'ASC' && candidate.direction !== 'DESC')
    ) {
      throw new UnsupportedBaseExpression(JSON.stringify(part));
    }
    return { property: candidate.property, descending: candidate.direction === 'DESC' };
  });
}

function field(item: BaseItem, key: string): unknown {
  if (!/^(file|note|formula)\.[A-Za-z_][\w.]*$/.test(key)) {
    throw new UnsupportedBaseExpression(key);
  }
  const [namespace, ...parts] = key.split('.');
  let value: unknown = item[namespace as keyof BaseItem];
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !(part in value)) return null;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export async function baseRows(
  scope: VaultScope,
  relative: string,
  options: { view?: string; page: number; pageSize: number },
) {
  const base = await readBase(relative);
  const view = selectedView(base.definition.views, options.view);
  try {
    const globalFilter = compileBaseFilter(base.definition.filters);
    const viewFilter = compileBaseFilter(view.filters);
    const formulas = Object.entries(base.definition.formulas ?? {}).map(([name, expression]) => {
      if (
        !/^[A-Za-z_][\w]*$/.test(name) ||
        ['__proto__', 'constructor', 'prototype'].includes(name) ||
        typeof expression !== 'string' ||
        /\bformula\./.test(expression)
      )
        throw new UnsupportedBaseExpression(JSON.stringify(expression));
      return [name, compileBaseExpression(expression)] as const;
    });
    const order = view.order ?? ['file.name'];
    if (!Array.isArray(order) || !order.every((item) => typeof item === 'string')) {
      throw new UnsupportedBaseExpression(JSON.stringify(order));
    }
    order.forEach((property) =>
      field({ file: {} as BaseItem['file'], note: {}, formula: {} }, property),
    );
    const sort = sortSpec(view.sort);
    const rows = await db
      .select({
        path: vaultEntry.path,
        frontmatter: vaultEntry.frontmatter,
        mtime: vaultEntry.mtime,
      })
      .from(vaultEntry)
      .where(
        and(readableEntries(scope), eq(vaultEntry.kind, 'note'), ne(vaultEntry.path, relative)),
      )
      .orderBy(asc(vaultEntry.path))
      .limit(10001);
    if (rows.length > 10000) throw new HttpError(413, 'Base scope exceeds 10000 notes');
    const items: BaseItem[] = [];
    for (const row of rows) {
      if (!isNotePath(row.path)) continue;
      const name = row.path.slice(row.path.lastIndexOf('/') + 1);
      const item: BaseItem = {
        file: {
          path: row.path,
          name,
          basename: name.replace(/\.md$/i, ''),
          folder: row.path.slice(0, row.path.lastIndexOf('/')),
          ext: 'md',
          ctime: null,
          mtime: row.mtime?.toISOString() ?? null,
        },
        note: row.frontmatter ?? {},
        formula: Object.create(null) as Record<string, unknown>,
      };
      for (const [formula, evaluate] of formulas) item.formula[formula] = evaluate(item);
      if (globalFilter(item) && viewFilter(item)) items.push(item);
    }
    items.sort((a, b) => {
      for (const part of sort) {
        const result = compare(field(a, part.property), field(b, part.property));
        if (result) return part.descending ? -result : result;
      }
      return a.file.path.localeCompare(b.file.path);
    });
    const viewLimit = view.limit;
    if (viewLimit !== undefined && (!Number.isInteger(viewLimit) || viewLimit < 1)) {
      throw new UnsupportedBaseExpression(JSON.stringify(viewLimit));
    }
    const limited = viewLimit ? items.slice(0, viewLimit) : items;
    return {
      path: relative,
      view: { name: view.name ?? view.type, type: view.type, order },
      total: limited.length,
      page: options.page,
      pageSize: options.pageSize,
      rows: limited
        .slice((options.page - 1) * options.pageSize, options.page * options.pageSize)
        .map((item) => ({
          path: item.file.path,
          file: item.file,
          note: item.note,
          formula: item.formula,
          values: Object.fromEntries(order.map((property) => [property, field(item, property)])),
        })),
    };
  } catch (error) {
    if (error instanceof UnsupportedBaseExpression) throw new HttpError(422, error.message);
    throw error;
  }
}

export const baseRoutes = new Elysia({ name: 'knowledge-bases', detail: { tags: ['Knowledge'] } })
  .use(vaultGuard)
  .get(
    '/knowledge/properties-template',
    ({ paths }) => {
      if (!isNotePath(paths.path)) throw new HttpError(400, 'A note template path ends in .md');
      const frontmatter = {
        type: 'knowledge',
        schema_version: 1,
        status: 'draft',
        project: locateVaultPath(paths.path).projectKey,
        tags: [] as string[],
        source: '',
        // One of the origins every list shows (packages/vault/src/origin.ts).
        origin: 'manual',
      };
      const title = paths.path.split('/').at(-1)!.replace(/\.md$/i, '');
      return {
        path: paths.path,
        frontmatter,
        content: composeNote(frontmatter, `# ${title}\n`, null),
      };
    },
    {
      vault: { action: 'read', fields: ['path'] },
      query: templateQuery,
      response: {
        200: t.Object({
          path: t.String(),
          frontmatter: t.Record(t.String(), t.Any()),
          content: t.String(),
        }),
        ...commonErrors,
      },
      detail: {
        summary: 'Suggest properties for a new knowledge note',
        description: 'Read-only proposal; existing files are not changed.',
      },
    },
  )
  .get('/knowledge/bases', ({ paths }) => vaultCall(() => readBase(paths.path)), {
    vault: { action: 'read', fields: ['path'] },
    query: baseQuery,
    response: { 200: baseResponse, ...commonErrors, ...errors(413, 422) },
    detail: { summary: 'Read an Obsidian Base and its YAML definition' },
  })
  .put(
    '/knowledge/bases',
    ({ scope, paths, body }) =>
      vaultCall(() => writeBase(scope, paths.path, body.content, body.expectedSha ?? null)),
    {
      vault: { action: 'write', fields: ['path'] },
      body: baseBody,
      response: { 200: baseResponse, ...commonErrors, ...errors(409, 413, 422) },
      detail: {
        summary: 'Create or update an Obsidian Base',
        description: 'Use expectedSha from GET to update; omit it only when creating a new file.',
      },
    },
  )
  .get(
    '/knowledge/bases/rows',
    ({ scope, paths, query }) =>
      vaultCall(() =>
        baseRows(scope, paths.path, {
          view: query.view,
          page: query.page ?? 1,
          pageSize: query.pageSize ?? 50,
        }),
      ),
    {
      vault: { action: 'read', fields: ['path'] },
      query: rowsQuery,
      response: { 200: rowsResponse, ...commonErrors, ...errors(413, 422) },
      detail: {
        summary: 'Query rows of a Base under the caller’s project ACL',
        description: 'Supports table, cards and list views; unsupported expressions return 422.',
      },
    },
  );
