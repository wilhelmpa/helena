import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  agentMemoryRevision,
  agentProposal,
  aiAgent,
  db,
  helenaAgentSession,
  helenaAgentSessionItem,
} from '@repo/db';
import { isTransientTask, looksSecret } from '@helena/facts';
import { agentMemorySource, reindexItems } from '@helena/knowledge';
import { HttpError } from '#shared/lib';
import { agentContextLimits } from '../core/context-limits';
import {
  memoryApproval,
  memoryBaseline,
  recordMemoryProposals,
  type MemoryFile,
} from '../memory/service';

// The memory of Helena's own agent loop, OpenClaw's way (docs/helena-decisions/
// zentrale-laufzeit.md §8.1): MEMORY.md and USER.md, kept as revisions like every agent's
// memory (the memory editor shows and edits them, writes wait for the owner where the agent's
// memory approval is on), and a daily note per day (notes/<date>.md) the agent adds lines to
// after approval when required. Nothing that looks like a secret is kept.

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const NOTE_LINE_LIMIT = 2_000;

export function noteFile(date: Date, timeZone = process.env.TZ || 'Europe/Berlin'): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return `notes/${day}.md`;
}

function timeOf(date: Date, timeZone = process.env.TZ || 'Europe/Berlin'): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    date,
  );
}

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function originOf(executor: Executor, agentId: number, sessionId?: string) {
  if (!sessionId) return null;
  const [session] = await executor
    .select({ id: helenaAgentSession.id, runId: helenaAgentSession.runId })
    .from(helenaAgentSession)
    .where(and(eq(helenaAgentSession.id, sessionId), eq(helenaAgentSession.agentId, agentId)));
  if (!session) throw new HttpError(403, 'Session does not belong to the agent');
  const source = await executor
    .select({ text: helenaAgentSessionItem.text })
    .from(helenaAgentSessionItem)
    .where(
      and(eq(helenaAgentSessionItem.sessionId, sessionId), eq(helenaAgentSessionItem.role, 'user')),
    )
    .orderBy(helenaAgentSessionItem.seq)
    .limit(3);
  if (source.some((item) => isTransientTask(item.text)))
    throw new HttpError(400, 'Temporary one-time lookups do not become memory');
  return { sessionId: session.id, runId: session.runId };
}

async function latest(agentId: number, file: string, executor: Executor = db): Promise<string> {
  const [row] = await executor
    .select({ content: agentMemoryRevision.content })
    .from(agentMemoryRevision)
    .where(and(eq(agentMemoryRevision.agentId, agentId), eq(agentMemoryRevision.file, file)))
    .orderBy(desc(agentMemoryRevision.id))
    .limit(1);
  return row?.content ?? '';
}

async function reindexMemory(ids: string[]): Promise<void> {
  await reindexItems(agentMemorySource, ids).catch((error: unknown) => {
    console.error('[helena-runtime] memory reindex failed', error);
  });
}

// What the loop puts in the system prompt: both files and the notes of today and yesterday.
export async function memoryState(agentId: number, now = new Date()) {
  const files = await memoryBaseline(agentId);
  const days = [noteFile(new Date(now.getTime() - 86_400_000)), noteFile(now)];
  const notes = await db
    .selectDistinctOn([agentMemoryRevision.file], {
      file: agentMemoryRevision.file,
      content: agentMemoryRevision.content,
    })
    .from(agentMemoryRevision)
    .where(and(eq(agentMemoryRevision.agentId, agentId), inArray(agentMemoryRevision.file, days)))
    .orderBy(agentMemoryRevision.file, desc(agentMemoryRevision.id));
  return {
    files: files.map((file) => ({ file: file.file, content: file.content, sha256: file.sha256 })),
    notes: notes
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((note) => ({
        day: note.file.slice('notes/'.length, -'.md'.length),
        content: note.content,
      })),
    approval: await memoryApproval(agentId),
  };
}

// One line added to today's note.
export async function addNote(
  agentId: number,
  text: string,
  now = new Date(),
  sessionId?: string,
): Promise<void> {
  const limits = await agentContextLimits(agentId);
  const line = text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, text.startsWith('[compaction:') ? 10_000 : NOTE_LINE_LIMIT);
  if (!line) throw new HttpError(400, 'The note is empty');
  if (looksSecret(line)) throw new HttpError(400, 'The note looks like it holds a secret');
  const file = noteFile(now);
  await db.transaction(async (tx) => {
    const [agent] = await tx
      .select({ policy: aiAgent.runtimePolicy })
      .from(aiAgent)
      .where(eq(aiAgent.id, agentId))
      .for('update');
    if (!agent) throw new HttpError(404, 'Agent not found');
    const sourceContext = await originOf(tx, agentId, sessionId);
    const before = await latest(agentId, file, tx);
    const marker = line.match(/^\[compaction:[a-f0-9-]{36}:\d+:\d+\]/)?.[0];
    if (marker && before.includes(marker)) return;
    const approval = (agent.policy as { memoryApproval?: boolean }).memoryApproval === true;
    const [pending] = approval
      ? await tx
          .select()
          .from(agentProposal)
          .where(
            and(
              eq(agentProposal.agentId, agentId),
              eq(agentProposal.kind, 'memory-write'),
              eq(agentProposal.status, 'pending'),
              sql`${agentProposal.payload}->>'file' = ${file}`,
            ),
          )
          .orderBy(desc(agentProposal.id))
          .limit(1)
      : [];
    const current = (pending?.payload as { after?: string } | undefined)?.after ?? before;
    if (marker && current.includes(marker)) return;
    if (
      !marker &&
      current.split('\n').some(
        (entry) =>
          entry
            .replace(/^-\s+\d{2}:\d{2}\s+/, '')
            .trim()
            .toLowerCase() === line.toLowerCase(),
      )
    )
      return;
    if (!marker) {
      const [{ count }] = approval
        ? await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(agentProposal)
            .where(
              and(
                eq(agentProposal.agentId, agentId),
                eq(agentProposal.kind, 'memory-write'),
                sql`${agentProposal.payload}->>'file' = ${file}`,
                sql`${agentProposal.createdAt} >= now() - interval '1 day'`,
              ),
            )
        : await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(agentMemoryRevision)
            .where(
              and(
                eq(agentMemoryRevision.agentId, agentId),
                eq(agentMemoryRevision.file, file),
                sql`${agentMemoryRevision.createdAt} >= now() - interval '1 day'`,
              ),
            );
      if (count >= 20) throw new HttpError(429, 'Daily memory note limit reached');
    }
    const content = `${current}${current && !current.endsWith('\n') ? '\n' : ''}- ${timeOf(now)} ${line}\n`;
    if (content.length > limits.dailyNote)
      throw new HttpError(
        413,
        `Daily note has ${content.length} characters; limit is ${limits.dailyNote}. Consolidate older notes first.`,
      );
    if (approval) {
      if (pending)
        await tx
          .update(agentProposal)
          .set({ status: 'rejected', note: 'Replaced by a newer note', decidedAt: now })
          .where(eq(agentProposal.id, pending.id));
      await tx
        .insert(agentProposal)
        .values({
          agentId,
          kind: 'memory-write',
          title: file,
          externalId: `${file}:${sha256(content)}`,
          payload: {
            file,
            before,
            after: content,
            baseSha256: sha256(before),
            sha256: sha256(content),
            sourceContext,
          },
        })
        .onConflictDoNothing();
      return;
    }
    await tx.insert(agentMemoryRevision).values({
      agentId,
      file,
      content,
      sha256: sha256(content),
      source: 'agent',
      sourceContext,
    });
  });
  await reindexMemory([`${agentId}:${file}`]);
}

// A new MEMORY.md or USER.md from the agent: a proposal while its memory writes wait for the
// owner (the memory editor shows it), else the new version at once.
export async function proposeMemory(
  agentId: number,
  file: MemoryFile,
  content: string,
  expectedSha256?: string,
  sessionId?: string,
): Promise<{ status: 'applied' | 'pending' }> {
  const limits = await agentContextLimits(agentId);
  const limit = file === 'USER.md' ? limits.user : limits.memory;
  const text = content.trim();
  const body = `${text}\n`;
  if (body.length > limit) {
    throw new HttpError(
      413,
      `${file} has ${body.length} characters; limit is ${limit}. Consolidate the memory first.`,
    );
  }
  if (looksSecret(text)) throw new HttpError(400, 'The memory looks like it holds a secret');
  const result = await db.transaction(async (tx): Promise<{ status: 'applied' | 'pending' }> => {
    await tx.select({ id: aiAgent.id }).from(aiAgent).where(eq(aiAgent.id, agentId)).for('update');
    const sourceContext = await originOf(tx, agentId, sessionId);
    const baseline = (await memoryBaseline(agentId, tx)).find((entry) => entry.file === file);
    if (expectedSha256 !== undefined && (baseline?.sha256 ?? sha256('')) !== expectedSha256)
      throw new HttpError(409, 'Memory changed during consolidation');
    if (baseline?.sha256 === sha256(body)) return { status: 'applied' };
    if (await memoryApproval(agentId)) {
      await recordMemoryProposals(
        agentId,
        [
          {
            file,
            content: body,
            sha256: sha256(body),
            baseSha256: baseline?.sha256 ?? sha256(''),
            sourceContext,
          },
        ],
        tx,
      );
      return { status: 'pending' };
    }
    await tx.insert(agentMemoryRevision).values({
      agentId,
      file,
      content: body,
      sha256: sha256(body),
      source: 'agent',
      sourceContext,
    });
    return { status: 'applied' };
  });
  if (result.status === 'applied') await reindexMemory([`${agentId}:${file}`]);
  return result;
}

// The notes of an agent, newest day first, for the memory editor.
export async function listNotes(agentId: number, limit = 30) {
  const rows = await db
    .selectDistinctOn([agentMemoryRevision.file], {
      file: agentMemoryRevision.file,
      content: agentMemoryRevision.content,
      createdAt: agentMemoryRevision.createdAt,
      sourceContext: agentMemoryRevision.sourceContext,
    })
    .from(agentMemoryRevision)
    .where(eq(agentMemoryRevision.agentId, agentId))
    .orderBy(agentMemoryRevision.file, desc(agentMemoryRevision.id));
  return rows
    .filter((row) => row.file.startsWith('notes/'))
    .sort((a, b) => b.file.localeCompare(a.file))
    .slice(0, Math.min(Math.max(limit, 1), 200))
    .map((row) => ({
      day: row.file.slice('notes/'.length, -'.md'.length),
      content: row.content,
      sourceContext: row.sourceContext,
      updatedAt: row.createdAt.toISOString(),
    }));
}
