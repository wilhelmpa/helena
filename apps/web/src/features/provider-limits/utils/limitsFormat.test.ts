import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LimitAccount, LimitWindow } from '@/lib/api/endpoints/providerLimits';
import {
  barPercent,
  formatCountdown,
  orderedAccounts,
  orderedWindows,
  windowLabel,
} from './limitsFormat';

function window(fields: Partial<LimitWindow>): LimitWindow {
  return {
    id: 'weekly',
    kind: 'weekly',
    label: null,
    usedPercent: 40,
    currentPercent: 40,
    windowMinutes: 10080,
    resetsAt: null,
    severity: null,
    limited: null,
    state: 'ok',
    agentTokens: null,
    ...fields,
  };
}

describe('limitsFormat', () => {
  it('orders the session before the week and the model windows', () => {
    const ordered = orderedWindows([
      window({ id: 'weekly:fable', kind: 'model', label: 'Fable' }),
      window({ id: 'weekly' }),
      window({ id: 'session', kind: 'session', windowMinutes: 300 }),
    ]);
    assert.deepEqual(
      ordered.map((w) => w.id),
      ['session', 'weekly', 'weekly:fable'],
    );
  });

  it('names windows by kind and length', () => {
    assert.deepEqual(windowLabel(window({ kind: 'session', windowMinutes: 300 })), {
      key: 'session',
      values: { hours: 5 },
    });
    assert.equal(windowLabel(window({ kind: 'model', label: 'Fable' })).key, 'model');
    assert.equal(
      windowLabel(window({ kind: 'model', label: 'Spark', windowMinutes: 300 })).key,
      'modelSession',
    );
    assert.equal(
      windowLabel(window({ kind: 'other', label: 'API key quota' })).values.label,
      'API key quota',
    );
  });

  it('counts down in two units at most', () => {
    assert.equal(formatCountdown((86 * 60 + 20) * 1000, 'en'), '1h 26m');
    assert.equal(formatCountdown(3 * 86_400_000 + 4 * 3_600_000, 'en'), '3d 4h');
    assert.equal(formatCountdown(0, 'en'), '0m');
  });

  it('bounds the bar and puts limited accounts first', () => {
    assert.equal(barPercent(window({ currentPercent: 130 })), 100);
    assert.equal(barPercent(window({ currentPercent: null, usedPercent: null })), 0);
    const account = (id: number, state: LimitAccount['state']) =>
      ({ id, state, provider: 'x' }) as LimitAccount;
    assert.deepEqual(
      orderedAccounts([account(1, 'ok'), account(2, 'limited')]).map((a) => a.id),
      [2, 1],
    );
  });
});
