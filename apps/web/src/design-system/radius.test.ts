import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

// Radii are five steps (tokens.css, docs/ui-framework.md §Radien): sm 6 · md 8 · lg 12 ·
// xl 16 · full. Tailwind classes are checked by eslint; this test covers what eslint does
// not see — `border-radius` in CSS files and `borderRadius` in style objects.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path, ext));
    else if (ext.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const TOKEN = /^var\(--radius-(sm|md|lg|xl|full|field|card|panel|pill)\)$/;
const allowed = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .every((part) => part === '0' || part === '50%' || part === 'inherit' || TOKEN.test(part));

describe('radius steps', () => {
  it('CSS uses only the radius tokens', () => {
    const wrong: string[] = [];
    for (const file of files(srcDir, /\.css$/)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/border(?:-[a-z-]+)?-radius:\s*([^;]+);/g)) {
        if (!allowed(match[1]!)) wrong.push(`${relative(srcDir, file)}: ${match[0]}`);
      }
    }
    assert.deepEqual(wrong, []);
  });

  it('style objects use only the radius tokens', () => {
    const wrong: string[] = [];
    for (const file of files(srcDir, /\.tsx?$/)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/borderRadius:\s*([^,}\n]+)/g)) {
        const value = match[1]!.trim().replace(/^['"`]|['"`]$/g, '');
        // SVG path corners (React Flow's smooth-step edges) are geometry, not a surface.
        if (/^\d+$/.test(value) && /getSmoothStepPath/.test(source)) continue;
        if (!allowed(value)) wrong.push(`${relative(srcDir, file)}: ${match[0]}`);
      }
    }
    assert.deepEqual(wrong, []);
  });

  // Buttons are 8px like every control (owner 29.09.); only chips, filters and status pills
  // are pills. A `.ds-button` that went round again would make buttons and fields disagree.
  it('the design system button has the radius of a field, not of a pill', () => {
    const css = readFileSync(join(srcDir, 'design-system/components.css'), 'utf8');
    const rule = /\.ds-button \{[^}]*\}/.exec(css)?.[0] ?? '';
    assert.match(rule, /border-radius:\s*var\(--radius-field\)/);
  });
});
