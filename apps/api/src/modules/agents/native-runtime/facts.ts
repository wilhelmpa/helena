import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  agentProposal,
  agentRun,
  aiAgent,
  db,
  helenaFact,
  helenaFactEntity,
  helenaFactEntityLink,
  project,
} from '@repo/db';
import {
  contradictionOf,
  contradictions,
  encodeFact,
  extractEntities,
  fromBytes,
  probe,
  reason,
  refuseFact,
  related,
  rerank,
  sameFact,
  toBytes,
  trustAfter,
  TRUST,
  isTransientTask,
  type FactRow,
} from '@helena/facts';
import {
  factSource,
  reindexItems,
  searchKnowledgeIndex,
  semanticRetriever,
  syncEmbedder,
  type KnowledgeReach,
} from '@helena/knowledge';
import type { AuthUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { knowledgeReach } from '#modules/knowledge/reach';
import { memoryApproval } from '../memory/service';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Transaction;

// Helena's fact store (docs/helena-decisions/zentrale-laufzeit.md §8.2): Hermes' holographic
// memory principle, in Postgres and for every runtime (Helena's MCP tools fact_store and
// fact_feedback). A fact belongs to a project, or to the team (the Home agent's). Who reads
// and writes which is the caller's reach in the knowledge index: the projects they are a
// member of, and the team for those who run it and for the Home agent. Search is the knowledge
// index's hybrid search (full text + vectors of the local embedding model, with the same
// reach) reranked by word overlap, the HRR vector, trust and age.

export type FactAction =
  'add' | 'search' | 'probe' | 'related' | 'reason' | 'contradict' | 'update' | 'remove' | 'list';

export interface FactInput {
  action: FactAction;
  content?: string;
  entities?: string[];
  entity?: string;
  category?: string;
  tags?: string[];
  query?: string;
  id?: number;
  project?: string;
  limit?: number;
  minTrust?: number;
}

export interface FactView {
  id: number;
  content: string;
  category: string;
  tags: string[];
  entities: string[];
  trust: number;
  project: string | null;
  confirmations: number;
  helpful: number;
  unhelpful: number;
  contradictedBy: number | null;
  updatedAt: string;
  score?: number;
}

interface Caller {
  userId: string;
  reach: KnowledgeReach;
  agent: { id: number; teamId: number; agentRole: string } | null;
}

interface LoadedFact extends FactRow {
  teamId: number;
  projectId: number | null;
  projectKey: string | null;
  tags: string[];
  confirmations: number;
  helpfulCount: number;
  unhelpfulCount: number;
  contradictedBy: number | null;
}

const MAX_SCAN = 2000;

export async function factCaller(user: AuthUser, viaMcp: boolean): Promise<Caller> {
  const reach = await knowledgeReach(user, viaMcp);
  const [agent] = await db
    .select({ id: aiAgent.id, teamId: aiAgent.teamId, agentRole: aiAgent.agentRole })
    .from(aiAgent)
    .where(eq(aiAgent.userId, user.id));
  return { userId: user.id, reach, agent: agent ?? null };
}

// The facts the caller may read: of their projects, and of the teams whose items of no
// project they read.
function readable(caller: Caller): SQL {
  const projects = [...caller.reach.projects.keys()];
  const teams = [...caller.reach.teams.keys()];
  const parts: SQL[] = [];
  if (projects.length) parts.push(inArray(helenaFact.projectId, projects));
  if (teams.length)
    parts.push(and(isNull(helenaFact.projectId), inArray(helenaFact.teamId, teams))!);
  return and(isNull(helenaFact.deletedAt), parts.length ? or(...parts) : sql`false`)!;
}

// Where a new fact goes: the project named, the agent's only project, or the team for the
// Home agent and for a person who runs the team.
async function writeScope(
  caller: Caller,
  key?: string,
): Promise<{ teamId: number; projectId: number | null }> {
  if (key) {
    const rows = await db
      .select({ id: project.id, teamId: project.teamId })
      .from(project)
      .where(eq(project.key, key.trim().toUpperCase()));
    const row = rows.find((candidate) => caller.reach.projects.has(candidate.id));
    if (!row) throw new HttpError(403, `You cannot keep facts in project ${key}`);
    return { teamId: row.teamId, projectId: row.id };
  }
  if (caller.agent?.agentRole === 'home') return { teamId: caller.agent.teamId, projectId: null };
  const projects = [...caller.reach.projects.keys()];
  if (caller.agent && projects.length === 1) {
    const [row] = await db
      .select({ teamId: project.teamId })
      .from(project)
      .where(eq(project.id, projects[0]!));
    return { teamId: row!.teamId, projectId: projects[0]! };
  }
  const team = [...caller.reach.teams.entries()].find(([, resources]) => resources.size > 0);
  if (!caller.agent && team) return { teamId: team[0], projectId: null };
  throw new HttpError(400, 'Name the project the fact belongs to (`project`)');
}

async function loadFacts(
  where: SQL,
  limit = MAX_SCAN,
  executor: Executor = db,
): Promise<LoadedFact[]> {
  const rows = await executor
    .select({
      id: helenaFact.id,
      teamId: helenaFact.teamId,
      projectId: helenaFact.projectId,
      projectKey: project.key,
      content: helenaFact.content,
      category: helenaFact.category,
      tags: helenaFact.tags,
      trust: helenaFact.trust,
      confirmations: helenaFact.confirmations,
      helpfulCount: helenaFact.helpfulCount,
      unhelpfulCount: helenaFact.unhelpfulCount,
      contradictedBy: helenaFact.contradictedBy,
      hrr: helenaFact.hrr,
      updatedAt: helenaFact.updatedAt,
      entities: sql<
        string[]
      >`coalesce((select array_agg(${helenaFactEntity.name} order by ${helenaFactEntity.name}) from ${helenaFactEntityLink} join ${helenaFactEntity} on ${helenaFactEntity.id} = ${helenaFactEntityLink.entityId} where ${helenaFactEntityLink.factId} = ${helenaFact.id}), '{}')`,
    })
    .from(helenaFact)
    .leftJoin(project, eq(project.id, helenaFact.projectId))
    .where(where)
    .orderBy(desc(helenaFact.updatedAt))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    hrr: row.hrr ? fromBytes(row.hrr) : null,
  }));
}

function view(fact: LoadedFact, score?: number): FactView {
  return {
    id: fact.id,
    content: fact.content,
    category: fact.category,
    tags: fact.tags,
    entities: fact.entities,
    trust: Math.round(fact.trust * 1000) / 1000,
    project: fact.projectKey,
    confirmations: fact.confirmations,
    helpful: fact.helpfulCount,
    unhelpful: fact.unhelpfulCount,
    contradictedBy: fact.contradictedBy,
    updatedAt: fact.updatedAt.toISOString(),
    ...(score !== undefined && { score: Math.round(score * 1000) / 1000 }),
  };
}

// A fact is in the search right after it was written: the index item is written before the
// answer (its vector follows with the indexer's next embedding pass).
async function reindex(ids: number[]): Promise<void> {
  await reindexItems(
    factSource,
    ids.map((id) => String(id)),
  ).catch((error: unknown) => console.error('[helena-runtime] fact reindex failed', error));
}

async function linkEntities(
  factId: number,
  scope: { teamId: number; projectId: number | null },
  names: string[],
  executor: Executor = db,
): Promise<void> {
  await executor.delete(helenaFactEntityLink).where(eq(helenaFactEntityLink.factId, factId));
  for (const name of names) {
    const lower = name.toLowerCase();
    const [existing] = await executor
      .select({ id: helenaFactEntity.id })
      .from(helenaFactEntity)
      .where(
        and(
          eq(helenaFactEntity.teamId, scope.teamId),
          scope.projectId === null
            ? isNull(helenaFactEntity.projectId)
            : eq(helenaFactEntity.projectId, scope.projectId),
          eq(helenaFactEntity.nameLower, lower),
        ),
      );
    const entityId =
      existing?.id ??
      (
        await executor
          .insert(helenaFactEntity)
          .values({ teamId: scope.teamId, projectId: scope.projectId, name, nameLower: lower })
          .onConflictDoNothing()
          .returning({ id: helenaFactEntity.id })
      )[0]?.id;
    if (entityId) {
      await executor
        .insert(helenaFactEntityLink)
        .values({ factId, entityId })
        .onConflictDoNothing();
    }
  }
}

async function readableFact(caller: Caller, id: number | undefined): Promise<LoadedFact> {
  if (!id) throw new HttpError(400, 'Name the fact (`id`)');
  const [fact] = await loadFacts(and(readable(caller), eq(helenaFact.id, id))!, 1);
  if (!fact) throw new HttpError(404, 'Fact not found');
  return fact;
}

export async function addApprovedFact(
  tx: Transaction,
  agentId: number | null,
  scope: { teamId: number; projectId: number | null },
  input: FactInput,
  source: Record<string, unknown>,
) {
  const content = (input.content ?? '').trim();
  const refused = refuseFact(content);
  if (refused) throw new HttpError(400, refused);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`volition-fact:${scope.teamId}:${scope.projectId ?? 0}`}, 0))`,
  );
  const entities = extractEntities(content, input.entities ?? []);
  const draft: FactRow = {
    id: 0,
    content,
    category: input.category?.trim().slice(0, 40) || 'general',
    entities,
    trust: TRUST.initial,
    updatedAt: new Date(),
    hrr: encodeFact(content, entities),
  };
  const sameScope = and(
    isNull(helenaFact.deletedAt),
    eq(helenaFact.teamId, scope.teamId),
    scope.projectId === null
      ? isNull(helenaFact.projectId)
      : eq(helenaFact.projectId, scope.projectId),
  )!;
  const neighbours = await loadFacts(sameScope, 500, tx);
  // The same fact again, from another session: confirmed, not stored twice.
  const known = neighbours.find((fact) => sameFact(fact, draft));
  if (known) {
    const trust = trustAfter(known.trust, 'confirmed');
    await tx
      .update(helenaFact)
      .set({ trust, confirmations: sql`${helenaFact.confirmations} + 1`, updatedAt: new Date() })
      .where(eq(helenaFact.id, known.id));
    return {
      result: {
        status: 'confirmed' as const,
        fact: view({ ...known, trust, confirmations: known.confirmations + 1 }),
      },
      indexed: [known.id],
    };
  }
  if (agentId !== null) {
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(helenaFact)
      .where(
        and(
          eq(helenaFact.agentId, agentId),
          isNull(helenaFact.deletedAt),
          sql`${helenaFact.createdAt} >= now() - interval '1 day'`,
        ),
      );
    if (count >= 10) throw new HttpError(429, 'Daily learned fact limit reached');
  }
  const [row] = await tx
    .insert(helenaFact)
    .values({
      teamId: scope.teamId,
      projectId: scope.projectId,
      agentId,
      content,
      category: draft.category,
      tags: (input.tags ?? [])
        .map((tag) => tag.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 12),
      trust: TRUST.initial,
      hrr: toBytes(draft.hrr!),
      source,
    })
    .returning({ id: helenaFact.id });
  const id = row!.id;
  await linkEntities(id, scope, entities, tx);
  // What the new fact contradicts loses trust and points at it (contradiction with decay).
  const found = neighbours
    .map((fact) => contradictionOf<FactRow>(fact, { ...draft, id }))
    .filter((hit): hit is NonNullable<typeof hit> => hit !== null);
  for (const hit of found) {
    await tx
      .update(helenaFact)
      .set({ trust: trustAfter(hit.a.trust, 'contradicted'), contradictedBy: id })
      .where(eq(helenaFact.id, hit.a.id));
  }
  const [stored] = await loadFacts(eq(helenaFact.id, id), 1, tx);
  return {
    result: {
      status: 'added' as const,
      fact: view(stored!),
      contradicts: found.map((hit) => ({
        id: hit.a.id,
        content: hit.a.content,
        shared: hit.shared,
        score: Math.round(hit.score * 1000) / 1000,
      })),
    },
    indexed: [id, ...found.map((hit) => hit.a.id)],
  };
}

export const reindexApprovedFacts = reindex;

async function add(caller: Caller, input: FactInput, source: Record<string, unknown>) {
  const content = (input.content ?? '').trim();
  const refused = refuseFact(content);
  if (refused) throw new HttpError(400, refused);
  if (caller.agent && typeof source.runId === 'number') {
    const [run] = await db
      .select({ prompt: agentRun.prompt })
      .from(agentRun)
      .where(and(eq(agentRun.id, source.runId), eq(agentRun.agentId, caller.agent.id)));
    if (!run) throw new HttpError(403, 'Run does not belong to the agent');
    if (isTransientTask(run.prompt))
      throw new HttpError(400, 'Temporary one-time lookups do not become facts');
  }
  const scope = await writeScope(caller, input.project);
  if (caller.agent && (await memoryApproval(caller.agent.id))) {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([scope, content]))
      .digest('hex');
    return db.transaction(async (tx) => {
      await tx
        .select({ id: aiAgent.id })
        .from(aiAgent)
        .where(eq(aiAgent.id, caller.agent!.id))
        .for('update');
      const [existing] = await tx
        .select({ id: agentProposal.id, status: agentProposal.status })
        .from(agentProposal)
        .where(
          and(
            eq(agentProposal.agentId, caller.agent!.id),
            eq(agentProposal.kind, 'memory-write'),
            eq(agentProposal.externalId, `fact:${fingerprint}`),
          ),
        );
      if (existing) return { status: existing.status, id: existing.id };
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(agentProposal)
        .where(
          and(
            eq(agentProposal.agentId, caller.agent!.id),
            eq(agentProposal.kind, 'memory-write'),
            sql`${agentProposal.payload}->>'type' = 'fact'`,
            sql`${agentProposal.createdAt} >= now() - interval '1 day'`,
          ),
        );
      if (count >= 10) throw new HttpError(429, 'Daily fact proposal limit reached');
      const [proposal] = await tx
        .insert(agentProposal)
        .values({
          agentId: caller.agent!.id,
          kind: 'memory-write',
          externalId: `fact:${fingerprint}`,
          title: `Fact: ${content.slice(0, 80)}`,
          payload: { type: 'fact', scope, input: { ...input, content }, source },
        })
        .returning({ id: agentProposal.id });
      return { status: 'pending' as const, id: proposal!.id };
    });
  }
  const stored = await db.transaction((tx) =>
    addApprovedFact(tx, caller.agent?.id ?? null, scope, input, source),
  );
  await reindex(stored.indexed);
  return stored.result;
}

async function search(caller: Caller, input: FactInput) {
  const query = (input.query ?? input.content ?? '').trim();
  if (!query) throw new HttpError(400, 'Name what to search for (`query`)');
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 30);
  const hits = await searchKnowledgeIndex(
    caller.reach,
    { q: query, sources: ['fact'], limit: limit * 3, collapse: false },
    (await syncEmbedder()) ? ((await semanticRetriever()) ?? undefined) : undefined,
  );
  const ids = hits.items.map((hit) => Number(hit.id)).filter((id) => id > 0);
  if (ids.length === 0) return { facts: [] as FactView[], semantic: hits.semantic };
  const facts = await loadFacts(and(readable(caller), inArray(helenaFact.id, ids))!, ids.length);
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const ranked = rerank(
    query,
    hits.items
      .map((hit, index) => ({ fact: byId.get(Number(hit.id)), rank: hits.items.length - index }))
      .filter((entry): entry is { fact: LoadedFact; rank: number } => !!entry.fact),
    { minTrust: input.minTrust ?? TRUST.minimum, limit },
  );
  if (ranked.length) {
    await db
      .update(helenaFact)
      .set({ retrievalCount: sql`${helenaFact.retrievalCount} + 1` })
      .where(
        inArray(
          helenaFact.id,
          ranked.map((hit) => hit.fact.id),
        ),
      );
  }
  return { facts: ranked.map((hit) => view(hit.fact, hit.score)), semantic: hits.semantic };
}

export async function factStore(
  caller: Caller,
  input: FactInput,
  source: Record<string, unknown> = {},
) {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
  if (
    caller.agent &&
    ['update', 'remove'].includes(input.action) &&
    (await memoryApproval(caller.agent.id))
  )
    throw new HttpError(403, 'Fact changes require owner review; use the memory editor');
  switch (input.action) {
    case 'add':
      return add(caller, input, source);
    case 'search':
      return search(caller, input);
    case 'probe': {
      if (!input.entity?.trim()) throw new HttpError(400, 'Name the entity (`entity`)');
      const facts = await loadFacts(readable(caller));
      return { facts: probe(input.entity, facts, limit).map((hit) => view(hit.fact, hit.score)) };
    }
    case 'related': {
      if (!input.entity?.trim()) throw new HttpError(400, 'Name the entity (`entity`)');
      const facts = await loadFacts(readable(caller));
      return { facts: related(input.entity, facts, limit).map((hit) => view(hit.fact, hit.score)) };
    }
    case 'reason': {
      const names = (input.entities ?? []).map((name) => name.trim()).filter(Boolean);
      if (names.length < 2) throw new HttpError(400, 'Name at least two entities (`entities`)');
      const facts = await loadFacts(readable(caller));
      return { facts: reason(names, facts, limit).map((hit) => view(hit.fact, hit.score)) };
    }
    case 'contradict': {
      const facts = await loadFacts(readable(caller), 500);
      return {
        contradictions: contradictions(facts, 0.3, limit).map((hit) => ({
          a: view(hit.a),
          b: view(hit.b),
          shared: hit.shared,
          score: Math.round(hit.score * 1000) / 1000,
        })),
      };
    }
    case 'update': {
      const fact = await readableFact(caller, input.id);
      const content = input.content?.trim();
      if (content !== undefined) {
        const refused = refuseFact(content);
        if (refused) throw new HttpError(400, refused);
      }
      const next = content ?? fact.content;
      const entities = extractEntities(next, input.entities ?? fact.entities);
      await db
        .update(helenaFact)
        .set({
          content: next,
          ...(input.category && { category: input.category.trim().slice(0, 40) }),
          ...(input.tags && {
            tags: input.tags.map((tag) => tag.trim().slice(0, 40)).filter(Boolean),
          }),
          hrr: toBytes(encodeFact(next, entities)),
          contradictedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(helenaFact.id, fact.id));
      await linkEntities(fact.id, { teamId: fact.teamId, projectId: fact.projectId }, entities);
      await reindex([fact.id]);
      const [stored] = await loadFacts(eq(helenaFact.id, fact.id), 1);
      return { status: 'updated' as const, fact: view(stored!) };
    }
    case 'remove': {
      const fact = await readableFact(caller, input.id);
      await db.update(helenaFact).set({ deletedAt: new Date() }).where(eq(helenaFact.id, fact.id));
      await reindex([fact.id]);
      return { status: 'removed' as const, id: fact.id };
    }
    case 'list': {
      const facts = await loadFacts(
        and(
          readable(caller),
          input.category ? eq(helenaFact.category, input.category) : undefined,
        )!,
      );
      return {
        facts: facts
          .filter((fact) => fact.trust >= (input.minTrust ?? 0))
          .sort((a, b) => b.trust - a.trust)
          .slice(0, limit)
          .map((fact) => view(fact)),
      };
    }
    default:
      throw new HttpError(400, 'Unknown action');
  }
}

export async function factFeedback(caller: Caller, id: number, helpful: boolean) {
  const fact = await readableFact(caller, id);
  const trust = trustAfter(fact.trust, helpful ? 'helpful' : 'unhelpful');
  await db
    .update(helenaFact)
    .set({
      trust,
      ...(helpful
        ? { helpfulCount: sql`${helenaFact.helpfulCount} + 1` }
        : { unhelpfulCount: sql`${helenaFact.unhelpfulCount} + 1` }),
    })
    .where(eq(helenaFact.id, fact.id));
  await reindex([fact.id]);
  return { id: fact.id, oldTrust: fact.trust, trust };
}

// The facts of an agent (or of the team, agentId null) for the memory editor; a person with
// the team's ai_agents permission reads and corrects them.
export async function listFactsForOwner(teamId: number, agentId: number | null, limit = 200) {
  const facts = await loadFacts(
    and(
      isNull(helenaFact.deletedAt),
      eq(helenaFact.teamId, teamId),
      agentId !== null ? eq(helenaFact.agentId, agentId) : undefined,
    )!,
    Math.min(Math.max(limit, 1), 500),
  );
  return facts.map((fact) => view(fact));
}

export async function correctFact(
  teamId: number,
  id: number,
  change: { content?: string; trust?: number; category?: string; remove?: boolean },
) {
  const [fact] = await loadFacts(and(eq(helenaFact.teamId, teamId), eq(helenaFact.id, id))!, 1);
  if (!fact) throw new HttpError(404, 'Fact not found');
  if (change.remove) {
    await db.update(helenaFact).set({ deletedAt: new Date() }).where(eq(helenaFact.id, id));
    await reindex([id]);
    return { status: 'removed' as const, id };
  }
  const content = change.content?.trim();
  if (content !== undefined) {
    const refused = refuseFact(content);
    if (refused) throw new HttpError(400, refused);
  }
  const next = content ?? fact.content;
  const entities = extractEntities(next, fact.entities);
  await db
    .update(helenaFact)
    .set({
      content: next,
      ...(change.trust !== undefined && { trust: Math.max(0, Math.min(1, change.trust)) }),
      ...(change.category && { category: change.category.trim().slice(0, 40) }),
      hrr: toBytes(encodeFact(next, entities)),
      updatedAt: new Date(),
    })
    .where(eq(helenaFact.id, id));
  await linkEntities(id, { teamId: fact.teamId, projectId: fact.projectId }, entities);
  await reindex([id]);
  const [stored] = await loadFacts(eq(helenaFact.id, id), 1);
  return { status: 'updated' as const, fact: view(stored!) };
}
