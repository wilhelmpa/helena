import { t } from 'elysia';

export const projectFilesQuery = t.Object({
  path: t.Optional(t.String({ maxLength: 1024 })),
});

export const ProjectFileItemResponse = t.Object({
  name: t.String(),
  path: t.String(),
  kind: t.Union([t.Literal('folder'), t.Literal('file')]),
  sizeBytes: t.Nullable(t.Number()),
  contentType: t.Nullable(t.String()),
  updatedAt: t.Nullable(t.String()),
  previewable: t.Boolean(),
});

export const ProjectFileListResponse = t.Object({
  project: t.String(),
  path: t.String(),
  items: t.Array(ProjectFileItemResponse),
});

export const ProjectFileTextResponse = t.Object({
  project: t.String(),
  path: t.String(),
  content: t.String(),
  sizeBytes: t.Number(),
  etag: t.Optional(t.String()),
});

export const createProjectTextBody = t.Object({
  path: t.String({ minLength: 1, maxLength: 1024 }),
  content: t.String({ maxLength: 262144 }),
});

export const ProjectFileCreatedResponse = t.Object({
  project: t.String(),
  path: t.String(),
  created: t.Literal(true),
});
