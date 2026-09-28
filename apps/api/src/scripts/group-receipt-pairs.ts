import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { db, helenaReceipt, helenaReceiptOriginalLink } from '@repo/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { linkReceiptOriginalInTransaction } from '#modules/receipts/originals';

const receiptId = z.number().int().positive().max(2_147_483_647);
const pair = z
  .object({ receiptId, primaryReceiptId: receiptId })
  .strict()
  .refine(
    (item) => item.receiptId !== item.primaryReceiptId,
    'A receipt cannot group with itself.',
  );
const manifestSchema = z.object({ pairs: z.array(pair).length(26) }).strict();

export type ReceiptPairManifest = z.infer<typeof manifestSchema>;
export type GroupReceiptPairsResult = {
  mode: 'dry' | 'apply';
  total: number;
  newLinks: number;
  alreadyLinked: number;
  pairs: { receiptId: number; primaryReceiptId: number; action: 'link' | 'already-linked' }[];
};

export function parseReceiptPairManifest(input: unknown): ReceiptPairManifest {
  const manifest = manifestSchema.parse(input);
  const children = manifest.pairs.map((item) => item.receiptId);
  if (new Set(children).size !== children.length)
    throw new Error('Each supplementary receipt may occur only once.');
  return manifest;
}

class DryRunRollback extends Error {
  constructor(readonly result: GroupReceiptPairsResult) {
    super('Dry run rolled back');
  }
}

/** Uses the same admission rules as the owner API; the dry run rolls back every prospective link. */
export async function groupReceiptPairs(
  input: unknown,
  apply = false,
): Promise<GroupReceiptPairsResult> {
  const manifest = parseReceiptPairManifest(input);
  try {
    return await db.transaction(async (tx) => {
      const pairs: GroupReceiptPairsResult['pairs'] = [];
      for (const item of manifest.pairs) {
        const [child] = await tx
          .select({ projectId: helenaReceipt.projectId })
          .from(helenaReceipt)
          .where(eq(helenaReceipt.id, item.receiptId));
        if (!child) throw new Error(`Receipt ${item.receiptId} does not exist.`);
        const [existing] = await tx
          .select({ primaryReceiptId: helenaReceiptOriginalLink.primaryReceiptId })
          .from(helenaReceiptOriginalLink)
          .where(eq(helenaReceiptOriginalLink.receiptId, item.receiptId));
        // Even an existing link passes through the service, so stale or nested pairs are rejected.
        await linkReceiptOriginalInTransaction(
          tx,
          child.projectId,
          item.receiptId,
          item.primaryReceiptId,
          null,
        );
        pairs.push({
          ...item,
          action: existing ? 'already-linked' : 'link',
        });
      }
      const result: GroupReceiptPairsResult = {
        mode: apply ? 'apply' : 'dry',
        total: pairs.length,
        newLinks: pairs.filter((item) => item.action === 'link').length,
        alreadyLinked: pairs.filter((item) => item.action === 'already-linked').length,
        pairs,
      };
      if (!apply) throw new DryRunRollback(result);
      return result;
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.result;
    throw error;
  }
}

async function readManifest(filename: string): Promise<unknown> {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Invalid manifest file.');
    return JSON.parse(await handle.readFile('utf8'));
  } finally {
    await handle.close();
  }
}

function parseArgs(args: string[]) {
  const inputs = args.filter((arg) => arg.startsWith('--input='));
  const modes = args.filter((arg) => arg === '--dry' || arg === '--apply');
  if (
    inputs.length !== 1 ||
    !inputs[0]!.slice('--input='.length) ||
    modes.length > 1 ||
    args.length !== inputs.length + modes.length
  )
    throw new Error(
      'Usage: bun src/scripts/group-receipt-pairs.ts --input=PAIRS.json [--dry|--apply]',
    );
  return { filename: inputs[0]!.slice('--input='.length), apply: modes[0] === '--apply' };
}

if (import.meta.main) {
  const { filename, apply } = parseArgs(process.argv.slice(2));
  console.log(
    JSON.stringify(await groupReceiptPairs(await readManifest(filename), apply), null, 2),
  );
}
