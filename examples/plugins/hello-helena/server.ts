// Hello Helena: the example plugin of docs/helena-framework.md. It adds, without any
// change to Helena itself:
//
//   - a connector ("Hello Greeter") whose credential is a greeting, and a tool that
//     runs with it (hello_greet, category `send`);
//   - a tool of its own (hello_time, `read`), which Helena's MCP endpoint serves to every
//     agent;
//   - a workflow step type (hello-helena.greet, `report`);
//   - a panel tool (a page of ui/, shown in a sandboxed frame);
//   - an event subscription (every new task) and an event of its own.
//
// It imports nothing from Helena at runtime: types come from '@helena/sdk', and zod, the
// event bus and a logger come in the context. Helena loads it from HELENA_PLUGINS_DIR once
// the Administrator switched external plugins on and approved this version.

import type {
  AgentTool,
  Connector,
  HelenaPlugin,
  PanelToolSlot,
  PluginContext,
  WorkflowStepType,
} from '@helena/sdk';

function greeterConnector(ctx: PluginContext): Connector {
  const greet: AgentTool<{ name: string }> = {
    name: 'hello_greet',
    title: 'Greet someone',
    description: 'Greets a person by name with the greeting stored in the Hello Greeter account.',
    inputSchema: ctx.z.object({ name: ctx.z.string().min(1).describe('Who to greet') }),
    // It "sends" a message to a person, as far as the policy is concerned.
    category: 'send',
    async handler({ name }, call) {
      const greeting = String(call.credential?.greeting ?? 'Hello');
      return { text: `${greeting}, ${name}!` };
    },
  };
  return {
    id: 'hello-greeter',
    label: { en: 'Hello Greeter', de: 'Hallo-Grüßer' },
    icon: 'hand',
    credentialSchema: [
      { key: 'greeting', label: 'Greeting', type: 'string', required: true, placeholder: 'Hello' },
    ],
    auth: { kind: 'fields' },
    services: [{ id: 'greetings', label: 'Greetings', actions: ['send'] }],
    async health(credential) {
      return credential.greeting
        ? { status: 'ok' }
        : { status: 'error', message: 'No greeting stored' };
    },
    tools: [greet as AgentTool<unknown>],
  };
}

function timeTool(ctx: PluginContext): AgentTool<{ timeZone?: string }> {
  return {
    name: 'hello_time',
    title: 'Current time',
    description: 'The current date and time, in a time zone (default UTC).',
    inputSchema: ctx.z.object({
      timeZone: ctx.z.string().optional().describe('An IANA time zone, e.g. Europe/Berlin'),
    }),
    category: 'read',
    async handler({ timeZone }, call) {
      const zone = timeZone ?? 'UTC';
      const now = new Date().toLocaleString('en-GB', { timeZone: zone });
      call.log.info('time asked', { zone, agent: call.agent?.id ?? null });
      return { timeZone: zone, now };
    },
  };
}

function greetStep(ctx: PluginContext): WorkflowStepType<{ name: string; greeting: string }> {
  return {
    id: 'hello-helena.greet',
    label: { en: 'Greet', de: 'Grüßen' },
    description: { en: 'Writes a greeting into the run.', de: 'Schreibt einen Gruß in den Lauf.' },
    icon: 'hand',
    category: 'report',
    configSchema: ctx.z.object({
      name: ctx.z.string().min(1),
      greeting: ctx.z.string().default('Hello'),
    }),
    defaults: () => ({ name: '{{task.title}}', greeting: 'Hello' }),
    outputs: ['text'],
    validate(config) {
      return config.name.trim() ? [] : [{ code: 'missing_name', field: 'name' }];
    },
    async execute({ config }) {
      return { status: 'completed', output: { text: `${config.greeting}, ${config.name}!` } };
    },
  };
}

const panel: PanelToolSlot = {
  slot: 'panel-tool',
  id: 'hello',
  label: { en: 'Hello', de: 'Hallo' },
  icon: 'hand',
  order: 90,
  inHeader: true,
  render: { kind: 'frame', src: 'panel.html' },
};

const plugin: HelenaPlugin = {
  register(ctx) {
    ctx.connectors.register(greeterConnector(ctx));
    ctx.tools.register(timeTool(ctx) as AgentTool<unknown>);
    ctx.stepTypes.register(greetStep(ctx) as WorkflowStepType<unknown>);
    ctx.uiSlots.register(panel);
    // Durable: with the workflow engine's transport it runs in the worker, with retries.
    ctx.events.subscribe(
      'helena.issue.created',
      async (event) => {
        const data = event.data as { identifier?: string; title?: string };
        ctx.log.info('a task was created', { task: data.identifier ?? null });
        await ctx.events.publish({
          type: 'hello-helena.greeted',
          projectId: event.helenaproject ?? null,
          subject: event.subject,
          data: { task: data.identifier ?? null, text: `Hello, ${data.title ?? 'task'}!` },
        });
      },
      { id: 'greet-new-tasks' },
    );
  },
};

export default plugin;
