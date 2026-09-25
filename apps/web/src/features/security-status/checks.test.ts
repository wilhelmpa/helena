import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CHECK_KEYS, GROUP_KEYS, checkKey, groupKey, sortChecks } from './checks';

const messages = (locale: string) =>
  JSON.parse(
    readFileSync(join(__dirname, '../../../messages', locale, 'serverSecurity.json'), 'utf8'),
  ) as { check: Record<string, string>; group: Record<string, string> };

describe('audit checks', () => {
  it('maps an audit id to its translation key and leaves unknown ones alone', () => {
    assert.equal(checkKey('ssh.password'), 'ssh_password');
    assert.equal(checkKey('net.self_guard'), 'net_self_guard');
    assert.equal(checkKey('something.new'), null);
    assert.equal(groupKey('network'), 'network');
    assert.equal(groupKey('elsewhere'), null);
  });

  it('puts failures first, the most severe on top, passes last', () => {
    const sorted = sortChecks([
      { id: 'a', group: 'ssh', state: 'pass', severity: 'critical', detail: '' },
      { id: 'b', group: 'ssh', state: 'warn', severity: 'low', detail: '' },
      { id: 'c', group: 'ssh', state: 'fail', severity: 'medium', detail: '' },
      { id: 'd', group: 'ssh', state: 'fail', severity: 'critical', detail: '' },
      { id: 'e', group: 'ssh', state: 'skip', severity: 'high', detail: '' },
    ]);
    assert.deepEqual(
      sorted.map((check) => check.id),
      ['d', 'c', 'b', 'e', 'a'],
    );
  });

  it('has a title for every check and group in every locale', () => {
    for (const locale of ['de', 'en', 'es-ES', 'fr', 'pt-BR', 'id', 'ru', 'uk', 'zh-CN', 'ar']) {
      const texts = messages(locale);
      assert.deepEqual(Object.keys(texts.check).sort(), [...CHECK_KEYS].sort(), locale);
      assert.deepEqual(Object.keys(texts.group).sort(), [...GROUP_KEYS].sort(), locale);
    }
  });
});
