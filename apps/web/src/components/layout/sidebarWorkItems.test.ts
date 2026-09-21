import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { View, ViewFolder } from '@/lib/api/endpoints/views';
import { activeSidebarView, organizeSidebarViews } from './sidebarWorkItems';

const view = (id: number, name: string, folderId: number | null, position: number) =>
  ({ id, name, folderId, position }) as View;

describe('sidebar work items', () => {
  it('groups named views in one-level folders and keeps their stored order', () => {
    const folders = [
      { id: 7, name: 'Delivery', position: 0 },
      { id: 8, name: 'Archive', position: 1 },
    ] as ViewFolder[];
    const organized = organizeSidebarViews(
      [view(3, 'Later', 7, 2), view(1, 'Kanban', null, 0), view(2, 'Soon', 7, 1)],
      folders,
    );

    assert.deepEqual(
      organized.root.map((entry) => entry.name),
      ['Kanban'],
    );
    assert.deepEqual(
      organized.folders.map((entry) => entry.folder.name),
      ['Delivery', 'Archive'],
    );
    assert.deepEqual(
      organized.folders[0].views.map((entry) => entry.name),
      ['Soon', 'Later'],
    );
  });

  it('marks only the exact saved-view route active', () => {
    const views = [view(12, 'Mail', null, 0), view(21, 'Tasks', null, 1)];
    assert.equal(activeSidebarView('PRIV', '/project/PRIV/view/12', views)?.id, 12);
    assert.equal(activeSidebarView('PRIV', '/project/PRIV/view/120', views), null);
    assert.equal(activeSidebarView('PRIV', '/project/PRIV/issue/12', views), null);
  });
});
