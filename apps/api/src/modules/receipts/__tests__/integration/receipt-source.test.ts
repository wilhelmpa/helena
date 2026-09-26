import { beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { db, helenaReceipt, issue, mailMessage, mailThread, teamMember } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';
import { intakeMailReceipts } from '../../receipts';
import type { ReceiptDetailView } from '../../views';

const invoice = readFileSync(
  new URL(
    '../../../../../../../packages/finance/src/__fixtures__/factur-x-en16931.xml',
    import.meta.url,
  ),
  'utf8',
);

describe('receipt source navigation', () => {
  beforeEach(resetDb);

  async function setup(attachment = false) {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    const project = (await api.projects.post({ key: 'FIN', name: 'Finance' })).data!;
    const account = await insertMailAccount(project.teamId, project.id);
    const mail = await insertMessage({
      teamId: project.teamId,
      accountId: account.accountId,
      folderId: account.inboxId,
      projectId: project.id,
      projectKey: project.key,
      text: 'Invoice number: SRC-42\nAmount paid: 12.00 EUR',
      ...(attachment ? { attachments: [{ filename: 'invoice.xml', content: invoice }] } : {}),
    });
    const [receiptId] = await intakeMailReceipts({
      teamId: project.teamId,
      projectId: project.id,
      messageId: mail.messageRowId,
      actorUserId: owner.userId,
      includeBody: !attachment,
      skipMatching: true,
    });
    expect(receiptId).toBeNumber();
    const read = async (cookie = owner.cookie, key = project.key) => {
      const response = await app.handle(
        new Request(`http://localhost/projects/${key}/receipts/${receiptId}`, {
          headers: { cookie },
        }),
      );
      return { status: response.status, body: (await response.json()) as ReceiptDetailView };
    };
    const task = () => api.mail.threads({ threadId: mail.threadId }).task.post({});
    return { owner, api, project, mail, receiptId: receiptId!, read, task };
  }

  it('links a body original to the real thread and all of its tasks without rewriting the original', async () => {
    const ctx = await setup();
    const before = await ctx.read();
    const one = (await ctx.task()).data!;
    const two = (await ctx.task()).data!;
    const { status, body } = await ctx.read();
    expect(status).toBe(200);
    expect(body.sourceLinks).toEqual({
      messageId: ctx.mail.messageRowId,
      threadId: ctx.mail.threadId,
      issues: [one, two].map((task) => ({
        id: task.issueId,
        sequenceNumber: task.sequenceNumber,
        projectKey: 'FIN',
        identifier: `FIN-${task.sequenceNumber}`,
      })),
    });
    expect(body.vaultPath).toBe(before.body.vaultPath);
    expect(body.details.mailSource).toBeUndefined();
    const source = await ctx.api
      .projects({ projectKey: 'FIN' })
      .mail.threads({ threadId: String(body.sourceLinks!.threadId) })
      .get();
    expect(source.status).toBe(200);
    expect(source.data?.messages.map((message) => message.messageId)).toContain(
      ctx.mail.messageRowId,
    );
    const ticket = await ctx.api.issues({ issueId: one.issueId }).get();
    expect(ticket.data?.description).toContain(`**Helena thread ID:** ${ctx.mail.threadId}`);
    expect(ticket.data?.description).toContain(`/project/FIN/inbox?thread=${ctx.mail.threadId}`);
  });

  it('resolves a legacy attachment receipt without JSON provenance and keeps the canonical Mail path', async () => {
    const ctx = await setup(true);
    const before = await ctx.read();
    // Importer-era receipts have the relational attachment FK but no JSON source.
    await db.update(helenaReceipt).set({ details: {} }).where(eq(helenaReceipt.id, ctx.receiptId));
    const { status, body } = await ctx.read();
    expect(status).toBe(200);
    expect(body.sourceLinks).toMatchObject({
      messageId: ctx.mail.messageRowId,
      threadId: ctx.mail.threadId,
      issues: [],
    });
    expect(body.mailAttachmentId).toBe(before.body.mailAttachmentId);
    expect(body.vaultPath).toBe(before.body.vaultPath);
    expect(body.vaultPath).toContain('/Files/Mail/');
    const source = await ctx.api
      .projects({ projectKey: 'FIN' })
      .mail.threads({ threadId: String(ctx.mail.threadId) })
      .get();
    expect(source.data?.messages[0]?.attachments[0]?.vaultPath).toBe(body.vaultPath);
  });

  it('keeps missing and deleted sources unavailable while the receipt remains readable', async () => {
    const ctx = await setup();
    const before = await ctx.read();
    // Simulate the worker's removal marker; this has no public source-edit route.
    await db
      .update(mailMessage)
      .set({ deletedAt: new Date() })
      .where(eq(mailMessage.id, ctx.mail.messageRowId));
    const deleted = await ctx.read();
    expect(deleted.status).toBe(200);
    expect(deleted.body.sourceLinks).toBeNull();
    expect(deleted.body.details.mailSource).toBeUndefined();
    expect(deleted.body.vaultPath).toBe(before.body.vaultPath);
    await db.delete(mailMessage).where(eq(mailMessage.id, ctx.mail.messageRowId));
    expect((await ctx.read()).body.sourceLinks).toBeNull();
  });

  it('does not follow stale, malformed or oversized JSON source references', async () => {
    const ctx = await setup();
    const original = (await ctx.read()).body.vaultPath;
    for (const mailSource of [
      null,
      { messageId: ctx.mail.messageRowId, threadId: 2147483648 },
      { messageId: '999999999999999999999', threadId: ctx.mail.threadId },
      { messageId: ctx.mail.messageRowId, threadId: 2147483647 },
    ]) {
      await db
        .update(helenaReceipt)
        .set({ details: { mailSource } })
        .where(eq(helenaReceipt.id, ctx.receiptId));
      const result = await ctx.read();
      expect(result.status).toBe(200);
      expect(result.body.sourceLinks).toBeNull();
      expect(result.body.details.mailSource).toBeUndefined();
      expect(result.body.vaultPath).toBe(original);
    }
  });

  it('excludes a source or linked task that belongs to another project', async () => {
    const ctx = await setup();
    const other = (await ctx.api.projects.post({ key: 'OTHER', name: 'Other' })).data!;
    const task = (await ctx.task()).data!;
    // Historical inconsistent rows cannot grant navigation into another project.
    await db.update(issue).set({ projectId: other.id }).where(eq(issue.id, task.issueId));
    expect((await ctx.read()).body.sourceLinks?.issues).toEqual([]);
    await db
      .update(mailThread)
      .set({ projectId: other.id })
      .where(eq(mailThread.id, ctx.mail.threadId));
    const result = await ctx.read();
    expect(result.status).toBe(200);
    expect(result.body.sourceLinks).toBeNull();
    expect((await ctx.read(ctx.owner.cookie, 'OTHER')).status).toBe(404);
  });

  it('respects receipt access and does not expose task links to a team manager without task access', async () => {
    const ctx = await setup();
    const task = (await ctx.task()).data!;
    const manager = await signUpTestUser();
    const asManager = authedApi(manager.cookie);
    expect((await ctx.read(manager.cookie)).status).toBe(403);
    const invite = await ctx.api
      .teams({ teamId: ctx.project.teamId })
      .invites.post({ email: manager.email, role: 'manager' });
    expect((await asManager.invites({ token: invite.data!.token }).accept.post()).status).toBe(200);
    const result = await ctx.read(manager.cookie);
    expect(result.status).toBe(200);
    expect(result.body.sourceLinks).toMatchObject({ threadId: ctx.mail.threadId, issues: [] });
    expect((await asManager.mail.threads({ threadId: ctx.mail.threadId }).get()).status).toBe(200);
    expect((await asManager.issues({ issueId: task.issueId }).get()).status).toBe(403);
  });

  it('does not infer mail access from a retained project owner row after team access was removed', async () => {
    const ctx = await setup();
    // Legacy membership state: project administration remains, but mailScope denies the team.
    await db
      .delete(teamMember)
      .where(
        and(eq(teamMember.teamId, ctx.project.teamId), eq(teamMember.userId, ctx.owner.userId)),
      );
    const result = await ctx.read();
    expect(result.status).toBe(200);
    expect(result.body.sourceLinks).toBeNull();
    expect(result.body.details.mailSource).toBeUndefined();
    expect((await ctx.api.mail.threads({ threadId: ctx.mail.threadId }).get()).status).toBe(404);
  });
});
