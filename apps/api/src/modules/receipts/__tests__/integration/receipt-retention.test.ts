import { beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  db,
  helenaReceipt,
  mailAttachment,
  mailMessage,
  mailMessageFolder,
  mailThread,
} from '@repo/db';
import { getObject } from '@repo/storage';
import { vaultAbsolute } from '@repo/mail';
import { eq, sql } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';
import { intakeMailReceipts } from '../../receipts';
import { pruneAccount } from '../../../../../../worker/src/mail/store';

const invoice = readFileSync(
  new URL(
    '../../../../../../../packages/finance/src/__fixtures__/factur-x-en16931.xml',
    import.meta.url,
  ),
  'utf8',
);
const old = new Date('2020-01-01T00:00:00Z');
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function waitForWaiters(projectId: number, count: number) {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const rows = await db.execute(
      sql`select count(*)::integer as count from pg_locks where locktype = 'advisory' and classid = 748220 and objid = ${projectId} and not granted`,
    );
    if (Number(rows[0]!.count) >= count) return;
    await Bun.sleep(10);
  }
  throw new Error('Expected native advisory-lock waiters did not arrive');
}

// Authored for the isolated PostgreSQL gate. No provider calls: real local intake,
// cache prune, storage bytes and explicit lock order are exercised together.
describe('receipt-bound mail cache retention', () => {
  beforeEach(resetDb);
  async function setup(attachment = false) {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    const project = (await api.projects.post({ key: 'RETAIN', name: 'Retention' })).data!;
    const account = await insertMailAccount(project.teamId, project.id);
    const base = {
      teamId: project.teamId,
      accountId: account.accountId,
      folderId: account.inboxId,
      projectId: project.id,
      projectKey: project.key,
      sentAt: old,
    };
    const mail = await insertMessage({
      ...base,
      text: 'Invoice number: RET-1\nAmount paid: 12.00 EUR',
      ...(attachment
        ? {
            attachments: [
              { filename: 'invoice.xml', content: invoice },
              { filename: 'logo.txt', content: 'shared logo' },
            ],
          }
        : {}),
    });
    const input = {
      teamId: project.teamId,
      projectId: project.id,
      messageId: mail.messageRowId,
      actorUserId: owner.userId,
      includeBody: !attachment,
      skipMatching: true,
    };
    return { owner, api, project, account, base, mail, input };
  }
  for (const attachment of [false, true])
    it(`preserves only the bound ${attachment ? 'attachment' : 'body'} mail, raw bytes and files without undeleting`, async () => {
      const ctx = await setup(attachment);
      const ids = await intakeMailReceipts(ctx.input);
      expect(ids).toHaveLength(1);
      const sibling = await insertMessage({
        ...ctx.base,
        threadId: ctx.mail.threadId,
        text: 'ordinary old message',
        ...(attachment ? { attachments: [{ filename: 'logo.txt', content: 'shared logo' }] } : {}),
      });
      await db
        .delete(mailMessageFolder)
        .where(eq(mailMessageFolder.messageId, ctx.mail.messageRowId));
      await db
        .update(mailMessage)
        .set({ deletedAt: old })
        .where(eq(mailMessage.id, ctx.mail.messageRowId));
      const [before] = await db
        .select()
        .from(mailMessage)
        .where(eq(mailMessage.id, ctx.mail.messageRowId));
      const files = await db
        .select()
        .from(mailAttachment)
        .where(eq(mailAttachment.messageId, ctx.mail.messageRowId));
      const bytes = await new Response((await getObject(before!.rawKey)).body).arrayBuffer();
      const fileBytes = files.map((file) => readFileSync(vaultAbsolute(file.vaultPath)));
      expect(await pruneAccount(ctx.account.accountId, 30)).toBe(1);
      expect(
        await db.select().from(mailMessage).where(eq(mailMessage.id, ctx.mail.messageRowId)),
      ).toEqual([before!]);
      expect(
        await db.select().from(mailMessage).where(eq(mailMessage.id, sibling.messageRowId)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(mailMessageFolder)
          .where(eq(mailMessageFolder.messageId, ctx.mail.messageRowId)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(mailAttachment)
          .where(eq(mailAttachment.messageId, ctx.mail.messageRowId)),
      ).toEqual(files);
      expect(await new Response((await getObject(before!.rawKey)).body).arrayBuffer()).toEqual(
        bytes,
      );
      for (let i = 0; i < files.length; i++)
        expect(readFileSync(vaultAbsolute(files[i]!.vaultPath))).toEqual(fileBytes[i]!);
      expect(
        await db.select().from(mailThread).where(eq(mailThread.id, ctx.mail.threadId)),
      ).toHaveLength(1);
      expect(await pruneAccount(ctx.account.accountId, 30)).toBe(0);
    });
  it('does not retain a body mail on the strength of malformed or foreign provenance', async () => {
    const ctx = await setup();
    const [id] = await intakeMailReceipts(ctx.input);
    await db
      .update(helenaReceipt)
      .set({
        details: {
          mailSource: {
            messageId: String(ctx.mail.messageRowId),
            threadId: ctx.mail.threadId,
            kind: 'body',
          },
        },
      })
      .where(eq(helenaReceipt.id, id!));
    expect(await pruneAccount(ctx.account.accountId, 30)).toBe(1);
    expect(
      await db.select().from(mailMessage).where(eq(mailMessage.id, ctx.mail.messageRowId)),
    ).toEqual([]);
  });
  for (const intakeFirst of [true, false])
    it(`serializes real intake and prune with ${intakeFirst ? 'intake' : 'prune'} first`, async () => {
      const ctx = await setup();
      const locked = deferred();
      const release = deferred();
      const hold = db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(748220, ${ctx.project.id})`);
        locked.resolve();
        await release.promise;
      });
      await locked.promise;
      let intake!: Promise<{ ids: number[] } | { error: unknown }>;
      let prune!: Promise<number>;
      const startIntake = () =>
        intakeMailReceipts(ctx.input).then(
          (ids) => ({ ids }),
          (error: unknown) => ({ error }),
        );
      try {
        if (intakeFirst) intake = startIntake();
        else prune = pruneAccount(ctx.account.accountId, 30);
        await waitForWaiters(ctx.project.id, 1);
        if (intakeFirst) prune = pruneAccount(ctx.account.accountId, 30);
        else intake = startIntake();
        await waitForWaiters(ctx.project.id, 2);
      } finally {
        release.resolve();
        await hold;
      }
      const [filed, removed] = await Promise.all([intake, prune]);
      if (intakeFirst) {
        expect('ids' in filed && filed.ids.length).toBe(1);
        expect(removed).toBe(0);
      } else {
        expect('error' in filed).toBe(true);
        expect(removed).toBe(1);
      }
      expect(
        await db.select().from(helenaReceipt).where(eq(helenaReceipt.projectId, ctx.project.id)),
      ).toHaveLength(intakeFirst ? 1 : 0);
    }, 10000);
  it('rechecks a project move that occurred after candidate selection', async () => {
    const ctx = await setup();
    const other = (await ctx.api.projects.post({ key: 'MOVED', name: 'Moved' })).data!;
    const locked = deferred();
    const release = deferred();
    const hold = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(748220, ${ctx.project.id})`);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const prune = pruneAccount(ctx.account.accountId, 30);
    try {
      await waitForWaiters(ctx.project.id, 1);
      await db
        .update(mailThread)
        .set({ projectId: other.id })
        .where(eq(mailThread.id, ctx.mail.threadId));
    } finally {
      release.resolve();
      await hold;
    }
    expect(await prune).toBe(0);
    expect(
      await db.select().from(mailMessage).where(eq(mailMessage.id, ctx.mail.messageRowId)),
    ).toHaveLength(1);
  });
});
