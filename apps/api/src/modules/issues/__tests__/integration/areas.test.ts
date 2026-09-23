import { describe, it, expect, beforeEach } from 'bun:test';
import { api, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { addProjectMember } from '#tests/helpers/members';

// An area is a view folder that also holds issues: issue.folderId names it. Create,
// update and bulk update set it, the project list filters by it, and a saved view
// inside an area shows only that area's issues.

async function setupProject() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = await asOwner.projects({ projectKey: 'MKT' }).get();
  return { asOwner, columnId: view.data!.columns[0].id };
}

async function createArea(client: Api, name: string, projectKey = 'MKT') {
  const res = await client.projects({ projectKey })['view-folders'].post({ name });
  return res.data!.id;
}

function createIssue(client: Api, columnId: number, patch: Record<string, unknown> = {}) {
  return client.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Task', ...patch });
}

// An area of a second project, which no issue of the first one may be put in.
async function foreignArea(client: Api) {
  await client.projects.post({ key: 'OPS', name: 'Operations' });
  return createArea(client, 'Elsewhere', 'OPS');
}

describe('issue areas', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create', () => {
    it('puts a new issue in an area of its project', async () => {
      const { asOwner, columnId } = await setupProject();
      const areaId = await createArea(asOwner, 'Backend');

      const created = await createIssue(asOwner, columnId, { folderId: areaId });
      expect(created.status).toBe(201);
      expect(created.data?.folderId).toBe(areaId);

      const board = await asOwner.projects({ projectKey: 'MKT' }).issues.board.get();
      expect(board.data!.issues.find((i) => i.id === created.data!.id)?.folderId).toBe(areaId);
    });

    it('creates an issue outside any area by default', async () => {
      const { asOwner, columnId } = await setupProject();
      const created = await createIssue(asOwner, columnId);
      expect(created.data?.folderId).toBeNull();
    });

    it("rejects another project's area with 400", async () => {
      const { asOwner, columnId } = await setupProject();
      const areaId = await foreignArea(asOwner);

      const res = await createIssue(asOwner, columnId, { folderId: areaId });
      expect(res.status).toBe(400);
      expect(res.error?.value).toMatchObject({ error: 'Area must belong to this project' });
    });

    it('rejects an area that does not exist with 400', async () => {
      const { asOwner, columnId } = await setupProject();
      const res = await createIssue(asOwner, columnId, { folderId: 999_999 });
      expect(res.status).toBe(400);
    });
  });

  describe('update', () => {
    it('moves an issue into an area and out of it again', async () => {
      const { asOwner, columnId } = await setupProject();
      const areaId = await createArea(asOwner, 'Backend');
      const issueId = (await createIssue(asOwner, columnId)).data!.id;

      const moved = await asOwner.issues({ issueId }).patch({ folderId: areaId });
      expect(moved.status).toBe(200);
      expect(moved.data?.folderId).toBe(areaId);

      const cleared = await asOwner.issues({ issueId }).patch({ folderId: null });
      expect(cleared.status).toBe(200);
      expect(cleared.data?.folderId).toBeNull();
    });

    it("rejects another project's area with 400 and keeps the issue where it was", async () => {
      const { asOwner, columnId } = await setupProject();
      const areaId = await createArea(asOwner, 'Backend');
      const issueId = (await createIssue(asOwner, columnId, { folderId: areaId })).data!.id;
      const foreign = await foreignArea(asOwner);

      const res = await asOwner.issues({ issueId }).patch({ folderId: foreign });
      expect(res.status).toBe(400);

      const after = await asOwner.issues({ issueId }).get();
      expect(after.data?.folderId).toBe(areaId);
    });

    it('logs the move in the activity feed with the area names', async () => {
      const { asOwner, columnId } = await setupProject();
      const backend = await createArea(asOwner, 'Backend');
      const frontend = await createArea(asOwner, 'Frontend');
      const issueId = (await createIssue(asOwner, columnId, { folderId: backend })).data!.id;

      await asOwner.issues({ issueId }).patch({ folderId: frontend });

      const feed = await asOwner.issues({ issueId }).feed.get({ query: {} });
      const entry = feed.data!.items.find((i) => i.action === 'area');
      expect(entry?.payload).toMatchObject({
        from: { value: 'Backend', id: backend },
        to: { value: 'Frontend', id: frontend },
      });
    });

    it("clears the issues' area when the area is deleted", async () => {
      const { asOwner, columnId } = await setupProject();
      const areaId = await createArea(asOwner, 'Backend');
      const issueId = (await createIssue(asOwner, columnId, { folderId: areaId })).data!.id;

      const deleted = await asOwner['view-folders']({ folderId: areaId }).delete();
      expect(deleted.status).toBe(204);

      const after = await asOwner.issues({ issueId }).get();
      expect(after.status).toBe(200);
      expect(after.data?.folderId).toBeNull();
    });
  });

  describe('bulk update', () => {
    it('moves every listed issue into the area', async () => {
      const { asOwner, columnId } = await setupProject();
      const areaId = await createArea(asOwner, 'Backend');
      const a = (await createIssue(asOwner, columnId)).data!.id;
      const b = (await createIssue(asOwner, columnId)).data!.id;

      const res = await asOwner
        .projects({ projectKey: 'MKT' })
        .issues.bulk.patch({ ids: [a, b], patch: { folderId: areaId } });
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ updated: 2 });

      const board = await asOwner.projects({ projectKey: 'MKT' }).issues.board.get();
      expect(board.data!.issues.map((i) => i.folderId)).toEqual([areaId, areaId]);
    });

    it("rejects another project's area with 400", async () => {
      const { asOwner, columnId } = await setupProject();
      const a = (await createIssue(asOwner, columnId)).data!.id;
      const foreign = await foreignArea(asOwner);

      const res = await asOwner
        .projects({ projectKey: 'MKT' })
        .issues.bulk.patch({ ids: [a], patch: { folderId: foreign } });
      expect(res.status).toBe(400);
    });

    it('is refused to a non-member', async () => {
      const { asOwner, columnId } = await setupProject();
      const areaId = await createArea(asOwner, 'Backend');
      const a = (await createIssue(asOwner, columnId)).data!.id;
      const outsider = authedApi((await signUpTestUser()).cookie);

      const res = await outsider
        .projects({ projectKey: 'MKT' })
        .issues.bulk.patch({ ids: [a], patch: { folderId: areaId } });
      expect(res.status).toBe(403);
    });
  });

  describe('list', () => {
    it('filters the project list by area', async () => {
      const { asOwner, columnId } = await setupProject();
      const areaId = await createArea(asOwner, 'Backend');
      const inArea = (await createIssue(asOwner, columnId, { folderId: areaId })).data!.id;
      await createIssue(asOwner, columnId);

      const res = await asOwner
        .projects({ projectKey: 'MKT' })
        .issues.get({ query: { folderId: areaId } });
      expect(res.status).toBe(200);
      expect(res.data!.map((i) => i.id)).toEqual([inArea]);
      expect(res.data![0].folderId).toBe(areaId);
    });

    it('lists every issue when the filter is left empty', async () => {
      const { asOwner, columnId } = await setupProject();
      const areaId = await createArea(asOwner, 'Backend');
      await createIssue(asOwner, columnId, { folderId: areaId });
      await createIssue(asOwner, columnId);

      const res = await asOwner.projects({ projectKey: 'MKT' }).issues.get({ query: {} });
      expect(res.data).toHaveLength(2);
    });

    it('lets a plain member read the area of an issue', async () => {
      const { asOwner, columnId } = await setupProject();
      const areaId = await createArea(asOwner, 'Backend');
      const issueId = (await createIssue(asOwner, columnId, { folderId: areaId })).data!.id;
      const member = await addProjectMember(asOwner, 'MKT');

      const res = await member.issues({ issueId }).get();
      expect(res.status).toBe(200);
      expect(res.data?.folderId).toBe(areaId);
    });
  });

  describe('shared views', () => {
    it('shows only the area issues on a shared view inside the area', async () => {
      const { asOwner, columnId } = await setupProject();
      const areaId = await createArea(asOwner, 'Backend');
      const inArea = (await createIssue(asOwner, columnId, { folderId: areaId })).data!.id;
      const outside = (await createIssue(asOwner, columnId)).data!.id;
      const viewId = (
        await asOwner
          .projects({ projectKey: 'MKT' })
          .views.post({ name: 'Backend board', folderId: areaId })
      ).data!.id;
      const token = (await asOwner.views({ viewId }).share.post()).data!.token;

      const shared = await api.share.view({ token }).get();
      expect(shared.status).toBe(200);
      expect(shared.data.issues.map((i: { id: number }) => i.id)).toEqual([inArea]);

      const hidden = await api.share.view({ token }).issues({ issueId: outside }).get();
      expect(hidden.status).toBe(404);
    });

    it('keeps the area private on a link that is not extended', async () => {
      const { asOwner, columnId } = await setupProject();
      const areaId = await createArea(asOwner, 'Backend');
      await createIssue(asOwner, columnId, { folderId: areaId });
      const viewId = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'Board' }))
        .data!.id;
      const token = (await asOwner.views({ viewId }).share.post()).data!.token;

      const shared = await api.share.view({ token }).get();
      expect(shared.data.issues[0].folderId).toBeNull();
      expect(shared.data.project.areas).toEqual([]);

      await asOwner.views({ viewId }).share.post({ extended: true });
      const extended = await api.share.view({ token }).get();
      expect(extended.data.issues[0].folderId).toBe(areaId);
      expect(extended.data.project.areas).toMatchObject([{ id: areaId, name: 'Backend' }]);
    });
  });
});
