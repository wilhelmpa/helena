// Gives every public note board that still keeps its canvas in the database its JSON Canvas
// file in Projects/<KEY>/Boards/ (see modules/note-boards/migrate.ts). Private and restricted
// boards stay in the database and are only listed.
//
//   bun apps/api/src/scripts/note-boards-to-vault.ts            # dry run: what would move
//   bun apps/api/src/scripts/note-boards-to-vault.ts --apply    # write the files
//
// Prints one JSON line per board, then a summary line. Repeatable: a second --apply moves
// nothing. A failed board makes the exit code 1 and is retried by the next run.
import { migrateBoardsToVault } from '#modules/note-boards/migrate';

const apply = process.argv.includes('--apply');
const report = await migrateBoardsToVault({ apply });

for (const board of apply ? report.migrated : report.pending) {
  console.log(JSON.stringify({ action: apply ? 'migrated' : 'would-migrate', ...board }));
}
for (const board of report.failed) console.log(JSON.stringify({ action: 'failed', ...board }));
for (const board of report.kept) console.log(JSON.stringify({ action: 'kept-in-db', ...board }));
console.log(
  JSON.stringify({
    summary: 'note-boards-to-vault',
    apply,
    pending: report.pending.length,
    migrated: report.migrated.length,
    failed: report.failed.length,
    keptInDb: report.kept.length,
  }),
);
if (report.failed.length > 0) process.exitCode = 1;
process.exit();
