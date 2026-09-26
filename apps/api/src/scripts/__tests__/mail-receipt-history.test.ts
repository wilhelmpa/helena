import { beforeEach, expect, it } from 'bun:test';
import {
  db,
  helenaReceipt,
  hubInboxEvent,
  mailAttachment,
  mailMessage,
  mailMessageFolder,
  mailThread,
} from '@repo/db';
import { eq } from 'drizzle-orm';
import { putObject } from '@repo/storage';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { insertMailAccount } from '#tests/helpers/mail';
import {
  eml,
  FakeImapClient,
  FakeImapServer,
} from '../../../../worker/src/__tests__/helpers/fake-mail';
import { importRawMessage } from '../../../../worker/src/mail/import';
import { flagsOf, loadSyncAccounts } from '../../../../worker/src/mail/store';
import type { ImapClient } from '../../../../worker/src/mail/transport';
import { applyReceiptHistory, inspectReceiptHistory } from '../mail-receipt-history';

beforeEach(resetDb);

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'FIN', name: 'Receipts' })).data!;
  const { accountId } = await insertMailAccount(project.teamId, project.id);
  const [account] = await loadSyncAccounts(accountId);
  const server = new FakeImapServer();
  const box = server.addMailbox('INBOX');
  const raw = eml({
    id: '<invoice@fixture.example>',
    subject: 'Invoice INV-4242',
    date: 'Tue, 10 Mar 2026 12:00:00 +0000',
    body: 'Invoice number: INV-4242\nAmount paid: 12.00 EUR',
  });
  server.add('INBOX', raw, ['\\Seen'], new Date('2026-03-10'));
  const client = new FakeImapClient(server) as unknown as ImapClient;
  await client.connect();
  const input = { projectKey: 'FIN', folder: 'INBOX', since: '2026-01-01', before: '2026-04-01' };
  return { api, account: account!, server, box, client, raw, input };
}

it('inspects old receipts within a bounded window and files selected originals without triage events or Inbox locations', async () => {
  const { account, server, client, input } = await setup();
  server.add(
    'INBOX',
    eml({
      id: '<ad@fixture.example>',
      subject: 'Invoice software newsletter',
      body: 'New product news',
    }),
    [],
    new Date('2026-03-09'),
  );
  server.add(
    'INBOX',
    eml({ id: '<future@fixture.example>', subject: 'Future invoice' }),
    [],
    new Date('2026-05-01'),
  );
  const manifest = await inspectReceiptHistory(client, account, input);
  expect(manifest.candidates).toHaveLength(2);
  expect(manifest.candidates.filter((candidate) => candidate.selected)).toHaveLength(1);
  expect(await db.select().from(mailMessage)).toHaveLength(0);
  expect(await db.select().from(helenaReceipt)).toHaveLength(0);
  const first = await applyReceiptHistory(client, account, manifest);
  const second = await applyReceiptHistory(client, account, manifest);
  expect(second).toEqual(first);
  expect(first.reports[0]!.receiptIds).toHaveLength(1);
  expect(await db.select().from(mailMessageFolder)).toHaveLength(0);
  expect(await db.select().from(hubInboxEvent)).toHaveLength(0);
  expect(await db.select().from(helenaReceipt)).toHaveLength(1);
  expect(server.flagsOf('INBOX', '<invoice@fixture.example>')).toEqual(['\\Seen']);
  expect(server.messageIdsIn('INBOX')).toHaveLength(3);
});

it('rejects provider UID reuse, original drift and project mismatches before import', async () => {
  const { account, box, client, input } = await setup();
  const manifest = await inspectReceiptHistory(client, account, input);
  await expect(
    applyReceiptHistory(client, account, { ...manifest, projectKey: 'OTHER' }),
  ).rejects.toThrow('project scope');
  box.uidValidity++;
  await expect(applyReceiptHistory(client, account, manifest)).rejects.toThrow('UID validity');
  box.uidValidity--;
  box.messages[0]!.raw = Buffer.from('changed');
  await expect(applyReceiptHistory(client, account, manifest)).rejects.toThrow('Original changed');
  expect(await db.select().from(mailMessage)).toHaveLength(0);
});

it('rejects a different provider original that reuses a locally imported Message-ID', async () => {
  const { account, box, client, input } = await setup();
  const manifest = await inspectReceiptHistory(client, account, input);
  await applyReceiptHistory(client, account, manifest);
  box.messages[0]!.raw = Buffer.from(
    eml({
      id: '<invoice@fixture.example>',
      subject: 'Invoice INV-4242',
      body: 'Invoice number: INV-4242\nAmount paid: 99.00 EUR',
    }),
  );
  const reviewed = await inspectReceiptHistory(client, account, input);
  expect(reviewed.candidates[0]!.sha256).not.toBe(manifest.candidates[0]!.sha256);
  await expect(applyReceiptHistory(client, account, reviewed)).rejects.toThrow(
    'Stored original does not match the reviewed original',
  );
  expect(await db.select().from(helenaReceipt)).toHaveLength(1);
  expect(await db.select().from(mailMessage)).toHaveLength(1);
});

it('checks the actual stored bytes before reusing an imported message', async () => {
  const { account, client, input } = await setup();
  const manifest = await inspectReceiptHistory(client, account, input);
  const first = await applyReceiptHistory(client, account, manifest);
  const [message] = await db
    .select()
    .from(mailMessage)
    .where(eq(mailMessage.id, first.reports[0]!.messageId));
  await putObject(message!.rawKey, Buffer.from('changed stored original'), 'message/rfc822');
  await expect(applyReceiptHistory(client, account, manifest)).rejects.toThrow(
    'Stored original does not match the reviewed original',
  );
  expect(await db.select().from(helenaReceipt)).toHaveLength(1);
});

it('rejects a missing selected attachment instead of filing the body fallback', async () => {
  const { account, box, client, input } = await setup();
  const raw = Buffer.from(
    eml({
      id: '<invoice@fixture.example>',
      subject: 'Invoice INV-4242',
      body: 'Invoice number: INV-4242\nAmount paid: 12.00 EUR',
      attachment: { name: 'invoice.pdf', content: 'fixture attachment' },
    }),
  );
  box.messages[0]!.raw = raw;
  const manifest = await inspectReceiptHistory(client, account, input);
  manifest.candidates[0]!.includeBody = true;
  expect(manifest.candidates[0]!.attachmentSha256).toHaveLength(1);
  const messageId = await importRawMessage(account, raw, {
    folderId: null,
    uid: null,
    flags: flagsOf(new Set()),
    newInboxMail: false,
  });
  await db.delete(mailAttachment).where(eq(mailAttachment.messageId, messageId));
  await expect(applyReceiptHistory(client, account, manifest)).rejects.toThrow(
    'Selected stored attachment is missing',
  );
  expect(await db.select().from(helenaReceipt)).toHaveLength(0);
});

it('uses the historical IMAP date when the original has no Date header', async () => {
  const { account, box, client, input } = await setup();
  box.messages[0]!.raw = Buffer.from(
    eml({
      id: '<invoice@fixture.example>',
      subject: 'Invoice INV-4242',
      body: 'Invoice number: INV-4242\nAmount paid: 12.00 EUR',
    }).replace(/^Date:.*\r\n/m, ''),
  );
  const manifest = await inspectReceiptHistory(client, account, input);
  const result = await applyReceiptHistory(client, account, manifest);
  const [receipt] = await db
    .select()
    .from(helenaReceipt)
    .where(eq(helenaReceipt.id, result.reports[0]!.receiptIds[0]!));
  expect(receipt!.invoiceDate).toBe('2026-03-10');
  expect(receipt!.vaultPath).toContain('/Files/Belege/2026-03/');
});

it('rejects a known message moved to another project and bounds pagination', async () => {
  const { api, account, client, input } = await setup();
  await expect(
    inspectReceiptHistory(client, account, { ...input, since: '2020-01-01' }),
  ).rejects.toThrow('366 days');
  await expect(inspectReceiptHistory(client, account, { ...input, limit: 51 })).rejects.toThrow(
    '1–50',
  );
  const manifest = await inspectReceiptHistory(client, account, { ...input, limit: 1 });
  expect(
    (await inspectReceiptHistory(client, account, { ...input, beforeUid: manifest.nextBeforeUid! }))
      .candidates,
  ).toHaveLength(0);
  const first = await applyReceiptHistory(client, account, manifest);
  const other = (await api.projects.post({ key: 'OTHER', name: 'Other' })).data!;
  const [message] = await db
    .select()
    .from(mailMessage)
    .where(eq(mailMessage.id, first.reports[0]!.messageId));
  await db
    .update(mailThread)
    .set({ projectId: other.id })
    .where(eq(mailThread.id, message!.threadId));
  await expect(applyReceiptHistory(client, account, manifest)).rejects.toThrow(
    'outside the required project',
  );
  expect(await db.select().from(helenaReceipt)).toHaveLength(1);
});
