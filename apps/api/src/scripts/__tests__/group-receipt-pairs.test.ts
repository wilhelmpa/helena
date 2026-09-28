import { beforeEach, expect, it } from 'bun:test';
import { db, helenaReceipt, helenaReceiptOriginalLink } from '@repo/db';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { groupReceiptPairs, parseReceiptPairManifest } from '../group-receipt-pairs';

beforeEach(resetDb);

it('validates the exact 26 reviewed pairs and rejects repeated supplementary IDs', () => {
  const pairs = Array.from({ length: 26 }, (_, index) => ({
    primaryReceiptId: index * 2 + 1,
    receiptId: index * 2 + 2,
  }));
  expect(parseReceiptPairManifest({ pairs }).pairs).toEqual(pairs);
  expect(() => parseReceiptPairManifest({ pairs: pairs.slice(1) })).toThrow();
  expect(() => parseReceiptPairManifest({ pairs: [...pairs.slice(0, 25), pairs[0]] })).toThrow();
});

it('rolls back dry runs and conflicts, then applies all pairs idempotently without changing receipts', async () => {
  const owner = await signUpTestUser();
  const project = (
    await authedApi(owner.cookie).projects.post({ key: 'PAIRS', name: 'Fictional pairs' })
  ).data!;
  const rows = await db
    .insert(helenaReceipt)
    .values(
      Array.from({ length: 52 }, (_, index) => ({
        teamId: project.teamId,
        projectId: project.id,
        source: 'upload' as const,
        vaultPath: `Projects/${project.key}/Files/Belege/fiction-${index}.pdf`,
        filename: `fiction-${index}.pdf`,
        contentType: 'application/pdf',
        size: 10,
        sha256: (index + 1).toString(16).padStart(64, '0'),
        details: { checked: true },
      })),
    )
    .returning();
  const before = await db.select().from(helenaReceipt).orderBy(helenaReceipt.id);
  const pairs = Array.from({ length: 26 }, (_, index) => ({
    primaryReceiptId: rows[index * 2]!.id,
    receiptId: rows[index * 2 + 1]!.id,
  }));
  const manifest = { pairs };

  expect(await groupReceiptPairs(manifest)).toMatchObject({
    mode: 'dry',
    total: 26,
    newLinks: 26,
    alreadyLinked: 0,
  });
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(0);
  await expect(
    groupReceiptPairs(
      { pairs: [...pairs.slice(0, 25), { receiptId: rows[0]!.id, primaryReceiptId: rows[1]!.id }] },
      true,
    ),
  ).rejects.toThrow();
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(0);

  expect(await groupReceiptPairs(manifest, true)).toMatchObject({
    mode: 'apply',
    newLinks: 26,
    alreadyLinked: 0,
  });
  expect(await groupReceiptPairs(manifest, true)).toMatchObject({
    mode: 'apply',
    newLinks: 0,
    alreadyLinked: 26,
  });
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(26);
  expect(await db.select().from(helenaReceipt).orderBy(helenaReceipt.id)).toEqual(before);
});
