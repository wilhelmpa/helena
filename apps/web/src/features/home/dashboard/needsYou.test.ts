import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AGED_AFTER_MS, pruneDismissed, splitNeedsYou, type NeedsYouSource } from './needsYou';

// "Braucht dich" keeps decisions until they are made, and lets a failure go: hidden by the
// reader, or counted instead of listed once it is older than a day (owner, 2026-09-24: two
// failed chat answers from a switch-over sat on Start for good).

const NOW = Date.parse('2026-09-24T20:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 3_600_000;

const approval = (id: number, at: string): NeedsYouSource => ({
  key: `approval:${id}`,
  kind: 'approval',
  at,
});
const failure = (id: string, at: string): NeedsYouSource => ({ key: id, kind: 'failure', at });

describe('splitNeedsYou', () => {
  it('lists decisions first, the oldest waiting first, then failures newest first', () => {
    const split = splitNeedsYou(
      [
        failure('run:1', ago(3 * HOUR)),
        approval(2, ago(10 * 60_000)),
        failure('chat:5', ago(HOUR)),
        approval(1, ago(2 * HOUR)),
      ],
      new Set(),
      NOW,
    );
    assert.deepEqual(
      split.items.map((item) => item.key),
      ['approval:1', 'approval:2', 'chat:5', 'run:1'],
    );
    assert.equal(split.aged, 0);
    assert.equal(split.hidden, 0);
  });

  it('counts a failure older than a day instead of listing it', () => {
    const split = splitNeedsYou(
      [failure('chat:1', ago(AGED_AFTER_MS + 60_000)), failure('run:2', ago(5 * HOUR))],
      new Set(),
      NOW,
    );
    assert.deepEqual(
      split.items.map((item) => item.key),
      ['run:2'],
    );
    assert.equal(split.aged, 1);
  });

  it('never ages or hides a decision', () => {
    const old = approval(9, ago(3 * AGED_AFTER_MS));
    const split = splitNeedsYou([old], new Set(['approval:9']), NOW);
    assert.deepEqual(split.items, [old]);
    assert.equal(split.aged, 0);
    assert.equal(split.hidden, 0);
  });

  it('leaves out the failures the reader hid, and counts them', () => {
    const split = splitNeedsYou(
      [failure('run:1', ago(HOUR)), failure('run:2', ago(2 * HOUR))],
      new Set(['run:1']),
      NOW,
    );
    assert.deepEqual(
      split.items.map((item) => item.key),
      ['run:2'],
    );
    assert.equal(split.hidden, 1);
  });

  it('ages nothing before the clock is known (the first render matches the server)', () => {
    const split = splitNeedsYou([failure('run:1', ago(3 * AGED_AFTER_MS))], new Set(), null);
    assert.equal(split.items.length, 1);
    assert.equal(split.aged, 0);
  });
});

describe('pruneDismissed', () => {
  it('keeps only the hidden keys of failures still reported', () => {
    assert.deepEqual(pruneDismissed(['run:1', 'chat:2', 'run:3'], ['run:3', 'run:1']), [
      'run:1',
      'run:3',
    ]);
  });
});
