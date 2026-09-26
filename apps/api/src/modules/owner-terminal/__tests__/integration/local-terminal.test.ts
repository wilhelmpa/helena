import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  db,
  helenaModelServer,
  ownerTerminalGrant,
  session,
  setSetting,
  user,
  writeSecret,
} from '@repo/db';
import { normalizeLocalModel } from '@helena/sdk';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser, type TestUser } from '#tests/helpers/auth';
import { enrollTotp, totpCode } from '../helpers/totp';
import { resetDb } from '#tests/helpers/db';
import { setOwnerTerminalSettings } from '../../service';
import { signTerminalPayload } from '../../token';
import { LOCAL_TERMINAL_MODELS } from '../../local-model';

const keyFile = join(mkdtempSync(join(tmpdir(), 'local-terminal-')), 'key');
writeFileSync(keyFile, 'synthetic-local-terminal-signing-key');
process.env.OWNER_TERMINAL_KEY_PATH = keyFile;
const kind = 'local-qwen36';
const model = LOCAL_TERMINAL_MODELS[kind];
const base = `http://localhost/owner-terminal/local/${kind}`;
const originalFetch = globalThis.fetch;
const providerKey = 'synthetic-local-provider-key';
let calls: { url: string; body: Record<string, unknown> | null }[];
let loaded: string[];
let answer: () => Response;
beforeEach(async () => {
  await resetDb();
  calls = [];
  loaded = [model];
  answer = () =>
    new Response('data: {"type":"response.completed"}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('http://127.0.0.1:13305/api/v1/'))
        throw new Error('unexpected-test-network');
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${providerKey}`);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return url.endsWith('/health')
        ? Response.json({ all_models_loaded: loaded.map((id) => ({ model_name: id })) })
        : answer();
    },
    { preconnect: originalFetch.preconnect },
  );
  await setSetting('localAi.policy', {
    enabled: true,
    units: { gpu: true, cpu: true, npu: false },
  });
  await writeSecret('localAi.server.local', { key: providerKey }, { key: true });
  await db.insert(helenaModelServer).values({
    slug: 'local',
    name: 'Synthetic Lemonade',
    kind: 'lemonade',
    baseUrl: 'http://127.0.0.1:13305/api/v1',
    keySource: 'stored',
    enabled: true,
    models: Object.values(LOCAL_TERMINAL_MODELS).map((id) =>
      normalizeLocalModel({
        id,
        name: id,
        capabilities: ['chat', 'tools'],
        unit: 'gpu',
        downloaded: true,
        loaded: id === model,
      })!,
    ),
    checkedAt: new Date(),
    status: {
      reachable: true,
      version: '2026.39.1',
      latencyMs: 1,
      error: null,
      loaded: [{ id: model, unit: 'gpu', backend: 'llamacpp' }],
    },
  });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function setup(withGrant = false) {
  const owner = await signUpTestUser();
  const [browserSession] = await db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, owner.userId));
  await setOwnerTerminalSettings({ stepUpRequired: withGrant });
  if (withGrant)
    await db.insert(ownerTerminalGrant).values({
      userId: owner.userId,
      sessionId: browserSession!.id,
      method: 'totp',
      device: 'test',
      ipAddress: '192.168.1.2',
      expiresAt: new Date(Date.now() + 600_000),
    });
  const capability = await bootstrap(owner);
  return { owner, sessionId: browserSession!.id, capability };
}

async function bootstrap(owner: TestUser) {
  const proxy = await app.handle(
    new Request(`http://localhost/auth/verify/owner-terminal/${kind}`, {
      headers: { cookie: owner.cookie, 'x-real-ip': '192.168.1.2' },
    }),
  );
  expect(proxy.status).toBe(204);
  const bootstrap = await app.handle(
    new Request(`${base}/bootstrap`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-owner-terminal-token': proxy.headers.get('x-owner-terminal-token')!,
      },
      body: JSON.stringify({ name: 'main' }),
    }),
  );
  expect(bootstrap.status).toBe(200);
  const capability = (await bootstrap.json()) as {
    token: string;
    expiresAt: number;
    model: string;
  };
  return capability;
}
function respond(
  token: string,
  patch: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  url = base,
) {
  return app.handle(
    new Request(`${url}/v1/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      body: JSON.stringify({
        model,
        input: 'Synthetic tool check',
        stream: true,
        tools: [
          {
            type: 'function',
            name: 'read_local_file',
            parameters: { type: 'object', properties: {} },
          },
        ],
        ...patch,
      }),
    }),
  );
}

describe('local owner terminal inference', () => {
  it('uses the real owner proxy proof, streams Responses and preserves local function tools without exposing the provider key', async () => {
    const { capability } = await setup();
    expect(capability.model).toBe(model);
    expect(JSON.stringify(capability)).not.toContain(providerKey);
    const response = await respond(capability.token);
    expect(response.status).toBe(200);
    const output = await response.text();
    expect(output).toContain('response.completed');
    expect(output).not.toContain(providerKey);
    expect(calls.map((call) => call.url.split('/').at(-1))).toEqual(['health', 'responses']);
    expect(calls[1]!.body).toMatchObject({
      model,
      store: false,
      tools: [{ type: 'function', name: 'read_local_file' }],
    });
  });
  it('rejects absent, forged, cross-kind, expired and browser/API-key capabilities before touching the model', async () => {
    const { capability } = await setup();
    for (const token of [
      '',
      'forged',
      signTerminalPayload({ purpose: 'owner-local-inference', kind, exp: 1 }),
    ])
      expect((await respond(token)).status).toBe(403);
    expect(
      (
        await respond(
          capability.token,
          { model: LOCAL_TERMINAL_MODELS['local-qwen38'] },
          {},
          'http://localhost/owner-terminal/local/local-qwen38',
        )
      ).status,
    ).toBe(403);
    const browserHeaders: Record<string, string>[] = [
      { cookie: 'dummy=x' },
      { origin: 'http://localhost:3001' },
      { 'x-api-key': 'dummy' },
      { 'x-real-ip': '127.0.0.1' },
      { 'x-forwarded-for': '127.0.0.1' },
      { forwarded: 'for=127.0.0.1' },
    ];
    for (const headers of browserHeaders)
      expect((await respond(capability.token, {}, headers)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('requires the original live grant; revoke and new grant do not revive an old capability', async () => {
    const { capability, owner, sessionId } = await setup(true);
    await db
      .update(ownerTerminalGrant)
      .set({ revokedAt: new Date() })
      .where(eq(ownerTerminalGrant.userId, owner.userId));
    expect((await respond(capability.token)).status).toBe(403);
    await db.delete(ownerTerminalGrant).where(eq(ownerTerminalGrant.userId, owner.userId));
    await db.insert(ownerTerminalGrant).values({
      userId: owner.userId,
      sessionId,
      method: 'totp',
      device: 'replacement',
      ipAddress: '192.168.1.2',
      expiresAt: new Date(Date.now() + 600_000),
    });
    expect((await respond(capability.token)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('does not revive a capability when MFA renewal reuses its original grant row', async () => {
    const { capability, owner } = await setup(true);
    await db
      .update(ownerTerminalGrant)
      .set({ createdAt: new Date(Date.now() + 1000), expiresAt: new Date(Date.now() + 720_000) })
      .where(eq(ownerTerminalGrant.userId, owner.userId));
    expect((await respond(capability.token)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('uses the real MFA upsert to invalidate old inference capabilities and admits a freshly bootstrapped capability', async () => {
    const owner = await signUpTestUser();
    const enrolled = await enrollTotp(owner.cookie);
    owner.cookie = enrolled.cookie;
    const api = authedApi(owner.cookie, { origin: 'http://localhost:3001' });
    await setOwnerTerminalSettings({ stepUpRequired: true });
    const renew = () =>
      api['owner-terminal']['step-up']['totp'].post({ code: totpCode(enrolled.secret) });
    expect((await renew()).status).toBe(200);
    const first = await bootstrap(owner);
    const [originalGrant] = await db.select().from(ownerTerminalGrant);
    expect(await (await respond(first.token)).text()).toContain('response.completed');

    expect((await renew()).status).toBe(200);
    calls = [];
    expect((await respond(first.token)).status).toBe(403);
    expect(calls).toHaveLength(0);
    const fresh = await bootstrap(owner);
    expect(await (await respond(fresh.token)).text()).toContain('response.completed');

    expect((await api['owner-terminal'].grant.revoke.post()).status).toBe(204);
    expect((await renew()).status).toBe(200);
    calls = [];
    expect((await respond(first.token)).status).toBe(403);
    expect((await respond(fresh.token)).status).toBe(403);
    expect(calls).toHaveLength(0);
    const latest = await bootstrap(owner);
    expect(await (await respond(latest.token)).text()).toContain('response.completed');
    const grants = await db.select().from(ownerTerminalGrant);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.id).toBe(originalGrant!.id);
    expect(grants[0]!.createdAt.getTime()).toBeGreaterThan(originalGrant!.createdAt.getTime());
  });
  it('rechecks LAN policy, owner role/activity and session revocation', async () => {
    const { capability, owner, sessionId } = await setup();
    await setOwnerTerminalSettings({ stepUpRequired: true });
    expect((await respond(capability.token)).status).toBe(403);
    await setOwnerTerminalSettings({ stepUpRequired: false });
    await db.update(user).set({ role: 'user' }).where(eq(user.id, owner.userId));
    expect((await respond(capability.token)).status).toBe(403);
    await db.update(user).set({ role: 'god', active: false }).where(eq(user.id, owner.userId));
    expect((await respond(capability.token)).status).toBe(403);
    await db.update(user).set({ active: true }).where(eq(user.id, owner.userId));
    await db.delete(session).where(eq(session.id, sessionId));
    expect((await respond(capability.token)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('refuses model switches, hosted tools, background work, previous sessions and remote media', async () => {
    const { capability } = await setup();
    for (const patch of [
      { model: 'cloud-model' },
      { tools: [{ type: 'web_search' }] },
      { tools: [{ type: 'web_search_preview' }] },
      { tools: [{ type: 'file_search', vector_store_ids: ['outside'] }] },
      { tools: [{ type: 'code_interpreter', container: { type: 'auto' } }] },
      { tools: [{ type: 'mcp', server_url: 'https://outside.test' }] },
      {
        tools: [
          {
            type: 'namespace',
            name: 'multi_agent_v1',
            tools: [{ type: 'function', name: 'spawn_agent' }],
          },
        ],
      },
      { background: true },
      { previous_response_id: 'outside' },
      { input: [{ type: 'input_image', image_url: 'https://outside.test/image.png' }] },
    ])
      expect((await respond(capability.token, patch)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it('uses existing device policy and refuses arbitrary configured upstreams', async () => {
    const { capability } = await setup();
    await setSetting('localAi.policy', {
      enabled: true,
      units: { gpu: false, cpu: true, npu: false },
    });
    expect((await respond(capability.token)).status).toBe(503);
    await setSetting('localAi.policy', { enabled: true, units: { gpu: true } });
    await db.update(helenaModelServer).set({ baseUrl: 'https://outside.test/v1' });
    expect((await respond(capability.token)).status).toBe(503);
    expect(calls).toHaveLength(0);
  });
  it('never loads a downloaded model and sanitizes upstream errors without retry', async () => {
    const { capability } = await setup();
    loaded = [];
    expect((await respond(capability.token)).status).toBe(503);
    expect(calls).toHaveLength(1);
    loaded = [model];
    answer = () => new Response('private provider data', { status: 500 });
    const response = await respond(capability.token);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private provider data');
    expect(calls.filter((call) => call.url.endsWith('/responses'))).toHaveLength(1);
  });
  it('offers only a freshly observed loaded runtime; downloaded Qwen3.8 alone is not ready', async () => {
    const { owner } = await setup();
    const request = () =>
      app.handle(
        new Request('http://localhost/owner-terminal/local-models', {
          headers: { cookie: owner.cookie },
        }),
      );
    expect(await (await request()).json()).toEqual([
      { kind, ready: true },
      { kind: 'local-qwen38', ready: false },
    ]);
    await db.update(helenaModelServer).set({ checkedAt: new Date(Date.now() - 120_000) });
    expect(await (await request()).json()).toEqual([
      { kind, ready: true },
      { kind: 'local-qwen38', ready: false },
    ]);
    loaded = [];
    expect(await (await request()).json()).toEqual([
      { kind, ready: false },
      { kind: 'local-qwen38', ready: false },
    ]);
    expect(calls).toHaveLength(3);
  });
  it('bounds input before upstream access', async () => {
    const { capability } = await setup();
    expect((await respond(capability.token, { input: 'x'.repeat(2 * 1024 * 1024) })).status).toBe(
      413,
    );
    expect(calls).toHaveLength(0);
  });
  it('bounds a stalled upload and forwards no partial request', async () => {
    const { capability } = await setup();
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    });
    const response = await app.handle(
      new Request(`${base}/v1/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${capability.token}`,
          'content-type': 'application/json',
        },
        body,
        duplex: 'half',
      } as RequestInit),
    );
    expect(response.status).toBe(408);
    expect(canceled).toBe(true);
    expect(calls).toHaveLength(0);
  }, 10_000);

  it('cancels a disconnected upload before dispatch', async () => {
    const { capability } = await setup();
    const controller = new AbortController();
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    });
    const pending = app.handle(
      new Request(`${base}/v1/responses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${capability.token}` },
        body,
        signal: controller.signal,
        duplex: 'half',
      } as RequestInit),
    );
    try {
      controller.abort();
      expect((await pending).status).toBe(400);
      expect(canceled).toBe(true);
      expect(calls).toHaveLength(0);
    } finally {
      controller.abort();
      await pending;
    }
  });

  it('aborts an active stream when the original grant is revoked', async () => {
    const { capability, owner } = await setup(true);
    let canceled = false;
    answer = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(output) {
            output.enqueue(new TextEncoder().encode('data: {}\n\n'));
          },
          cancel() {
            canceled = true;
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    const response = await respond(capability.token);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await reader.read();
    await db
      .update(ownerTerminalGrant)
      .set({ revokedAt: new Date() })
      .where(eq(ownerTerminalGrant.userId, owner.userId));
    const pending = reader.read();
    try {
      await expect(pending).rejects.toThrow();
    } finally {
      await reader.cancel().catch(() => {});
    }
    expect(canceled).toBe(true);
  }, 10_000);
});
