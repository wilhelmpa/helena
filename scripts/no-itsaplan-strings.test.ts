import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'bun:test';

// Helena's naming rule (CLAUDE.md "Naming rule"): no "It's a Plan" as a product name
// anywhere a person sees it. The only exception is the attribution AGPL-3.0 requires —
// the upstream copyright notice and one "<product> is a fork of It's a Plan (AGPL-3.0)"
// line, kept in a short, explicit allowlist below. Everywhere else, a new "It's a Plan"
// string is almost always a stray rename that slipped back in and should say "Helena".
//
// This only matches the literal upstream product name phrase (with either apostrophe).
// It never matches the internal identifiers the naming rule explicitly keeps unrenamed —
// the DB name, package scope, chart directory, paths and env vars all spell it
// "itsaplan"/"Itsaplan" with no apostrophe and no space, so they never match this pattern.
const PHRASE = /It[\u2019']s a Plan/g;

const ROOT = join(import.meta.dir, '..');

// Directories never worth walking: dependencies, build output, VCS metadata.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  'out',
  'coverage',
  '.vscode',
  '.idea',
]);

// Only text-ish source/doc extensions; binaries and lockfiles are never in scope.
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.yml',
  '.yaml',
  '.txt',
  '.html',
]);

// Files and directories (repo-relative, forward slashes) allowed to keep the upstream
// name: the AGPL attribution surfaces (LICENSE/NOTICE/README/About), the CHANGELOG
// history, the upstream project's own CLA/contribution process (a legacy artifact of
// the fork, not Helena's own docs), the internal `itsaplan` chart, and the handful of
// docs/locale strings that carry the required "<product> is a fork of It's a Plan
// (AGPL-3.0)" attribution line itself.
const ALLOWLIST = new Set([
  'LICENSE',
  'NOTICE',
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'ICLA.md',
  '.github/workflows/cla.yml',
  'packages/runner/README.md',
  'deployment/volition-stack/fresh-reset/README.md',
  'docs/volition/architecture.md',
  // This file: it names the forbidden phrase in its own comments and error message.
  'scripts/no-itsaplan-strings.test.ts',
]);

const ALLOWLIST_PREFIXES = ['charts/itsaplan/'];

// The nav.basedOn attribution line, translated into every locale.
function isLocaleAttribution(relPath: string): boolean {
  return /^apps\/web\/messages\/[^/]+\/nav\.json$/.test(relPath);
}

function isAllowed(relPath: string): boolean {
  if (ALLOWLIST.has(relPath)) return true;
  if (ALLOWLIST_PREFIXES.some((prefix) => relPath.startsWith(prefix))) return true;
  if (isLocaleAttribution(relPath)) return true;
  return false;
}

function collectFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, out);
      continue;
    }
    const dot = entry.lastIndexOf('.');
    const ext = dot === -1 ? '' : entry.slice(dot);
    if (TEXT_EXTENSIONS.has(ext)) out.push(full);
  }
}

describe('naming rule', () => {
  test('no new "It\'s a Plan" strings outside the attribution allowlist', () => {
    const files: string[] = [];
    collectFiles(ROOT, files);

    const offenders: string[] = [];
    for (const file of files) {
      const relPath = relative(ROOT, file).split('\\').join('/');
      if (isAllowed(relPath)) continue;
      const content = readFileSync(file, 'utf-8');
      const matches = content.match(PHRASE);
      if (matches) offenders.push(`${relPath} (${matches.length}×)`);
    }

    if (offenders.length > 0) {
      throw new Error(
        `Found "It's a Plan" outside the attribution allowlist. Helena's naming rule ` +
          `(CLAUDE.md) forbids the upstream name as a product name anywhere a person sees ` +
          `it; use "Helena" instead, or add the file to the allowlist in ` +
          `scripts/no-itsaplan-strings.test.ts if it is a genuine attribution surface.\n\n` +
          offenders.join('\n'),
      );
    }
    expect(offenders).toEqual([]);
  });
});
