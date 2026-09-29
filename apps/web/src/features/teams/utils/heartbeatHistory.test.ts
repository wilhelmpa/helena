import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AgentHeartbeatEvent } from '@/lib/api/endpoints/agents';
import { heartbeatHistory, heartbeatReason } from './heartbeatHistory';

let id = 0;
const event = (outcome: 'queued' | 'skipped', reason: string): AgentHeartbeatEvent => ({
  id: ++id,
  projectId: null,
  checkedAt: `2026-09-29T0${9 - (id % 9)}:00:00.000Z`,
  outcome,
  reason,
  runId: outcome === 'queued' ? id : null,
});

describe('Herzschlag: Verlauf der Prüfungen', () => {
  test('Gründe der API in Worten', () => {
    assert.equal(heartbeatReason('no work'), 'noWork');
    assert.equal(heartbeatReason('outside work hours'), 'outsideHours');
    assert.equal(heartbeatReason('precheck decided: no (#12)'), 'precheck');
    assert.equal(heartbeatReason('run pending'), 'runPending');
    assert.equal(heartbeatReason('assigned task'), 'other');
  });

  test('übersprungene Prüfungen mit gleichem Grund werden gebündelt, Läufe nicht', () => {
    const items = heartbeatHistory([
      event('skipped', 'no work'),
      event('skipped', 'no work'),
      event('skipped', 'no work'),
      event('queued', 'assigned task'),
      event('skipped', 'precheck decided: no'),
      event('skipped', 'no work'),
    ]);
    assert.deepEqual(
      items.map((item) => (item.kind === 'queued' ? 'run' : `${item.reason}×${item.count}`)),
      ['noWork×3', 'run', 'precheck×1', 'noWork×1'],
    );
  });
});
