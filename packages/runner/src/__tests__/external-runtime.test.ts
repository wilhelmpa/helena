import { afterEach, describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunnerConfig } from '../config';
import { execute } from '../execute';
import { externalResult } from '../external-result';
import { ExternalRuntimeAdapter, projectScript } from '../external-runtime';
import type { RuntimePolicyClient } from '../policy';
import { executeWebhook, signWebhook } from '../webhook-runtime';

const dirs: string[] = [];
const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function config(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    name: '',
    url: 'http://plan.test',
    apiKey: 'test-key',
    args: [],
    env: {},
    concurrency: 1,
    pollIntervalMs: 1000,
    timeoutMs: 10_000,
    outputFormat: 'text',
    models: [],
    ...overrides,
  };
}

describe('command adapter', () => {
  it('runs a project script with structured input and records its answer and usage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'helena-command-'));
    dirs.push(root);
    await mkdir(join(root, 'scripts'));
    await writeFile(
      join(root, 'scripts', 'agent.sh'),
      '#!/bin/sh\ncat >input.json\nprintf \'{"output":"done","usage":{"inputTokens":2,"outputTokens":3},"spend":{"inputTokens":2,"outputTokens":3,"cacheReadTokens":0,"cacheWriteTokens":0,"reasoningTokens":0}}\'\n',
    );
    const script = await projectScript(root, 'scripts/agent.sh');
    const chunks: string[] = [];
    const outcome = await execute(
      config({ agent: 'command', cwd: root, args: [script] }),
      { prompt: 'work', systemPrompt: 'rules', env: {} },
      { onData: (chunk) => chunks.push(chunk) },
    );
    expect(outcome).toMatchObject({
      status: 'success',
      output: 'done',
      usage: { inputTokens: 2, outputTokens: 3 },
      spend: { runtime: 'command', inputTokens: 2, outputTokens: 3 },
    });
    expect(chunks).toEqual(['done']);
    expect(JSON.parse(await readFile(join(root, 'input.json'), 'utf8'))).toMatchObject({
      prompt: 'work',
      systemPrompt: 'rules',
    });
  });

  it('refuses traversal and symlinks outside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'helena-command-path-'));
    const other = await mkdtemp(join(tmpdir(), 'helena-command-other-'));
    dirs.push(root, other);
    await writeFile(join(other, 'agent.sh'), 'echo outside\n');
    await symlink(join(other, 'agent.sh'), join(root, 'escape.sh'));
    await expect(projectScript(root, '../agent.sh')).rejects.toThrow('relative path');
    await expect(projectScript(root, 'escape.sh')).rejects.toThrow('leaves the project workspace');
  });

  it('asks the Autopilot before starting a script', async () => {
    const root = await mkdtemp(join(tmpdir(), 'helena-command-policy-'));
    dirs.push(root);
    await writeFile(join(root, 'agent.sh'), 'echo approved\n');
    const calls: unknown[] = [];
    const client = {
      runtimePolicy: async () => ({
        revision: 'one',
        runtimePolicy: { files: [], commandScript: 'agent.sh' },
        skills: [],
      }),
      decideRuntime: async (question: unknown) => {
        calls.push(question);
        return { outcome: 'needs-approval', message: 'A person must approve this command' };
      },
    } as unknown as RuntimePolicyClient;
    const adapter = new ExternalRuntimeAdapter('command', config({ cwd: root }), client);
    await expect(adapter.runSettings({ runId: 14 })).rejects.toThrow('A person must approve');
    expect(calls).toMatchObject([{ runtime: 'command', tool: 'shell', runId: 14 }]);
  });

  it('stops a script when its run budget expires', async () => {
    const root = await mkdtemp(join(tmpdir(), 'helena-command-budget-'));
    dirs.push(root);
    await writeFile(join(root, 'agent.sh'), 'sleep 2\n');
    const outcome = await execute(
      config({ agent: 'command', cwd: root, args: [join(root, 'agent.sh')], timeoutMs: 5_000 }),
      { prompt: 'work', systemPrompt: '', env: {}, runBudgetSeconds: 0.05 },
    );
    expect(outcome).toMatchObject({ status: 'failed', error: 'Timed out after 50ms' });
  });
});

describe('webhook adapter', () => {
  it('signs the exact request and returns the service result', async () => {
    const seen: { url?: string; init?: unknown } = {};
    const send = (async (url: string, init: Record<string, unknown>) => {
      seen.url = url;
      seen.init = init;
      return Response.json({
        output: 'reviewed',
        usage: { inputTokens: 5, outputTokens: 2 },
        spend: {
          inputTokens: 5,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        },
      });
    }) as typeof import('@repo/net').pinnedFetch;
    const outcome = await executeWebhook(
      config({ agent: 'webhook' }),
      {
        prompt: 'check',
        systemPrompt: 'policy',
        env: {
          HELENA_WEBHOOK_URL: 'https://example.com/agent',
          HELENA_WEBHOOK_SECRET_ENV: 'AGENT_SIGNING_SECRET',
          AGENT_SIGNING_SECRET: secret,
          ITSAPLAN_RUN_ID: '42',
        },
        autopilotLevel: 1,
      },
      {},
      send,
    );
    expect(outcome).toMatchObject({
      status: 'success',
      output: 'reviewed',
      usage: { inputTokens: 5, outputTokens: 2 },
      spend: { runtime: 'webhook', inputTokens: 5 },
    });
    expect(seen.url).toBe('https://example.com/agent');
    const init = seen.init as { body: string; headers: Record<string, string> };
    const headers = init.headers;
    expect(headers['webhook-id']).toBe('msg_run_42');
    expect(JSON.parse(init.body).data).toMatchObject({ prompt: 'check', autopilotLevel: 1 });
    expect(init.body).not.toContain(secret);
    const expected = createHmac('sha256', Buffer.alloc(32, 7))
      .update(`${headers['webhook-id']}.${headers['webhook-timestamp']}.${init.body}`)
      .digest('base64');
    expect(headers['webhook-signature']).toBe(`v1,${expected}`);
  });

  it('rejects invalid secrets and negative token reports', () => {
    expect(() => signWebhook('msg_1', '1', '{}', 'plain')).toThrow('whsec_');
    expect(externalResult('{"output":"ok","spend":{"inputTokens":-1}}', 'webhook')).toMatchObject({
      status: 'failed',
    });
  });

  it('refuses an ungranted secret and an insecure target before delivery', async () => {
    let sends = 0;
    const send = (async () => {
      sends++;
      return new Response('unexpected');
    }) as typeof import('@repo/net').pinnedFetch;
    const base = {
      prompt: 'check',
      systemPrompt: '',
      env: {
        HELENA_WEBHOOK_URL: 'https://example.com/agent',
        HELENA_WEBHOOK_SECRET_ENV: 'AGENT_SIGNING_SECRET',
      },
    };
    expect((await executeWebhook(config(), base, {}, send)).status).toBe('failed');
    const insecure = {
      ...base,
      env: {
        ...base.env,
        HELENA_WEBHOOK_URL: 'http://127.0.0.1/agent',
        AGENT_SIGNING_SECRET: secret,
      },
    };
    expect((await executeWebhook(config(), insecure, {}, send)).status).toBe('failed');
    expect(sends).toBe(0);
  });
});
