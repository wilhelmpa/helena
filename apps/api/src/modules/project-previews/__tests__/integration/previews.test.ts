import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { authedApi, app } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import { AGENT_PROJECT_HEADER } from '#shared/agent-socket';
import { resetDb } from '#tests/helpers/db';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';
import { emptyPermissions } from '#shared/permissions';
import { routeTools } from '#mcp/generate';
import { PreviewLauncherError, usePreviewTransport } from '../../launcher';
import { getProjectPreviewOrigins, redactPreviewText } from '../../service';
import type { Preview } from '../../model';

const ready: Preview = {
  name: 'main',
  slug: 'mkt',
  status: 'running',
  url: 'http://127.0.0.1:46001/',
  port: 46001,
  cwd: 'site',
  command: 'npm run dev',
  startedAt: 1,
  lastActivityAt: 2,
  idleTimeoutSec: 14400,
};
let calls: Record<string, unknown>[];
let previews: Preview[];
let startState: Preview;
beforeEach(async () => {
  await resetDb();
  calls = [];
  previews = [{ ...ready }];
  startState = { ...ready };
  usePreviewTransport(async (request) => {
    calls.push(request);
    if (request.op === 'preview-status')
      return { previews: previews.filter((p) => !request.name || p.name === request.name) };
    if (request.op === 'preview-start')
      return { preview: startState, lines: ['API_TOKEN=private-value'] };
    if (request.op === 'preview-logs')
      return { preview: ready, lines: ['API_TOKEN=private-value', 'ready'] };
    if (request.op === 'preview-stop') return { preview: { ...ready, status: 'stopped' } };
    throw new PreviewLauncherError('invalid', 'Invalid operation');
  });
});
afterEach(() => usePreviewTransport(null));
async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ name: 'Marketing', key: 'MKT' })).data!;
  return { api, project, routes: api.projects({ projectKey: 'MKT' }).previews };
}
async function callPreview(apiKey: string, name: string, projectKey = 'MKT') {
  const response = await app.handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        [AGENT_PROJECT_HEADER]: 'mkt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: { projectKey } },
      }),
    }),
  );
  expect(response.status).toBe(200);
  const event = (await response.text()).split('\n').find((line) => line.startsWith('data: '));
  expect(event).toBeDefined();
  return CallToolResultSchema.parse(JSON.parse(event!.slice(6)).result);
}
describe('project previews', () => {
  it('waits for the launcher result and supplies only the authorized project slug', async () => {
    const { routes } = await setup();
    const result = await routes.start.post({ name: 'site', cwd: 'homepage/homepage' });
    expect(result.status).toBe(200);
    expect(result.data?.preview.status).toBe('running');
    expect(result.data?.browserInstruction).toContain(ready.url);
    expect(result.data?.browserInstruction).toContain('project MKT');
    expect(result.data?.browserInstruction).toContain('browser_navigate');
    expect(calls).toEqual([
      { op: 'preview-start', slug: 'mkt', name: 'site', cwd: 'homepage/homepage' },
    ]);
    expect(result.data?.lines).toEqual(['API_TOKEN=[redacted]']);
  });
  it('preserves failed readiness instead of claiming the preview is running', async () => {
    const { routes } = await setup();
    startState = { ...ready, status: 'failed', error: 'Readiness timed out' };
    const result = await routes.start.post({});
    expect(result.data?.preview).toMatchObject({ status: 'failed', error: 'Readiness timed out' });
    expect(result.data).not.toHaveProperty('browserInstruction');
    const url = await routes.url.get();
    expect(url.data?.url).toBe(ready.url);
    expect(url.data?.browserInstruction).toContain(ready.url);
    expect(url.data?.browserInstruction).toContain('browser_snapshot');
    previews = [startState];
    expect((await routes.url.get()).status).toBe(409);
  });
  it('preserves ready browser guidance in both MCP JSON representations', async () => {
    const { api } = await setup();
    const agent = (
      await createAgent(api, 'MKT', {
        name: 'Preview coder',
        username: 'previewcoder',
        kind: 'external',
      })
    ).data!;
    for (const name of ['preview_start', 'preview_url']) {
      const result = await callPreview(agent.apiKey!, name);
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({
        ok: true,
        status: 200,
        data: { browserInstruction: expect.stringContaining(ready.url) },
      });
      const content = result.content.find((entry) => entry.type === 'text');
      expect(content?.type).toBe('text');
      if (content?.type !== 'text') throw new Error('Expected preview JSON text');
      const data = JSON.parse(content.text);
      expect(data).toEqual(result.structuredContent?.data);
      expect(data.browserInstruction).toContain('project MKT');
      expect(data.browserInstruction).toContain('browser_navigate');
      expect(data.browserInstruction).toContain('browser_snapshot');
      expect(content.text).not.toContain('private-value');
    }
  });
  it('never offers ready browser guidance for non-running MCP previews', async () => {
    const { api } = await setup();
    const agent = (
      await createAgent(api, 'MKT', {
        name: 'Preview coder',
        username: 'previewcoder',
        kind: 'external',
      })
    ).data!;
    for (const status of ['starting', 'failed', 'stopped'] as const) {
      startState = { ...ready, status };
      previews = [startState];
      const started = await callPreview(agent.apiKey!, 'preview_start');
      expect(started.structuredContent).toMatchObject({
        ok: true,
        status: 200,
        data: { preview: { status } },
      });
      expect(JSON.stringify(started)).not.toContain('browserInstruction');
      const url = await callPreview(agent.apiKey!, 'preview_url');
      expect(url.isError).toBe(true);
      expect(url.structuredContent).toMatchObject({ ok: false, status: 409 });
      expect(JSON.stringify(url)).not.toContain(ready.url);
      expect(JSON.stringify(url)).not.toContain('browserInstruction');
    }
  });
  it('lists, stops and reads bounded redacted logs', async () => {
    const { routes, project } = await setup();
    expect((await routes.get()).data).toMatchObject({
      projectId: project.id,
      canManage: true,
      previews: [ready],
    });
    expect((await routes.stop.post({ name: 'main' })).data?.preview.status).toBe('stopped');
    expect((await routes.logs.get({ query: { tail: 50 } })).data?.lines).toEqual([
      'API_TOKEN=[redacted]',
      'ready',
    ]);
    expect(calls.at(-1)).toMatchObject({ op: 'preview-logs', tail: 50, name: 'main' });
    expect((await routes.logs.get({ query: { tail: 201 } })).status).toBe(400);
    expect((await routes.start.post({ name: '../other' })).status).toBe(400);
    expect((await routes.start.post({ idleTimeoutSec: 59 })).status).toBe(400);
  });
  it('lists every named preview when no name was requested', async () => {
    const { routes } = await setup();
    previews = [ready, { ...ready, name: 'admin', port: 46002, url: 'http://127.0.0.1:46002/' }];
    expect((await routes.get()).data?.previews.map((preview) => preview.name)).toEqual([
      'main',
      'admin',
    ]);
    expect(calls.at(-1)).not.toHaveProperty('name');
  });
  it('refuses a non-member before reaching the launcher', async () => {
    await setup();
    const stranger = authedApi((await signUpTestUser()).cookie).projects({
      projectKey: 'MKT',
    }).previews;
    expect((await stranger.get()).status).toBe(403);
    expect((await stranger.start.post({})).status).toBe(403);
    expect((await stranger.logs.get()).status).toBe(403);
    expect((await stranger.stop.post({})).status).toBe(403);
    expect((await stranger.url.get()).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('narrows an agent socket to its own project even with memberships in both', async () => {
    const { api, project } = await setup();
    const other = (await api.projects.post({ key: 'OPS', name: 'Operations' })).data!;
    const agent = (
      await createAgent(api, 'MKT', {
        name: 'Coder',
        username: 'previewcoder',
        kind: 'external',
        projectIds: [project.id, other.id],
      })
    ).data!;
    const headers = { 'x-api-key': agent.apiKey!, [AGENT_PROJECT_HEADER]: 'mkt' };
    expect(
      (await app.handle(new Request('http://localhost/projects/MKT/previews', { headers }))).status,
    ).toBe(200);
    calls = [];
    expect(
      (await app.handle(new Request('http://localhost/projects/OPS/previews', { headers }))).status,
    ).toBe(403);
    expect(calls).toHaveLength(0);
    for (const name of ['preview_status', 'preview_start', 'preview_url']) {
      const result = await callPreview(agent.apiKey!, name, 'OPS');
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        status: 403,
        error: { message: 'The preview belongs to another project' },
      });
      expect(JSON.stringify(result)).not.toContain(ready.url);
      expect(JSON.stringify(result)).not.toContain('browserInstruction');
    }
    expect(calls).toHaveLength(0);
  });
  it('allows a reader to inspect but not manage previews', async () => {
    const { api } = await setup();
    const permissions = emptyPermissions();
    permissions.documents.read = true;
    const role = (await createRole(api, 'MKT', { name: 'Preview reader', permissions })).data!;
    const member = await addProjectMember(api, 'MKT', role.id);
    const routes = member.projects({ projectKey: 'MKT' }).previews;
    expect((await routes.get()).data?.canManage).toBe(false);
    expect((await routes.start.post({})).status).toBe(403);
    expect((await routes.stop.post({})).status).toBe(403);
  });
  it('maps helper errors without exposing credentials', async () => {
    const { routes } = await setup();
    usePreviewTransport(async () => {
      throw new PreviewLauncherError('invalid', 'TOKEN=do-not-reveal');
    });
    const result = await routes.start.post({});
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.error?.value)).not.toContain('do-not-reveal');
  });
  it('offers only running exact project loopback origins to the gateway', async () => {
    previews = [
      ready,
      { ...ready, status: 'failed' },
      { ...ready, slug: 'other' },
      { ...ready, url: 'http://192.168.2.1:46001/' },
      { ...ready, url: 'http://127.0.0.1:5432/' },
      { ...ready, url: 'http://user:pass@127.0.0.1:46001/' },
    ];
    expect(await getProjectPreviewOrigins('MKT')).toEqual(['http://127.0.0.1:46001']);
  });
  it('keeps preview revision reads inside project permissions', async () => {
    const { api, project } = await setup();
    const scope = `projectPreviews:${project.id}`;
    expect((await api.sync.rev.get({ query: { scopes: scope } })).data?.revs[scope]).toMatch(
      /^[a-f0-9]{64}$/,
    );
    calls = [];
    const stranger = authedApi((await signUpTestUser()).cookie);
    expect((await stranger.sync.rev.get({ query: { scopes: scope } })).data?.revs[scope]).toBe('0');
    expect(calls).toHaveLength(0);
  });
  it('redacts quoted assignments, bearer headers and URL credentials', () => {
    for (const text of [
      'Authorization: Bearer hiddenvalue',
      '"API_KEY": "hiddenvalue with spaces"',
      "PASSWORD='hiddenvalue with spaces'",
      'https://user:hiddenvalue@localhost/',
    ]) {
      expect(redactPreviewText(text)).not.toContain('hiddenvalue');
    }
  });
  it('registers all five guarded MCP tools with workspace execution for mutations', () => {
    const tools = routeTools(app).filter((tool) => tool.name.startsWith('preview_'));
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'preview_logs',
      'preview_start',
      'preview_status',
      'preview_stop',
      'preview_url',
    ]);
    for (const tool of tools) {
      const writes = ['preview_start', 'preview_stop'].includes(tool.name);
      expect(tool.category).toBe(writes ? 'execute' : 'read');
      expect(tool.permission).toEqual(['documents', writes ? 'edit' : 'read']);
      if (writes) expect(tool.scope).toBe('workspace');
    }
  });
});
