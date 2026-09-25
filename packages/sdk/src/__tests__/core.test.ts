import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  ACTION_CATEGORIES,
  ACTION_META_KEY,
  actionRank,
  annotationsForCategory,
  Registry,
  RegistryError,
  categoryFromAcpToolKind,
  categoryFromAnnotations,
  cliArgv,
  systemOneUrl,
  createEvent,
  createEventBus,
  createRegistry,
  decide,
  matchesEventPattern,
  resolveText,
  toCallToolResult,
  toJsonSchema,
  toMcpTool,
  toolCategory,
  validate,
  validateBundle,
  type AgentTool,
  type CliCommand,
  type PolicyEvaluator,
  type TemplateBundle,
} from '../index';

describe('Registry', () => {
  test('registers, lists in order and removes', () => {
    const registry = createRegistry<{ id: string; n: number }>('thing');
    const offA = registry.register({ id: 'a', n: 1 });
    registry.register({ id: 'b', n: 2 }, 'acme.plugin');
    expect(registry.ids()).toEqual(['a', 'b']);
    expect(registry.pluginOf('b')).toBe('acme.plugin');
    offA();
    expect(registry.has('a')).toBe(false);
    expect(registry.require('b').n).toBe(2);
    expect(() => registry.require('a')).toThrow(RegistryError);
  });

  test('refuses a duplicate id and names both plugins', () => {
    const registry = createRegistry<{ id: string }>('tool');
    registry.register({ id: 'x' }, 'one');
    expect(() => registry.register({ id: 'x' }, 'two')).toThrow(/one and two/);
  });

  test('refuses an invalid id', () => {
    const registry = createRegistry<{ id: string }>('tool');
    expect(() => registry.register({ id: ' bad' })).toThrow(/Invalid tool id/);
  });

  test('notifies subscribers and bumps its version', () => {
    const registry = new Registry<{ key: string }>('slot', (value) => value.key);
    let calls = 0;
    registry.subscribe(() => calls++);
    const before = registry.version();
    registry.register({ key: 'p' });
    registry.removePlugin('helena.core');
    expect(calls).toBe(2);
    expect(registry.version()).toBe(before + 2);
  });
});

describe('action categories', () => {
  test('come from MCP annotations, an unannotated tool counting as send (D-C1)', () => {
    expect(categoryFromAnnotations({ readOnlyHint: true })).toBe('read');
    expect(categoryFromAnnotations({ destructiveHint: true })).toBe('delete');
    expect(categoryFromAnnotations({ openWorldHint: false })).toBe('write');
    expect(categoryFromAnnotations({ openWorldHint: true })).toBe('send');
    expect(categoryFromAnnotations({})).toBe('send');
    expect(categoryFromAnnotations(undefined)).toBe('send');
  });

  test('are ranked in the one risk order', () => {
    expect([...ACTION_CATEGORIES]).toEqual([
      'read',
      'report',
      'write',
      'send',
      'publish',
      'execute',
      'delete',
      'pay',
      'credentials',
    ]);
    expect(actionRank('report')).toBeLessThan(actionRank('write'));
    expect(actionRank('pay')).toBeLessThan(actionRank('credentials'));
  });

  test('round-trip through the annotations for the categories they can express', () => {
    for (const category of ['read', 'write', 'send', 'delete'] as const) {
      expect(categoryFromAnnotations(annotationsForCategory(category))).toBe(category);
    }
  });

  test('come from ACP tool kinds', () => {
    expect(categoryFromAcpToolKind('search')).toBe('read');
    expect(categoryFromAcpToolKind('edit')).toBe('write');
    expect(categoryFromAcpToolKind('delete')).toBe('delete');
    expect(categoryFromAcpToolKind('execute')).toBe('execute');
    expect(categoryFromAcpToolKind('something-new')).toBe('execute');
  });
});

describe('agent tools', () => {
  const greet: AgentTool<{ name: string }, { text: string }> = {
    name: 'greet',
    description: 'Greets someone.',
    inputSchema: z.object({ name: z.string().min(1) }),
    category: 'send',
    handler: async ({ name }) => ({ text: `Hello ${name}` }),
  };

  test('become MCP tools with a JSON Schema and their category', () => {
    const tool = toMcpTool(greet as AgentTool<unknown>);
    expect(tool.inputSchema.type).toBe('object');
    expect(tool.inputSchema.required).toEqual(['name']);
    expect(tool._meta?.[ACTION_META_KEY]).toBe('send');
    expect(tool.annotations?.openWorldHint).toBe(true);
  });

  test('classify per call when the effect depends on the input', () => {
    const click: AgentTool<{ pay?: boolean }> = {
      name: 'click',
      description: 'Clicks.',
      inputSchema: { type: 'object', properties: {} },
      category: 'pay',
      classify: (input) => (input.pay ? 'pay' : 'execute'),
      handler: async () => 'ok',
    };
    expect(toolCategory(click, { pay: true })).toBe('pay');
    expect(toolCategory(click, {})).toBe('execute');
  });

  test('wrap plain return values as MCP results', () => {
    expect(toCallToolResult({ a: 1 })).toEqual({
      content: [{ type: 'text', text: '{"a":1}' }],
      structuredContent: { a: 1 },
    });
    expect(toCallToolResult('hi').content[0]).toEqual({ type: 'text', text: 'hi' });
  });

  test('validate input through Standard Schema', async () => {
    await expect(validate(greet.inputSchema, { name: 'Ada' })).resolves.toEqual({ name: 'Ada' });
    await expect(validate(greet.inputSchema, { name: '' })).rejects.toThrow(/name/);
  });

  test('pass a plain JSON Schema through', () => {
    const schema = { type: 'object', properties: { q: { type: 'string' } } };
    expect(toJsonSchema(schema)).toBe(schema);
  });
});

describe('policy', () => {
  const request = {
    agent: { id: 1 },
    project: { id: 2 },
    action: 'send' as const,
    context: {},
  };

  test('allows when every evaluator abstains', async () => {
    expect((await decide([], request)).effect).toBe('allow');
  });

  test('the strictest decision wins', async () => {
    const evaluators: PolicyEvaluator[] = [
      { id: 'lenient', evaluate: () => ({ effect: 'allow', reason: 'fine' }) },
      {
        id: 'careful',
        evaluate: () => ({ effect: 'needs-approval', reason: 'mail leaves Helena' }),
      },
      { id: 'quiet', evaluate: () => null },
    ];
    expect(await decide(evaluators, request)).toEqual({
      effect: 'needs-approval',
      reason: 'mail leaves Helena',
      evaluator: 'careful',
    });
  });

  test('a failing evaluator denies', async () => {
    const decision = await decide(
      [
        {
          id: 'broken',
          evaluate: () => {
            throw new Error('boom');
          },
        },
      ],
      request,
    );
    expect(decision.effect).toBe('deny');
  });
});

describe('events', () => {
  test('are CloudEvents 1.0 with Helena extensions', () => {
    const event = createEvent({
      type: 'helena.issue.created',
      data: { issueId: 5, identifier: 'VOL-5', projectId: 2, title: 'T', parentId: null },
      subject: 'issues/5',
      teamId: 1,
      projectId: 2,
      actor: 'user:abc',
    });
    expect(event.specversion).toBe('1.0');
    expect(event.source).toBe('/teams/1/projects/2');
    expect(event.datacontenttype).toBe('application/json');
    expect(event.helenaproject).toBe(2);
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    // CloudEvents attribute names: lowercase letters and digits only.
    for (const key of Object.keys(event)) expect(key).toMatch(/^[a-z0-9]+$/);
  });

  test('patterns match prefixes and wildcards', () => {
    expect(matchesEventPattern('helena.issue.*', 'helena.issue.created')).toBe(true);
    expect(matchesEventPattern('helena.issue.*', 'helena.run.started')).toBe(false);
    expect(matchesEventPattern('*', 'anything')).toBe(true);
  });

  test('without a transport every subscriber runs in process', async () => {
    const seen: string[] = [];
    const bus = createEventBus();
    bus.subscribe('helena.run.*', (event) => void seen.push(`live:${event.type}`));
    bus.subscribe('helena.run.*', (event) => void seen.push(`durable:${event.type}`), {
      id: 'd',
      durable: true,
    });
    await bus.publish(createEvent({ type: 'helena.run.started', data: {} }));
    expect(seen).toEqual(['live:helena.run.started', 'durable:helena.run.started']);
  });

  test('with a transport, durable subscribers are left to it', async () => {
    const stored: Array<{ type: string; tx: unknown }> = [];
    const seen: string[] = [];
    const bus = createEventBus({
      transport: {
        append: async (events, tx) =>
          void stored.push(...events.map((e) => ({ type: e.type, tx }))),
        start: async () => ({ stop: async () => {} }),
      },
    });
    bus.subscribe('helena.run.*', (event) => void seen.push(`live:${event.type}`));
    bus.subscribe('helena.run.*', (event) => void seen.push(`durable:${event.type}`), {
      id: 'd',
      durable: true,
    });
    await bus.publish(createEvent({ type: 'helena.run.started', data: {} }), { tx: 'tx-1' });
    expect(stored).toEqual([{ type: 'helena.run.started', tx: 'tx-1' }]);
    expect(seen).toEqual(['live:helena.run.started']);
  });
});

describe('runtimes', () => {
  test('a CLI adapter builds its argv like the runner presets', () => {
    const command: CliCommand = {
      bin: 'x',
      outputFormat: 'text',
      promptVia: 'arg',
      head: (session) => (session ? ['--resume', session] : []),
      taskArgs: ({ model }) => (model ? ['--model', model] : []),
      tail: ['-p'],
    };
    expect(cliArgv(command, 's1', 'SYS', ['--x'], 'do it', { model: 'm' })).toEqual([
      '--resume',
      's1',
      '--x',
      '--model',
      'm',
      '-p',
      'SYS\n\ndo it',
    ]);
  });
});

describe('text and bundles', () => {
  test('resolves localized text with fallbacks', () => {
    expect(resolveText({ en: 'Hello', de: 'Hallo' }, 'de-AT')).toBe('Hallo');
    expect(resolveText({ en: 'Hello', de: 'Hallo' }, 'fr')).toBe('Hello');
    expect(resolveText({ i18n: 'nav.chat' }, 'de', (key) => `t(${key})`)).toBe('t(nav.chat)');
    expect(resolveText('Plain', 'de')).toBe('Plain');
  });

  test('validates a template bundle', () => {
    const bundle: TemplateBundle = {
      format: 'helena.template-bundle',
      formatVersion: 1,
      name: 'demo-pack',
      displayName: 'Demo',
      version: '1.0.0',
      description: 'A demo.',
      license: 'MIT',
      author: { name: 'Acme' },
      skills: [],
      mcpServers: {},
      agents: [],
    };
    expect(validateBundle(bundle)).toEqual([]);
    expect(validateBundle({ ...bundle, license: 'SSPL-1.0' })).toEqual(['license SSPL-1.0']);
  });
});

describe('systemOneUrl', () => {
  test('joins the base and the path once, whether or not the base carries the version', () => {
    expect(systemOneUrl('https://api.typesafe.ai/')).toBe('https://api.typesafe.ai/v1/systemone');
    expect(systemOneUrl('http://127.0.0.1:13305/api/v1', '/v1/chat/completions')).toBe(
      'http://127.0.0.1:13305/api/v1/chat/completions',
    );
    expect(systemOneUrl('http://127.0.0.1:8791', '/v1/models')).toBe(
      'http://127.0.0.1:8791/v1/models',
    );
    expect(systemOneUrl('https://ai-gateway.vercel.sh/typesafe')).toBe(
      'https://ai-gateway.vercel.sh/typesafe/v1/systemone',
    );
  });
});
