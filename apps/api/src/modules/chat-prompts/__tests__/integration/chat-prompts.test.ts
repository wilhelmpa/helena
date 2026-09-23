import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { addProjectMember } from '#tests/helpers/members';

// A member's prompt library: Home prompts everywhere, a project's in its chats only.

beforeEach(resetDb);

async function setup() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
  return { asOwner };
}

describe('chat prompts', () => {
  it('offers Home prompts everywhere and a project prompt in its project only', async () => {
    const { asOwner } = await setup();
    const home = await asOwner['chat-prompts'].post({
      command: 'summary',
      title: 'Summarize',
      content: 'Summarize {{topic}} in three bullets.',
    });
    expect(home.status).toBe(201);
    expect(home.data).toMatchObject({ command: 'summary', project: null });
    await asOwner['chat-prompts'].post({
      command: 'release',
      title: 'Release notes',
      content: 'Write the release notes for {{version}}.',
      projectKey: 'MKT',
    });

    const inHome = await asOwner['chat-prompts'].get({ query: {} });
    expect(inHome.data!.map((p) => p.command)).toEqual(['summary']);
    const inMkt = await asOwner['chat-prompts'].get({ query: { projectKey: 'MKT' } });
    expect(inMkt.data!.map((p) => [p.command, p.project?.key ?? null])).toEqual([
      ['release', 'MKT'],
      ['summary', null],
    ]);
    const inOps = await asOwner['chat-prompts'].get({ query: { projectKey: 'OPS' } });
    expect(inOps.data!.map((p) => p.command)).toEqual(['summary']);
  });

  it('keeps a command unique per scope and valid', async () => {
    const { asOwner } = await setup();
    const body = { command: 'todo', title: 'Todo', content: 'List what is left.' };
    expect((await asOwner['chat-prompts'].post(body)).status).toBe(201);
    expect((await asOwner['chat-prompts'].post(body)).status).toBe(409);
    expect((await asOwner['chat-prompts'].post({ ...body, projectKey: 'MKT' })).status).toBe(201);
    expect((await asOwner['chat-prompts'].post({ ...body, command: 'Not Valid' })).status).toBe(
      400,
    );
    expect((await asOwner['chat-prompts'].post({ ...body, content: '' })).status).toBe(400);
  });

  it("edits and deletes the member's own prompts only", async () => {
    const { asOwner } = await setup();
    const created = await asOwner['chat-prompts'].post({
      command: 'standup',
      title: 'Standup',
      content: 'What did {{person}} do?',
    });
    const prompt = asOwner['chat-prompts']({ promptId: created.data!.id });
    const updated = await prompt.patch({ title: 'Daily standup' });
    expect(updated.data).toMatchObject({ title: 'Daily standup', command: 'standup' });

    const asMember = await addProjectMember(asOwner, 'MKT');
    expect((await asMember['chat-prompts'].get({ query: {} })).data).toEqual([]);
    const theirs = asMember['chat-prompts']({ promptId: created.data!.id });
    expect((await theirs.patch({ title: 'Mine' })).status).toBe(404);
    expect((await theirs.delete()).status).toBe(404);
    expect(
      (
        await asMember['chat-prompts'].post({
          command: 'x',
          title: 'X',
          content: 'x',
          projectKey: 'OPS',
        })
      ).status,
    ).toBe(404);

    expect((await prompt.delete()).status).toBe(204);
    expect((await asOwner['chat-prompts'].get({ query: {} })).data).toEqual([]);
  });
});
