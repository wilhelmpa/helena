import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// The Server area's words come from three places: the API's health lines (a message code per
// line), and the host helper's events (a source and a code each). A code without a message
// shows as a raw id, a source without one breaks the events list; so every one of them has
// to be worded in every locale.

const LOCALES = ['de', 'en', 'es-ES', 'fr', 'pt-BR', 'id', 'ru', 'uk', 'zh-CN', 'ar'];
const WEB = join(__dirname, '../../../..');
const REPO = join(WEB, '../..');
const HOSTD = join(REPO, 'deployment/volition-stack/native/server/hostd/helena_host');

interface ServerMessages {
  health: Record<string, string>;
  events: { source: Record<string, string>; codes: Record<string, string> };
}

const messages = (locale: string) =>
  JSON.parse(readFileSync(join(WEB, 'messages', locale, 'server.json'), 'utf8')) as ServerMessages;

// `code: 'raidOk'`, `code: x ? 'backupLate' : 'backupOk'` — not the values compared with.
function healthCodes(): string[] {
  const codes = new Set<string>();
  for (const file of ['health.ts', 'service.ts']) {
    const source = readFileSync(join(REPO, 'apps/api/src/modules/server', file), 'utf8');
    for (const [, expression] of source.matchAll(/\bcode: ([^,}]+)/g)) {
      for (const match of expression!.matchAll(/(?<![=!]== )'([a-z][A-Za-z]+)'/g)) {
        codes.add(match[1]!);
      }
    }
  }
  return [...codes].sort();
}

function hostdSources(): { sources: string[]; codes: string[] } {
  const sources = new Set<string>();
  const codes = new Set<string>();
  for (const file of readdirSync(HOSTD).filter((name) => name.endsWith('.py'))) {
    const source = readFileSync(join(HOSTD, file), 'utf8');
    for (const match of source.matchAll(/(?:source=|'source': )'([a-z]+)'/g))
      sources.add(match[1]!);
    // code='BackupFailed', and severity, code = 'info', 'BootEntriesMoved'
    for (const match of source.matchAll(/\bcode\s*=\s*(?:'[a-z]+',\s*)?'([A-Z][A-Za-z]+)'/g)) {
      codes.add(match[1]!);
    }
  }
  return { sources: [...sources].sort(), codes: [...codes].sort() };
}

describe('Server messages', () => {
  it('words every health line of the API in every locale', () => {
    const codes = healthCodes();
    assert.ok(codes.includes('espSyncFailed') && codes.includes('bootEntryBroken'), codes.join());
    for (const locale of LOCALES) {
      const health = messages(locale).health;
      assert.deepEqual(
        codes.filter((code) => !(code in health)),
        [],
        `${locale}: health lines without a message`,
      );
    }
  });

  it('names every event source and words every event the host helper records', () => {
    const { sources, codes } = hostdSources();
    assert.deepEqual(sources, ['backup', 'boot', 'esp', 'guard', 'mdadm', 'smartd']);
    for (const code of ['EspSyncSkipped', 'BootEntryRepaired', 'BootEntriesMoved']) {
      assert.ok(codes.includes(code), `${code} not found in ${codes.join()}`);
    }
    for (const locale of LOCALES) {
      const events = messages(locale).events;
      assert.deepEqual(
        sources.filter((source) => !(source in events.source)),
        [],
        `${locale}: event sources without a name`,
      );
      assert.deepEqual(
        codes.filter((code) => !(code in events.codes)),
        [],
        `${locale}: events without a message`,
      );
    }
  });
});
