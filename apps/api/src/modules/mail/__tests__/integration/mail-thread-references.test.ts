import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';

describe('mail thread references', () => {
  beforeEach(resetDb);

  async function setup() {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    const project = (await api.projects.post({ key: 'MAIL', name: 'Mail' })).data!;
    const account = await insertMailAccount(project.teamId, project.id);
    return { api, project, account };
  }

  it.each(['2147483648', '9007199254740991', '999999999999999999999', '18b7ffed'])(
    'reads and drafts using external reference %s without treating it as a database integer',
    async (reference) => {
      const { api, project, account } = await setup();
      const message = await insertMessage({
        teamId: project.teamId,
        accountId: account.accountId,
        folderId: account.inboxId,
        projectId: project.id,
        messageId: `thread:${reference}`,
      });
      const threads = api.projects({ projectKey: project.key }).mail.threads;
      const external = await threads({ threadId: reference }).get();
      expect(external.status).toBe(200);
      expect(external.data?.threadId).toBe(message.threadId);
      const numeric = await threads({ threadId: String(message.threadId) }).get();
      expect(numeric.data?.threadId).toBe(message.threadId);
      const draft = await threads({ threadId: reference })['draft-reply'].post({
        body: 'Local draft only.',
      });
      expect(draft.status).toBe(201);
      expect(draft.data?.status).toBe('draft');
    },
  );

  it('returns 404 for an unknown large numeric reference', async () => {
    const { api, project } = await setup();
    const thread = api
      .projects({ projectKey: project.key })
      .mail.threads({ threadId: '2147483648' });
    expect((await thread.get()).status).toBe(404);
    expect((await thread['draft-reply'].post({ body: 'Never created.' })).status).toBe(404);
  });

  it("never resolves another project's external reference", async () => {
    const { api, project, account } = await setup();
    const foreign = (await api.projects.post({ key: 'OTHER', name: 'Other' })).data!;
    await insertMessage({
      teamId: project.teamId,
      accountId: account.accountId,
      folderId: account.inboxId,
      projectId: foreign.id,
      messageId: 'thread:2147483648',
    });
    const thread = api
      .projects({ projectKey: project.key })
      .mail.threads({ threadId: '2147483648' });
    expect((await thread.get()).status).toBe(404);
    expect((await thread['draft-reply'].post({ body: 'Never created.' })).status).toBe(404);
  });
});
