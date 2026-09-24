import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

// The color/size rules in eslint.config.mjs (docs/volition-design-helena-ui.md) run
// as 'warn', not 'error': `bun run lint` is a hard gate other branches merge behind,
// and failing it on a pre-existing backlog these rules did not create would block
// everyone, not just the pages that still need migrating. This test is the actual
// enforcement instead — a ratchet, not a pass/fail snapshot: it fails only if the
// count goes UP, never for having any violations at all. Lower BASELINE as files
// are migrated (grep the eslint output for the file list); raising it needs a
// reason in the commit, same as raising a real budget.
//
// Counted 2026-09-23, after the color-token migration in hub/helena-design's first
// commits (organization/routines/settings/teams status colors) and before any
// further cleanup: 203 (147 arbitrary text/row sizes, ~36 raw Tailwind palette
// colors, 20 raw hex/rgb()).
//
// Lowered 2026-09-24 to 62 by hub/helena-design-2: every bracket text size in features
// and routes moved onto the type scale (text-[10px] x92, text-[11px] x44, …), plus the
// new off-scale rule (text-lg, text-4xl+, font-bold) starting at zero.
const BASELINE = 62;

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface EslintMessage {
  ruleId: string | null;
}
interface EslintResult {
  filePath: string;
  messages: EslintMessage[];
}

function tally(results: EslintResult[]): { total: number; byFile: Map<string, number> } {
  const byFile = new Map<string, number>();
  let total = 0;
  for (const result of results) {
    const count = result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').length;
    if (count === 0) continue;
    total += count;
    byFile.set(result.filePath, count);
  }
  return { total, byFile };
}

function countDesignRuleWarnings(): { total: number; byFile: Map<string, number> } {
  try {
    const raw = execFileSync('bunx', ['eslint', '.', '--format', 'json'], {
      cwd: WEB_ROOT,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 64,
    });
    return tally(JSON.parse(raw) as EslintResult[]);
  } catch (error) {
    // eslint's own exit code is 1 whenever it reports anything, warnings
    // included; execFileSync throws for that even though this is not a
    // failure for this check, which reads the report rather than the exit
    // code — stdout still holds the JSON report to parse.
    const e = error as { stdout?: string };
    if (typeof e.stdout !== 'string') throw error;
    return tally(JSON.parse(e.stdout) as EslintResult[]);
  }
}

describe('design token migration (ratchet)', () => {
  it(
    'raw color/size lint warnings never increase past the recorded baseline',
    { timeout: 60_000 },
    () => {
      const outcome = countDesignRuleWarnings();
      if (outcome.total > BASELINE) {
        const worst = [...outcome.byFile.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([file, count]) => `  ${count}  ${file}`)
          .join('\n');
        assert.fail(
          `Raw color/size lint warnings went from ${BASELINE} to ${outcome.total} — a new ` +
            `raw color or arbitrary size was introduced (or the baseline needs lowering ` +
            `after a real cleanup, in src/design/lintRatchet.test.ts). Worst offenders:\n${worst}`,
        );
      }
      assert.ok(outcome.total <= BASELINE);
    },
  );
});
