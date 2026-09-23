import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlanUIMessage } from './chatMessages';
import { chatNoteMarkdown, chatNotePath } from './chatNote';

describe('chat as a note', () => {
  it('writes the questions and answers without reasoning and tools', () => {
    const messages = [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'Who owns the launch?' }] },
      {
        id: '2',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'Look it up.' },
          { type: 'dynamic-tool', toolName: 'x', toolCallId: 't', state: 'input-available', input: {} },
          { type: 'text', text: 'Maria does.' },
        ],
      },
    ] as PlanUIMessage[];
    const note = chatNoteMarkdown({
      title: 'Launch',
      agentName: () => 'Mia',
      messages,
      date: '23.09.2026',
      labels: {
        question: 'Frage',
        answer: (agent) => `Antwort von ${agent}`,
        source: (agent, date) => `Chat mit ${agent} vom ${date}`,
      },
    });
    assert.equal(
      note,
      '# Launch\n\n> Chat mit Mia vom 23.09.2026\n\n## Frage\n\nWho owns the launch?\n\n## Antwort von Mia\n\nMaria does.\n',
    );
  });

  it('names the note after the chat and the moment it was saved', () => {
    assert.equal(
      chatNotePath('Launch: plan / v2?', new Date('2026-09-23T14:05:00Z')),
      'Docs/Launch plan v2 2026-09-23 14-05.md',
    );
  });
});
