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
    .where(eq(agentMemoryRevision.agentId, agentId))
    .orderBy(agentMemoryRevision.file, desc(agentMemoryRevision.id));
  return rows.map((row) => ({ ...row, file: row.file as MemoryFile }));
}

// A version the runner reports that differs from the latest one is recorded as seen. A file
// reported truncated is not: its content is not the whole file.
export async function recordObservedMemory(
  agentId: number,
  inventory: AgentRuntimeInventory | null | undefined,
): Promise<void> {
  if (!inventory) return;
  const baseline = new Map((await memoryBaseline(agentId)).map((entry) => [entry.file, entry]));
  for (const entry of inventory.memory) {
    if (entry.truncated || !FILES.includes(entry.file)) continue;
    const digest = entry.sha256 ?? sha256(entry.content);
    if (baseline.get(entry.file)?.sha256 === digest) continue;
    await db.insert(agentMemoryRevision).values({
      agentId,
      file: entry.file,
      content: entry.content,
      sha256: digest,
      source: 'observed',
    });
  }
}

export interface MemoryProposalReport {
  file: MemoryFile;
  content: string;
  sha256: string;
  baseSha256: string;
}

// Memory writes the runner held back become proposals. A newer write to the same file
// replaces a proposal still waiting for it; the same write reported again changes nothing.
export async function recordMemoryProposals(
  agentId: number,
  reports: MemoryProposalReport[] | undefined,
): Promise<void> {
  if (!reports?.length) return;
  const baseline = new Map((await memoryBaseline(agentId)).map((entry) => [entry.file, entry]));
  for (const report of reports) {
    if (!FILES.includes(report.file) || sha256(report.content) !== report.sha256) continue;
    const before = baseline.get(report.file);
    await db.transaction(async (tx) => {
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
      await tx
        .insert(agentProposal)
        .values({
          agentId,
          kind: 'memory-write',
          externalId: `${report.file}:${report.sha256}`,
          title: report.file,
          payload: {
            file: report.file,
            before: before?.content ?? '',
            after: report.content,
            baseSha256: report.baseSha256,
            sha256: report.sha256,
          },
        })
        .onConflictDoNothing();
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
  await db.transaction(async (tx) => {
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
    const payload = proposal.payload as { file: MemoryFile; after: string };
    const [base] = (await memoryBaseline(proposal.agentId, tx)).filter(
      (entry) => entry.file === payload.file,
    );
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
    createdAt: iso(row.createdAt),
  }));
}

// Whether the agent's memory writes wait for the owner.
export async function memoryApproval(agentId: number): Promise<boolean> {
  const [row] = await db
    .select({ policy: aiAgent.runtimePolicy })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  return (row?.policy as { memoryApproval?: boolean } | undefined)?.memoryApproval !== false;
}
