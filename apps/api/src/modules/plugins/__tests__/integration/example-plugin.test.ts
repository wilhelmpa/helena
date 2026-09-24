import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { auth } from '@repo/auth';
import { setPluginSettings } from '@repo/db';
import { discoverPlugins } from '@helena/sdk/server';
import { app, authedApi } from '#tests/helpers/app';
import { resetDb } from '#tests/helpers/db';
import { signUpTestUser } from '#tests/helpers/auth';
import { teamOf } from '#tests/helpers/agents';
import { host } from '#shared/helena';
import { loadExternalServerPlugins } from '../../service';

// The example plugin (examples/plugins/hello-helena) goes through the real path: found in
// HELENA_PLUGINS_DIR, switched on and approved in the Administrator's settings, loaded at
// start, and then reachable where Helena's own features are: its tool in the MCP endpoint,
// its connector in the integrations catalog, its panel tool among the UI slots and its
// page served for a sandboxed frame. Nothing in Helena names it.

const ROOT = join(import.meta.dir, '../../../../../../../examples/plugins');
const saved = process.env.HELENA_PLUGINS_DIR;

async function mcp(apiKey: string, method: string, params: Record<string, unknown>) {
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
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  return JSON.parse(line ? line.slice(6) : text) as { result: Record<string, unknown> };
}

describe('the example plugin in the API', () => {
  beforeAll(() => {
    process.env.HELENA_PLUGINS_DIR = ROOT;
  });
  afterAll(async () => {
    await host.unload('hello-helena');
    if (saved === undefined) delete process.env.HELENA_PLUGINS_DIR;
    else process.env.HELENA_PLUGINS_DIR = saved;
  });
  beforeEach(async () => {
    await resetDb();
    await host.unload('hello-helena');
  });

  it('is not loaded until external plugins are on and it is approved', async () => {
    const [plugin] = await loadExternalServerPlugins();
    expect(plugin?.status).toBe('disabled');
    expect(host.get('hello-helena')?.status).toBe('disabled');
  });

  it('adds its tool, connector, panel tool and page without any change to Helena', async () => {
    const [found] = await discoverPlugins(ROOT);
    await setPluginSettings({
      externalEnabled: true,
      approved: [{ id: 'hello-helena', version: '0.1.0', digest: found!.digest! }],
      settings: {},
    });
    const [plugin] = await loadExternalServerPlugins();
    expect(plugin?.status).toBe('loaded');

    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    const created = await auth.api.createApiKey({ body: { userId: owner.userId, name: 'mcp' } });

    // The MCP endpoint serves the plugin's own tool next to Helena's route tools.
    const listed = await mcp(created.key, 'tools/list', {});
    const tools = listed.result.tools as Array<{ name: string; _meta?: Record<string, string> }>;
    const time = tools.find((tool) => tool.name === 'hello_time');
    expect(time?._meta?.['helena/action']).toBe('read');
    expect(tools.some((tool) => tool.name === 'create_issue')).toBe(true);
    // A connector's tool runs only with a bound credential, so it is not served here.
    expect(tools.some((tool) => tool.name === 'hello_greet')).toBe(false);
    const called = await mcp(created.key, 'tools/call', {
      name: 'hello_time',
      arguments: { timeZone: 'Europe/Berlin' },
    });
    expect(called.result.structuredContent).toMatchObject({ timeZone: 'Europe/Berlin' });

    // Its connector is in the integrations catalog with its tool and category.
    await api.projects.post({ key: 'HLO', name: 'Hello' });
    const teamId = await teamOf(api, 'HLO');
    const catalog = await app.handle(
      new Request(`http://localhost/teams/${teamId}/integrations/catalog`, {
        headers: { cookie: owner.cookie },
      }),
    );
    const entries = (await catalog.json()) as Array<{
      key: string;
      tools: Array<{ key: string; category?: string }>;
    }>;
    const greeter = entries.find((entry) => entry.key === 'hello-greeter');
    expect(greeter?.tools).toEqual([
      expect.objectContaining({ key: 'hello_greet', category: 'send' }),
    ]);

    // Its panel tool is among the UI slots, and its page is served for a sandboxed frame.
    const slots = await app.handle(
      new Request('http://localhost/plugins/ui-slots', { headers: { cookie: owner.cookie } }),
    );
    expect(await slots.json()).toContainEqual(
      expect.objectContaining({
        key: 'panel-tool:hello',
        pluginId: 'hello-helena',
        render: { kind: 'frame', src: 'panel.html' },
      }),
    );
    const page = await app.handle(
      new Request('http://localhost/plugins/hello-helena/ui/panel.html'),
    );
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain('sandbox');
    const escape = await app.handle(
      new Request('http://localhost/plugins/hello-helena/ui/..%2Fserver.ts'),
    );
    expect(escape.status).toBe(404);
  });

  it('is listed for the Administrator with what it provides and asks for', async () => {
    const owner = await signUpTestUser();
    const overview = await app.handle(
      new Request('http://localhost/god/plugins', { headers: { cookie: owner.cookie } }),
    );
    expect(overview.status).toBe(200);
    const body = (await overview.json()) as {
      externalEnabled: boolean;
      plugins: Array<{
        id: string;
        source: string;
        approved: boolean;
        permissions: { actions: string[] };
      }>;
    };
    expect(body.externalEnabled).toBe(false);
    expect(body.plugins.find((p) => p.id === 'helena.mcp')?.source).toBe('builtin');
    const example = body.plugins.find((p) => p.id === 'hello-helena');
    expect(example).toMatchObject({ source: 'external', approved: false });
    expect(example?.permissions.actions).toEqual(['read', 'report', 'send']);
  });
});
