import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'bun:test';

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
const BASELINE = 203;

interface EslintMessage {
  ruleId: string | null;
}
interface EslintResult {
  filePath: string;
  messages: EslintMessage[];
}

function countDesignRuleWarnings(): { total: number; byFile: Map<string, number> } {
  const raw = execFileSync('bunx', ['eslint', '.', '--format', 'json'], {
    cwd: `${import.meta.dir}/../../..`,
    encoding: 'utf-8',
    // eslint exits 1 when it reports anything at all (even warn-only); that is
    // not a failure for this check, which reads the report rather than the
    // exit code, so a non-zero exit must not throw here.
    maxBuffer: 1024 * 1024 * 64,
  });
  const results = JSON.parse(raw) as EslintResult[];
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

describe('design token migration (ratchet)', () => {
  test(
    'raw color/size lint warnings never increase past the recorded baseline',
    () => {
      let outcome: ReturnType<typeof countDesignRuleWarnings>;
      try {
        outcome = countDesignRuleWarnings();
      } catch (error) {
        const e = error as { status?: number; stdout?: string };
        // eslint's own exit code is 1 whenever it reports anything, warnings
        // included; execFileSync only throws for that, and stdout still holds
        // the JSON report to parse.
        if (typeof e.stdout !== 'string') throw error;
        const results = JSON.parse(e.stdout) as EslintResult[];
        const byFile = new Map<string, number>();
        let total = 0;
        for (const result of results) {
          const count = result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').length;
          if (count === 0) continue;
          total += count;
          byFile.set(result.filePath, count);
        }
        outcome = { total, byFile };
      }

      if (outcome.total > BASELINE) {
        const worst = [...outcome.byFile.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([file, count]) => `  ${count}  ${file}`)
          .join('\n');
        throw new Error(
          `Raw color/size lint warnings went from ${BASELINE} to ${outcome.total} — a new ` +
            `raw color or arbitrary size was introduced (or the baseline needs lowering ` +
            `after a real cleanup, in src/design/lintRatchet.test.ts). Worst offenders:\n${worst}`,
        );
      }
      expect(outcome.total).toBeLessThanOrEqual(BASELINE);
    },
    60_000,
  );
});
