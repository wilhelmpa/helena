import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { app, apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { bootstrapHomeAgent } from '../../../../scripts/bootstrap-home-agent';
import { setRootSettings } from '../../service';
import { heldProjects, budgetExhausted } from '#modules/autopilot/budgets';
import { useHostdTransport } from '#modules/server/hostd';
import { agentChatMessage, agentRun, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { createAgent } from '#tests/helpers/agents';
import { connectMcp } from '../../../../../../../packages/agent-runtime/src/tools/mcp';

process.env.AGENT_CHAT_CLAIM_WAIT_MS = '50';
let calls: string[];
let state: { enabled: boolean; directOnly: boolean; unrestricted: boolean; epoch: number };
beforeEach(async () => {
  await resetDb();
  calls = [];
  state = { enabled: true, directOnly: true, unrestricted: true, epoch: 0 };
  useHostdTransport(async (method, input) => {
    calls.push(method);
    if (method === 'SetRootSettings')
      state = {
        enabled: !!input.enabled,
        directOnly: !!input.directOnly,
        unrestricted: input.unrestricted == null ? state.unrestricted : !!input.unrestricted,
        epoch: state.epoch + 1,
      };
    if (method === 'RunPrivileged') {
      if (!state.enabled || input.epoch !== state.epoch) throw new Error('Revoked');
      return { unit: `volition-root-${input.id}.service`, exitCode: 0, output: '0\n' };
    }
    return state;
  });
});
afterEach(() => useHostdTransport(null));

async function setup(runtime = 'hermes') {
  const owner = await signUpTestUser();
  const home = await bootstrapHomeAgent();
  if (home.status !== 'ready') throw new Error('Missing Home fixture');
  const asOwner = authedApi(owner.cookie);
  const project = (await asOwner.projects.post({ key: 'ROOT', name: 'Root proof' })).data!;
  const asHome = apiKeyApi(home.apiKey);
  const sent = await asOwner
    .teams({ teamId: project.teamId })
    ['ai-agents']({ agentId: home.agentId })
    .chat.post({ prompt: 'Check root identity' });
  expect(sent.status).toBe(200);
  const claimed = await asHome['agent-chats'].claim.post();
  expect(claimed.data?.message?.id).toBe(sent.data!.messageId);
  await db
    .update(agentChatMessage)
    .set({ observedRuntime: runtime })
    .where(eq(agentChatMessage.id, sent.data!.messageId));
  const request = async (
    path: string,
    body?: unknown,
    ownerCall = false,
    extraHeaders?: Record<string, string>,
  ) => {
    const response = await app.handle(
      new Request(`http://localhost:3000${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3001',
          ...(ownerCall
            ? { cookie: owner.cookie }
            : {
                'x-api-key': home.apiKey,
                'x-volition-message': String(sent.data!.messageId),
                'x-volition-agent-unit': `volition-agent-home--a0-c${sent.data!.messageId}-abcdef012345.service`,
                'x-volition-agent-runtime': runtime,
              }),
          ...extraHeaders,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
    return {
      status: response.status,
      data: (await response.json()) as { id: string; status: string; approvalId: number | null },
    };
  };
  return { request, asHome, asOwner, owner, home, project, messageId: sent.data!.messageId };
}

describe('root broker', () => {
  it('runs native Home MCP root without launcher headers and restricts it when unrestricted is off', async () => {
    const { home, messageId, owner, asOwner } = await setup('helena');
    await db
      .update(agentChatMessage)
      .set({ taintSources: ['web'] })
      .where(eq(agentChatMessage.id, messageId));
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (req) => app.handle(req) });
    let connection;
    try {
      connection = await connectMcp(
        {
          name: 'itsaplan',
          transport: 'http',
          url: `${server.url}mcp`,
          headers: [{ name: 'Authorization', value: { template: 'Bearer ${ITSAPLAN_API_KEY}' } }],
        },
        { ITSAPLAN_API_KEY: home.apiKey, ITSAPLAN_MESSAGE_ID: String(messageId) },
      );
      const call = () =>
        connection!.client.callTool({
          name: 'run_as_root',
          arguments: { command: 'id', reason: 'Native chat work' },
        });
      const result = await call();
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: true,
        data: { status: 'success', approvalId: null },
      });
      expect((await asOwner.approvals.get()).data?.items).toEqual([]);
      await setRootSettings(
        { enabled: true, directOnly: false, unrestricted: false },
        owner.userId,
      );
      const restricted = await call();
      expect(restricted.structuredContent).toMatchObject({
        ok: true,
        data: { status: 'pending', approvalId: expect.any(Number) },
      });
      expect(calls.filter((method) => method === 'RunPrivileged')).toHaveLength(1);
    } finally {
      await connection?.close();
      await server.stop(true);
    }
  });
  it('uses the chat runtime from the database when the header disagrees or observation is missing', async () => {
    const { request, messageId } = await setup('codex');
    const forged = await request(
      '/agent-root',
      { command: 'id', reason: 'Forged runtime' },
      false,
      {
        'x-volition-agent-runtime': 'helena',
      },
    );
    expect(forged.data.status).toBe('pending');
    const audit = await request('/god/root-access/audit', undefined, true);
    expect(audit.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ runtime: 'codex' })]),
    );
    await db
      .update(agentChatMessage)
      .set({ observedRuntime: null })
      .where(eq(agentChatMessage.id, messageId));
    expect(
      (
        await request('/agent-root', { command: 'id', reason: 'No observation' }, false, {
          'x-volition-agent-runtime': 'helena',
        })
      ).data.status,
    ).toBe('pending');
    expect(calls).not.toContain('RunPrivileged');
  });
  it('uses the run runtime from the database and rejects work belonging to another agent', async () => {
    const { request, home, project, asOwner, messageId } = await setup('helena');
    const [run] = await db
      .insert(agentRun)
      .values({
        agentId: home.agentId,
        projectId: project.id,
        prompt: 'Check identity',
        observedRuntime: 'helena',
        taintSources: ['web'],
        startedAt: new Date(),
        nextAttemptAt: new Date(Date.now() + 60_000),
      })
      .returning({ id: agentRun.id });
    const headers = {
      'x-helena-run': String(run!.id),
      'x-volition-message': '',
      'x-volition-agent-unit': '',
      'x-volition-agent-runtime': 'codex',
    };
    expect(
      (await request('/agent-root', { command: 'id', reason: 'Native run' }, false, headers)).data
        .status,
    ).toBe('success');
    const other = (
      await createAgent(asOwner, 'ROOT', { name: 'Other agent', username: 'root-other' })
    ).data!;
    await db.update(agentRun).set({ agentId: other.agent.id }).where(eq(agentRun.id, run!.id));
    expect(
      (await request('/agent-root', { command: 'id', reason: 'Foreign run' }, false, headers))
        .status,
    ).toBe(409);
    await db
      .update(agentChatMessage)
      .set({ agentId: other.agent.id })
      .where(eq(agentChatMessage.id, messageId));
    expect((await request('/agent-root', { command: 'id', reason: 'Foreign chat' })).status).toBe(
      409,
    );
    const asOther = apiKeyApi(other.apiKey);
    expect(
      (await asOther['agent-root'].post({ command: 'id', reason: 'Other agent' })).status,
    ).toBe(403);
  });
  it('runs native Home root after web content without a card and keeps source attribution', async () => {
    const { request, asHome, asOwner, messageId, owner } = await setup('helena');
    await asHome['agent-policy'].decide.post({ runtime: 'helena', messageId, tool: 'WebFetch' });
    const result = await request('/agent-root', {
      command: 'id -u',
      reason: 'After external content',
    });
    expect(result.data).toMatchObject({ status: 'success', approvalId: null });
    expect((await asOwner.approvals.get()).data?.items).toEqual([]);
    const audit = await request('/god/root-access/audit', undefined, true);
    expect(audit.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runtime: 'helena',
          agentId: expect.any(Number),
          taintSources: expect.arrayContaining(['web', 'tool:WebFetch']),
        }),
      ]),
    );
    await setRootSettings({ enabled: true, directOnly: true, unrestricted: false }, owner.userId);
    expect(
      (await request('/agent-root', { command: 'id -u', reason: 'Restricted mode' })).data.status,
    ).toBe('pending');
    await setRootSettings({ enabled: false, directOnly: false, unrestricted: true }, owner.userId);
    expect((await request('/agent-root', { command: 'id -u', reason: 'Revoked' })).status).toBe(
      409,
    );
    expect(calls.filter((method) => method === 'RunPrivileged')).toHaveLength(1);
  });
  it('offers the full native Home tool profile and records Home requests without pending cards', async () => {
    const { asHome, asOwner, home, project } = await setup('helena');
    const before = process.env.HELENA_NATIVE_RUNTIME;
    process.env.HELENA_NATIVE_RUNTIME = 'on';
    try {
      const patched = await asOwner
        .teams({ teamId: project.teamId })
        ['ai-agents']({ agentId: home.agentId })
        .patch({
          runtimePolicy: {
            runtime: 'helena',
            reasoningEffort: null,
            toolAllow: [],
            toolDeny: [],
            mcpGrants: [],
            files: [],
            helena: { toolProfile: 'recherche' },
          },
        });
      expect(patched.status).toBe(200);
      expect((await asHome['agent-runtime'].policy.get()).data?.helena).toMatchObject({
        toolProfile: 'voll',
        coreTools: expect.arrayContaining([
          'run_as_root',
          'run_development_operation',
          'get_development_job',
          'enqueue_codex_task',
        ]),
      });
      const requested = await asHome
        .projects({ projectKey: 'ROOT' })
        .approvals.post({ kind: 'execute', action: 'Instance maintenance', command: 'id -u' });
      expect(requested.status).toBe(201);
      expect(requested.data?.status).toBe('approved');
      expect((await asOwner.approvals.get()).data?.items).toEqual([]);
    } finally {
      if (before === undefined) delete process.env.HELENA_NATIVE_RUNTIME;
      else process.env.HELENA_NATIVE_RUNTIME = before;
    }
  });
  it('keeps reached Home budgets as usage data without stopping work or creating a card', async () => {
    const { asOwner, asHome, home, project, messageId } = await setup('helena');
    expect(
      (
        await asOwner
          .teams({ teamId: project.teamId })
          ['ai-agents']({ agentId: home.agentId })
          .autopilot.budgets.put({ budgets: [{ metric: 'tokens', period: 'day', limit: 1 }] })
      ).status,
    ).toBe(200);
    expect(
      (
        await asHome['agent-chats']({ messageId }).result.post({
          status: 'success',
          usage: { inputTokens: 10, outputTokens: 2 },
          spend: { inputTokens: 10, outputTokens: 2 },
        })
      ).status,
    ).toBe(204);
    const status = await asOwner
      .teams({ teamId: project.teamId })
      ['ai-agents']({ agentId: home.agentId })
      .autopilot.get();
    expect(status.data?.budgets[0]).toMatchObject({ reached: true, used: 12 });
    expect(status.data?.paused).toBe(false);
    expect(await heldProjects([project.id], home.agentId)).toEqual([]);
    expect(await budgetExhausted(home.agentId, project.id)).toBeNull();
    expect((await asOwner.approvals.get()).data?.items).toEqual([]);
  });
  it('round-trips unrestricted mode through the owner settings routes', async () => {
    const { owner } = await setup('helena');
    const asOwner = authedApi(owner.cookie, { origin: 'http://localhost:3001' });
    expect((await asOwner.god['root-access'].get()).data?.unrestricted).toBe(true);
    const changed = await asOwner.god['root-access'].put({
      enabled: true,
      directOnly: true,
      unrestricted: false,
    });
    expect(changed.status).toBe(200);
    expect(changed.data?.unrestricted).toBe(false);
  });
  it('executes a clean owner chat and records its completion', async () => {
    const { request } = await setup();
    const result = await request('/agent-root', { command: 'id -u', reason: 'Check identity' });
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ status: 'success', output: '0\n' });
    const audit = await request('/god/root-access/audit', undefined, true);
    expect(audit.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'id -u',
          origin: 'owner-direct',
          exitCode: 0,
          status: 'success',
        }),
      ]),
    );
  });
  it('asks after a read, then executes exactly the approved command once', async () => {
    const { request, asHome, asOwner, messageId, owner } = await setup();
    await setRootSettings({ enabled: true, directOnly: true, unrestricted: false }, owner.userId);
    await asHome['agent-policy'].decide.post({ runtime: 'hermes', messageId, tool: 'WebFetch' });
    const pending = await request('/agent-root', {
      command: 'id -u',
      reason: 'Check identity after a web read',
    });
    expect(pending.data.status).toBe('pending');
    expect(calls).not.toContain('RunPrivileged');
    const decided = await asOwner
      .approvals({ approvalId: pending.data.approvalId! })
      .decision.post({ approved: true });
    expect(decided.status).toBe(200);
    expect(calls.filter((method) => method === 'RunPrivileged')).toHaveLength(1);
    expect(
      (
        await asOwner
          .approvals({ approvalId: pending.data.approvalId! })
          .decision.post({ approved: true })
      ).status,
    ).toBe(409);
    expect(calls.filter((method) => method === 'RunPrivileged')).toHaveLength(1);
  });
  it.each(['codex', 'claude'])(
    'executes Home on %s immediately and retains unobserved-runtime audit',
    async (runtime) => {
      const { request, asOwner } = await setup(runtime);
      const result = await request('/agent-root', { command: 'id -u', reason: 'CLI request' });
      expect(result.data.status).toBe('success');
      expect(result.data.approvalId).toBeNull();
      const audit = await request('/god/root-access/audit', undefined, true);
      expect(audit.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            runtime,
            status: 'success',
            taintSources: expect.arrayContaining(['Laufzeit nicht beobachtbar']),
          }),
        ]),
      );
      expect((await asOwner.approvals.get()).data?.items).toEqual([]);
    },
  );
  it('invalidates outstanding approvals when the owner revokes access', async () => {
    const { request, asOwner, owner } = await setup('claude');
    await setRootSettings({ enabled: true, directOnly: true, unrestricted: false }, owner.userId);
    const pending = await request('/agent-root', { command: 'id -u', reason: 'CLI request' });
    expect(pending.data.status).toBe('pending');
    await setRootSettings({ enabled: false, directOnly: true }, owner.userId);
    const decided = await asOwner
      .approvals({ approvalId: pending.data.approvalId! })
      .decision.post({ approved: true });
    expect(decided.status).toBe(409);
    expect(calls).not.toContain('RunPrivileged');
    const audit = await request('/god/root-access/audit', undefined, true);
    expect(audit.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pending.data.id, status: 'revoked' }),
        expect.objectContaining({ command: 'SetRootSettings', status: 'success' }),
      ]),
    );
  });
  it('records a running command as revoked when settings change before it completes', async () => {
    const { request, owner } = await setup();
    let finish!: () => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    useHostdTransport(async (method, input) => {
      if (method === 'SetRootSettings') {
        state = {
          enabled: false,
          directOnly: true,
          unrestricted: input.unrestricted == null ? state.unrestricted : !!input.unrestricted,
          epoch: state.epoch + 1,
        };
        finish();
      }
      if (method === 'RunPrivileged') {
        await new Promise<void>((resolve) => {
          finish = resolve;
          started();
        });
        return { unit: `volition-root-${input.id}.service`, exitCode: 143, output: 'terminated' };
      }
      return state;
    });
    const command = request('/agent-root', { command: 'sleep 120', reason: 'Revocation test' });
    await running;
    await setRootSettings({ enabled: false, directOnly: true }, owner.userId);
    expect((await command).data.status).toBe('revoked');
  });
  it('leaves Home native tools unrestricted while observing their provenance', async () => {
    const { asHome, messageId } = await setup();
    for (const tool of ['cronjob_manage', 'terminal']) {
      const decision = await asHome['agent-policy'].decide.post({
        runtime: 'hermes',
        messageId,
        tool,
        command: 'git reset --hard',
        dangerous: true,
      });
      expect(decision.data?.outcome).toBe('allow');
    }
  });
  it('denies setting changes through an agent key', async () => {
    const { request } = await setup();
    expect((await request('/god/root-access')).status).toBe(403);
  });
});
