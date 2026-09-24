import { describe, expect, test } from 'bun:test';
import {
  createRegistries,
  normalizeRuntimeLoginReport,
  runtimeLoginNeedsOwner,
  type RuntimeLoginSource,
} from '../index';
import { PluginHost } from '../server';

const login = {
  store: 'hermes',
  provider: 'anthropic',
  id: 'abc123',
  label: 'anthropic-oauth-1',
  managed: true,
  state: 'invalid' as const,
  expiresAt: '2026-09-24T17:40:00Z',
  refreshedAt: null,
  error: 'Anthropic token refresh failed: HTTP 400 invalid_grant',
  command:
    'sudo -u volition-hermes env HOME=/var/lib/volition/hermes HERMES_HOME=/var/lib/volition/hermes ' +
    '/var/lib/volition/hermes/venv/bin/hermes auth add anthropic --type oauth',
};

describe('normalizeRuntimeLoginReport', () => {
  test('keeps the known fields of each login', () => {
    const report = normalizeRuntimeLoginReport(
      {
        reporter: 'helena-token-keeper',
        checkedAt: '2026-09-24T19:50:00Z',
        intervalSeconds: 600,
        logins: [login, { ...login, id: 'def456', state: 'ok', extra: 'dropped' }],
        errors: ['one', 42],
        secret: 'dropped',
      },
      'token-keeper',
    );
    expect(report).toEqual({
      source: 'token-keeper',
      reporter: 'helena-token-keeper',
      checkedAt: '2026-09-24T19:50:00.000Z',
      intervalSeconds: 600,
      logins: [
        { ...login, expiresAt: '2026-09-24T17:40:00.000Z', note: null },
        {
          ...login,
          id: 'def456',
          state: 'ok' as const,
          expiresAt: '2026-09-24T17:40:00.000Z',
          note: null,
        },
      ],
      errors: ['one'],
    });
  });

  test('drops what is malformed', () => {
    expect(normalizeRuntimeLoginReport({ checkedAt: 'soon', logins: [] }, 's')).toBeNull();
    expect(normalizeRuntimeLoginReport(null, 's')).toBeNull();
    const report = normalizeRuntimeLoginReport(
      {
        checkedAt: '2026-09-24T19:50:00Z',
        logins: [
          { ...login, provider: '' },
          { ...login, id: '../x' },
          { ...login, state: 'fine', command: 'rm -rf /\nsudo reboot' },
          { ...login, state: 'fine', id: 'dup' },
          { ...login, state: 'fine', id: 'dup' },
        ],
      },
      's',
    );
    expect(report?.logins.map((entry) => [entry.id, entry.state, entry.command])).toEqual([
      ['abc123', 'unknown', null],
      ['dup', 'unknown', login.command],
    ]);
    expect(report?.intervalSeconds).toBeNull();
  });
});

describe('runtimeLoginNeedsOwner', () => {
  test('a rejected login, or a renewed one that does not work', () => {
    expect(runtimeLoginNeedsOwner({ state: 'invalid', managed: false })).toBe(true);
    expect(runtimeLoginNeedsOwner({ state: 'expired', managed: true })).toBe(true);
    expect(runtimeLoginNeedsOwner({ state: 'error', managed: true })).toBe(true);
    expect(runtimeLoginNeedsOwner({ state: 'expired', managed: false })).toBe(false);
    expect(runtimeLoginNeedsOwner({ state: 'expiring', managed: true })).toBe(false);
    expect(runtimeLoginNeedsOwner({ state: 'ok', managed: true })).toBe(false);
  });
});

describe('runtime login source registry', () => {
  test('is part of the registries and checked against the manifest', async () => {
    expect(createRegistries().runtimeLoginSources.kind).toBe('runtime login source');
    const host = new PluginHost({ process: 'test' });
    const source: RuntimeLoginSource = {
      id: 'acme.logins',
      label: 'Acme',
      poll: () => Promise.resolve([]),
    };
    const good = await host.load(
      { register: (ctx) => void ctx.runtimeLoginSources.register(source) },
      {
        id: 'acme',
        name: 'Acme',
        version: '1.0.0',
        sdk: '^0.1.0',
        provides: { runtimeLoginSources: ['acme.logins'] },
      },
    );
    expect(good.status).toBe('loaded');
    expect(host.runtimeLoginSources.pluginOf('acme.logins')).toBe('acme');
    const bad = await host.load(
      { register: (ctx) => void ctx.runtimeLoginSources.register({ ...source, id: 'other' }) },
      { id: 'other', name: 'Other', version: '1.0.0', sdk: '^0.1.0', provides: {} },
    );
    expect(bad.status).toBe('failed');
    expect(bad.error).toContain('runtimeLoginSources');
  });
});
