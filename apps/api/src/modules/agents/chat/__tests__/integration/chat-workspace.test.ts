import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { db, helenaReceipt, noteBoard, project } from '@repo/db';
import { eq } from 'drizzle-orm';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { addProjectMember } from '#tests/helpers/members';
import { createAgent, teamOf } from '#tests/helpers/agents';
import { freshVault } from '#tests/helpers/vault';

// The chat list across agents, the tree of versions a chat's messages form, and the
// vault files and tasks a question carries.

process.env.AGENT_CHAT_CLAIM_WAIT_MS = '50';
process.env.AGENT_CHAT_CLAIM_POLL_MS = '10';

let vault: string;

beforeEach(async () => {
  await resetDb();
  vault = freshVault();
});

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
  const mkt = await createAgent(asOwner, 'MKT', { name: 'Mia', username: 'mia', kind: 'external' });
  const ops = await createAgent(asOwner, 'OPS', {
    name: 'Otto',
    username: 'otto',
    kind: 'external',
  });
  return {
    owner,
    asOwner,
    mia: mkt.data!.agent,
    otto: ops.data!.agent,
    asMia: apiKeyApi(mkt.data!.apiKey!),
    asOtto: apiKeyApi(ops.data!.apiKey!),
  };
}

const chatOf = (api: Api, projectKey: string, agentId: number) =>
  api.projects({ projectKey })['ai-agents']({ agentId });

async function answer(asRunner: Api, text: string, extra: { sessionId?: string } = {}) {
  const claimed = (await asRunner['agent-chats'].claim.post()).data!.message!;
  await asRunner['agent-chats']({ messageId: claimed.id }).events.post({
    events: [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: text }],
    ...extra,
  });
  await asRunner['agent-chats']({ messageId: claimed.id }).result.post({ status: 'success' });
  return claimed;
}

describe('chat list', () => {
  it('passes a canonical knowledge ref to the agent and refuses foreign project refs', async () => {
    const { asOwner, mia, asMia } = await setup();
    const mkt = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
    const own = (
      await asOwner
        .projects({ projectKey: 'MKT' })
        .issues.post({ columnId: mkt.columns[0].id, title: 'Knowledge task' })
    ).data!;
    const sent = await chatOf(asOwner, 'MKT', mia.id).chat.post({
      prompt: 'Read this',
      attachments: { refs: [`issue:${own.id}`] },
    });
    expect(sent.status).toBe(200);
    const claimed = (await asMia['agent-chats'].claim.post()).data!.message!;
    expect(claimed.prompt).toContain(`issue:${own.id} "Knowledge task"`);
    const ops = (await asOwner.projects({ projectKey: 'OPS' }).get()).data!;
    const foreign = (
      await asOwner
        .projects({ projectKey: 'OPS' })
        .issues.post({ columnId: ops.columns[0].id, title: 'Foreign task' })
    ).data!;
    expect(
      (
        await chatOf(asOwner, 'MKT', mia.id).chat.post({
          prompt: 'Read this',
          attachments: { refs: [`issue:${foreign.id}`] },
        })
      ).status,
    ).toBe(404);
  });
  it("lists the member's chats of every agent, and a project's own", async () => {
    const { asOwner, mia, otto, asMia, asOtto } = await setup();
    const first = await chatOf(asOwner, 'MKT', mia.id).chat.post({ prompt: 'Launch plan' });
    await answer(asMia, 'Here it is.');
    await chatOf(asOwner, 'OPS', otto.id).chat.post({ prompt: 'Backup status' });
    await answer(asOtto, 'All green.');
    const home = await asOwner
      .teams({ teamId: await teamOf(asOwner, 'MKT') })
      ['ai-agents']({ agentId: mia.id })
      .chat.post({ prompt: 'Home question' });

    const all = await asOwner.chats.get({ query: {} });
    expect(all.status).toBe(200);
    expect(all.data!.total).toBe(3);
    expect(all.data!.items.map((chat) => chat.title)).toEqual([
      'Home question',
      'Backup status',
      'Launch plan',
    ]);
    expect(all.data!.items[0]).toMatchObject({
      id: home.data!.threadId,
      project: null,
      agent: { id: mia.id, name: 'Mia' },
      running: true,
    });

    const mkt = await asOwner.chats.get({ query: { projectKey: 'MKT' } });
    expect(mkt.data!.items.map((chat) => chat.id)).toEqual([first.data!.threadId]);
    expect(mkt.data!.items[0]).toMatchObject({
      project: { key: 'MKT', name: 'Marketing' },
      running: false,
    });

    const byAgent = await asOwner.chats.get({ query: { agentId: otto.id } });
    expect(byAgent.data!.items.map((chat) => chat.title)).toEqual(['Backup status']);
    expect((await asOwner.chats.get({ query: { projectKey: 'NOPE' } })).status).toBe(404);
  });

  it("keeps another member's chats out of the list and out of reach", async () => {
    const { asOwner, mia } = await setup();
    const sent = await chatOf(asOwner, 'MKT', mia.id).chat.post({ prompt: 'Private' });
    const asMember = await addProjectMember(asOwner, 'MKT');

    expect((await asMember.chats.get({ query: {} })).data!.items).toEqual([]);
    const chat = asMember.chats({ threadId: sent.data!.threadId });
    expect((await chat.get()).status).toBe(404);
    expect((await chat.patch({ title: 'Mine now' })).status).toBe(404);
    expect((await chat.pin.put()).status).toBe(404);
    expect((await chat.delete()).status).toBe(404);
  });

  it('finds a chat by its title and by the text of its messages', async () => {
    const { asOwner, mia, asMia } = await setup();
    await chatOf(asOwner, 'MKT', mia.id).chat.post({ prompt: 'Budget review' });
    await answer(asMia, 'The pricing page needs a rewrite.');
    await chatOf(asOwner, 'MKT', mia.id).chat.post({ prompt: 'Pricing ideas' });

    const hits = await asOwner.chats.get({ query: { q: 'pricing' } });
    expect(hits.data!.items.map((chat) => [chat.title, chat.match])).toEqual([
      ['Pricing ideas', 'title'],
      ['Budget review', 'assistant'],
    ]);
    expect(hits.data!.items[1].snippet).toContain('pricing page');
    expect((await asOwner.chats.get({ query: { q: 'p' } })).data!.total).toBe(2);
  });

  it('pins, renames, archives, deletes and restores a chat', async () => {
    const { asOwner, mia, asMia } = await setup();
    const older = await chatOf(asOwner, 'MKT', mia.id).chat.post({ prompt: 'Older' });
    await answer(asMia, 'Ok.');
    await chatOf(asOwner, 'MKT', mia.id).chat.post({ prompt: 'Newer' });
    const chat = asOwner.chats({ threadId: older.data!.threadId });

    expect((await chat.pin.put()).status).toBe(204);
    expect((await chat.patch({ title: 'Renamed' })).status).toBe(204);
    const pinned = await asOwner.chats.get({ query: {} });
    expect(pinned.data!.items.map((c) => [c.title, c.pinned])).toEqual([
      ['Renamed', true],
      ['Newer', false],
    ]);

    expect((await chat.patch({ archived: true })).status).toBe(204);
    expect((await asOwner.chats.get({ query: {} })).data!.total).toBe(1);
    const archived = await asOwner.chats.get({ query: { view: 'archived' } });
    expect(archived.data!.items.map((c) => c.title)).toEqual(['Renamed']);
    expect(archived.data!.items[0].archivedAt).not.toBeNull();

    expect((await chat.delete()).status).toBe(204);
    expect((await asOwner.chats.get({ query: { view: 'archived' } })).data!.total).toBe(0);
    const trash = await asOwner.chats.get({ query: { view: 'trash' } });
    expect(trash.data!.items.map((c) => c.title)).toEqual(['Renamed']);
    expect((await chat.get()).data!.deletedAt).not.toBeNull();

    expect((await chat.restore.post()).status).toBe(204);
    expect((await chat.restore.post()).status).toBe(404);
    expect((await asOwner.chats.get({ query: { view: 'archived' } })).data!.total).toBe(1);

    // Only a chat in the trash is deleted for good.
    expect((await chat.delete(undefined, { query: { permanent: true } })).status).toBe(404);
    await chat.delete();
    expect((await chat.delete(undefined, { query: { permanent: true } })).status).toBe(204);
    expect((await chat.get()).status).toBe(404);
  });

  it('moves all chats of a list to the trash and empties it, keeping a running answer', async () => {
    const { asOwner, mia, otto, asMia, asOtto } = await setup();
    await chatOf(asOwner, 'MKT', mia.id).chat.post({ prompt: 'One' });
    await answer(asMia, 'Ok.');
    await chatOf(asOwner, 'MKT', mia.id).chat.post({ prompt: 'Two' });
    await answer(asMia, 'Ok.');
    await chatOf(asOwner, 'OPS', otto.id).chat.post({ prompt: 'Other project' });
    await answer(asOtto, 'Ok.');
    // Still being answered: stays where it is.
    const running = await chatOf(asOwner, 'MKT', mia.id).chat.post({ prompt: 'Running' });

    const moved = await asOwner.chats['trash-all'].post({ projectKey: 'MKT' });
    expect(moved.status).toBe(200);
    expect(moved.data!.count).toBe(2);
    expect((await asOwner.chats.get({ query: {} })).data!.items.map((c) => c.title)).toEqual([
      'Running',
      'Other project',
    ]);
    expect(
      (await asOwner.chats.get({ query: { view: 'trash' } })).data!.items.map((c) => c.title),
    ).toEqual(['Two', 'One']);
    expect((await asOwner.chats['trash-all'].post({ projectKey: 'NOPE' })).status).toBe(404);

    // Another member's list is untouched by their own "Alle löschen".
    const asMember = await addProjectMember(asOwner, 'MKT');
    expect((await asMember.chats['trash-all'].post({})).data!.count).toBe(0);
    expect((await asMember.chats['empty-trash'].post({ confirmed: true })).data!.count).toBe(0);

    const emptied = await asOwner.chats['empty-trash'].post({ confirmed: true });
    expect(emptied.data!.count).toBe(2);
    expect((await asOwner.chats.get({ query: { view: 'trash' } })).data!.total).toBe(0);
    expect((await asOwner.chats({ threadId: running.data!.threadId }).get()).status).toBe(200);
  });

  it('takes a message into an archived chat and lists it again', async () => {
    const { asOwner, mia, asMia } = await setup();
    const sent = await chatOf(asOwner, 'MKT', mia.id).chat.post({ prompt: 'Later' });
    await answer(asMia, 'Ok.');
    await asOwner.chats({ threadId: sent.data!.threadId }).patch({ archived: true });

    await chatOf(asOwner, 'MKT', mia.id).chat.post({
      prompt: 'Back to it',
      threadId: sent.data!.threadId,
    });
    expect((await asOwner.chats.get({ query: {} })).data!.items[0].archivedAt).toBeNull();
  });

  it('refuses a deleted chat, and a chat of another scope', async () => {
    const { asOwner, mia } = await setup();
    const sent = await chatOf(asOwner, 'MKT', mia.id).chat.post({ prompt: 'Scoped' });
    const teamId = await teamOf(asOwner, 'MKT');
    const home = asOwner.teams({ teamId })['ai-agents']({ agentId: mia.id });
    expect(
      (await home.chat.post({ prompt: 'From Home', threadId: sent.data!.threadId })).status,
    ).toBe(404);

    await asOwner.chats({ threadId: sent.data!.threadId }).delete();
    const again = await chatOf(asOwner, 'MKT', mia.id).chat.post({
      prompt: 'Still there?',
      threadId: sent.data!.threadId,
    });
    expect(again.status).toBe(404);
  });

  it('links a task and lists the chat on it', async () => {
    const { asOwner, mia } = await setup();
    const view = await asOwner.projects({ projectKey: 'MKT' }).get();
    const task = await asOwner
      .projects({ projectKey: 'MKT' })
      .issues.post({ columnId: view.data!.columns[0].id, title: 'Landing page' });
    const sent = await chatOf(asOwner, 'MKT', mia.id).chat.post({ prompt: 'About the task' });
    const chat = asOwner.chats({ threadId: sent.data!.threadId });

    expect((await chat.patch({ issueId: task.data!.id })).status).toBe(204);
    expect((await chat.get()).data!.issue).toMatchObject({
      id: task.data!.id,
      identifier: 'MKT-1',
      title: 'Landing page',
    });
    const linked = await asOwner.issues({ issueId: task.data!.id }).chats.get();
    expect(linked.data!.map((c) => c.id)).toEqual([sent.data!.threadId]);

    // Another member of the project sees the task, but not the owner's chat on it.
    const asMember = await addProjectMember(asOwner, 'MKT');
    expect((await asMember.issues({ issueId: task.data!.id }).chats.get()).data).toEqual([]);
    const outsider = authedApi((await signUpTestUser()).cookie);
    expect((await outsider.issues({ issueId: task.data!.id }).chats.get()).status).toBe(403);

    expect((await chat.patch({ issueId: 999_999 })).status).toBe(404);
    expect((await chat.patch({ issueId: null })).status).toBe(204);
    expect((await asOwner.issues({ issueId: task.data!.id }).chats.get()).data).toEqual([]);
  });

  // The `/usage` chat command reads this single-chat route rather than the list, so it
  // carries the same context size the thread list shows (see "keeps the context size
  // the runner reported with the answer" for that one).
  it('carries the context size of its last completed answer', async () => {
    const { asOwner, asMia, mia } = await setup();
    const sent = await chatOf(asOwner, 'MKT', mia.id).chat.post({ prompt: 'Status?' });
    const chat = asOwner.chats({ threadId: sent.data!.threadId });

    expect((await chat.get()).data!.contextTokens).toBeUndefined();

    const claimed = (await asMia['agent-chats'].claim.post()).data!.message!;
    await asMia['agent-chats']({ messageId: claimed.id }).result.post({
      status: 'success',
      usage: { inputTokens: 900, outputTokens: 100 },
    });

    expect((await chat.get()).data!.contextTokens).toBe(1000);
  });
});

describe('chat versions', () => {
  it('keeps an edited question and a regenerated answer as versions', async () => {
    const { asOwner, mia, asMia } = await setup();
    const chat = chatOf(asOwner, 'MKT', mia.id);
    const first = await chat.chat.post({ prompt: 'Who owns the launch?' });
    const threadId = first.data!.threadId;
    await answer(asMia, 'Maria does.');
    await chat.chat.post({ prompt: 'And the date?', threadId });
    await answer(asMia, 'June 1.');

    // The first question edited: a new first message, answered on a branch of its own.
    const edited = await chat.chat.post({
      prompt: 'Who owns the relaunch?',
      threadId,
      parentId: null,
    });
    expect(edited.status).toBe(200);
    const claimed = (await asMia['agent-chats'].claim.post()).data!.message!;
    // The other branch is not part of this conversation.
    expect(claimed.prompt).toBe('Who owns the relaunch?');
    await asMia['agent-chats']({ messageId: claimed.id }).events.post({
      events: [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'Tom does.' }],
    });
    await asMia['agent-chats']({ messageId: claimed.id }).result.post({ status: 'success' });

    const shown = await chat.threads({ threadId }).messages.get();
    expect(shown.data!.items.map((m) => m.parts)).toEqual([
      [{ type: 'text', text: 'Who owns the relaunch?' }],
      [{ type: 'text', text: 'Tom does.' }],
    ]);
    const question = shown.data!.items[0];
    expect(question.parentId).toBeNull();
    expect(question.siblingIds).toEqual([String(first.data!.userMessageId), question.id]);

    // Back to the first version: its conversation, down to the newest answer, is shown.
    const back = await asOwner
      .chats({ threadId })
      .active.put({ messageId: first.data!.userMessageId });
    expect(back.status).toBe(204);
    const restored = await chat.threads({ threadId }).messages.get();
    expect(restored.data!.items.map((m) => m.parts[0])).toEqual([
      { type: 'text', text: 'Who owns the launch?' },
      { type: 'text', text: 'Maria does.' },
      { type: 'text', text: 'And the date?' },
      { type: 'text', text: 'June 1.' },
    ]);

    // Another answer to the last question sits next to the first one.
    const questionId = Number(restored.data!.items[2].id);
    const retried = await chat.chat.retry.post({ threadId, questionId });
    expect(retried.status).toBe(200);
    const again = (await asMia['agent-chats'].claim.post()).data!.message!;
    expect(again.id).toBe(retried.data!.messageId);
    expect(again.prompt).toContain('Person: Who owns the launch?');
    expect(again.prompt).toContain('You: Maria does.');
    expect(again.prompt).not.toContain('June 1.');
    expect(again.prompt).toEndWith('And the date?');
    await asMia['agent-chats']({ messageId: again.id }).events.post({
      events: [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'Early June.' }],
    });
    await asMia['agent-chats']({ messageId: again.id }).result.post({ status: 'success' });
    const answers = (await chat.threads({ threadId }).messages.get()).data!.items;
    expect(answers.at(-1)!.parts).toEqual([{ type: 'text', text: 'Early June.' }]);
    expect(answers.at(-1)!.siblingIds).toHaveLength(2);

    expect(
      (await chat.chat.retry.post({ threadId, questionId: Number(answers.at(-1)!.id) })).status,
    ).toBe(400);
    expect((await asOwner.chats({ threadId }).active.put({ messageId: 999_999 })).status).toBe(404);
    expect((await chat.chat.post({ prompt: 'x', threadId, parentId: 999_999 })).status).toBe(400);
  });

  it('resumes a session only from the answer it ended on', async () => {
    const { asOwner, mia, asMia } = await setup();
    const chat = chatOf(asOwner, 'MKT', mia.id);
    const first = await chat.chat.post({ prompt: 'One' });
    const threadId = first.data!.threadId;
    await answer(asMia, 'First.', { sessionId: 'sess-1' });
    await chat.chat.post({ prompt: 'Two', threadId });
    const second = await answer(asMia, 'Second.');
    expect(second.sessionId).toBe('sess-1');

    // Answering the second question again: the session already holds the first answer
    // to it, so the new one is sent the branch and starts a session of its own.
    const shown = (await chat.threads({ threadId }).messages.get()).data!.items;
    await chat.chat.retry.post({ threadId, questionId: Number(shown[2].id) });
    const retried = await answer(asMia, 'Second, again.', { sessionId: 'sess-2' });
    expect(retried.sessionId).toBeNull();
    expect(retried.prompt).toContain('You: First.');
    expect(retried.prompt).toEndWith('Two');

    // A question after the newest answer of a session continues it; one after an
    // older answer of it does not.
    await chat.chat.post({ prompt: 'Three', threadId });
    const third = await answer(asMia, 'Third.');
    expect(third.sessionId).toBe('sess-2');
    expect(third.prompt).toBe('Three');

    await chat.chat.post({ prompt: 'Two again', threadId, parentId: Number(shown[1].id) });
    const branched = (await asMia['agent-chats'].claim.post()).data!.message!;
    expect(branched.sessionId).toBeNull();
    expect(branched.prompt).toContain('You: First.');
    expect(branched.prompt).toEndWith('Two again');
  });

  it('reports the model, the tokens, the duration and a failed tool of an answer', async () => {
    const { asOwner, mia, asMia } = await setup();
    const chat = chatOf(asOwner, 'MKT', mia.id);
    const sent = await chat.chat.post({ prompt: 'Check the build' });
    const claimed = (await asMia['agent-chats'].claim.post()).data!.message!;
    await asMia['agent-chats']({ messageId: claimed.id }).events.post({
      events: [
        { type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'terminal' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '{"command":"make"}' },
        {
          type: 'TOOL_CALL_RESULT',
          messageId: 'm',
          toolCallId: 't1',
          content: 'exit 2',
          isError: true,
        },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'The build fails.' },
      ],
    });
    await asMia['agent-chats']({ messageId: claimed.id }).result.post({
      status: 'success',
      model: 'openai/gpt-5.5',
      usage: { inputTokens: 1200, outputTokens: 80 },
    });

    const [, reply] = (await chat.threads({ threadId: sent.data!.threadId }).messages.get()).data!
      .items;
    expect(reply).toMatchObject({
      agentId: mia.id,
      model: 'openai/gpt-5.5',
      inputTokens: 1200,
      outputTokens: 80,
      parts: [
        {
          type: 'tool',
          toolName: 'terminal',
          args: '{"command":"make"}',
          result: 'exit 2',
          isError: true,
        },
        { type: 'text', text: 'The build fails.' },
      ],
    });
    expect(reply.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps a failed answer with its error, to be tried again', async () => {
    const { asOwner, mia, asMia } = await setup();
    const chat = chatOf(asOwner, 'MKT', mia.id);
    const sent = await chat.chat.post({ prompt: 'Go' });
    const claimed = (await asMia['agent-chats'].claim.post()).data!.message!;
    await asMia['agent-chats']({ messageId: claimed.id }).result.post({
      status: 'failed',
      error: 'Provider refused the request',
    });
    const items = (await chat.threads({ threadId: sent.data!.threadId }).messages.get()).data!
      .items;
    expect(items[1]).toMatchObject({ parts: [], error: 'Provider refused the request' });
  });
});

describe('chat attachments', () => {
  function vaultFile(relative: string, content = 'x') {
    const target = path.join(vault, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  it('passes a picked browser image as visual input', async () => {
    const { asOwner, mia, asMia } = await setup();
    const uploaded = await asOwner
      .projects({ projectKey: 'MKT' })
      .files.upload.post(
        { files: [new File(['png'], 'frame.png', { type: 'image/png' })] },
        { query: { path: 'Files/Browser' } },
      );
    expect(uploaded.status).toBe(201);
    const ref = 'vault:Projects/MKT/Files/Browser/frame.png';
    const sent = await chatOf(asOwner, 'MKT', mia.id).chat.post({
      prompt: 'Was ist auf dem Bild?',
      attachments: { refs: [ref] },
    });
    expect(sent.status).toBe(200);
    const claimed = (await asMia['agent-chats'].claim.post()).data!.message!;
    expect(claimed.images).toContain(path.join(vault, 'Projects/MKT/Files/Browser/frame.png'));
    expect(claimed.prompt).toContain(ref);
  });

  it('hands an explicit receipt reference and its original to the project agent', async () => {
    const { asOwner, mia, asMia } = await setup();
    const [scope] = await db
      .select({ id: project.id, teamId: project.teamId })
      .from(project)
      .where(eq(project.key, 'MKT'));
    const original = 'Projects/MKT/Files/Belege/original.pdf';
    vaultFile(original, '%PDF-1.4');
    const [receipt] = await db
      .insert(helenaReceipt)
      .values({
        teamId: scope!.teamId,
        projectId: scope!.id,
        source: 'vault',
        vaultPath: original,
        filename: 'original.pdf',
        sha256: 'chat-receipt-119',
        textExcerpt: 'Rechnung für Kühlung',
      })
      .returning({ id: helenaReceipt.id });
    const sent = await chatOf(asOwner, 'MKT', mia.id).chat.post({
      prompt: 'Prüfe den Beleg',
      attachments: { refs: [`receipt:${receipt!.id}`] },
    });
    expect(sent.status).toBe(200);
    const claimed = (await asMia['agent-chats'].claim.post()).data!.message!;
    expect(claimed.prompt).toContain(`receipt:${receipt!.id}`);
    expect(claimed.prompt).toContain(`Original file: ${path.join(vault, original)}`);
    expect(claimed.prompt).toContain('Attached content snapshot');
  });

  it('passes a private canvas as an explicit snapshot', async () => {
    const { asOwner, owner, mia, asMia } = await setup();
    const [scope] = await db.select({ id: project.id }).from(project).where(eq(project.key, 'MKT'));
    const [board] = await db
      .insert(noteBoard)
      .values({
        projectId: scope!.id,
        ownerUserId: owner.userId,
        createdByUserId: owner.userId,
        name: 'Privater Plan',
        canvas: { nodes: [{ data: { text: 'Vertrauliche Skizze' } }] },
      })
      .returning({ id: noteBoard.id });
    const sent = await chatOf(asOwner, 'MKT', mia.id).chat.post({
      prompt: 'Lies die Leinwand',
      attachments: { refs: [`board:${board!.id}`] },
    });
    expect(sent.status).toBe(200);
    const claimed = (await asMia['agent-chats'].claim.post()).data!.message!;
    expect(claimed.prompt).toContain(`board:${board!.id}`);
    expect(claimed.prompt).toContain('Vertrauliche Skizze');
  });

  it('hands vault files and tasks to the agent by path and reference', async () => {
    const { asOwner, mia, asMia } = await setup();
    const uploaded = await asOwner
      .projects({ projectKey: 'MKT' })
      .files.upload.post(
        { files: [new File(['png'], 'shot.png', { type: 'image/png' })] },
        { query: { path: 'Files/Chat/2026-09-23' } },
      );
    expect(uploaded.status).toBe(201);
    vaultFile('Home/Notes/brief.md', '# Brief');
    const view = await asOwner.projects({ projectKey: 'MKT' }).get();
    const task = await asOwner
      .projects({ projectKey: 'MKT' })
      .issues.post({ columnId: view.data!.columns[0].id, title: 'Landing page' });

    const sent = await chatOf(asOwner, 'MKT', mia.id).chat.post({
      prompt: 'What is on the screenshot?',
      attachments: {
        files: ['Projects/MKT/Files/Chat/2026-09-23/shot.png', 'Home/Notes/brief.md'],
        issueIds: [task.data!.id],
      },
    });
    expect(sent.status).toBe(200);

    const claimed = (await asMia['agent-chats'].claim.post()).data!.message!;
    const image = path.join(vault, 'Projects/MKT/Files/Chat/2026-09-23/shot.png');
    expect(claimed.images).toEqual([image]);
    expect(claimed.prompt).toBe(
      [
        'What is on the screenshot?',
        '',
        'Attached files (read them from disk):',
        `- ${image} (image/png)`,
        `- ${path.join(vault, 'Home/Notes/brief.md')} (text/markdown; charset=utf-8)`,
        '',
        "Tasks the person refers to (read them with Ava's tools):",
        '- MKT-1 "Landing page"',
      ].join('\n'),
    );

    const [question] = (
      await chatOf(asOwner, 'MKT', mia.id).threads({ threadId: sent.data!.threadId }).messages.get()
    ).data!.items;
    expect(question.parts).toEqual([{ type: 'text', text: 'What is on the screenshot?' }]);
    expect(question.attachments).toEqual([
      {
        kind: 'file',
        path: 'Projects/MKT/Files/Chat/2026-09-23/shot.png',
        name: 'shot.png',
        contentType: 'image/png',
        sizeBytes: 3,
      },
      {
        kind: 'file',
        path: 'Home/Notes/brief.md',
        name: 'brief.md',
        contentType: 'text/markdown; charset=utf-8',
        sizeBytes: 7,
      },
      { kind: 'task', issueId: task.data!.id, identifier: 'MKT-1', title: 'Landing page' },
    ]);
  });

  it('refuses files the member may not hand over', async () => {
    const { asOwner, mia } = await setup();
    vaultFile('Private/secret.md');
    vaultFile('Projects/OPS/Docs/runbook.md');
    vaultFile('Home/Notes/owner-only.md');
    vaultFile('Templates/shared.md');
    const chat = chatOf(asOwner, 'MKT', mia.id);
    const send = (files: string[]) =>
      chat.chat.post({ prompt: 'Read this', attachments: { files } });

    expect((await send(['Private/secret.md'])).status).toBe(400);
    expect((await send(['Projects/MKT/missing.md'])).status).toBe(404);
    expect((await send(['Projects/MKT/../OPS/Docs/runbook.md'])).status).toBe(400);
    expect((await send(Array.from({ length: 11 }, (_, i) => `Home/${i}.md`))).status).toBe(400);

    // A member of MKT only cannot hand over a file of OPS.
    const asMember = await addProjectMember(asOwner, 'MKT');
    const memberChat = chatOf(asMember, 'MKT', mia.id);
    expect(
      (
        await memberChat.chat.post({
          prompt: 'Read this',
          attachments: { files: ['Home/Notes/owner-only.md'] },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await memberChat.chat.post({
          prompt: 'Read this',
          attachments: { files: ['Templates/shared.md'] },
        })
      ).status,
    ).toBe(200);
    expect((await send(['Home/Notes/owner-only.md'])).status).toBe(200);
    expect(
      (
        await memberChat.chat.post({
          prompt: 'Read this',
          attachments: { files: ['Projects/OPS/Docs/runbook.md'] },
        })
      ).status,
    ).toBe(404);
    // The owner, a member of both, can.
    expect((await send(['Projects/OPS/Docs/runbook.md'])).status).toBe(200);
  });
});
