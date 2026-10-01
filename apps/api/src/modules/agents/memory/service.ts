import { agentMemorySource, reindexItems } from '@helena/knowledge';
import { createHash } from 'node:crypto';
import {
  db,
  agentMemoryRevision,
  agentProposal,
  agentRuntimeAction,
  aiAgent,
  user,
} from '@repo/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import type { AgentRuntimeInventory } from '../core/service';
import { agentContextLimits } from '../core/context-limits';

// The history of an agent's memory files and the owner's say over what the agent writes.
// Every version Helena sees is kept (agent_memory_revision). While the agent's memory writes
// wait for approval (the default), its runner puts a changed file back to the latest version
// here and reports the change as a proposal; approving it has the runner write it.

export type MemoryFile = 'MEMORY.md' | 'USER.md';
const FILES: MemoryFile[] = ['MEMORY.md', 'USER.md'];

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// The latest version of each memory file: what the runner keeps the files at while writes
// wait for approval.
export async function memoryBaseline(
  agentId: number,
  executor: Executor = db,
): Promise<{ file: MemoryFile; sha256: string; content: string }[]> {
  const rows = await executor
    .selectDistinctOn([agentMemoryRevision.file], {
      file: agentMemoryRevision.file,
      sha256: agentMemoryRevision.sha256,
      content: agentMemoryRevision.content,
    })
    .from(agentMemoryRevision)
    .where(and(eq(agentMemoryRevision.agentId, agentId), inArray(agentMemoryRevision.file, FILES)))
    .orderBy(agentMemoryRevision.file, desc(agentMemoryRevision.id));
  return rows.map((row) => ({ ...row, file: row.file as MemoryFile }));
}

// Legacy runners report their files as observations. Native memory is authoritative in the
// database, and an empty legacy profile after a runtime switch is not an instruction to clear it.
export async function recordObservedMemory(
  agentId: number,
  inventory: AgentRuntimeInventory | null | undefined,
): Promise<void> {
  if (!inventory) return;
  await db.transaction(async (tx) => {
    const [agent] = await tx
      .select({ policy: aiAgent.runtimePolicy })
      .from(aiAgent)
      .where(eq(aiAgent.id, agentId))
      .for('update');
    if (!agent || (agent.policy as { runtime?: string })?.runtime === 'helena') return;
    const baseline = new Map(
      (await memoryBaseline(agentId, tx)).map((entry) => [entry.file, entry]),
    );
    for (const entry of inventory.memory) {
      if (entry.truncated || !FILES.includes(entry.file)) continue;
      const before = baseline.get(entry.file);
      if (!entry.content.trim() && before?.content.trim()) continue;
      const digest = entry.sha256 ?? sha256(entry.content);
      if (before?.sha256 === digest) continue;
      await tx.insert(agentMemoryRevision).values({
        agentId,
        file: entry.file,
        content: entry.content,
        sha256: digest,
        source: 'observed',
      });
      baseline.set(entry.file, { file: entry.file, content: entry.content, sha256: digest });
    }
  });
}

export interface MemoryProposalReport {
  file: MemoryFile;
  content: string;
  sha256: string;
  baseSha256: string;
  sourceContext?: { sessionId: string; runId: number | null } | null;
}

// Memory writes the runner held back become proposals. A newer write to the same file
// replaces a proposal still waiting for it; the same write reported again changes nothing.
export async function recordMemoryProposals(
  agentId: number,
  reports: MemoryProposalReport[] | undefined,
  executor: Executor = db,
): Promise<void> {
  if (!reports?.length) return;
  const baseline = new Map(
    (await memoryBaseline(agentId, executor)).map((entry) => [entry.file, entry]),
  );
  for (const report of reports) {
    if (!FILES.includes(report.file) || sha256(report.content) !== report.sha256) continue;
    const before = baseline.get(report.file);
    await executor.transaction(async (tx) => {
      await tx
        .update(agentProposal)
        .set({ status: 'rejected', note: 'Replaced by a newer change', decidedAt: new Date() })
        .where(
          and(
            eq(agentProposal.agentId, agentId),
            eq(agentProposal.kind, 'memory-write'),
            eq(agentProposal.status, 'pending'),
            sql`${agentProposal.payload}->>'file' = ${report.file}`,
            sql`${agentProposal.externalId} <> ${`${report.file}:${report.sha256}`}`,
          ),
        );
      const payload = {
        file: report.file,
        before: before?.content ?? '',
        after: report.content,
        baseSha256: report.baseSha256,
        sha256: report.sha256,
        sourceContext: report.sourceContext ?? null,
      };
      await tx
        .insert(agentProposal)
        .values({
          agentId,
          kind: 'memory-write',
          externalId: `${report.file}:${report.sha256}`,
          title: report.file,
          payload,
        })
        .onConflictDoNothing();
      // The same content was approved (or failed) before and has since been replaced: it is
      // a change again and waits for the owner again. Rejected content stays rejected.
      await tx
        .update(agentProposal)
        .set({
          status: 'pending',
          payload,
          decidedByUserId: null,
          decidedAt: null,
          note: null,
          error: null,
          createdAt: new Date(),
        })
        .where(
          and(
            eq(agentProposal.agentId, agentId),
            eq(agentProposal.kind, 'memory-write'),
            eq(agentProposal.externalId, `${report.file}:${report.sha256}`),
            inArray(agentProposal.status, ['applied', 'failed']),
          ),
        );
    });
  }
}

// The owner's decision on a memory proposal. Approving it queues the write the owner's own
// edits use, made on the version the runner keeps the file at.
export async function decideMemoryProposal(
  proposalId: number,
  approved: boolean,
  userId: string,
  note: string | null,
): Promise<void> {
  const indexed = await db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ agentId: agentProposal.agentId })
      .from(agentProposal)
      .where(eq(agentProposal.id, proposalId));
    if (candidate?.agentId)
      await tx
        .select({ id: aiAgent.id })
        .from(aiAgent)
        .where(eq(aiAgent.id, candidate.agentId))
        .for('update');
    const [proposal] = await tx
      .update(agentProposal)
      .set({
        status: approved ? 'approved' : 'rejected',
        decidedByUserId: userId,
        decidedAt: new Date(),
        note,
      })
      .where(and(eq(agentProposal.id, proposalId), eq(agentProposal.status, 'pending')))
      .returning();
    if (!proposal) throw new HttpError(409, 'This proposal has already been decided');
    if (!approved || !proposal.agentId) return;
    const factPayload = proposal.payload as {
      type?: string;
      scope?: { teamId: number; projectId: number | null };
      input?: import('../native-runtime/facts').FactInput;
      source?: Record<string, unknown>;
    };
    if (factPayload.type === 'fact') {
      if (!factPayload.scope || !factPayload.input)
        throw new HttpError(400, 'Invalid fact proposal');
      const { addApprovedFact } = await import('../native-runtime/facts');
      const stored = await addApprovedFact(
        tx,
        proposal.agentId,
        factPayload.scope,
        factPayload.input,
        {
          ...factPayload.source,
          proposalId: proposal.id,
        },
      );
      await tx
        .update(agentProposal)
        .set({ status: 'applied' })
        .where(eq(agentProposal.id, proposal.id));
      return { facts: stored.indexed };
    }
    const payload = proposal.payload as {
      file: MemoryFile | string;
      after: string;
      baseSha256?: string;
      sourceContext?: unknown;
    };
    const limits = await agentContextLimits(proposal.agentId);
    const limit =
      payload.file === 'USER.md'
        ? limits.user
        : payload.file.startsWith('notes/')
          ? limits.dailyNote
          : limits.memory;
    if (payload.after.length > limit)
      throw new HttpError(
        413,
        `${payload.file} has ${payload.after.length} characters; limit is ${limit}. Consolidate it first.`,
      );
    const [agent] = await tx
      .select({ policy: aiAgent.runtimePolicy })
      .from(aiAgent)
      .where(eq(aiAgent.id, proposal.agentId))
      .for('update');
    const noteFile = /^notes\/\d{4}-\d{2}-\d{2}\.md$/.test(payload.file);
    const [base] = noteFile
      ? await tx
          .select({ sha256: agentMemoryRevision.sha256 })
          .from(agentMemoryRevision)
          .where(
            and(
              eq(agentMemoryRevision.agentId, proposal.agentId),
              eq(agentMemoryRevision.file, payload.file),
            ),
          )
          .orderBy(desc(agentMemoryRevision.id))
          .limit(1)
      : (await memoryBaseline(proposal.agentId, tx)).filter((entry) => entry.file === payload.file);
    if ((agent?.policy as { runtime?: string })?.runtime === 'helena') {
      if (payload.baseSha256 !== (base?.sha256 ?? sha256(''))) {
        throw new HttpError(409, 'Memory changed after this proposal; review a new proposal');
      }
      await tx.insert(agentMemoryRevision).values({
        agentId: proposal.agentId,
        file: payload.file,
        content: payload.after,
        sha256: sha256(payload.after),
        source: 'agent',
        sourceContext: payload.sourceContext ?? null,
        proposalId: proposal.id,
        userId,
      });
      await tx
        .update(agentProposal)
        .set({ status: 'applied' })
        .where(eq(agentProposal.id, proposal.id));
      return `${proposal.agentId}:${payload.file}`;
    }
    if (noteFile) throw new HttpError(409, 'Native note requires a native runtime');
    await tx
      .delete(agentRuntimeAction)
      .where(
        and(
          eq(agentRuntimeAction.agentId, proposal.agentId),
          eq(agentRuntimeAction.kind, 'write-memory'),
          eq(agentRuntimeAction.target, payload.file),
        ),
      );
    await tx.insert(agentRuntimeAction).values({
      agentId: proposal.agentId,
      kind: 'write-memory',
      target: payload.file,
      payload: {
        content: payload.after,
        baseSha256: base?.sha256 ?? sha256(''),
        proposalId: proposal.id,
      },
    });
  });
  if (indexed && typeof indexed === 'object') {
    const { reindexApprovedFacts } = await import('../native-runtime/facts');
    await reindexApprovedFacts(indexed.facts);
  } else if (indexed) {
    await reindexItems(agentMemorySource, [indexed]).catch((error: unknown) => {
      console.error('[agent-memory] approved revision reindex failed', error);
    });
  }
}

// A write-memory action the runner carried out: the new version is recorded, as the agent's
// when it came from an approved proposal, else as the owner's; the proposal is applied. A
// failed one fails its proposal.
export async function completeMemoryWrites(
  agentId: number,
  actions: { id: number; kind: string; target: string; payload: unknown; userId?: string | null }[],
  results: { id: number; error: string | null }[],
): Promise<void> {
  for (const result of results) {
    const action = actions.find((entry) => entry.id === result.id);
    if (!action || action.kind !== 'write-memory') continue;
    const payload = action.payload as { content?: string; proposalId?: number };
    if (result.error !== null) {
      if (payload.proposalId) {
        await db
          .update(agentProposal)
          .set({ status: 'failed', error: result.error.slice(0, 500) })
          .where(eq(agentProposal.id, payload.proposalId));
      }
      continue;
    }
    const content = payload.content ?? '';
    await db.insert(agentMemoryRevision).values({
      agentId,
      file: action.target,
      content,
      sha256: sha256(content),
      source: payload.proposalId ? 'agent' : 'owner',
      proposalId: payload.proposalId ?? null,
      userId: action.userId ?? null,
    });
    if (payload.proposalId) {
      await db
        .update(agentProposal)
        .set({ status: 'applied' })
        .where(eq(agentProposal.id, payload.proposalId));
    }
  }
}

export interface MemoryRevisionRow {
  id: number;
  file: MemoryFile;
  content: string;
  sha256: string;
  source: 'agent' | 'owner' | 'observed';
  sourceContext: { sessionId?: string; runId?: number | null } | null;
  proposalId: number | null;
  userName: string | null;
  createdAt: string;
}

export async function listMemoryRevisions(
  agentId: number,
  file?: MemoryFile,
  limit = 50,
): Promise<MemoryRevisionRow[]> {
  const rows = await db
    .select({
      id: agentMemoryRevision.id,
      file: agentMemoryRevision.file,
      content: agentMemoryRevision.content,
      sha256: agentMemoryRevision.sha256,
      source: agentMemoryRevision.source,
      sourceContext: agentMemoryRevision.sourceContext,
      proposalId: agentMemoryRevision.proposalId,
      userName: user.name,
      createdAt: agentMemoryRevision.createdAt,
    })
    .from(agentMemoryRevision)
    .leftJoin(user, eq(user.id, agentMemoryRevision.userId))
    .where(
      and(
        eq(agentMemoryRevision.agentId, agentId),
        file ? eq(agentMemoryRevision.file, file) : inArray(agentMemoryRevision.file, FILES),
      ),
    )
    .orderBy(desc(agentMemoryRevision.id))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map((row) => ({
    ...row,
    file: row.file as MemoryFile,
    source: row.source as MemoryRevisionRow['source'],
    sourceContext: row.sourceContext as MemoryRevisionRow['sourceContext'],
    createdAt: iso(row.createdAt),
  }));
}

// Whether the agent's memory writes wait for the owner.
export async function memoryApproval(agentId: number): Promise<boolean> {
  const [row] = await db
    .select({ policy: aiAgent.runtimePolicy })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  return (row?.policy as { memoryApproval?: boolean } | undefined)?.memoryApproval === true;
}
