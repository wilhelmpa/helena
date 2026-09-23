import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readHermesInventory, skillFrontmatter } from '../inventory';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function home(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'itsaplan-inventory-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const skill = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

describe('Hermes inventory', () => {
  it("lists the profile's skills by category, with where each came from", async () => {
    const hermesHome = await home({
      'skills/.bundled_manifest': 'airtable:3b1f\narxiv:1f2a\n',
      'skills/.hub/lock.json': JSON.stringify({ installed: { 'pdf-tools': {} } }),
      'skills/productivity/airtable/SKILL.md': skill('airtable', 'Airtable REST API via curl.'),
      'skills/productivity/DESCRIPTION.md': 'Productivity skills',
      'skills/research/arxiv/SKILL.md': skill('arxiv', '"Search arXiv: papers, authors."'),
      'skills/research/pdf-tools/SKILL.md': skill('pdf-tools', 'Read PDFs.'),
      'skills/plan-managed/plan-7/SKILL.md': skill('Triage', 'Triage work'),
      'skills/release-notes/SKILL.md': skill('release-notes', 'Writes release notes.'),
      'skills/.archive/old/SKILL.md': skill('old', 'Archived'),
    });

    const inventory = await readHermesInventory(hermesHome, {
      toolsets: ['file', 'web'],
      mcpServers: ['itsaplan'],
    });

    expect(inventory.toolsets).toEqual(['file', 'web']);
    expect(inventory.mcpServers).toEqual(['itsaplan']);
    expect(inventory.skills).toEqual([
      {
        name: 'release-notes',
        category: null,
        description: 'Writes release notes.',
        origin: 'agent',
        path: 'release-notes',
        pinned: false,
      },
      {
        name: 'Triage',
        category: 'plan-managed',
        description: 'Triage work',
        origin: 'plan',
        path: 'plan-managed/plan-7',
        pinned: false,
      },
      {
        name: 'airtable',
        category: 'productivity',
        description: 'Airtable REST API via curl.',
        origin: 'bundled',
        path: 'productivity/airtable',
        pinned: false,
      },
      {
        name: 'arxiv',
        category: 'research',
        description: 'Search arXiv: papers, authors.',
        origin: 'bundled',
        path: 'research/arxiv',
        pinned: false,
      },
      {
        name: 'pdf-tools',
        category: 'research',
        description: 'Read PDFs.',
        origin: 'hub',
        path: 'research/pdf-tools',
        pinned: false,
      },
    ]);
    expect(inventory.cronJobs).toBe(0);
  });

  it("counts a skill below plan-managed that Plan did not write as the agent's", async () => {
    const hermesHome = await home({
      'skills/plan-managed/plan-7/SKILL.md': skill('Triage', 'Triage work'),
      'skills/plan-managed/notes/SKILL.md': skill('notes', 'The agent put it here'),
    });

    const { skills } = await readHermesInventory(hermesHome, undefined, new Set(['plan-7']));

    expect(skills.map(({ path, origin }) => ({ path, origin }))).toEqual([
      { path: 'plan-managed/notes', origin: 'agent' },
      { path: 'plan-managed/plan-7', origin: 'plan' },
    ]);
  });

  it('lists a skill whose path is too long for an action without it', async () => {
    const category = 'c'.repeat(140);
    const name = 'n'.repeat(140);
    const hermesHome = await home({ [`skills/${category}/${name}/SKILL.md`]: skill(name, 'Long') });

    const { skills } = await readHermesInventory(hermesHome, undefined);

    expect(skills).toHaveLength(1);
    expect(skills[0]).not.toHaveProperty('path');
    expect(skills[0]).toMatchObject({ origin: 'agent', pinned: false });
  });

  it("marks the skills Hermes keeps pinned and counts Hermes' own cron jobs", async () => {
    const hermesHome = await home({
      'skills/release-notes/SKILL.md': skill('release-notes', 'Writes release notes.'),
      'skills/.usage.json': JSON.stringify({ 'release-notes': { pinned: true, use_count: 3 } }),
      'cron/jobs.json': JSON.stringify({
        jobs: [{ id: 'a' }, { id: 'b', enabled: false }, { id: 'c', enabled: true }],
      }),
    });

    const inventory = await readHermesInventory(hermesHome, undefined);

    expect(inventory.skills[0]).toMatchObject({ name: 'release-notes', pinned: true });
    expect(inventory.cronJobs).toBe(2);
  });

  it('bounds the skill list and each description', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 305; index++) {
      files[`skills/many/s${String(index).padStart(3, '0')}/SKILL.md`] = skill(
        `s${String(index).padStart(3, '0')}`,
        'x'.repeat(400),
      );
    }
    const inventory = await readHermesInventory(await home(files), undefined);

    expect(inventory.skills).toHaveLength(300);
    expect(inventory.skills[0].description).toHaveLength(300);
    expect(inventory.skills.at(-1)?.name).toBe('s299');
    expect(inventory.toolsets).toEqual([]);
    expect(inventory.mcpServers).toEqual([]);
  });

  it('reads both memory files, empty when missing and cut at 16 KB', async () => {
    const hermesHome = await home({ 'memories/USER.md': `${'a'.repeat(16 * 1024)}b` });

    const { memory } = await readHermesInventory(hermesHome, undefined);

    const user = `${'a'.repeat(16 * 1024)}b`;
    expect(memory).toEqual([
      { file: 'MEMORY.md', content: '', truncated: false, sha256: sha256(''), chars: 0 },
      {
        file: 'USER.md',
        content: 'a'.repeat(16 * 1024),
        truncated: true,
        sha256: sha256(user),
        chars: user.length,
      },
    ]);
  });

  it('never cuts a character in half', async () => {
    const hermesHome = await home({
      'skills/emoji/SKILL.md': skill('emoji', `${'x'.repeat(299)}😀 tail`),
      'memories/MEMORY.md': `${'m'.repeat(16 * 1024 - 1)}😀`,
    });

    const { skills, memory } = await readHermesInventory(hermesHome, undefined);

    expect(skills[0].description).toBe('x'.repeat(299));
    expect(memory[0]).toMatchObject({
      file: 'MEMORY.md',
      content: 'm'.repeat(16 * 1024 - 1),
      truncated: true,
    });
  });

  it('does not follow a symlink out of the profile', async () => {
    const outside = await home({ 'secret.md': 'provider-secret-value' });
    const hermesHome = await home({});
    await mkdir(join(hermesHome, 'memories'));
    await symlink(join(outside, 'secret.md'), join(hermesHome, 'memories/MEMORY.md'));
    await mkdir(join(hermesHome, 'skills/linked'), { recursive: true });
    await symlink(join(outside, 'secret.md'), join(hermesHome, 'skills/linked/SKILL.md'));

    const inventory = await readHermesInventory(hermesHome, undefined);

    expect(JSON.stringify(inventory)).not.toContain('provider-secret-value');
    expect(inventory.skills).toEqual([]);
  });
});

describe('SKILL.md frontmatter', () => {
  it('reads plain, quoted and block values', () => {
    expect(skillFrontmatter(skill('a', 'Plain text'))).toEqual({
      name: 'a',
      description: 'Plain text',
    });
    expect(skillFrontmatter('---\nname: \'it\'\'s\'\ndescription: "Say \\"hi\\""\n---')).toEqual({
      name: "it's",
      description: 'Say "hi"',
    });
    expect(
      skillFrontmatter(
        '---\nname: b\ndescription: >\n  First line\n  second line\nversion: 1\n---',
      ),
    ).toEqual({ name: 'b', description: 'First line second line' });
  });

  it('reads nothing outside the frontmatter', () => {
    expect(skillFrontmatter('# Title\nname: not-frontmatter')).toEqual({});
    expect(skillFrontmatter('---\nname: a\n---\ndescription: body')).toEqual({ name: 'a' });
  });
});
