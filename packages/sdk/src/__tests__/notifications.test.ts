import { describe, expect, test } from 'bun:test';
import {
  createRegistries,
  isPushUrgency,
  normalizeAlertItem,
  type AlertSource,
  type NotificationCategory,
} from '../index';
import { PluginHost } from '../server';

describe('notification categories and alert sources', () => {
  test('are registries checked against the manifest', async () => {
    const registries = createRegistries();
    expect(registries.notificationCategories.kind).toBe('notification category');
    expect(registries.alertSources.kind).toBe('alert source');
    const host = new PluginHost({ process: 'test' });
    const category: NotificationCategory = {
      id: 'acme.ups',
      label: { en: 'UPS', de: 'USV' },
      defaultOn: true,
      audience: 'owner',
    };
    const source: AlertSource = {
      id: 'acme.ups',
      category: 'acme.ups',
      collect: async () => [],
    };
    const good = await host.load(
      {
        register(ctx) {
          ctx.notificationCategories.register(category);
          ctx.alertSources.register(source);
        },
      },
      {
        id: 'acme',
        name: 'Acme',
        version: '1.0.0',
        sdk: '^0.1.0',
        provides: { notificationCategories: ['acme.ups'], alertSources: ['acme.ups'] },
      },
    );
    expect(good.status).toBe('loaded');
    expect(host.notificationCategories.pluginOf('acme.ups')).toBe('acme');
    expect(host.alertSources.pluginOf('acme.ups')).toBe('acme');
    const bad = await host.load(
      { register: (ctx) => void ctx.alertSources.register({ ...source, id: 'other' }) },
      { id: 'other', name: 'Other', version: '1.0.0', sdk: '^0.1.0', provides: {} },
    );
    expect(bad.status).toBe('failed');
    expect(bad.error).toContain('alertSources');
  });
});

describe('normalizeAlertItem', () => {
  test('keeps a well-formed problem', () => {
    expect(
      normalizeAlertItem({
        key: 'raid:helena-root',
        subject: { i18n: 'subjects.raid', values: { name: 'helena-root', extra: { no: 1 } } },
        text: { en: 'Degraded', de: 'Unvollständig' },
        href: '/god/server/disks',
        since: '2026-09-25T16:21:00Z',
        graceSeconds: 60.4,
      }),
    ).toEqual({
      key: 'raid:helena-root',
      subject: { i18n: 'subjects.raid', values: { name: 'helena-root' } },
      text: { en: 'Degraded', de: 'Unvollständig' },
      href: '/god/server/disks',
      since: '2026-09-25T16:21:00Z',
      graceSeconds: 60,
    });
  });

  test('drops what it cannot show and links only inside Helena', () => {
    expect(normalizeAlertItem({ key: 'x', subject: 'S' })).toBeNull();
    expect(normalizeAlertItem({ key: ' bad key', subject: 'S', text: 'T' })).toBeNull();
    expect(normalizeAlertItem(null)).toBeNull();
    const outside = normalizeAlertItem({
      key: 'x',
      subject: 'S',
      text: 'T',
      href: 'https://evil.example.com',
    });
    expect(outside?.href).toBeUndefined();
    expect(normalizeAlertItem({ key: 'x', subject: 'S', text: 'T', href: '//evil' })?.href).toBe(
      undefined,
    );
    expect(normalizeAlertItem({ key: 'x', subject: 'S'.repeat(500), text: 'T' })?.subject).toBe(
      'S'.repeat(300),
    );
  });

  test('knows the urgencies of RFC 8030', () => {
    expect(isPushUrgency('high')).toBe(true);
    expect(isPushUrgency('very-low')).toBe(true);
    expect(isPushUrgency('urgent')).toBe(false);
  });
});
