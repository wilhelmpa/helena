import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

describe('project templates', () => {
  beforeEach(resetDb);

  it('creates a project with reusable states, board folders, views, workflows, and provisioning resources', async () => {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    expect((await api.projects.post({ key: 'SRC', name: 'Template source' })).status).toBe(201);
    const source = await api.projects({ projectKey: 'SRC' }).get();
    const done = source.data!.columns.find((column) => column.name === 'Done')!;
    const folder = await api
      .projects({ projectKey: 'SRC' })
      ['view-folders'].post({ name: 'Delivery' });
    const view = await api.projects({ projectKey: 'SRC' }).views.post({
      name: 'Ready for release',
      folderId: folder.data!.id,
      filters: { conditions: [{ id: 'done', field: 'status', op: 'is', values: [done.id] }] },
    });
    expect(view.status).toBe(201);
    expect(
      (
        await api.projects({ projectKey: 'SRC' }).actions.post({
          name: 'Complete',
          effect: { columnId: done.id },
        })
      ).status,
    ).toBe(201);

    const captured = await api.projects({ projectKey: 'SRC' })['project-templates'].post({
      kind: 'board',
      name: 'Delivery board',
      description: 'Release workflow',
    });
    expect(captured.status).toBe(201);
    expect(captured.data).toMatchObject({ viewCount: 3, folderCount: 1, workflowCount: 1 });

    const created = await api.projects.post({
      key: 'NEW',
      name: 'From template',
      templateId: captured.data!.id,
    });
    expect(created.status).toBe(201);
    const target = await api.projects({ projectKey: 'NEW' }).get();
    const targetDone = target.data!.columns.find((column) => column.name === 'Done')!;
    const targetFolders = await api.projects({ projectKey: 'NEW' })['view-folders'].get();
    const targetViews = await api.projects({ projectKey: 'NEW' }).views.get();
    const targetActions = await api.projects({ projectKey: 'NEW' }).actions.get();
    expect(targetFolders.data).toMatchObject([{ name: 'Delivery' }]);
    expect(targetViews.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Kanban', folderId: null, display: { layout: 'kanban' } }),
        expect.objectContaining({ name: 'List', folderId: null, display: { layout: 'table' } }),
        expect.objectContaining({
          name: 'Ready for release',
          folderId: targetFolders.data![0].id,
        }),
      ]),
    );
    expect(targetActions.data).toMatchObject([
      { name: 'Complete', effect: { columnId: targetDone.id } },
    ]);

    const provisioning = await api.projects({ projectKey: 'NEW' }).provisioning.get();
    for (const targetView of targetViews.data!) {
      expect(provisioning.data?.requestedResources).toContain(`board:${targetView.id}`);
    }

    const reapplied = await api
      .projects({ projectKey: 'NEW' })
      ['project-templates']({ templateId: captured.data!.id })
      .apply.post();
    expect(reapplied.status).toBe(200);
    expect((await api.projects({ projectKey: 'NEW' }).views.get()).data).toHaveLength(3);
    expect((await api.projects({ projectKey: 'NEW' }).actions.get()).data).toHaveLength(1);
  });

  it('does not expose team templates to a project in another team', async () => {
    const owner = await signUpTestUser();
    const first = authedApi(owner.cookie);
    await first.projects.post({ key: 'ONE', name: 'First team' });
    const template = await first
      .projects({ projectKey: 'ONE' })
      ['project-templates'].post({ kind: 'project', name: 'Private' });

    const other = await signUpTestUser();
    const second = authedApi(other.cookie);
    await second.projects.post({ key: 'TWO', name: 'Second team' });
    const applied = await second
      .projects({ projectKey: 'TWO' })
      ['project-templates']({ templateId: template.data!.id })
      .apply.post();
    expect(applied.status).toBe(404);
  });
});
