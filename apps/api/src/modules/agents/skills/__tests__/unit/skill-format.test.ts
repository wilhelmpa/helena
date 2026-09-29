import { describe, it, expect } from 'bun:test';
import {
  parseFrontmatter,
  isDisallowedRef,
  runtimeReferencePath,
  parseGithubSkillUrl,
} from '../../skill-format';

// Pure parsing/validation for the skill format: SKILL.md frontmatter, the reference
// file denylist, and the GitHub URL parser. No network or DB, so these are unit
// tests. The network import itself (importGithubSkill/discoverGithubSkills) hits the
// live GitHub/CDN and is not covered here.

describe('parseFrontmatter', () => {
  it('reads name and description from a leading --- block', () => {
    const md = `---\nname: Triage\ndescription: How to triage issues\n---\n\nBody`;
    expect(parseFrontmatter(md)).toEqual({ name: 'Triage', description: 'How to triage issues' });
  });

  it('strips surrounding quotes', () => {
    const md = `---\nname: "Quoted"\ndescription: 'single'\n---`;
    expect(parseFrontmatter(md)).toEqual({ name: 'Quoted', description: 'single' });
  });

  it('returns an empty object when there is no frontmatter', () => {
    expect(parseFrontmatter('Just a body, no frontmatter.')).toEqual({});
  });

  it('ignores keys other than name/description', () => {
    const md = `---\nname: X\nversion: 2\n---`;
    expect(parseFrontmatter(md)).toEqual({ name: 'X' });
  });
});

describe('isDisallowedRef', () => {
  it('rejects binary executables', () => {
    for (const f of ['x.exe', 'lib.dll', 'module.wasm']) {
      expect(isDisallowedRef(f)).toBe(true);
    }
  });

  it('allows documents and script source for policy-controlled execution', () => {
    for (const f of ['notes.md', 'table.csv', 'image.png', 'README', 'run.sh', 'tool.py', 'a.js']) {
      expect(isDisallowedRef(f)).toBe(false);
    }
  });
});

describe('parseGithubSkillUrl', () => {
  it('parses a repository root (default branch, root folder)', () => {
    expect(parseGithubSkillUrl('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
      ref: '',
      subpath: '',
    });
  });

  it('strips a .git suffix from the repo name', () => {
    expect(parseGithubSkillUrl('https://github.com/owner/repo.git').repo).toBe('repo');
  });

  it('parses a /tree/<ref>/<folder> link', () => {
    expect(parseGithubSkillUrl('https://github.com/o/r/tree/main/skills/triage')).toEqual({
      owner: 'o',
      repo: 'r',
      ref: 'main',
      subpath: 'skills/triage',
    });
  });

  it('parses a /blob/<ref>/<file> link to the containing folder', () => {
    expect(parseGithubSkillUrl('https://github.com/o/r/blob/main/skills/triage/SKILL.md')).toEqual({
      owner: 'o',
      repo: 'r',
      ref: 'main',
      subpath: 'skills/triage',
    });
  });

  it('rejects a non-https URL', () => {
    expect(() => parseGithubSkillUrl('http://github.com/o/r')).toThrow();
  });

  it('rejects a non-github host', () => {
    expect(() => parseGithubSkillUrl('https://gitlab.com/o/r')).toThrow();
  });

  it('rejects a URL missing the repository', () => {
    expect(() => parseGithubSkillUrl('https://github.com/owner')).toThrow();
  });

  it('rejects an unsupported marker', () => {
    expect(() => parseGithubSkillUrl('https://github.com/o/r/commits/main')).toThrow();
  });
});

it('delivers safe script and reference paths without path traversal', () => {
  for (const path of [
    'scripts/check.py',
    'scripts/__init__.py',
    'refs/data.json',
    'scripts/run.sh',
    'README',
  ])
    expect(runtimeReferencePath(path)).toBe(true);
  for (const path of ['../secret', '/tmp/secret', 'refs/../secret', 'scripts/module.so'])
    expect(runtimeReferencePath(path)).toBe(false);
});
