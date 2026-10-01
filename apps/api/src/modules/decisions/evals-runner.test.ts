import { expect, test } from 'bun:test';
import type { DecisionConnection } from '../browser-task/connection';
import { evaluationConnection } from './evals-runner';

test('eval admission waits behind chats without changing the live decision connection', () => {
  const live = {
    credentialId: 169,
    teamId: 1,
    projectId: null,
    label: 'Local decision model',
    backend: { id: 'llm-json' },
    baseUrl: 'http://127.0.0.1:8731',
    model: 'local-test-model',
    allowPrivateAddress: true,
    keySource: 'local-ai',
    sourceCredentialId: null,
    modelServer: 'local',
    priority: 'realtime',
  } as DecisionConnection;
  const evalConnection = evaluationConnection(live);
  expect(evalConnection.priority).toBe('background');
  expect(evalConnection.mailBudget).toEqual({ queueMs: 60_000, generationMs: 60_000 });
  expect(live.mailBudget).toBeUndefined();
  expect(evalConnection.modelServer).toBe('local');
  expect(evalConnection.credentialId).toBe(169);
  expect(live.priority).toBe('realtime');
});
