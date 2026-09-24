import { Elysia, t, type Static } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, issue, project } from '@repo/db';
import { normalizeVaultPath, VaultError } from '@repo/vault';
import {
  canRead,
  countBySource,
  knowledgeRegistries,
  knowledgeSource,
  linkingItems,
  parseRef,
  resetSource,
  searchKnowledgeIndex,
  saveSemanticSetting,
  semanticRetriever,
  semanticSetting,
  semanticStatus,
  sourceStates,
  syncEmbedder,
  taskTarget,
  type KnowledgeReach,
} from '@helena/knowledge';
import { requireGod, requireUser } from '#shared/access';
import { authContext } from '#shared/auth-context';
import { HttpError } from '#shared/lib';
import { isMcpRequest } from '#shared/mcp-request';
import { commonErrors } from '#shared/responses';
import { mcpTool } from '#mcp/generate';
import {
  FindResponse,
  findQuery,
  ItemResponse,
  itemQuery,
  LinksResponse,
  linksQuery,
  semanticBody,
  SourcesResponse,
  sourceParams,
} from './everything-model';
import { knowledgeReach } from './reach';

// The second brain's one search: every registered knowledge source (tasks, comments,
// notes and files, mail, chats, agent runs, a plugin's own) through one index, filtered
// by what the reader may open. Agents reach it as search_knowledge and read_knowledge and
// cite what they found with the `cite` link.

const APP_URL = () => (process.env.APP_URL?.split(',')[0]?.trim() ?? '').replace(/\/+$/, '');

export function absoluteHref(href: string): string {
  return /^https?:\/\//i.test(href) ? href : `${APP_URL()}${href}`;
}

function citeOf(title: string, href: string): string {
  const label = (title.trim() || href).replace(/[[\]]/g, '').slice(0, 120);
  return `[${label}](${absoluteHref(href).replace(/\)/g, '%29').replace(/ /g, '%20')})`;
}

function vaultPathOf(source: string, id: string): string | null {
  return source === 'vault' ? id : null;
}

async function projectIdByKey(key: string | undefined): Promise<number | undefined> {
  if (!key) return undefined;
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.key, key.trim().toUpperCase()));
  if (!row) throw new HttpError(404, `Project ${key} not found`);
  return row.id;
}

function folderOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return normalizeVaultPath(value) || undefined;
  } catch (error) {
    if (error instanceof VaultError) throw new HttpError(400, error.message);
    throw error;
  }
}

// The targets that name the same thing a link may point at: a task by its identifier and
// by its item ref.
async function targetsFor(target: string): Promise<string[]> {
  const ref = parseRef(target.trim());
  if (!ref) throw new HttpError(400, 'Name a target such as "task:VOL-12" or "issue:481"');
  if (ref.source === 'task') return [taskTarget(ref.id)];
  if (ref.source === 'issue') {
    const [row] = await db
      .select({ key: project.key, sequenceNumber: issue.sequenceNumber })
      .from(issue)
      .innerJoin(project, eq(project.id, issue.projectId))
      .where(eq(issue.id, Number(ref.id) || 0));
    return row
      ? [`issue:${ref.id}`, taskTarget(`${row.key}-${row.sequenceNumber}`)]
      : [`issue:${ref.id}`];
  }
  return [`${ref.source}:${ref.id}`];
}

async function reachOf(user: unknown, request: Request): Promise<KnowledgeReach> {
  return knowledgeReach(
    requireUser(user as Parameters<typeof requireUser>[0]),
    isMcpRequest(request.headers),
  );
}

export const everythingRoutes = new Elysia({
  name: 'knowledge-everything',
  detail: { tags: ['Knowledge'] },
})
  .use(authContext)
  .get(
    '/knowledge/find',
    async ({ user, request, query }) => {
      const reach = await reachOf(user, request);
      const sources = query.sources
        ?.split(',')
        .map((source) => source.trim())
        .filter(Boolean);
      const result = await searchKnowledgeIndex(
        reach,
        {
          q: query.q,
          sources: sources && sources.length > 0 ? sources : undefined,
          projectId: await projectIdByKey(query.project),
          folder: folderOf(query.folder),
          limit: query.limit ?? 20,
        },
        (await syncEmbedder()) ? ((await semanticRetriever()) ?? undefined) : undefined,
      );
      return {
        ...result,
        items: result.items.map((hit) => ({
          ref: hit.ref,
          source: hit.source,
          id: hit.id,
          title: hit.title,
          snippet: hit.snippet,
          href: hit.href,
          url: absoluteHref(hit.href),
          cite: citeOf(hit.title, hit.href),
          path: vaultPathOf(hit.source, hit.id),
          projectKey: hit.projectKey,
          mimeType: hit.mimeType,
          metadata: hit.metadata,
          author: hit.author,
          origin: hit.origin,
          runId: hit.runId,
          updatedAt: hit.updatedAt,
          matched: hit.matched,
        })),
      };
    },
    {
      query: findQuery,
      response: { 200: FindResponse, ...commonErrors },
      detail: {
        summary: 'Search everything you can open',
        description:
          'One ranked search over tasks, their comments, the notes and files of the knowledge vault (with the text of PDFs, scans and office files), mail, chats and agent runs, limited to what you may open. Each hit has a `ref` (read the whole item with read_knowledge), a short excerpt (matches in **bold**) and a `cite` Markdown link: when an answer uses what you found, put that link after the statement it supports. Narrow with `sources` (e.g. "vault,mail"), `project` (a key) or `folder` (a vault folder).',
        ...mcpTool('search_knowledge'),
      },
    },
  )
  .get(
    '/knowledge/items',
    async ({ user, request, query }) => {
      const reach = await reachOf(user, request);
      const ref = parseRef(query.ref.trim());
      const source = ref ? knowledgeSource(ref.source) : undefined;
      if (!ref || !source) throw new HttpError(404, 'Item not found');
      const item = await source.get(ref.id);
      if (
        !item ||
        !canRead(reach, {
          visibility: item.scope.visibility,
          ownerId: item.scope.ownerId ?? null,
          projectId: item.scope.projectId,
          teamId: item.scope.teamId,
          permission: item.scope.permission ?? null,
        })
      ) {
        throw new HttpError(404, 'Item not found');
      }
      const maxChars = query.maxChars ?? 50_000;
      const [key] = item.scope.projectId
        ? await db
            .select({ key: project.key })
            .from(project)
            .where(eq(project.id, item.scope.projectId))
        : [];
      return {
        ref: `${ref.source}:${item.id}`,
        source: ref.source,
        id: item.id,
        title: item.title,
        text: item.text.slice(0, maxChars),
        truncated: item.text.length > maxChars,
        href: item.href,
        url: absoluteHref(item.href),
        cite: citeOf(item.title, item.href),
        path: vaultPathOf(ref.source, item.id),
        projectKey: key?.key ?? null,
        mimeType: item.mimeType ?? null,
        metadata: item.metadata ?? {},
        author: item.provenance.author ?? null,
        origin: item.provenance.origin ?? null,
        runId: item.provenance.runId ?? null,
        createdAt: item.provenance.createdAt,
        updatedAt: item.provenance.updatedAt,
        links: (item.links ?? []).map((link) => ({ target: link.target, kind: link.kind })),
      };
    },
    {
      query: itemQuery,
      response: { 200: ItemResponse, ...commonErrors },
      detail: {
        summary: 'Read one item of the knowledge index',
        description:
          'The whole text of a task, comment, note, file, mail, chat turn or agent run by the `ref` search_knowledge returned, with where it came from (author, origin, run) and a `cite` link. To change a note, read it with read_document for its sha256.',
        ...mcpTool('read_knowledge'),
      },
    },
  )
  .get(
    '/knowledge/links',
    async ({ user, request, query }) =>
      linkingItems(await reachOf(user, request), await targetsFor(query.target), query.limit ?? 50),
    {
      query: linksQuery,
      response: { 200: LinksResponse, ...commonErrors },
      detail: {
        summary: 'List what mentions a task, a note or another item',
        description:
          'Every item you can open that links to or mentions the target: the notes, comments, mails, chats and runs that name a task, newest first.',
      },
    },
  )
  .get(
    '/knowledge/sources',
    async ({ user }) => {
      requireGod(user);
      const [states, counts, semantic] = await Promise.all([
        sourceStates(),
        countBySource(),
        semanticStatus(),
      ]);
      const byId = new Map(states.map((state) => [state.source, state]));
      const { sources } = knowledgeRegistries();
      return {
        sources: sources.entriesList().map((entry) => {
          const state = byId.get(entry.id);
          return {
            id: entry.id,
            label: entry.value.label,
            icon: entry.value.icon ?? null,
            pluginId: entry.pluginId,
            items: counts.get(entry.id) ?? 0,
            lastRunAt: state?.lastRunAt?.toISOString() ?? null,
            lastSweepAt: state?.lastSweepAt?.toISOString() ?? null,
            lastError: state?.lastError ?? null,
          };
        }),
        semantic,
      };
    },
    {
      response: { 200: SourcesResponse, ...commonErrors },
      detail: {
        summary: 'List the knowledge sources and how far the index is',
        description: 'For the Administrator: every registered source, its item count and state.',
      },
    },
  )
  .post(
    '/knowledge/sources/:source/reindex',
    async ({ user, params, set }) => {
      requireGod(user);
      if (!knowledgeSource(params.source)) throw new HttpError(404, 'Source not found');
      await resetSource(params.source);
      set.status = 204;
    },
    {
      params: sourceParams,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Index a source again from the start',
        description: 'The worker lists every item of the source again on its next run.',
      },
    },
  )
  .put(
    '/knowledge/semantic',
    async ({ user, body }) => {
      requireGod(user);
      const current = await semanticSetting();
      await saveSemanticSetting({ enabled: body.enabled, model: body.model ?? current.model });
      await syncEmbedder();
      return (await semanticStatus()) as Static<typeof SourcesResponse>['semantic'];
    },
    {
      body: semanticBody,
      response: { 200: SourcesResponse.properties.semantic, ...commonErrors },
      detail: {
        summary: 'Switch semantic search on or off',
        description:
          'For the Administrator. Needs the embedding runtime and model the owner approved; the status says what is missing.',
      },
    },
  );
