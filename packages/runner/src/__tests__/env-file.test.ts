import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureEnvFile } from '../hermes-profile';

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('ensureEnvFile', () => {
  it('creates an empty .env readable by the profile alone', async () => {
    const home = await mkdtemp(join(tmpdir(), 'helena-env-'));
    homes.push(home);
    expect(await ensureEnvFile(home)).toBe(true);
    const info = await stat(join(home, '.env'));
    expect(info.size).toBe(0);
    expect(info.mode & 0o777).toBe(0o600);
  });

  it('never touches a .env that exists', async () => {
    const home = await mkdtemp(join(tmpdir(), 'helena-env-'));
    homes.push(home);
    await writeFile(join(home, '.env'), 'KEPT=1\n', { mode: 0o640 });
    expect(await ensureEnvFile(home)).toBe(false);
    expect(await readFile(join(home, '.env'), 'utf8')).toBe('KEPT=1\n');
    expect((await stat(join(home, '.env'))).mode & 0o777).toBe(0o640);
  });
});

describe('ensureSharedLink', () => {
  it('puts the link to the shared .env in place of a file and keeps the file aside', async () => {
    const root = await mkdtemp(join(tmpdir(), 'helena-env-'));
    homes.push(root);
    const shared = join(root, '.env');
    await writeFile(shared, '');
    const home = join(root, 'profile');
    await ensureEnvFile(home);
    expect(await ensureSharedLink(home, '.env', shared)).toBe(true);
    expect(await readlink(join(home, '.env'))).toBe(shared);
    expect(
      (await readdir(join(home, 'run'))).some((name) => name.startsWith('.env.outside-')),
    ).toBe(true);
    expect(await ensureSharedLink(home, '.env', shared)).toBe(false);
  });
});
