// Moves the issue attachments still in the object store into the vault, once.
//
//   bun --env-file=<env> apps/api/src/scripts/attachments-to-vault.ts [--dry-run]
//
// It prints how many attachments are pending first. A run that moved or failed
// anything writes its receipt to $STORAGE_ROOT/receipts (or the working directory);
// a failed attachment makes the exit code 1 and is retried by the next run.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { moveAttachmentsToVault } from '#modules/attachments/vault-migration';

const dryRun = process.argv.includes('--dry-run');
const pending = await moveAttachmentsToVault({ dryRun: true });
console.log(
  `[attachments-to-vault] ${pending.pending} attachments (${pending.pendingBytes} bytes) are in the object store`,
);

if (!dryRun && pending.pending > 0) {
  const receipt = await moveAttachmentsToVault();
  const directory = path.join(process.env.STORAGE_ROOT?.trim() || process.cwd(), 'receipts');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(
    directory,
    `attachments-to-vault-${receipt.startedAt.replace(/[:.]/g, '-')}.json`,
  );
  await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `[attachments-to-vault] moved ${receipt.moved.length}, failed ${receipt.failed.length}; receipt ${file}`,
  );
  if (receipt.failed.length > 0) process.exitCode = 1;
}
process.exit();
