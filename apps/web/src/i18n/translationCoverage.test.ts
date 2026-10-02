import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('all ten languages cover message keys, schema audit actions and translated wake-word text', () => {
  const result = spawnSync('node', ['scripts/check-translations.mjs'], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(result.stdout.trim(), 'Translations: 10 languages, 0 errors');
  assert.equal(result.status, 0, result.stderr);
});
