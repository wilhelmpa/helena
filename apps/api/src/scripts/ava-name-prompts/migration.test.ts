import { expect, test } from 'bun:test';
import { migrateAgentTexts } from './migration';

test('migrates explicit product phrases while preserving people and internal identifiers', () => {
  const input = {
    instructions:
      'Master-Agent von Helena. Helenas Werkzeuge. Helena prüft Orders. Frage Helena Müller. Daten von Helena Müller. @helena/sdk, Helena::Agent, Helena-Actor, Helena-Präfix.',
    heartbeatInstructions: 'Arbeite in Helena.',
    runtimePolicy: {
      files: [
        { path: 'SOUL.md', content: 'Ich bin Home, hier bei Helena.' },
        { path: 'AGENTS.md', content: "Helena's tools, Hermes runtime." },
        { path: 'USER.md', content: 'Helena ist meine Schwester.' },
      ],
      commandScript: 'echo Helena',
    },
  };
  const result = migrateAgentTexts(input);
  expect(result.value.instructions).toBe(
    'Master-Agent von {appName}. {appName}s Werkzeuge. {appName} prüft Orders. Frage Helena Müller. Daten von Helena Müller. @helena/sdk, Helena::Agent, Helena-Actor, Helena-Präfix.',
  );
  expect(result.value.heartbeatInstructions).toBe('Arbeite in {appName}.');
  expect(result.value.runtimePolicy).toEqual({
    files: [
      { path: 'SOUL.md', content: 'Ich bin Home, hier bei {appName}.' },
      { path: 'AGENTS.md', content: "{appName}'s tools, Hermes runtime." },
      { path: 'USER.md', content: 'Helena ist meine Schwester.' },
    ],
    commandScript: 'echo Helena',
  });
  expect(result.changes).toHaveLength(6);
  expect(migrateAgentTexts(result.value).changes).toEqual([]);
  expect(input.instructions).toContain('von Helena');
});

test('leaves ambiguous names and malformed policy files alone', () => {
  const input = {
    instructions:
      'Account von Helena. Master-Agent von Helena Müller. Helena und Hermes treffen sich.',
    heartbeatInstructions: '',
    runtimePolicy: { files: [null, { path: 'SOUL.md', content: 4 }] },
  };
  expect(migrateAgentTexts(input)).toEqual({ value: input, changes: [] });
});

test('recognizes the legacy Home identity without renaming a chosen person', () => {
  const input = {
    instructions: 'Du bist Helena, der Home-Agent.',
    heartbeatInstructions: '',
    runtimePolicy: {},
  };
  expect(migrateAgentTexts(input).value.instructions).toBe('Du bist {appName}, der Home-Agent.');
});
