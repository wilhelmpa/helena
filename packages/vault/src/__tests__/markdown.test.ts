import { describe, expect, it } from 'bun:test';
import {
  composeNote,
  extractLinks,
  frontmatterTags,
  noteTitle,
  splitNote,
  TASK_IDENTIFIER,
} from '../markdown';
import {
  isIgnoredPath,
  isSyncConflict,
  locateVaultPath,
  normalizeVaultPath,
  syncConflictOriginal,
} from '../paths';

describe('frontmatter', () => {
  it('splits the frontmatter from the body and parses it', () => {
    const note = splitNote('---\ntype: spec\ntags: [a, b]\n---\n# Title\n');
    expect(note).toEqual({
      frontmatterRaw: 'type: spec\ntags: [a, b]',
      frontmatter: { type: 'spec', tags: ['a', 'b'] },
      body: '# Title\n',
    });
    expect(splitNote('---\n---\nBody').frontmatter).toEqual({});
    expect(splitNote('No frontmatter\n---\n')).toMatchObject({ frontmatterRaw: null });
  });

  it('reads invalid YAML as no properties and keeps the block', () => {
    const note = splitNote('---\ntags: [unclosed\n---\nBody');
    expect(note.frontmatter).toEqual({});
    expect(note.frontmatterRaw).toBe('tags: [unclosed');
  });

  it('writes an unchanged frontmatter back verbatim and edits a changed one in place', () => {
    const raw = '# comment\ntype: spec\ntags: [a, b]';
    expect(composeNote({ type: 'spec', tags: ['a', 'b'] }, 'Body', raw)).toBe(
      `---\n${raw}\n---\nBody`,
    );
    const changed = composeNote({ type: 'decision', tags: ['a', 'b'] }, 'Body', raw);
    expect(changed).toContain('# comment');
    expect(changed).toContain('type: decision');
    expect(changed).toContain('tags: [a, b]');
    expect(composeNote({}, 'Body', raw)).toBe('Body');
    expect(composeNote({ tags: ['x'] }, 'Body', null)).toBe('---\ntags:\n  - x\n---\nBody');
  });

  it('names a note by its title property or its file name', () => {
    expect(noteTitle({ title: ' Plan ' }, 'Projects/VOL/Docs/a.md')).toBe('Plan');
    expect(noteTitle({}, 'Projects/VOL/Docs/Meeting notes.md')).toBe('Meeting notes');
  });

  it('reads tags as a list or a string', () => {
    expect(frontmatterTags({ tags: ['#a', 'b'] })).toEqual(['a', 'b']);
    expect(frontmatterTags({ tags: 'a, b c' })).toEqual(['a', 'b', 'c']);
    expect(frontmatterTags({})).toEqual([]);
  });
});

describe('links', () => {
  it('finds wikilinks, task links, relative Markdown links and URLs', () => {
    const content = [
      '---',
      'related: "[[Roadmap]]"',
      '---',
      'See [[Specs/API|the API]], [[Notes#Heading]] and ![[diagram.png]].',
      'Task [[VOL-12]] and [[2026-09-23]].',
      'A [relative link](../Other%20Note.md) and [external](https://example.com/a).',
      'Plain https://plan.local/x.',
      '```',
      '[[InCode]]',
      '```',
      'and `[[Inline]]`',
    ].join('\n');
    expect(extractLinks(content, 'Projects/VOL/Docs/Sub/Note.md')).toEqual([
      { kind: 'note', target: 'Roadmap' },
      { kind: 'note', target: 'Specs/API' },
      { kind: 'note', target: 'Notes' },
      { kind: 'note', target: 'diagram.png' },
      { kind: 'task', target: 'VOL-12' },
      { kind: 'note', target: '2026-09-23' },
      { kind: 'note', target: 'Projects/VOL/Docs/Other Note' },
      { kind: 'url', target: 'https://example.com/a' },
      { kind: 'url', target: 'https://plan.local/x' },
    ]);
  });

  it('recognises task identifiers by a key that starts with a letter', () => {
    expect(TASK_IDENTIFIER.test('VOL-12')).toBe(true);
    expect(TASK_IDENTIFIER.test('MY-PROJ-3')).toBe(true);
    expect(TASK_IDENTIFIER.test('2026-09')).toBe(false);
    expect(TASK_IDENTIFIER.test('vol-12')).toBe(false);
    expect(TASK_IDENTIFIER.test('VOL-1234567890')).toBe(false);
  });
});

describe('paths', () => {
  it('normalizes a vault path and refuses traversal', () => {
    expect(normalizeVaultPath('/Projects/VOL/Docs/')).toBe('Projects/VOL/Docs');
    expect(normalizeVaultPath('')).toBe('');
    expect(() => normalizeVaultPath('Projects/../etc')).toThrow();
    expect(() => normalizeVaultPath('a//b')).toThrow();
    expect(() => normalizeVaultPath('a/ b')).toThrow();
    expect(() => normalizeVaultPath('a\\b')).toThrow();
  });

  it('locates a path in the layout', () => {
    expect(locateVaultPath('Projects/VOL/Docs/a.md')).toEqual({
      scope: 'project',
      projectKey: 'VOL',
    });
    expect(locateVaultPath('Private/x.md').scope).toBe('private');
    expect(locateVaultPath('Home/Docs').scope).toBe('home');
    expect(locateVaultPath('Templates/t.md').scope).toBe('templates');
    expect(locateVaultPath('README.md').scope).toBe('root');
  });

  it('recognises a Syncthing conflict copy and the file it belongs to', () => {
    const copy = 'Projects/VOL/Docs/Plan.sync-conflict-20260923-101500-ABCDEF7.md';
    expect(isSyncConflict(copy)).toBe(true);
    expect(isIgnoredPath(copy)).toBe(true);
    expect(syncConflictOriginal(copy)).toBe('Projects/VOL/Docs/Plan.md');
    expect(isSyncConflict('Projects/VOL/Docs/Plan.md')).toBe(false);
  });

  it('leaves the notes’ settings page, libraries and temporary files out', () => {
    expect(isIgnoredPath('CONFIG.md')).toBe(true);
    expect(isIgnoredPath('Library/Std/Config.md')).toBe(true);
    expect(isIgnoredPath('Library')).toBe(true);
    expect(isIgnoredPath('Projects/VOL/Docs/.Plan.md.sb-write-4711-3')).toBe(true);
    expect(isIgnoredPath('.sb-case-probe-4711-0')).toBe(true);
    // Only at the vault root: a project's own CONFIG.md or Library folder is knowledge.
    expect(isIgnoredPath('Projects/VOL/Docs/CONFIG.md')).toBe(false);
    expect(isIgnoredPath('Projects/VOL/Library/Books.md')).toBe(false);
    expect(isIgnoredPath('Projects/VOL/Docs/sb-write-notes.md')).toBe(false);
  });

  it('leaves version control, Obsidian state, the trash and temporary files out', () => {
    expect(isIgnoredPath('.git/HEAD')).toBe(true);
    expect(isIgnoredPath('.obsidian/workspace.json')).toBe(true);
    expect(isIgnoredPath('.trash/Projects/VOL/a.md')).toBe(true);
    expect(isIgnoredPath('Private/.trash/a.md')).toBe(true);
    expect(isIgnoredPath('Projects/VOL/Docs/.abc.tmp')).toBe(true);
    expect(isIgnoredPath('Projects/VOL/Docs/a.md')).toBe(false);
  });
});
