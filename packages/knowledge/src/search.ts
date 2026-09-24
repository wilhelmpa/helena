import { and, desc, eq, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { db, knowledgeItem, knowledgeLink, project } from '@repo/db';
import { belowPattern } from '@repo/vault';
import { readableItems, type KnowledgeReach } from './reach';

// One search over every source: Postgres full text (German stemming and plain words,
// prefixes while typing) as the base, the passages' embeddings on top when semantic
// search is on, the two lists fused by reciprocal rank (RRF, the method pgvector's and
// most hybrid-search guides use). Every query is filtered by the reader's reach first,
// so a result is never something the reader could not open.

export interface SearchInput {
  q: string;
  // Only these sources (`issue`, `vault`, `mail`, …); all when empty.
  sources?: string[];
  // Only one project; `null` only items of no project (Home); all when undefined.
  projectId?: number | null;
  // Only vault items at or below this vault folder.
  folder?: string;
  limit: number;
  // Show one result per group (a thread, a task with its comments). On by default.
  collapse?: boolean;
}

export interface SearchHit {
  ref: string;
  source: string;
  id: string;
  title: string;
  snippet: string;
  href: string;
  projectId: number | null;
  projectKey: string | null;
  mimeType: string | null;
  metadata: Record<string, unknown>;
  author: string | null;
  origin: string | null;
  runId: number | null;
  updatedAt: string;
  score: number;
  // How the item matched: its words, its meaning, or both.
  matched: ('text' | 'meaning')[];
}

export interface SearchResult {
  items: SearchHit[];
  // Matches per source for the same query without the source filter, for the filter
  // chips.
  counts: Record<string, number>;
  semantic: boolean;
}

// A semantic retriever: row ids of knowledge_item with a similarity, best first, already
// limited to what `readable` allows. Provided by vectors.ts once embeddings are on.
export type SemanticRetriever = (input: {
  q: string;
  readable: SQL;
  filters: SQL | undefined;
  limit: number;
}) => Promise<{ rowId: number; similarity: number; passage: string }[]>;

const RRF_K = 60;
const CANDIDATES = 100;

// The words of a query as a prefix query for the simple configuration, so a search
// finds a word while it is being typed. Letters and digits only: nothing to escape.
export function prefixQuery(q: string): string | null {
  const words =
    q
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 8) ?? [];
  return words.length > 0 ? words.map((word) => `${word}:*`).join(' & ') : null;
}

export function tsQuery(q: string): SQL {
  const prefix = prefixQuery(q);
  return prefix
    ? sql`(websearch_to_tsquery('german', ${q}) || to_tsquery('simple', ${prefix}))`
    : sql`websearch_to_tsquery('german', ${q})`;
}

function filtersOf(input: SearchInput, withSources = true): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  if (withSources && input.sources && input.sources.length > 0) {
    parts.push(inArray(knowledgeItem.source, input.sources));
  }
  if (input.projectId === null) parts.push(isNull(knowledgeItem.projectId));
  else if (input.projectId !== undefined) parts.push(eq(knowledgeItem.projectId, input.projectId));
  if (input.folder) {
    parts.push(
      and(
        eq(knowledgeItem.source, 'vault'),
        or(
          eq(knowledgeItem.itemId, input.folder),
          like(knowledgeItem.itemId, belowPattern(input.folder)),
        ),
      ),
    );
  }
  return and(...parts);
}

// A task's identifier typed as the query puts that task first.
function identifierBoost(q: string): SQL {
  const upper = q.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]*-\d+$/.test(upper)
    ? sql`(case when ${knowledgeItem.metadata} ->> 'identifier' = ${upper} and ${knowledgeItem.source} = 'issue' then 10 else 0 end)`
    : sql`0`;
}

interface Candidate {
  rowId: number;
  group: string;
  // The item its group is named after.
  leader: boolean;
  score: number;
  matched: Set<'text' | 'meaning'>;
  passage?: string;
}

export async function searchKnowledgeIndex(
  reach: KnowledgeReach,
  input: SearchInput,
  semantic?: SemanticRetriever,
): Promise<SearchResult> {
  const q = input.q.trim();
  const readable = readableItems(reach);
  const filters = filtersOf(input);
  if (!q) return { items: [], counts: {}, semantic: !!semantic };
  const query = tsQuery(q);
  const rank = sql<number>`ts_rank_cd(${knowledgeItem.search}, ${query}, 32) + ${identifierBoost(q)}`;
  const groupKey = sql<string>`coalesce(${knowledgeItem.groupKey}, ${knowledgeItem.source} || ':' || ${knowledgeItem.itemId})`;
  const leader = sql<boolean>`(${groupKey} = ${knowledgeItem.source} || ':' || ${knowledgeItem.itemId})`;

  const textHits = await db
    .select({ rowId: knowledgeItem.id, group: groupKey, leader, rank })
    .from(knowledgeItem)
    .where(and(readable, filters, sql`${knowledgeItem.search} @@ ${query}`))
    .orderBy(desc(rank), desc(leader), desc(knowledgeItem.updatedAt))
    .limit(CANDIDATES);

  const candidates = new Map<number, Candidate>();
  textHits.forEach((hit, index) => {
    candidates.set(hit.rowId, {
      rowId: hit.rowId,
      group: hit.group,
      leader: hit.leader,
      score: 1 / (RRF_K + index + 1),
      matched: new Set(['text']),
    });
  });
  if (semantic) {
    const meaningHits = await semantic({ q, readable, filters, limit: CANDIDATES });
    const missing = meaningHits.map((hit) => hit.rowId).filter((id) => !candidates.has(id));
    const groups = new Map<number, { group: string; leader: boolean }>();
    if (missing.length > 0) {
      const rows = await db
        .select({ rowId: knowledgeItem.id, group: groupKey, leader })
        .from(knowledgeItem)
        .where(inArray(knowledgeItem.id, missing));
      for (const row of rows) groups.set(row.rowId, { group: row.group, leader: row.leader });
    }
    meaningHits.forEach((hit, index) => {
      const existing = candidates.get(hit.rowId);
      const score = 1 / (RRF_K + index + 1);
      if (existing) {
        existing.score += score;
        existing.matched.add('meaning');
        existing.passage ??= hit.passage;
      } else if (groups.has(hit.rowId)) {
        candidates.set(hit.rowId, {
          rowId: hit.rowId,
          ...groups.get(hit.rowId)!,
          score,
          matched: new Set(['meaning']),
          passage: hit.passage,
        });
      }
    });
  }

  const ordered = [...candidates.values()].sort((a, b) => b.score - a.score);
  let picked: Candidate[];
  if (input.collapse === false) {
    picked = ordered.slice(0, input.limit);
  } else {
    // One result per group, at the place of its best match. The item the group is named
    // after (the task, not its comment) stands for the group when it matched at all.
    const groups = new Map<string, { best: Candidate; leader?: Candidate }>();
    for (const candidate of ordered) {
      const group = groups.get(candidate.group) ?? { best: candidate };
      if (candidate.leader && !group.leader) group.leader = candidate;
      groups.set(candidate.group, group);
    }
    picked = [...groups.values()]
      .slice(0, input.limit)
      .map(({ best, leader }) => (leader ? { ...leader, score: best.score } : best));
  }

  const [items, counts] = await Promise.all([
    hydrate(picked, query),
    countsBySource(readable, filtersOf(input, false), query),
  ]);
  return { items, counts, semantic: !!semantic };
}

async function hydrate(picked: Candidate[], query: SQL): Promise<SearchHit[]> {
  if (picked.length === 0) return [];
  const rows = await db
    .select({
      id: knowledgeItem.id,
      source: knowledgeItem.source,
      itemId: knowledgeItem.itemId,
      title: knowledgeItem.title,
      href: knowledgeItem.href,
      projectId: knowledgeItem.projectId,
      projectKey: project.key,
      mimeType: knowledgeItem.mimeType,
      metadata: knowledgeItem.metadata,
      author: knowledgeItem.author,
      origin: knowledgeItem.origin,
      runId: knowledgeItem.runId,
      updatedAt: knowledgeItem.updatedAt,
      snippet: sql<string>`ts_headline('german', left(${knowledgeItem.text}, 20000), ${query}, 'MaxFragments=2, MaxWords=24, MinWords=8, FragmentDelimiter=" … ", StartSel=**, StopSel=**')`,
    })
    .from(knowledgeItem)
    .leftJoin(project, eq(project.id, knowledgeItem.projectId))
    .where(
      inArray(
        knowledgeItem.id,
        picked.map((candidate) => candidate.rowId),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return picked
    .map((candidate): SearchHit | null => {
      const row = byId.get(candidate.rowId);
      if (!row) return null;
      const textSnippet = row.snippet.trim();
      const snippet =
        candidate.matched.has('text') || !candidate.passage
          ? textSnippet
          : candidate.passage.slice(0, 240);
      return {
        ref: `${row.source}:${row.itemId}`,
        source: row.source,
        id: row.itemId,
        title: row.title,
        snippet,
        href: row.href,
        projectId: row.projectId,
        projectKey: row.projectKey,
        mimeType: row.mimeType,
        metadata: row.metadata,
        author: row.author,
        origin: row.origin,
        runId: row.runId,
        updatedAt: row.updatedAt.toISOString(),
        score: candidate.score,
        matched: [...candidate.matched],
      };
    })
    .filter((hit): hit is SearchHit => hit !== null);
}

async function countsBySource(
  readable: SQL,
  filters: SQL | undefined,
  query: SQL,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ source: knowledgeItem.source, count: sql<number>`count(*)::int` })
    .from(knowledgeItem)
    .where(and(readable, filters, sql`${knowledgeItem.search} @@ ${query}`))
    .groupBy(knowledgeItem.source);
  return Object.fromEntries(rows.map((row) => [row.source, Number(row.count)]));
}

export interface ReadItem extends Omit<SearchHit, 'snippet' | 'score' | 'matched'> {
  text: string;
  createdAt: string;
  teamId: number;
  visibility: string;
  ownerId: string | null;
  permission: string | null;
}

// One item by its ref, with its whole indexed text, or null when it is not indexed.
// The caller checks the reach (reach.ts canRead).
export async function readIndexedItem(source: string, id: string): Promise<ReadItem | null> {
  const [row] = await db
    .select({
      item: knowledgeItem,
      projectKey: project.key,
    })
    .from(knowledgeItem)
    .leftJoin(project, eq(project.id, knowledgeItem.projectId))
    .where(and(eq(knowledgeItem.source, source), eq(knowledgeItem.itemId, id)));
  if (!row) return null;
  const item = row.item;
  return {
    ref: `${item.source}:${item.itemId}`,
    source: item.source,
    id: item.itemId,
    title: item.title,
    text: item.text,
    href: item.href,
    projectId: item.projectId,
    projectKey: row.projectKey,
    mimeType: item.mimeType,
    metadata: item.metadata,
    author: item.author,
    origin: item.origin,
    runId: item.runId,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    teamId: item.teamId,
    visibility: item.visibility,
    ownerId: item.ownerId,
    permission: item.permission,
  };
}

export interface LinkedItem {
  ref: string;
  source: string;
  id: string;
  title: string;
  href: string;
  projectKey: string | null;
  kind: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

// The items that link to any of `targets` (`task:VOL-12`, `issue:481`, `vault:<path>`),
// newest first: the backlinks of a task, a note or a mail across every source.
export async function linkingItems(
  reach: KnowledgeReach,
  targets: string[],
  limit = 50,
): Promise<LinkedItem[]> {
  if (targets.length === 0) return [];
  const rows = await db
    .selectDistinctOn([knowledgeItem.id], {
      id: knowledgeItem.id,
      source: knowledgeItem.source,
      itemId: knowledgeItem.itemId,
      title: knowledgeItem.title,
      href: knowledgeItem.href,
      projectKey: project.key,
      kind: knowledgeLink.kind,
      updatedAt: knowledgeItem.updatedAt,
      metadata: knowledgeItem.metadata,
    })
    .from(knowledgeLink)
    .innerJoin(knowledgeItem, eq(knowledgeItem.id, knowledgeLink.itemId))
    .leftJoin(project, eq(project.id, knowledgeItem.projectId))
    .where(and(inArray(knowledgeLink.target, targets), readableItems(reach)))
    .orderBy(knowledgeItem.id)
    .limit(limit * 2);
  return rows
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit)
    .map((row) => ({
      ref: `${row.source}:${row.itemId}`,
      source: row.source,
      id: row.itemId,
      title: row.title,
      href: row.href,
      projectKey: row.projectKey,
      kind: row.kind,
      updatedAt: row.updatedAt.toISOString(),
      metadata: row.metadata,
    }));
}

// The newest items a reader may see, for an empty search box.
export async function recentItems(
  reach: KnowledgeReach,
  input: Omit<SearchInput, 'q'>,
): Promise<SearchHit[]> {
  const rows = await db
    .select({ rowId: knowledgeItem.id })
    .from(knowledgeItem)
    .where(and(readableItems(reach), filtersOf({ ...input, q: '' })))
    .orderBy(desc(knowledgeItem.updatedAt))
    .limit(input.limit);
  return hydrate(
    rows.map((row) => ({
      rowId: row.rowId,
      group: '',
      leader: true,
      score: 0,
      matched: new Set(),
    })),
    sql`''::tsquery`,
  );
}
