import { expect, test } from 'bun:test';
import { directTools, runAgent } from '../agent';
import { MemorySink } from '../events';
import { MemorySessionStore } from '../session';
import { factoryOf, scriptedModel } from './fake-model';
import type { HelenaApi } from '../helena-client';
import type { AgentTool } from '../tools/types';

test('mail triage is offered directly to the assistant without tool discovery', () => {
  const triage: AgentTool = {
    name: 'run_mail_triage',
    description: 'Triage mail',
    kind: 'normal',
    readOnly: false,
    inputSchema: { type: 'object' },
    execute: async () => ({ text: 'Done.' }),
  };
  expect(directTools('assistent', [triage]).has(triage.name)).toBe(true);
  expect(directTools('voll', [triage]).has(triage.name)).toBe(true);
});

test('profile core remains offered when the native selector returns a subset', async () => {
  const model = scriptedModel([{ text: 'Done.' }]);
  const tools = ['get_issue', 'read_document', 'browser_click'].map((name): AgentTool => ({
    name,
    description: name,
    kind: name === 'browser_click' ? 'browser' : 'normal',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ text: 'Synthetic result' }),
  }));
  const helena = { selectTools: async () => ({ names: ['get_issue'] }) } as unknown as HelenaApi;
  const result = await runAgent({
    config: {
      model: 'test/model',
      servers: [{ provider: 'test', kind: 'openai-compatible', local: true }],
      kind: 'chat',
      workdir: '/tmp',
      policy: 'allow',
      memory: { enabled: false },
      tools: { profile: 'recherche' },
    },
    prompt: 'get_issue read_document browser_click',
    sessions: new MemorySessionStore(),
    sink: new MemorySink(),
    modelFactory: factoryOf({ 'test/model': model }),
    extraTools: tools,
    helena,
    env: {},
    signal: new AbortController().signal,
  });
  expect(result.status).toBe('success');
  const offered = model.doStreamCalls[0]!.tools!.map((tool) => tool.name);
  expect(offered).toContain('read_document');
  expect(offered).toContain('browser_click');
});
