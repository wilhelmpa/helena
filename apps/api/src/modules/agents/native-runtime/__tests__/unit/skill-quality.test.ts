import { expect, test } from 'bun:test';
import {
  oneOffSkillSource,
  similarSkill,
  skillQuality,
  validateNativeSkill,
} from '../../skill-quality';

const skill = {
  path: 'monthly-import',
  name: 'monthly-import',
  markdown: [
    '---',
    'name: monthly-import',
    'description: Use when importing a monthly CSV report',
    '---',
    '## Steps',
    '1. Inspect the delimiter and decimal format.',
    '2. Validate totals, then import.',
    '## Pitfalls',
    'Keep quoted delimiters inside fields.',
    '## Examples',
    'A semicolon report with 1,20 imports as 1.20.',
  ].join('\n'),
  files: [],
  otherFiles: 0,
  truncated: false,
};

test('requires a reusable multi-step procedure and a matching Agent Skills header', () => {
  expect(skillQuality(skill)).toEqual([]);
  expect(
    skillQuality({
      ...skill,
      markdown: skill.markdown.replace('2. Validate totals, then import.', ''),
    }),
  ).toContain('At least two concrete procedure steps required');
  expect(
    skillQuality({
      ...skill,
      markdown: skill.markdown.replace(
        'Use when importing a monthly CSV report',
        'Import this one report',
      ),
    }),
  ).toContain('Description must state a reusable trigger');
  expect(skillQuality({ ...skill, name: 'other' })).toContain(
    'Frontmatter name must match the lowercase skill name',
  );
});

test('refuses one-off source tasks, secrets and access paths', () => {
  expect(oneOffSkillSource('Read three current counters and sum them once.')).toBe(true);
  expect(oneOffSkillSource('Import the monthly CSV and validate totals.')).toBe(false);
  expect(() =>
    validateNativeSkill({
      ...skill,
      markdown: `${skill.markdown}\nRead /home/user/.ssh/id_ed25519`,
    }),
  ).toThrow();
  expect(() =>
    validateNativeSkill({ ...skill, markdown: `${skill.markdown}\npassword=synthetic-secret` }),
  ).toThrow();
});

test('compares a new skill against the same learned procedure', () => {
  expect(similarSkill(skill, { ...skill, path: 'duplicate' })).toBe(true);
});

test('permits warnings and examples about one-off inputs while refusing one-off procedures', () => {
  expect(
    skillQuality({
      ...skill,
      markdown: skill.markdown.replace(
        'Keep quoted delimiters inside fields.',
        'Do not store one-off markers or real data in the skill; it must stay reusable.',
      ),
    }),
  ).toEqual([]);
  for (const markdown of [
    skill.markdown.replace('a monthly CSV report', 'a one-off CSV report'),
    skill.markdown.replace(
      'Inspect the delimiter and decimal format.',
      'Read this one-time result.',
    ),
  ]) {
    expect(skillQuality({ ...skill, markdown })).toContain(
      'A one-time result is not a reusable procedure',
    );
  }
});

test('permits explicit reusable learning requests whose pitfalls warn against one-off results', () => {
  expect(
    oneOffSkillSource(
      '[Battle-169c] Lerne mit skill_manage einen wiederverwendbaren Skill namens volition-pipe-table-check für die Prüfung von Pipe-Tabellen. Steps: Kopfzeile prüfen, Spalten vergleichen, Datenzeilen zählen. Pitfalls: Do not turn this into a one-off marker response; prüfe immer die vom Nutzer gelieferte Tabelle.',
    ),
  ).toBe(false);
  expect(oneOffSkillSource('Create a reusable procedure to read and validate CSV files.')).toBe(
    false,
  );
  expect(oneOffSkillSource('Do not create a reusable skill. Read current counters.')).toBe(true);
  expect(
    oneOffSkillSource('Lerne keinen wiederverwendbaren Skill; lies den aktuellen Status.'),
  ).toBe(true);
});
