import { describe, expect, test } from 'bun:test';
import {
  createRegistries,
  effectiveUsedPercent,
  normalizeUsageLimitSnapshot,
  snapshotState,
  windowKindOf,
  windowState,
  type UsageLimitSnapshot,
  type UsageLimitWindow,
} from '../index';
import { PluginHost } from '../server';

const NOW = Date.parse('2026-09-24T12:00:00Z');

function window(fields: Partial<UsageLimitWindow>): UsageLimitWindow {
  return {
    id: 'weekly',
    kind: 'weekly',
    label: null,
    usedPercent: 10,
    windowMinutes: 10080,
    resetsAt: '2026-09-27T14:00:00.000Z',
    severity: null,
    limited: null,
    ...fields,
  };
}

function snapshot(fields: Partial<UsageLimitSnapshot>): UsageLimitSnapshot {
  return {
    provider: 'openai-codex',
    account: 'acct-1',
    source: 'hermes',
    login: 'hermes',
    plan: 'pro',
    windows: [window({})],
    extra: null,
    resetCredits: null,
    allowed: null,
    via: 'probe',
    observedAt: '2026-09-24T11:59:00.000Z',
    unavailable: null,
    ...fields,
  };
}

describe('windowKindOf', () => {
  test('classifies by length, not by position', () => {
    expect(windowKindOf(300)).toBe('session');
    expect(windowKindOf(10080)).toBe('weekly');
    expect(windowKindOf(43200)).toBe('monthly');
    expect(windowKindOf(null)).toBe('other');
    expect(windowKindOf(0)).toBe('other');
  });
});

describe('window state', () => {
  test('ok, near and limited by share', () => {
    expect(windowState(window({ usedPercent: 10 }), 80, NOW)).toBe('ok');
    expect(windowState(window({ usedPercent: 80 }), 80, NOW)).toBe('near');
    expect(windowState(window({ usedPercent: 100 }), 80, NOW)).toBe('limited');
    expect(windowState(window({ usedPercent: 50 }), 40, NOW)).toBe('near');
  });

  test("the provider's own reading counts", () => {
    expect(windowState(window({ usedPercent: 5, severity: 'warning' }), 80, NOW)).toBe('near');
    expect(windowState(window({ usedPercent: 5, severity: 'critical' }), 80, NOW)).toBe('near');
    expect(windowState(window({ usedPercent: 5, limited: true }), 80, NOW)).toBe('limited');
  });

  test('a window whose reset passed is empty again', () => {
    const passed = window({ usedPercent: 100, limited: true, resetsAt: '2026-09-24T11:00:00Z' });
    expect(effectiveUsedPercent(passed, NOW)).toBe(0);
    expect(windowState(passed, 80, NOW)).toBe('ok');
  });

  test('unknown without a number', () => {
    expect(windowState(window({ usedPercent: null }), 80, NOW)).toBe('unknown');
  });
});

describe('snapshot state', () => {
  test('is the worst window', () => {
    const state = snapshotState(
      snapshot({ windows: [window({ usedPercent: 10 }), window({ id: 's', usedPercent: 90 })] }),
      80,
      NOW,
    );
    expect(state).toBe('near');
  });

  test('a provider that blocks ordinary use is limited', () => {
    expect(snapshotState(snapshot({ allowed: false }), 80, NOW)).toBe('limited');
  });

  test('a source without numbers is unknown', () => {
    expect(snapshotState(snapshot({ unavailable: 'no_profile_scope', windows: [] }), 80, NOW)).toBe(
      'unknown',
    );
  });
});

describe('normalizeUsageLimitSnapshot', () => {
  test('keeps known fields only and bounds them', () => {
    const value = normalizeUsageLimitSnapshot({
      ...snapshot({}),
      email: 'someone@example.com',
      token: 'secret',
      plan: 'x'.repeat(500),
      windows: [
        { ...window({}), usedPercent: 5000, extra: 'no' },
        { ...window({}), id: 'weekly' },
        { id: 'bad id with spaces', kind: 'weekly' },
        { id: 'session', kind: 'nonsense', usedPercent: Number.NaN, resetsAt: 'not a date' },
      ],
      extra: { kind: 'credits', enabled: true, balance: 12.5, currency: 'USD', secret: 1 },
    });
    expect(value).not.toBeNull();
    expect(JSON.stringify(value)).not.toContain('secret');
    expect(JSON.stringify(value)).not.toContain('example.com');
    expect(value!.plan!.length).toBe(64);
    expect(value!.windows.map((w) => w.id)).toEqual(['weekly', 'session']);
    expect(value!.windows[0]!.usedPercent).toBe(1000);
    expect(value!.windows[1]).toMatchObject({ kind: 'other', usedPercent: null, resetsAt: null });
    expect(value!.extra).toMatchObject({ kind: 'credits', balance: 12.5, currency: 'USD' });
  });

  test('refuses what names no provider, account or time', () => {
    expect(normalizeUsageLimitSnapshot({ ...snapshot({}), account: '' })).toBeNull();
    expect(normalizeUsageLimitSnapshot({ ...snapshot({}), observedAt: 'yesterday' })).toBeNull();
    expect(normalizeUsageLimitSnapshot(null)).toBeNull();
  });
});

describe('usage-limit source registry', () => {
  test('is part of the registries and checked against the manifest', async () => {
    expect(createRegistries().usageLimitSources.kind).toBe('usage-limit source');
    const host = new PluginHost({ process: 'test' });
    const source = { id: 'acme.credits', label: 'Acme', providers: ['acme'] };
    const good = await host.load(
      { register: (ctx) => void ctx.usageLimitSources.register(source) },
      {
        id: 'acme',
        name: 'Acme',
        version: '1.0.0',
        sdk: '^0.1.0',
        provides: { usageLimitSources: ['acme.credits'] },
      },
    );
    expect(good.status).toBe('loaded');
    expect(host.usageLimitSources.pluginOf('acme.credits')).toBe('acme');
    const bad = await host.load(
      { register: (ctx) => void ctx.usageLimitSources.register({ ...source, id: 'other' }) },
      { id: 'other', name: 'Other', version: '1.0.0', sdk: '^0.1.0', provides: {} },
    );
    expect(bad.status).toBe('failed');
    expect(bad.error).toContain('usageLimitSources');
  });
});
