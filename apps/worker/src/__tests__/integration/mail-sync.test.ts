import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  approvalRequest,
  db,
  hubInboxEvent,
  integrationCredential,
  mailAccount,
  mailAction,
  mailAttachment,
  mailDraft,
  mailFolder,
  mailMessage,
  mailMessageFolder,
  mailRule,
  mailThread,
  nextCredentialId,
  project,
  sealCredential,
  team,
} from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { claimInboxThreads, completeTriage, materializeInboxEvents } from '../../hub-inbox-store';
import { pushActions } from '../../mail/actions';
import { AccountSync } from '../../mail/account-sync';
import { applyApprovalDecisions, sendDueDrafts } from '../../mail/send';
import { loadSyncAccounts, type SyncAccount } from '../../mail/store';
import {
  mailTransport,
  setMailTransportForTests,
  type ImapClient,
  type MailSyncConfig,
} from '../../mail/transport';
import { insertAgent } from '../helpers/agents';
import { eml, fakeTransport, FakeImapServer, type SentMail } from '../helpers/fake-mail';

const config: MailSyncConfig = {
  pollIntervalMs: 60_000,
  batchSize: 1,
  batchBytes: 1024 * 1024,
  pauseMs: 0,
  backoffMs: 10,
  maxBackoffMs: 10,
};

let vault: string;
let server: FakeImapServer;
let sent: SentMail[];

beforeAll(async () => {
  vault = await mkdtemp(path.join(tmpdir(), 'mail-sync-vault-'));
  process.env.PROJECT_VAULT_ROOT = vault;
  process.env.STORAGE_ROOT = await mkdtemp(path.join(tmpdir(), 'mail-sync-storage-'));
});

beforeEach(async () => {
  await db.delete(team);
  server = new FakeImapServer();
  sent = [];
  setMailTransportForTests(fakeTransport(server, sent));
});

afterAll(() => setMailTransportForTests(null));

function gmailFolders() {
  server.addMailbox('INBOX');
  server.addMailbox('[Gmail]/Sent Mail', '\\Sent');
  server.addMailbox('[Gmail]/All Mail', '\\All');
  server.addMailbox('[Gmail]/Trash', '\\Trash');
  server.addMailbox('[Gmail]/Important', undefined, ['\\Important']);
  server.addMailbox('Verve');
}

async function createAccount(
  overrides: Partial<typeof mailAccount.$inferInsert> = {},
): Promise<SyncAccount & { projectKey: string }> {
  const [owner] = await db.insert(team).values({ name: 'Mail test' }).returning();
  const [home] = await db
    .insert(project)
    .values({ teamId: owner!.id, key: 'VOL', name: 'Volition' })
    .returning();
  const credentialId = await nextCredentialId();
  const secret = sealCredential(credentialId, JSON.stringify({ value: 'app-password' }));
  const [credential] = await db
    .insert(integrationCredential)
    .values({
      id: credentialId,
      teamId: owner!.id,
      integrationKey: 'secret',
      label: 'Mail: me@home.example',
      ...secret,
    })
    .returning();
  await db.insert(mailAccount).values({
    teamId: owner!.id,
    projectId: home!.id,
    name: 'Me',
    address: 'me@home.example',
    imapHost: 'imap.gmail.com',
    smtpHost: 'smtp.gmail.com',
    username: 'me@home.example',
    credentialId: credential!.id,
    // These tests import every message whatever its date; the fetch window has tests of
    // its own (mail-access.test.ts).
    fetchDays: null,
    ...overrides,
  });
  const [account] = await loadSyncAccounts();
  return { ...account!, projectKey: home!.key };
}

async function connect(account: SyncAccount): Promise<ImapClient> {
  const client = mailTransport().imap(account.settings);
  await client.connect();
  return client;
}

async function pass(account: SyncAccount): Promise<void> {
  const client = await connect(account);
  try {
    await new AccountSync(account, config).fullPass(client);
  } finally {
    client.close();
  }
}

async function locations(folderPath: string): Promise<string[]> {
  const rows = await db
    .select({ messageId: mailMessage.messageId })
    .from(mailMessageFolder)
    .innerJoin(mailFolder, eq(mailFolder.id, mailMessageFolder.folderId))
    .innerJoin(mailMessage, eq(mailMessage.id, mailMessageFolder.messageId))
    .where(eq(mailFolder.path, folderPath));
  return rows.map((row) => row.messageId).sort();
}

async function waitFor(check: () => Promise<boolean>, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out');
}

describe('mail import', () => {
  it('imports every folder once, stores the raw mail and writes attachments to the vault', async () => {
    gmailFolders();
    const invoice = eml({
      id: '<m1@verve.example>',
      subject: 'Invoice',
      attachment: { name: 'invoice.pdf', content: '%PDF invoice' },
    });
    const reply = eml({
      id: '<m2@verve.example>',
      subject: 'Re: Invoice',
      inReplyTo: '<m1@verve.example>',
    });
    const own = eml({ id: '<m3@home.example>', from: 'me@home.example', to: 'bob@other.example' });
    const archived = eml({ id: '<m4@verve.example>', subject: 'Old' });
    for (const [folder, raw] of [
      ['INBOX', invoice],
      ['INBOX', reply],
      ['[Gmail]/Sent Mail', own],
      ['[Gmail]/All Mail', invoice],
      ['[Gmail]/All Mail', reply],
      ['[Gmail]/All Mail', own],
      ['[Gmail]/All Mail', archived],
      ['[Gmail]/Trash', eml({ id: '<m5@verve.example>' })],
      ['[Gmail]/Important', invoice],
      ['Verve', invoice],
    ] as const) {
      server.add(folder, raw);
    }
    const account = await createAccount();

    await pass(account);

    expect(server.sourceFetches).toBe(4);
    const messages = await db.select().from(mailMessage);
    expect(messages.map((row) => row.messageId).sort()).toEqual([
      '<m1@verve.example>',
      '<m2@verve.example>',
      '<m3@home.example>',
      '<m4@verve.example>',
    ]);
    expect(await locations('INBOX')).toEqual(['<m1@verve.example>', '<m2@verve.example>']);
    expect(await locations('[Gmail]/All Mail')).toHaveLength(4);
    expect(await locations('Verve')).toEqual(['<m1@verve.example>']);
    expect(await locations('[Gmail]/Trash')).toEqual([]);
    expect(await locations('[Gmail]/Important')).toEqual([]);

    const byId = new Map(messages.map((row) => [row.messageId, row]));
    expect(byId.get('<m1@verve.example>')!.threadId).toBe(byId.get('<m2@verve.example>')!.threadId);
    expect(byId.get('<m3@home.example>')!.threadId).not.toBe(
      byId.get('<m1@verve.example>')!.threadId,
    );
    const [thread] = await db
      .select()
      .from(mailThread)
      .where(eq(mailThread.id, byId.get('<m1@verve.example>')!.threadId));
    expect(thread).toMatchObject({ subject: 'Invoice', lastFromAddress: 'anna@verve.example' });

    const raw = await readFile(
      path.join(process.env.STORAGE_ROOT!, 'objects', byId.get('<m1@verve.example>')!.rawKey),
      'utf8',
    );
    expect(raw).toBe(invoice);

    const [attachment] = await db.select().from(mailAttachment);
    expect(attachment).toMatchObject({ filename: 'invoice.pdf', contentType: 'application/pdf' });
    expect(attachment!.vaultPath).toMatch(
      /^Projects\/VOL\/Files\/Mail\/2026\/03\/2026-03-1\d Anna - Invoice\/invoice\.pdf$/,
    );
    expect(await readFile(path.join(vault, attachment!.vaultPath), 'utf8')).toBe('%PDF invoice');

    const [row] = await db.select().from(mailAccount);
    expect(row).toMatchObject({ syncStatus: 'synced', syncError: null });
    const folders = await db.select().from(mailFolder);
    expect(folders.find((folder) => folder.path === '[Gmail]/Trash')).toMatchObject({
      role: 'trash',
      sync: false,
    });
    const inbox = folders.find((folder) => folder.path === 'INBOX')!;
    expect(inbox).toMatchObject({ role: 'inbox', totalCount: 2, syncedCount: 2, uidNext: 3 });
  });

  it('resumes an interrupted import without downloading a message twice', async () => {
    server.addMailbox('INBOX');
    for (const id of ['a', 'b', 'c']) server.add('INBOX', eml({ id: `<${id}@x.example>` }));
    const account = await createAccount();
    server.failSourceFetchAt = 2;

    await expect(pass(account)).rejects.toThrow('Connection reset');
    expect(await db.select().from(mailMessage)).toHaveLength(1);

    server.failSourceFetchAt = null;
    await pass(account);
    expect(await db.select().from(mailMessage)).toHaveLength(3);
    expect(server.sourceFetches).toBe(4);

    await pass(account);
    expect(server.sourceFetches).toBe(4);
  });

  it('routes a new thread by rule and hands new inbox mail to the triage', async () => {
    server.addMailbox('INBOX');
    server.add('INBOX', eml({ id: '<old@verve.example>' }));
    const account = await createAccount({ triageEnabled: true });
    const [verve] = await db
      .insert(project)
      .values({ teamId: account.teamId, key: 'VERV', name: 'Verve' })
      .returning();
    await db.insert(mailRule).values({
      teamId: account.teamId,
      matchType: 'domain',
      value: 'verve.example',
      projectId: verve!.id,
    });

    await pass(account);
    expect(await db.select().from(hubInboxEvent)).toHaveLength(0);

    server.add(
      'INBOX',
      eml({
        id: '<new@verve.example>',
        subject: 'Offer',
        attachment: { name: 'offer.pdf', content: 'offer' },
      }),
    );
    await pass(account);

    const [message] = await db
      .select()
      .from(mailMessage)
      .where(eq(mailMessage.messageId, '<new@verve.example>'));
    const [thread] = await db.select().from(mailThread).where(eq(mailThread.id, message!.threadId));
    expect(thread!.projectId).toBe(verve!.id);
    const [attachment] = await db.select().from(mailAttachment);
    expect(attachment!.vaultPath.startsWith('Projects/VERV/Files/Mail/')).toBe(true);
    const events = await db.select().from(hubInboxEvent);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      externalEventId: `mail:${message!.id}`,
      externalThreadId: `mail-thread:${thread!.id}`,
      externalMessageId: '<new@verve.example>',
      subject: 'Offer',
    });

    // The triage keeps the thread where it is and offers its project as a suggestion.
    await db
      .update(mailThread)
      .set({ projectId: account.projectId })
      .where(eq(mailThread.id, thread!.id));
    await materializeInboxEvents();
    const [claimed] = await claimInboxThreads();
    await completeTriage(claimed!, {
      summary: 'An offer for Verve',
      priority: null,
      requiresAction: false,
      projectKey: 'VERV',
      issueIdentifier: null,
      confidence: 0.9,
    });
    const [suggested] = await db.select().from(mailThread).where(eq(mailThread.id, thread!.id));
    expect(suggested).toMatchObject({
      projectId: account.projectId,
      suggestedProjectId: verve!.id,
    });
  });

  it('imports mail that arrives while it waits on the inbox', async () => {
    server.addMailbox('INBOX');
    const account = await createAccount();
    const sync = new AccountSync(account, config);
    sync.start();
    try {
      await waitFor(async () => {
        const [row] = await db.select().from(mailAccount);
        return (
          row?.syncStatus === 'synced' &&
          server.clients.some((client) => client.selected === 'INBOX')
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      server.add('INBOX', eml({ id: '<live@x.example>' }));
      await waitFor(async () => (await db.select().from(mailMessage)).length === 1);
    } finally {
      await sync.stop();
    }
  });

  it('takes flag changes from the server and pushes the changes made in Plan', async () => {
    gmailFolders();
    const uid = server.add('INBOX', eml({ id: '<f@x.example>' }));
    server.add('[Gmail]/All Mail', eml({ id: '<f@x.example>' }));
    const account = await createAccount();
    await pass(account);

    server.setFlags('INBOX', uid, ['\\Seen']);
    await pass(account);
    const [seen] = await db.select().from(mailMessage);
    expect(seen).toMatchObject({ seen: true, flagged: false });

    const [inbox] = await db.select().from(mailFolder).where(eq(mailFolder.path, 'INBOX'));
    await db.update(mailMessage).set({ flagged: true }).where(eq(mailMessage.id, seen!.id));
    await db.insert(mailAction).values({
      accountId: account.id,
      messageId: seen!.id,
      folderId: inbox!.id,
      uid,
      kind: 'flag',
    });
    await pass(account);
    expect((await db.select().from(mailMessage))[0]!.flagged).toBe(true);

    const client = await connect(account);
    await pushActions(client, account.id);
    expect(server.flagsOf('INBOX', '<f@x.example>')).toEqual(['\\Flagged', '\\Seen']);
    expect(await db.select().from(mailAction)).toHaveLength(0);

    await db
      .delete(mailMessageFolder)
      .where(and(eq(mailMessageFolder.folderId, inbox!.id), eq(mailMessageFolder.uid, uid)));
    await db.insert(mailAction).values({
      accountId: account.id,
      messageId: seen!.id,
      folderId: inbox!.id,
      uid,
      kind: 'archive',
    });
    await pass(account);
    expect(await locations('INBOX')).toEqual([]);
    await pushActions(client, account.id);
    client.close();
    expect(server.messageIdsIn('INBOX')).toEqual([]);
    expect(server.messageIdsIn('[Gmail]/All Mail')).toEqual(['<f@x.example>']);
    await pass(account);
    expect(await locations('INBOX')).toEqual([]);
    expect((await db.select().from(mailMessage))[0]!.deletedAt).toBeNull();
  });

  it('archives into an Archive folder it creates on a server without one', async () => {
    server.addMailbox('INBOX');
    const uid = server.add('INBOX', eml({ id: '<a@x.example>' }));
    const account = await createAccount({ imapHost: 'mail.example.com' });
    await pass(account);
    const [inbox] = await db.select().from(mailFolder).where(eq(mailFolder.path, 'INBOX'));
    const [message] = await db.select().from(mailMessage);
    await db.insert(mailAction).values({
      accountId: account.id,
      messageId: message!.id,
      folderId: inbox!.id,
      uid,
      kind: 'archive',
    });
    const client = await connect(account);
    await pushActions(client, account.id);
    client.close();
    expect(server.messageIdsIn('Archive')).toEqual(['<a@x.example>']);
  });

  it('reflects deleted messages and a new UIDVALIDITY', async () => {
    server.addMailbox('INBOX');
    const gone = server.add('INBOX', eml({ id: '<gone@x.example>' }));
    server.add('INBOX', eml({ id: '<kept@x.example>' }));
    const account = await createAccount();
    await pass(account);

    server.remove('INBOX', gone);
    await pass(account);
    const rows = await db.select().from(mailMessage);
    expect(rows.find((row) => row.messageId === '<gone@x.example>')!.deletedAt).not.toBeNull();
    expect(rows.find((row) => row.messageId === '<kept@x.example>')!.deletedAt).toBeNull();

    const fetched = server.sourceFetches;
    server.mailboxes.get('INBOX')!.uidValidity = 2n;
    await pass(account);
    expect(await locations('INBOX')).toEqual(['<kept@x.example>']);
    expect(server.sourceFetches).toBe(fetched);
  });
});

describe('mail accounts', () => {
  it('reads the password from the credential and reconnects when it changes', async () => {
    const account = await createAccount();
    expect(account.settings.password).toBe('app-password');
    const [row] = await db.select().from(mailAccount);
    await db
      .update(integrationCredential)
      .set({
        ...sealCredential(row!.credentialId!, JSON.stringify({ value: 'new-password' })),
        updatedAt: new Date(Date.now() + 1000),
      })
      .where(eq(integrationCredential.id, row!.credentialId!));
    const [changed] = await loadSyncAccounts();
    expect(changed!.settings.password).toBe('new-password');
    expect(changed!.version).not.toBe(account.version);

    await db.delete(integrationCredential).where(eq(integrationCredential.id, row!.credentialId!));
    expect(await loadSyncAccounts()).toEqual([]);
  });
});

describe('mail send', () => {
  async function sendingAccount(imapHost: string) {
    server.addMailbox('INBOX');
    server.addMailbox('Sent', '\\Sent');
    server.add('INBOX', eml({ id: '<question@verve.example>', subject: 'Question' }));
    const account = await createAccount({ imapHost, name: 'Patrick' });
    await pass(account);
    const [question] = await db.select().from(mailMessage);
    return { account, question: question! };
  }

  async function queueDraft(
    account: SyncAccount,
    values: Partial<typeof mailDraft.$inferInsert> = {},
  ): Promise<number> {
    const [draft] = await db
      .insert(mailDraft)
      .values({
        teamId: account.teamId,
        accountId: account.id,
        mode: 'reply',
        toAddresses: [{ name: 'Anna', address: 'anna@verve.example' }],
        bccAddresses: [{ name: '', address: 'archive@home.example' }],
        subject: 'Re: Question',
        bodyText: 'Answer',
        bodyHtml: '<p>Answer</p>',
        status: 'queued',
        sendAt: new Date(Date.now() + 60_000),
        ...values,
      })
      .returning();
    return draft!.id;
  }

  it('waits out the undo time, sends over SMTP and files the mail in Sent', async () => {
    const { account, question } = await sendingAccount('mail.example.com');
    const draftId = await queueDraft(account, { replyToMessageId: question.id });

    expect(await sendDueDrafts()).toBe(0);
    await db.update(mailDraft).set({ status: 'draft' }).where(eq(mailDraft.id, draftId));
    await db
      .update(mailDraft)
      .set({ sendAt: new Date(0) })
      .where(eq(mailDraft.id, draftId));
    expect(await sendDueDrafts()).toBe(0);
    expect(sent).toHaveLength(0);

    await db.update(mailDraft).set({ status: 'queued' }).where(eq(mailDraft.id, draftId));
    expect(await sendDueDrafts()).toBe(1);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.envelope).toEqual({
      from: 'me@home.example',
      to: ['anna@verve.example', 'archive@home.example'],
    });
    expect(sent[0]!.raw).not.toMatch(/^Bcc:/m);
    expect(sent[0]!.raw).toContain('In-Reply-To: <question@verve.example>');
    const [draft] = await db.select().from(mailDraft).where(eq(mailDraft.id, draftId));
    expect(draft).toMatchObject({ status: 'sent', lastError: null });

    const filed = server.mailboxes.get('Sent')!.messages;
    expect(filed).toHaveLength(1);
    expect(filed[0]!.raw.toString()).toMatch(/^Bcc: archive@home\.example/m);
    expect(await locations('Sent')).toEqual([draft!.sentMessageId!]);
    const [stored] = await db
      .select()
      .from(mailMessage)
      .where(eq(mailMessage.messageId, draft!.sentMessageId!));
    expect(stored!.threadId).toBe(question.threadId);
    const [answered] = await db.select().from(mailMessage).where(eq(mailMessage.id, question.id));
    expect(answered!.answered).toBe(true);
  });

  it('leaves the Sent copy to Gmail and marks a failed send', async () => {
    const { account } = await sendingAccount('imap.gmail.com');
    const draftId = await queueDraft(account, { sendAt: new Date(0) });
    await sendDueDrafts();
    expect(server.mailboxes.get('Sent')!.messages).toHaveLength(0);
    const [draft] = await db.select().from(mailDraft).where(eq(mailDraft.id, draftId));
    expect(draft!.status).toBe('sent');
    expect(await locations('Sent')).toEqual([]);
    expect(
      await db.select().from(mailMessage).where(eq(mailMessage.messageId, draft!.sentMessageId!)),
    ).toHaveLength(1);

    setMailTransportForTests({
      ...fakeTransport(server, sent),
      send: async () => {
        throw Object.assign(new Error('rejected'), { response: '550 Mailbox unavailable' });
      },
    });
    const failingId = await queueDraft(account, { sendAt: new Date(0) });
    await sendDueDrafts();
    const [failed] = await db.select().from(mailDraft).where(eq(mailDraft.id, failingId));
    expect(failed).toMatchObject({ status: 'failed', lastError: '550 Mailbox unavailable' });
  });

  it('queues a draft once its approval request is approved and returns a rejected one', async () => {
    const { account } = await sendingAccount('imap.gmail.com');
    const agentId = await insertAgent(account.teamId, 'hermes-vol-coordinator', [
      account.projectId!,
    ]);
    const request = async (status: string) => {
      const [row] = await db
        .insert(approvalRequest)
        .values({
          projectId: account.projectId!,
          agentId,
          kind: 'send',
          action: 'Send mail',
          status,
        })
        .returning();
      return row!.id;
    };
    const approved = await queueDraft(account, {
      status: 'pending_approval',
      approvalRequestId: await request('approved'),
    });
    const rejected = await queueDraft(account, {
      status: 'pending_approval',
      approvalRequestId: await request('rejected'),
    });
    const waiting = await queueDraft(account, {
      status: 'pending_approval',
      approvalRequestId: await request('pending'),
    });

    await applyApprovalDecisions();
    await sendDueDrafts();

    const drafts = await db.select().from(mailDraft);
    const status = (id: number) => drafts.find((draft) => draft.id === id)!.status;
    expect(status(approved)).toBe('sent');
    expect(status(rejected)).toBe('draft');
    expect(status(waiting)).toBe('pending_approval');
    expect(sent).toHaveLength(1);
  });

  it('reads attachments from upload storage and from the vault', async () => {
    const { account } = await sendingAccount('imap.gmail.com');
    const folder = path.join(vault, 'Projects', 'VOL', 'Files');
    await Bun.write(path.join(folder, 'plan.txt'), 'vault file');
    const { putObject } = await import('@repo/storage');
    await putObject('mail/drafts/x/upload.txt', Buffer.from('uploaded file'), 'text/plain');
    await queueDraft(account, {
      sendAt: new Date(0),
      attachments: [
        {
          source: 'vault',
          ref: 'Projects/VOL/Files/plan.txt',
          filename: 'plan.txt',
          contentType: 'text/plain',
          size: 10,
        },
        {
          source: 'storage',
          ref: 'mail/drafts/x/upload.txt',
          filename: 'upload.txt',
          contentType: 'text/plain',
          size: 13,
        },
      ],
    });
    await sendDueDrafts();
    expect(sent[0]!.raw).toContain(Buffer.from('vault file').toString('base64'));
    expect(sent[0]!.raw).toContain(Buffer.from('uploaded file').toString('base64'));
    expect(
      await readdir(path.join(process.env.STORAGE_ROOT!, 'objects', 'mail', 'drafts', 'x')),
    ).toEqual([]);
  });
});
