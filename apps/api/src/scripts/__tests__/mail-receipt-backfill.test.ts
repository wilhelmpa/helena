import { beforeEach, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { db, helenaReceipt, mailMessage } from '@repo/db';
import { putObject } from '@repo/storage';
import { absoluteVaultPath } from '@repo/vault';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';
import { intakeMailReceipts } from '#modules/receipts/receipts';
import { backfillMailReceipts } from '../mail-receipt-backfill';

beforeEach(resetDb);

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'BFR', name: 'Backfill receipts' })).data!;
  const { accountId, inboxId } = await insertMailAccount(project.teamId, project.id);
  const manifest = [];
  for (const number of [1, 2]) {
    const mail = await insertMessage({
      teamId: project.teamId,
      accountId,
      folderId: inboxId,
      projectId: project.id,
      projectKey: project.key,
      subject: `Payment receipt ${number}`,
      text: `Invoice number: INV-${number}\nAmount paid: 12.00 EUR`,
      sentAt: new Date('2026-09-05'),
      raw: `Subject: Payment receipt ${number}\r\n\r\nAmount paid: 12.00 EUR\r\n`,
    });
    manifest.push({
      messageId: mail.messageRowId,
      accountId,
      projectKey: project.key,
      attachmentIds: [],
      includeBody: true,
    });
  }
  const reviewed = await backfillMailReceipts(manifest);
  return { manifest, reviewed, project };
}

it('requires the complete reviewed dry-run and preserves exact receipt IDs on repeated apply', async () => {
  const { manifest, reviewed } = await setup();
  await expect(backfillMailReceipts(manifest, true)).rejects.toThrow('requires a reviewed');
  await expect(
    backfillMailReceipts(manifest, true, { ...reviewed, reports: reviewed.reports.slice(1) }),
  ).rejects.toThrow('manifest scope');
  await expect(backfillMailReceipts(manifest.slice(1), true, reviewed)).rejects.toThrow(
    'manifest scope',
  );
  expect(await db.select().from(helenaReceipt)).toHaveLength(0);
  const applied = await backfillMailReceipts(manifest, true, reviewed);
  const repeated = await backfillMailReceipts(manifest, true, reviewed);
  expect(repeated.new).toBe(0);
  expect(repeated.existing).toBe(2);
  expect(repeated.reports.map((report) => report.receiptIds)).toEqual(
    applied.reports.map((report) => report.receiptIds),
  );
  const final = await backfillMailReceipts(manifest, false, reviewed);
  expect(final).toMatchObject({ new: 0, duplicates: 0, existing: 2 });
  expect(
    final.reports.every((report) => report.files.every((file) => file.receiptId !== null)),
  ).toBe(true);
  expect(await db.select().from(helenaReceipt)).toHaveLength(2);
});

it('checks the entire batch against review before writing the first receipt', async () => {
  const { manifest, reviewed } = await setup();
  const [message] = await db
    .select()
    .from(mailMessage)
    .where(eq(mailMessage.id, manifest[1]!.messageId));
  await putObject(message!.rawKey, Buffer.from('changed raw original'), 'message/rfc822');
  await expect(backfillMailReceipts(manifest, true, reviewed)).rejects.toThrow(
    'changed since review',
  );
  expect(await db.select().from(helenaReceipt)).toHaveLength(0);
});

it('rejects thread reassignment even when the project and original bytes still match', async () => {
  const { manifest, reviewed } = await setup();
  await db
    .update(mailMessage)
    .set({ threadId: reviewed.reports[1]!.threadId })
    .where(eq(mailMessage.id, manifest[0]!.messageId));
  await expect(backfillMailReceipts(manifest, true, reviewed)).rejects.toThrow(
    'changed since review',
  );
  expect(await db.select().from(helenaReceipt)).toHaveLength(0);
});

it('rechecks the pinned source in receipt intake before any receipt write', async () => {
  const { manifest, reviewed, project } = await setup();
  const report = reviewed.reports[0]!;
  const input = {
    teamId: project.teamId,
    projectId: project.id,
    messageId: manifest[0]!.messageId,
    actorUserId: null,
    attachmentIds: [],
    includeBody: true,
    reviewedSource: {
      accountId: report.accountId,
      threadId: report.threadId,
      originals: report.files,
    },
  };
  input.reviewedSource.originals[0]!.sha256 = '0'.repeat(64);
  await expect(intakeMailReceipts(input)).rejects.toThrow('changed since review');
  expect(await db.select().from(helenaReceipt)).toHaveLength(0);
});

it('rejects duplicate source IDs and duplicate review rows', async () => {
  const { manifest, reviewed } = await setup();
  await expect(backfillMailReceipts([manifest[0], manifest[0]])).rejects.toThrow(
    'duplicate message IDs',
  );
  await expect(
    backfillMailReceipts(manifest, true, {
      ...reviewed,
      reports: [reviewed.reports[0], reviewed.reports[0]],
    }),
  ).rejects.toThrow('manifest scope');
  expect(await db.select().from(helenaReceipt)).toHaveLength(0);
});

it('rejects a corrupted archived EML instead of reporting successful deduplication', async () => {
  const { manifest, reviewed } = await setup();
  await backfillMailReceipts(manifest, true, reviewed);
  const [receipt] = await db.select().from(helenaReceipt);
  await writeFile(absoluteVaultPath(receipt!.vaultPath), 'corrupted archived original');
  await expect(backfillMailReceipts(manifest, false, reviewed)).rejects.toThrow(
    'existing receipt original changed',
  );
  await expect(backfillMailReceipts(manifest, true, reviewed)).rejects.toThrow(
    'existing receipt original changed',
  );
  expect(await db.select().from(helenaReceipt)).toHaveLength(2);
});
