import { afterEach, describe, expect, it } from 'bun:test';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HermesPolicyMaterializer,
  HermesPolicySynchronizer,
  type RuntimePolicyClient,
  type RuntimePolicySnapshot,
  type RuntimeStatus,
} from '../policy';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'itsaplan-policy-'));
  roots.push(root);
  const cwd = join(root, 'work');
  const hermesHome = join(root, 'hermes');
  await mkdir(cwd);
  return { root, cwd, hermesHome, materializer: new HermesPolicyMaterializer({ cwd, hermesHome }) };
}

function snapshot(
  revision: string,
  files: RuntimePolicySnapshot['runtimePolicy']['files'] = [],
  skills: RuntimePolicySnapshot['skills'] = [],
): RuntimePolicySnapshot {
  return { revision, runtimePolicy: { files }, skills };
}

describe('Hermes runtime policy materializer', () => {
  it('writes managed instructions, memories, and linked skills atomically', async () => {
    const { cwd, hermesHome, materializer } = await fixture();
    await materializer.apply(
      snapshot(
        'sha256:first',
        [
          { kind: 'instructions', path: 'AGENTS.md', content: '# Agent' },
          { kind: 'instructions', path: 'SOUL.md', content: '# Soul' },
          { kind: 'instructions', path: 'instructions/review.md', content: '# Review' },
          { kind: 'memory', path: 'MEMORY.md', content: '# Memory' },
          { kind: 'memory', path: 'memory/team/context.md', content: '# Team' },
        ],
        [
          {
            id: 7,
            slug: 'plan-7',
            name: 'Triage',
            description: 'Triage work',
            markdown: '# Skill',
            files: [{ path: 'refs/checklist.md', content: '# Checklist' }],
          },
        ],
      ),
    );

    expect(await readFile(join(cwd, 'AGENTS.md'), 'utf8')).toBe('# Agent');
    expect(await readFile(join(cwd, 'instructions/review.md'), 'utf8')).toBe('# Review');
    expect(await readFile(join(hermesHome, 'SOUL.md'), 'utf8')).toBe('# Soul');
    expect(await readFile(join(hermesHome, 'memories/MEMORY.md'), 'utf8')).toBe('# Memory');
    expect(await readFile(join(hermesHome, 'memories/team/context.md'), 'utf8')).toBe('# Team');
    expect(await readFile(join(hermesHome, 'skills/plan-managed/plan-7/SKILL.md'), 'utf8')).toBe(
      '# Skill',
    );
    expect(
      await readFile(join(hermesHome, 'skills/plan-managed/plan-7/refs/checklist.md'), 'utf8'),
    ).toBe('# Checklist');
    const manifest = join(hermesHome, 'run/itsaplan-policy-manifest.json');
    expect((await lstat(manifest)).mode & 0o077).toBe(0);
    expect(await readFile(manifest, 'utf8')).not.toContain('# Agent');
  });

  it('updates and removes only files owned by the private manifest', async () => {
    const { cwd, hermesHome, materializer } = await fixture();
    await materializer.apply(
      snapshot(
        'sha256:first',
        [
          { kind: 'instructions', path: 'AGENTS.md', content: 'old' },
          { kind: 'memory', path: 'MEMORY.md', content: 'remove me' },
        ],
        [
          {
            id: 2,
            slug: 'plan-2',
            name: 'Skill',
            description: '',
            markdown: 'remove skill',
            files: [],
          },
        ],
      ),
    );
    await writeFile(join(cwd, 'unmanaged.md'), 'keep');
    const unmanagedSkill = join(hermesHome, 'skills/plan-managed/unmanaged');
    await mkdir(unmanagedSkill, { recursive: true });
    await writeFile(join(unmanagedSkill, 'note.md'), 'keep skill');

    await materializer.apply(
      snapshot('sha256:second', [{ kind: 'instructions', path: 'AGENTS.md', content: 'new' }]),
    );

    expect(await readFile(join(cwd, 'AGENTS.md'), 'utf8')).toBe('new');
    expect(await readFile(join(cwd, 'unmanaged.md'), 'utf8')).toBe('keep');
    expect(await readFile(join(unmanagedSkill, 'note.md'), 'utf8')).toBe('keep skill');
    await expect(readFile(join(hermesHome, 'memories/MEMORY.md'), 'utf8')).rejects.toThrow();
    await expect(
      readFile(join(hermesHome, 'skills/plan-managed/plan-2/SKILL.md'), 'utf8'),
    ).rejects.toThrow();
  });

  it('adopts a byte-identical existing SOUL.md and owns its later removal', async () => {
    const { hermesHome, materializer } = await fixture();
    await mkdir(hermesHome, { recursive: true });
    await writeFile(join(hermesHome, 'SOUL.md'), '# Existing soul');

    await materializer.apply(
      snapshot('sha256:adopt', [
        { kind: 'instructions', path: 'SOUL.md', content: '# Existing soul' },
      ]),
    );

    const manifest = JSON.parse(
      await readFile(join(hermesHome, 'run/itsaplan-policy-manifest.json'), 'utf8'),
    ) as { entries: Array<{ source: string; path: string; sha256: string }> };
    expect(manifest.entries).toContainEqual({
      source: 'runtime',
      path: 'SOUL.md',
      sha256: expect.any(String),
    });

    await materializer.apply(snapshot('sha256:removed'));
    await expect(readFile(join(hermesHome, 'SOUL.md'), 'utf8')).rejects.toThrow();
  });

  it('refuses to adopt a differing unmanaged SOUL.md', async () => {
    const { hermesHome, materializer } = await fixture();
    await mkdir(hermesHome, { recursive: true });
    await writeFile(join(hermesHome, 'SOUL.md'), '# Foreign soul');

    await expect(
      materializer.apply(
        snapshot('sha256:conflict', [
          { kind: 'instructions', path: 'SOUL.md', content: '# Plan soul' },
        ]),
      ),
    ).rejects.toThrow('refusing to replace an unmanaged runtime file');
    expect(await readFile(join(hermesHome, 'SOUL.md'), 'utf8')).toBe('# Foreign soul');
  });

  it('rejects traversal, unsafe skill slugs, symlinks, and modified managed files', async () => {
    const { root, cwd, materializer } = await fixture();
    await expect(
      materializer.apply(
        snapshot('sha256:bad', [{ kind: 'instructions', path: '../config.yaml', content: 'bad' }]),
      ),
    ).rejects.toThrow('unsafe path');
    await expect(
      materializer.apply(
        snapshot(
          'sha256:bad-skill',
          [],
          [
            {
              id: 1,
              slug: '../skill',
              name: 'Bad',
              description: '',
              markdown: 'bad',
              files: [],
            },
          ],
        ),
      ),
    ).rejects.toThrow('identity is invalid');

    const outside = join(root, 'outside');
    await writeFile(outside, 'outside');
    await symlink(outside, join(cwd, 'AGENTS.md'));
    await expect(
      materializer.apply(
        snapshot('sha256:symlink', [
          { kind: 'instructions', path: 'AGENTS.md', content: 'replace' },
        ]),
      ),
    ).rejects.toThrow('unsafe');
    expect(await readFile(outside, 'utf8')).toBe('outside');
    await rm(join(cwd, 'AGENTS.md'));

    await materializer.apply(
      snapshot('sha256:owned', [{ kind: 'instructions', path: 'AGENTS.md', content: 'owned' }]),
    );
    await writeFile(join(cwd, 'AGENTS.md'), 'changed outside');
    await expect(materializer.apply(snapshot('sha256:remove'))).rejects.toThrow(
      'refusing to remove a modified runtime file',
    );
    expect(await readFile(join(cwd, 'AGENTS.md'), 'utf8')).toBe('changed outside');
  });
});

describe('Hermes runtime policy synchronizer', () => {
  it('reports applied revisions and a secret-free degraded status', async () => {
    const { materializer } = await fixture();
    const values = [
      snapshot('sha256:one', [{ kind: 'instructions', path: 'AGENTS.md', content: 'one' }]),
      snapshot('sha256:one', [{ kind: 'instructions', path: 'AGENTS.md', content: 'one' }]),
      snapshot('sha256:two', [{ kind: 'instructions', path: 'AGENTS.md', content: 'two' }]),
      snapshot('sha256:bad', [
        { kind: 'instructions', path: '../secret-token.md', content: 'provider-secret-value' },
      ]),
    ];
    const statuses: RuntimeStatus[] = [];
    const client: RuntimePolicyClient = {
      runtimePolicy: async () => values.shift()!,
      reportRuntimeStatus: async (status) => {
        statuses.push(status);
      },
    };
    const sync = new HermesPolicySynchronizer(client, materializer);

    await sync.ensure();
    await sync.ensure();
    await sync.ensure();
    await expect(sync.ensure()).rejects.toThrow('Hermes runtime policy sync failed');

    expect(statuses.map(({ status, appliedRevision }) => ({ status, appliedRevision }))).toEqual([
      { status: 'online', appliedRevision: 'sha256:one' },
      { status: 'online', appliedRevision: 'sha256:two' },
      { status: 'degraded', appliedRevision: 'sha256:two' },
    ]);
    expect(statuses[0]?.capabilities).toEqual([
      'model',
      'reasoning',
      'managed-markdown',
      'managed-skills',
    ]);
    expect(JSON.stringify(statuses)).not.toContain('provider-secret-value');
    expect(statuses.at(-1)?.detail).toBe('Runtime policy sync failed');
  });
});
