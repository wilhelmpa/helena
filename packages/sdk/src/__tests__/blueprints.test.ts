import { describe, expect, test } from 'bun:test';
import {
  blueprintCopyHandle,
  isBlueprintFilePath,
  parseBlueprintJson,
  validateBlueprint,
  type ProjectBlueprint,
} from '../blueprints';

function minimal(overrides: Partial<ProjectBlueprint> = {}): ProjectBlueprint {
  return {
    format: 'helena.project-blueprint',
    formatVersion: 1,
    name: 'demo',
    displayName: 'Demo',
    version: '1.0.0',
    description: 'A demo project.',
    license: 'AGPL-3.0-only',
    author: { name: 'Helena' },
    project: { key: 'DEMO', name: 'Demo', description: '', instructions: 'Arbeite sorgfältig.' },
    areas: [{ name: 'Allgemein', folder: 'allgemein' }],
    agents: [{ template: 'researcher', assignment: 'Recherche für DEMO.' }],
    knowledge: { project: [{ path: 'Docs/Start.md', content: '# Start' }], templates: [] },
    boards: [],
    goals: [{ title: 'Ein Ziel', description: '', status: 'active' }],
    routines: [
      {
        key: 'weekly',
        title: 'Wöchentlich',
        agent: 'researcher',
        instructions: 'Wochenbericht.',
        cron: '0 9 * * 1',
        timezone: 'Europe/Berlin',
      },
    ],
    ...overrides,
  };
}

describe('project blueprints', () => {
  test('accepts a minimal blueprint', () => {
    expect(validateBlueprint(minimal())).toEqual([]);
    expect(parseBlueprintJson(JSON.stringify(minimal())).project.key).toBe('DEMO');
  });

  test('refuses what could not be applied or would reach outside its folders', () => {
    const problems = validateBlueprint(
      minimal({
        project: { key: 'demo', name: '', description: '', instructions: 'x'.repeat(4001) },
        areas: [
          { name: 'Dateien', folder: 'files' },
          { name: 'Zwei', folder: 'files' },
        ],
        agents: [
          { template: 'researcher', assignment: 'x'.repeat(501) },
          { template: 'researcher', assignment: 'doppelt' },
        ],
        knowledge: {
          project: [{ path: '../Home/escape.md', content: 'x' }],
          templates: [{ path: '.obsidian/x.md', content: 'x' }],
        },
        boards: [
          {
            name: 'Board',
            stickers: [{ id: 'a', title: 'A', body: '', x: 0, y: 0 }],
            edges: [{ from: 'a', to: 'b' }],
          },
        ],
        goals: [{ title: 'Z', description: '', status: 'done' as 'active' }],
        routines: [
          {
            key: 'Bad Key',
            title: 'R',
            agent: 'nobody',
            instructions: 'x',
            cron: '* *',
            timezone: '',
          },
        ],
      }),
    );
    for (const expected of [
      'project.key is not a project key',
      'project.name is empty',
      'project.instructions exceed 4000 characters',
      'area Dateien: folder files is reserved',
      'area Zwei: folder listed twice',
      'agent researcher: assignment exceeds 500 characters',
      'agent researcher: listed twice',
      'knowledge ../Home/escape.md: not a plain .md path',
      'template .obsidian/x.md: not a plain .md path',
      'board Board: an arrow a → b has no sticker',
      'goal "Z": status done',
      'routine Bad Key: key is not kebab-case',
      'routine Bad Key: cron is not five fields',
      'routine Bad Key: no time zone',
      'routine Bad Key: agent nobody is not one of the blueprint\'s agents',
    ]) {
      expect(problems).toContain(expected);
    }
  });

  test('file paths stay plain and relative', () => {
    expect(isBlueprintFilePath('Docs/Märkte/Watchlist.md')).toBe(true);
    expect(isBlueprintFilePath('/Docs/a.md')).toBe(false);
    expect(isBlueprintFilePath('Docs/a.canvas')).toBe(false);
    expect(isBlueprintFilePath('Docs//a.md')).toBe(false);
  });

  test("a copy's handle is the template's with the project key", () => {
    expect(blueprintCopyHandle('paper-trader', 'TRADE')).toBe('paper-trader-trade');
    expect(blueprintCopyHandle('x'.repeat(64), 'TRADE')).toHaveLength(64);
  });
});
