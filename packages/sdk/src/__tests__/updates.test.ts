import { describe, expect, test } from 'bun:test';
import {
  compareVersions,
  createRegistries,
  isNewerVersion,
  isPrerelease,
  normalizeUpdateCandidate,
  updatePriority,
  type UpdateSource,
} from '../index';
import { PluginHost } from '../server';

describe('versions', () => {
  test('compare by semver precedence, any number of parts', () => {
    expect(compareVersions('2.1.290', '2.1.281')).toBeGreaterThan(0);
    expect(compareVersions('v24.21.0', '24.21.0')).toBe(0);
    expect(compareVersions('0.156.1', '0.158.0')).toBeLessThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('2026.9.24', '2026.9.21')).toBeGreaterThan(0);
    // A release is newer than its prereleases; prerelease parts compare numerically.
    expect(compareVersions('1.13.2', '1.13.2-preview.2')).toBeGreaterThan(0);
    expect(compareVersions('0.158.0-alpha.10', '0.158.0-alpha.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0);
    expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBeGreaterThan(0);
    // Build metadata does not count.
    expect(compareVersions('1.2.3+abc', '1.2.3')).toBe(0);
  });

  test('refuse what is not a version', () => {
    expect(compareVersions('3.5.7-1~deb13u2', '3.5.7-1')).toBeNull();
    expect(compareVersions('80cb510bfe', '1.0.0')).toBeNull();
    expect(isNewerVersion('abc', '1.0.0')).toBe(false);
    expect(isNewerVersion(null, '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.1', null)).toBe(false);
    expect(isNewerVersion('0.81.2', '0.81.1')).toBe(true);
    expect(isNewerVersion('0.81.1', '0.81.1')).toBe(false);
  });

  test('know a prerelease', () => {
    expect(isPrerelease('0.158.0-alpha.9')).toBe(true);
    expect(isPrerelease('1.13.1')).toBe(false);
    expect(isPrerelease('nonsense')).toBe(false);
  });
});

describe('candidates', () => {
  test('keep what is usable, bounded', () => {
    const candidate = normalizeUpdateCandidate({
      component: 'claude',
      name: 'Claude Code',
      installed: '2.1.281',
      available: '2.1.290',
      updateAvailable: true,
      security: false,
      sourceUrl: 'https://downloads.claude.ai/claude-code-releases',
      notesUrl: 'javascript:alert(1)',
      applicable: true,
      hint: { de: 'Hinweis', en: 'Hint', evil: 5 },
      detail: 'x'.repeat(1000),
      data: { runtime: 'claude' },
    });
    expect(candidate).toMatchObject({
      component: 'claude',
      updateAvailable: true,
      sourceUrl: 'https://downloads.claude.ai/claude-code-releases',
      notesUrl: null,
      applicable: true,
      hint: { de: 'Hinweis', en: 'Hint' },
      data: { runtime: 'claude' },
    });
    expect(candidate!.detail!.length).toBe(300);
  });

  test('an update needs a version to reach; a bad component is dropped', () => {
    expect(normalizeUpdateCandidate({ component: 'x', updateAvailable: true })).toMatchObject({
      name: 'x',
      updateAvailable: false,
    });
    expect(normalizeUpdateCandidate({ component: '../etc', name: 'x' })).toBeNull();
    expect(normalizeUpdateCandidate({ name: 'x' })).toBeNull();
    expect(normalizeUpdateCandidate('nope')).toBeNull();
  });

  test('order: security first, then risk, then the rest', () => {
    const list = [
      { id: 'current', updateAvailable: false, security: false, risk: null },
      { id: 'low', updateAvailable: true, security: false, risk: 'low' as const },
      { id: 'unrated', updateAvailable: true, security: false, risk: null },
      { id: 'security', updateAvailable: true, security: true, risk: 'low' as const },
      { id: 'high', updateAvailable: true, security: false, risk: 'high' as const },
    ];
    const sorted = [...list].sort((a, b) => updatePriority(b) - updatePriority(a));
    expect(sorted.map((entry) => entry.id)).toEqual([
      'security',
      'high',
      'low',
      'unrated',
      'current',
    ]);
  });
});

describe('update source registry', () => {
  test('is part of the registries and checked against the manifest', async () => {
    expect(createRegistries().updateSources.kind).toBe('update source');
    const host = new PluginHost({ process: 'test' });
    const source: UpdateSource = {
      id: 'acme.cli',
      label: 'Acme CLI',
      kind: 'tool',
      hosts: ['registry.npmjs.org'],
      check: async () => [],
    };
    const good = await host.load(
      { register: (ctx) => void ctx.updateSources.register(source) },
      {
        id: 'acme',
        name: 'Acme',
        version: '1.0.0',
        sdk: '^0.1.0',
        provides: { updateSources: ['acme.cli'] },
      },
    );
    expect(good.status).toBe('loaded');
    expect(host.updateSources.pluginOf('acme.cli')).toBe('acme');
    const bad = await host.load(
      { register: (ctx) => void ctx.updateSources.register({ ...source, id: 'other' }) },
      { id: 'other', name: 'Other', version: '1.0.0', sdk: '^0.1.0', provides: {} },
    );
    expect(bad.status).toBe('failed');
    expect(bad.error).toContain('updateSources');
  });
});
