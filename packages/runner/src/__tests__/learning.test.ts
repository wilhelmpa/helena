import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readHermesInventory } from '../inventory';
import { digest as sha256 } from '../files';
import { readLearnedSkills, runActions, setCuratorPaused } from '../learning';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function home(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'itsaplan-learning-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const skill = (name: string) =>
  `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}\n`;

// The directories below plan-managed the runner wrote.
const PLAN = new Set(['plan-7']);

const learned = {
  'skills/.bundled_manifest': 'airtable:3b1f\n',
  'skills/productivity/airtable/SKILL.md': skill('airtable'),
  'skills/plan-managed/plan-7/SKILL.md': skill('Triage'),
  'skills/research/web-scrape/SKILL.md': skill('web-scrape'),
  'skills/research/web-scrape/references/sites.md': '# Sites',
  'skills/research/web-scrape/scripts/fetch.py': 'print(1)',
};

describe('actions on what the agent learned', () => {
  it('moves a discarded skill to the archive, where Hermes no longer loads it', async () => {
    const hermesHome = await home({
      ...learned,
      'skills/.archive/web-scrape/SKILL.md': skill('web-scrape'),
    });

    const results = await runActions(hermesHome, PLAN, [
      { id: 1, kind: 'discard-skill', path: 'research/web-scrape' },
      // Already gone: what the owner asked for holds.
      { id: 2, kind: 'discard-skill', path: 'research/web-scrape' },
    ]);

    expect(results).toEqual([
      { id: 1, error: null },
      { id: 2, error: null },
    ]);
    const archived = await readdir(join(hermesHome, 'skills/.archive'));
    expect(archived).toHaveLength(2);
    expect(archived.find((name) => name.startsWith('web-scrape-'))).toBeDefined();
    const inventory = await readHermesInventory(hermesHome, undefined);
    expect(inventory.skills.map(({ name }) => name)).not.toContain('web-scrape');
  });

  it("refuses Plan's skills, skills that shipped with Hermes, and unsafe paths", async () => {
    const hermesHome = await home(learned);
    const outside = await home({ 'SKILL.md': skill('outside') });
    await symlink(outside, join(hermesHome, 'skills/linked'));

    const results = await runActions(hermesHome, PLAN, [
      { id: 1, kind: 'discard-skill', path: 'plan-managed/plan-7' },
      { id: 2, kind: 'discard-skill', path: 'productivity/airtable' },
      { id: 3, kind: 'discard-skill', path: '../skills' },
      { id: 4, kind: 'discard-skill', path: 'linked' },
      { id: 5, kind: 'pin-skill', path: 'productivity/airtable', pinned: true },
    ]);

    expect(results).toEqual([
      { id: 1, error: "Ava's own skills are changed in Ava" },
      { id: 2, error: 'Only a skill the agent created itself can be changed here' },
      { id: 3, error: 'The skill path is invalid' },
      { id: 4, error: 'The skill path is unsafe' },
      { id: 5, error: 'Only a skill the agent created itself can be changed here' },
    ]);
    expect(await readFile(join(hermesHome, 'skills/plan-managed/plan-7/SKILL.md'), 'utf8')).toBe(
      skill('Triage'),
    );
    expect(await readFile(join(outside, 'SKILL.md'), 'utf8')).toBe(skill('outside'));
  });

  it('discards a skill the agent created below plan-managed, which Plan did not write', async () => {
    const hermesHome = await home({
      ...learned,
      'skills/plan-managed/notes/SKILL.md': skill('notes'),
    });

    expect(
      await runActions(hermesHome, PLAN, [
        { id: 1, kind: 'discard-skill', path: 'plan-managed/notes' },
        { id: 2, kind: 'discard-skill', path: 'plan-managed' },
      ]),
    ).toEqual([
      { id: 1, error: null },
      { id: 2, error: "Ava's own skills are changed in Ava" },
    ]);
    expect(await readdir(join(hermesHome, 'skills/.archive'))).toEqual(['notes']);
  });

  it("pins and unpins a skill in Hermes' usage records, keeping what else they hold", async () => {
    const hermesHome = await home({
      ...learned,
      'skills/.usage.json': JSON.stringify({ 'web-scrape': { use_count: 4, created_by: 'agent' } }),
    });

    expect(
      await runActions(hermesHome, PLAN, [
        { id: 1, kind: 'pin-skill', path: 'research/web-scrape', pinned: true },
      ]),
    ).toEqual([{ id: 1, error: null }]);
    expect(JSON.parse(await readFile(join(hermesHome, 'skills/.usage.json'), 'utf8'))).toEqual({
      'web-scrape': { use_count: 4, created_by: 'agent', pinned: true },
    });
    expect((await readHermesInventory(hermesHome, undefined)).skills).toContainEqual(
      expect.objectContaining({ name: 'web-scrape', pinned: true }),
    );

    await runActions(hermesHome, PLAN, [
      { id: 2, kind: 'pin-skill', path: 'research/web-scrape', pinned: false },
    ]);
    expect((await readHermesInventory(hermesHome, undefined)).skills).toContainEqual(
      expect.objectContaining({ name: 'web-scrape', pinned: false }),
    );
  });

  it('writes memory only over the version the owner edited', async () => {
    const hermesHome = await home({ 'memories/MEMORY.md': 'Uses bun.' });

    const results = await runActions(hermesHome, PLAN, [
      {
        id: 1,
        kind: 'write-memory',
        file: 'MEMORY.md',
        content: 'Uses bun.\n§\nDeploys on Fridays.',
        baseSha256: sha256('Uses bun.'),
      },
      // Made on the version before the first write.
      {
        id: 2,
        kind: 'write-memory',
        file: 'MEMORY.md',
        content: '',
        baseSha256: sha256('Uses bun.'),
      },
      // A file that does not exist yet reads as empty.
      {
        id: 3,
        kind: 'write-memory',
        file: 'USER.md',
        content: 'Prefers German.',
        baseSha256: sha256(''),
      },
    ]);

    expect(results).toEqual([
      { id: 1, error: null },
      { id: 2, error: 'The memory changed since it was read; reload it and edit again' },
      { id: 3, error: null },
    ]);
    const { memory } = await readHermesInventory(hermesHome, undefined);
    expect(memory.map(({ content }) => content)).toEqual([
      'Uses bun.\n§\nDeploys on Fridays.',
      'Prefers German.',
    ]);
  });

  it('counts a memory write carried out before its result was reported as done', async () => {
    const hermesHome = await home({ 'memories/MEMORY.md': 'Uses bun.' });
    const write = {
      id: 1,
      kind: 'write-memory' as const,
      file: 'MEMORY.md' as const,
      content: 'Uses pnpm.',
      baseSha256: sha256('Uses bun.'),
    };

    expect(await runActions(hermesHome, PLAN, [write])).toEqual([{ id: 1, error: null }]);
    expect(await runActions(hermesHome, PLAN, [write])).toEqual([{ id: 1, error: null }]);
  });

  it('clears memory and never writes through a link', async () => {
    const outside = await home({ 'notes.md': 'outside' });
    const hermesHome = await home({ 'memories/USER.md': 'Prefers German.' });
    await symlink(join(outside, 'notes.md'), join(hermesHome, 'memories/MEMORY.md'));

    const results = await runActions(hermesHome, PLAN, [
      {
        id: 1,
        kind: 'write-memory',
        file: 'USER.md',
        content: '',
        baseSha256: sha256('Prefers German.'),
      },
      {
        id: 2,
        kind: 'write-memory',
        file: 'MEMORY.md',
        content: 'x',
        baseSha256: sha256('outside'),
      },
    ]);

    expect(results).toEqual([
      { id: 1, error: null },
      { id: 2, error: 'MEMORY.md is a symbolic link' },
    ]);
    expect(await readFile(join(hermesHome, 'memories/USER.md'), 'utf8')).toBe('');
    expect(await readFile(join(outside, 'notes.md'), 'utf8')).toBe('outside');
  });
});

describe('learned skill content', () => {
  it("reads the SKILL.md and Markdown files of the agent's own skills and counts the rest", async () => {
    const hermesHome = await home(learned);
    const { skills } = await readHermesInventory(hermesHome, undefined, new Set(['plan-7']));

    expect(await readLearnedSkills(hermesHome, skills)).toEqual([
      {
        path: 'research/web-scrape',
        name: 'web-scrape',
        markdown: skill('web-scrape'),
        files: [{ path: 'references/sites.md', content: '# Sites' }],
        otherFiles: 1,
        truncated: false,
      },
    ]);
  });

  it('leaves out the content of a skill past the size Plan accepts', async () => {
    const hermesHome = await home({
      'skills/huge/SKILL.md': `${skill('huge')}${'x'.repeat(70 * 1024)}`,
    });
    const { skills } = await readHermesInventory(hermesHome, undefined);

    expect(await readLearnedSkills(hermesHome, skills)).toEqual([
      { path: 'huge', name: 'huge', markdown: '', files: [], otherFiles: 0, truncated: true },
    ]);
  });
});

describe("Hermes' curator", () => {
  it('pauses and resumes it in its own state file, keeping what Hermes stored there', async () => {
    const hermesHome = await home({
      'skills/.curator_state': JSON.stringify({ last_run_at: '2026-09-20T10:00:00+00:00' }),
    });

    expect(await setCuratorPaused(hermesHome, true)).toBe(true);
    expect(await setCuratorPaused(hermesHome, true)).toBe(false);
    expect(JSON.parse(await readFile(join(hermesHome, 'skills/.curator_state'), 'utf8'))).toEqual({
      last_run_at: '2026-09-20T10:00:00+00:00',
      paused: true,
    });
    expect(await setCuratorPaused(hermesHome, false)).toBe(true);
    expect(
      JSON.parse(await readFile(join(hermesHome, 'skills/.curator_state'), 'utf8')).paused,
    ).toBe(false);
  });

  it('writes the state for a home Hermes has not started in yet', async () => {
    const hermesHome = await home({});

    await setCuratorPaused(hermesHome, true);

    expect(JSON.parse(await readFile(join(hermesHome, 'skills/.curator_state'), 'utf8'))).toEqual({
      paused: true,
    });
  });
});
