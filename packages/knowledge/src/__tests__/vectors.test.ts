import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { appSetting, db, knowledgeChunk, team } from '@repo/db';
import type { KnowledgeItem } from '@helena/sdk';
import { upsertItems } from '../store';
import { searchKnowledgeIndex } from '../search';
import {
  chunkText,
  embedPending,
  saveSemanticSetting,
  SEMANTIC_SETTING,
  semanticRetriever,
  semanticStatus,
  useEmbedder,
  type Embedder,
} from '../vectors';

// A stand-in for the embedding model: words of one meaning share a dimension, so
// "Fahrzeug" finds "Wagen" although no word matches.
const MEANINGS: Record<string, number> = {
  wagen: 0,
  auto: 0,
  fahrzeug: 0,
  rechnung: 1,
  beleg: 1,
  quittung: 1,
  urlaub: 2,
  ferien: 2,
};

const fakeEmbedder: Embedder = {
  id: 'test-meanings',
  dims: 8,
  async embed(texts) {
    return texts.map((text) => {
      const vector = new Array(8).fill(0.01);
      for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
        const dimension = MEANINGS[word];
        if (dimension !== undefined) vector[dimension] += 1;
      }
      return vector;
    });
  },
};

let teamId = 0;

function item(id: string, title: string, text: string): KnowledgeItem {
  const now = new Date().toISOString();
  return {
    id,
    title,
    text,
    href: `/x/${id}`,
    scope: { teamId, projectId: null, visibility: 'team', permission: null },
    provenance: { createdAt: now, updatedAt: now },
  };
}

beforeEach(async () => {
  const database = (process.env.DATABASE_URL ?? '').split('/').pop() ?? '';
  if (!database.includes('test')) throw new Error('refusing to run against a non-test database');
  await db.execute(
    sql`TRUNCATE knowledge_item, knowledge_link, knowledge_chunk RESTART IDENTITY CASCADE`,
  );
  const [row] = await db.insert(team).values({ name: 'Vectors' }).returning({ id: team.id });
  teamId = row!.id;
});

afterEach(async () => {
  useEmbedder(null);
  await db.delete(appSetting).where(eq(appSetting.key, SEMANTIC_SETTING));
});

describe('semantic search', () => {
  it('cuts long text into overlapping passages at paragraph boundaries', () => {
    const paragraph = 'Satz eins. '.repeat(60).trim();
    const chunks = chunkText(`${paragraph}\n\n${paragraph}\n\n${paragraph}`, 800, 100);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.length <= 900)).toBe(true);
    expect(chunkText('kurz')).toEqual(['kurz']);
    expect(chunkText('   ')).toEqual([]);
  });

  it('stays off until switched on and a model is loaded', async () => {
    expect(await semanticRetriever()).toBeNull();
    await saveSemanticSetting({ enabled: true, model: 'test-meanings' });
    expect(await semanticRetriever()).toBeNull();
    useEmbedder(null, 'runtime-missing');
    expect(await semanticStatus()).toMatchObject({ enabled: false, problem: 'runtime-missing' });
  });

  it('finds by meaning and fuses it with the words (RRF)', async () => {
    await upsertItems('test', [
      item('car', 'Einkauf', 'Der Wagen ist rot und steht in der Garage.'),
      item('bill', 'Buchhaltung', 'Die Rechnung für März liegt im Ordner.'),
      item('trip', 'Planung', 'Im August sind Ferien am Meer geplant.'),
    ]);
    useEmbedder(fakeEmbedder);
    await saveSemanticSetting({ enabled: true, model: fakeEmbedder.id });
    while ((await embedPending(fakeEmbedder)) > 0) {
      // Embed every passage.
    }
    const [counts] = await db
      .select({ embedded: sql<number>`count(${knowledgeChunk.embedding})::int` })
      .from(knowledgeChunk);
    expect(Number(counts!.embedded)).toBe(3);

    const reach = {
      userId: 'nobody',
      projects: new Map(),
      teams: new Map([[teamId, new Set<string>()]]),
    };
    const words = await searchKnowledgeIndex(reach, { q: 'Fahrzeug', limit: 5 });
    expect(words.items).toEqual([]);

    const retriever = (await semanticRetriever())!;
    const meaning = await searchKnowledgeIndex(reach, { q: 'Fahrzeug', limit: 5 }, retriever);
    expect(meaning.items[0]?.id).toBe('car');
    expect(meaning.items[0]?.matched).toEqual(['meaning']);

    // A hit by both its words and its meaning ranks above one by meaning alone.
    const both = await searchKnowledgeIndex(reach, { q: 'Rechnung', limit: 5 }, retriever);
    expect(both.items[0]?.id).toBe('bill');
    expect(both.items[0]?.matched.sort()).toEqual(['meaning', 'text']);

    // Another team's reader finds nothing, by words or by meaning.
    const stranger = { userId: 'x', projects: new Map(), teams: new Map() };
    expect(
      (await searchKnowledgeIndex(stranger, { q: 'Ferien', limit: 5 }, retriever)).items,
    ).toEqual([]);

    const status = await semanticStatus();
    expect(status).toMatchObject({
      enabled: true,
      model: 'test-meanings',
      passages: 3,
      embedded: 3,
    });
  });
});
