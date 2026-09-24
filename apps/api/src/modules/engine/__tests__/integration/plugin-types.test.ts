import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { join } from 'node:path';
import { z } from 'zod';
import type { PolicyEvaluator, TriggerType, WorkflowStepType } from '@helena/sdk';
import { db, pipelineRun } from '@repo/db';
import { eq } from 'drizzle-orm';
import { discoverPlugins, loadExternalPlugins } from '@helena/sdk/server';
import { host, publishDomainEvent, registries } from '#shared/helena';
import { resetDb } from '#tests/helpers/db';
import {
  runSteps,
  startEngine,
  stopEngineRuns,
  stopTestEngine,
  waitForStatus,
} from '#tests/helpers/engine';
import {
  definition,
  enable,
  issue,
  setupProject,
  startRun,
  template,
  type Json,
  type ProjectSetup,
} from '#tests/helpers/workflows';

// A run takes a few hops through the engine's queues (see helpers/engine.ts).
setDefaultTimeout(30_000);

// A plugin's step and trigger types (@helena/sdk, registered through the framework's
// registries) in the engine: listed for the builder, checked against their schema, run
// with their output as variables, waiting for an event, failing, asked about by the
// policy host, and a trigger that starts a run on a plugin's event.

const PLUGIN = 'acme';

const sent: unknown[] = [];

const echo: WorkflowStepType<{ text: string }> = {
  id: 'acme.echo',
  label: { en: 'Echo', de: 'Echo' },
  category: 'report',
  configSchema: z.object({ text: z.string().min(1) }),
  defaults: () => ({ text: '{{task.title}}' }),
  outputs: ['text', 'words'],
  async execute({ config }) {
    return {
      status: 'completed',
      output: { text: config.text, words: config.text.split(/\s+/).length },
    };
  },
};

const waitForPing: WorkflowStepType<{ label: string }> = {
  id: 'acme.wait',
  label: 'Wait for a ping',
  category: 'read',
  configSchema: z.object({ label: z.string() }),
  outputs: ['got'],
  async execute() {
    return { status: 'waiting', signal: { kind: 'event', key: 'acme.pinged' } };
  },
  async resume(_ctx, signal) {
    return { status: 'completed', output: { got: String(signal.data?.value ?? '') } };
  },
};

const send: WorkflowStepType<{ to: string }> = {
  id: 'acme.send',
  label: 'Send',
  category: 'send',
  configSchema: z.object({ to: z.string() }),
  async execute({ config, run }) {
    sent.push({ to: config.to, run: run.id });
    return { status: 'completed', output: { sent: `to ${config.to}` } };
  },
};

const broken: WorkflowStepType<Record<string, never>> = {
  id: 'acme.broken',
  label: 'Broken',
  category: 'read',
  configSchema: z.object({}),
  async execute() {
    throw new Error('the far side is down');
  },
};

const onPing: TriggerType<{ minimum: number }> = {
  id: 'acme.on_ping',
  label: 'On a ping',
  configSchema: z.object({ minimum: z.number().int().default(0) }),
  events: ['acme.*'],
  match(config, event) {
    const data = event.data as { issueId?: number; value?: number };
    if ((data.value ?? 0) < config.minimum) return null;
    return { issueId: data.issueId ?? null, vars: { value: data.value } };
  },
};

// A policy of the test for the send step: ask a person, or refuse. The Autopilot abstains
// here (a person started the run).
let policy: 'approve' | 'deny' | 'off' = 'off';
const testPolicy: PolicyEvaluator = {
  id: 'acme-policy',
  evaluate(request) {
    if (policy === 'off' || request.context.stepType !== 'acme.send') return null;
    return policy === 'deny'
      ? { effect: 'deny', reason: 'Acme never sends' }
      : { effect: 'needs-approval', reason: 'Acme asks before sending' };
  },
};

beforeAll(async () => {
  for (const type of [echo, waitForPing, send, broken])
    registries.stepTypes.register(type as WorkflowStepType<unknown>, PLUGIN);
  registries.triggerTypes.register(onPing as TriggerType<unknown>, PLUGIN);
  registries.policies.register(testPolicy, PLUGIN);
  await startEngine();
});

beforeEach(async () => {
  policy = 'off';
  sent.length = 0;
  await resetDb();
});

afterEach(async () => {
  await stopEngineRuns();
});

afterAll(async () => {
  await stopTestEngine();
  for (const registry of [registries.stepTypes, registries.triggerTypes, registries.policies])
    registry.removePlugin(PLUGIN);
});

async function workflow(ctx: ProjectSetup, steps: Json[], extra: Json = {}) {
  const created = await template(ctx, { definition: definition(steps, extra) });
  expect((await enable(ctx, created.id, { coder: ctx.coder.id })).status).toBe(200);
  return created.id;
}

const step = (id: string, type: string, config: Json) => ({ id, name: `Step ${id}`, type, config });

describe('plugin step types', () => {
  it('lists them for the builder with their form', async () => {
    const ctx = await setupProject();
    const types = (await ctx.asOwner['workflow-engine'].types.get()).data!;
    const listed = types.steps.find((type) => type.type === 'acme.echo');
    expect(listed).toMatchObject({
      builder: true,
      category: 'report',
      plugin: {
        pluginId: PLUGIN,
        label: { en: 'Echo', de: 'Echo' },
        defaults: { text: '{{task.title}}' },
        outputs: ['text', 'words'],
      },
    });
    expect(listed?.plugin?.configSchema).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
    });
    expect(types.triggers.find((type) => type.type === 'acme.on_ping')).toMatchObject({
      events: ['acme.*'],
      plugin: { pluginId: PLUGIN, category: null },
    });
    // The built-in types stay as they are.
    expect(types.steps.find((type) => type.type === 'webhook')).toMatchObject({
      category: 'send',
      plugin: null,
    });
  });

  it('checks the configuration against the schema and the output variables', async () => {
    const ctx = await setupProject();
    const res = await ctx.asOwner.teams({ teamId: ctx.teamId }).pipelines.validate.post({
      definition: definition([
        step('first', 'acme.echo', { text: '' }),
        step('second', 'acme.echo', { text: '{{step.first.words}} {{step.first.nope}}' }),
      ]),
      template: true,
    } as never);
    const issues = (res.data?.issues ?? []) as Json[];
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'plugin_invalid', stepId: 'first', field: 'config.text' }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'unknown_variable',
        stepId: 'second',
        params: { variable: 'step.first.nope' },
      }),
    );
    expect(
      issues.filter((item) => item.params && (item.params as Json).variable === 'step.first.words'),
    ).toEqual([]);
  });

  it('runs a step and hands its output to the next one', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [
      step('first', 'acme.echo', { text: 'Ship {{task.title}}' }),
      step('second', 'acme.echo', { text: '{{step.first.words}} words: {{step.first.text}}' }),
    ]);
    const task = await issue(ctx);
    const run = await startRun(ctx, task.id, pipelineId);
    await waitForStatus(run.id, 'succeeded');
    const rows = await runSteps(run.id);
    expect(rows.map((row) => [row.stepId, row.kind, row.status, row.summary])).toEqual([
      ['first', 'acme.echo', 'succeeded', 'Ship Launch page'],
      ['second', 'acme.echo', 'succeeded', '3 words: Ship Launch page'],
    ]);
    expect(rows[0]!.state).toEqual({ output: { text: 'Ship Launch page', words: 3 } });
  });

  it('waits for an event, then resumes with its data', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [
      step('ping', 'acme.wait', { label: 'x' }),
      step('after', 'acme.echo', { text: 'got {{step.ping.got}}' }),
    ]);
    const task = await issue(ctx);
    const run = await startRun(ctx, task.id, pipelineId);
    await waitForStatus(run.id, 'waiting');
    const waiting = (await runSteps(run.id)).find((row) => row.stepId === 'ping');
    expect(waiting).toMatchObject({ status: 'waiting' });
    await publishDomainEvent({
      type: 'acme.pinged',
      projectId: ctx.projectId,
      data: { value: 42 },
    } as never);
    await waitForStatus(run.id, 'succeeded');
    expect((await runSteps(run.id)).map((row) => [row.stepId, row.summary])).toEqual([
      ['ping', '42'],
      ['after', 'got 42'],
    ]);
  });

  it('fails the run with what the step threw', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [step('call', 'acme.broken', {})]);
    const task = await issue(ctx);
    const run = await startRun(ctx, task.id, pipelineId);
    const failed = await waitForStatus(run.id, 'failed');
    expect(failed.error).toContain('the far side is down');
  });

  it('simulates a step that acts on the world in a test run', async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [step('out', 'acme.send', { to: 'crm' })]);
    const task = await issue(ctx);
    const run = await startRun(ctx, task.id, pipelineId, true);
    await waitForStatus(run.id, 'succeeded');
    expect(sent).toEqual([]);
    expect((await runSteps(run.id))[0]).toMatchObject({ status: 'simulated' });
  });
});

describe('the policy host decides steps', () => {
  it('opens an approval when a policy asks for one, and sends once a person approves', async () => {
    policy = 'approve';
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [step('out', 'acme.send', { to: 'crm' })]);
    const task = await issue(ctx);
    const run = await startRun(ctx, task.id, pipelineId);
    await waitForStatus(run.id, 'waiting');
    expect(sent).toEqual([]);
    const waiting = (await ctx.asOwner['pipeline-approvals'].get()).data!;
    expect(waiting).toContainEqual(
      expect.objectContaining({
        runId: run.id,
        stepId: 'out.approval',
        message: 'Acme asks before sending',
      }),
    );
    const decided = await ctx.asOwner['pipeline-runs']({ runId: run.id }).approval.post({
      approved: true,
    });
    expect(decided.status).toBe(200);
    await waitForStatus(run.id, 'succeeded');
    expect(sent).toEqual([{ to: 'crm', run: run.id }]);
  });

  it('ends the run as rejected when the person rejects, without sending', async () => {
    policy = 'approve';
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [step('out', 'acme.send', { to: 'crm' })]);
    const task = await issue(ctx);
    const run = await startRun(ctx, task.id, pipelineId);
    await waitForStatus(run.id, 'waiting');
    await ctx.asOwner['pipeline-runs']({ runId: run.id }).approval.post({ approved: false });
    await waitForStatus(run.id, 'rejected');
    expect(sent).toEqual([]);
    expect((await runSteps(run.id)).find((row) => row.stepId === 'out')).toMatchObject({
      status: 'skipped',
      outcome: 'rejected',
    });
  });

  it('fails the step a policy refuses', async () => {
    policy = 'deny';
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [step('out', 'acme.send', { to: 'crm' })]);
    const task = await issue(ctx);
    const run = await startRun(ctx, task.id, pipelineId);
    const failed = await waitForStatus(run.id, 'failed');
    expect(failed.error).toContain('Not allowed: Acme never sends');
    expect(sent).toEqual([]);
  });
});

describe('plugin trigger types', () => {
  it("starts a run on the task a plugin's event names, with its variables", async () => {
    const ctx = await setupProject();
    const pipelineId = await workflow(ctx, [step('say', 'acme.echo', { text: 'pinged' })], {
      trigger: { type: 'acme.on_ping', config: { minimum: 5 } },
    });
    const task = await issue(ctx);
    const ping = (value: number) =>
      publishDomainEvent({
        type: 'acme.pinged',
        projectId: ctx.projectId,
        data: { issueId: task.id, value },
      } as never);
    await ping(1);
    await ping(9);
    const deadline = Date.now() + 20_000;
    let runs: (typeof pipelineRun.$inferSelect)[] = [];
    while (runs.length === 0 && Date.now() < deadline) {
      runs = await db.select().from(pipelineRun).where(eq(pipelineRun.pipelineId, pipelineId));
      await Bun.sleep(100);
    }
    await Bun.sleep(500);
    runs = await db.select().from(pipelineRun).where(eq(pipelineRun.pipelineId, pipelineId));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: 'acme.on_ping', issueId: task.id });
    expect(runs[0]!.input).toEqual({ trigger: { value: 9 } });
    await waitForStatus(runs[0]!.id, 'succeeded');
  });
});

describe('the example plugin', () => {
  it('runs its workflow step with no change to the engine', async () => {
    const root = join(import.meta.dir, '../../../../../../../examples/plugins');
    const [found] = await discoverPlugins(root);
    expect(found?.manifest?.id).toBe('hello-helena');
    const [loaded] = await loadExternalPlugins(host, {
      root,
      entry: 'server',
      policy: {
        enabled: true,
        approved: [{ id: 'hello-helena', version: '0.1.0', digest: found!.digest! }],
      },
    });
    expect(loaded?.status).toBe('loaded');
    try {
      const ctx = await setupProject();
      const pipelineId = await workflow(ctx, [
        step('greet', 'hello-helena.greet', { name: '{{task.title}}', greeting: 'Servus' }),
      ]);
      const task = await issue(ctx);
      const run = await startRun(ctx, task.id, pipelineId);
      await waitForStatus(run.id, 'succeeded');
      expect((await runSteps(run.id))[0]).toMatchObject({
        kind: 'hello-helena.greet',
        status: 'succeeded',
        summary: 'Servus, Launch page!',
      });
    } finally {
      await host.unload('hello-helena');
    }
  });
});
