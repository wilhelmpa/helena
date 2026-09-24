import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consoleLogger } from '@helena/sdk';
import { registries } from '#shared/helena';
import { LOGIN_STATUS_SOURCE_ID, loginStatusSource } from '../../spool';
import { runtimeLogins } from '../../service';

// The token keeper's status as the health overview reads it
// (docs/helena-decisions/token-keeper.md).

const NOW = new Date('2026-09-24T20:00:00Z');

const status = (fields: Record<string, unknown> = {}) => ({
  version: 1,
  reporter: 'helena-token-keeper',
  checkedAt: '2026-09-24T19:55:00Z',
  intervalSeconds: 600,
  logins: [
    {
      store: 'hermes',
      provider: 'anthropic',
      id: 'abc123',
      label: 'anthropic-oauth-1',
      managed: true,
      state: 'invalid',
      expiresAt: '2026-09-24T17:40:00Z',
      refreshedAt: null,
      error: 'Anthropic token refresh failed: HTTP 400 invalid_grant',
      command: 'sudo -u volition-hermes env HERMES_HOME=/var/lib/volition/hermes hermes auth add anthropic',
    },
    {
      store: 'hermes',
      provider: 'openai-codex',
      id: 'def456',
      label: null,
      managed: true,
      state: 'ok',
      expiresAt: '2026-10-01T09:42:00Z',
      refreshedAt: null,
      error: null,
      command: null,
    },
  ],
  errors: [],
  ...fields,
});

describe('the token keeper status source', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'logins-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const poll = (root: string | undefined) =>
    loginStatusSource(() => root).poll({ now: NOW, log: consoleLogger('test') });

  it('reads each status file of the folder', async () => {
    await writeFile(join(dir, 'hermes.json'), JSON.stringify(status()));
    await writeFile(join(dir, '.hermes.json.123.tmp'), '{');
    await writeFile(join(dir, 'notes.txt'), 'x');
    const [report, ...rest] = await poll(dir);
    expect(rest).toHaveLength(0);
    expect(report).toMatchObject({
      source: LOGIN_STATUS_SOURCE_ID,
      reporter: 'helena-token-keeper',
      checkedAt: '2026-09-24T19:55:00.000Z',
    });
    expect(report!.logins.map((login) => [login.provider, login.state])).toEqual([
      ['anthropic', 'invalid'],
      ['openai-codex', 'ok'],
    ]);
  });

  it('is off without the folder, and skips what it cannot read', async () => {
    expect(await poll(undefined)).toEqual([]);
    expect(await poll(join(dir, 'missing'))).toEqual([]);
    await writeFile(join(dir, 'a.json'), '{ not json');
    await writeFile(join(dir, 'b.json'), JSON.stringify(status({ version: 2 })));
    expect(await poll(dir)).toEqual([]);
  });
});

describe('runtimeLogins', () => {
  let dir: string;
  const saved = process.env.HELENA_LOGIN_STATUS_DIR;
  beforeEach(async () => {
    dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'logins-'));
    process.env.HELENA_LOGIN_STATUS_DIR = dir;
    if (!registries.runtimeLoginSources.has(LOGIN_STATUS_SOURCE_ID)) {
      registries.runtimeLoginSources.register(loginStatusSource());
    }
  });
  afterEach(async () => {
    if (saved === undefined) delete process.env.HELENA_LOGIN_STATUS_DIR;
    else process.env.HELENA_LOGIN_STATUS_DIR = saved;
    await rm(dir, { recursive: true, force: true });
  });

  it('counts the logins the owner has to act on', async () => {
    await writeFile(join(dir, 'hermes.json'), JSON.stringify(status()));
    const health = await runtimeLogins(NOW);
    expect(health.problems).toBe(1);
    expect(health.reports[0]!.stale).toBe(false);
  });

  it('a keeper that stopped writing is stale, and its logins are no problem count', async () => {
    await writeFile(
      join(dir, 'hermes.json'),
      JSON.stringify(status({ checkedAt: '2026-09-24T19:00:00Z' })),
    );
    const health = await runtimeLogins(NOW);
    expect(health.reports[0]!.stale).toBe(true);
    expect(health.problems).toBe(0);
  });
});
