// Learns, once, what the runs and chat answers before model availability already showed
// (docs/helena-decisions/model-availability.md): a failed run or answer whose provider
// refused its model ("The 'gpt-6-terra' model is not supported when using Codex with a
// ChatGPT account") gets its failure, and the model is recorded as unavailable, so the
// pickers leave it out at once instead of after the next failure. The runner does this for
// every run from the switch on; this reads the ones before it.
//
//   bun --env-file=<api env> src/scripts/learn-model-availability.ts [--days 14]
//   bun --env-file=<api env> src/scripts/learn-model-availability.ts [--days 14] --apply
//
// Without --apply it only prints what it would do. Idempotent: a run that has its failure
// is left alone, and a refusal seen again only moves the time it was last seen.

import { learnFromHistory } from '#modules/model-availability/history';

function args() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--days');
  const days = at >= 0 ? Number(argv[at + 1]) : 14;
  return {
    days: Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 14,
    apply: argv.includes('--apply'),
  };
}

await learnFromHistory(args());
process.exit(0);
