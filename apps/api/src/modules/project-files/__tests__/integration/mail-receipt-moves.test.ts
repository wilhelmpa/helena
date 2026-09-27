import { beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db, helenaReceipt, mailAttachment, mailMessage, vaultEntry } from '@repo/db';
import { readExportZip } from '@helena/finance';
import { indexVaultPaths } from '@repo/vault';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';
import { freshVault } from '#tests/helpers/vault';
import { intakeMailReceipts, prepareMailReceipts } from '#modules/receipts/receipts';

const xml = readFileSync(
  new URL(
    '../../../../../../../packages/finance/src/__fixtures__/factur-x-en16931.xml',
    import.meta.url,
  ),
  'utf8',
);
let vault: string;
beforeEach(async () => {
  await resetDb();
  vault = freshVault();
});

const raw = (cookie: string, url: string) =>
  app.handle(new Request(`http://localhost${url}`, { headers: { cookie } }));
const relative = (full: string) => full.slice('Projects/FIN/'.length);

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  await api.projects.post({ key: 'FIN', name: 'Finance' });
  const view = (await api.projects({ projectKey: 'FIN' }).get()).data!;
  const project = view.project;
  const account = await insertMailAccount(project.teamId, project.id);
  const messageInput = {
    teamId: project.teamId,
    projectId: project.id,
    projectKey: project.key,
    accountId: account.accountId,
    folderId: account.inboxId,
    sentAt: new Date('2026-09-20T12:00:00Z'),
  };
  const mail = await insertMessage({
    ...messageInput,
    subject: 'Rechnung MS-10023',
    attachments: [{ filename: 'Rechnung.xml', content: xml }],
  });
  const [attachment] = await db
    .select()
    .from(mailAttachment)
    .where(eq(mailAttachment.messageId, mail.messageRowId));
  const input = {
    teamId: project.teamId,
    projectId: project.id,
    messageId: mail.messageRowId,
    actorUserId: owner.userId,
    includeBody: false,
  };
  return {
    owner,
    api,
    project,
    view,
    messageInput,
    mail,
    attachment,
    input,
    files: api.projects({ projectKey: 'FIN' }).files,
  };
}

async function receiptRow(id: number) {
  return (await db.select().from(helenaReceipt).where(eq(helenaReceipt.id, id)))[0];
}

async function assertOriginal(cookie: string, attachmentId: number, receiptId: number) {
  const attachment = await raw(cookie, `/mail/attachments/${attachmentId}`);
  expect(attachment.status).toBe(200);
  expect(await attachment.text()).toBe(xml);
  const receipt = await raw(cookie, `/projects/FIN/receipts/${receiptId}/file`);
  expect(receipt.status).toBe(200);
  expect(await receipt.text()).toBe(xml);
  const exported = await raw(cookie, '/projects/FIN/receipts/export?month=2026-09');
  expect(exported.status).toBe(200);
  const zip = readExportZip(new Uint8Array(await exported.arrayBuffer()));
  expect(Object.values(zip).filter((bytes) => Buffer.from(bytes).toString() === xml)).toHaveLength(
    1,
  );
}

describe('mail and receipt originals follow canonical vault moves', () => {
  it('keeps downloads, export, source folder and deduplication after folder and file moves', async () => {
    const { owner, api, files, attachment, input, mail } = await setup();
    const [id] = await intakeMailReceipts(input);
    const before = (
      await db.select().from(mailMessage).where(eq(mailMessage.id, mail.messageRowId))
    )[0].attachmentFolder!;
    await files.folders.post({ path: 'Archive' });
    expect((await files.move.post({ from: 'Files/Mail', to: 'Archive/Invoices' })).status).toBe(
      200,
    );
    const moved = attachment.vaultPath.replace(
      'Projects/FIN/Files/Mail',
      'Projects/FIN/Archive/Invoices',
    );
    expect((await receiptRow(id)).vaultPath).toBe(moved);
    expect(
      (await db.select().from(mailMessage).where(eq(mailMessage.id, mail.messageRowId)))[0]
        .attachmentFolder,
    ).toBe(before.replace('Projects/FIN/Files/Mail', 'Projects/FIN/Archive/Invoices'));
    await assertOriginal(owner.cookie, attachment.id, id);
    expect(
      (await files.move.post({ from: relative(moved), to: 'Archive/Invoice-renamed.xml' })).status,
    ).toBe(200);
    await assertOriginal(owner.cookie, attachment.id, id);
    expect((await receiptRow(id)).vaultPath).toBe('Projects/FIN/Archive/Invoice-renamed.xml');
    expect(
      (
        await api.knowledge.move.post({
          from: 'Projects/FIN/Archive/Invoice-renamed.xml',
          to: 'Projects/FIN/Archive/Invoice-final.xml',
        })
      ).status,
    ).toBe(200);
    await assertOriginal(owner.cookie, attachment.id, id);
    expect(await intakeMailReceipts(input)).toEqual([id]);
    expect(await db.select().from(helenaReceipt)).toHaveLength(1);
    const originals = readdirSync(path.join(vault, 'Projects/FIN'), { recursive: true }).filter(
      (name) => String(name).endsWith('.xml'),
    );
    expect(originals).toEqual(['Archive/Invoice-final.xml']);
    expect(existsSync(path.join(vault, attachment.vaultPath))).toBe(false);
  });

  it('can file an unindexed attachment after moving it and blocks an unsafe later thread transfer', async () => {
    const { owner, api, files, attachment, input, mail } = await setup();
    expect(
      await db.select().from(vaultEntry).where(eq(vaultEntry.path, attachment.vaultPath)),
    ).toHaveLength(0);
    await files.folders.post({ path: 'Docs' });
    expect(
      (await files.move.post({ from: relative(attachment.vaultPath), to: 'Docs/Original.xml' }))
        .status,
    ).toBe(200);
    const transfer = await api.mail.threads({ threadId: mail.threadId }).patch({ projectId: null });
    expect(transfer.status).toBe(409);
    expect(transfer.error?.value).toMatchObject({
      error: expect.stringContaining('outside their message folder'),
    });
    expect((await prepareMailReceipts(input))[0].vaultPath).toBe('Projects/FIN/Docs/Original.xml');
    const [id] = await intakeMailReceipts(input);
    await assertOriginal(owner.cookie, attachment.id, id);
  });

  it('updates only the owning project even when another project has a stale reference to the source', async () => {
    const { owner, api, files, attachment, input, project } = await setup();
    const [id] = await intakeMailReceipts(input);
    await api.projects.post({ key: 'OTHER', name: 'Other' });
    const other = (await api.projects({ projectKey: 'OTHER' }).get()).data!.project;
    const account = await insertMailAccount(project.teamId, other.id, 'other@example.test');
    const foreignMail = await insertMessage({
      teamId: project.teamId,
      projectId: other.id,
      projectKey: other.key,
      accountId: account.accountId,
      folderId: account.inboxId,
      attachments: [{ filename: 'other.xml', content: xml }],
    });
    const [foreignId] = await intakeMailReceipts({
      teamId: project.teamId,
      projectId: other.id,
      messageId: foreignMail.messageRowId,
      actorUserId: owner.userId,
    });
    // Model stale imported references; ownership, rather than a matching prefix, must win.
    await db
      .update(mailAttachment)
      .set({ vaultPath: attachment.vaultPath })
      .where(eq(mailAttachment.messageId, foreignMail.messageRowId));
    await db
      .update(helenaReceipt)
      .set({ vaultPath: attachment.vaultPath })
      .where(eq(helenaReceipt.id, foreignId));
    await files.folders.post({ path: 'Docs' });
    expect(
      (await files.move.post({ from: relative(attachment.vaultPath), to: 'Docs/Original.xml' }))
        .status,
    ).toBe(200);
    expect((await receiptRow(id)).vaultPath).toBe('Projects/FIN/Docs/Original.xml');
    expect((await receiptRow(foreignId)).vaultPath).toBe(attachment.vaultPath);
    expect(
      (
        await db
          .select()
          .from(mailAttachment)
          .where(eq(mailAttachment.messageId, foreignMail.messageRowId))
      )[0].vaultPath,
    ).toBe(attachment.vaultPath);
  });

  it('rolls back the filesystem and all references together when the database rejects a move', async () => {
    const { owner, api, view, files, attachment, input } = await setup();
    const [id] = await intakeMailReceipts(input);
    const issue = (
      await api
        .projects({ projectKey: 'FIN' })
        .issues.post({ title: 'Receipt', columnId: view.columns[0].id })
    ).data!;
    expect(
      (
        await api
          .issues({ issueId: issue.id })
          .attachments.link.post({ path: relative(attachment.vaultPath) })
      ).status,
    ).toBe(201);
    await files.folders.post({ path: 'Docs' });
    await db.execute(
      sql`ALTER TABLE helena_receipt ADD CONSTRAINT test_reject_vault_move CHECK (vault_path <> 'Projects/FIN/Docs/Rejected.xml')`,
    );
    try {
      expect(
        (await files.move.post({ from: relative(attachment.vaultPath), to: 'Docs/Rejected.xml' }))
          .status,
      ).toBe(500);
      expect(
        (
          await api.knowledge.move.post({
            from: attachment.vaultPath,
            to: 'Projects/FIN/Docs/Rejected.xml',
          })
        ).status,
      ).toBe(500);
      expect(existsSync(path.join(vault, attachment.vaultPath))).toBe(true);
      expect(existsSync(path.join(vault, 'Projects/FIN/Docs/Rejected.xml'))).toBe(false);
      expect((await api.issues({ issueId: issue.id }).attachments.get()).data![0].vaultPath).toBe(
        attachment.vaultPath,
      );
      expect((await receiptRow(id)).vaultPath).toBe(attachment.vaultPath);
      await assertOriginal(owner.cookie, attachment.id, id);
    } finally {
      await db.execute(sql`ALTER TABLE helena_receipt DROP CONSTRAINT test_reject_vault_move`);
    }
  });

  it('records the actor for upload and RFC822 intake and retains body downloads after a Belege rename', async () => {
    const { owner, api, files, messageInput } = await setup();
    const form = new FormData();
    form.append('file', new File([xml], 'Invoice.xml', { type: 'application/xml' }));
    const upload = await app.handle(
      new Request('http://localhost/projects/FIN/receipts', {
        method: 'POST',
        headers: { cookie: owner.cookie },
        body: form,
      }),
    );
    expect(upload.status).toBe(201);
    const uploaded = (await upload.json()) as { id: number; vaultPath: string };
    const original =
      'Subject: Invoice BODY-1\r\n\r\nRechnung BODY-1\r\nGesamtbetrag: 12,00 EUR\r\n';
    const mail = await insertMessage({
      ...messageInput,
      subject: 'Invoice BODY-1',
      text: 'Rechnung BODY-1\nGesamtbetrag: 12,00 EUR',
      raw: original,
    });
    const [id] = await intakeMailReceipts({
      teamId: messageInput.teamId,
      projectId: messageInput.projectId,
      messageId: mail.messageRowId,
      actorUserId: owner.userId,
      includeBody: true,
    });
    const body = await receiptRow(id);
    for (const vaultPath of [uploaded.vaultPath, body.vaultPath]) {
      // Reindexing an unchanged file must not have to repair an incorrect first author.
      await indexVaultPaths([vaultPath]);
      expect(
        (await db.select().from(vaultEntry).where(eq(vaultEntry.path, vaultPath)))[0].lastAuthor,
      ).toBe(`user:${owner.userId}`);
    }
    expect((await files.move.post({ from: 'Files/Belege', to: 'Files/Receipts' })).status).toBe(
      200,
    );
    expect((await receiptRow(id)).vaultPath).toBe(body.vaultPath.replace('/Belege/', '/Receipts/'));
    const download = await raw(owner.cookie, `/projects/FIN/receipts/${id}/file`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(original);
    expect(
      (await api.projects({ projectKey: 'FIN' }).receipts({ receiptId: uploaded.id }).get()).data!
        .vaultPath,
    ).toContain('/Files/Receipts/');
    const exported = await raw(owner.cookie, '/projects/FIN/receipts/export?month=2026-09');
    const zip = readExportZip(new Uint8Array(await exported.arrayBuffer()));
    expect(
      Object.values(zip).filter((bytes) => Buffer.from(bytes).toString() === original),
    ).toHaveLength(1);
  });
});
