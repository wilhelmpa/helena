import { describe, expect, test } from 'bun:test';
import {
  atom,
  bind,
  bundle,
  contradictionOf,
  encodeFact,
  extractEntities,
  fromBytes,
  probe,
  reason,
  refuseFact,
  related,
  rerank,
  sameFact,
  similarity,
  toBytes,
  trustAfter,
  unbind,
  type FactRow,
} from '../index';

function fact(id: number, content: string, entities: string[], trust = 0.5, days = 0): FactRow {
  return {
    id,
    content,
    category: 'general',
    entities,
    trust,
    updatedAt: new Date(Date.now() - days * 86_400_000),
    hrr: encodeFact(content, entities),
  };
}

describe('HRR', () => {
  test('atoms are deterministic and quasi-orthogonal', () => {
    expect(atom('helena')).toEqual(atom('helena'));
    expect(Math.abs(similarity(atom('helena'), atom('hermes')))).toBeLessThan(0.1);
    expect(similarity(atom('helena'), atom('helena'))).toBeCloseTo(1, 5);
  });

  test('unbind(bind(a, b), a) gives b back', () => {
    const a = atom('rolle');
    const b = atom('wert');
    expect(similarity(unbind(bind(a, b), a), b)).toBeCloseTo(1, 5);
  });

  test('a bundle stays similar to its parts', () => {
    const parts = ['a', 'b', 'c'].map((word) => atom(word));
    const sum = bundle(parts);
    for (const part of parts) expect(similarity(sum, part)).toBeGreaterThan(0.3);
    expect(Math.abs(similarity(sum, atom('d')))).toBeLessThan(0.1);
  });

  test('vectors survive the float32 blob', () => {
    const vector = encodeFact('Helena läuft auf Kingston', ['Helena', 'Kingston']);
    const back = fromBytes(toBytes(vector));
    expect(similarity(vector, back)).toBeGreaterThan(0.999);
  });
});

describe('queries', () => {
  const rows = [
    fact(1, 'Der Owner bevorzugt deutsche Antworten', ['Owner']),
    fact(2, 'Halogen läuft auf Kingston an Port 8731', ['Halogen', 'Kingston']),
    fact(3, 'Kingston hat 124 GB Speicher', ['Kingston']),
    fact(4, 'VERVE nutzt Shopify', ['VERVE', 'Shopify']),
  ];

  test('probe finds the facts about an entity', () => {
    const hits = probe('Kingston', rows, 2).map((hit) => hit.fact.id);
    expect(hits.sort()).toEqual([2, 3]);
  });

  test('related finds facts in which the entity has a role', () => {
    expect(related('Shopify', rows, 1)[0]!.fact.id).toBe(4);
  });

  test('reason joins entities: only facts with all of them rank first', () => {
    expect(reason(['Halogen', 'Kingston'], rows, 1)[0]!.fact.id).toBe(2);
  });

  test('rerank weighs trust and age', () => {
    const fresh = fact(10, 'Deploys laufen über deploy.sh', ['deploy.sh'], 0.9);
    const stale = fact(11, 'Deploys laufen über deploy.sh', ['deploy.sh'], 0.9, 365);
    const doubtful = fact(12, 'Deploys laufen über deploy.sh', ['deploy.sh'], 0.2);
    const ranked = rerank('deploy', [
      { fact: stale, rank: 1 },
      { fact: fresh, rank: 1 },
      { fact: doubtful, rank: 1 },
    ]).map((hit) => hit.fact.id);
    expect(ranked).toEqual([10, 11]);
  });
});

describe('trust and contradictions', () => {
  test('feedback moves trust within [0, 1]', () => {
    expect(trustAfter(0.5, 'helpful')).toBeCloseTo(0.55);
    expect(trustAfter(0.5, 'unhelpful')).toBeCloseTo(0.4);
    expect(trustAfter(0.98, 'confirmed')).toBe(1);
    expect(trustAfter(0.05, 'contradicted')).toBe(0);
  });

  test('two different claims about the same subject contradict each other', () => {
    const a = fact(1, 'Der Deploy-Tag ist Montag', ['Deploy-Tag']);
    const b = fact(2, 'Der Deploy-Tag ist Freitag nach dem Standup', ['Deploy-Tag']);
    const c = fact(3, 'Shopify ist der Shop von VERVE', ['Shopify']);
    expect(contradictionOf(a, b)).not.toBeNull();
    expect(contradictionOf(a, c)).toBeNull();
    // An elaboration of the same claim is no contradiction.
    const d = fact(4, 'Halogen läuft auf Kingston', ['Halogen', 'Kingston']);
    const e = fact(5, 'Halogen läuft auf Kingston an Port 8731', ['Halogen', 'Kingston']);
    expect(contradictionOf(d, e)).toBeNull();
  });

  test('the same fact again is recognised', () => {
    const a = fact(1, 'Halogen läuft auf Kingston', ['Halogen', 'Kingston']);
    const b = fact(2, 'halogen läuft auf kingston', ['Kingston', 'Halogen']);
    expect(sameFact(a, b)).toBe(true);
    expect(sameFact(a, fact(3, 'Halogen läuft nicht mehr', ['Halogen']))).toBe(false);
  });
});

describe('entities and the guard', () => {
  test('names, keys, mentions and product names, not every German noun', () => {
    const entities = extractEntities(
      'Patrick Wilhelm will, dass VOL-12 mit Qwen3.8 auf dem Server läuft; siehe @kingston und "Halogen Flash".',
    );
    expect(entities).toContain('Patrick Wilhelm');
    expect(entities).toContain('VOL-12');
    expect(entities).toContain('Qwen3.8');
    expect(entities).toContain('kingston');
    expect(entities).toContain('Halogen Flash');
    expect(entities).not.toContain('Server');
  });

  test('drops leading articles and keeps hyphenated names', () => {
    const entities = extractEntities('Der Deploy-Tag ist Montag, sagt Der Owner.');
    expect(entities).toContain('Deploy-Tag');
    expect(entities.some((name) => /^der\b/i.test(name))).toBe(false);
    expect(entities).not.toContain('Owner');
  });

  test('refuses secrets and long texts', () => {
    expect(refuseFact('Der API-Key ist sk-ant-abcdefghijklmnopqrstuvwx')).not.toBeNull();
    expect(refuseFact('password: hunter22')).not.toBeNull();
    expect(refuseFact('x'.repeat(600))).not.toBeNull();
    expect(refuseFact('Der Owner mag kurze Antworten.')).toBeNull();
  });
});
