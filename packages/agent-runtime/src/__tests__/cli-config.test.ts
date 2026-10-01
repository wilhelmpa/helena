import { expect, test } from 'bun:test';
import { configForTask, parseArgs, taskFrom } from '../cli';

const raw = {
  model: 'volition-local-default',
  workdir: '/tmp',
  servers: [
    {
      provider: 'local',
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9999/v1',
      local: true,
    },
  ],
};
const options = parseArgs(['--stdin-json']);
const task = taskFrom(JSON.stringify({ prompt: 'Synthetic task', model: 'local/flash' }), options);

test('validates the resolved model of a claimed task before the unresolved agent default', () => {
  expect(configForTask(raw, task, 'run').model).toBe('local/flash');
  expect(configForTask({ ...raw, model: null }, task, 'chat').model).toBe('local/flash');
});

test('still validates the task model and the rest of the configuration', () => {
  expect(() => configForTask(raw, { ...task, model: 'unresolved' }, null)).toThrow('model must');
  expect(() => configForTask({ ...raw, workdir: 'relative' }, task, null)).toThrow('absolute');
  expect(() => configForTask(null, task, null)).toThrow('not an object');
});
