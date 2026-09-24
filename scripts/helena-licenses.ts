#!/usr/bin/env bun
/**
 * helena-licenses.ts — the third-party license list, generated from the lockfiles.
 *
 * Sources:
 *   bun.lock        through `bun pm licenses --json` (Bun's own reader; it needs the
 *                   installed node_modules for the license fields, so run `bun install` first)
 *   package-lock.json files of the Node services outside the workspace, read directly: a v3
 *                   lockfile carries each package's license
 *
 * Policy (docs/volition-helena-oss.md §3b, docs/helena-decisions/oss-tooling.md):
 *   allowed    permissive licenses: MIT, Apache-2.0, BSD, ISC, MPL-2.0 and their kin
 *   notice     allowed, with a condition worth knowing (weak copyleft, data or font licenses)
 *   review     unknown or unusual: a person looks at it before a release
 *   forbidden  ELv2, SSPL, BUSL, Commons Clause, non-commercial
 * An `OR` expression takes its best alternative, an `AND` expression its worst part.
 *
 *   bun scripts/helena-licenses.ts                  write docs/oss/THIRD-PARTY-LICENSES.md
 *   bun scripts/helena-licenses.ts --check          exit 1 on a forbidden or unreviewed license
 *   bun scripts/helena-licenses.ts --out <file> [--lockfile <package-lock.json> ...]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export type Policy = 'allowed' | 'notice' | 'review' | 'forbidden';

const RANK: Record<Policy, number> = { allowed: 0, notice: 1, review: 2, forbidden: 3 };

const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'MPL-2.0',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'Zlib',
  'Python-2.0',
  'PSF-2.0',
  'WTFPL',
  'X11',
]);

// Allowed, with a condition a release note or the NOTICE should carry.
const NOTICE: Record<string, string> = {
  'LGPL-2.1-only': 'weak copyleft: shipped as a separately replaceable library',
  'LGPL-2.1-or-later': 'weak copyleft: shipped as a separately replaceable library',
  'LGPL-3.0-only': 'weak copyleft: shipped as a separately replaceable library',
  'LGPL-3.0-or-later': 'weak copyleft: shipped as a separately replaceable library',
  'GPL-3.0-only': 'GPL-3.0 is compatible with AGPL-3.0 (section 13)',
  'GPL-3.0-or-later': 'GPL-3.0 is compatible with AGPL-3.0 (section 13)',
  'AGPL-3.0-only': 'same license as Helena',
  'AGPL-3.0-or-later': 'same license as Helena',
  'CC-BY-4.0': 'data under attribution: keep the credit',
  'CC-BY-3.0': 'data under attribution: keep the credit',
  'OFL-1.1': 'font license: the font may not be sold on its own',
  'EPL-2.0': 'weak copyleft: file-level',
};

const FORBIDDEN = [
  /^Elastic-2\.0$/i,
  /^SSPL/i,
  /^BUSL/i,
  /Commons[- ]Clause/i,
  /-NC(-|$)/i,
  /non[- ]?commercial/i,
  /^CC-BY-NC/i,
];

// Loose spellings seen in package.json files, mapped to their SPDX identifier.
const ALIASES: Record<string, string> = {
  'MIT/X11': 'MIT',
  'MIT License': 'MIT',
  'Apache 2.0': 'Apache-2.0',
  'Apache License 2.0': 'Apache-2.0',
  'Apache-2': 'Apache-2.0',
  BSD: 'BSD-3-Clause',
  'BSD*': 'BSD-3-Clause',
  'GPL-3.0': 'GPL-3.0-only',
  'LGPL-3.0': 'LGPL-3.0-only',
  'LGPL-2.1': 'LGPL-2.1-only',
  'AGPL-3.0': 'AGPL-3.0-only',
  'EUPL-1.1+': 'EUPL-1.1',
};

export interface Verdict {
  policy: Policy;
  note?: string;
}

function single(id: string): Verdict {
  const license = ALIASES[id.trim()] ?? id.trim();
  if (!license || license === 'Unknown' || license === 'UNLICENSED') {
    return { policy: 'review', note: 'no license declared' };
  }
  if (FORBIDDEN.some((pattern) => pattern.test(license))) return { policy: 'forbidden' };
  if (ALLOWED.has(license)) return { policy: 'allowed' };
  if (license in NOTICE) return { policy: 'notice', note: NOTICE[license] };
  return { policy: 'review', note: `license ${license} is not on the list` };
}

/** Evaluates an SPDX expression: OR takes the best alternative, AND the worst part. */
export function evaluate(expression: string): Verdict {
  const text = expression.trim().replace(/^\((.*)\)$/, '$1');
  const orParts = splitTop(text, 'OR');
  if (orParts.length > 1) {
    return orParts
      .map(evaluate)
      .reduce((best, next) => (RANK[next.policy] < RANK[best.policy] ? next : best));
  }
  const andParts = splitTop(text, 'AND');
  if (andParts.length > 1) {
    return andParts
      .map(evaluate)
      .reduce((worst, next) => (RANK[next.policy] > RANK[worst.policy] ? next : worst));
  }
  const withException = text.split(/\s+WITH\s+/)[0] ?? text;
  return single(withException);
}

function splitTop(text: string, operator: 'AND' | 'OR'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  const tokens = text.split(/(\(|\)|\s+)/);
  let position = 0;
  for (const token of tokens) {
    if (token === '(') depth += 1;
    else if (token === ')') depth -= 1;
    else if (depth === 0 && token === operator) {
      parts.push(text.slice(start, position).trim());
      start = position + token.length;
    }
    position += token.length;
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

export interface Row {
  name: string;
  version: string;
  license: string;
  source: string;
  scope: 'runtime' | 'development';
}

// ---------------------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------------------

interface BunLicenseEntry {
  name: string;
  versions: string[];
  license: string;
}

async function fromBun(root: string, prod: boolean): Promise<Row[]> {
  const args = ['pm', 'licenses', '--json', ...(prod ? ['--prod'] : [])];
  const proc = Bun.spawn(['bun', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const text = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) {
    throw new Error(`bun pm licenses failed: ${await new Response(proc.stderr).text()}`);
  }
  const grouped = JSON.parse(text) as Record<string, BunLicenseEntry[]>;
  const rows: Row[] = [];
  for (const [license, entries] of Object.entries(grouped)) {
    for (const entry of entries) {
      for (const version of entry.versions) {
        rows.push({
          name: entry.name,
          version,
          license,
          source: 'bun.lock',
          scope: prod ? 'runtime' : 'development',
        });
      }
    }
  }
  return rows;
}

interface PackageLock {
  lockfileVersion?: number;
  packages?: Record<string, { version?: string; license?: string; dev?: boolean; link?: boolean }>;
}

export function fromPackageLock(path: string, root: string): Row[] {
  const lock = JSON.parse(readFileSync(path, 'utf8')) as PackageLock;
  const rows: Row[] = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key || entry.link) continue; // "" is the project itself
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    rows.push({
      name,
      version: entry.version ?? '',
      license: entry.license ?? 'Unknown',
      source: relative(root, path),
      scope: entry.dev ? 'development' : 'runtime',
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------

export function render(rows: Row[], generatedFrom: string[]): string {
  const unique = new Map<string, Row>();
  for (const row of rows) {
    const key = `${row.name}@${row.version}|${row.license}`;
    const seen = unique.get(key);
    if (!seen || (seen.scope === 'development' && row.scope === 'runtime')) unique.set(key, row);
  }
  const all = [...unique.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
  const byLicense = new Map<string, { runtime: number; development: number }>();
  for (const row of all) {
    const count = byLicense.get(row.license) ?? { runtime: 0, development: 0 };
    count[row.scope] += 1;
    byLicense.set(row.license, count);
  }
  const lines: string[] = [];
  lines.push('# Third-party licenses');
  lines.push('');
  lines.push(
    'Generated by `bun scripts/helena-licenses.ts` from ' +
      generatedFrom.map((source) => `\`${source}\``).join(', ') +
      '. Do not edit by hand; run the script again after a dependency change.',
  );
  lines.push('');
  lines.push(
    'Helena itself is licensed under AGPL-3.0 (see LICENSE and NOTICE); `packages/runner` under ' +
      'Apache-2.0. Hermes Agent, the agent runtime Helena drives, is a separate program under the ' +
      'MIT license (© Nous Research) and ships as its own image with its own dependency list.',
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| License | Policy | Runtime | Development only |');
  lines.push('|---|---|---:|---:|');
  const summary = [...byLicense.entries()].sort(
    (a, b) => b[1].runtime - a[1].runtime || a[0].localeCompare(b[0]),
  );
  for (const [license, count] of summary) {
    const verdict = evaluate(license);
    lines.push(`| ${license} | ${verdict.policy} | ${count.runtime} | ${count.development} |`);
  }
  const flagged = all.filter((row) => evaluate(row.license).policy !== 'allowed');
  lines.push('');
  lines.push('## Needs attention');
  lines.push('');
  if (flagged.length === 0) {
    lines.push('Nothing: every package is under an allowed license.');
  } else {
    lines.push('| Package | License | Policy | Scope | Note |');
    lines.push('|---|---|---|---|---|');
    for (const row of flagged) {
      const verdict = evaluate(row.license);
      lines.push(
        `| ${row.name}@${row.version} | ${row.license} | ${verdict.policy} | ${row.scope} | ${verdict.note ?? ''} |`,
      );
    }
  }
  lines.push('');
  lines.push('## All packages');
  lines.push('');
  lines.push('| Package | Version | License | Scope | Source |');
  lines.push('|---|---|---|---|---|');
  for (const row of all) {
    lines.push(`| ${row.name} | ${row.version} | ${row.license} | ${row.scope} | ${row.source} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------

const DEFAULT_LOCKFILES = ['deployment/volition-stack/integration/package-lock.json'];

async function main(argv: string[]): Promise<number> {
  const root = join(dirname(new URL(import.meta.url).pathname), '..');
  const check = argv.includes('--check');
  const outIndex = argv.indexOf('--out');
  const out = outIndex >= 0 ? argv[outIndex + 1]! : join(root, 'docs/oss/THIRD-PARTY-LICENSES.md');
  const lockfiles = argv.flatMap((arg, index) => (argv[index - 1] === '--lockfile' ? [arg] : []));
  const extra = (lockfiles.length > 0 ? lockfiles : DEFAULT_LOCKFILES).map((path) =>
    join(root, path),
  );

  const runtime = await fromBun(root, true);
  const everything = await fromBun(root, false);
  const runtimeKeys = new Set(runtime.map((row) => `${row.name}@${row.version}`));
  const rows = [
    ...runtime,
    ...everything.filter((row) => !runtimeKeys.has(`${row.name}@${row.version}`)),
  ];
  const sources = ['bun.lock'];
  for (const path of extra) {
    if (!existsSync(path)) continue;
    rows.push(...fromPackageLock(path, root));
    sources.push(relative(root, path));
  }

  const blocking = rows.filter((row) => {
    const policy = evaluate(row.license).policy;
    return policy === 'forbidden' || (policy === 'review' && row.scope === 'runtime');
  });
  if (check) {
    for (const row of blocking) {
      console.log(
        `${evaluate(row.license).policy}: ${row.name}@${row.version} (${row.license}) from ${row.source}`,
      );
    }
    console.log(`${rows.length} packages, ${blocking.length} blocking`);
    return blocking.some((row) => evaluate(row.license).policy === 'forbidden')
      ? 1
      : blocking.length > 0
        ? 2
        : 0;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, render(rows, sources));
  console.log(
    `wrote ${relative(root, out)}: ${rows.length} packages, ${blocking.length} to review`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
