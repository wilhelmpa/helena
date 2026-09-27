import { beforeEach, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { absoluteVaultPath } from '@repo/vault';
import { db, helenaReceipt } from '@repo/db';
import { eq } from 'drizzle-orm';
import { linkReceiptOriginal } from '../../originals';
import { listReceipts } from '../../receipts';
import { sha256 } from '@repo/mail';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { insertMailAccount } from '#tests/helpers/mail';
import { importRawMessage } from '../../../../../../worker/src/mail/import';
import { flagsOf } from '../../../../../../worker/src/mail/store';
import { backfillMailReceipts } from '../../../../scripts/mail-receipt-backfill';
import { extractReceiptFile } from '../../extract';
import type { ReceiptDetailView } from '../../views';
import { receiptMime } from '../fixtures/html-receipt';

beforeEach(resetDb);

it('preserves separate invoice/payment originals through native import, dry/apply/retry and EML extraction', async () => {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'HTMLRECEIPT', name: 'Fictional HTML receipts' }))
    .data!;
  const { accountId } = await insertMailAccount(project.teamId, project.id);
  const originals = [
    receiptMime(),
    receiptMime('Amount paid: 23.80 EUR\nTransaction ID: PAY-42', '', 'fictional-payment'),
  ];
  const entries = [];
  for (const raw of originals) {
    const messageId = await importRawMessage(
      {
        id: accountId,
        teamId: project.teamId,
        projectId: project.id,
        address: 'owner@example.invalid',
        triageEnabled: false,
      },
      raw,
      {
        folderId: null,
        uid: null,
        flags: flagsOf(new Set()),
        internalDate: new Date('2026-09-04'),
        newInboxMail: false,
        requiredProjectId: project.id,
      },
    );
    entries.push({
      messageId,
      accountId,
      projectKey: project.key,
      attachmentIds: [],
      includeBody: true,
    });
  }
  const dry = await backfillMailReceipts(entries);
  expect(dry).toMatchObject({ mode: 'dry-run', new: 2, duplicates: 0, missingFacts: 0 });
  expect(dry.reports[0]!.files[0]).toMatchObject({
    sha256: sha256(originals[0]!),
    bodyProvenance: { part: 'text/html-fallback', fallback: 'accepted' },
  });
  expect(dry.reports[1]!.files[0]).toMatchObject({
    sha256: sha256(originals[1]!),
    bodyProvenance: { part: 'primary-text' },
  });
  const applied = await backfillMailReceipts(entries, true, dry);
  const repeated = await backfillMailReceipts(entries, true, dry);
  expect(repeated.reports.map((report) => report.receiptIds)).toEqual(
    applied.reports.map((report) => report.receiptIds),
  );
  expect(repeated).toMatchObject({ new: 0, existing: 2 });
  expect(applied.reports[0]!.receiptIds[0]).not.toBe(applied.reports[1]!.receiptIds[0]);
  for (const [index, report] of applied.reports.entries()) {
    const response = await app.handle(
      new Request(`http://localhost/projects/${project.key}/receipts/${report.receiptIds[0]}`, {
        headers: { cookie: owner.cookie },
      }),
    );
    expect(response.status).toBe(200);
    const receipt = (await response.json()) as ReceiptDetailView;
    expect(receipt).toMatchObject({ totalGrossCents: 2380, vatCents: index === 0 ? 380 : null });
    if (index === 0) expect(receipt.invoiceNumber).toBe('FICTION-92001');
    else expect(receipt.invoiceNumber).not.toBe('FICTION-92001');
    const file = absoluteVaultPath(receipt.vaultPath);
    expect(await readFile(file)).toEqual(originals[index]!);
    const extracted = await extractReceiptFile(file, 'original.eml', []);
    expect(extracted.grossCents).toBe(receipt.totalGrossCents);
    expect(extracted.vatCents).toBe(receipt.vatCents);
    expect(extracted.details.mailBody).toEqual(receipt.details.mailBody);
  }
  // Explicit grouping is orthogonal to mail-original dedup: neither provenance nor
  // corrected facts are replaced, and a later history retry still returns both original IDs.
  const receiptIds = applied.reports.map((report) => report.receiptIds[0]!);
  const before = await db
    .select()
    .from(helenaReceipt)
    .where(eq(helenaReceipt.projectId, project.id))
    .orderBy(helenaReceipt.id);
  await linkReceiptOriginal(project.id, receiptIds[1]!, receiptIds[0]!, owner.userId);
  const groupedRetry = await backfillMailReceipts(entries, true, dry);
  expect(groupedRetry.reports.map((report) => report.receiptIds)).toEqual(
    applied.reports.map((report) => report.receiptIds),
  );
  expect(
    await db
      .select()
      .from(helenaReceipt)
      .where(eq(helenaReceipt.projectId, project.id))
      .orderBy(helenaReceipt.id),
  ).toEqual(before);
  const displayed = await listReceipts(project.id, {});
  expect(displayed).toHaveLength(1);
  expect(displayed[0]!.originalCount).toBe(2);
});
