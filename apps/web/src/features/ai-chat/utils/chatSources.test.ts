import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlanUIMessage } from './chatMessages';
import { chatSources } from './chatSources';

describe('answer sources', () => {
  it('collects the tasks, vault files and pages an answer names or read', () => {
    const message = {
      id: '1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'read_file',
          toolCallId: 't1',
          state: 'output-available',
          input: { path: '/srv/volition/vault/Projects/WEB/Docs/Launch plan.md' },
          output: 'See WEB-4 as well.',
        },
        {
          type: 'text',
          text:
            'Done, see WEB-12 and WEB-12 again, UTF-8 is no task. The brief is in ' +
            'Home/Notes/brief.md; details at https://example.com/docs. and ' +
            '[the log](Projects/OPS/Files/Chat/2026-09-23/build.log).',
        },
      ],
    } as PlanUIMessage;

    assert.deepEqual(chatSources(message, ['WEB', 'OPS']), [
      { kind: 'file', path: 'Projects/WEB/Docs/Launch plan.md' },
      { kind: 'task', key: 'WEB', seq: 4 },
      { kind: 'task', key: 'WEB', seq: 12 },
      { kind: 'file', path: 'Home/Notes/brief.md' },
      { kind: 'file', path: 'Projects/OPS/Files/Chat/2026-09-23/build.log' },
      { kind: 'url', url: 'https://example.com/docs' },
    ]);
  });
});
