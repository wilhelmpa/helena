import { beforeEach, describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { db, mailAction, mailContact } from '@repo/db';
import { apiKeyApi, app, authedApi } from '#tests/helpers/app';
import { createAgent } from '#tests/helpers/agents';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';
import { addProjectMember } from '#tests/helpers/members';

const INLINE_RAW = [
  'Message-ID: <inline@verve.example>',
  'Subject: Logo',
  'MIME-Version: 1.0',
  'Content-Type: multipart/related; boundary="r"',
  '',
  '--r',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Hi</p><img src="cid:logo@x">',
  '--r',
  'Content-Type: image/png',
  'Content-ID: <logo@x>',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('PNGDATA').toString('base64'),
  '--r--',
  '',
].join('\r\n');

async function setup() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  const vol = (await asOwner.projects.post({ key: 'VOL', name: 'Volition' })).data!;
  const verve = (await asOwner.projects.post({ key: 'VERV', name: 'Verve' })).data!;
  const teamId = vol.teamId;
  const home = await insertMailAccount(teamId, null);
  return { owner, asOwner, vol, verve, teamId, home };
}

function request(cookie: string, pathname: string, init: RequestInit = {}) {
  return app.handle(
    new Request(`http://localhost${pathname}`, { ...init, headers: { cookie, ...init.headers } }),
  );
}

describe('mail threads', () => {
  beforeEach(resetDb);

  it('lists threads newest first with filters, search and paging', async () => {
    const { asOwner, teamId, home, vol } = await setup();
    const older = await insertMessage({
      teamId,
      accountId: home.accountId,
      folderId: home.inboxId,
      subject: 'Rechnung März',
      text: 'Bitte überweisen',
      sentAt: new Date('2026-03-01T10:00:00Z'),
      seen: true,
    });
    const newer = await insertMessage({
      teamId,
      accountId: home.accountId,
      folderId: home.inboxId,
      projectId: vol.id,
      subject: 'Offer',
      sentAt: new Date('2026-03-02T10:00:00Z'),
      attachments: [{ filename: 'offer.pdf', content: 'x' }],
      projectKey: 'VOL',
    });
    await insertMessage({
      teamId,
      accountId: home.accountId,
      folderId: home.sentId,
      subject: 'Sent one',
      sentAt: new Date('2026-03-03T10:00:00Z'),
      seen: true,
    });
    const threads = asOwner.teams({ teamId }).mail.threads;

    const inbox = await threads.get({ query: { role: 'inbox' } });
    expect(inbox.status).toBe(200);
    expect(inbox.data!.items.map((row) => row.id)).toEqual([newer.threadId, older.threadId]);
    expect(inbox.data!.items[0]).toMatchObject({
      subject: 'Offer',
      projectKey: 'VOL',
      unread: true,
      hasAttachments: true,
      messageCount: 1,
      accountAddress: 'me@home.example',
    });
    expect(
      (await threads.get({ query: { role: 'inbox', unread: 'true' } })).data!.items,
    ).toHaveLength(1);
    expect((await threads.get({ query: { attachments: 'true' } })).data!.items).toHaveLength(1);
    expect(
      (await threads.get({ query: { home: 'true', role: 'inbox' } })).data!.items.map(
        (row) => row.id,
      ),
    ).toEqual([older.threadId]);
    expect(
      (await threads.get({ query: { projectId: vol.id } })).data!.items.map((row) => row.id),
    ).toEqual([newer.threadId]);
    expect((await threads.get({ query: { q: 'märz' } })).data!.items.map((row) => row.id)).toEqual([
      older.threadId,
    ]);
    expect((await threads.get({ query: { q: 'überw' } })).data!.items.map((row) => row.id)).toEqual(
      [older.threadId],
    );
    expect((await threads.get({ query: { q: 'anna@verve' } })).data!.items).toHaveLength(3);

    const first = await threads.get({ query: { limit: 2 } });
    expect(first.data!.items).toHaveLength(2);
    expect(first.data!.nextCursor).toBeString();
    const second = await threads.get({ query: { limit: 2, cursor: first.data!.nextCursor! } });
    expect(second.data!.items.map((row) => row.id)).toEqual([older.threadId]);
    expect(second.data!.nextCursor).toBeNull();
    expect((await threads.get({ query: { cursor: 'nope' } })).status).toBe(400);
  });

  it('shows members the mail of their projects and no Home mail', async () => {
    const { asOwner, teamId, home, vol, verve } = await setup();
    const projectMail = await insertMessage({
      teamId,
      accountId: home.accountId,
      folderId: home.inboxId,
      projectId: vol.id,
    });
    const homeMail = await insertMessage({
      teamId,
      accountId: home.accountId,
      folderId: home.inboxId,
    });
    await insertMessage({
      teamId,
      accountId: home.accountId,
      folderId: home.inboxId,
      projectId: verve.id,
    });
    const member = await addProjectMember(asOwner, 'VOL');

    const listed = await member.teams({ teamId }).mail.threads.get({ query: {} });
    expect(listed.data!.items.map((row) => row.id)).toEqual([projectMail.threadId]);
    expect(
      (await member.teams({ teamId }).mail.threads.get({ query: { home: 'true' } })).status,
    ).toBe(403);
    expect(
      (await member.teams({ teamId }).mail.threads.get({ query: { projectId: verve.id } })).status,
    ).toBe(403);
    expect((await member.mail.threads({ threadId: homeMail.threadId }).get()).status).toBe(403);
    expect((await member.mail.threads({ threadId: projectMail.threadId }).get()).status).toBe(200);
    const stranger = authedApi((await signUpTestUser()).cookie);
    expect((await stranger.mail.threads({ threadId: projectMail.threadId }).get()).status).toBe(
      404,
    );
    expect((await stranger.teams({ teamId }).mail.threads.get({ query: {} })).status).toBe(404);
  });

  it('serves a thread with cid images from the api and remote images only when allowed', async () => {
    const { owner, asOwner, teamId, home } = await setup();
    const { threadId, messageRowId } = await insertMessage({
      teamId,
      accountId: home.accountId,
      folderId: home.inboxId,
      raw: INLINE_RAW,
      html: '<p>Hi</p><img src="cid:logo@x" /><img data-remote-src="https://t.example/p.gif" />',
    });
    const thread = await asOwner.mail.threads({ threadId }).get();
    const html = thread.data!.messages[0]!.html!;
    expect(html).toContain(`src="mail/messages/${messageRowId}/parts/logo%40x"`);
    expect(html).not.toMatch(/\ssrc="https:\/\/t\.example/);

    await asOwner.mail.messages({ messageId: messageRowId })['remote-images'].post({ allow: true });
    const allowed = await asOwner.mail.threads({ threadId }).get();
    expect(allowed.data!.messages[0]).toMatchObject({ allowRemoteImages: true });
    expect(allowed.data!.messages[0]!.html).toContain('src="https://t.example/p.gif"');

    const part = await request(owner.cookie, `/mail/messages/${messageRowId}/parts/logo%40x`);
    expect(part.status).toBe(200);
    expect(part.headers.get('content-type')).toBe('image/png');
    expect(await part.text()).toBe('PNGDATA');
    expect((await request(owner.cookie, `/mail/messages/${messageRowId}/parts/none`)).status).toBe(
      404,
    );
  });

  it('marks, archives and deletes a thread and queues the change for the server', async () => {
    const { asOwner, teamId, home } = await setup();
    const { threadId } = await insertMessage({
      teamId,
      accountId: home.accountId,
      folderId: home.inboxId,
    });
    const actions = asOwner.mail.threads({ threadId }).actions;

    expect((await actions.post({ action: 'read' })).status).toBe(204);
    expect((await asOwner.mail.threads({ threadId }).get()).data!.messages[0]!.seen).toBe(true);
    await actions.post({ action: 'flag' });
    expect((await asOwner.mail.threads({ threadId }).get()).data!.messages[0]!.flagged).toBe(true);

    await actions.post({ action: 'archive' });
    const inbox = await asOwner.teams({ teamId }).mail.threads.get({ query: { role: 'inbox' } });
    expect(inbox.data!.items).toEqual([]);
    const queued = await db.select().from(mailAction);
    expect(queued.map((row) => row.kind)).toEqual(['seen', 'flag', 'archive']);

    await actions.post({ action: 'trash' });
    expect((await asOwner.teams({ teamId }).mail.threads.get({ query: {} })).data!.items).toEqual(
      [],
    );
  });

  it('moves a thread to a project together with its attachment folder', async () => {
    const { asOwner, teamId, home, verve } = await setup();
    const { threadId } = await insertMessage({
      teamId,
      accountId: home.accountId,
      folderId: home.inboxId,
      subject: 'Plan',
      attachments: [{ filename: 'plan.pdf', content: 'plan' }],
    });
    const before = (await asOwner.mail.threads({ threadId }).get()).data!;
    expect(before.messages[0]!.attachments[0]!.vaultPath).toStartWith('Home/Files/Mail/2026/03/');

    expect((await asOwner.mail.threads({ threadId }).patch({ projectId: verve.id })).status).toBe(
      204,
    );
    const after = (await asOwner.mail.threads({ threadId }).get()).data!;
    expect(after).toMatchObject({ projectKey: 'VERV', suggestedProjectId: null });
    const moved = after.messages[0]!.attachments[0]!.vaultPath;
    expect(moved).toStartWith('Projects/VERV/Files/Mail/2026/03/');
    expect(await readFile(path.join(process.env.PROJECT_VAULT_ROOT!, moved), 'utf8')).toBe('plan');

    const other = await signUpTestUser();
    const foreign = (await authedApi(other.cookie).projects.post({ key: 'OTH', name: 'O' })).data!;
    expect((await asOwner.mail.threads({ threadId }).patch({ projectId: foreign.id })).status).toBe(
      403,
    );
    expect((await asOwner.mail.threads({ threadId }).patch({ projectId: null })).status).toBe(204);
  });

  it('makes a task linked to the thread and saves the thread as a note', async () => {
    const { asOwner, teamId, home, vol } = await setup();
    const { threadId } = await insertMessage({
      teamId,
      accountId: home.accountId,
      folderId: home.inboxId,
      subject: 'Angebot',
      text: 'Anbei das Angebot.',
      attachments: [{ filename: 'angebot.pdf', content: 'pdf' }],
    });
    expect((await asOwner.mail.threads({ threadId }).task.post({})).status).toBe(400);
    const task = await asOwner.mail.threads({ threadId }).task.post({ projectId: vol.id });
    expect(task.status).toBe(201);
    expect(task.data).toMatchObject({ projectKey: 'VOL' });
    const issue = await asOwner.issues({ issueId: task.data!.issueId }).get();
    expect(issue.data).toMatchObject({ title: 'Angebot' });
    expect(issue.data!.description).toContain(`(/project/VOL/inbox?thread=${threadId})`);
    expect(issue.data!.description).toContain('> Anbei das Angebot.');
    expect(issue.data!.description).toContain('Projects/VOL/Files/Mail/2026/03/');
    const linked = await asOwner.issues({ issueId: task.data!.issueId })['mail-threads'].get();
    expect(linked.data!.map((row) => row.id)).toEqual([threadId]);
    expect((await asOwner.mail.threads({ threadId }).get()).data!.issues).toHaveLength(1);

    const note = await asOwner.mail.threads({ threadId }).note.post();
    expect(note.status).toBe(201);
    expect(note.data!.path).toMatch(/^Projects\/VOL\/Docs\/Mail\/2026-03-1\d Angebot\.md$/);
    const text = await readFile(
      path.join(process.env.PROJECT_VAULT_ROOT!, note.data!.path),
      'utf8',
    );
    expect(text).toContain(`plan_mail_thread: ${threadId}`);
    expect(text).toContain('Anbei das Angebot.');
    expect(text).toMatch(/\(\.\.\/\.\.\/Files\/Mail\/2026\/03\/.*angebot\.pdf\)/);
    const again = await asOwner.mail.threads({ threadId }).note.post();
    expect(again.data!.path).toContain('Angebot (2).md');
  });

  it('downloads an attachment from the vault', async () => {
    const { owner, teamId, home } = await setup();
    const { threadId } = await insertMessage({
      teamId,
      accountId: home.accountId,
      folderId: home.inboxId,
      attachments: [{ filename: 'offer.pdf', content: '%PDF offer' }],
    });
    const thread = (await authedApi(owner.cookie).mail.threads({ threadId }).get()).data!;
    const id = thread.messages[0]!.attachments[0]!.id;
    const file = await request(owner.cookie, `/mail/attachments/${id}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain('attachment');
    expect(await file.text()).toBe('%PDF offer');
    expect((await request(owner.cookie, '/mail/attachments/999999')).status).toBe(404);
  });

  it('suggests past correspondents', async () => {
    const { asOwner, teamId } = await setup();
    await db.insert(mailContact).values([
      {
        teamId,
        address: 'anna@verve.example',
        name: 'Anna Berg',
        messageCount: 5,
        lastSeenAt: new Date(),
      },
      {
        teamId,
        address: 'bob@other.example',
        name: 'Bob',
        messageCount: 9,
        lastSeenAt: new Date(),
      },
    ]);
    const found = await asOwner.teams({ teamId }).mail.contacts.get({ query: { q: 'berg' } });
    expect(found.data).toEqual([{ name: 'Anna Berg', address: 'anna@verve.example' }]);
  });
});

describe('mail tools of an agent', () => {
  beforeEach(resetDb);

  it('searches and reads the mail of its project only', async () => {
    const { asOwner, teamId, home, vol, verve } = await setup();
    const own = await insertMessage({
      teamId,
      accountId: home.accountId,
      folderId: home.inboxId,
      projectId: vol.id,
      projectKey: 'VOL',
      subject: 'Kickoff',
      text: 'Agenda attached',
      attachments: [{ filename: 'agenda.pdf', content: 'a' }],
    });
    const foreign = await insertMessage({
      teamId,
      accountId: home.accountId,
      folderId: home.inboxId,
      projectId: verve.id,
      subject: 'Kickoff Verve',
    });
    await insertMessage({
      teamId,
      accountId: home.accountId,
      folderId: home.inboxId,
      subject: 'Kickoff Home',
    });
    const created = await createAgent(asOwner, 'VOL', {
      name: 'Coordinator',
      username: 'coord',
      kind: 'external',
    });
    const asAgent = apiKeyApi(created.data!.apiKey!);

    const found = await asAgent
      .projects({ projectKey: 'VOL' })
      .mail.search.get({ query: { q: 'kickoff' } });
    expect(found.status).toBe(200);
    expect(found.data!.map((row) => row.threadId)).toEqual([own.threadId]);
    const unread = await asAgent
      .projects({ projectKey: 'VOL' })
      .mail.search.get({ query: { unread: true } });
    expect(unread.data!.map((row) => row.threadId)).toEqual([own.threadId]);

    const read = await asAgent
      .projects({ projectKey: 'VOL' })
      .mail.threads({ threadId: own.threadId })
      .get();
    expect(read.data).toMatchObject({
      subject: 'Kickoff',
      messages: [{ text: 'Agenda attached', from: 'Anna <anna@verve.example>' }],
    });
    const file = read.data!.messages[0]!.attachments[0]!;
    expect(file.vaultPath).toStartWith('Projects/VOL/Files/Mail/');
    expect(file.filePath).toBe(path.join(process.env.PROJECT_VAULT_ROOT!, file.vaultPath));

    expect(
      (
        await asAgent
          .projects({ projectKey: 'VOL' })
          .mail.threads({ threadId: foreign.threadId })
          .get()
      ).status,
    ).toBe(404);
    expect((await asAgent.mail.threads({ threadId: foreign.threadId }).get()).status).toBe(403);
    expect(
      (await asAgent.projects({ projectKey: 'VERV' }).mail.search.get({ query: {} })).status,
    ).toBe(403);
  });
});
