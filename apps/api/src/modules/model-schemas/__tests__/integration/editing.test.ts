import { beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../../../../app';
import { authedApi, apiKeyApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { bootstrapHomeAgent } from '../../../../scripts/bootstrap-home-agent';
import { routeTools } from '#mcp/generate';
import { dispatchTool } from '#mcp/dispatch';
import type { ModelSchema } from '../../templates';
import { agentDecisionSetting } from '../../service';

type Reply = {
  revision: number;
  active: string;
  schema: ModelSchema & { builtIn: boolean };
  schemas: Record<string, ModelSchema>;
  catalog: { id: string }[];
  entries: { revision: number; actorId: string; action: string; schemaIds: string[] }[];
  retainedOverrides: { agentId: number; columns: string[] }[];
};

const base = '/god/model-schemas';
async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  await api.projects.post({ key: 'SCH', name: 'Schemas' });
  const created = (
    await createAgent(api, 'SCH', {
      name: 'Catalog',
      username: 'catalog',
      kind: 'external',
      runtimePolicy: {
        runtime: 'codex',
        reasoningEffort: null,
        files: [],
        toolAllow: [],
        toolDeny: [],
        mcpGrants: [],
      },
    })
  ).data!;
  await apiKeyApi(created.apiKey!)['agent-chats'].catalog.post({
    models: [
      {
        id: 'gpt-6.1-sol',
        name: 'Sol',
        reasoning: true,
        thinkingLevels: ['medium', 'high', 'max'],
        thinkingDefault: 'high',
        listed: true,
      },
      {
        id: 'plain-model',
        name: 'Plain',
        reasoning: false,
        thinkingLevels: [],
        thinkingDefault: null,
        listed: true,
      },
    ],
  });
  const call = async (method: string, path = '', body?: unknown, cookie = owner.cookie) => {
    const response = await app.handle(
      new Request(`http://localhost${base}${path}`, {
        method,
        headers: { cookie, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return { status: response.status, body: (await response.json()) as Reply };
  };
  return { call, owner, created, api };
}

describe('editable model schemas', () => {
  beforeEach(resetDb);

  it('creates an empty draft, copies built-ins, renames, deletes and audits without changing originals', async () => {
    const { call, owner } = await setup();
    const original = (await call('GET', '/matrix')).body.schemas['nur-codex'];
    const empty = await call('POST', '', { expectedRevision: 0, id: 'empty', name: 'Empty' });
    expect(empty.status).toBe(201);
    expect(empty.body.schema.roles).toEqual({});
    expect((await call('POST', '/preview', { expectedRevision: 1, active: 'empty' })).status).toBe(
      400,
    );
    expect(
      (
        await call('POST', '', {
          expectedRevision: 1,
          id: 'copy',
          name: 'Copy',
          copyFrom: 'nur-codex',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call('PATCH', '/copy', {
          expectedRevision: 2,
          name: 'Renamed',
          description: 'My schema',
        })
      ).body.schema,
    ).toMatchObject({ name: 'Renamed', description: 'My schema', builtIn: false });
    expect((await call('DELETE', '/empty', { expectedRevision: 3 })).status).toBe(200);
    expect((await call('GET', '/matrix')).body.schemas['nur-codex']).toEqual(original);
    const audit = (await call('GET', '/audit')).body.entries;
    expect(audit).toHaveLength(4);
    expect(audit[0]).toMatchObject({
      revision: 4,
      actorId: owner.userId,
      action: 'delete',
      schemaIds: ['empty'],
    });
    expect((await call('GET', '/empty')).status).toBe(404);
    expect((await call('GET', '')).body.active).toBe('nur-lokal');
  });

  it('validates catalog models and reasoning, previews preserved agent overrides and applies custom schemas', async () => {
    const { call, created } = await setup();
    await call('POST', '', { expectedRevision: 0, id: 'custom', name: 'Custom' });
    expect(
      (await call('PATCH', '/custom/roles/general', { expectedRevision: 1, values: {} })).status,
    ).toBe(400);
    expect((await call('PATCH', '/custom', { expectedRevision: 1, name: '   ' })).status).toBe(400);
    expect(
      (await call('PATCH', '/custom', { expectedRevision: 1, name: 'x'.repeat(121) })).status,
    ).toBe(400);
    expect((await call('PATCH', '/missing', { expectedRevision: 1, name: 'Missing' })).status).toBe(
      404,
    );
    const values = { runtime: 'codex', model: 'gpt-6.1-sol', reasoning: 'max' };
    expect(
      (await call('PATCH', '/custom/roles/general', { expectedRevision: 1, values })).status,
    ).toBe(200);
    for (const invalid of [
      { model: 'unknown' },
      { reasoning: 'ultra' },
      { runtime: 'claude' },
      { decision: { backend: 'npu', threshold: 0.8, fallback: 'gpu', privateData: false } },
      {
        escalation: {
          target: 'claude',
          model: 'unknown',
          afterFailures: 1,
          onResumeLimit: true,
          onRequest: true,
          maxDepth: 1,
        },
      },
    ]) {
      expect([400, 409]).toContain(
        (await call('PATCH', '/custom/roles/general', { expectedRevision: 2, values: invalid }))
          .status,
      );
    }
    expect(
      (
        await call('PATCH', '/custom/roles/general', {
          expectedRevision: 2,
          values: {
            decision: { backend: 'jev-local', threshold: 0.8, fallback: 'gpu', privateData: true },
            browser: 'combined',
            device: 'cloud',
          },
        })
      ).status,
    ).toBe(200);
    const patch = { expectedRevision: 3, active: 'custom' };
    const preview = await call('POST', '/preview', patch);
    expect(preview.status).toBe(200);
    expect(preview.body.retainedOverrides).toContainEqual(
      expect.objectContaining({ agentId: created.agent.id, columns: ['runtime'] }),
    );
    expect((await call('POST', '/apply', patch)).status).toBe(200);
    expect(await agentDecisionSetting(created.agent.id)).toEqual({
      backend: 'jev-local',
      threshold: 0.8,
      fallback: 'gpu',
      privateData: true,
    });
    expect((await call('GET', '')).body.active).toBe('custom');
    expect((await call('DELETE', '/custom', { expectedRevision: 4 })).status).toBe(409);
    expect(
      (
        await call('PATCH', '/custom/roles/general', {
          expectedRevision: 4,
          values: { model: 'plain-model', reasoning: null },
        })
      ).status,
    ).toBe(200);
  });

  it('rejects built-in mutations, missing sources, duplicates, stale and simultaneous writes', async () => {
    const { call } = await setup();
    for (const [method, path, body] of [
      ['PATCH', '/nur-codex', { name: 'Changed' }],
      ['PATCH', '/nur-codex/roles/general', { values: { model: 'gpt-6.1-sol' } }],
      ['DELETE', '/nur-codex', {}],
    ] as const)
      expect((await call(method, path, { expectedRevision: 0, ...body })).status).toBe(409);
    const original = (await call('GET', '/matrix')).body.schemas['nur-codex'];
    expect(
      (
        await call('POST', '/apply', {
          expectedRevision: 0,
          schema: { ...original, name: 'Changed' },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call('POST', '', {
          expectedRevision: 0,
          id: 'copy',
          name: 'Copy',
          copyFrom: 'missing',
        })
      ).status,
    ).toBe(404);
    expect(
      (await call('POST', '', { expectedRevision: 0, id: 'bad id', name: 'Bad' })).status,
    ).toBe(400);
    await call('POST', '', {
      expectedRevision: 0,
      id: 'copy',
      name: 'Copy',
      copyFrom: 'nur-codex',
    });
    expect((await call('POST', '', { expectedRevision: 1, id: 'copy', name: 'Copy' })).status).toBe(
      409,
    );
    expect((await call('PATCH', '/copy', { expectedRevision: 0, name: 'Stale' })).status).toBe(409);
    expect(
      (
        await call('PATCH', '/copy/roles/unknown', {
          expectedRevision: 1,
          values: { reasoning: 'high' },
        })
      ).status,
    ).toBe(400);
    const writes = await Promise.all(
      ['One', 'Two'].map((name) => call('PATCH', '/copy', { expectedRevision: 1, name })),
    );
    expect(writes.map((write) => write.status).sort()).toEqual([200, 409]);
    expect((await call('GET', '/audit')).body.entries).toHaveLength(2);
  });

  it('exposes MCP tools to Home and refuses regular users and project agents', async () => {
    const { call, owner, created } = await setup();
    const member = await signUpTestUser();
    expect((await call('GET', '', undefined, member.cookie)).status).toBe(403);
    expect((await apiKeyApi(created.apiKey!).god['model-schemas'].matrix.get()).status).toBe(403);
    const home = await bootstrapHomeAgent();
    if (home.status !== 'ready') throw new Error('Home missing');
    const tools = routeTools(app).filter((tool) => tool.path.startsWith(base));
    expect(tools).toHaveLength(10);
    const tool = tools.find((tool) => tool.name === 'create_model_schema')!;
    expect(tool).toBeDefined();
    const result = await dispatchTool(
      app,
      tool,
      { expectedRevision: 0, id: 'home-copy', name: 'Home', copyFrom: 'nur-codex' },
      { kind: 'api-key', apiKey: home.apiKey! },
      { viaMcpEndpoint: false },
    );
    expect(result.isError).toBe(false);
    expect((await call('GET', '/home-copy', undefined, owner.cookie)).status).toBe(200);
  });

  it('keeps project-bound schemas until unbound and projects active edits onto agents', async () => {
    const { call, api, created } = await setup();
    const project = (await api.projects({ projectKey: 'SCH' }).get()).data!.project;
    await call('POST', '', { expectedRevision: 0, id: 'bound', name: 'Bound' });
    await call('PATCH', '/bound/roles/general', {
      expectedRevision: 1,
      values: { runtime: 'codex', model: 'gpt-6.1-sol', reasoning: 'high' },
    });
    expect(
      (
        await call('POST', '/apply', {
          expectedRevision: 2,
          projects: [{ projectId: project.id, schemaId: 'bound' }],
        })
      ).status,
    ).toBe(200);
    expect((await call('DELETE', '/bound', { expectedRevision: 3 })).status).toBe(409);
    expect(
      (
        await call('PATCH', '/bound/roles/general', {
          expectedRevision: 3,
          values: { reasoning: 'max' },
        })
      ).status,
    ).toBe(200);
    const route = api.teams({ teamId: project.teamId })['ai-agents']({ agentId: created.agent.id });
    expect((await route.get()).data!.runtimePolicy.reasoningEffort).toBe('max');
    expect(
      (
        await call('POST', '/apply', {
          expectedRevision: 4,
          projects: [{ projectId: project.id, schemaId: null }],
        })
      ).status,
    ).toBe(200);
    expect((await call('DELETE', '/bound', { expectedRevision: 5 })).status).toBe(200);
  });

  it('refuses catalog models after a provider failure and leaves the schema revision intact', async () => {
    const { call, api, created } = await setup();
    await call('POST', '', { expectedRevision: 0, id: 'custom', name: 'Custom' });
    await call('PATCH', '/custom/roles/general', {
      expectedRevision: 1,
      values: { runtime: 'codex', model: 'gpt-6.1-sol', reasoning: 'high' },
    });
    expect((await call('POST', '/apply', { expectedRevision: 2, active: 'custom' })).status).toBe(
      200,
    );
    const runner = apiKeyApi(created.apiKey!);
    expect(
      (
        await api
          .projects({ projectKey: 'SCH' })
          ['ai-agents']({ agentId: created.agent.id })
          .chat.post({ prompt: 'Hello', model: 'gpt-6.1-sol' })
      ).status,
    ).toBe(200);
    const claimed = (await runner['agent-chats'].claim.post()).data!.message!;
    expect(
      (
        await runner['agent-chats']({ messageId: claimed.id }).result.post({
          status: 'failed',
          error: 'Unavailable',
          failure: {
            code: 'model-unavailable',
            retryable: false,
            model: 'gpt-6.1-sol',
            detail: 'Unavailable for this test account',
          },
          runtime: {
            requested: { model: 'gpt-6.1-sol', reasoning: 'high', provider: null },
            defaults: { model: 'gpt-6.1-sol', reasoning: 'high', provider: null },
            used: null,
          },
        })
      ).status,
    ).toBe(204);
    expect(
      (await call('GET', '')).body.catalog.some(
        (model: { id: string }) => model.id === 'gpt-6.1-sol',
      ),
    ).toBe(false);
    expect(
      (await call('PATCH', '/custom', { expectedRevision: 3, name: 'Renamed while unavailable' }))
        .status,
    ).toBe(200);
    expect(
      (
        await call('PATCH', '/custom/roles/general', {
          expectedRevision: 4,
          values: { runtime: 'codex', model: 'gpt-6.1-sol', reasoning: 'max' },
        })
      ).status,
    ).toBe(400);
    expect((await call('GET', '/custom')).body.revision).toBe(4);
  });

  it('uses enabled local catalog models for Flash and rejects models on disabled servers', async () => {
    const { call, api } = await setup();
    const fake = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith('/models'))
          return Response.json({ object: 'list', data: [{ id: 'halogen-qwen3.8-flash-next' }] });
        return Response.json({ status: 'ok' });
      },
    });
    try {
      const added = await api.god['local-ai'].servers.post({
        kind: 'openai-compatible',
        name: 'Flash test',
        baseUrl: `http://127.0.0.1:${fake.port}/v1`,
        keySource: 'none',
      });
      expect(added.status).toBe(200);
      expect((await api.god['local-ai'].policy.patch({ enabled: true })).status).toBe(200);
      const model = added.data!.models[0]!.modelId;
      await call('POST', '', { expectedRevision: 0, id: 'flash', name: 'Flash' });
      expect(
        (
          await call('PATCH', '/flash/roles/general', {
            expectedRevision: 1,
            values: { model, runtime: 'helena', reasoning: null },
          })
        ).status,
      ).toBe(200);
      expect(
        (await api.god['local-ai'].servers({ id: added.data!.id }).patch({ enabled: false }))
          .status,
      ).toBe(200);
      expect(
        (await call('POST', '/preview', { expectedRevision: 2, active: 'flash' })).status,
      ).toBe(400);
    } finally {
      fake.stop(true);
    }
  });
});
