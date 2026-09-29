import { beforeEach, describe, expect, it } from 'bun:test';
import { apiKeyApi, app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { activeOrderContext } from '../../service';
import { bootstrapHomeAgent } from '../../../../scripts/bootstrap-home-agent';

beforeEach(resetDb);

async function rpc(apiKey: string, method: string, params: Record<string, unknown> = {}) {
  const res = await app.handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  const body = await res.text();
  return JSON.parse(body.slice(body.indexOf('data: ') + 6)).result;
}

describe('standing orders', () => {
  it('applies confirmed Helena orders and holds Helena MCP proposals for the owner', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const home = await bootstrapHomeAgent();
    if (home.status !== 'ready') throw new Error('Helena was not provisioned');
    const asOwner = authedApi(owner.cookie);
    const created = await asOwner.helena['standing-orders'].post({
      body: 'Keep replies concise',
      source: 'Owner',
    });
    expect(created.data?.active).toBe(true);
    expect(await activeOrderContext(null, home.agentId)).toContain('Keep replies concise');
    const proposal = await rpc(home.apiKey, 'tools/call', {
      name: 'propose_helena_standing_order',
      arguments: { body: 'Review invoices each morning', source: 'Helena suggestion' },
    });
    expect(proposal.isError).toBeFalsy();
    const pending = JSON.parse(proposal.content[0].text) as { id: number };
    expect(await activeOrderContext(null, home.agentId)).not.toContain('Review invoices');
    const decided = await asOwner.helena['standing-orders']({ orderId: pending.id }).decision.post({
      approved: true,
    });
    expect(decided.data?.status).toBe('confirmed');
    expect(await activeOrderContext(null, home.agentId)).toContain('Review invoices');
  });

  it('keeps agent proposals inactive until a project owner confirms them', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const asOwner = authedApi(owner.cookie);
    await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
    const agent = await createAgent(asOwner, 'MKT', {
      name: 'Worker',
      username: 'worker',
      kind: 'external',
      triggerOnMention: true,
    });
    const asAgent = apiKeyApi(agent.data!.apiKey!);
    const projectId = (await asOwner.projects.get()).data!.find(
      (project) => project.key === 'MKT',
    )!.id;
    const { tools } = await rpc(agent.data!.apiKey!, 'tools/list');
    expect(tools.map((tool: { name: string }) => tool.name)).toContain('propose_standing_order');
    const result = await rpc(agent.data!.apiKey!, 'tools/call', {
      name: 'propose_standing_order',
      arguments: {
        projectKey: 'MKT',
        body: 'Always send X invoices to Y',
        source: 'agent suggestion',
      },
    });
    expect(result.isError).toBeFalsy();
    const proposed = JSON.parse(result.content[0].text) as {
      id: number;
      status: string;
      active: boolean;
    };
    expect(proposed).toMatchObject({ status: 'proposed', active: false });
    expect(await activeOrderContext(projectId, agent.data!.agent.id)).toBe('');
    const denied = await asAgent
      .projects({ projectKey: 'MKT' })
      ['standing-orders']({ orderId: proposed.id })
      .decision.post({ approved: true });
    expect(denied.status).toBe(403);
    const confirmed = await asOwner
      .projects({ projectKey: 'MKT' })
      ['standing-orders']({ orderId: proposed.id })
      .decision.post({ approved: true });
    expect(confirmed.data).toMatchObject({ status: 'confirmed', active: true });
    expect(await activeOrderContext(projectId, agent.data!.agent.id)).toContain(
      'Always send X invoices to Y',
    );
    const off = await asOwner
      .projects({ projectKey: 'MKT' })
      ['standing-orders']({ orderId: proposed.id })
      .patch({ active: false });
    expect(off.data?.active).toBe(false);
    expect(await activeOrderContext(projectId, agent.data!.agent.id)).toBe('');
  });

  it('lets only the owner delete an order for good', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const asOwner = authedApi(owner.cookie);
    await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const agent = await createAgent(asOwner, 'OPS', {
      name: 'Helper',
      username: 'helper',
      kind: 'external',
    });
    const orders = asOwner.projects({ projectKey: 'OPS' })['standing-orders'];
    const created = await orders.post({ body: 'Answer in German', source: 'Owner' });
    const id = created.data!.id;
    const asAgent = apiKeyApi(agent.data!.apiKey!);
    const refused = await asAgent
      .projects({ projectKey: 'OPS' })
      ['standing-orders']({ orderId: id })
      .delete();
    expect(refused.status).toBe(403);
    const removed = await orders({ orderId: id }).delete();
    expect(removed.status).toBe(200);
    expect((await orders.get()).data).toEqual([]);
    expect((await orders({ orderId: id }).delete()).status).toBe(404);

    const home = await bootstrapHomeAgent();
    if (home.status !== 'ready') throw new Error('Helena was not provisioned');
    const helena = await asOwner.helena['standing-orders'].post({
      body: 'Report every Friday',
      source: 'Owner',
    });
    expect(
      (await asOwner.helena['standing-orders']({ orderId: helena.data!.id }).delete()).status,
    ).toBe(200);
    expect(await activeOrderContext(null, home.agentId)).not.toContain('Report every Friday');
  });
});
