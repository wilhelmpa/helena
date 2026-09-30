import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NativeSkill } from '@/lib/api/endpoints/agentLearning';
import {
  groupByKind,
  inView,
  matchesQuery,
  readableName,
  shortDescription,
  skillEntries,
} from './skillEntries';

const learned = (patch: Partial<NativeSkill>): NativeSkill => ({
  path: 'git-worktree',
  name: 'git-worktree',
  markdown: '---\nname: git-worktree\ndescription: Wann verwenden: parallel arbeiten.\n---\n# x',
  files: [],
  otherFiles: 0,
  truncated: false,
  revision: 'r',
  ...patch,
});

const library = [
  {
    id: 1,
    teamId: 1,
    name: 'seo-audit',
    description: 'SEO-Audit einer Seite.',
    source: 'inline' as const,
    sourceUrl: null,
    files: [],
    createdAt: '',
  },
  {
    id: 2,
    teamId: 1,
    name: 'dsgvo-checkliste',
    description: '',
    source: 'inline' as const,
    sourceUrl: null,
    files: [],
    createdAt: '',
  },
];

describe('skill names and descriptions', () => {
  it('turns a load id into a readable name', () => {
    assert.equal(readableName('git-worktree-arbeiten'), 'Git worktree arbeiten');
    assert.equal(readableName('learned/backup_pruefen'), 'Backup pruefen');
  });

  it('keeps the first sentence and drops the "Wann verwenden" lead-in', () => {
    assert.equal(
      shortDescription(
        'Wann verwenden: der Build bricht ab. Danach folgen viele Sätze, die niemand lesen muss.',
      ),
      'der Build bricht ab.',
    );
    assert.equal(shortDescription(''), '');
  });
});

describe('skill views', () => {
  const entries = skillEntries({
    library,
    assignedIds: [1],
    inventory: [
      { name: 'seo-audit', category: null, description: 'x', origin: 'plan' },
      {
        name: 'github-auth',
        category: 'github',
        description: 'Use when the task involves GitHub.',
        origin: 'bundled',
      },
      { name: 'ascii-art', category: 'creative', description: 'Draw.', origin: 'bundled' },
      {
        name: 'wochenbericht',
        category: null,
        description: 'Wann verwenden: montags.',
        origin: 'agent',
        path: 'wochenbericht',
      },
      {
        name: 'git-worktree',
        category: null,
        description: 'x',
        origin: 'agent',
        path: 'git-worktree',
      },
    ],
    disabled: ['ascii-art'],
    native: [
      learned({}),
      learned({ path: 'neu', name: 'neu', proposed: true, archived: true }),
      learned({ path: 'alt', name: 'alt', archived: true }),
    ],
  });

  it('lists the library skill once, not again as the runtime copy of it', () => {
    assert.equal(entries.filter((entry) => entry.loadName === 'seo-audit').length, 1);
  });

  it('shows what is on in "assigned", and the whole library in "library"', () => {
    const assigned = inView(entries, 'assigned')
      .map((entry) => entry.loadName)
      .sort();
    assert.deepEqual(assigned, ['git-worktree', 'github-auth', 'seo-audit', 'wochenbericht']);
    assert.equal(inView(entries, 'library').length, 2);
  });

  it('keeps proposals and archived skills out of the assigned list', () => {
    assert.deepEqual(
      inView(entries, 'proposals').map((entry) => entry.loadName),
      ['neu'],
    );
    assert.deepEqual(
      inView(entries, 'archive').map((entry) => entry.loadName),
      ['alt'],
    );
  });

  it('takes a skill with history from the native list, not twice from the inventory', () => {
    assert.equal(entries.filter((entry) => entry.path === 'git-worktree').length, 1);
    assert.ok(entries.find((entry) => entry.path === 'git-worktree')?.learned);
  });

  it('searches title, id and description', () => {
    const entry = entries.find((item) => item.loadName === 'github-auth')!;
    assert.equal(matchesQuery(entry, 'github'), true);
    assert.equal(matchesQuery(entry, 'kochen'), false);
    assert.equal(matchesQuery(entry, ''), true);
  });

  it('groups by where a skill came from, learned first', () => {
    assert.deepEqual(
      groupByKind(inView(entries, 'assigned')).map(([kind]) => kind),
      ['learned', 'library', 'bundled'],
    );
  });
});
