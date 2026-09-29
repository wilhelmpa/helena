import { createHash } from 'node:crypto';

// Holographic reduced representations with phase encoding (Plate 1995; Gayler 2004), the
// principle of Hermes' holographic memory, written anew for Helena. A concept is a vector of
// angles in [0, 2π):
//
//   bind(a, b)   = a + b (mod 2π)   circular convolution; quasi-orthogonal to a and b
//   unbind(m, k) = m − k (mod 2π)   circular correlation; unbind(bind(a, b), a) ≈ b
//   bundle(…)    = circular mean    superposition; holds about √dim items
//   similarity   = mean cos(a − b)  in [−1, 1], ≈ 0 for unrelated vectors
//
// Atoms come from SHA-256 of `word:i`, so the same word has the same vector on every machine
// and after every restart; nothing needs to be stored but the facts' own vectors.

export const HRR_DIM = 1024;
export const ROLE_CONTENT = '__helena_role_content__';
export const ROLE_ENTITY = '__helena_role_entity__';
const TWO_PI = 2 * Math.PI;
const BLOB_PREFIX = Buffer.from('HRR1');

export type Phases = Float64Array;

const atomCache = new Map<string, Phases>();

export function atom(word: string, dim = HRR_DIM): Phases {
  const key = `${dim}:${word}`;
  const cached = atomCache.get(key);
  if (cached) return cached;
  const out = new Float64Array(dim);
  let filled = 0;
  for (let block = 0; filled < dim; block++) {
    const digest = createHash('sha256').update(`${word}:${block}`).digest();
    for (let offset = 0; offset + 1 < digest.length && filled < dim; offset += 2) {
      out[filled++] = digest.readUInt16LE(offset) * (TWO_PI / 65536);
    }
  }
  if (atomCache.size > 20_000) atomCache.clear();
  atomCache.set(key, out);
  return out;
}

function wrap(value: number): number {
  const result = value % TWO_PI;
  return result < 0 ? result + TWO_PI : result;
}

export function bind(a: Phases, b: Phases): Phases {
  const out = new Float64Array(a.length);
  for (let index = 0; index < a.length; index++) out[index] = wrap(a[index]! + b[index]!);
  return out;
}

export function unbind(memory: Phases, key: Phases): Phases {
  const out = new Float64Array(memory.length);
  for (let index = 0; index < memory.length; index++)
    out[index] = wrap(memory[index]! - key[index]!);
  return out;
}

export function bundle(vectors: Phases[]): Phases {
  if (vectors.length === 0) throw new Error('bundle of nothing');
  const dim = vectors[0]!.length;
  const out = new Float64Array(dim);
  for (let index = 0; index < dim; index++) {
    let re = 0;
    let im = 0;
    for (const vector of vectors) {
      re += Math.cos(vector[index]!);
      im += Math.sin(vector[index]!);
    }
    out[index] = wrap(Math.atan2(im, re));
  }
  return out;
}

export function similarity(a: Phases, b: Phases): number {
  let sum = 0;
  for (let index = 0; index < a.length; index++) sum += Math.cos(a[index]! - b[index]!);
  return sum / a.length;
}

// Lower-case words with the punctuation around them removed.
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

export function encodeText(text: string, dim = HRR_DIM): Phases {
  const words = tokens(text);
  return words.length
    ? bundle(words.map((word) => atom(word, dim)))
    : atom('__helena_empty__', dim);
}

// bundle(bind(text, ROLE_CONTENT), bind(entity_i, ROLE_ENTITY) …): unbinding an entity's role
// key from it leaves the content signal, which is how `probe` finds what a fact says about it.
export function encodeFact(content: string, entities: string[], dim = HRR_DIM): Phases {
  const roleContent = atom(ROLE_CONTENT, dim);
  const roleEntity = atom(ROLE_ENTITY, dim);
  return bundle([
    bind(encodeText(content, dim), roleContent),
    ...entities.map((entity) => bind(atom(entity.toLowerCase(), dim), roleEntity)),
  ]);
}

// Stored as float32 behind a four-byte marker (4 KiB for 1,024 angles).
export function toBytes(phases: Phases): Buffer {
  const floats = new Float32Array(phases);
  return Buffer.concat([
    BLOB_PREFIX,
    Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength),
  ]);
}

export function fromBytes(bytes: Uint8Array): Phases {
  const buffer = Buffer.from(bytes);
  if (!buffer.subarray(0, 4).equals(BLOB_PREFIX) || (buffer.length - 4) % 4 !== 0) {
    throw new Error('not an HRR vector');
  }
  const copy = new Uint8Array(buffer.subarray(4));
  return new Float64Array(new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4));
}
