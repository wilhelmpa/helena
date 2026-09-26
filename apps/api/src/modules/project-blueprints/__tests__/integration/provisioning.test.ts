import { beforeEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { readBlueprintDir } from '@helena/sdk/blueprints';
import { db, projectProvisioningJob } from '@repo/db';
import { absoluteVaultPath } from '@repo/vault';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { applyBlueprintPlan } from '../../apply';
import { waitForBlueprintProvisioning } from '../../provisioning';
import type { BlueprintPlan } from '../../plan';

const fixture = readBlueprintDir(join(import.meta.dir, '../../../../../../../blueprints/trading'));
beforeEach(resetDb);

async function context(key: string) {
  const user = await signUpTestUser();
  const owner = authedApi(user.cookie);
  const seed = (await owner.projects.post({ key: 'CTX', name: 'Blueprint team' })).data!;
  const blueprint = structuredClone(fixture);
  blueprint.project.key = key;
  return { owner, blueprint, teamId: seed.teamId, ownerUserId: user.userId };
}

// The native worker is outside this API process. Completing its job here is the adapter
// boundary, after the real API has created the project and queued its provisioning.
async function completeProvisioning(projectId: number, status: 'succeeded' | 'failed') {
  await db
    .update(projectProvisioningJob)
    .set({ status, completedAt: new Date() })
    .where(eq(projectProvisioningJob.projectId, projectId));
}

function plan(key: string): BlueprintPlan {
  return {
    blockers: [],
    skipped: [],
    changes: [
      { kind: 'project', key, name: 'Blueprint proof', description: '' },
      { kind: 'area', name: 'Research', folder: 'Research' },
      { kind: 'file', path: `Projects/${key}/Docs/Proof.md`, content: '# Provisioned first' },
      { kind: 'board', name: 'Proof board', stickers: [], edges: [] },
    ],
  };
}

describe('blueprint provisioning barrier', () => {
  it('waits for the latest project/area job before notes and boards, and can rerun', async () => {
    const ctx = await context('BOOT');
    let waiting!: () => void;
    const reachedWait = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const work = applyBlueprintPlan(
      {
        ...ctx,
        log: (line) => {
          if (line.startsWith('[WAIT]')) waiting();
        },
      },
      plan('BOOT'),
    );
    expect(
      await Promise.race([reachedWait.then(() => 'waiting'), work.then(() => 'completed')]),
    ).toBe('waiting');
    const project = (await ctx.owner.projects({ projectKey: 'BOOT' }).get()).data!.project;
    expect(
      (await ctx.owner.projects({ projectKey: 'BOOT' }).setup.get()).data?.provisioning?.status,
    ).toBe('pending');
    const root = absoluteVaultPath('Projects/BOOT');
    expect(existsSync(root)).toBe(false);
    await mkdir(root, { recursive: true });
    await completeProvisioning(project.id, 'succeeded');
    expect(await work).toBe(4);
    expect(await readFile(join(root, 'Docs/Proof.md'), 'utf8')).toBe('# Provisioned first');
    const again = { blockers: [], skipped: [], changes: [plan('BOOT').changes[2]!] };
    expect(await applyBlueprintPlan({ ...ctx, log: () => {} }, again)).toBe(1);
    expect(await readFile(join(root, 'Docs/Proof.md'), 'utf8')).toBe('# Provisioned first');
  });

  it('reports a provisioning failure before creating a project root or writing files', async () => {
    const ctx = await context('FAIL');
    const project = (await ctx.owner.projects.post({ key: 'FAIL', name: 'Failure proof' })).data!;
    await completeProvisioning(project.id, 'failed');
    const changes = [plan('FAIL').changes[2]!];
    await expect(
      applyBlueprintPlan({ ...ctx, log: () => {} }, { changes, skipped: [], blockers: [] }),
    ).rejects.toThrow('provisioning failed');
    expect(existsSync(absoluteVaultPath('Projects/FAIL'))).toBe(false);
  });

  it('bounds waiting and refuses an absent or symlinked provisioned root', async () => {
    const ctx = await context('ROOT');
    const project = (await ctx.owner.projects.post({ key: 'ROOT', name: 'Root proof' })).data!;
    await expect(waitForBlueprintProvisioning(project.id, 'ROOT', () => {}, 20)).rejects.toThrow(
      'still pending',
    );
    expect(existsSync(absoluteVaultPath('Projects/ROOT'))).toBe(false);
    await completeProvisioning(project.id, 'succeeded');
    await expect(waitForBlueprintProvisioning(project.id, 'ROOT', () => {})).rejects.toThrow(
      'without its vault directory',
    );
    const outside = absoluteVaultPath('Outside');
    await mkdir(outside, { recursive: true });
    await mkdir(absoluteVaultPath('Projects'), { recursive: true });
    await symlink(outside, absoluteVaultPath('Projects/ROOT'));
    await expect(waitForBlueprintProvisioning(project.id, 'ROOT', () => {})).rejects.toThrow();
    expect(existsSync(join(outside, 'Docs'))).toBe(false);
  });

  it('waits for descriptors even when a blueprint has no knowledge files', async () => {
    const ctx = await context('ONLY');
    await expect(
      applyBlueprintPlan(
        { ...ctx, log: () => {}, provisioningTimeoutMs: 20 },
        { changes: [plan('ONLY').changes[0]!], skipped: [], blockers: [] },
      ),
    ).rejects.toThrow('still pending');
    expect(existsSync(absoluteVaultPath('Projects/ONLY'))).toBe(false);
  });
});
