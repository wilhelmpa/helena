import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { app, apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { bootstrapHomeAgent } from '../../../../scripts/bootstrap-home-agent';
import { setRootSettings } from '../../service';
import { useHostdTransport } from '#modules/server/hostd';

process.env.AGENT_CHAT_CLAIM_WAIT_MS = '50';
let calls: string[];
let state: { enabled: boolean; directOnly: boolean; epoch: number };
beforeEach(async () => {
  await resetDb();
  calls = [];
  state = { enabled: true, directOnly: true, epoch: 0 };
  useHostdTransport(async (method, input) => {
    calls.push(method);
    if (method === 'SetRootSettings')
      state = { enabled: !!input.enabled, directOnly: !!input.directOnly, epoch: state.epoch + 1 };
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
  const request = async (path: string, body?: unknown, ownerCall = false) => {
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
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
    return {
      status: response.status,
      data: (await response.json()) as { id: string; status: string; approvalId: number | null },
    };
  };
  return { request, asHome, asOwner, owner, messageId: sent.data!.messageId };
}

describe('root broker', () => {
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
    const { request, asHome, asOwner, messageId } = await setup();
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
  it('treats the actual Codex unit as tainted even when the desired runtime is Hermes', async () => {
    const { request, asOwner } = await setup('codex');
    const pending = await request('/agent-root', { command: 'id -u', reason: 'CLI request' });
    expect(pending.data.status).toBe('pending');
    const card = await asOwner.approvals({ approvalId: pending.data.approvalId! }).get();
    expect(card.data?.details).toContain('Laufzeit nicht beobachtbar');
    expect(calls).not.toContain('RunPrivileged');
    expect(
      (
        await asOwner
          .approvals({ approvalId: pending.data.approvalId! })
          .decision.post({ approved: true })
      ).status,
    ).toBe(200);
    expect(calls).toContain('RunPrivileged');
  });
  it('invalidates outstanding approvals when the owner revokes access', async () => {
    const { request, asOwner, owner } = await setup('claude');
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
        state = { enabled: false, directOnly: true, epoch: state.epoch + 1 };
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
