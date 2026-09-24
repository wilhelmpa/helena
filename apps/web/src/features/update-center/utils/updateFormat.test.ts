import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UpdateAction, UpdateCenter, UpdateItem } from '@/lib/api/endpoints/updateCenter';
import {
  dailyTime,
  groupItems,
  justNow,
  headlineUpdate,
  isBusy,
  runningAction,
  splitItems,
  versionStep,
} from './updateFormat';

let next = 1;
function item(fields: Partial<UpdateItem>): UpdateItem {
  return {
    id: next++,
    source: 'cli-runtimes',
    sourceLabel: { i18n: 'updates.sources.cliRuntimes' },
    kind: 'runtime',
    component: `c${next}`,
    name: 'Component',
    installed: '1.0.0',
    available: '1.1.0',
    updateAvailable: true,
    security: false,
    risk: null,
    breaking: null,
    summary: null,
    highlights: [],
    summaryCurrent: false,
    summaryPending: false,
    summaryModel: null,
    summaryRunId: null,
    summaryError: null,
    summarizedAt: null,
    sourceUrl: null,
    notesUrl: null,
    group: null,
    applicable: true,
    hint: null,
    detail: null,
    error: null,
    availableSince: null,
    checkedAt: '2026-09-24T06:00:00Z',
    ...fields,
  };
}

function action(fields: Partial<UpdateAction>): UpdateAction {
  return {
    id: 1,
    source: 'apt',
    component: 'apt:security',
    name: 'apt (2)',
    components: ['openssl'],
    fromVersion: null,
    toVersion: null,
    state: 'running',
    backupPath: null,
    log: null,
    error: null,
    result: null,
    health: null,
    requestedAt: '2026-09-24T06:00:00Z',
    finishedAt: null,
    ...fields,
  };
}

function center(fields: Partial<UpdateCenter>): UpdateCenter {
  return {
    checkedAt: null,
    helper: { installed: true, error: null },
    counts: { updates: 0, security: 0, applicable: 0 },
    sources: [],
    items: [],
    actions: [],
    settings: {
      enabled: true,
      cron: '0 6 * * *',
      timezone: 'Europe/Berlin',
      summarize: true,
      agentId: null,
      model: null,
      reasoning: 'low',
      claudeChannel: 'latest',
    },
    digest: {
      agentId: null,
      agentName: null,
      model: null,
      reasoning: null,
      agents: [],
      models: [],
    },
    job: {
      lastStartedAt: null,
      lastFinishedAt: null,
      lastStatus: null,
      lastError: null,
      lastTrigger: null,
      nextRunAt: null,
    },
    ...fields,
  };
}

describe('updateFormat', () => {
  it('names a security update first, then the highest risk', () => {
    const high = item({ name: 'High', risk: 'high' });
    const security = item({ name: 'Security', security: true, risk: 'low' });
    const current = item({ name: 'Current', updateAvailable: false, security: true });
    assert.equal(headlineUpdate([high, security, current])?.name, 'Security');
    assert.equal(headlineUpdate([item({ risk: 'low' }), high])?.name, 'High');
    assert.equal(headlineUpdate([current]), null);
  });

  it('splits and groups the list', () => {
    const openssl = item({ source: 'apt', group: 'apt', component: 'openssl' });
    const tzdata = item({ source: 'apt', group: 'apt', component: 'tzdata' });
    const claude = item({ component: 'claude' });
    const bun = item({ component: 'bun', updateAvailable: false });
    const { open, current } = splitItems([openssl, claude, tzdata, bun]);
    assert.deepEqual(
      open.map((entry) => entry.component),
      ['openssl', 'claude', 'tzdata'],
    );
    assert.deepEqual(
      current.map((entry) => entry.component),
      ['bun'],
    );
    const groups = groupItems(open);
    assert.equal(groups.length, 2);
    assert.deepEqual(
      groups[0]!.items.map((entry) => entry.component),
      ['openssl', 'tzdata'],
    );
  });

  it('finds the update running for a component, alone or in a group', () => {
    const openssl = item({ source: 'apt', group: 'apt', component: 'openssl' });
    const state = center({ actions: [action({})] });
    assert.equal(runningAction(state, openssl)?.id, 1);
    assert.equal(runningAction(state, item({ component: 'claude' })), null);
    assert.equal(runningAction(center({ actions: [action({ state: 'done' })] }), openssl), null);
  });

  it('knows when to look again', () => {
    assert.equal(isBusy(undefined), false);
    assert.equal(isBusy(center({})), false);
    assert.equal(isBusy(center({ items: [item({ summaryPending: true })] })), true);
    assert.equal(isBusy(center({ actions: [action({})] })), true);
    assert.equal(isBusy(center({ job: { ...center({}).job, lastStatus: 'running' } })), true);
  });

  it('writes the version step and the daily time', () => {
    assert.equal(versionStep(item({})), '1.0.0 → 1.1.0');
    assert.equal(versionStep(item({ updateAvailable: false, installed: '2.0.0' })), '2.0.0');
    assert.equal(
      versionStep(item({ updateAvailable: false, installed: null, available: null })),
      '–',
    );
    assert.equal(dailyTime('0 6 * * *'), '06:00');
    assert.equal(dailyTime('30 7 * * *'), '07:30');
    assert.equal(dailyTime('0 6 * * 1'), null);
    assert.equal(dailyTime('0 25 * * *'), null);
    assert.equal(justNow('2026-09-24T06:00:00Z', Date.parse('2026-09-24T06:00:30Z')), true);
    assert.equal(justNow('2026-09-24T06:00:00Z', Date.parse('2026-09-24T06:02:00Z')), false);
    assert.equal(justNow('nonsense'), false);
  });
});
