import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import type { NeedsYouEntry } from '@/extensions/needsYouSources';
import { isRoutineHeartbeat, startCards } from './startCards';

const run = (id: string, status: string, trigger: string | null, issue = false) =>
  ({
    id,
    kind: 'run',
    at: '2026-09-29T08:00:00.000Z',
    status,
    trigger,
    project: { id: 1, key: 'TRADE', name: 'Trading' },
    agent: { id: 7, username: 'trade', name: 'Koordinator TRADE' },
    issue: issue ? { id: 3, identifier: 'TRADE-3', sequenceNumber: 3, title: 'Backtest' } : null,
  }) as unknown as AgentActivityEntry;
const need = (key: string, kind: NeedsYouEntry['kind']): NeedsYouEntry => ({
  key,
  kind,
  at: '',
  title: key,
  detail: '',
});

describe('Startseite: Karten unter dem Chat', () => {
  test('ein fertiger Herzschlag-Lauf gilt als Routine, ein laufender nicht', () => {
    assert.equal(isRoutineHeartbeat(run('a', 'success', 'heartbeat', true)), true);
    assert.equal(isRoutineHeartbeat(run('b', 'running', 'heartbeat', true)), false);
    assert.equal(isRoutineHeartbeat(run('c', 'success', 'mention')), false);
  });

  test('„Braucht dich“ zuerst, dann laufende, dann fertige Arbeit, ohne Herzschlag-Routine', () => {
    const cards = startCards(
      [need('problem:a', 'problem'), need('run:1', 'failure')],
      [
        run('h1', 'success', 'heartbeat'),
        run('h2', 'success', 'heartbeat'),
        run('f1', 'success', 'mention', true),
        run('r1', 'running', 'delegation', true),
      ],
    );
    assert.deepEqual(
      cards.map((card) => `${card.kind}:${card.kind === 'needs' ? card.entry.key : card.entry.id}`),
      ['needs:problem:a', 'running:r1', 'finished:f1'],
    );
  });

  test('höchstens drei Karten', () => {
    const cards = startCards(
      [need('a', 'approval'), need('b', 'approval'), need('c', 'step'), need('d', 'problem')],
      [],
    );
    assert.equal(cards.length, 3);
  });
});
