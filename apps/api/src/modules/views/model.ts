import { t } from 'elysia';

export const viewParams = t.Object({ viewId: t.Numeric() });
export const viewFolderParams = t.Object({ folderId: t.Numeric() });

const folderId = t.Nullable(t.Integer({ minimum: 1 }));

export const createViewBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 100 }),
  folderId: t.Optional(folderId),
  icon: t.Optional(t.Nullable(t.String())),
  filters: t.Optional(t.Any()),
  display: t.Optional(t.Any()),
});

export const updateViewBody = t.Partial(createViewBody);

export const reorderViewsBody = t.Object({
  folderId: t.Optional(folderId),
  orderedIds: t.Array(t.Integer({ minimum: 1 })),
});

export const viewFolderBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 100 }),
});

export const reorderViewFoldersBody = t.Object({
  orderedIds: t.Array(t.Integer({ minimum: 1 })),
});

export const ViewFolderResponse = t.Object({
  id: t.Number(),
  projectId: t.Number(),
  name: t.String(),
  position: t.Number(),
  createdAt: t.String(),
});

export const ViewResponse = t.Object({
  id: t.Number(),
  projectId: t.Number(),
  folderId,
  name: t.String(),
  icon: t.Nullable(t.String()),
  filters: t.Any(),
  display: t.Any(),
  position: t.Number(),
  shareToken: t.Nullable(t.String()),
  shareExtended: t.Boolean(),
  favorite: t.Boolean(),
  createdAt: t.String(),
});
