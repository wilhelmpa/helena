// Moves the chat files from the old folders into the one chat folder of their root (see
// modules/chat-attachments/folder.ts): Projects/<KEY>/Chat Uploads/** and
// Projects/<KEY>/Files/Chat Attachments/** to Projects/<KEY>/Files/Chat/, Home's the same way
// to Home/Files/Chat/. References follow (chat_attachment.vault_path, chat message file
// items), old links resolve through vault_move, emptied old folders are removed.
//
//   bun apps/api/src/scripts/chat-files-to-vault-folder.ts            # dry run
//   bun apps/api/src/scripts/chat-files-to-vault-folder.ts --apply    # move
//
// Prints one JSON line per file, then a summary line. Repeatable: once the old folders are
// gone a run moves nothing. A failed file stays where it is, makes the exit code 1 and is
// retried by the next run.
import { moveChatFilesToFolder } from '#modules/chat-attachments/folder';

const apply = process.argv.includes('--apply');
const report = await moveChatFilesToFolder({ apply });

for (const move of report.moves) {
  console.log(JSON.stringify({ action: apply ? 'moved' : 'would-move', ...move }));
}
for (const folder of report.removedFolders) {
  console.log(JSON.stringify({ action: 'removed-folder', path: folder }));
}
for (const entry of report.skipped) console.log(JSON.stringify({ action: 'skipped', ...entry }));
for (const entry of report.failed) console.log(JSON.stringify({ action: 'failed', ...entry }));
console.log(
  JSON.stringify({
    summary: 'chat-files-to-vault-folder',
    apply,
    moves: report.moves.length,
    removedFolders: report.removedFolders.length,
    skipped: report.skipped.length,
    failed: report.failed.length,
  }),
);
if (report.failed.length > 0) process.exitCode = 1;
process.exit();
