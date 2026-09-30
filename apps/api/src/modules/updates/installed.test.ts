import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installedCorrection } from './installed';

test('an operator rollback restores the offered update even without vendor access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'volition-installed-test-'));
  const prefixes = { tools: join(root, 'tools'), runtimes: join(root, 'runtimes') };
  try {
    const dir = join(prefixes.tools, 'wetty', '3.3.3');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, '.helena-installed.json'),
      JSON.stringify({ tool: 'wetty', version: '3.3.3' }),
    );
    await symlink('3.3.3', join(prefixes.tools, 'wetty', 'current'));
    expect(
      await installedCorrection(
        { source: 'host-tools', component: 'wetty', installed: '3.3.5', available: '3.3.5' },
        prefixes,
      ),
    ).toEqual({ installed: '3.3.3', updateAvailable: true });
    await writeFile(
      join(dir, '.helena-installed.json'),
      JSON.stringify({ tool: 'node', version: '3.3.3' }),
    );
    expect(
      await installedCorrection(
        { source: 'host-tools', component: 'wetty', installed: '3.3.5', available: '3.3.5' },
        prefixes,
      ),
    ).toBeNull();
    const runtime = join(prefixes.runtimes, 'codex-acp');
    await mkdir(join(runtime, '1.13.1'), { recursive: true });
    await symlink('1.13.1', join(runtime, 'current'));
    expect(
      await installedCorrection(
        { source: 'cli-runtimes', component: 'codex-acp', installed: '2.0.1', available: '2.0.1' },
        prefixes,
      ),
    ).toEqual({ installed: '1.13.1', updateAvailable: true });
    expect(
      await installedCorrection(
        { source: 'host-tools', component: '../wetty', installed: '3.3.5', available: '3.3.5' },
        prefixes,
      ),
    ).toBeNull();
    expect(
      await installedCorrection(
        { source: 'host-tools', component: 'bun', installed: '1.4.2', available: '1.4.3' },
        prefixes,
      ),
    ).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
