import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { createAgent } from '#tests/helpers/agents';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';

async function setup() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  const vol = (await asOwner.projects.post({ key: 'VOL', name: 'Volition' })).data!;
  const teamId = vol.teamId;
  const account = await insertMailAccount(teamId, vol.id);
  const message = await insertMessage({
    teamId,
    accountId: account.accountId,
    folderId: account.inboxId,
    projectId: vol.id,
    projectKey: 'VOL',
    subject: 'Termin',
    text: 'Passt Dienstag?\nGruß Anna',
    to: [
      { name: 'Me', address: 'me@home.example' },
      { name: 'Carl', address: 'carl@verve.example' },
    ],
    cc: [{ name: 'Dora', address: 'dora@verve.example' }],
    attachments: [{ filename: 'termin.pdf', content: 'pdf' }],
  });
  return { owner, asOwner, vol, teamId, account, message };
}

describe('mail drafts', () => {
  beforeEach(resetDb);

  it('prefills an answer, an answer to all and a forward', async () => {
    const { asOwner, teamId, message } = await setup();
    const drafts = asOwner.teams({ teamId }).mail.drafts;
    const reply = await drafts.post({ mode: 'reply', messageId: message.messageRowId });
    expect(reply.status).toBe(201);
    expect(reply.data).toMatchObject({
      mode: 'reply',
      accountAddress: 'me@home.example',
      threadId: message.threadId,
      replyToMessageId: message.messageRowId,
      to: [{ name: 'Anna', address: 'anna@verve.example' }],
      cc: [],
      subject: 'Re: Termin',
      status: 'draft',
    });
    expect(reply.data!.bodyText).toContain('> Passt Dienstag?\n> Gruß Anna');
    expect(reply.data!.bodyHtml).toContain('<blockquote>');

    const all = await drafts.post({ mode: 'reply_all', messageId: message.messageRowId });
    expect(all.data!.cc.map((item) => item.address)).toEqual([
      'carl@verve.example',
      'dora@verve.example',
    ]);

    const forward = await drafts.post({ mode: 'forward', messageId: message.messageRowId });
    expect(forward.data).toMatchObject({ subject: 'Fwd: Termin', to: [], replyToMessageId: null });
    expect(forward.data!.attachments).toMatchObject([
      { source: 'vault', filename: 'termin.pdf', contentType: 'application/pdf' },
    ]);
    expect(forward.data!.bodyText).toContain('---------- Forwarded message ----------');

    expect((await drafts.post({ mode: 'reply' })).status).toBe(400);
    expect((await drafts.post({ mode: 'new' })).status).toBe(400);
  });

  it('saves a draft, keeps only known attachments and lists the open drafts', async () => {
    const { asOwner, teamId, account } = await setup();
    const created = (
      await asOwner
        .teams({ teamId })
        .mail.drafts.post({ mode: 'new', accountId: account.accountId })
    ).data!;
    const draft = asOwner.mail.drafts({ draftId: created.id });
    const saved = await draft.patch({
      to: [{ name: '', address: 'bob@other.example' }],
      subject: 'Hallo',
      bodyText: '**Hallo** Bob',
      bodyHtml: '<p><strong>Hallo</strong> Bob</p>',
      attachments: [{ source: 'vault', ref: 'Projects/VOL/secret.txt' }],
    });
    expect(saved.data).toMatchObject({ subject: 'Hallo', attachments: [] });
    expect((await draft.patch({ to: [{ name: '', address: 'not-an-address' }] })).status).toBe(400);

    const upload = await draft.attachments.post({
      file: new File(['hello'], 'notes.txt', { type: 'text/plain' }),
    });
    expect(upload.status).toBe(201);
    expect(upload.data!.attachments).toMatchObject([
      { source: 'storage', filename: 'notes.txt', contentType: 'text/plain', size: 5 },
    ]);

    const listed = await asOwner.teams({ teamId }).mail.drafts.get();
    expect(listed.data!.map((item) => item.id)).toEqual([created.id]);
    expect((await draft.delete()).status).toBe(204);
    expect((await draft.get()).status).toBe(404);
  });

  it('attaches a vault file the caller may read', async () => {
    const { asOwner, teamId, account } = await setup();
    const folder = path.join(process.env.PROJECT_VAULT_ROOT!, 'Projects', 'VOL', 'Docs');
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'brief.md'), '# Brief');
    const created = (
      await asOwner
        .teams({ teamId })
        .mail.drafts.post({ mode: 'new', accountId: account.accountId })
    ).data!;
    const vault = asOwner.mail.drafts({ draftId: created.id })['vault-attachments'];
    const attached = await vault.post({ path: 'Projects/VOL/Docs/brief.md' });
    expect(attached.status).toBe(201);
    expect(attached.data!.attachments).toMatchObject([
      { source: 'vault', ref: 'Projects/VOL/Docs/brief.md', filename: 'brief.md', size: 7 },
    ]);
    expect((await vault.post({ path: 'Projects/VOL/Docs/missing.md' })).status).toBe(404);
    expect((await vault.post({ path: 'Projects/VOL/../../etc/passwd' })).status).toBe(400);
    expect((await vault.post({ path: 'Privat/diary.md' })).status).toBe(403);
  });

  it('sends after the undo time and can be taken back before', async () => {
    const { asOwner, teamId, message } = await setup();
    const created = (
      await asOwner
        .teams({ teamId })
        .mail.drafts.post({ mode: 'reply', messageId: message.messageRowId })
    ).data!;
    const draft = asOwner.mail.drafts({ draftId: created.id });
    const sent = await draft.send.post();
    expect(sent.status).toBe(200);
    expect(sent.data!.status).toBe('queued');
    const waitMs = new Date(sent.data!.sendAt!).getTime() - Date.now();
    expect(waitMs).toBeGreaterThan(8000);
    expect(waitMs).toBeLessThanOrEqual(10_000);
    expect((await draft.patch({ subject: 'x' })).status).toBe(409);

    const undone = await draft.undo.post();
    expect(undone.data).toMatchObject({ status: 'draft', sendAt: null });
    expect((await draft.undo.post()).status).toBe(409);
  });

  it('refuses to send without recipients', async () => {
    const { asOwner, teamId, account } = await setup();
    const created = (
      await asOwner
        .teams({ teamId })
        .mail.drafts.post({ mode: 'new', accountId: account.accountId })
    ).data!;
    expect((await asOwner.mail.drafts({ draftId: created.id }).send.post()).status).toBe(400);
  });
});

describe('mail drafts of an agent', () => {
  beforeEach(resetDb);

  it('drafts an answer and asks for approval, but never sends itself', async () => {
    const { asOwner, message } = await setup();
    const created = await createAgent(asOwner, 'VOL', {
      name: 'Coordinator',
      username: 'coord',
      kind: 'external',
    });
    const asAgent = apiKeyApi(created.data!.apiKey!);

    const draft = await asAgent
      .projects({ projectKey: 'VOL' })
      .mail.threads({ threadId: message.threadId })
      ['draft-reply'].post({ body: 'Dienstag passt.' });
    expect(draft.status).toBe(201);
    expect(draft.data).toMatchObject({
      mode: 'reply',
      subject: 'Re: Termin',
      to: [{ address: 'anna@verve.example' }],
      createdByName: 'Coordinator',
      status: 'draft',
    });
    expect(draft.data!.bodyText).toStartWith('Dienstag passt.\n\n');

    const direct = await asAgent.mail.drafts({ draftId: draft.data!.id }).send.post();
    expect(direct.status).toBe(403);

    const asked = await asAgent
      .projects({ projectKey: 'VOL' })
      .mail.drafts({ draftId: draft.data!.id })
      ['request-send'].post();
    expect(asked.status).toBe(200);
    expect(asked.data).toMatchObject({ draftId: draft.data!.id, status: 'pending_approval' });
    const approval = await asOwner.approvals({ approvalId: asked.data!.approvalId }).get();
    expect(approval.data).toMatchObject({ kind: 'send', status: 'pending' });
    expect(approval.data!.action).toBe('Send the mail "Re: Termin" to anna@verve.example');
    expect(approval.data!.details).toContain('Dienstag passt.');

    const again = await asAgent
      .projects({ projectKey: 'VOL' })
      .mail.drafts({ draftId: draft.data!.id })
      ['request-send'].post();
    expect(again.status).toBe(409);
    const person = await asOwner.mail.drafts({ draftId: draft.data!.id }).send.post();
    expect(person.status).toBe(409);
  });

  it('refuses a person on the agent route', async () => {
    const { asOwner, teamId, account } = await setup();
    const created = (
      await asOwner
        .teams({ teamId })
        .mail.drafts.post({ mode: 'new', accountId: account.accountId })
    ).data!;
    const res = await asOwner
      .projects({ projectKey: 'VOL' })
      .mail.drafts({ draftId: created.id })
      ['request-send'].post();
    expect(res.status).toBe(403);
  });
});
