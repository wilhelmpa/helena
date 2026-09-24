import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HostHealthItem, PowerStatus } from '@/lib/api/endpoints/server';
import {
  availableTabs,
  fansChoice,
  formatDiskSize,
  formatMemory,
  healthStatus,
  healthValues,
  orderedHealth,
  parentPath,
  pathSteps,
  restoreTarget,
  worstState,
} from './serverFormat';

const item = (id: string, state: HostHealthItem['state']): HostHealthItem => ({ id, state });

describe('serverFormat', () => {
  it('offers the tabs the host has, updates only when the update center is built', () => {
    const overview = {
      areas: [
        { area: 'overview', available: true },
        { area: 'disks', available: true },
        { area: 'backup', available: false },
        { area: 'power', available: true },
      ],
    };
    assert.deepEqual(availableTabs(overview, false), ['overview', 'disks', 'power']);
    assert.deepEqual(availableTabs(overview, true), ['overview', 'disks', 'power', 'updates']);
    assert.deepEqual(availableTabs(undefined, false), []);
  });

  it('puts problems first and names the worst state', () => {
    const items = [item('a', 'ok'), item('b', 'attention'), item('c', 'critical'), item('d', 'ok')];
    assert.deepEqual(
      orderedHealth(items).map((entry) => entry.id),
      ['c', 'b', 'a', 'd'],
    );
    assert.equal(worstState(items.map((entry) => entry.state)), 'critical');
    assert.equal(worstState([]), 'unknown');
    assert.equal(healthStatus('attention'), 'waiting');
    assert.equal(healthStatus('critical'), 'danger');
  });

  it('prints disks the vendors’ way and memory the firmware’s way', () => {
    assert.equal(formatDiskSize(2_000_398_934_016, 'en'), '2 TB');
    assert.equal(formatMemory(103_079_215_104, 'en'), '96 GB');
    assert.equal(formatMemory(33_277_624_320, 'en'), '31 GB');
    assert.equal(formatDiskSize(null, 'en'), '–');
  });

  it('formats the values of a health line', () => {
    const values = healthValues(
      {
        id: 'raid',
        state: 'attention',
        values: { name: 'helena-root', percent: 26.5, temperature: 49 },
      },
      'en',
    );
    assert.equal(values.name, 'helena-root');
    assert.equal(values.percent, '26.5%');
    assert.equal(values.temperature, '49°C');
  });

  it('reads the fans as one choice, the owner’s first', () => {
    const power = (desired: PowerStatus['desired'], fans: PowerStatus['fans']) =>
      ({ desired, fans }) as PowerStatus;
    assert.equal(fansChoice(power({ fans: { mode: 'fixed', level: 5 } }, null)), 5);
    assert.equal(fansChoice(power({ fans: { mode: 'auto', level: null } }, null)), 'auto');
    assert.equal(fansChoice(power({}, { mode: 'fixed', level: 3 })), 3);
    assert.equal(fansChoice(power({}, { mode: 'mixed', level: null })), null);
  });

  it('walks folder paths and knows where a copy lands', () => {
    assert.deepEqual(
      pathSteps('/home/owner/Projekte').map((step) => step.path),
      ['/', '/home', '/home/owner', '/home/owner/Projekte'],
    );
    assert.equal(parentPath('/home/owner'), '/home');
    assert.equal(parentPath('/home'), '/');
    assert.equal(restoreTarget('/home/owner/Projekte/x', '/home/owner'), 'home');
    assert.equal(restoreTarget('/home/ownerx/y', '/home/owner'), 'restoreDir');
    assert.equal(restoreTarget('/etc/nginx', null), 'restoreDir');
  });
});
