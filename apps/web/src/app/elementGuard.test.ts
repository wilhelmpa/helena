import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

// One element, one implementation (owner 30.09.: "Elemente immer gleich", docs/ui-konsistenz-
// refactor.md §4): a status dot, a "…" menu, a tooltip, a loading spinner come from the design
// system, not drawn again by every feature. The inventory of what still deviates is a RATCHET:
// `elementGuard.baseline.json` lists, per rule and file, how many places there are today. A new
// place (or a file that was clean) fails the test; a place that was converted must be taken out of
// the baseline (`UPDATE_ELEMENT_BASELINE=1 bun test …`), so the list only shrinks and ends empty.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselineFile = join(dirname(fileURLToPath(import.meta.url)), 'elementGuard.baseline.json');

export const RULES: Record<string, { pattern: RegExp; use: string }> = {
  'own-dot': {
    pattern:
      /rounded-full[^"'`\n]*\bsize-(?:1|1\.5|2|2\.5)\b[^"'`\n]*\bbg-|\bsize-(?:1|1\.5|2|2\.5)\b[^"'`\n]*rounded-full[^"'`\n]*\bbg-/g,
    use: 'a status dot of its own: use StatusDot (design-system)',
  },
  'own-more-menu': {
    pattern: /\b(?:MoreHorizontal|Ellipsis)\b/g,
    use: 'a "…" of its own: use ActionMenu (row, card) or PageActions (page)',
  },
  'own-spinner': {
    pattern: /\bLoader2\b/g,
    use: 'a spinner of its own: use the loading state of the design system',
  },
  'raw-tooltip': {
    pattern: /<TooltipContent\b/g,
    use: 'a tooltip of its own: use Tip (design-system) or IconButton',
  },
  'raw-date': {
    pattern: /type=["']date["']/g,
    use: 'a browser date field: use the design system date picker',
  },
};

// What the rules do not apply to: the design system itself and the shadcn primitives it wraps.
const isExempt = (name: string) =>
  name.startsWith('design-system/') || name.startsWith('components/ui/');

export function countViolations(source: string, rule: string): number {
  return [...source.matchAll(RULES[rule]!.pattern)].length;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(path);
  }
  return out;
}

function inventory(): Record<string, Record<string, number>> {
  const found: Record<string, Record<string, number>> = {};
  for (const rule of Object.keys(RULES)) found[rule] = {};
  for (const file of sources(srcDir)) {
    const name = relative(srcDir, file).split('\\').join('/');
    if (isExempt(name)) continue;
    const source = readFileSync(file, 'utf8');
    for (const rule of Object.keys(RULES)) {
      const count = countViolations(source, rule);
      if (count > 0) found[rule]![name] = count;
    }
  }
  return found;
}

describe('element guard (ratchet)', () => {
  it('counts what a rule looks for', () => {
    assert.equal(
      countViolations('<span className="size-2 rounded-full bg-red-500" />', 'own-dot'),
      1,
    );
    assert.equal(
      countViolations('<span className="size-4 rounded-full bg-red-500" />', 'own-dot'),
      0,
    );
    assert.equal(
      countViolations("import { MoreHorizontal } from 'lucide-react';", 'own-more-menu'),
      1,
    );
    assert.equal(countViolations('<input type="date" />', 'raw-date'), 1);
    assert.equal(countViolations('<Tip label="x"><IconButton /></Tip>', 'raw-tooltip'), 0);
  });

  it('has no new place and no place left in the baseline that was converted', () => {
    const now = inventory();
    if (process.env.UPDATE_ELEMENT_BASELINE) {
      writeFileSync(baselineFile, `${JSON.stringify(now, null, 2)}\n`);
      return;
    }
    const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as typeof now;
    const problems: string[] = [];
    for (const rule of Object.keys(RULES)) {
      const before = baseline[rule] ?? {};
      const after = now[rule] ?? {};
      for (const file of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const was = before[file] ?? 0;
        const is = after[file] ?? 0;
        if (is > was) problems.push(`${file}: ${rule} ${was} → ${is} (${RULES[rule]!.use})`);
        if (is < was)
          problems.push(
            `${file}: ${rule} ${was} → ${is}, converted: take it out of the baseline (UPDATE_ELEMENT_BASELINE=1)`,
          );
      }
    }
    assert.deepEqual(problems, []);
  });
});
