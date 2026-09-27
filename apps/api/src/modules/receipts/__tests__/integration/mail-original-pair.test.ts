import { beforeEach, expect, it } from 'bun:test';
import { db, helenaReceipt, helenaReceiptOriginalLink, setSetting } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';
import { intakeMailReceipts, listReceipts, prepareMailReceipts } from '../../receipts';
import { unlinkReceiptOriginal } from '../../originals';
import { backfillMailReceipts } from '../../../../scripts/mail-receipt-backfill';
import { makePdf } from '../pdf';

beforeEach(resetDb);

async function setup(secondRole = 'Receipt', enablePair = true) {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'MAILPAIR', name: 'Synthetic original pairs' }))
    .data!;
  if (enablePair) await setSetting(`receipts.original-pair-intake.team.${project.teamId}`, true);
  const { accountId, inboxId } = await insertMailAccount(project.teamId, project.id);
  const mail = await insertMessage({
    teamId: project.teamId,
    projectId: project.id,
    projectKey: project.key,
    accountId,
    folderId: inboxId,
    subject: 'Invoice and payment receipt',
    attachments: [
      {
        filename: 'invoice.pdf',
        content: makePdf(['Invoice', 'Invoice number: INV-42', 'Total: 23.80 EUR']),
      },
      {
        filename: 'receipt.pdf',
        content: makePdf([
          secondRole,
          'Invoice number: INV-42',
          'Total: 23.80 EUR',
          'Amount paid: 23.80 EUR',
        ]),
      },
    ],
  });
  const input = {
    projectId: project.id,
    teamId: project.teamId,
    messageId: mail.messageRowId,
    actorUserId: owner.userId,
    skipMatching: true,
  };
  const plans = await prepareMailReceipts(input);
  const manifest = [
    {
      messageId: mail.messageRowId,
      accountId,
      projectKey: project.key,
      attachmentIds: plans.map((p) => p.attachmentId!),
      includeBody: false,
    },
  ];
  return { project, input, plans, manifest };
}

it('leaves both new originals independent without an enabled team setting', async () => {
  const f = await setup('Receipt', false);
  await intakeMailReceipts(f.input);
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(0);
  expect(await listReceipts(f.project.id, {})).toHaveLength(2);
});

it('uses the same SHA-bound proof in dry/apply, keeps both IDs and preserves detach on reviewed retries', async () => {
  const f = await setup();
  const dry = await backfillMailReceipts(f.manifest);
  expect(dry.reports[0]!.originalPair).toEqual({
    invoiceSha256: f.plans.find((plan) => plan.filename === 'invoice.pdf')!.sha256,
    receiptSha256: f.plans.find((plan) => plan.filename === 'receipt.pdf')!.sha256,
    invoiceNumber: 'INV-42',
    grossCents: 2380,
    currency: 'EUR',
  });
  expect(await db.select().from(helenaReceipt)).toHaveLength(0);
  const applied = await backfillMailReceipts(f.manifest, true, dry);
  expect(applied.reports[0]!.receiptIds).toHaveLength(2);
  const [link] = await db.select().from(helenaReceiptOriginalLink);
  expect(link).toBeDefined();
  expect(await listReceipts(f.project.id, {})).toHaveLength(1);
  const before = await db.select().from(helenaReceipt).orderBy(helenaReceipt.id);
  const repeated = await backfillMailReceipts(f.manifest, true, dry);
  expect(repeated.reports[0]!.receiptIds).toEqual(applied.reports[0]!.receiptIds);
  expect(await db.select().from(helenaReceiptOriginalLink)).toEqual([link!]);
  await unlinkReceiptOriginal(f.project.id, link!.receiptId, link!.primaryReceiptId);
  await backfillMailReceipts(f.manifest, true, dry);
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(0);
  expect(await listReceipts(f.project.id, {})).toHaveLength(2);
  expect(await db.select().from(helenaReceipt).orderBy(helenaReceipt.id)).toEqual(before);
});

it('serializes two native intakes and writes only one pair of original rows and one relation', async () => {
  const f = await setup();
  const [a, b] = await Promise.all([intakeMailReceipts(f.input), intakeMailReceipts(f.input)]);
  expect(a).toEqual(b);
  expect(a).toHaveLength(2);
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(1);
  expect(await db.select().from(helenaReceipt)).toHaveLength(2);
});

it('never groups when one original was already present before this intake', async () => {
  const f = await setup();
  await intakeMailReceipts({ ...f.input, attachmentIds: [f.plans[0]!.attachmentId!] });
  await intakeMailReceipts(f.input);
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(0);
  expect(await listReceipts(f.project.id, {})).toHaveLength(2);
});

it('keeps two invoice originals separate even when their printed reference and totals agree', async () => {
  const f = await setup('Invoice');
  const dry = await backfillMailReceipts(f.manifest);
  expect(dry.reports[0]!.originalPair).toBeNull();
  await backfillMailReceipts(f.manifest, true, dry);
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(0);
  expect(await listReceipts(f.project.id, {})).toHaveLength(2);
});

it('refuses an altered or missing reviewed pair proof before creating receipts', async () => {
  const f = await setup();
  const dry = await backfillMailReceipts(f.manifest);
  for (const originalPair of [
    null,
    { ...dry.reports[0]!.originalPair!, receiptSha256: '0'.repeat(64) },
  ]) {
    const reviewed = {
      ...dry,
      reports: dry.reports.map((report) => ({ ...report, originalPair })),
    };
    await expect(backfillMailReceipts(f.manifest, true, reviewed)).rejects.toThrow(
      'changed since review',
    );
  }
  expect(
    await db.select().from(helenaReceipt).where(eq(helenaReceipt.projectId, f.project.id)),
  ).toHaveLength(0);
});
