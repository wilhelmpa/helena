import { closeDatabase } from '../packages/db/src';
import { backfillRunUsage } from '../apps/api/src/modules/agents/usage/backfill';

const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some((arg) => !['--apply', '--dry-run'].includes(arg)))
  throw new Error('Use --dry-run or --apply');
const ids = [107, 108, 198, 361, 439, 486, 497, 498, 499, 500, 501, 502];
try {
  const runs = await backfillRunUsage(ids, apply);
  console.log(
    JSON.stringify({ mode: apply ? 'apply' : 'dry-run', count: runs.length, runs }, null, 2),
  );
} finally {
  await closeDatabase();
}
