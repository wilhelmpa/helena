import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  createEvent,
  toCallToolResult,
  toMcpTool,
  type AnyAgentTool,
  type HelenaEvent,
  type WorkflowStepType,
} from '../index';
import { PluginHost, discoverPlugins, loadExternalPlugins } from '../server';

// The example plugin (examples/plugins/hello-helena) loads into a host with no change to
// Helena: a connector with a tool, a tool of its own, a workflow step type, a panel UI
// slot and an event subscription, all checked against its manifest.

const ROOT = join(import.meta.dir, '../../../../examples/plugins');

async function loadExample() {
  const [found] = await discoverPlugins(ROOT);
  expect(found?.manifest?.id).toBe('hello-helena');
  const host = new PluginHost({
    process: 'test',
    logger: () => ({ info() {}, warn() {}, error() {} }),
  });
  const [loaded] = await loadExternalPlugins(host, {
    root: ROOT,
    entry: 'server',
    policy: {
      enabled: true,
      approved: [{ id: 'hello-helena', version: '0.1.0', digest: found!.digest! }],
    },
  });
  return { host, loaded };
}

describe('the example plugin hello-helena', () => {
  test('registers everything it declares', async () => {
    const { host, loaded } = await loadExample();
    expect(loaded?.status).toBe('loaded');
    expect(host.connectors.pluginOf('hello-greeter')).toBe('hello-helena');
    expect(host.tools.get('hello_greet')?.connector).toBe('hello-greeter');
    expect(host.tools.pluginOf('hello_time')).toBe('hello-helena');
    expect(host.stepTypes.has('hello-helena.greet')).toBe(true);
    expect(host.uiSlots.get('panel-tool:hello')).toMatchObject({
      render: { kind: 'frame', src: 'panel.html' },
    });
  });

  test('its tools run as MCP tools, the connector tool with its credential', async () => {
    const { host } = await loadExample();
    const log = { info() {}, warn() {}, error() {} };
    const greet = host.tools.get('hello_greet') as AnyAgentTool;
    const result = toCallToolResult(
      await greet.handler(
        { name: 'Ada' },
        { agent: null, project: null, credential: { greeting: 'Servus' }, log },
      ),
    );
    expect(result.structuredContent).toEqual({ text: 'Servus, Ada!' });
    const time = host.tools.get('hello_time') as AnyAgentTool;
    expect(toMcpTool(time)._meta).toEqual({ 'helena/action': 'read' });
    const now = (await time.handler(
      { timeZone: 'Europe/Berlin' },
      { agent: null, project: null, log },
    )) as {
      timeZone: string;
    };
    expect(now.timeZone).toBe('Europe/Berlin');
  });

  test('its workflow step validates and runs', async () => {
    const { host } = await loadExample();
    const step = host.stepTypes.get('hello-helena.greet') as WorkflowStepType<{
      name: string;
      greeting: string;
    }>;
    expect(
      await step.validate!({ name: ' ', greeting: 'Hi' }, { project: null, previousSteps: [] }),
    ).toEqual([{ code: 'missing_name', field: 'name' }]);
    const outcome = await step.execute({
      config: { name: 'VOL-1', greeting: 'Hi' },
      run: { id: 1, workflowId: 1, project: null },
      step: { id: 's1', name: 'Greet' },
      input: {},
      attempt: 1,
      signal: new AbortController().signal,
      log: { info() {}, warn() {}, error() {} },
    });
    expect(outcome).toEqual({ status: 'completed', output: { text: 'Hi, VOL-1!' } });
  });

  test('it hears new tasks and publishes its own event', async () => {
    const { host } = await loadExample();
    const heard: HelenaEvent[] = [];
    host.events.subscribe('hello-helena.*', (event) => void heard.push(event), { id: 'test' });
    await host.events.publish(
      createEvent({
        type: 'helena.issue.created',
        projectId: 3,
        subject: 'issues/7',
        data: { issueId: 7, identifier: 'VOL-7', projectId: 3, title: 'Plan', parentId: null },
      }),
    );
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({
      type: 'hello-helena.greeted',
      helenaactor: 'plugin:hello-helena',
      data: { task: 'VOL-7', text: 'Hello, Plan!' },
    });
  });
});
