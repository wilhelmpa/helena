import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';
import { addProjectMember } from '#tests/helpers/members';

const account = {
  name: 'Privat',
  address: 'Me@Home.example',
  projectId: null,
  imapHost: '203.0.113.10',
  imapPort: 993,
  imapTls: true,
  smtpHost: '203.0.113.10',
  smtpPort: 465,
  smtpTls: true,
  username: 'me@home.example',
  password: 'app-password',
};

async function setup() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  const project = (await asOwner.projects.post({ key: 'VOL', name: 'Volition' })).data!;
  return { asOwner, project, teamId: project.teamId };
}

describe('mail accounts', () => {
  beforeEach(resetDb);
  afterEach(() => {
    delete process.env.SSRF_ALLOWED_HOSTS;
  });

  it('adds an account without ever returning its password', async () => {
    const { asOwner, teamId, project } = await setup();
    const created = await asOwner.teams({ teamId }).mail.accounts.post({
      ...account,
      projectId: project.id,
    });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({
      address: 'me@home.example',
      projectId: project.id,
      projectKey: 'VOL',
      hasPassword: true,
      syncStatus: 'idle',
      progress: { synced: 0, total: 0 },
    });
    expect(JSON.stringify(created.data)).not.toContain('app-password');
    expect(created.data!.credentialLabel).toBe('Mail: me@home.example');

    const secrets = await asOwner.teams({ teamId }).credentials.get({ query: { kind: 'secret' } });
    expect(secrets.data!.items).toMatchObject([
      {
        id: created.data!.credentialId,
        label: 'Mail: me@home.example',
        projectId: project.id,
        secrets: ['value'],
      },
    ]);

    const listed = await asOwner.teams({ teamId }).mail.accounts.get();
    expect(listed.data).toHaveLength(1);
    const inProject = await asOwner.projects({ projectKey: 'VOL' }).mail.accounts.get();
    expect(inProject.data!.map((item) => item.address)).toEqual(['me@home.example']);

    const duplicate = await asOwner.teams({ teamId }).mail.accounts.post(account);
    expect(duplicate.status).toBe(409);
  });

  it('refuses a private server address and a project of another team', async () => {
    const { asOwner, teamId } = await setup();
    const privateHost = await asOwner
      .teams({ teamId })
      .mail.accounts.post({ ...account, imapHost: '10.0.0.5' });
    expect(privateHost.status).toBe(400);
    const other = await signUpTestUser();
    const foreign = (await authedApi(other.cookie).projects.post({ key: 'OTH', name: 'Other' }))
      .data!;
    const wrongProject = await asOwner
      .teams({ teamId })
      .mail.accounts.post({ ...account, projectId: foreign.id });
    expect(wrongProject.status).toBe(400);
    const badPort = await asOwner.teams({ teamId }).mail.accounts.post({ ...account, imapPort: 0 });
    expect(badPort.status).toBe(400);
  });

  it('takes the password from a secret of the Credentials page', async () => {
    const { asOwner, teamId, project } = await setup();
    const other = (await asOwner.projects.post({ key: 'OTH', name: 'Other' })).data!;
    const secret = (
      await asOwner.teams({ teamId }).credentials.post({
        kind: 'secret',
        label: 'Gmail app password',
        value: 'app-password',
      })
    ).data!;
    const limited = (
      await asOwner.teams({ teamId }).credentials.post({
        kind: 'secret',
        label: 'Other project',
        projectId: other.id,
        value: 'x',
      })
    ).data!;
    const login = (
      await asOwner.teams({ teamId }).credentials.post({
        kind: 'api_key',
        label: 'Key',
        value: 'x',
      })
    ).data!;
    const { password: _password, ...withoutPassword } = account;

    expect((await asOwner.teams({ teamId }).mail.accounts.post(withoutPassword)).status).toBe(400);
    for (const credentialId of [login.id, limited.id, 999999]) {
      const refused = await asOwner
        .teams({ teamId })
        .mail.accounts.post({ ...withoutPassword, projectId: project.id, credentialId });
      expect(refused.status).toBe(400);
    }
    const created = await asOwner
      .teams({ teamId })
      .mail.accounts.post({ ...withoutPassword, projectId: project.id, credentialId: secret.id });
    expect(created.data).toMatchObject({
      credentialId: secret.id,
      credentialLabel: 'Gmail app password',
      hasPassword: true,
    });

    await asOwner
      .teams({ teamId })
      .mail.accounts({ accountId: created.data!.id })
      .patch({ password: 'new-app-password' });
    const secrets = await asOwner.teams({ teamId }).credentials.get({ query: { kind: 'secret' } });
    expect(secrets.data!.items).toHaveLength(2);

    await asOwner.teams({ teamId }).credentials({ credentialId: secret.id }).delete();
    const [row] = (await asOwner.teams({ teamId }).mail.accounts.get()).data!;
    expect(row).toMatchObject({ credentialId: null, hasPassword: false });
  });

  it('changes an account, keeps the password when none is given and removes it', async () => {
    const { asOwner, teamId } = await setup();
    const created = (await asOwner.teams({ teamId }).mail.accounts.post(account)).data!;
    const accounts = asOwner.teams({ teamId }).mail.accounts({ accountId: created.id });
    const changed = await accounts.patch({ name: 'Private', syncTrash: true });
    expect(changed.data).toMatchObject({ name: 'Private', syncTrash: true, hasPassword: true });
    expect((await accounts.delete()).status).toBe(204);
    expect((await asOwner.teams({ teamId }).mail.accounts.get()).data).toEqual([]);
    expect((await accounts.patch({ name: 'x' })).status).toBe(404);
  });

  it('reports the import progress over the imported folders', async () => {
    const { asOwner, teamId } = await setup();
    const { accountId } = await insertMailAccount(teamId, null);
    const { db, mailFolder } = await import('@repo/db');
    await db.update(mailFolder).set({ totalCount: 10, syncedCount: 4 });
    const [row] = (await asOwner.teams({ teamId }).mail.accounts.get()).data!;
    expect(row).toMatchObject({ id: accountId, progress: { synced: 8, total: 20 } });
  });

  it('tests the IMAP and SMTP login and names what went wrong', async () => {
    const { asOwner, teamId } = await setup();
    process.env.SSRF_ALLOWED_HOSTS = 'localhost';
    const result = await asOwner.teams({ teamId }).mail.accounts.test.post({
      ...account,
      imapHost: 'localhost',
      imapPort: 1,
      smtpHost: 'localhost',
      smtpPort: 1,
    });
    expect(result.status).toBe(200);
    expect(result.data!.imap).toBeString();
    expect(result.data!.smtp).toBeString();
    const noPassword = await asOwner.teams({ teamId }).mail.accounts.test.post({
      ...account,
      password: undefined,
    });
    expect(noPassword.status).toBe(400);
  });

  it('leaves the accounts to those who manage the integrations', async () => {
    const { asOwner, teamId } = await setup();
    const member = await addProjectMember(asOwner, 'VOL');
    expect((await member.teams({ teamId }).mail.accounts.get()).status).toBe(403);
    expect((await member.teams({ teamId }).mail.accounts.post(account)).status).toBe(403);
  });
});

describe('mail rules', () => {
  beforeEach(resetDb);

  it('adds a rule and moves the threads it matches when asked', async () => {
    const { asOwner, teamId, project } = await setup();
    const verve = (await asOwner.projects.post({ key: 'VERV', name: 'Verve' })).data!;
    const { accountId, inboxId } = await insertMailAccount(teamId, project.id);
    const matching = await insertMessage({
      teamId,
      accountId,
      folderId: inboxId,
      projectId: project.id,
      projectKey: 'VOL',
      attachments: [{ filename: 'offer.pdf', content: 'offer' }],
    });
    const other = await insertMessage({
      teamId,
      accountId,
      folderId: inboxId,
      projectId: project.id,
      fromAddress: 'bob@elsewhere.example',
    });

    const created = await asOwner.teams({ teamId }).mail.rules.post({
      accountId: null,
      matchType: 'domain',
      value: '@Verve.example',
      projectId: verve.id,
      applyToExisting: true,
    });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({
      rule: { matchType: 'domain', value: 'verve.example', projectKey: 'VERV' },
      movedThreads: 1,
    });
    const moved = await asOwner.mail.threads({ threadId: matching.threadId }).get();
    expect(moved.data!.projectKey).toBe('VERV');
    expect(moved.data!.messages[0]!.attachments[0]!.vaultPath).toStartWith(
      'Projects/VERV/Files/Mail/',
    );
    const kept = await asOwner.mail.threads({ threadId: other.threadId }).get();
    expect(kept.data!.projectKey).toBe('VOL');

    const rules = await asOwner.teams({ teamId }).mail.rules.get();
    expect(rules.data).toHaveLength(1);
    const removed = await asOwner
      .teams({ teamId })
      .mail.rules({ ruleId: rules.data![0]!.id })
      .delete();
    expect(removed.status).toBe(204);
  });

  it('refuses an invalid address', async () => {
    const { asOwner, teamId, project } = await setup();
    const res = await asOwner.teams({ teamId }).mail.rules.post({
      accountId: null,
      matchType: 'address',
      value: 'not-an-address',
      projectId: project.id,
    });
    expect(res.status).toBe(400);
  });
});
