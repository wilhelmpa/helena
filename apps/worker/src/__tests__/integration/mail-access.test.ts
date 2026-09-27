import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  db,
  helenaReceipt,
  integrationCredential,
  issue,
  mailAccount,
  mailAttachment,
  mailFolder,
  mailMessage,
  mailThread,
  mailThreadIssue,
  project,
  team,
  projectColumn,
  nextCredentialId,
  sealCredential,
} from '@repo/db';
import { clearGoogleTokenCache, setGoogleEndpointsForTests } from '@helena/connectors/google';
import { eq } from 'drizzle-orm';
import { AccountSync } from '../../mail/account-sync';
import {
  connectSettings,
  loadSyncAccounts,
  pruneAccount,
  wipeAccount,
  type SyncAccount,
} from '../../mail/store';
import { startMailWorker } from '../../mail/worker';
import { mailTransport, setMailTransportForTests, type MailSyncConfig } from '../../mail/transport';
import { eml, fakeTransport, FakeImapServer, type SentMail } from '../helpers/fake-mail';

// The access center's mail: a Google account's mailbox signs in with the account's OAuth
// token (XOAUTH2), only mail inside the fetch window is imported, older copies are pruned,
// and a reset wipes every imported copy and imports again.

const config: MailSyncConfig = {
  pollIntervalMs: 60_000,
  batchSize: 5,
  batchBytes: 1024 * 1024,
  pauseMs: 0,
  backoffMs: 10,
  maxBackoffMs: 10,
};

const DAY = 86_400_000;
let vault: string;
let storage: string;
let server: FakeImapServer;
let sent: SentMail[];
let google: ReturnType<typeof Bun.serve>;
let tokenAnswer: { status: number; body: unknown };
const opened: { username: string; accessToken?: string; password?: string }[] = [];

beforeAll(async () => {
  vault = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'mail-access-vault-'));
  storage = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'mail-access-storage-'));
  process.env.PROJECT_VAULT_ROOT = vault;
  process.env.STORAGE_ROOT = storage;
  google = Bun.serve({
    port: 0,
    fetch: () => Response.json(tokenAnswer.body, { status: tokenAnswer.status }),
  });
  setGoogleEndpointsForTests({ oauth2TokenUrl: `http://127.0.0.1:${google.port}/token` });
});

afterAll(() => {
  setMailTransportForTests(null);
  setGoogleEndpointsForTests(null);
  google.stop(true);
});

beforeEach(async () => {
  await db.delete(team);
  vault = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'mail-access-vault-'));
  process.env.PROJECT_VAULT_ROOT = vault;
  clearGoogleTokenCache();
  tokenAnswer = { status: 200, body: { access_token: 'ya29.mailbox', expires_in: 3599 } };
  server = new FakeImapServer();
  sent = [];
  opened.length = 0;
  const transport = fakeTransport(server, sent);
  setMailTransportForTests({
    ...transport,
    imap: (settings) => {
      opened.push({
        username: settings.username,
        accessToken: settings.accessToken,
        password: settings.password,
      });
      return transport.imap(settings);
    },
  });
  server.addMailbox('INBOX');
  server.addMailbox('[Gmail]/All Mail', '\\All');
});

async function googleMailbox(overrides: Partial<typeof mailAccount.$inferInsert> = {}) {
  const [owner] = await db.insert(team).values({ name: 'Mail access' }).returning();
  const [home] = await db
    .insert(project)
    .values({ teamId: owner!.id, key: 'PRIV', name: 'Privat' })
    .returning();
  const clientId = await nextCredentialId();
  const [client] = await db
    .insert(integrationCredential)
    .values({
      id: clientId,
      teamId: owner!.id,
      integrationKey: 'google_oauth_client',
      label: 'helena',
      ...sealCredential(clientId, JSON.stringify({ clientSecret: 'GOCSPX-x' })),
      redacted: {
        clientId: '1-a.apps.googleusercontent.com',
        type: 'installed',
        clientSecret: true,
      },
    })
    .returning();
  const accountCredentialId = await nextCredentialId();
  const [account] = await db
    .insert(integrationCredential)
    .values({
      id: accountCredentialId,
      teamId: owner!.id,
      integrationKey: 'google',
      label: 'owner@example.com',
      ...sealCredential(accountCredentialId, JSON.stringify({ refreshToken: '1//refresh' })),
      redacted: {
        email: 'owner@example.com',
        engine: 'helena',
        clientCredentialId: client!.id,
        services: ['mail'],
        grantedScopes: ['https://mail.google.com/'],
        refreshToken: true,
      },
    })
    .returning();
  const [mailbox] = await db
    .insert(mailAccount)
    .values({
      teamId: owner!.id,
      projectId: home!.id,
      name: 'owner@example.com',
      address: 'owner@example.com',
      imapHost: 'imap.gmail.com',
      smtpHost: 'smtp.gmail.com',
      username: 'owner@example.com',
      credentialId: account!.id,
      auth: 'xoauth2',
      ...overrides,
    })
    .returning();
  return { teamId: owner!.id, projectId: home!.id, accountId: account!.id, mailbox: mailbox! };
}

async function sync(): Promise<SyncAccount> {
  const [account] = await loadSyncAccounts();
  const client = mailTransport().imap(await connectSettings(account!));
  await client.connect();
  try {
    await new AccountSync(account!, config).fullPass(client);
  } finally {
    client.close();
  }
  return account!;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY);
}

function rfcDate(date: Date): string {
  return date.toUTCString().replace('GMT', '+0000');
}

function mail(id: string, date: Date, attachment = false) {
  return eml({
    id,
    date: rfcDate(date),
    subject: id,
    attachment: attachment
      ? { name: `${id.replace(/[<>@.]/g, '')}.pdf`, content: 'pdf' }
      : undefined,
  });
}

async function storedIds(): Promise<string[]> {
  const rows = await db.select({ id: mailMessage.messageId }).from(mailMessage);
  return rows.map((row) => row.id).sort();
}

async function filesUnder(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(path.relative(root, full));
    }
  }
  await walk(root);
  return out.sort();
}

describe('XOAUTH2 mailbox', () => {
  it('signs in with the Google account’s access token, fetched for each connection', async () => {
    await googleMailbox();
    const [account] = await loadSyncAccounts();
    expect(account).toMatchObject({ auth: 'xoauth2', fetchDays: 30 });
    expect(account!.settings.password).toBeUndefined();
    const settings = await connectSettings(account!);
    expect(settings).toMatchObject({ username: 'owner@example.com', accessToken: 'ya29.mailbox' });
    expect(settings.password).toBeUndefined();

    server.add('INBOX', mail('<new@x>', daysAgo(1)), [], daysAgo(1));
    await sync();
    expect(opened.at(-1)).toEqual({
      username: 'owner@example.com',
      accessToken: 'ya29.mailbox',
      password: undefined,
    });
    expect(await storedIds()).toEqual(['<new@x>']);
  });

  it('marks the Google account for a new sign-in when Google refuses the grant', async () => {
    const { accountId } = await googleMailbox();
    tokenAnswer = { status: 400, body: { error: 'invalid_grant' } };
    const [account] = await loadSyncAccounts();
    await expect(connectSettings(account!)).rejects.toThrow(/Sign in to the account again/);
    const [row] = await db
      .select({ status: integrationCredential.status })
      .from(integrationCredential)
      .where(eq(integrationCredential.id, accountId));
    expect(row!.status).toBe('needs_auth');
  });
});

describe('fetch window', () => {
  it('imports only mail inside the window, asking the server with SINCE', async () => {
    await googleMailbox({ fetchDays: 30 });
    server.add('INBOX', mail('<old@x>', daysAgo(90)), [], daysAgo(90));
    server.add('INBOX', mail('<recent@x>', daysAgo(3)), [], daysAgo(3));
    server.add('[Gmail]/All Mail', mail('<archived-old@x>', daysAgo(45)), [], daysAgo(45));
    await sync();
    expect(await storedIds()).toEqual(['<recent@x>']);
    const [folder] = await db.select().from(mailFolder).where(eq(mailFolder.path, 'INBOX'));
    expect(folder!.totalCount).toBe(1);
  });

  it('imports everything without a window', async () => {
    await googleMailbox({ fetchDays: null });
    server.add('INBOX', mail('<old@x>', daysAgo(900)), [], daysAgo(900));
    server.add('INBOX', mail('<recent@x>', daysAgo(3)), [], daysAgo(3));
    await sync();
    expect(await storedIds()).toEqual(['<old@x>', '<recent@x>']);
  });

  it('retains receipt originals when mail leaves the window or the account is reset', async () => {
    const { mailbox, teamId, projectId } = await googleMailbox({ fetchDays: 365 });
    server.add('INBOX', mail('<receipt@x>', daysAgo(200), true), [], daysAgo(200));
    await sync();
    const [attachment] = await db.select().from(mailAttachment);
    await db.insert(helenaReceipt).values({
      teamId,
      projectId,
      source: 'mail',
      mailAttachmentId: attachment!.id,
      vaultPath: attachment!.vaultPath,
      filename: attachment!.filename,
      contentType: attachment!.contentType,
      size: attachment!.size,
      sha256: attachment!.sha256,
    });
    const original = await Bun.file(path.join(vault, attachment!.vaultPath)).arrayBuffer();
    expect(await pruneAccount(mailbox.id, 30)).toBe(1);
    expect(await storedIds()).toEqual([]);
    expect(await Bun.file(path.join(vault, attachment!.vaultPath)).arrayBuffer()).toEqual(original);
    const [receipt] = await db.select().from(helenaReceipt);
    expect(receipt!.mailAttachmentId).toBeNull();
    await sync();
    await wipeAccount(mailbox.id);
    expect(await Bun.file(path.join(vault, attachment!.vaultPath)).arrayBuffer()).toEqual(original);
  });

  it('prunes copies that left the window with their files, but keeps mail a task links to', async () => {
    const { mailbox, teamId, projectId } = await googleMailbox({ fetchDays: 365 });
    server.add('INBOX', mail('<aged@x>', daysAgo(200), true), [], daysAgo(200));
    server.add('INBOX', mail('<linked@x>', daysAgo(210)), [], daysAgo(210));
    server.add('INBOX', mail('<fresh@x>', daysAgo(2), true), [], daysAgo(2));
    await sync();
    expect(await storedIds()).toEqual(['<aged@x>', '<fresh@x>', '<linked@x>']);
    expect((await db.select().from(mailAttachment)).length).toBe(2);
    const before = await filesUnder(vault);
    expect(before.length).toBe(2);

    // A task was made from one thread.
    const [column] = await db
      .insert(projectColumn)
      .values({ projectId, name: 'Todo', position: 0 })
      .returning();
    const [task] = await db
      .insert(issue)
      .values({ projectId, columnId: column!.id, title: 'Answer', sequenceNumber: 1 })
      .returning();
    const [linked] = await db
      .select({ threadId: mailMessage.threadId })
      .from(mailMessage)
      .where(eq(mailMessage.messageId, '<linked@x>'));
    await db.insert(mailThreadIssue).values({ threadId: linked!.threadId, issueId: task!.id });
    void teamId;

    // The owner narrows the window to 30 days.
    await db.update(mailAccount).set({ fetchDays: 30 }).where(eq(mailAccount.id, mailbox.id));
    const pruned = await pruneAccount(mailbox.id, 30);
    expect(pruned).toBe(1);
    expect(await storedIds()).toEqual(['<fresh@x>', '<linked@x>']);
    const after = await filesUnder(vault);
    expect(after.length).toBe(1);
    expect((await db.select().from(mailThread)).length).toBe(2);
    const [row] = await db.select().from(mailAccount).where(eq(mailAccount.id, mailbox.id));
    expect(row!.prunedAt).not.toBeNull();
    // The server's copies are untouched.
    expect(server.messageIdsIn('INBOX')).toEqual(['<aged@x>', '<linked@x>', '<fresh@x>']);
  });
});

describe('reset', () => {
  it('wipes every imported copy and its files, then imports again', async () => {
    const { mailbox } = await googleMailbox({ fetchDays: 30 });
    server.add('INBOX', mail('<one@x>', daysAgo(1), true), [], daysAgo(1));
    await sync();
    expect(await storedIds()).toEqual(['<one@x>']);
    expect((await filesUnder(storage)).length).toBeGreaterThan(0);
    expect((await filesUnder(vault)).length).toBe(1);

    const removed = await wipeAccount(mailbox.id);
    expect(removed).toBe(1);
    expect(await storedIds()).toEqual([]);
    expect(await db.select().from(mailFolder)).toEqual([]);
    expect(await filesUnder(vault)).toEqual([]);
    expect(
      (await filesUnder(storage)).filter((file) => file.includes(`mail/${mailbox.id}/`)),
    ).toEqual([]);
    const [row] = await db.select().from(mailAccount).where(eq(mailAccount.id, mailbox.id));
    expect(row).toMatchObject({ resetRequestedAt: null, syncStatus: 'idle' });

    await sync();
    expect(await storedIds()).toEqual(['<one@x>']);
    void stat;
  });

  it('is carried out by the worker loop when the owner asks for it', async () => {
    const { mailbox } = await googleMailbox({ fetchDays: 30 });
    server.add('INBOX', mail('<one@x>', daysAgo(1)), [], daysAgo(1));
    await sync();
    await db
      .update(mailAccount)
      .set({ resetRequestedAt: new Date() })
      .where(eq(mailAccount.id, mailbox.id));
    const worker = startMailWorker();
    try {
      for (let i = 0; i < 100; i++) {
        const [row] = await db.select().from(mailAccount).where(eq(mailAccount.id, mailbox.id));
        if (row!.resetRequestedAt === null) break;
        await Bun.sleep(50);
      }
      const [row] = await db.select().from(mailAccount).where(eq(mailAccount.id, mailbox.id));
      expect(row!.resetRequestedAt).toBeNull();
    } finally {
      worker.stop();
    }
  });
});

describe('threading', () => {
  async function threadOf(messageId: string): Promise<number> {
    const [row] = await db
      .select({ threadId: mailMessage.threadId })
      .from(mailMessage)
      .where(eq(mailMessage.messageId, messageId));
    return row!.threadId;
  }

  it('follows the thread id the server reports (Gmail X-GM-THRID)', async () => {
    await googleMailbox({ fetchDays: null });
    const day = daysAgo(1);
    server.add('INBOX', eml({ id: '<g1@x>', subject: 'Offer' }), [], day, 'T1');
    // Gmail threads it with the first although no header says so.
    server.add('INBOX', eml({ id: '<g2@x>', subject: 'Re: Offer (forwarded)' }), [], day, 'T1');
    server.add('INBOX', eml({ id: '<g3@x>', subject: 'Offer' }), [], day, 'T2');
    await sync();
    expect(await threadOf('<g1@x>')).toBe(await threadOf('<g2@x>'));
    expect(await threadOf('<g3@x>')).not.toBe(await threadOf('<g1@x>'));
  });

  it('without server ids joins the nearest stored ancestor of References', async () => {
    await googleMailbox({ fetchDays: null });
    server.add('INBOX', eml({ id: '<a@x>', subject: 'Plan' }), [], daysAgo(3));
    server.add(
      'INBOX',
      eml({ id: '<b@x>', subject: 'Re: Plan', inReplyTo: '<a@x>' }),
      [],
      daysAgo(2),
    );
    // C names an ancestor Helena never saw first, then B, and has no In-Reply-To.
    const c = [
      'From: Anna <anna@verve.example>',
      'To: me@home.example',
      'Subject: Re: Plan',
      `Date: ${rfcDate(daysAgo(1))}`,
      'Message-ID: <c@x>',
      'References: <unknown@elsewhere> <b@x>',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Body',
      '',
    ].join('\r\n');
    server.add('INBOX', c, [], daysAgo(1));
    await sync();
    const thread = await threadOf('<a@x>');
    expect(await threadOf('<b@x>')).toBe(thread);
    expect(await threadOf('<c@x>')).toBe(thread);
  });
});
