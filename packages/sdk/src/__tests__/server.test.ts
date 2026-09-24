import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEvent, createEventBus, type HelenaEvent, type PluginManifest } from '../index';
import {
  PluginHost,
  bundleJsonSchema,
  createOutboxDispatcher,
  createOutboxTransport,
  loadExternalPlugins,
  manifestJsonSchema,
  parseManifest,
  pluginDigest,
  type OutboxDelivery,
  type OutboxStore,
} from '../server';

const base: PluginManifest = {
  id: 'acme.demo',
  name: 'Demo',
  version: '1.0.0',
  sdk: '^0.1.0',
  provides: { tools: ['demo_*'], stepTypes: ['acme.demo.wait'], events: ['acme.demo.pinged'] },
  permissions: { actions: ['read', 'write'], events: ['helena.issue.*'] },
};

describe('manifest', () => {
  test('accepts a valid manifest', () => {
    expect(parseManifest(base).id).toBe('acme.demo');
  });

  test('rejects reserved ids, bad versions and SDK ranges it does not satisfy', () => {
    expect(() => parseManifest({ ...base, id: 'helena.x' })).toThrow(/reserved/);
    expect(parseManifest({ ...base, id: 'helena.x' }, { builtin: true }).id).toBe('helena.x');
    expect(() => parseManifest({ ...base, version: 'one' })).toThrow(/version/);
    expect(() => parseManifest({ ...base, sdk: '^9.0.0' })).toThrow(/needs @helena\/sdk/);
    expect(() => parseManifest({ ...base, unknown: true })).toThrow(/Invalid plugin manifest/);
  });

  test('the published JSON Schemas are up to date', async () => {
    const read = async (name: string) =>
      JSON.parse(await readFile(join(import.meta.dir, '../../schema', name), 'utf8'));
    expect(await read('helena.plugin.schema.json')).toEqual(
      JSON.parse(JSON.stringify(manifestJsonSchema())),
    );
    expect(await read('helena.bundle.schema.json')).toEqual(
      JSON.parse(JSON.stringify(bundleJsonSchema())),
    );
  });
});

describe('plugin host', () => {
  test('stamps registrations with the plugin and enforces the manifest', async () => {
    const host = new PluginHost({ process: 'test' });
    const loaded = await host.load(
      {
        register(ctx) {
          ctx.tools.register({
            name: 'demo_read',
            description: 'Reads.',
            inputSchema: ctx.z.object({}),
            category: 'read',
            handler: async () => 'ok',
          });
        },
      },
      base,
      { source: 'external' },
    );
    expect(loaded.status).toBe('loaded');
    expect(host.tools.pluginOf('demo_read')).toBe('acme.demo');
  });

  test('refuses a tool of a category the manifest did not ask for, and rolls back', async () => {
    const host = new PluginHost({ process: 'test' });
    const loaded = await host.load(
      {
        register(ctx) {
          ctx.tools.register({
            name: 'demo_ok',
            description: 'Reads.',
            inputSchema: {},
            category: 'read',
            handler: async () => 'ok',
          });
          ctx.tools.register({
            name: 'demo_send',
            description: 'Sends.',
            inputSchema: {},
            category: 'send',
            handler: async () => 'sent',
          });
        },
      },
      base,
      { source: 'external' },
    );
    expect(loaded.status).toBe('failed');
    expect(loaded.error).toMatch(/"send"/);
    expect(host.tools.has('demo_ok')).toBe(false);
  });

  test('refuses what the manifest does not declare', async () => {
    const host = new PluginHost({ process: 'test' });
    const loaded = await host.load(
      {
        register(ctx) {
          ctx.runtimes.register({
            id: 'sneaky',
            label: 'Sneaky',
            protocol: 'acp',
            capabilities: {
              sessions: true,
              chat: true,
              systemPrompt: false,
              modelSelection: false,
              mcp: true,
              isolation: false,
            },
            launch: () => ({ bin: 'sneaky', args: [] }),
          });
        },
      },
      base,
      { source: 'external' },
    );
    expect(loaded.error).toMatch(/not declared in provides.runtimes/);
  });

  test('scopes event publishing and subscriptions', async () => {
    const host = new PluginHost({ process: 'test' });
    let publishError = '';
    let subscribeError = '';
    await host.load(
      {
        async register(ctx) {
          ctx.events.subscribe('helena.issue.created', () => {});
          try {
            ctx.events.subscribe('helena.run.*', () => {});
          } catch (error) {
            subscribeError = String(error);
          }
          await ctx.events.publish({ type: 'acme.demo.pinged', data: {} });
          try {
            await ctx.events.publish({ type: 'helena.issue.created', data: {} });
          } catch (error) {
            publishError = String(error);
          }
        },
      },
      base,
    );
    expect(subscribeError).toMatch(/permissions.events/);
    expect(publishError).toMatch(/its own id/);
    expect(host.events.subscriptions().map((sub) => sub.id)).toEqual([
      'acme.demo:helena.issue.created',
    ]);
  });

  test('registers MCP servers straight from the manifest', async () => {
    const host = new PluginHost({ process: 'test' });
    await host.load(
      { register() {} },
      {
        ...base,
        provides: {
          mcpServers: [{ name: 'demo-mcp', transport: 'http', url: 'http://127.0.0.1:9/mcp' }],
        },
      },
    );
    expect(host.mcpServers.get('demo-mcp')?.url).toBe('http://127.0.0.1:9/mcp');
  });
});

describe('external plugin loader', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  async function pluginFolder(): Promise<{ root: string; dir: string }> {
    const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'helena-plugins-'));
    dirs.push(root);
    const dir = join(root, 'demo');
    await mkdir(dir);
    await writeFile(
      join(dir, 'helena.plugin.json'),
      JSON.stringify({ ...base, main: { server: 'server.js' } }),
    );
    await writeFile(
      join(dir, 'server.js'),
      `export default { register(ctx) { ctx.tools.register({ name: 'demo_x', description: 'x', inputSchema: {}, category: 'read', handler: async () => 'x' }); } };\n`,
    );
    return { root, dir };
  }

  test('loads nothing while external plugins are switched off', async () => {
    const { root } = await pluginFolder();
    const host = new PluginHost({ process: 'test' });
    const [result] = await loadExternalPlugins(host, {
      root,
      entry: 'server',
      policy: { enabled: false, approved: [] },
    });
    expect(result?.status).toBe('disabled');
    expect(host.tools.has('demo_x')).toBe(false);
  });

  test('loads an approved plugin and refuses it once its code changes', async () => {
    const { root, dir } = await pluginFolder();
    const digest = await pluginDigest(dir, { ...base, main: { server: 'server.js' } });
    const policy = { enabled: true, approved: [{ id: 'acme.demo', version: '1.0.0', digest }] };

    const host = new PluginHost({ process: 'test' });
    const [loaded] = await loadExternalPlugins(host, { root, entry: 'server', policy });
    expect(loaded?.status).toBe('loaded');
    expect(host.tools.pluginOf('demo_x')).toBe('acme.demo');

    await writeFile(join(dir, 'server.js'), 'export default { register() {} };\n');
    const again = new PluginHost({ process: 'test' });
    const [changed] = await loadExternalPlugins(again, { root, entry: 'server', policy });
    expect(changed?.status).toBe('disabled');
    expect(changed?.error).toMatch(/Changed since/);
  });
});

describe('outbox dispatcher', () => {
  const quiet = { info() {}, warn() {}, error() {} };
  function memoryStore() {
    const events: Array<{ event: HelenaEvent; fanned: boolean }> = [];
    const deliveries: Array<
      OutboxDelivery & { status: 'pending' | 'done' | 'dead'; due: number; error?: string }
    > = [];
    let next = 1;
    const store: OutboxStore = {
      async append(list) {
        events.push(...list.map((event) => ({ event, fanned: false })));
      },
      async fanOut(route, limit) {
        const batch = events.filter((row) => !row.fanned).slice(0, limit);
        for (const row of batch) {
          for (const consumer of route(row.event)) {
            deliveries.push({
              deliveryId: next++,
              consumer,
              attempt: 0,
              event: row.event,
              status: 'pending',
              due: 0,
            });
          }
          row.fanned = true;
        }
        return batch.length;
      },
      async claim(consumers, limit) {
        const due = deliveries
          .filter(
            (d) => d.status === 'pending' && d.due <= Date.now() && consumers.includes(d.consumer),
          )
          .slice(0, limit);
        for (const d of due) d.attempt++;
        return due.map((d) => ({ ...d }));
      },
      async complete(id) {
        deliveries.find((d) => d.deliveryId === id)!.status = 'done';
      },
      async retry(id, at, error) {
        const d = deliveries.find((row) => row.deliveryId === id)!;
        d.due = at.getTime();
        d.error = error;
      },
      async fail(id, error) {
        const d = deliveries.find((row) => row.deliveryId === id)!;
        d.status = 'dead';
        d.error = error;
      },
      async prune() {
        return 0;
      },
    };
    return { store, events, deliveries };
  }

  test('fans out to matching durable consumers and retries a failing one alone', async () => {
    const { store, deliveries } = memoryStore();
    const bus = createEventBus({
      transport: createOutboxTransport({ store, log: quiet, maxAttempts: 2, backoffMs: () => 0 }),
    });
    const got: string[] = [];
    let failures = 0;
    bus.subscribe('helena.issue.*', (event) => void got.push(event.type), {
      id: 'ok',
      durable: true,
    });
    bus.subscribe(
      'helena.issue.created',
      () => {
        failures++;
        throw new Error('receiver down');
      },
      { id: 'flaky', durable: true },
    );
    bus.subscribe('helena.run.*', () => void got.push('never'), { id: 'other', durable: true });

    await bus.publish(createEvent({ type: 'helena.issue.created', data: {} }));
    const dispatcher = createOutboxDispatcher({
      store,
      subscriptions: () => bus.subscriptions(),
      log: quiet,
      maxAttempts: 2,
      backoffMs: () => 0,
    });
    const first = await dispatcher.tick();
    expect(first).toEqual({ fannedOut: 1, delivered: 1, retried: 1, failed: 0 });
    const second = await dispatcher.tick();
    expect(second).toEqual({ fannedOut: 0, delivered: 0, retried: 0, failed: 1 });
    expect(got).toEqual(['helena.issue.created']);
    expect(failures).toBe(2);
    expect(deliveries.find((d) => d.consumer === 'flaky')?.status).toBe('dead');
  });
});
