import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { appSetting, db, knowledgeChunk, knowledgeItem } from '@repo/db';
import type { SemanticRetriever } from './search';
import { sha256 } from './text';

// Semantic search, behind a switch (Administrator → Wissen). Items are cut into
// passages; an embedding model turns each passage and each query into a vector; the
// search ranks passages by cosine similarity and fuses that list with the full-text one
// (search.ts, RRF).
//
// - Vectors are stored as real[] (no extension needed). Without pgvector the similarity
//   is computed in SQL over the arrays, fine for tens of thousands of passages.
// - With pgvector installed (`CREATE EXTENSION vector`), ensureVectorIndex adds an
//   indexed `embedding_vec vector(n)` column beside the array; the search uses its HNSW
//   index. No migration depends on the extension.
// - The model runs in-process (Transformers.js + ONNX, see createTransformersEmbedder),
//   only once the owner approved the runtime and the model download. Until then the
//   switch reports what is missing and the search is full text only.

export const SEMANTIC_SETTING = 'knowledge.semantic';

export interface SemanticSetting {
  enabled: boolean;
  // A Hugging Face model id or a local folder with the ONNX model.
  model: string;
}

export const DEFAULT_SEMANTIC_MODEL = 'onnx-community/granite-embedding-97m-multilingual-r2-ONNX';

export interface Embedder {
  // Names the model, stored with each vector so a model change embeds again.
  id: string;
  dims: number;
  // Unit-length vectors, one per text.
  embed(texts: string[], kind: 'query' | 'passage'): Promise<number[][]>;
}

let current: Embedder | null = null;
let problem: string | null = null;

export function useEmbedder(embedder: Embedder | null, reason: string | null = null): void {
  current = embedder;
  problem = embedder ? null : reason;
}

export function activeEmbedder(): Embedder | null {
  return current;
}

export async function semanticSetting(): Promise<SemanticSetting> {
  const [row] = await db.select().from(appSetting).where(eq(appSetting.key, SEMANTIC_SETTING));
  const value = (row?.value ?? {}) as Partial<SemanticSetting>;
  return { enabled: value.enabled === true, model: value.model || DEFAULT_SEMANTIC_MODEL };
}

export async function saveSemanticSetting(setting: SemanticSetting): Promise<void> {
  await db
    .insert(appSetting)
    .values({ key: SEMANTIC_SETTING, value: setting })
    .onConflictDoUpdate({ target: appSetting.key, set: { value: setting, updatedAt: new Date() } });
}

export async function hasPgvector(): Promise<boolean> {
  const rows = await db.execute<{ present: boolean }>(
    sql`select exists (select 1 from pg_extension where extname = 'vector') as present`,
  );
  return rows[0]?.present === true;
}

async function hasVectorColumn(): Promise<boolean> {
  const rows = await db.execute<{ present: boolean }>(
    sql`select exists (select 1 from information_schema.columns where table_name = 'knowledge_chunk' and column_name = 'embedding_vec') as present`,
  );
  return rows[0]?.present === true;
}

// With pgvector: an indexed vector column of the model's size beside the array. A model
// of another size replaces the column.
export async function ensureVectorIndex(dims: number): Promise<boolean> {
  if (!(await hasPgvector())) return false;
  const rows = await db.execute<{ dims: number | null }>(
    sql`select atttypmod as dims from pg_attribute where attrelid = 'knowledge_chunk'::regclass and attname = 'embedding_vec' and not attisdropped`,
  );
  const existing = rows[0]?.dims ?? null;
  if (existing !== null && existing !== dims) {
    await db.execute(sql`alter table knowledge_chunk drop column embedding_vec`);
  }
  if (existing !== dims) {
    await db.execute(
      sql.raw(
        `alter table knowledge_chunk add column if not exists embedding_vec vector(${Math.trunc(dims)})`,
      ),
    );
    await db.execute(
      sql`update knowledge_chunk set embedding_vec = embedding::vector where embedding is not null`,
    );
  }
  await db.execute(
    sql`create index if not exists knowledge_chunk_embedding_hnsw_idx on knowledge_chunk using hnsw (embedding_vec vector_cosine_ops)`,
  );
  return true;
}

export interface SemanticStatus {
  enabled: boolean;
  pgvector: boolean;
  model: string | null;
  passages: number;
  embedded: number;
  // Why it is off although switched on: the runtime or the model is missing.
  problem: string | null;
}

export async function semanticStatus(): Promise<SemanticStatus> {
  const [setting, pgvector, counts] = await Promise.all([
    semanticSetting(),
    hasPgvector(),
    db
      .select({
        passages: sql<number>`count(*)::int`,
        embedded: sql<number>`count(${knowledgeChunk.embedding})::int`,
      })
      .from(knowledgeChunk),
  ]);
  return {
    enabled: setting.enabled && current !== null,
    pgvector,
    model: current?.id ?? (setting.enabled ? setting.model : null),
    passages: Number(counts[0]?.passages ?? 0),
    embedded: Number(counts[0]?.embedded ?? 0),
    problem: setting.enabled && !current ? problem : null,
  };
}

// Passages of about `size` characters, cut at paragraph, then sentence boundaries, with a
// little overlap so a thought that spans a cut is found from both sides.
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const pieces = clean
    .split(/\n{2,}/)
    .flatMap((paragraph) =>
      paragraph.length <= size ? [paragraph] : paragraph.split(/(?<=[.!?])\s+/),
    );
  const chunks: string[] = [];
  let buffer = '';
  for (const piece of pieces) {
    const parts =
      piece.length > size ? piece.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'))! : [piece];
    for (const part of parts) {
      if (buffer && buffer.length + part.length + 2 > size) {
        chunks.push(buffer);
        buffer = buffer.slice(Math.max(0, buffer.length - overlap));
      }
      buffer = buffer ? `${buffer}\n\n${part}` : part;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

export function normalize(vector: ArrayLike<number>): number[] {
  let norm = 0;
  for (let index = 0; index < vector.length; index += 1) norm += vector[index]! * vector[index]!;
  const length = Math.sqrt(norm) || 1;
  return Array.from(vector, (value) => value / length);
}

const MAX_PASSAGES_PER_ITEM = 64;

// Cuts the passages of items that have none yet (new or changed items lose theirs in
// store.ts), then embeds passages without a vector of the current model. Returns how
// many passages it embedded.
export async function embedPending(embedder: Embedder, batch = 16, maxItems = 50): Promise<number> {
  const uncut = await db
    .select({ id: knowledgeItem.id, title: knowledgeItem.title, text: knowledgeItem.text })
    .from(knowledgeItem)
    .where(
      sql`not exists (select 1 from ${knowledgeChunk} where ${knowledgeChunk.itemId} = ${knowledgeItem.id})`,
    )
    .orderBy(asc(knowledgeItem.id))
    .limit(maxItems);
  for (const item of uncut) {
    const passages = chunkText(`${item.title}\n\n${item.text}`).slice(0, MAX_PASSAGES_PER_ITEM);
    if (passages.length === 0) continue;
    await db
      .insert(knowledgeChunk)
      .values(
        passages.map((text, ordinal) => ({
          itemId: item.id,
          ordinal,
          text,
          contentHash: sha256(text),
        })),
      )
      .onConflictDoNothing();
  }
  const pending = await db
    .select({ id: knowledgeChunk.id, text: knowledgeChunk.text })
    .from(knowledgeChunk)
    .where(or(isNull(knowledgeChunk.embedding), ne(knowledgeChunk.model, embedder.id)))
    .orderBy(asc(knowledgeChunk.id))
    .limit(batch * 4);
  let done = 0;
  const vectorColumn = await hasVectorColumn();
  for (let start = 0; start < pending.length; start += batch) {
    const slice = pending.slice(start, start + batch);
    const vectors = await embedder.embed(
      slice.map((chunk) => chunk.text),
      'passage',
    );
    for (const [index, chunk] of slice.entries()) {
      const vector = normalize(vectors[index]!);
      await db
        .update(knowledgeChunk)
        .set({ embedding: vector, model: embedder.id, embeddedAt: new Date() })
        .where(eq(knowledgeChunk.id, chunk.id));
      if (vectorColumn) {
        await db.execute(
          sql`update knowledge_chunk set embedding_vec = embedding::vector where id = ${chunk.id}`,
        );
      }
      done += 1;
    }
  }
  return done;
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`;
}

// The retriever search.ts fuses in, or null while semantic search is off.
export async function semanticRetriever(): Promise<SemanticRetriever | null> {
  const embedder = current;
  if (!embedder || !(await semanticSetting()).enabled) return null;
  const indexed = await hasVectorColumn();
  return async ({ q, readable, filters, limit }) => {
    const [raw] = await embedder.embed([q], 'query');
    const query = normalize(raw!);
    const similarity: SQL<number> = indexed
      ? sql<number>`1 - (${knowledgeChunk}.embedding_vec <=> ${vectorLiteral(query)}::vector)`
      : sql<number>`(select sum(a * b) from unnest(${knowledgeChunk.embedding}, ${query}::real[]) as pair(a, b))`;
    const rows = await db
      .select({
        rowId: knowledgeChunk.itemId,
        similarity: similarity.as('similarity'),
        passage: knowledgeChunk.text,
      })
      .from(knowledgeChunk)
      .innerJoin(knowledgeItem, eq(knowledgeItem.id, knowledgeChunk.itemId))
      .where(and(eq(knowledgeChunk.model, embedder.id), readable, filters))
      .orderBy(sql`similarity desc`)
      .limit(limit * 3);
    // The best passage per item.
    const best = new Map<number, { rowId: number; similarity: number; passage: string }>();
    for (const row of rows) {
      const value = Number(row.similarity);
      if (!best.has(row.rowId) && value > 0.2) {
        best.set(row.rowId, { rowId: row.rowId, similarity: value, passage: row.passage });
      }
    }
    return [...best.values()].slice(0, limit);
  };
}

export async function passagesOf(itemIds: number[]) {
  if (itemIds.length === 0) return [];
  return db
    .select()
    .from(knowledgeChunk)
    .where(inArray(knowledgeChunk.itemId, itemIds))
    .orderBy(asc(knowledgeChunk.itemId), asc(knowledgeChunk.ordinal));
}

// The in-process embedder over Transformers.js (Apache-2.0) and ONNX Runtime (MIT). The
// package is not a dependency until the owner approves it (docs/helena-decisions/
// second-brain.md), so it is loaded by name at run time and a missing package only
// leaves semantic search off.
export async function createTransformersEmbedder(model: string): Promise<Embedder> {
  const specifier = '@huggingface/transformers';
  const transformers = (await import(specifier)) as {
    pipeline: (
      task: string,
      model: string,
      options?: Record<string, unknown>,
    ) => Promise<
      (
        texts: string[],
        options: Record<string, unknown>,
      ) => Promise<{ tolist(): number[][]; dims: number[] }>
    >;
    env: Record<string, unknown>;
  };
  if (process.env.HELENA_MODELS_DIR) transformers.env.cacheDir = process.env.HELENA_MODELS_DIR;
  transformers.env.allowRemoteModels = process.env.HELENA_MODELS_OFFLINE !== '1';
  const extractor = await transformers.pipeline('feature-extraction', model, { dtype: 'q8' });
  const probe = await extractor(['probe'], { pooling: 'mean', normalize: true });
  const dims = probe.dims[probe.dims.length - 1] ?? 384;
  // The e5 family wants its role in front of the text; the granite and most others none.
  const prefix = /e5/i.test(model)
    ? { query: 'query: ', passage: 'passage: ' }
    : { query: '', passage: '' };
  return {
    id: model,
    dims,
    async embed(texts, kind) {
      const output = await extractor(
        texts.map((text) => `${prefix[kind]}${text}`),
        { pooling: 'mean', normalize: true },
      );
      return output.tolist();
    },
  };
}

let loading: Promise<void> | null = null;
let lastAttempt = 0;
const RETRY_MS = 5 * 60_000;

// Loads the embedder when semantic search is switched on and drops it when it is switched
// off. A failed load (runtime not installed, model not downloaded) is retried after five
// minutes and reported by semanticStatus.
export async function syncEmbedder(): Promise<Embedder | null> {
  const setting = await semanticSetting();
  if (!setting.enabled) {
    if (current) useEmbedder(null);
    return null;
  }
  if (current?.id === setting.model) return current;
  if (Date.now() - lastAttempt < RETRY_MS && !current) return null;
  loading ??= (async () => {
    lastAttempt = Date.now();
    try {
      useEmbedder(await createTransformersEmbedder(setting.model));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useEmbedder(
        null,
        /Cannot find (package|module)/i.test(message)
          ? 'runtime-missing'
          : `model-unavailable: ${message.slice(0, 300)}`,
      );
    }
  })().finally(() => {
    loading = null;
  });
  await loading;
  return current;
}
