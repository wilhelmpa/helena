import { beforeEach, expect, it } from 'bun:test';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { freshVault } from '#tests/helpers/vault';
beforeEach(async () => {
  await resetDb();
  freshVault();
});
it('keeps shared embeds readable only within their active issue token', async () => {
  const owner = authedApi((await signUpTestUser()).cookie);
  await owner.projects.post({ key: 'MKT', name: 'MKT' });
  const columnId = (await owner.projects({ projectKey: 'MKT' }).get()).data!.columns[0].id;
  const first = (
    await owner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Shared' })
  ).data!;
  const other = (
    await owner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Private' })
  ).data!;
  const upload = async (id: number) =>
    (
      await owner
        .issues({ issueId: id })
        .attachments.post({ file: new File(['fixture'], 'source.txt', { type: 'text/plain' }) })
    ).data!;
  const file = await upload(first.id);
  const privateFile = await upload(other.id);
  await owner
    .issues({ issueId: first.id })
    .patch({ description: `![source](/media/attachments/${file.id}/raw)` });
  const token = (await owner.issues({ issueId: first.id }).share.post()).data!.token;
  const shared = await app.handle(new Request(`http://localhost/share/issue/${token}`));
  const sharedBody = (await shared.json()) as { issue: { description: string } };
  expect(sharedBody.issue.description).toContain(
    `/media/share/issue/${token}/attachments/${file.id}/raw`,
  );
  const raw = (id: string) =>
    app.handle(new Request(`http://localhost/share/issue/${token}/attachments/${id}/raw`));
  expect(await (await raw(file.id)).text()).toBe('fixture');
  expect((await raw(privateFile.id)).status).toBe(404);
  await owner.issues({ issueId: first.id }).share.delete();
  expect((await raw(file.id)).status).toBe(404);
});
