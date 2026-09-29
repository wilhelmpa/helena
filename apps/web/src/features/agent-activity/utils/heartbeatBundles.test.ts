import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { bundleIdleHeartbeats } from './heartbeatBundles';

const entry = (
  id: string,
  agent: number,
  trigger: string | null,
  status = 'success',
  issue = false,
): AgentActivityEntry =>
  ({
    id,
    kind: 'agent-run',
    at: '2026-09-29T08:00:00.000Z',
    status,
    trigger,
    agent: { id: agent, username: `a${agent}`, name: `Agent ${agent}` },
    project: null,
    issue: issue ? { id: 1, identifier: 'T-1', sequenceNumber: 1, title: 'x' } : null,
  }) as unknown as AgentActivityEntry;

const shape = (items: ReturnType<typeof bundleIdleHeartbeats>) =>
  items.map((item) =>
    item.kind === 'entry' ? item.entry.id : `${item.agent?.id}×${item.entries.length}`,
  );

describe('Verlauf: Herzschläge ohne Ergebnis gebündelt', () => {
  test('eine Strecke leerer Herzschläge wird eine Zeile pro Agent', () => {
    const items = bundleIdleHeartbeats([
      entry('h1', 1, 'heartbeat'),
      entry('h2', 2, 'heartbeat'),
      entry('h3', 1, 'heartbeat'),
      entry('h4', 1, 'heartbeat'),
      entry('r1', 3, 'mention', 'success', true),
      entry('h5', 1, 'heartbeat'),
    ]);
    assert.deepEqual(shape(items), ['1×3', 'h2', 'r1', 'h5']);
  });

  test('Herzschläge mit Aufgabe, laufende und fehlgeschlagene bleiben einzeln', () => {
    const items = bundleIdleHeartbeats([
      entry('h1', 1, 'heartbeat', 'success', true),
      entry('h2', 1, 'heartbeat', 'running'),
      entry('h3', 1, 'heartbeat', 'failed'),
      entry('h4', 1, 'heartbeat'),
    ]);
    assert.deepEqual(shape(items), ['h1', 'h2', 'h3', 'h4']);
  });
});
