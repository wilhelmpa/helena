import {
  atom,
  bind,
  encodeFact,
  encodeText,
  HRR_DIM,
  ROLE_CONTENT,
  ROLE_ENTITY,
  similarity,
  tokens,
  type Phases,
} from './hrr';

// Ranking, the algebraic queries and the trust rules of Helena's fact store
// (docs/helena-decisions/zentrale-laufzeit.md §8.2). The rows come from Postgres, already
// limited to what the asking agent may read; nothing here reads the database.

export interface FactRow {
  id: number;
  content: string;
  category: string;
  entities: string[];
  trust: number;
  updatedAt: Date;
  hrr: Phases | null;
}

export interface Scored<T> {
  fact: T;
  score: number;
}

export const TRUST = {
  initial: 0.5,
  helpful: 0.05,
  unhelpful: -0.1,
  confirmed: 0.05,
  contradicted: -0.1,
  minimum: 0.3,
} as const;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const shift = (value: number) => (value + 1) / 2;

export function trustAfter(
  trust: number,
  event: 'helpful' | 'unhelpful' | 'confirmed' | 'contradicted',
): number {
  return clamp(trust + TRUST[event]);
}

// 0.5^(age / half-life): an old fact counts less, unless it keeps being confirmed (which
// moves its updatedAt).
export function decay(updatedAt: Date, now: Date, halfLifeDays = 90): number {
  if (halfLifeDays <= 0) return 1;
  const days = (now.getTime() - updatedAt.getTime()) / 86_400_000;
  return days <= 0 ? 1 : 0.5 ** (days / halfLifeDays);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
}

// The hybrid search's candidates (full text and vectors, fused by the knowledge index into
// `rank`, best first, normalised here to [0, 1]) re-weighted with the word overlap and the
// HRR similarity, then with trust and age.
export function rerank<T extends FactRow>(
  query: string,
  candidates: { fact: T; rank: number }[],
  options: { now?: Date; halfLifeDays?: number; minTrust?: number; limit?: number } = {},
): Scored<T>[] {
  const now = options.now ?? new Date();
  const minTrust = options.minTrust ?? TRUST.minimum;
  const maxRank = Math.max(1e-9, ...candidates.map((candidate) => candidate.rank));
  const queryWords = new Set(tokens(query));
  let queryVector: Phases | null = null;
  const scored = candidates
    .filter((candidate) => candidate.fact.trust >= minTrust)
    .map(({ fact, rank }) => {
      const words = new Set(tokens(fact.content));
      let hrrSim = 0.5;
      if (fact.hrr) {
        queryVector ??= encodeText(query, fact.hrr.length);
        hrrSim = shift(similarity(queryVector, fact.hrr));
      }
      const relevance = 0.5 * (rank / maxRank) + 0.2 * jaccard(queryWords, words) + 0.3 * hrrSim;
      return {
        fact,
        score: relevance * fact.trust * decay(fact.updatedAt, now, options.halfLifeDays),
      };
    });
  return scored.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 10);
}

function vectorOf(fact: FactRow): Phases {
  return fact.hrr ?? encodeFact(fact.content, fact.entities);
}

function ranked<T extends FactRow>(
  rows: T[],
  similarityOf: (fact: T, vector: Phases) => number,
  limit: number,
): Scored<T>[] {
  return rows
    .map((fact) => ({ fact, score: shift(similarityOf(fact, vectorOf(fact))) * fact.trust }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// The HRR queries test whether a fact's vector holds a bound pair: a bundle stays similar to
// each of its parts (about 1/√parts) and near 0 to anything else.
//
// probe:   the entity in the entity role, bind(entity, ROLE_ENTITY);
// related: the entity in any role, also as a word of the content, bind(word, ROLE_CONTENT)
//          (the content is itself a bundle of its words);
// reason:  every one of the entities in the entity role, the minimum over them (a join in
//          vector space: one missing entity keeps the score low).

function entityKey(entity: string, dim: number): Phases {
  return bind(atom(entity.toLowerCase(), dim), atom(ROLE_ENTITY, dim));
}

export function probe<T extends FactRow>(entity: string, rows: T[], limit = 10): Scored<T>[] {
  const dim = rows[0]?.hrr?.length ?? HRR_DIM;
  const key = entityKey(entity, dim);
  return ranked(rows, (_fact, vector) => similarity(vector, key), limit);
}

export function related<T extends FactRow>(entity: string, rows: T[], limit = 10): Scored<T>[] {
  const dim = rows[0]?.hrr?.length ?? HRR_DIM;
  const roleContent = atom(ROLE_CONTENT, dim);
  const keys = [
    entityKey(entity, dim),
    ...tokens(entity).map((word) => bind(atom(word, dim), roleContent)),
  ];
  return ranked(
    rows,
    (_fact, vector) => Math.max(...keys.map((key) => similarity(vector, key))),
    limit,
  );
}

export function reason<T extends FactRow>(entities: string[], rows: T[], limit = 10): Scored<T>[] {
  if (entities.length === 0) return [];
  const dim = rows[0]?.hrr?.length ?? HRR_DIM;
  const keys = entities.map((entity) => entityKey(entity, dim));
  return ranked(
    rows,
    (_fact, vector) => Math.min(...keys.map((key) => similarity(vector, key))),
    limit,
  );
}

export interface Contradiction<T> {
  a: T;
  b: T;
  entityOverlap: number;
  contentSimilarity: number;
  score: number;
  shared: string[];
}

const STOPWORDS = new Set(
  'der die das den dem des ein eine einer eines einem einen und oder aber ist sind war waren wird werden hat haben mit auf an am im in zu zum zur von vom für bei nach als auch nicht noch nur so wie wenn dass the a an and or is are was were be to of in on at for with by as it this that'.split(
    ' ',
  ),
);

// What a fact claims beyond its subject: its words without the entity's words and the
// function words, as a bag.
function claimWords(fact: FactRow): string[] {
  const subject = new Set(fact.entities.flatMap((entity) => tokens(entity)));
  return tokens(fact.content).filter((word) => !subject.has(word) && !STOPWORDS.has(word));
}

function claimSimilarity(a: FactRow, b: FactRow): number {
  const left = claimWords(a);
  const right = claimWords(b);
  if (left.length === 0 || right.length === 0) return left.length === right.length ? 1 : 0;
  return similarity(encodeText(left.join(' ')), encodeText(right.join(' ')));
}

function entitySet(fact: FactRow): Set<string> {
  return new Set(fact.entities.map((entity) => entity.toLowerCase()));
}

// Two facts about the same subject (their entities overlap) that say different things (their
// vectors are far apart): overlap × (1 − similarity), from `threshold` on.
export function contradictionOf<T extends FactRow>(
  a: T,
  b: T,
  threshold = 0.3,
): Contradiction<T> | null {
  const left = entitySet(a);
  const right = entitySet(b);
  if (left.size === 0 || right.size === 0) return null;
  const shared = [...left].filter((entity) => right.has(entity));
  const overlap = shared.length / new Set([...left, ...right]).size;
  if (overlap < 0.3) return null;
  // What the two facts claim about the shared subject.
  const contentSimilarity = claimSimilarity(a, b);
  const score = overlap * (1 - shift(contentSimilarity));
  if (score < threshold) return null;
  return { a, b, entityOverlap: overlap, contentSimilarity, score, shared: shared.sort() };
}

export function contradictions<T extends FactRow>(
  rows: T[],
  threshold = 0.3,
  limit = 10,
): Contradiction<T>[] {
  const recent = [...rows]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 500);
  const found: Contradiction<T>[] = [];
  for (let i = 0; i < recent.length; i++) {
    for (let j = i + 1; j < recent.length; j++) {
      const hit = contradictionOf(recent[i]!, recent[j]!, threshold);
      if (hit) found.push(hit);
    }
  }
  return found.sort((a, b) => b.score - a.score).slice(0, limit);
}

// A fact saying the same as one already stored (same entities, near-identical content): not
// stored twice, the old one is confirmed instead.
export function sameFact(a: FactRow, b: FactRow): boolean {
  const left = entitySet(a);
  const right = entitySet(b);
  if (left.size !== right.size || [...left].some((entity) => !right.has(entity))) return false;
  if (a.content.trim().toLowerCase() === b.content.trim().toLowerCase()) return true;
  return similarity(encodeText(a.content), encodeText(b.content)) >= 0.9;
}
