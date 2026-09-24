import { eq, sql } from 'drizzle-orm';
import { db, knowledgeSourceState } from '@repo/db';
import type { KnowledgeItem, KnowledgeSource } from '@helena/sdk';
import { indexedIds, removeItems, upsertItems } from './store';

// Keeps the index in line with every registered source. Each run asks a source for what
// changed since its last run started (with an overlap: rows can commit a little after
// the time they carry), writes what differs and records how far it got. A sweep now and
// then asks which indexed ids still exist and drops the rest, since a list of changes
// cannot show a deletion. Where a surface knows what it changed (the API after a write,
// an event), reindexItems brings those items in at once.

export const DEFAULT_INDEXER_OPTIONS = {
  // How far back a catch-up reaches before the last run's start.
  overlapMs: 5 * 60_000,
  // How often each source's indexed ids are checked for deletions.
  sweepEveryMs: 2 * 60_000,
  pageLimit: 500,
};

export type IndexerOptions = typeof DEFAULT_INDEXER_OPTIONS;

export interface SourceRunResult {
  source: string;
  listed: number;
  written: number;
  removed: number;
  error: string | null;
}

async function databaseNow(): Promise<Date> {
  const [row] = await db.execute<{ now: Date | string }>(sql`select now() as now`);
  return new Date(row!.now);
}

async function stateOf(source: string) {
  const [row] = await db
    .select()
    .from(knowledgeSourceState)
    .where(eq(knowledgeSourceState.source, source));
  return row ?? null;
}

async function saveState(
  source: string,
  values: Partial<typeof knowledgeSourceState.$inferInsert>,
): Promise<void> {
  const row = { ...values, updatedAt: new Date() };
  await db
    .insert(knowledgeSourceState)
    .values({ source, ...row })
    .onConflictDoUpdate({ target: knowledgeSourceState.source, set: row });
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

// Drops the indexed items of a source that no longer exist.
export async function sweepSource(source: KnowledgeSource, pageLimit = 500): Promise<number> {
  let removed = 0;
  let after = 0;
  for (;;) {
    const page = await indexedIds(source.id, after, pageLimit);
    if (page.length === 0) break;
    after = page[page.length - 1]!.rowId;
    const ids = page.map((row) => row.itemId);
    let gone: string[];
    if (source.present) {
      const present = new Set(await source.present(ids));
      gone = ids.filter((id) => !present.has(id));
    } else {
      gone = [];
      for (const id of ids) if ((await source.get(id)) === null) gone.push(id);
    }
    removed += await removeItems(source.id, gone);
    if (page.length < pageLimit) break;
  }
  return removed;
}

// One catch-up of one source, and its sweep when one is due.
export async function runSource(
  source: KnowledgeSource,
  options: Partial<IndexerOptions> = {},
): Promise<SourceRunResult> {
  const settings = { ...DEFAULT_INDEXER_OPTIONS, ...options };
  const result: SourceRunResult = {
    source: source.id,
    listed: 0,
    written: 0,
    removed: 0,
    error: null,
  };
  const started = await databaseNow();
  const state = await stateOf(source.id);
  const since = state?.watermark ? new Date(state.watermark.getTime() - settings.overlapMs) : null;
  try {
    let cursor: string | null = null;
    do {
      const page = await source.list({ since, cursor, limit: settings.pageLimit });
      result.listed += page.items.length;
      result.written += (await upsertItems(source.id, page.items)).written;
      cursor = page.cursor;
    } while (cursor);
    const sweepDue =
      !state?.lastSweepAt ||
      started.getTime() - state.lastSweepAt.getTime() >= settings.sweepEveryMs;
    if (sweepDue) result.removed = await sweepSource(source, settings.pageLimit);
    await saveState(source.id, {
      watermark: started,
      lastRunAt: started,
      ...(sweepDue ? { lastSweepAt: started } : {}),
      lastError: null,
    });
  } catch (error) {
    result.error = message(error);
    await saveState(source.id, { lastRunAt: started, lastError: result.error });
  }
  return result;
}

export async function runSources(
  sources: KnowledgeSource[],
  options: Partial<IndexerOptions> = {},
): Promise<SourceRunResult[]> {
  const results: SourceRunResult[] = [];
  for (const source of sources) results.push(await runSource(source, options));
  return results;
}

// Brings named items of a source in now: written when they exist, dropped when not.
export async function reindexItems(source: KnowledgeSource, ids: string[]): Promise<void> {
  const present: KnowledgeItem[] = [];
  const gone: string[] = [];
  for (const id of new Set(ids)) {
    const item = await source.get(id);
    if (item) present.push(item);
    else gone.push(id);
  }
  await upsertItems(source.id, present);
  await removeItems(source.id, gone);
}

// Forgets how far a source got, so its next run lists everything again.
export async function resetSource(sourceId: string): Promise<void> {
  await saveState(sourceId, { watermark: null, lastSweepAt: null, lastError: null });
}

export async function sourceStates() {
  return db.select().from(knowledgeSourceState);
}
