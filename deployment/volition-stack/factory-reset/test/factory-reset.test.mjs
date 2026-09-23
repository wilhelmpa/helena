import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APP_UNITS,
  CONFIRM_PHRASE,
  DATA_VOLUMES,
  FactoryResetError,
  EXPECTED_SECRET_BASENAMES,
  POST_RESET_SECRET_BASENAMES,
  PLAN_PUBLIC_TABLES,
  assertAllowedPath,
  assertExactSet,
  dockerDirectoryCleanupArgs,
  parseArgs,
  rewriteEnvironment,
  isAcceptedSecretInventory,
} from '../factory-reset.mjs';

test('dry-run is the default and apply needs the exact phrase', () => {
  assert.deepEqual(parseArgs([]), { apply: false, confirm: '', json: false });
  assert.deepEqual(parseArgs(['--dry-run']), { apply: false, confirm: '', json: false });
  assert.throws(() => parseArgs(['--confirm', CONFIRM_PHRASE]), /requires --apply/);
  assert.throws(() => parseArgs(['--apply', '--confirm', 'yes']), /ERASE_ALL_VOLITION/);
  assert.deepEqual(parseArgs(['--apply', '--confirm', CONFIRM_PHRASE, '--json']), {
    apply: true,
    confirm: CONFIRM_PHRASE,
    json: true,
  });
});

test('environment rewrite rotates required keys and clears integrations', () => {
  const source = [
    'POSTGRES_PASSWORD=old',
    'BETTER_AUTH_SECRET=old-auth',
    'HERMES_URL=https://old.invalid',
    'VAULT_UI_ENABLED=false',
    '',
  ].join('\n');
  const result = rewriteEnvironment(
    source,
    { POSTGRES_PASSWORD: 'new-db', BETTER_AUTH_SECRET: 'new-auth', VAULT_UI_ENABLED: 'true' },
    new Set(['HERMES_URL']),
    { SKIP_PRE_MIGRATION_BACKUP: '1' },
  );
  assert.match(result, /^POSTGRES_PASSWORD=new-db$/m);
  assert.match(result, /^BETTER_AUTH_SECRET=new-auth$/m);
  assert.match(result, /^HERMES_URL=$/m);
  assert.match(result, /^VAULT_UI_ENABLED=true$/m);
  assert.match(result, /^SKIP_PRE_MIGRATION_BACKUP=1$/m);
  assert.doesNotMatch(result, /old-auth|old\.invalid/);
});

test('environment rewrite fails on missing or duplicate required keys', () => {
  assert.throws(() => rewriteEnvironment('A=1\n', { B: '2' }, new Set()), /missing/);
  assert.throws(() => rewriteEnvironment('A=1\nA=2\n', { A: '3' }, new Set()), /Duplicate/);
});

test('exact table set rejects schema drift before truncation', () => {
  assert.doesNotThrow(() => assertExactSet(PLAN_PUBLIC_TABLES, PLAN_PUBLIC_TABLES, 'tables'));
  assert.throws(() => assertExactSet(PLAN_PUBLIC_TABLES.slice(1), PLAN_PUBLIC_TABLES, 'tables'), /changed/);
  assert.throws(() => assertExactSet([...PLAN_PUBLIC_TABLES, 'surprise'], PLAN_PUBLIC_TABLES, 'tables'), /surprise/);
});

test('path guard accepts only a literal allowlisted target', () => {
  const allowed = ['/tmp/factory-test-a', '/tmp/factory-test-b'];
  assert.equal(assertAllowedPath('/tmp/factory-test-a', allowed), '/tmp/factory-test-a');
  assert.throws(() => assertAllowedPath('/tmp/factory-test-a/child', allowed), FactoryResetError);
  assert.throws(() => assertAllowedPath('/home/pw', ['/home/pw']), FactoryResetError);
  assert.throws(() => assertAllowedPath('/', ['/']), FactoryResetError);
});

test('allowlists include the destructive scopes and application writers', () => {
  for (const volume of [
    'itsaplan_db-backups',
    'itsaplan_web-cache',
    'volition-apps_workspace_home',
    'volition-mastra-studio_studio-data',
    'volition-nextcloud-db-alpine-20260921-v2',
  ]) assert.ok(DATA_VOLUMES.includes(volume));
  for (const unit of [
    'volition-provisioning.service',
    'volition-hermes-runner.service',
    'volition-backup.timer',
  ]) assert.ok(APP_UNITS.includes(unit));
});

test('resume accepts only the exact initial or exact post-reset secret inventory', () => {
  assert.equal(isAcceptedSecretInventory(EXPECTED_SECRET_BASENAMES), true);
  assert.equal(isAcceptedSecretInventory([...POST_RESET_SECRET_BASENAMES].reverse()), true);
  assert.equal(isAcceptedSecretInventory(['github_known_hosts']), false);
  assert.equal(isAcceptedSecretInventory([...POST_RESET_SECRET_BASENAMES, 'unexpected_token']), false);
});

test('root-owned fallback mounts only the exact allowlisted directory', () => {
  const args = dockerDirectoryCleanupArgs('/tmp/factory-test-a', ['/tmp/factory-test-a']);
  assert.ok(args.includes('/tmp/factory-test-a:/target'));
  assert.equal(args.filter((value) => value.startsWith('/tmp/')).length, 1);
  assert.throws(
    () => dockerDirectoryCleanupArgs('/tmp/factory-test-a/child', ['/tmp/factory-test-a']),
    /outside the exact factory-reset allowlist/,
  );
});
