// Moves the final frames browser runs kept in the database (a data: URL in
// helena_browser_task_run.final_frame) into the vault, as Projects/<KEY>/Files/Browser/<id>.png
// (Home/Files/Browser for Home's browser); see modules/browser-task/frames.ts. The row then
// points at the file (final_frame_path, final_frame_sha256) and its data: URL is cleared.
//
//   bun apps/api/src/scripts/browser-frames-to-vault.ts            # dry run
//   bun apps/api/src/scripts/browser-frames-to-vault.ts --apply    # move
//
// Prints one JSON line per run, then a summary line. Repeatable: a second --apply moves
// nothing. A failed run keeps its data: URL, makes the exit code 1 and is retried next time.
import { moveFramesToVault } from '#modules/browser-task/frames';

const apply = process.argv.includes('--apply');
const report = await moveFramesToVault({ apply });

if (apply) {
  for (const run of report.migrated) console.log(JSON.stringify({ action: 'moved', ...run }));
} else {
  for (const run of report.pending) console.log(JSON.stringify({ action: 'would-move', ...run }));
}
for (const run of report.invalid) console.log(JSON.stringify({ action: 'invalid-left', ...run }));
for (const run of report.failed) console.log(JSON.stringify({ action: 'failed', ...run }));
console.log(
  JSON.stringify({
    summary: 'browser-frames-to-vault',
    apply,
    pending: report.pending.length,
    migrated: report.migrated.length,
    invalid: report.invalid.length,
    failed: report.failed.length,
  }),
);
if (report.failed.length > 0) process.exitCode = 1;
process.exit();
