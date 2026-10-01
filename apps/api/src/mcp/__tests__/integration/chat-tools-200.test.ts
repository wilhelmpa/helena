import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  aiAgent,
  db,
  helenaMailClassification,
  organizationAgentAssignment,
  pipelineRun,
} from '@repo/db';
import { eq } from 'drizzle-orm';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent, setAgentProjectRole } from '#tests/helpers/agents';
import { createRole } from '#tests/helpers/roles';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';
import { ThreadPageResponse } from '#modules/mail/threads/model';
import { TriageOverviewResponse } from '#modules/mail-triage/model';
import { buildMcpServer } from '../../server';
import { effectiveNativeEscalation } from '#modules/agents/runtime-policy/service';
import { DEFAULT_ESCALATION } from '@helena/sdk';
import { helenaSettings } from '#modules/agents/core/service';
import { agentForPerson } from '#modules/agents/people-access';

const clients: Client[] = [];
async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const own = (await api.projects.post({ key: 'PRIV', name: 'Private' })).data!;
  const other = (await api.projects.post({ key: 'OTHER', name: 'Other' })).data!;
  const created = (await createAgent(api, 'PRIV', { name: 'Coordinator', username: 'coord' }))
    .data!;
  const role = (await createRole(api, 'PRIV', { name: 'Restricted', permissions: {} })).data!;
  await setAgentProjectRole(api, 'PRIV', created.agent.userId, role.id);
  await db
    .insert(organizationAgentAssignment)
    .values({ agentId: created.agent.id, teamId: own.teamId, role: 'coordinator' });
  const server = await buildMcpServer(
    app,
    { kind: 'api-key', apiKey: created.apiKey },
    created.agent.userId,
  );
  const client = new Client({ name: 'volition-chat-tools-test', version: '1' });
  const [transport, peer] = InMemoryTransport.createLinkedPair();
  await server.connect(peer);
  await client.connect(transport);
  clients.push(client);
  const request = (path: string, method = 'GET', body?: object) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { 'x-api-key': created.apiKey, 'content-type': 'application/json' },
        ...(body && { body: JSON.stringify(body) }),
      }),
    );
  return { owner, api, own, other, created, client, request };
}

beforeEach(resetDb);
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
});

describe('chat tool access regression 200', () => {
  it('offers only possible tools, with coordinator reads and triage but no management', async () => {
    const { client, request, own, created } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of [
      'list_decision_classes',
      'read_decision_class',
      'run_mail_triage',
      'get_mail_triage_overview',
      'list_mail_threads_newest_first',
    ])
      expect(names).toContain(name);
    for (const name of [
      'list_unified_inbox_threads',
      'read_one_run_of_agent',
      'send_mail_draft',
      'create_ai_agent',
      'update_decision_class',
      'request_mail_send',
    ])
      expect(names).not.toContain(name);
    expect((await request(`/teams/${own.teamId}/decisions/classes`)).status).toBe(200);
    expect(
      (
        await request(`/teams/${own.teamId}/decisions/classes/helena.mail`, 'PATCH', {
          enabled: true,
        })
      ).status,
    ).toBe(403);
    await db
      .delete(organizationAgentAssignment)
      .where(eq(organizationAgentAssignment.agentId, created.agent.id));
    const server = await buildMcpServer(
      app,
      { kind: 'api-key', apiKey: created.apiKey },
      created.agent.userId,
    );
    const ordinary = new Client({ name: 'ordinary', version: '1' });
    const [transport, peer] = InMemoryTransport.createLinkedPair();
    await server.connect(peer);
    await ordinary.connect(transport);
    clients.push(ordinary);
    const ordinaryNames = (await ordinary.listTools()).tools.map((t) => t.name);
    for (const name of [
      'read_decision_class',
      'run_mail_triage',
      'get_mail_triage_overview',
      'list_mail_threads_newest_first',
    ])
      expect(ordinaryNames).not.toContain(name);
  });

  it('allows coordinator mail and status correction only in its own project and forbids deletion', async () => {
    const { request, own, other, created } = await setup();
    const account = await insertMailAccount(own.teamId, own.id);
    const message = await insertMessage({
      teamId: own.teamId,
      accountId: account.accountId,
      folderId: account.inboxId,
      projectId: own.id,
    });
    const foreign = await insertMessage({
      teamId: own.teamId,
      accountId: account.accountId,
      folderId: account.inboxId,
      projectId: other.id,
    });
    await db.insert(helenaMailClassification).values({
      teamId: own.teamId,
      threadId: message.threadId,
      messageId: message.messageRowId,
      status: 'unsure',
    });
    expect((await request(`/mail/threads/${message.threadId}`)).status).toBe(200);
    expect((await request(`/mail/threads/${foreign.threadId}`)).status).toBe(403);
    const corrected = await request(`/mail/threads/${message.threadId}/classification`, 'PATCH', {
      status: 'classified',
      priority: 'normal',
    });
    expect(corrected.status).toBe(200);
    const [stored] = await db.select().from(helenaMailClassification);
    expect(stored!.status).toBe('classified');
    expect(stored!.correctedByUserId).toBe(created.agent.userId);
    expect(
      (
        await request(`/mail/threads/${message.threadId}/classification`, 'PATCH', {
          projectId: other.id,
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(`/mail/threads/${message.threadId}/actions`, 'POST', { action: 'trash' }))
        .status,
    ).toBe(403);
    // Class is disabled in the fixture: reaching its 409 proves the triage guard passed.
    expect((await request('/projects/PRIV/mail-triage/run', 'POST', {})).status).toBe(409);
    expect((await request('/projects/OTHER/mail-triage/run', 'POST', {})).status).toBe(403);
  });

  it.each(['home', 'all', 'owner', 'team-owner'] as const)(
    'permits %s delegates to inspect same-team agents',
    async (kind) => {
      const { api, own, created, request } = await setup();
      const target = (
        await createAgent(api, 'PRIV', { name: 'Other agent', username: 'otheragent' })
      ).data!.agent.id;
      if (kind === 'home')
        await db.update(aiAgent).set({ agentRole: 'home' }).where(eq(aiAgent.id, created.agent.id));
      if (kind === 'all')
        await db
          .update(aiAgent)
          .set({ projectScope: 'all' })
          .where(eq(aiAgent.id, created.agent.id));
      if (kind === 'owner') {
        const { projectMember } = await import('@repo/db');
        await db
          .update(projectMember)
          .set({ role: 'owner' })
          .where(eq(projectMember.userId, created.agent.userId));
      }
      if (kind === 'team-owner') {
        const { teamMember } = await import('@repo/db');
        await db
          .update(teamMember)
          .set({ role: 'owner' })
          .where(eq(teamMember.userId, created.agent.userId));
      }
      expect((await request(`/teams/${own.teamId}/ai-agents/${target}/runs`)).status).toBe(200);
      expect(
        (
          await agentForPerson(target, {
            teamId: own.teamId,
            role: 'agent',
            userId: created.agent.userId,
          })
        ).projectIds,
      ).toBeUndefined();
      await expect(
        agentForPerson(target, {
          teamId: own.teamId + 100,
          role: 'agent',
          userId: created.agent.userId,
        }),
      ).rejects.toThrow();
    },
  );

  it('paginates tied timestamps with beforeAt/id and emits compact MCP results with limit 25', async () => {
    const { own, client, request } = await setup();
    const account = await insertMailAccount(own.teamId, own.id);
    const ids: number[] = [];
    for (let i = 0; i < 27; i++)
      ids.push(
        (
          await insertMessage({
            teamId: own.teamId,
            accountId: account.accountId,
            folderId: account.inboxId,
            projectId: own.id,
            text: '\u200b\u3164'.repeat(500) + 'Meaningful '.repeat(50),
          })
        ).threadId,
      );
    const first = await request(`/teams/${own.teamId}/mail/threads`);
    const page = (await first.json()) as typeof ThreadPageResponse.static;
    expect(page.items).toHaveLength(25);
    expect(page.items[0].snippet.length).toBeLessThanOrEqual(160);
    expect(page.items[0].snippet).not.toMatch(/[\u200b\u3164]/);
    const last = page.items.at(-1)!;
    const second = await request(
      `/teams/${own.teamId}/mail/threads?beforeAt=${encodeURIComponent(last.lastMessageAt)}&beforeThreadId=${last.id}`,
    );
    expect(
      ((await second.json()) as typeof ThreadPageResponse.static).items.map(
        (r: { id: number }) => r.id,
      ),
    ).toEqual(ids.slice(0, 2).reverse());
    const compact = await client.callTool({
      name: 'list_mail_threads_newest_first',
      arguments: {},
    });
    const result = compact.structuredContent as {
      ok: boolean;
      data: { items: Record<string, unknown>[] };
    };
    expect(result.ok).toBe(true);
    expect(result.data.items).toHaveLength(25);
    expect(result.data.items[0]).not.toHaveProperty('accountName');
  });

  it('overview counts latest classification once and filters project/account without mailbox scans', async () => {
    const { own, other, request } = await setup();
    const account = await insertMailAccount(own.teamId, own.id);
    const second = await insertMailAccount(own.teamId, own.id, 'second@example.test');
    const a = await insertMessage({
      teamId: own.teamId,
      accountId: account.accountId,
      folderId: account.inboxId,
      projectId: own.id,
    });
    const b = await insertMessage({
      teamId: own.teamId,
      accountId: second.accountId,
      folderId: second.inboxId,
      projectId: own.id,
    });
    await insertMessage({
      teamId: own.teamId,
      accountId: account.accountId,
      folderId: account.inboxId,
      projectId: other.id,
    });
    await db.insert(helenaMailClassification).values({
      teamId: own.teamId,
      threadId: a.threadId,
      messageId: a.messageRowId,
      status: 'unsure',
      category: 'other',
      priority: 'normal',
    });
    const older = await insertMessage({
      teamId: own.teamId,
      accountId: account.accountId,
      folderId: account.inboxId,
      projectId: own.id,
      threadId: a.threadId,
    });
    await db.insert(helenaMailClassification).values({
      teamId: own.teamId,
      threadId: a.threadId,
      messageId: older.messageRowId,
      status: 'classified',
      createdAt: new Date('2020-01-01T00:00:00Z'),
    });
    await db.insert(pipelineRun).values({
      id: 'volition-triage-test',
      projectId: own.id,
      kind: 'routine',
      title: 'Mail-Triage · PRIV',
      trigger: 'schedule',
      definition: {},
      status: 'succeeded',
    });
    const res = await request('/projects/PRIV/mail-triage/overview');
    expect(res.status).toBe(200);
    const result = (await res.json()) as typeof TriageOverviewResponse.static;
    expect(result.total).toBe(2);
    expect(result.counts.status).toEqual({ unsure: 1, unclassified: 1 });
    expect(result.unresolved.items.map((r: { threadId: number }) => r.threadId).sort()).toEqual([
      a.threadId,
      b.threadId,
    ]);
    expect(result.settings.id).toBe('helena.mail');
    expect(result.lastRuns).toHaveLength(1);
    const filtered = await request(
      `/projects/PRIV/mail-triage/overview?accountId=${account.accountId}`,
    );
    expect(((await filtered.json()) as typeof TriageOverviewResponse.static).total).toBe(1);
  });
});

it('native budget escalation honors the agent schema even without enabled global rules', () => {
  const policy = {
    model: 'gpt-6.1-sol',
    target: 'codex' as const,
    afterFailures: 2,
    maxDepth: 1,
    onResumeLimit: true,
    onRequest: true,
  };
  const rules = effectiveNativeEscalation(DEFAULT_ESCALATION, policy);
  expect(rules.enabled).toBe(true);
  expect(rules.failure.model).toBe('gpt-6.1-sol');
  expect(rules.kinds).toHaveLength(0);
  expect(effectiveNativeEscalation(DEFAULT_ESCALATION, { ...policy, maxDepth: 0 }).enabled).toBe(
    false,
  );
  expect(
    effectiveNativeEscalation(DEFAULT_ESCALATION, {
      ...policy,
      target: 'claude',
      model: 'claude-sonnet-5-5',
    }).failure.model,
  ).toBe('claude-sonnet-5-5');
  expect(
    helenaSettings({ chatBudgetSeconds: 1200, chatBudgetBehavior: 'fail', chatSummarySeconds: 30 }),
  ).toMatchObject({ chatBudgetSeconds: 1200, chatBudgetBehavior: 'fail', chatSummarySeconds: 30 });
});
