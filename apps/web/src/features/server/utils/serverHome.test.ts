import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HostHealthItem } from '@/lib/api/endpoints/server';
import {
  redServerItems,
  serverGlance,
  serverProblems,
  serverState,
  serverTabOf,
} from './serverHome';

// The machine on Start: its red lines go into "Braucht dich" (with the thermal guard, amber
// on the Server page), each opening its tab; the rest folds into the System tile.

const item = (id: string, state: HostHealthItem['state'], extra: Partial<HostHealthItem> = {}) =>
  ({ id, state, ...extra }) as HostHealthItem;

describe('the machine on Start', () => {
  const items = [
    item('raid:md127', 'critical', { code: 'raidDegraded' }),
    item('backup:last', 'ok', { code: 'backupOk', values: { at: '2026-09-24T20:00:00Z' } }),
    item('fans:guard', 'attention', { code: 'fansRaised' }),
    item('cpu:temperature', 'ok', { values: { temperature: 52 } }),
    item('memory', 'attention'),
  ];

  it('puts every red line and the thermal guard into "Braucht dich"', () => {
    assert.deepEqual(
      redServerItems(items).map((i) => i.id),
      ['raid:md127', 'fans:guard'],
    );
  });

  it('opens each line on its tab', () => {
    assert.equal(serverTabOf('raid:md127'), 'disks');
    assert.equal(serverTabOf('disk:nvme0'), 'disks');
    assert.equal(serverTabOf('esp'), 'disks');
    assert.equal(serverTabOf('backup:restore-test'), 'backup');
    assert.equal(serverTabOf('fans:guard'), 'power');
    assert.equal(serverTabOf('cpu:temperature'), 'power');
    assert.equal(serverTabOf('memory'), 'overview');
  });

  it('counts red and amber lines as problems, and the worst one is the state', () => {
    assert.deepEqual(
      serverProblems(items).map((i) => i.id),
      ['raid:md127', 'fans:guard', 'memory'],
    );
    assert.equal(serverState(items), 'critical');
  });

  it('reads the mirror, the last backup and the CPU for the quiet line', () => {
    const glance = serverGlance([
      item('raid:md127', 'ok'),
      item('backup:last', 'ok', { code: 'backupOk', values: { at: '2026-09-24T20:00:00Z' } }),
      item('cpu:temperature', 'ok', { values: { temperature: 48 } }),
    ]);
    assert.deepEqual(glance, {
      raidOk: true,
      backupAt: '2026-09-24T20:00:00Z',
      cpuTemperature: 48,
    });
    assert.equal(serverGlance(items).raidOk, false);
    assert.deepEqual(serverGlance([]), { raidOk: false, backupAt: null, cpuTemperature: null });
  });
});
