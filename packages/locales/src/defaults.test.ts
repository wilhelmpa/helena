import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_STATES,
  PROJECT_PRESETS,
  PROJECT_PRESET_KEYS,
  allTasksSuffixes,
  blockedLabelNames,
  coordinatorName,
  defaultNames,
  defaultRoleName,
  defaultStateKey,
  defaultStates,
  defaultViewKey,
  defaultViewNames,
  findState,
  presetIssueTypes,
} from './defaults';
import { LOCALES, isLocale, toLocale } from './index';

type Tree = { [key: string]: string | Tree };

function keyPaths(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keyPaths(value, `${prefix}${key}.`),
  );
}

function values(tree: Tree): string[] {
  return Object.values(tree).flatMap((value) =>
    typeof value === 'string' ? [value] : values(value),
  );
}

const messages = join(import.meta.dir, '..', 'messages');

describe('default names catalog', () => {
  it('has a translation file for exactly the shipped languages', () => {
    expect(readdirSync(messages).sort()).toEqual([...LOCALES].sort());
  });

  it('gives every language every name English has, and nothing else', () => {
    const english = keyPaths(defaultNames('en') as unknown as Tree).sort();
    for (const locale of LOCALES) {
      const file = JSON.parse(
        readFileSync(join(messages, locale, 'defaults.json'), 'utf8'),
      ) as Tree;
      expect(keyPaths(file).sort()).toEqual(english);
      for (const text of values(file)) expect(text.trim().length).toBeGreaterThan(0);
      expect(file.coordinator).toContain('{key}');
      expect(coordinatorName('MKT', locale)).not.toMatch(/Hermes/i);
    }
  });

  it('keeps the English names older versions created', () => {
    expect(defaultStates('en').map((state) => state.name)).toEqual([
      'Backlog',
      'Todo',
      'In Progress',
      'Review',
      'Done',
      'Canceled',
    ]);
    expect(presetIssueTypes('general', 'en').map((type) => type.name)).toEqual(['Task']);
    expect(presetIssueTypes('software', 'en').map((type) => type.name)).toEqual([
      'Feature',
      'Bug',
      'Task',
      'Tech debt',
      'Research',
    ]);
    expect(defaultViewNames('kanban')[0]).toBe('Kanban');
    expect(defaultViewNames('list')[0]).toBe('List');
    expect(coordinatorName('MKT', 'en')).toBe('Coordinator MKT');
    expect(defaultRoleName('en')).toBe('Member');
    expect(blockedLabelNames()[0]).toBe('Blocked');
  });

  it('names a new project in German the way the web app speaks', () => {
    expect(defaultStates('de').map((state) => state.name)).toEqual([
      'Backlog',
      'Zu erledigen',
      'In Arbeit',
      'In Prüfung',
      'Erledigt',
      'Abgebrochen',
    ]);
    expect(presetIssueTypes('general', 'de')).toEqual([
      { key: 'task', name: 'Aufgabe', color: '#0ea5e9' },
    ]);
    expect(coordinatorName('VOL', 'de')).toBe('Koordinator VOL');
    expect(defaultRoleName('de')).toBe('Mitglied');
  });

  it('keeps state types and colors the same in every language', () => {
    for (const locale of LOCALES) {
      expect(
        defaultStates(locale).map(({ key, stateType, color }) => ({ key, stateType, color })),
      ).toEqual(DEFAULT_STATES.map(({ key, stateType, color }) => ({ key, stateType, color })));
    }
  });

  it('never gives two types of one preset the same name', () => {
    for (const locale of LOCALES) {
      for (const preset of PROJECT_PRESET_KEYS) {
        const names = presetIssueTypes(preset, locale).map((type) => type.name.toLowerCase());
        expect(new Set(names).size).toBe(PROJECT_PRESETS[preset].length);
      }
    }
  });

  it('never gives two states or two views the same name in one language', () => {
    for (const locale of LOCALES) {
      const states = defaultStates(locale).map((state) => state.name.toLowerCase());
      expect(new Set(states).size).toBe(states.length);
      const views = defaultNames(locale).views;
      expect(views.kanban.toLowerCase()).not.toBe(views.list.toLowerCase());
    }
  });

  it('recognizes a default state under its name in any language, each name one state', () => {
    for (const locale of LOCALES) {
      for (const state of defaultStates(locale)) {
        expect(defaultStateKey(state.name)).toBe(state.key);
        expect(defaultStateKey(` ${state.name.toUpperCase()} `)).toBe(state.key);
      }
    }
    expect(defaultStateKey('QA')).toBeNull();
  });

  it('recognizes a default view under its name in any language', () => {
    expect(defaultViewKey('Kanban')).toBe('kanban');
    expect(defaultViewKey('Board')).toBe('kanban');
    expect(defaultViewKey('liste')).toBe('list');
    expect(defaultViewKey('列表')).toBe('list');
    expect(defaultViewKey('Roadmap')).toBeNull();
    expect(allTasksSuffixes()).toContain('Alle Aufgaben');
  });

  it('falls back to the general preset for an unknown one', () => {
    expect(presetIssueTypes('nonsense', 'de')).toEqual(presetIssueTypes('general', 'de'));
    expect(presetIssueTypes(undefined, 'en')).toEqual(presetIssueTypes('general', 'en'));
  });
});

describe('findState', () => {
  const german = [
    { id: 1, name: 'Backlog' },
    { id: 2, name: 'Zu erledigen' },
    { id: 3, name: 'In Arbeit' },
    { id: 4, name: 'In Prüfung' },
    { id: 5, name: 'Erledigt' },
  ];

  it('finds a state by its own name, ignoring case and outer spaces', () => {
    expect(findState(german, ' in arbeit ')?.id).toBe(3);
  });

  it('finds a default state under its name in another language', () => {
    expect(findState(german, 'Review')?.id).toBe(4);
    expect(findState(german, 'Done')?.id).toBe(5);
    expect(findState(german, 'À faire')?.id).toBe(2);
  });

  it('prefers a state of exactly that name to a default state', () => {
    const states = [...german, { id: 9, name: 'Review' }];
    expect(findState(states, 'Review')?.id).toBe(9);
    expect(findState(states, 'In Prüfung')?.id).toBe(4);
  });

  it('does not find a state the project renamed under its old name', () => {
    const renamed = german.map((state) => (state.id === 4 ? { ...state, name: 'QA' } : state));
    expect(findState(renamed, 'Review')).toBeUndefined();
    expect(findState(renamed, 'QA')?.id).toBe(4);
  });
});

describe('locale helpers', () => {
  it('accepts only shipped languages', () => {
    expect(isLocale('de')).toBe(true);
    expect(isLocale('de-AT')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(toLocale('pt-BR')).toBe('pt-BR');
    expect(toLocale('xx')).toBe('en');
  });
});
