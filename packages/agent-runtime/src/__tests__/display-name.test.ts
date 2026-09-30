import { expect, test } from 'bun:test';
import { runAgent } from '../agent';
import { MemorySink } from '../events';
import { HelenaClient, type HelenaApi } from '../helena-client';
import { memoryTool } from '../tools/builtin';
import { factoryOf, scriptedModel } from './fake-model';

test('runner name reaches the model prompt, discovery and loop reminders', async () => {
  const model = scriptedModel([{ text: 'Ich werde das prüfen.' }, { text: 'Erledigt.' }]);
  const result = await runAgent({
    config: {
      displayName: 'Atlas',
      model: 'local/test',
      servers: [
        {
          provider: 'local',
          kind: 'openai-compatible',
          baseUrl: 'http://127.0.0.1:1/v1',
          local: true,
        },
      ],
      instructions: 'Du arbeitest in {appName}.',
      workdir: process.cwd(),
      policy: 'allow',
    },
    prompt: 'Bitte prüfe die Aufgabe.',
    sink: new MemorySink(),
    env: {},
    signal: new AbortController().signal,
    modelFactory: factoryOf({ 'local/test': model }),
    extraTools: [
      {
        name: 'get_project',
        description: '{appName} project lookup',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        kind: 'normal',
        execute: async () => ({ text: 'Done.' }),
      },
    ],
  });
  expect(result.status).toBe('success');
  expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain('Du arbeitest in Atlas.');
  expect(JSON.stringify(model.doStreamCalls[0])).not.toContain('{appName}');
  expect(memoryTool({} as HelenaApi, undefined, null, 'Atlas').description).toContain('in Atlas.');
});

test('client failures use the configured name and preserve error status', async () => {
  const client = new HelenaClient(
    'http://127.0.0.1:1',
    'fixture',
    { runId: null, messageId: null },
    (async () => new Response('', { status: 503 })) as unknown as typeof fetch,
    'Atlas',
  );
  await expect(client.memory()).rejects.toThrow('Atlas answered 503');
});
