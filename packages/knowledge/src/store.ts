import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db, knowledgeChunk, knowledgeItem, knowledgeLink } from '@repo/db';
import type { KnowledgeItem } from '@helena/sdk';
import { capText, sha256 } from './text';

// Writes items of one source into the index. An item whose content hash is unchanged is
// skipped, so a catch-up that re-reads an overlap costs a select, not a write. A changed
// item drops its passages; the embedding loop cuts and embeds them again.

function hashOf(item: KnowledgeItem): string {
  return sha256(
    JSON.stringify([
      item.title,
      item.text,
      item.href,
      item.mimeType ?? null,
      item.language ?? null,
      item.group ?? null,
      item.scope,
      item.provenance,
      item.metadata ?? {},
      item.links ?? [],
    ]),
  );
}

function row(source: string, item: KnowledgeItem, contentHash: string) {
  return {
    source,
    itemId: item.id,
    teamId: item.scope.teamId,
    projectId: item.scope.projectId,
    visibility: item.scope.visibility,
    ownerId: item.scope.ownerId ?? null,
    permission: item.scope.permission ?? null,
    title: item.title.slice(0, 1000),
    text: capText(item.text),
    href: item.href,
    mimeType: item.mimeType ?? null,
    language: item.language ?? null,
    groupKey: item.group ?? null,
    metadata: item.metadata ?? {},
    author: item.provenance.author ?? null,
    origin: item.provenance.origin ?? null,
    runId: item.provenance.runId ?? null,
    createdAt: new Date(item.provenance.createdAt),
    updatedAt: new Date(item.provenance.updatedAt),
    contentHash,
    indexedAt: new Date(),
  };
}

export interface UpsertResult {
  written: number;
  skipped: number;
}

export async function upsertItems(source: string, items: KnowledgeItem[]): Promise<UpsertResult> {
  if (items.length === 0) return { written: 0, skipped: 0 };
  // The last version of an id wins when a page repeats one.
  const byId = new Map(items.map((item) => [item.id, item]));
  const existing = await db
    .select({ itemId: knowledgeItem.itemId, contentHash: knowledgeItem.contentHash })
    .from(knowledgeItem)
    .where(and(eq(knowledgeItem.source, source), inArray(knowledgeItem.itemId, [...byId.keys()])));
  const known = new Map(existing.map((entry) => [entry.itemId, entry.contentHash]));
  let written = 0;
  let skipped = 0;
  for (const item of byId.values()) {
    const contentHash = hashOf(item);
    if (known.get(item.id) === contentHash) {
      skipped += 1;
      continue;
    }
    const values = row(source, item, contentHash);
    await db.transaction(async (tx) => {
      const [saved] = await tx
        .insert(knowledgeItem)
        .values(values)
        .onConflictDoUpdate({
          target: [knowledgeItem.source, knowledgeItem.itemId],
          set: values,
        })
        .returning({ id: knowledgeItem.id });
      await tx.delete(knowledgeLink).where(eq(knowledgeLink.itemId, saved.id));
      const links = [
        ...new Map(
          (item.links ?? []).map((link) => [`${link.kind}\u0000${link.target}`, link]),
        ).values(),
      ];
      if (links.length > 0) {
        await tx
          .insert(knowledgeLink)
          .values(
            links.map((link) => ({ itemId: saved.id, target: link.target, kind: link.kind })),
          );
      }
      await tx.delete(knowledgeChunk).where(eq(knowledgeChunk.itemId, saved.id));
    });
    written += 1;
  }
  return { written, skipped };
}

export async function removeItems(source: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const removed = await db
    .delete(knowledgeItem)
    .where(and(eq(knowledgeItem.source, source), inArray(knowledgeItem.itemId, ids)))
    .returning({ id: knowledgeItem.id });
  return removed.length;
}

// Every source's rows, when a source is unregistered for good (a plugin removed).
export async function removeSource(source: string): Promise<number> {
  const removed = await db
    .delete(knowledgeItem)
    .where(eq(knowledgeItem.source, source))
    .returning({ id: knowledgeItem.id });
  return removed.length;
}

// A page of the ids indexed for a source, by row id, for the sweep.
export async function indexedIds(
  source: string,
  afterRowId: number,
  limit: number,
): Promise<{ rowId: number; itemId: string }[]> {
  return db
    .select({ rowId: knowledgeItem.id, itemId: knowledgeItem.itemId })
    .from(knowledgeItem)
    .where(and(eq(knowledgeItem.source, source), gt(knowledgeItem.id, afterRowId)))
    .orderBy(asc(knowledgeItem.id))
    .limit(limit);
}

export async function countBySource(): Promise<Map<string, number>> {
  const rows = await db
    .select({ source: knowledgeItem.source, count: sql<number>`count(*)::int` })
    .from(knowledgeItem)
    .groupBy(knowledgeItem.source);
  return new Map(rows.map((entry) => [entry.source, Number(entry.count)]));
}
