import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { agentMemoryRevision, db } from '@repo/db';
import { looksSecret } from '@helena/facts';
import { agentMemorySource, reindexItems } from '@helena/knowledge';
import { HttpError } from '#shared/lib';
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
// without approval. Nothing that looks like a secret is kept.

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export const MEMORY_LIMIT = 12_000;
const NOTE_LIMIT = 20_000;
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

async function latest(agentId: number, file: string): Promise<string> {
  const [row] = await db
    .select({ content: agentMemoryRevision.content })
    .from(agentMemoryRevision)
    .where(and(eq(agentMemoryRevision.agentId, agentId), eq(agentMemoryRevision.file, file)))
    .orderBy(desc(agentMemoryRevision.id))
    .limit(1);
  return row?.content ?? '';
}

function reindexLater(ids: string[]): void {
  void reindexItems(agentMemorySource, ids).catch((error: unknown) => {
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
export async function addNote(agentId: number, text: string, now = new Date()): Promise<void> {
  const line = text.replace(/\s+/g, ' ').trim().slice(0, NOTE_LINE_LIMIT);
  if (!line) throw new HttpError(400, 'The note is empty');
  if (looksSecret(line)) throw new HttpError(400, 'The note looks like it holds a secret');
  const file = noteFile(now);
  const before = await latest(agentId, file);
  let content = `${before}${before && !before.endsWith('\n') ? '\n' : ''}- ${timeOf(now)} ${line}\n`;
  // A day's note keeps its newest lines when it grows past the limit.
  if (content.length > NOTE_LIMIT) content = content.slice(content.length - NOTE_LIMIT);
  await db.insert(agentMemoryRevision).values({
    agentId,
    file,
    content,
    sha256: sha256(content),
    source: 'agent',
  });
  reindexLater([`${agentId}:${file}`]);
}

// A new MEMORY.md or USER.md from the agent: a proposal while its memory writes wait for the
// owner (the memory editor shows it), else the new version at once.
export async function proposeMemory(
  agentId: number,
  file: MemoryFile,
  content: string,
): Promise<{ status: 'applied' | 'pending' }> {
  const text = content.trim();
  if (text.length > MEMORY_LIMIT) {
    throw new HttpError(400, `${file} may have at most ${MEMORY_LIMIT} characters`);
  }
  if (looksSecret(text)) throw new HttpError(400, 'The memory looks like it holds a secret');
  const body = `${text}\n`;
  const baseline = (await memoryBaseline(agentId)).find((entry) => entry.file === file);
  if (baseline?.sha256 === sha256(body)) return { status: 'applied' };
  if (await memoryApproval(agentId)) {
    await recordMemoryProposals(agentId, [
      { file, content: body, sha256: sha256(body), baseSha256: baseline?.sha256 ?? sha256('') },
    ]);
    return { status: 'pending' };
  }
  await db.insert(agentMemoryRevision).values({
    agentId,
    file,
    content: body,
    sha256: sha256(body),
    source: 'agent',
  });
  reindexLater([`${agentId}:${file}`]);
  return { status: 'applied' };
}

// The notes of an agent, newest day first, for the memory editor.
export async function listNotes(agentId: number, limit = 30) {
  const rows = await db
    .selectDistinctOn([agentMemoryRevision.file], {
      file: agentMemoryRevision.file,
      content: agentMemoryRevision.content,
      createdAt: agentMemoryRevision.createdAt,
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
      updatedAt: row.createdAt.toISOString(),
    }));
}
