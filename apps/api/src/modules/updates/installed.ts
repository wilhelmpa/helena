import { readFile, readlink, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isNewerVersion } from '@helena/sdk';
import { plainVersion } from './sources/vendors';

type InstalledRow = {
  source: string;
  component: string;
  installed: string | null;
  available: string | null;
};

export async function installedCorrection(
  row: InstalledRow,
  prefixes = {
    runtimes: process.env.HELENA_RUNTIME_PREFIX?.trim() || '/opt/helena/runtimes',
    tools: process.env.VOLITION_HOST_TOOLS_PREFIX?.trim() || '/opt/helena/host-tools',
  },
) {
  const supported =
    row.source === 'cli-runtimes'
      ? ['claude', 'codex', 'claude-agent-acp', 'codex-acp']
      : row.source === 'host-tools'
        ? ['bun', 'node', 'wetty', 'code-server', 'uv', 'kasmvnc']
        : [];
  if (!supported.includes(row.component)) return null;
  const current = join(
    row.source === 'cli-runtimes' ? prefixes.runtimes : prefixes.tools,
    row.component,
    'current',
  );
  try {
    const actual = await realpath(current);
    const version = plainVersion(basename(await readlink(current)));
    if (!version || basename(actual) !== version) return null;
    if (row.source === 'host-tools') {
      const record = JSON.parse(
        await readFile(join(current, '.helena-installed.json'), 'utf8'),
      ) as { tool?: unknown; version?: unknown };
      if (record.tool !== row.component || record.version !== version) return null;
    }
    return version === row.installed
      ? null
      : { installed: version, updateAvailable: isNewerVersion(row.available, version) };
  } catch {
    return null;
  }
}
