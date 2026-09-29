import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { bundleHeartbeats, bundleTasks } from './heartbeatBundles';

const entry = (
  id: string,
  agent: number,
  trigger: string | null,
  status = 'success',
  issue: string | null = null,
): AgentActivityEntry =>
  ({
    id,
    kind: 'agent-run',
    at: '2026-09-29T08:00:00.000Z',
    status,
    trigger,
    agent: { id: agent, username: `a${agent}`, name: `Agent ${agent}` },
    project: null,
    issue: issue ? { id: 1, identifier: issue, sequenceNumber: 1, title: 'x' } : null,
  }) as unknown as AgentActivityEntry;

const shape = (items: ReturnType<typeof bundleHeartbeats>) =>
  items.map((item) =>
    item.kind === 'entry' ? item.entry.id : `${item.agent?.id}×${item.entries.length}`,
  );

describe('Verlauf: Herzschläge gebündelt', () => {
  test('eine Strecke von Herzschlag-Läufen wird eine Zeile pro Agent', () => {
    const items = bundleHeartbeats([
      entry('h1', 1, 'heartbeat', 'success', 'T-1'),
      entry('h2', 2, 'heartbeat'),
      entry('h3', 1, 'heartbeat', 'success', 'T-1'),
      entry('h4', 1, 'heartbeat', 'success', 'T-2'),
      entry('r1', 3, 'mention', 'success', 'T-3'),
      entry('h5', 1, 'heartbeat'),
    ]);
    assert.deepEqual(shape(items), ['1×3', 'h2', 'r1', 'h5']);
    const bundle = items[0]!;
    assert.equal(bundle.kind, 'heartbeats');
    if (bundle.kind === 'heartbeats') assert.deepEqual(bundleTasks(bundle.entries), ['T-1', 'T-2']);
  });

  test('laufende und fehlgeschlagene Herzschläge bleiben einzeln sichtbar', () => {
    const items = bundleHeartbeats([
      entry('h1', 1, 'heartbeat', 'running'),
      entry('h2', 1, 'heartbeat', 'failed'),
      entry('h3', 1, 'heartbeat'),
    ]);
    assert.deepEqual(shape(items), ['h1', 'h2', 'h3']);
  });
});
