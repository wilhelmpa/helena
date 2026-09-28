import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

// Every route inside the app frame renders the page template (docs/ui-framework.md,
// owner O10/O12/O46–O48: one template, so pages cannot drift apart again). The test
// follows each page.tsx through its local imports (a few levels) and accepts it when it
// reaches <Page …> from the design system (or SectionPageView, which is a Page), or when
// the route only redirects. Pages outside the frame (sign-in, a public share link, the
// status fixture) are listed below with their reason.

const appDir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(appDir, '..');

const OUTSIDE_THE_FRAME: Record<string, string> = {
  'login/page.tsx': 'sign-in screen (AuthFrame)',
  'register/page.tsx': 'sign-in screen (AuthFrame)',
  'forgot-password/page.tsx': 'sign-in screen (AuthFrame)',
  'reset-password/page.tsx': 'sign-in screen (AuthFrame)',
  'invite/[token]/page.tsx': 'sign-in screen (AuthFrame)',
  'oauth/consent/page.tsx': 'OAuth consent screen (AuthFrame)',
  'share/issue/[token]/page.tsx': 'public share link (PublicShareFrame)',
  'share/view/[token]/page.tsx': 'public share link (PublicShareFrame)',
  'status-matrix-fixture/page.tsx': 'test fixture of the status matrix',
  '[identifier]/page.tsx': 'resolves a task identifier and redirects',
  'issue/[issueId]/page.tsx': 'resolves a task id and redirects',
};

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...pages(path));
    else if (name === 'page.tsx') out.push(path);
  }
  return out;
}

function resolveImport(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(srcDir, spec.slice(2));
  else if (spec.startsWith('.')) base = join(dirname(from), spec);
  else return null;
  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const TEMPLATE = /<Page[\s>]|<SectionPageView[\s>]|<KnowledgeFrame[\s>]/;
const JSX_RETURN = /\breturn\s*\(?\s*<[A-Za-z>]/;
const REDIRECT = /\bredirect\(|\brouter\.replace\(|<Redirect/;

function usesTemplate(file: string, depth: number, seen: Set<string>): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  if (TEMPLATE.test(source)) return true;
  // A component that only sends the visitor on (CyclesRedirect, InitiativesRedirect).
  if (/Redirect\.tsx$/.test(file) && REDIRECT.test(source)) return true;
  // Follow the page's own components only (features, files next to it), not the shared
  // building blocks a page happens to use somewhere inside.
  if (depth === 0) return false;
  // The components this file renders (JSX tags), resolved through its imports.
  const rendered = new Set([...source.matchAll(/<([A-Z]\w*)/g)].map((match) => match[1]!));
  const specs: string[] = [];
  for (const match of source.matchAll(
    /import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*'([^']+)'/g,
  )) {
    const names = [
      match[1],
      ...(match[2] ?? '').split(',').map((part) =>
        part
          .trim()
          .split(/\s+as\s+/)
          .pop(),
      ),
    ].filter(Boolean) as string[];
    if (names.some((name) => rendered.has(name))) specs.push(match[3]!);
  }
  return specs.some((spec) => {
    if (!/^(@\/features\/|\.)/.test(spec)) return false;
    const resolved = resolveImport(spec, file);
    return resolved ? usesTemplate(resolved, depth - 1, seen) : false;
  });
}

describe('page template', () => {
  it('every page inside the frame renders <Page>', () => {
    const missing: string[] = [];
    for (const file of pages(appDir)) {
      const route = relative(appDir, file);
      if (OUTSIDE_THE_FRAME[route]) continue;
      const source = readFileSync(file, 'utf8');
      // Only sends the visitor on: a redirect and no JSX at all.
      if (REDIRECT.test(source) && !JSX_RETURN.test(source)) continue;
      if (!usesTemplate(file, 3, new Set())) missing.push(route);
    }
    assert.deepEqual(missing, [], `pages without the page template:\n${missing.join('\n')}`);
  });
});
