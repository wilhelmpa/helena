import { describe, expect, it } from 'bun:test';
import { IntlMessageFormat } from 'intl-messageformat';
import en from '../messages/en/push.json';
import { LOCALES } from './index';
import { formatPush, formatPushDuration, hasPushMessage } from './push';

function keys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([name, value]) =>
    keys(value, prefix ? `${prefix}.${name}` : name),
  );
}

const SAMPLE = {
  subject: 'S',
  text: 'T.',
  duration: '3',
  agent: 'Home',
  action: 'A',
  where: 'W',
  name: 'md127',
  disk: 'B',
  service: 'Worker',
  provider: 'Claude',
  missing: 1,
  percent: 40,
  spare: 5,
  count: 2,
  temperature: 96,
  mount: '/boot/efi2',
};

describe('push messages', () => {
  const english = keys(en).sort();

  it('has every English message in every language, and each one formats', async () => {
    for (const locale of LOCALES) {
      const table = (await import(`../messages/${locale}/push.json`)).default as unknown;
      expect(keys(table).sort()).toEqual(english);
      for (const key of english) {
        const message = key
          .split('.')
          .reduce<unknown>(
            (node, part) => (node as Record<string, unknown>)[part],
            table,
          ) as string;
        // Parses as ICU MessageFormat and formats with every value it could ask for.
        const out = new IntlMessageFormat(message, locale).format(SAMPLE);
        expect(typeof out).toBe('string');
      }
    }
  });

  it('writes a message in the device language and falls back to English', () => {
    expect(formatPush('de', 'alert.emergencies.open', { subject: 'Spiegel md127' })).toBe(
      'Notfall: Spiegel md127',
    );
    expect(formatPush('xx', 'alert.emergencies.open', { subject: 'Mirror md127' })).toBe(
      'Emergency: Mirror md127',
    );
    expect(formatPush('de', 'no.such.key')).toBe('no.such.key');
    expect(hasPushMessage('health.raidDegraded')).toBe(true);
    expect(hasPushMessage('health.nope')).toBe(false);
  });

  it('follows each language’s plural rules', () => {
    expect(formatPush('de', 'health.raidDegraded', { name: 'md127', missing: 1 })).toContain(
      'eine Platte fehlt',
    );
    expect(formatPush('ru', 'duration.hours', { count: 3 })).toBe('3 часа');
    expect(formatPush('ru', 'duration.hours', { count: 5 })).toBe('5 часов');
  });

  it('rounds a duration to what a phone shows', () => {
    expect(formatPushDuration('de', 30_000)).toBe('1 Minute');
    expect(formatPushDuration('de', 25 * 60_000)).toBe('25 Minuten');
    expect(formatPushDuration('de', 3 * 3_600_000)).toBe('3 Stunden');
    expect(formatPushDuration('en', 5 * 86_400_000)).toBe('5 days');
  });
});
