import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';

beforeEach(resetDb);

describe('active chat preference', () => {
  it('keeps Home and projects separate and clears a deleted conversation', async () => {
    const owner = await signUpTestUser();
    const client = authedApi(owner.cookie);
    await client.projects.post({ key: 'MKT', name: 'Marketing' });
    await client.projects.post({ key: 'OPS', name: 'Operations' });
    const agent = (
      await createAgent(client, 'MKT', {
        name: 'Mia',
        username: 'mia',
        kind: 'external',
      })
    ).data!.agent;
    const sent = await client
      .projects({ projectKey: 'MKT' })
      ['ai-agents']({ agentId: agent.id })
      .chat.post({ prompt: 'Hello' });
    const threadId = sent.data!.threadId;
    const endpoint = client.account['active-chat'];

    expect((await endpoint.get({ query: { scope: 'home' } })).data).toEqual({
      agentId: null,
      threadId: null,
    });
    expect(
      (
        await endpoint.put(
          { agentId: agent.id, threadId },
          {
            query: { scope: 'project:MKT' },
          },
        )
      ).status,
    ).toBe(200);
    await endpoint.put({ agentId: agent.id, threadId }, { query: { scope: 'home' } });
    expect((await endpoint.get({ query: { scope: 'project:MKT' } })).data?.threadId).toBe(threadId);
    expect((await endpoint.get({ query: { scope: 'home' } })).data?.threadId).toBe(threadId);
    expect((await endpoint.get({ query: { scope: 'project:OPS' } })).data?.threadId).toBeNull();
    expect(
      (
        await endpoint.put(
          { agentId: agent.id, threadId },
          {
            query: { scope: 'project:OPS' },
          },
        )
      ).status,
    ).toBe(404);

    await client.chats({ threadId }).delete();
    expect((await endpoint.get({ query: { scope: 'project:MKT' } })).data).toEqual({
      agentId: null,
      threadId: null,
    });
    await client.chats({ threadId }).restore.post();
    expect((await endpoint.get({ query: { scope: 'project:MKT' } })).data?.threadId).toBeNull();
    await endpoint.put(
      { agentId: agent.id, threadId: null },
      {
        query: { scope: 'project:MKT' },
      },
    );
    expect((await endpoint.get({ query: { scope: 'project:MKT' } })).data).toEqual({
      agentId: agent.id,
      threadId: null,
    });
  });

  it('does not expose another member’s chat or inaccessible project', async () => {
    const owner = await signUpTestUser();
    const outsider = await signUpTestUser();
    const client = authedApi(owner.cookie);
    await client.projects.post({ key: 'MKT', name: 'Marketing' });
    const agent = (
      await createAgent(client, 'MKT', {
        name: 'Mia',
        username: 'mia',
        kind: 'external',
      })
    ).data!.agent;
    const sent = await client
      .projects({ projectKey: 'MKT' })
      ['ai-agents']({ agentId: agent.id })
      .chat.post({ prompt: 'Private' });
    const endpoint = authedApi(outsider.cookie).account['active-chat'];
    expect(
      (
        await endpoint.put(
          { agentId: agent.id, threadId: sent.data!.threadId },
          {
            query: { scope: 'home' },
          },
        )
      ).status,
    ).toBe(404);
    expect((await endpoint.get({ query: { scope: 'project:MKT' } })).status).toBe(404);
  });
});
