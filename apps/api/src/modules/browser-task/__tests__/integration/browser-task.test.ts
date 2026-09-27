import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { addProjectMember } from '#tests/helpers/members';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import {
  agentUsage,
  browserGatewayEvent,
  db,
  helenaBrowserTaskRun,
  integrationCredential,
  sealCredential,
  openCredential,
} from '@repo/db';
import { APIConnectionError, APIError, APITimeoutError } from '@typesafe-ai/sdk';
import { useLocalAiForDecisions } from '#modules/decisions/local-ai';
import { DECISION_SOURCE_UNAVAILABLE } from '#modules/agents/credentials/decision-key-source';
import { maskForTeam } from '#modules/agents/credentials/env';
import {
  askSystemOne,
  loadConnection,
  describeFailure,
  useModelServerResolver,
  LocalDecisionConnectionError,
} from '../../connection';
import { postToRouter } from '../../router-client';
import { HttpError } from '#shared/lib';
import { eq } from 'drizzle-orm';

// browser_task's Helena side (docs/helena-decisions/browser-task.md): decision model connections
// in Zugänge, "Verbindung testen", the project's "Browser-Steuerung" and the instance default,
// the internal task routes the gateway calls (start, System One, progress, finish), the usage
// ledger, the jev-browser proxy, and Browser 2.0's runs.

const GATEWAY_TOKEN = 'test-browser-gateway-token-0123456789abcdef0123';
const BACKEND_KEY = 'mock-backend-key-0123456789';

// A Jev-compatible server on loopback: a model list and one fixed answer per question type.
let backend: Server;
let backendUrl = '';
let inferenceStatus = 200;
let probeProbability = 0.9;
let backendHits = 0;
let acceptedBackendKey = BACKEND_KEY;
beforeEach(() => {
  inferenceStatus = 200;
  acceptedBackendKey = BACKEND_KEY;
  probeProbability = 0.9;
});
const received: { auth: string | undefined; body: unknown }[] = [];

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'browser-task-'));
  const file = join(directory, 'token');
  writeFileSync(file, GATEWAY_TOKEN, { mode: 0o600 });
  process.env.BROWSER_GATEWAY_TOKEN_FILE = file;
  // No browser router in tests: Browser 2.0's decision runs report that.
  process.env.HELENA_BROWSER_ROUTER_URL = 'http://127.0.0.1:9';
  backend = createServer((request, response) => {
    backendHits++;
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.url?.startsWith('/internal/gateway/'))
      return send(400, { error: `Router rejected ${request.headers.authorization}` });
    if (request.headers.authorization !== `Bearer ${acceptedBackendKey}`)
      return send(401, { detail: 'no' });
    if (request.url === '/v1/models') return send(200, { models: [{ name: 'mock-1' }] });
    let data = '';
    request.on('data', (chunk) => (data += chunk));
    request.on('end', () => {
      const body = JSON.parse(data) as {
        questions: Record<string, { type: string; criteria?: Record<string, unknown> }>;
      };
      received.push({ auth: request.headers.authorization, body });
      if (inferenceStatus !== 200) return send(inferenceStatus, { detail: 'billing required' });
      const answers: Record<string, unknown> = {};
      for (const [id, question] of Object.entries(body.questions)) {
        if (question.type === 'noul') answers[id] = { type: 'noul', noul: probeProbability };
        else {
          const keys = Object.keys(question.criteria ?? {});
          answers[id] = {
            type: 'choice',
            choice: keys[0],
            probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0])),
            confidence: 1,
          };
        }
      }
      send(200, { model: 'mock-1', answers, usage: { input_tokens: 120, output_tokens: 3 } });
    });
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  backendUrl = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
});

afterAll(() => backend?.close());

function internal(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${GATEWAY_TOKEN}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const mkt = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Surfer',
    username: 'surfer',
    kind: 'external',
  });
  const agent = created.data!.agent;
  const servers = (await asOwner.teams({ teamId: mkt.teamId })['mcp-servers'].get()).data!;
  const gateway = servers.find((row) => row.name === 'projekt-browser')!;
  await asOwner
    .teams({ teamId: mkt.teamId })
    ['ai-agents']({ agentId: agent.id })
    ['mcp-servers'].put({
      mcpServerIds: [gateway.id],
    });
  return { owner, asOwner, mkt, agent, apiKey: created.data!.apiKey! as string };
}

async function connection(asOwner: Api, teamId: number, overrides: Record<string, unknown> = {}) {
  const res = await asOwner.teams({ teamId }).credentials.post({
    kind: 'decision_model',
    label: 'Laya (Test)',
    provider: 'compatible',
    baseUrl: `${backendUrl}/v1/systemone`,
    model: 'mock-1',
    allowPrivateAddress: true,
    value: BACKEND_KEY,
    ...overrides,
  } as never);
  return res;
}

describe('decision model connections', () => {
  beforeEach(resetDb);

  it('stores a connection with its address and model, and never returns the key', async () => {
    const { asOwner, mkt } = await setup();
    const res = await connection(asOwner, mkt.teamId);
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      kind: 'decision_model',
      provider: 'compatible',
      baseUrl: backendUrl,
      model: 'mock-1',
      allowPrivateAddress: true,
      keySource: 'stored',
      secrets: ['value'],
    });
    expect(JSON.stringify(res.data)).not.toContain(BACKEND_KEY);
  });

  it('uses the current original key after rotation without copying it or changing grants', async () => {
    const { asOwner, mkt } = await setup();
    const credentials = asOwner.teams({ teamId: mkt.teamId }).credentials;
    const source = (
      await credentials.post({
        kind: 'api_key',
        label: 'Original JEV',
        value: BACKEND_KEY,
        projectId: mkt.id,
      })
    ).data!;
    const linked = await connection(asOwner, mkt.teamId, {
      keySource: 'credential',
      sourceCredentialId: source.id,
      projectId: mkt.id,
      value: undefined,
    });
    expect(linked.status).toBe(201);
    expect(linked.data).toMatchObject({
      keySource: 'credential',
      sourceCredentialId: source.id,
      secrets: [],
      grants: [],
    });
    const loaded = (await loadConnection(linked.data!.id))!;
    const question = { state: 'synthetic fixture', questions: { q: { type: 'noul' } } };
    await askSystemOne(loaded, question);
    expect(received.at(-1)?.auth).toBe(`Bearer ${BACKEND_KEY}`);
    const rotated = 'fixture-rotated-key-7654321';
    expect((await credentials({ credentialId: source.id }).patch({ value: rotated })).status).toBe(
      200,
    );
    acceptedBackendKey = rotated;
    await askSystemOne(loaded, question);
    expect(received.at(-1)?.auth).toBe(`Bearer ${rotated}`);
    expect((await credentials({ credentialId: linked.data!.id }).test.post()).data?.ok).toBe(true);
    const [row] = await db
      .select()
      .from(integrationCredential)
      .where(eq(integrationCredential.id, linked.data!.id));
    expect(JSON.parse(openCredential(row!))).toEqual({});
    const listed = (await credentials.get({ query: {} })).data!;
    expect(JSON.stringify(listed)).not.toContain(BACKEND_KEY);
    expect(JSON.stringify(listed)).not.toContain(rotated);
    expect(listed.items.find((item) => item.id === source.id)?.grants).toEqual([]);
    const masked = await maskForTeam(mkt.teamId, `${BACKEND_KEY} ${rotated}`);
    expect(masked).not.toContain(rotated);
    expect(masked).not.toContain(BACKEND_KEY);
    const lab = await asOwner.projects({ projectKey: 'MKT' })['browser-control'].connections.get();
    expect(lab.data?.connections.find((item) => item.id === linked.data!.id)).toMatchObject({
      keySource: 'credential',
      hasKey: true,
    });
  });

  it('rejects missing, malformed, foreign and wider-scope sources without contacting a provider', async () => {
    const { asOwner, mkt } = await setup();
    const ops = (await asOwner.projects.post({ key: 'OPS', name: 'Operations' })).data!;
    const foreignOwner = authedApi((await signUpTestUser()).cookie);
    const foreignProject = (await foreignOwner.projects.post({ key: 'OTHER', name: 'Other' }))
      .data!;
    const credentials = asOwner.teams({ teamId: mkt.teamId }).credentials;
    const projectSource = (
      await credentials.post({
        kind: 'api_key',
        label: 'Project key',
        value: BACKEND_KEY,
        projectId: mkt.id,
      })
    ).data!;
    const wrongKind = (
      await credentials.post({ kind: 'secret', label: 'A secret', value: BACKEND_KEY })
    ).data!;
    const invalid = (
      await credentials.post({
        kind: 'api_key',
        label: 'Malformed key',
        value: 'fixture-hidden\nnext-line',
      })
    ).data!;
    const foreign = (
      await foreignOwner
        .teams({ teamId: foreignProject.teamId })
        .credentials.post({ kind: 'api_key', label: 'Foreign key', value: BACKEND_KEY })
    ).data!;
    const before = backendHits;
    for (const options of [
      {},
      { sourceCredentialId: 987654321 },
      { sourceCredentialId: wrongKind.id },
      { sourceCredentialId: foreign.id },
      { sourceCredentialId: invalid.id },
      { sourceCredentialId: projectSource.id },
      { sourceCredentialId: projectSource.id, projectId: ops.id },
      { sourceCredentialId: projectSource.id, projectId: mkt.id, value: 'fixture-hidden-copy' },
    ]) {
      const rejected = await connection(asOwner, mkt.teamId, {
        keySource: 'credential',
        value: undefined,
        ...options,
      });
      expect(rejected.status).toBe(400);
      expect(JSON.stringify(rejected.error?.value)).not.toContain('fixture-hidden');
    }
    for (const sourceCredentialId of [null, -1, 1.5]) {
      const rejected = await connection(asOwner, mkt.teamId, {
        keySource: 'credential',
        value: undefined,
        sourceCredentialId,
      });
      expect([400, 422]).toContain(rejected.status);
    }
    const linked = (
      await connection(asOwner, mkt.teamId, {
        keySource: 'credential',
        sourceCredentialId: projectSource.id,
        projectId: mkt.id,
        value: undefined,
      })
    ).data!;
    expect((await credentials({ credentialId: linked.id }).patch({ projectId: null })).status).toBe(
      400,
    );
    expect(
      (await credentials({ credentialId: linked.id }).patch({ projectId: ops.id })).status,
    ).toBe(400);
    expect(backendHits).toBe(before);
  });

  it('rechecks deleted, moved, changed-kind and invalid source keys on every call with no fallback', async () => {
    const { asOwner, mkt } = await setup();
    const ops = (await asOwner.projects.post({ key: 'OPS', name: 'Operations' })).data!;
    const credentials = asOwner.teams({ teamId: mkt.teamId }).credentials;
    const foreignOwner = authedApi((await signUpTestUser()).cookie);
    const foreignProject = (await foreignOwner.projects.post({ key: 'OTHER', name: 'Other' }))
      .data!;
    for (const change of ['delete', 'project', 'team', 'kind', 'invalid'] as const) {
      const source = (
        await credentials.post({ kind: 'api_key', label: `Original ${change}`, value: BACKEND_KEY })
      ).data!;
      const linked = (
        await connection(asOwner, mkt.teamId, {
          keySource: 'credential',
          sourceCredentialId: source.id,
          value: undefined,
        })
      ).data!;
      const loaded = (await loadConnection(linked.id))!;
      if (change === 'delete') await credentials({ credentialId: source.id }).delete();
      if (change === 'project')
        await credentials({ credentialId: source.id }).patch({ projectId: ops.id });
      if (change === 'team')
        await db
          .update(integrationCredential)
          .set({ teamId: foreignProject.teamId })
          .where(eq(integrationCredential.id, source.id));
      if (change === 'kind')
        await db
          .update(integrationCredential)
          .set({ integrationKey: 'secret' })
          .where(eq(integrationCredential.id, source.id));
      if (change === 'invalid')
        await credentials({ credentialId: source.id }).patch({
          value: 'fixture-secret\nnext-line',
        });
      const before = backendHits;
      await expect(
        askSystemOne(loaded, { state: 'fixture', questions: { q: { type: 'noul' } } }),
      ).rejects.toThrow(DECISION_SOURCE_UNAVAILABLE);
      const tested = await credentials({ credentialId: linked.id }).test.post();
      expect(tested.data).toMatchObject({ ok: false, message: DECISION_SOURCE_UNAVAILABLE });
      expect(JSON.stringify(tested.data)).not.toContain('fixture-secret');
      expect(backendHits).toBe(before);
      if (change !== 'invalid') {
        const lab = await asOwner
          .teams({ teamId: mkt.teamId })
          ['browser-control'].connections.get();
        expect(lab.data?.connections.find((item) => item.id === linked.id)?.hasKey).toBe(false);
      }
    }
  });

  it('refuses a stale connection snapshot after its scope or reference changes', async () => {
    const { asOwner, mkt } = await setup();
    const credentials = asOwner.teams({ teamId: mkt.teamId }).credentials;
    const source = (
      await credentials.post({ kind: 'api_key', label: 'Original', value: BACKEND_KEY })
    ).data!;
    const linked = (
      await connection(asOwner, mkt.teamId, {
        keySource: 'credential',
        sourceCredentialId: source.id,
        value: undefined,
      })
    ).data!;
    const loaded = (await loadConnection(linked.id))!;
    expect(
      (await credentials({ credentialId: linked.id }).patch({ projectId: mkt.id })).status,
    ).toBe(200);
    const before = backendHits;
    await expect(
      askSystemOne(loaded, { state: 'fixture', questions: { q: { type: 'noul' } } }),
    ).rejects.toThrow(DECISION_SOURCE_UNAVAILABLE);
    expect(backendHits).toBe(before);
    expect((await credentials({ credentialId: linked.id }).test.post()).data?.ok).toBe(true);
    const scoped = (await loadConnection(linked.id))!;
    const otherSource = (
      await credentials.post({ kind: 'api_key', label: 'Another original', value: BACKEND_KEY })
    ).data!;
    expect(
      (await credentials({ credentialId: linked.id }).patch({ sourceCredentialId: otherSource.id }))
        .status,
    ).toBe(200);
    const beforeChangedReference = backendHits;
    await expect(
      askSystemOne(scoped, { state: 'fixture', questions: { q: { type: 'noul' } } }),
    ).rejects.toThrow(DECISION_SOURCE_UNAVAILABLE);
    expect(backendHits).toBe(beforeChangedReference);
  });

  it('removes an old copied key when linking and requires a fresh key when switching back', async () => {
    const { asOwner, mkt } = await setup();
    const credentials = asOwner.teams({ teamId: mkt.teamId }).credentials;
    const source = (
      await credentials.post({ kind: 'api_key', label: 'Original', value: BACKEND_KEY })
    ).data!;
    const direct = (await connection(asOwner, mkt.teamId, { provider: 'typesafe' })).data!;
    const linked = await credentials({ credentialId: direct.id }).patch({
      keySource: 'credential',
      sourceCredentialId: source.id,
    });
    expect(linked.data?.secrets).toEqual([]);
    const [row] = await db
      .select()
      .from(integrationCredential)
      .where(eq(integrationCredential.id, direct.id));
    expect(JSON.parse(openCredential(row!))).toEqual({});
    expect(
      (await credentials({ credentialId: direct.id }).patch({ keySource: 'stored' })).status,
    ).toBe(400);
    const restored = await credentials({ credentialId: direct.id }).patch({
      keySource: 'stored',
      value: BACKEND_KEY,
    });
    expect(restored.data).toMatchObject({
      keySource: 'stored',
      sourceCredentialId: null,
      secrets: ['value'],
    });
    expect((await credentials({ credentialId: direct.id }).test.post()).data?.ok).toBe(true);
  });

  it('offers only eligible source metadata to credential managers', async () => {
    const { asOwner, mkt } = await setup();
    const ops = (await asOwner.projects.post({ key: 'OPS', name: 'Operations' })).data!;
    const credentials = asOwner.teams({ teamId: mkt.teamId }).credentials;
    const ids: number[] = [];
    for (const projectId of [null, mkt.id, ops.id]) {
      ids.push(
        (
          await credentials.post({
            kind: 'api_key',
            label: `Source ${projectId}`,
            value: BACKEND_KEY,
            projectId,
          })
        ).data!.id,
      );
    }
    await credentials.post({ kind: 'secret', label: 'Not API key', value: BACKEND_KEY });
    const team = await credentials['decision-key-sources'].options.get({ query: {} });
    expect(team.data?.items.map((row) => row.id)).toEqual([ids[0]!]);
    const project = await credentials['decision-key-sources'].options.get({
      query: { projectId: mkt.id },
    });
    expect(project.data?.items.map((row) => row.id).sort()).toEqual([ids[0]!, ids[1]!].sort());
    expect(JSON.stringify(project.data)).not.toContain(BACKEND_KEY);
    expect(
      project.data?.items.every(
        (row) => Object.keys(row).sort().join(',') === 'id,label,projectId,projectKey',
      ),
    ).toBe(true);
    const member = await addProjectMember(asOwner, 'MKT');
    const memberCredentials = member.teams({ teamId: mkt.teamId }).credentials;
    expect(
      (await memberCredentials['decision-key-sources'].options.get({ query: {} })).status,
    ).toBe(403);
    expect(
      (
        await connection(member, mkt.teamId, {
          keySource: 'credential',
          sourceCredentialId: ids[0],
          value: undefined,
        })
      ).status,
    ).toBe(403);
  });

  it('exposes only the closed local policy errors and suppresses arbitrary resolver errors', async () => {
    const { asOwner, mkt } = await setup();
    const local = (
      await connection(asOwner, mkt.teamId, { keySource: 'local-ai', value: undefined })
    ).data!;
    const endpoint = asOwner.teams({ teamId: mkt.teamId }).credentials({ credentialId: local.id });
    const before = backendHits;
    try {
      useModelServerResolver(async () => {
        throw new LocalDecisionConnectionError('master-off');
      });
      expect((await endpoint.test.post()).data?.message).toBe('Local AI is switched off');
      useModelServerResolver(async () => {
        throw new HttpError(409, 'fixture-resolver-secret');
      });
      const result = await endpoint.test.post();
      expect(result.data?.message).toBe('The decision connection could not be loaded (Zugänge).');
      expect(JSON.stringify(result.data)).not.toContain('fixture-resolver-secret');
      expect(backendHits).toBe(before);
    } finally {
      useLocalAiForDecisions();
    }
  });

  it('refuses a TypeSafe connection without a key and an unknown kind of service', async () => {
    const { asOwner, mkt } = await setup();
    expect(
      (
        await connection(asOwner, mkt.teamId, {
          provider: 'typesafe',
          baseUrl: undefined,
          value: undefined,
        })
      ).status,
    ).toBe(400);
    expect((await connection(asOwner, mkt.teamId, { provider: 'nope' })).status).toBe(400);
  });

  it('rejects malformed keys on create and update without reflecting their values', async () => {
    const { asOwner, mkt } = await setup();
    const created = (await connection(asOwner, mkt.teamId)).data!;
    const before = backendHits;
    for (const value of [
      'fixture-secret\nsecond-line',
      'fixture-secret\u0000',
      'fixture-secret\tkey',
      'fixture-secret😀',
    ]) {
      const rejected = await connection(asOwner, mkt.teamId, { value });
      expect(rejected.status).toBe(400);
      expect(JSON.stringify(rejected.error?.value)).not.toContain('fixture-secret');
      const patched = await asOwner
        .teams({ teamId: mkt.teamId })
        .credentials({ credentialId: created.id })
        .patch({ value });
      expect(patched.status).toBe(400);
      expect(JSON.stringify(patched.error?.value)).not.toContain('fixture-secret');
    }
    for (const value of ['', '  \n ']) {
      expect((await connection(asOwner, mkt.teamId, { provider: 'typesafe', value })).status).toBe(
        400,
      );
    }
    expect(backendHits).toBe(before);
    const tested = await asOwner
      .teams({ teamId: mkt.teamId })
      .credentials({ credentialId: created.id })
      .test.post();
    expect(tested.data?.ok).toBe(true);
  });

  it('refuses an existing malformed stored key before any request and keeps status and errors secret-free', async () => {
    const { asOwner, mkt } = await setup();
    const created = (await connection(asOwner, mkt.teamId)).data!;
    // Simulate a credential saved before validation existed; new API writes reject it.
    const secret = 'fixture-legacy-secret\nsecond-line';
    await db
      .update(integrationCredential)
      .set(sealCredential(created.id, JSON.stringify({ value: secret })))
      .where(eq(integrationCredential.id, created.id));
    const before = backendHits;
    const tested = await asOwner
      .teams({ teamId: mkt.teamId })
      .credentials({ credentialId: created.id })
      .test.post();
    expect(tested.data).toMatchObject({
      ok: false,
      message: 'The decision service key is invalid (Zugänge).',
    });
    const listed = await asOwner
      .teams({ teamId: mkt.teamId })
      .credentials.get({ query: { kind: 'decision_model' } });
    expect(listed.data?.items[0]?.status).toBe('error');
    expect(JSON.stringify(listed.data)).not.toContain('fixture-legacy-secret');
    const loaded = (await loadConnection(created.id))!;
    try {
      await askSystemOne(loaded, { state: 'fixture', questions: { q: { type: 'noul' } } });
      throw new Error('Expected refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(409);
      expect((error as Error).cause).toBeUndefined();
      expect(String(error)).not.toContain('fixture-legacy-secret');
      expect((error as Error).stack).not.toContain('fixture-legacy-secret');
    }
    expect(backendHits).toBe(before);
  });

  it('normalizes harmless surrounding whitespace and catches synchronous SDK validation safely', async () => {
    const { asOwner, mkt } = await setup();
    const created = (await connection(asOwner, mkt.teamId, { value: ` \n${BACKEND_KEY}\r\n ` }))
      .data!;
    const tested = await asOwner
      .teams({ teamId: mkt.teamId })
      .credentials({ credentialId: created.id })
      .test.post();
    expect(tested.data?.ok).toBe(true);
    const before = backendHits;
    const loaded = (await loadConnection(created.id))!;
    try {
      await askSystemOne(loaded, {
        state: 'fixture',
        questions: { 'fixture-private-question': { type: 'score', criteria: [] } },
      });
      throw new Error('Expected refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(502);
      expect((error as Error).cause).toBeUndefined();
      expect(String(error)).not.toContain('fixture-private-question');
    }
    expect(backendHits).toBe(before);
  });

  it('tests a connection and stores the result as its status', async () => {
    const { asOwner, mkt } = await setup();
    const created = (await connection(asOwner, mkt.teamId)).data!;
    const callsBefore = received.length;
    const test = await asOwner
      .teams({ teamId: mkt.teamId })
      .credentials({ credentialId: created.id })
      .test.post();
    expect(received.length).toBe(callsBefore + 1);
    expect((received.at(-1)?.body as { model: string }).model).toBe('mock-1');
    expect(test.data).toMatchObject({ ok: true, message: 'ok', models: ['mock-1'] });
    const listed = await asOwner
      .teams({ teamId: mkt.teamId })
      .credentials.get({ query: { kind: 'decision_model' } });
    expect(listed.data?.items[0]?.status).toBe('ok');
  });

  it('does not mark a reachable model list ready when inference needs billing', async () => {
    const { asOwner, mkt } = await setup();
    const created = (await connection(asOwner, mkt.teamId)).data!;
    inferenceStatus = 402;
    const result = await asOwner
      .teams({ teamId: mkt.teamId })
      .credentials({ credentialId: created.id })
      .test.post();
    expect(result.data?.ok).toBe(false);
    expect(result.data?.message).toContain('billing or credits');
    expect(result.data?.message).toContain('HTTP 402');
    const listed = await asOwner
      .teams({ teamId: mkt.teamId })
      .credentials.get({ query: { kind: 'decision_model' } });
    expect(listed.data?.items[0]?.status).toBe('error');
    expect(JSON.stringify(result.data)).not.toContain(BACKEND_KEY);
  });

  it('requires a valid typed probability from the configured model', async () => {
    const { asOwner, mkt } = await setup();
    const created = (await connection(asOwner, mkt.teamId)).data!;
    probeProbability = 1.5;
    const result = await asOwner
      .teams({ teamId: mkt.teamId })
      .credentials({ credentialId: created.id })
      .test.post();
    expect(result.data?.ok).toBe(false);
  });

  it('refuses a local address the owner did not allow for this connection', async () => {
    const { asOwner, mkt } = await setup();
    const created = (await connection(asOwner, mkt.teamId, { allowPrivateAddress: false })).data!;
    const test = await asOwner
      .teams({ teamId: mkt.teamId })
      .credentials({ credentialId: created.id })
      .test.post();
    expect(test.data).toMatchObject({ ok: false, message: 'address_not_allowed' });
  });

  it('lists the kinds of decision service with their defaults', async () => {
    const { asOwner } = await setup();
    const res = await asOwner['decision-backends'].get();
    const ids = res.data!.backends.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['typesafe', 'vercel', 'compatible']));
    const typesafe = res.data!.backends.find((b) => b.id === 'typesafe')!;
    expect(typesafe).toMatchObject({
      defaultBaseUrl: 'https://api.typesafe.ai',
      defaultModel: 'jev-latest',
      keyRequired: true,
    });
    const vercel = res.data!.backends.find((b) => b.id === 'vercel')!;
    expect(vercel).toMatchObject({
      defaultBaseUrl: 'https://ai-gateway.vercel.sh/typesafe',
      defaultModel: 'typesafe-ai/jev',
    });
  });
});

describe('browser control and the task routes', () => {
  beforeEach(resetDb);

  async function withDecisionModel() {
    const ctx = await setup();
    const created = (await connection(ctx.asOwner, ctx.mkt.teamId)).data!;
    const put = await ctx.asOwner.projects({ projectKey: 'MKT' }).settings['browser-control'].put({
      mode: 'decision',
      credentialId: created.id,
    });
    expect(put.status).toBe(200);
    return { ...ctx, credentialId: created.id };
  }

  it('offers browser_task only where the project has a decision model', async () => {
    const { asOwner, apiKey } = await setup();
    const standard = (await (
      await internal('/internal/browser-gateway/resolve', {
        agentKey: apiKey,
        projectSlug: 'mkt',
        via: 'mkt',
      })
    ).json()) as { browserTask: unknown };
    expect(standard.browserTask).toMatchObject({ enabled: false });
    const refused = await internal('/internal/browser-gateway/task/start', {
      agentKey: apiKey,
      projectSlug: 'mkt',
      via: 'mkt',
      kind: 'task',
      goal: 'x',
    });
    expect(refused.status).toBe(409);
    void asOwner;
  });

  it('runs a task: start, System One with the key, steps, result, ledger', async () => {
    const { apiKey, agent } = await withDecisionModel();
    const resolved = (await (
      await internal('/internal/browser-gateway/resolve', {
        agentKey: apiKey,
        projectSlug: 'mkt',
        via: 'mkt',
      })
    ).json()) as { browserTask: unknown };
    expect(resolved.browserTask).toMatchObject({
      enabled: true,
      policy: 'laya',
      label: 'Laya (Test)',
    });

    const started = await internal('/internal/browser-gateway/task/start', {
      agentKey: apiKey,
      projectSlug: 'mkt',
      via: 'mkt',
      kind: 'task',
      goal: 'Open the contact page',
      mode: 'act',
      maxSteps: 5,
    });
    expect(started.status).toBe(200);
    const task = (await started.json()) as { taskToken: string; policy: string; model: string };
    expect(task).toMatchObject({ policy: 'laya', model: 'mock-1' });

    const answer = await internal('/internal/browser-gateway/systemone', {
      taskToken: task.taskToken,
      state: { page: { text: 'Hallo' } },
      questions: { done: { type: 'noul', instructions: 'Done?' } },
    });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({
      model: 'mock-1',
      answers: { done: { noul: 0.9 } },
      inputTokens: 120,
    });
    expect(received.at(-1)?.auth).toBe(`Bearer ${BACKEND_KEY}`);

    const progress = await internal('/internal/browser-gateway/task/progress', {
      taskToken: task.taskToken,
      step: {
        n: 1,
        operation: 'CLICK',
        element: 'link "Kontakt"',
        category: 'write',
        probability: 0.9,
        value: 'secret',
      },
    });
    expect(await progress.json()).toEqual({ cancelled: false });

    await internal('/internal/browser-gateway/task/finish', {
      taskToken: task.taskToken,
      result: {
        status: 'done',
        summary: 'Done: Open the contact page',
        url: 'https://x.test/kontakt',
        durationMs: 1234,
        usage: { calls: 1 },
      },
    });
    const [row] = await db.select().from(helenaBrowserTaskRun);
    expect(row).toMatchObject({
      status: 'done',
      decisions: 1,
      inputTokens: 120,
      source: 'agent',
      provider: 'local',
      modelReported: 'mock-1',
    });
    expect(JSON.stringify(row!.steps)).not.toContain('secret');
    const ledger = await db.select().from(agentUsage).where(eq(agentUsage.agentId, agent.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      kind: 'tool',
      runtime: 'browser-gateway',
      provider: 'local',
      inputTokens: 120,
    });
    const events = await db.select().from(browserGatewayEvent);
    expect(
      events.some((event) => event.tool === 'browser_task' && event.category === 'write'),
    ).toBe(true);

    // The token stops working with the task.
    const late = await internal('/internal/browser-gateway/systemone', {
      taskToken: task.taskToken,
      state: 'x',
      questions: { done: { type: 'noul', instructions: 'Done?' } },
    });
    expect(late.status).toBe(404);
  });

  it('returns a safe API error to both browser decision paths for a malformed legacy key', async () => {
    const { apiKey, credentialId } = await withDecisionModel();
    const secret = 'fixture-browser-secret\nsecond-line';
    await db
      .update(integrationCredential)
      .set(sealCredential(credentialId, JSON.stringify({ value: secret })))
      .where(eq(integrationCredential.id, credentialId));
    const started = await internal('/internal/browser-gateway/task/start', {
      agentKey: apiKey,
      projectSlug: 'mkt',
      via: 'mkt',
      goal: 'Fixture',
    });
    expect(started.status).toBe(200);
    const task = (await started.json()) as { taskToken: string };
    const before = backendHits;
    const payload = {
      state: 'fixture',
      questions: { q: { type: 'noul', instructions: 'Ready?' } },
    };
    const answer = await internal('/internal/browser-gateway/systemone', {
      taskToken: task.taskToken,
      ...payload,
    });
    expect(answer.status).toBe(409);
    expect(await answer.text()).not.toContain('fixture-browser-secret');
    const jev = await app.handle(
      new Request('http://localhost/internal/systemone/v1/systemone', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${task.taskToken}` },
        body: JSON.stringify(payload),
      }),
    );
    expect(jev.status).toBe(409);
    expect(await jev.text()).not.toContain('fixture-browser-secret');
    expect(backendHits).toBe(before);
  });

  it('serves jev-browser through the proxy on loopback only, under the run token', async () => {
    const { apiKey } = await withDecisionModel();
    const task = (await (
      await internal('/internal/browser-gateway/task/start', {
        agentKey: apiKey,
        projectSlug: 'mkt',
        via: 'mkt',
        goal: 'x',
      })
    ).json()) as { taskToken: string };
    const call = (headers: Record<string, string>) =>
      app.handle(
        new Request('http://localhost/internal/systemone/v1/systemone', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({
            model: 'jev-latest',
            state: 'x',
            questions: { q: { type: 'noul', instructions: 'Y?' } },
          }),
        }),
      );
    const ok = await call({ authorization: `Bearer ${task.taskToken}` });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      answers: { q: { noul: 0.9 } },
      usage: { input_tokens: 120 },
    });
    expect((await call({ authorization: 'Bearer nope-nope-nope-nope-nope-nope' })).status).toBe(
      401,
    );
    expect(
      (await call({ authorization: `Bearer ${task.taskToken}`, 'x-real-ip': '192.168.1.5' }))
        .status,
    ).toBe(404);
  });

  it('follows the instance default when the project inherits', async () => {
    const { asOwner, mkt, apiKey } = await setup();
    const created = (await connection(asOwner, mkt.teamId)).data!;
    const set = await asOwner.god['browser-control'].put({
      mode: 'decision',
      credentialId: created.id,
      policy: 'jev',
    });
    expect(set.status).toBe(200);
    const view = await asOwner.projects({ projectKey: 'MKT' }).settings['browser-control'].get();
    expect(view.data).toMatchObject({
      setting: { mode: 'inherit' },
      effective: { enabled: true, source: 'instance', policy: 'jev', credentialId: created.id },
    });
    const resolved = (await (
      await internal('/internal/browser-gateway/resolve', {
        agentKey: apiKey,
        projectSlug: 'mkt',
        via: 'mkt',
      })
    ).json()) as { browserTask: unknown };
    expect(resolved.browserTask).toMatchObject({ enabled: true, policy: 'jev' });
  });
});

describe('Browser 2.0', () => {
  beforeEach(resetDb);

  it('offers the project agents with the browser and the connections', async () => {
    const { asOwner, agent, mkt } = await setup();
    await connection(asOwner, mkt.teamId);
    const options = await asOwner.projects({ projectKey: 'MKT' })['browser-lab'].options.get();
    expect(options.data?.agents.map((a) => a.id)).toContain(agent.id);
    expect(options.data?.connections).toHaveLength(1);
    expect(options.data?.slug).toBe('mkt');
  });

  it('starts a Standard run as a chat message to the agent', async () => {
    const { asOwner, agent } = await setup();
    const run = await asOwner.projects({ projectKey: 'MKT' })['browser-lab'].runs.post({
      backend: 'standard',
      agentId: agent.id,
      goal: 'Öffne die Kontakt-Seite',
      values: { name: 'Ada' },
    });
    expect(run.status).toBe(200);
    expect(run.data).toMatchObject({ backend: 'standard', status: 'running', valueKeys: ['name'] });
    expect(run.data?.chatThreadId).toBeTruthy();
    const listed = await asOwner
      .projects({ projectKey: 'MKT' })
      ['browser-lab'].runs.get({ query: {} });
    expect(listed.data?.runs).toHaveLength(1);
    const cancelled = await asOwner
      .projects({ projectKey: 'MKT' })
      ['browser-lab'].runs({ runId: run.data!.id })
      .cancel.post();
    expect(cancelled.data?.status).toBe('cancelled');
  });

  it('reports a decision run the browser router could not start', async () => {
    const { asOwner, agent, mkt } = await setup();
    const created = (await connection(asOwner, mkt.teamId)).data!;
    const run = await asOwner.projects({ projectKey: 'MKT' })['browser-lab'].runs.post({
      backend: 'decision',
      agentId: agent.id,
      credentialId: created.id,
      goal: 'Öffne die Kontakt-Seite',
    });
    expect(run.status).toBe(200);
    expect(run.data).toMatchObject({ backend: 'decision', status: 'error', policy: 'laya' });
  });

  it('keeps router response bodies and service tokens out of Browserlab errors', async () => {
    const { asOwner, agent, mkt } = await setup();
    const created = (await connection(asOwner, mkt.teamId)).data!;
    const previous = process.env.HELENA_BROWSER_ROUTER_URL;
    process.env.HELENA_BROWSER_ROUTER_URL = backendUrl;
    try {
      const run = await asOwner.projects({ projectKey: 'MKT' })['browser-lab'].runs.post({
        backend: 'decision',
        agentId: agent.id,
        credentialId: created.id,
        goal: 'Fixture',
      });
      expect(run.data).toMatchObject({
        status: 'error',
        summary: 'The browser router did not start the run.',
      });
      const listed = await asOwner
        .projects({ projectKey: 'MKT' })
        ['browser-lab'].runs.get({ query: {} });
      expect(JSON.stringify(listed.data)).not.toContain(GATEWAY_TOKEN);
      try {
        await postToRouter('/internal/gateway/lab', {});
        throw new Error('Expected refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect(String(error)).not.toContain(GATEWAY_TOKEN);
        expect((error as Error).cause).toBeUndefined();
      }
    } finally {
      process.env.HELENA_BROWSER_ROUTER_URL = previous;
    }
  });

  it('refuses an agent without the project browser', async () => {
    const { asOwner } = await setup();
    const other = await createAgent(asOwner, 'MKT', {
      name: 'Plain',
      username: 'plain',
      kind: 'external',
    });
    const run = await asOwner.projects({ projectKey: 'MKT' })['browser-lab'].runs.post({
      backend: 'standard',
      agentId: other.data!.agent.id,
      goal: 'x',
    });
    expect(run.status).toBe(400);
  });
});

describe('safe decision error messages', () => {
  it('never copies SDK messages, raw strings, causes or HttpError messages', () => {
    const secret = 'fixture-secret-never-publish';
    for (const error of [
      new APIConnectionError(`Headers.append: Bearer ${secret}\nkey is invalid`, {
        cause: new Error(secret),
      }),
      new Error(secret),
      secret,
      new HttpError(502, secret),
      { message: secret, status: NaN },
    ]) {
      const result = describeFailure(error);
      expect(result.status).toBe(502);
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    const billing = describeFailure(
      APIError.fromResponse(402, { error: { message: secret } }, new Headers()),
    );
    expect(billing.message).toContain('billing or credits');
    expect(billing.message).not.toContain(secret);
    expect(
      describeFailure(APIError.fromResponse(413, { error: secret }, new Headers())).message,
    ).toContain('reduce its input');
    expect(
      describeFailure(Object.assign(new APITimeoutError(1000), { message: secret })).status,
    ).toBe(504);
  });
});
