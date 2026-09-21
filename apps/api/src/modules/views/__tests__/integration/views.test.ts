import { describe, it, expect, beforeEach } from 'bun:test';
import { db, projectProvisioningJob } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

async function setupOwnerProject() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  const project = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const defaultViews = (await asOwner.projects({ projectKey: 'MKT' }).views.get()).data!;
  for (const view of defaultViews) await asOwner.views({ viewId: view.id }).delete();
  return { asOwner, projectId: project.data!.id };
}

describe('views', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create and list', () => {
    it('backfills Kanban and List defaults idempotently without replacing an existing board', async () => {
      const { asOwner } = await setupOwnerProject();
      const scope = asOwner.projects({ projectKey: 'MKT' });
      const legacy = await scope.views.post({ name: 'Project board' });

      const [first, second] = await Promise.all([
        scope.views.defaults.post(),
        scope.views.defaults.post(),
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.data).toMatchObject([
        { id: legacy.data!.id, name: 'Kanban', display: { layout: 'kanban' } },
        { name: 'List', display: { layout: 'table' } },
      ]);
      expect(second.data).toHaveLength(2);
      const provisioning = await scope.provisioning.get();
      for (const view of second.data!) {
        expect(provisioning.data?.requestedResources).toContain(`board:${view.id}`);
      }
      await scope.views.defaults.post();
      expect((await scope.provisioning.get()).data?.id).toBe(provisioning.data?.id);
    });

    it('does not treat a filtered custom Kanban view as the all-tasks default', async () => {
      const { asOwner } = await setupOwnerProject();
      const scope = asOwner.projects({ projectKey: 'MKT' });
      const mail = await scope.views.post({
        name: 'Mail',
        filters: { conditions: [{ id: 'mail', field: 'labels', op: 'is', values: [17] }] },
        display: { layout: 'kanban' },
      });

      const views = await scope.views.defaults.post();

      expect(views.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: mail.data!.id, name: 'Mail' }),
          expect.objectContaining({ name: 'Kanban', filters: {}, display: { layout: 'kanban' } }),
          expect.objectContaining({ name: 'List', filters: {}, display: { layout: 'table' } }),
        ]),
      );
    });

    it('creates a view with default icon/filters/display and lists it', async () => {
      const { asOwner, projectId } = await setupOwnerProject();

      const created = await asOwner.projects({ projectKey: 'MKT' }).views.post({
        name: 'My issues',
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({
        name: 'My issues',
        projectId,
        icon: null,
        filters: {},
        display: {},
        position: 0,
      });
      expect(typeof created.data?.id).toBe('number');

      const list = await asOwner.projects({ projectKey: 'MKT' }).views.get();
      expect(list.status).toBe(200);
      expect(list.data).toHaveLength(1);
      expect(list.data?.[0]).toMatchObject({ name: 'My issues' });
      const provisioning = await asOwner.projects({ projectKey: 'MKT' }).provisioning.get();
      expect(provisioning.data?.requestedResources).toContain(`board:${created.data!.id}`);
    });

    it('stores icon, filters and display verbatim', async () => {
      const { asOwner } = await setupOwnerProject();
      const filters = { state: ['backlog'], assignee: [7] };
      const display = { group_by: 'state', order_by: '-created_at' };

      const created = await asOwner.projects({ projectKey: 'MKT' }).views.post({
        name: 'Backlog',
        icon: 'inbox',
        filters,
        display,
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ icon: 'inbox', filters, display });
    });

    it('appends each new view after the existing ones', async () => {
      const { asOwner } = await setupOwnerProject();

      await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'First' });
      await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'Second' });

      const list = await asOwner.projects({ projectKey: 'MKT' }).views.get();
      expect(list.data).toMatchObject([
        { name: 'First', position: 0 },
        { name: 'Second', position: 1 },
      ]);
    });

    it('keeps every board resource when views are created concurrently', async () => {
      const { asOwner } = await setupOwnerProject();
      const scope = asOwner.projects({ projectKey: 'MKT' });

      const [first, second] = await Promise.all([
        scope.views.post({ name: 'First' }),
        scope.views.post({ name: 'Second' }),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const provisioning = await scope.provisioning.get();
      expect(provisioning.data?.requestedResources).toEqual(
        expect.arrayContaining([`board:${first.data!.id}`, `board:${second.data!.id}`]),
      );
    });

    it('lists views ordered by position', async () => {
      const { asOwner } = await setupOwnerProject();
      const scope = asOwner.projects({ projectKey: 'MKT' }).views;
      const a = (await scope.post({ name: 'A' })).data!;
      const b = (await scope.post({ name: 'B' })).data!;
      const c = (await scope.post({ name: 'C' })).data!;

      const list = await scope.get();
      expect(list.data?.map((v) => v.id)).toEqual([a.id, b.id, c.id]);
    });
  });

  describe('update', () => {
    it('updates only the provided fields, replacing filters/display wholesale', async () => {
      const { asOwner } = await setupOwnerProject();
      const created = await asOwner.projects({ projectKey: 'MKT' }).views.post({
        name: 'Original',
        filters: { keep: true },
        display: { keep: true },
      });
      const id = created.data!.id;

      const patchedName = await asOwner.views({ viewId: id }).patch({ name: 'Renamed' });
      expect(patchedName.status).toBe(200);
      expect(patchedName.data).toMatchObject({
        name: 'Renamed',
        filters: { keep: true },
        display: { keep: true },
      });

      const patchedFilters = await asOwner
        .views({ viewId: id })
        .patch({ filters: { replaced: true } });
      expect(patchedFilters.status).toBe(200);
      expect(patchedFilters.data).toMatchObject({
        name: 'Renamed',
        filters: { replaced: true },
      });
    });

    it('requeues the same stable board resource when its name changes', async () => {
      const { asOwner, projectId } = await setupOwnerProject();
      const created = await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'Board' });
      const delivered = await asOwner.projects({ projectKey: 'MKT' }).provisioning.get();
      await db
        .update(projectProvisioningJob)
        .set({ status: 'succeeded', result: { resources: [] }, completedAt: new Date() })
        .where(eq(projectProvisioningJob.projectId, projectId));

      const renamed = await asOwner
        .views({ viewId: created.data!.id })
        .patch({ name: 'Renamed board' });
      expect(renamed.data).toMatchObject({ id: created.data!.id, name: 'Renamed board' });
      const provisioning = await asOwner.projects({ projectKey: 'MKT' }).provisioning.get();
      expect(provisioning.data).toMatchObject({
        status: 'pending',
        result: null,
        completedAt: null,
      });
      expect(provisioning.data?.id).not.toBe(delivered.data?.id);
      expect(provisioning.data?.requestedResources).toContain(`board:${created.data!.id}`);
    });

    it('sets and clears the icon', async () => {
      const { asOwner } = await setupOwnerProject();
      const id = (
        await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'V', icon: 'star' })
      ).data!.id;

      const cleared = await asOwner.views({ viewId: id }).patch({ icon: null });
      expect(cleared.status).toBe(200);
      expect(cleared.data).toMatchObject({ icon: null });

      const set = await asOwner.views({ viewId: id }).patch({ icon: 'flag' });
      expect(set.data).toMatchObject({ icon: 'flag' });
    });

    it('returns the current view for an empty patch', async () => {
      const { asOwner } = await setupOwnerProject();
      const id = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'V' })).data!.id;

      const patched = await asOwner.views({ viewId: id }).patch({});
      expect(patched.status).toBe(200);
      expect(patched.data).toMatchObject({ id, name: 'V' });
    });

    it('returns 404 when patching a missing view', async () => {
      const { asOwner } = await setupOwnerProject();
      const res = await asOwner.views({ viewId: 999999 }).patch({ name: 'Nope' });
      expect(res.status).toBe(404);
    });

    it('rejects a patch that sets an empty name', async () => {
      const { asOwner } = await setupOwnerProject();
      const id = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'V' })).data!.id;
      const res = await asOwner.views({ viewId: id }).patch({ name: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('reorder', () => {
    it('sets the order to the ids given', async () => {
      const { asOwner } = await setupOwnerProject();
      const a = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'A' })).data!;
      const b = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'B' })).data!;
      const c = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'C' })).data!;

      const reordered = await asOwner
        .projects({ projectKey: 'MKT' })
        .views.reorder.put({ orderedIds: [c.id, a.id, b.id] });
      expect(reordered.status).toBe(200);
      expect(reordered.data).toMatchObject([
        { id: c.id, position: 0 },
        { id: a.id, position: 1 },
        { id: b.id, position: 2 },
      ]);

      const list = await asOwner.projects({ projectKey: 'MKT' }).views.get();
      expect(list.data?.map((v) => v.id)).toEqual([c.id, a.id, b.id]);
    });

    it('rejects ids that belong to another project', async () => {
      const { asOwner } = await setupOwnerProject();
      await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
      const mkt = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'Mine' }))
        .data!;
      // The OPS project keeps its two seeded views as well as this view. None may
      // be accepted as part of an MKT reorder.
      const ops = (await asOwner.projects({ projectKey: 'OPS' }).views.post({ name: 'Theirs' }))
        .data!;

      const reordered = await asOwner
        .projects({ projectKey: 'MKT' })
        .views.reorder.put({ orderedIds: [mkt.id, ops.id] });
      expect(reordered.status).toBe(400);

      const opsList = await asOwner.projects({ projectKey: 'OPS' }).views.get();
      expect(opsList.data?.find((view) => view.id === ops.id)).toMatchObject({ position: 2 });
    });

    it('accepts an empty order when the folder has no views', async () => {
      const { asOwner } = await setupOwnerProject();
      const res = await asOwner
        .projects({ projectKey: 'MKT' })
        .views.reorder.put({ orderedIds: [] });
      expect(res.status).toBe(200);
    });
  });

  describe('folders', () => {
    it('creates, renames, reorders and deletes folders without deleting their views', async () => {
      const { asOwner } = await setupOwnerProject();
      const folders = asOwner.projects({ projectKey: 'MKT' })['view-folders'];
      const first = (await folders.post({ name: 'Delivery' })).data!;
      const second = (await folders.post({ name: 'Planning' })).data!;
      const view = (
        await asOwner.projects({ projectKey: 'MKT' }).views.post({
          name: 'Current work',
          folderId: first.id,
        })
      ).data!;

      expect(view.folderId).toBe(first.id);
      expect((await folders.reorder.put({ orderedIds: [second.id, first.id] })).data).toMatchObject(
        [
          { id: second.id, position: 0 },
          { id: first.id, position: 1 },
        ],
      );
      expect(
        (await asOwner['view-folders']({ folderId: first.id }).patch({ name: 'Build' })).data,
      ).toMatchObject({ name: 'Build' });

      await asOwner.views({ viewId: view.id }).favorite.put();
      expect((await asOwner['view-folders']({ folderId: first.id }).delete()).status).toBe(204);
      expect((await asOwner.projects({ projectKey: 'MKT' }).views.get()).data).toMatchObject([
        { id: view.id, folderId: null, favorite: true },
      ]);
    });

    it('rejects duplicate or incomplete folder and view orders', async () => {
      const { asOwner } = await setupOwnerProject();
      const scope = asOwner.projects({ projectKey: 'MKT' });
      const folderA = (await scope['view-folders'].post({ name: 'A' })).data!;
      const folderB = (await scope['view-folders'].post({ name: 'B' })).data!;
      const viewA = (await scope.views.post({ name: 'A', folderId: folderA.id })).data!;
      await scope.views.post({ name: 'B', folderId: folderA.id });

      expect(
        (await scope['view-folders'].reorder.put({ orderedIds: [folderA.id, folderA.id] })).status,
      ).toBe(400);
      expect((await scope['view-folders'].reorder.put({ orderedIds: [folderA.id] })).status).toBe(
        400,
      );
      expect(
        (
          await scope.views.reorder.put({
            folderId: folderA.id,
            orderedIds: [viewA.id],
          })
        ).status,
      ).toBe(400);
      expect(folderB.id).not.toBe(folderA.id);
    });

    it('rejects moving a view to a folder in another project', async () => {
      const { asOwner } = await setupOwnerProject();
      await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
      const foreign = (
        await asOwner.projects({ projectKey: 'OPS' })['view-folders'].post({ name: 'Foreign' })
      ).data!;
      const view = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'Local' }))
        .data!;

      expect(
        (await asOwner.views({ viewId: view.id }).patch({ folderId: foreign.id })).status,
      ).toBe(400);
    });
  });

  describe('delete', () => {
    it('deletes a view', async () => {
      const { asOwner } = await setupOwnerProject();
      const id = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'Gone' })).data!
        .id;

      const del = await asOwner.views({ viewId: id }).delete();
      expect(del.status).toBe(204);

      const list = await asOwner.projects({ projectKey: 'MKT' }).views.get();
      expect(list.data).toHaveLength(0);
    });

    it('returns 404 when deleting a missing view', async () => {
      const { asOwner } = await setupOwnerProject();
      const res = await asOwner.views({ viewId: 999999 }).delete();
      expect(res.status).toBe(404);
    });
  });

  describe('favorites', () => {
    it('marks a view favorite for the caller and clears it again', async () => {
      const { asOwner } = await setupOwnerProject();
      const id = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'V' })).data!.id;
      expect((await asOwner.projects({ projectKey: 'MKT' }).views.get()).data?.[0]).toMatchObject({
        favorite: false,
      });

      const added = await asOwner.views({ viewId: id }).favorite.put();
      expect(added.status).toBe(204);
      expect((await asOwner.projects({ projectKey: 'MKT' }).views.get()).data?.[0]).toMatchObject({
        favorite: true,
      });
      expect(await asOwner.views({ viewId: id }).patch({})).toMatchObject({
        data: { favorite: true },
      });

      const removed = await asOwner.views({ viewId: id }).favorite.delete();
      expect(removed.status).toBe(204);
      expect((await asOwner.projects({ projectKey: 'MKT' }).views.get()).data?.[0]).toMatchObject({
        favorite: false,
      });
    });

    it('keeps one row when the same view is favorited twice', async () => {
      const { asOwner } = await setupOwnerProject();
      const id = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'V' })).data!.id;

      await asOwner.views({ viewId: id }).favorite.put();
      const again = await asOwner.views({ viewId: id }).favorite.put();
      expect(again.status).toBe(204);

      await asOwner.views({ viewId: id }).favorite.delete();
      expect((await asOwner.projects({ projectKey: 'MKT' }).views.get()).data?.[0]).toMatchObject({
        favorite: false,
      });
    });

    it('unfavoriting a view that is not a favorite succeeds', async () => {
      const { asOwner } = await setupOwnerProject();
      const id = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'V' })).data!.id;

      const res = await asOwner.views({ viewId: id }).favorite.delete();
      expect(res.status).toBe(204);
    });

    it('is personal: another member does not see the owner favorite', async () => {
      const { asOwner } = await setupOwnerProject();
      const id = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'V' })).data!.id;
      await asOwner.views({ viewId: id }).favorite.put();

      const member = await signUpTestUser();
      const invite = await asOwner
        .projects({ projectKey: 'MKT' })
        .invites.post({ email: member.email, role: 'member' });
      const asMember = authedApi(member.cookie);
      await asMember.invites({ token: invite.data!.token }).accept.post();

      expect((await asMember.projects({ projectKey: 'MKT' }).views.get()).data?.[0]).toMatchObject({
        favorite: false,
      });
      expect((await asOwner.projects({ projectKey: 'MKT' }).views.get()).data?.[0]).toMatchObject({
        favorite: true,
      });
    });

    it('returns 404 for a missing view and 403 for a non-member', async () => {
      const { asOwner } = await setupOwnerProject();
      const id = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'V' })).data!.id;

      const missing = await asOwner.views({ viewId: 999999 }).favorite.put();
      expect(missing.status).toBe(404);

      const outsider = authedApi((await signUpTestUser()).cookie);
      expect((await outsider.views({ viewId: id }).favorite.put()).status).toBe(403);
      expect((await outsider.views({ viewId: id }).favorite.delete()).status).toBe(403);
    });
  });

  describe('validation', () => {
    it('rejects a view with an empty name', async () => {
      const { asOwner } = await setupOwnerProject();
      const res = await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: '' });
      expect(res.status).toBe(400);
    });

    it('rejects a non-numeric view id', async () => {
      const { asOwner } = await setupOwnerProject();
      const res = await asOwner.views({ viewId: 'abc' }).patch({ name: 'Nope' });
      expect(res.status).toBe(400);
    });
  });

  describe('access', () => {
    it('returns 404 for an unknown project', async () => {
      const { asOwner } = await setupOwnerProject();
      const res = await asOwner.projects({ projectKey: 'NOPE' }).views.get();
      expect(res.status).toBe(404);
    });

    it('denies a non-member on project-scoped and entity routes', async () => {
      const { asOwner } = await setupOwnerProject();
      const viewId = (await asOwner.projects({ projectKey: 'MKT' }).views.post({ name: 'Secret' }))
        .data!.id;

      const outsider = authedApi((await signUpTestUser()).cookie);

      // Guard-thrown 403 is not in Treaty's inferred error-status union, so assert
      // the top-level HTTP status (typed number) rather than error.status.
      const list = await outsider.projects({ projectKey: 'MKT' }).views.get();
      expect(list.status).toBe(403);

      const create = await outsider
        .projects({ projectKey: 'MKT' })
        .views.post({ name: 'Intruder' });
      expect(create.status).toBe(403);

      const patch = await outsider.views({ viewId }).patch({ name: 'Hacked' });
      expect(patch.status).toBe(403);

      const reorder = await outsider
        .projects({ projectKey: 'MKT' })
        .views.reorder.put({ orderedIds: [viewId] });
      expect(reorder.status).toBe(403);

      const del = await outsider.views({ viewId }).delete();
      expect(del.status).toBe(403);
    });
  });
});
