import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

// The framework's public API (@/design-system) is presentation only: importing it never
// pulls in the API client, services or hooks that read data. A component, a plugin slot
// or a test can use it without a server behind it (docs/ui-framework.md §1).

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function resolve(spec: string, from: string): string | null {
  const base = spec.startsWith('@/')
    ? join(srcDir, spec.slice(2))
    : spec.startsWith('.')
      ? normalize(join(dirname(from), spec))
      : null;
  if (!base) return null;
  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ])
    if (existsSync(candidate)) return candidate;
  return null;
}

function pathTo(file: string, target: RegExp, seen: Set<string>): string[] | null {
  if (seen.has(file)) return null;
  seen.add(file);
  if (target.test(file)) return [file];
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:import|export)\s+(type\s+)?[^;]*?from\s+'([^']+)'/g)) {
    if (match[1]) continue;
    const next = resolve(match[2]!, file);
    const found = next ? pathTo(next, target, seen) : null;
    if (found) return [file, ...found];
  }
  return null;
}

describe('framework barrel', () => {
  it('does not import the API client', () => {
    const chain = pathTo(
      join(srcDir, 'design-system/index.ts'),
      /lib\/api\/core\/client\.ts$/,
      new Set(),
    );
    assert.equal(
      chain,
      null,
      chain ? chain.map((file) => file.slice(srcDir.length + 1)).join(' > ') : 'no chain',
    );
  });
});
