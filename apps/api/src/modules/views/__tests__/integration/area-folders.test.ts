import { describe, it, expect, beforeEach } from 'bun:test';
import { db, projectProvisioningJob } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// Every area has a folder: the directory the integration service keeps for it in the
// project workspace and in the project's vault folder.

async function setup() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  const created = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  return {
    asOwner,
    projectId: created.data!.id,
    areas: asOwner.projects({ projectKey: 'MKT' })['view-folders'],
  };
}

// Marks the project's provisioning as delivered, so a test can tell whether a change
// queued it again.
async function deliver(api: Api, projectId: number): Promise<string> {
  await db
    .update(projectProvisioningJob)
    .set({ status: 'succeeded', result: { resources: [] }, completedAt: new Date() })
    .where(eq(projectProvisioningJob.projectId, projectId));
  return (await api.projects({ projectKey: 'MKT' }).provisioning.get()).data!.id;
}

async function provisioning(api: Api) {
  return (await api.projects({ projectKey: 'MKT' }).provisioning.get()).data!;
}

describe('area folders', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create', () => {
    it('derives a folder from the name that is unique within the project', async () => {
      const { asOwner, areas } = await setup();
      const first = await areas.post({ name: 'Design & UX' });
      const second = await areas.post({ name: 'Design / UX' });
      const reserved = await areas.post({ name: 'Docs' });

      expect(first.status).toBe(201);
      expect(first.data).toMatchObject({ name: 'Design & UX', folder: 'design-ux' });
      expect(second.data!.folder).toBe('design-ux-2');
      expect(reserved.data!.folder).toBe('docs-2');
      expect((await areas.get()).data!.map((area) => area.folder)).toEqual([
        'design-ux',
        'design-ux-2',
        'docs-2',
      ]);

      await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
      const elsewhere = await asOwner
        .projects({ projectKey: 'OPS' })
        ['view-folders'].post({ name: 'Design & UX' });
      expect(elsewhere.data!.folder).toBe('design-ux');
    });

    it('stores a folder given with the area', async () => {
      const { areas } = await setup();
      const created = await areas.post({ name: 'Backend', folder: 'server' });
      expect(created.data).toMatchObject({ name: 'Backend', folder: 'server' });
    });

    it('accepts a folder of 64 characters and rejects one of 65', async () => {
      const { areas } = await setup();
      expect((await areas.post({ name: 'Long', folder: 'a'.repeat(64) })).status).toBe(201);
      expect((await areas.post({ name: 'Longer', folder: 'a'.repeat(65) })).status).toBe(400);
    });

    it('rejects a folder that is no single lowercase path segment', async () => {
      const { areas } = await setup();
      for (const folder of ['Backend', 'back/end', '..', '-backend', 'back end', '']) {
        expect((await areas.post({ name: `Area ${folder}`, folder })).status).toBe(400);
      }
    });

    it('rejects a reserved folder with 400 and a taken one with 409', async () => {
      const { areas } = await setup();
      await areas.post({ name: 'Backend' });
      expect((await areas.post({ name: 'Boards', folder: 'boards' })).status).toBe(400);
      const taken = await areas.post({ name: 'Server', folder: 'backend' });
      expect(taken.status).toBe(409);
      expect(taken.error!.value).toMatchObject({
        error: 'Another area of this project uses this folder',
      });
    });

    it('rejects a second area with the same name', async () => {
      const { areas } = await setup();
      await areas.post({ name: 'Backend', folder: 'server' });
      expect((await areas.post({ name: 'Backend', folder: 'backend' })).status).toBe(409);
    });

    it('queues the provisioning of the project', async () => {
      const { asOwner, projectId, areas } = await setup();
      const delivered = await deliver(asOwner, projectId);

      await areas.post({ name: 'Backend' });

      const job = await provisioning(asOwner);
      expect(job).toMatchObject({ status: 'pending', result: null, completedAt: null });
      expect(job.id).not.toBe(delivered);
    });
  });

  describe('update', () => {
    it('moves a folder that follows the name along with a rename', async () => {
      const { asOwner, projectId, areas } = await setup();
      const area = (await areas.post({ name: 'Design' })).data!;
      await areas.post({ name: 'Product design', folder: 'product-design' });
      const delivered = await deliver(asOwner, projectId);

      const renamed = await asOwner['view-folders']({ folderId: area.id }).patch({
        name: 'Product design!',
      });

      expect(renamed.data).toMatchObject({ name: 'Product design!', folder: 'product-design-2' });
      expect((await provisioning(asOwner)).id).not.toBe(delivered);
    });

    it('keeps a folder set by hand when the area is renamed', async () => {
      const { asOwner, projectId, areas } = await setup();
      const area = (await areas.post({ name: 'Design', folder: 'ux' })).data!;
      const delivered = await deliver(asOwner, projectId);

      const renamed = await asOwner['view-folders']({ folderId: area.id }).patch({
        name: 'Product design',
      });

      expect(renamed.data).toMatchObject({ name: 'Product design', folder: 'ux' });
      expect(await provisioning(asOwner)).toMatchObject({ id: delivered, status: 'succeeded' });
    });

    it('changes only the folder and queues the provisioning', async () => {
      const { asOwner, projectId, areas } = await setup();
      const area = (await areas.post({ name: 'Design' })).data!;
      const delivered = await deliver(asOwner, projectId);

      const moved = await asOwner['view-folders']({ folderId: area.id }).patch({ folder: 'ux' });

      expect(moved.data).toMatchObject({ name: 'Design', folder: 'ux' });
      const job = await provisioning(asOwner);
      expect(job.status).toBe('pending');
      expect(job.id).not.toBe(delivered);
    });

    it('rejects a folder another area uses, a reserved one and an invalid one', async () => {
      const { asOwner, areas } = await setup();
      const area = (await areas.post({ name: 'Design' })).data!;
      await areas.post({ name: 'Backend' });
      const route = asOwner['view-folders']({ folderId: area.id });

      expect((await route.patch({ folder: 'backend' })).status).toBe(409);
      expect((await route.patch({ folder: 'inbox' })).status).toBe(400);
      expect((await route.patch({ folder: 'Design' })).status).toBe(400);
      expect((await route.patch({ name: '   ' })).status).toBe(400);
      expect((await areas.get()).data!.find((row) => row.id === area.id)!.folder).toBe('design');
    });

    it('keeps its own folder when the patch names it again', async () => {
      const { asOwner, areas } = await setup();
      const area = (await areas.post({ name: 'Design' })).data!;
      const same = await asOwner['view-folders']({ folderId: area.id }).patch({
        name: 'Design',
        folder: 'design',
      });
      expect(same.data).toMatchObject({ name: 'Design', folder: 'design' });
    });

    it('returns 404 for a missing area', async () => {
      const { asOwner } = await setup();
      expect(
        (await asOwner['view-folders']({ folderId: 999999 }).patch({ folder: 'x' })).status,
      ).toBe(404);
    });
  });

  describe('delete', () => {
    it('queues the provisioning, which moves the folders to the trash', async () => {
      const { asOwner, projectId, areas } = await setup();
      const area = (await areas.post({ name: 'Design' })).data!;
      const delivered = await deliver(asOwner, projectId);

      expect((await asOwner['view-folders']({ folderId: area.id }).delete()).status).toBe(204);

      const job = await provisioning(asOwner);
      expect(job.status).toBe('pending');
      expect(job.id).not.toBe(delivered);
      expect((await areas.post({ name: 'Design again', folder: 'design' })).status).toBe(201);
    });
  });

  describe('access', () => {
    it('denies a non-member', async () => {
      const { areas } = await setup();
      const area = (await areas.post({ name: 'Design' })).data!;
      const stranger = authedApi((await signUpTestUser()).cookie);
      expect(
        (await stranger.projects({ projectKey: 'MKT' })['view-folders'].post({ name: 'X' })).status,
      ).toBe(403);
      expect(
        (await stranger['view-folders']({ folderId: area.id }).patch({ folder: 'x' })).status,
      ).toBe(403);
      expect((await areas.get()).data!.map((row) => row.folder)).toEqual(['design']);
    });
  });
});
