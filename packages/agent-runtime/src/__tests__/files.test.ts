import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILE_TOOLS } from '../tools/files';

test('search_files accepts a leading case-insensitive flag', async () => {
  const workdir = await mkdtemp(join(tmpdir(), 'volition-file-search-'));
  try {
    await writeFile(join(workdir, 'bericht.txt'), 'Aufbewahrungsfrist: 30 Tage.\n');
    const search = FILE_TOOLS.find((tool) => tool.name === 'search_files')!;
    const result = await search.execute(
      { pattern: '(?i)aufbewahrung' },
      { workdir, signal: new AbortController().signal, env: {} },
    );
    expect(result.isError).not.toBe(true);
    expect(result.text).toContain('bericht.txt:1: Aufbewahrungsfrist: 30 Tage.');
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
