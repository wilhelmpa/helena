import { t } from 'elysia';
import { HOME_ROOTS, PROJECT_ROOTS } from './roots';

const filePath = t.String({ maxLength: 1024 });
const projectRootName = t.Optional(t.UnionEnum([...PROJECT_ROOTS]));
const homeRootName = t.UnionEnum([...HOME_ROOTS]);

export const projectFilesQuery = t.Object({
  root: projectRootName,
  path: t.Optional(filePath),
});

export const homeFilesQuery = t.Object({
  root: homeRootName,
  path: t.Optional(filePath),
});

export const projectRawQuery = t.Object({
  root: projectRootName,
  path: filePath,
  download: t.Optional(t.String()),
});

export const homeRawQuery = t.Object({
  root: homeRootName,
  path: filePath,
  download: t.Optional(t.String()),
});

export const projectEntryQuery = t.Object({ path: filePath });
export const homeEntryQuery = t.Object({ root: homeRootName, path: filePath });
export const homeRootQuery = t.Object({ root: homeRootName });

export const createTextBody = t.Object({
  path: t.String({ minLength: 1, maxLength: 1024 }),
  content: t.String({ maxLength: 262144 }),
});

export const createFolderBody = t.Object({ path: t.String({ minLength: 1, maxLength: 1024 }) });

export const moveBody = t.Object({
  from: t.String({ minLength: 1, maxLength: 1024 }),
  to: t.String({ minLength: 1, maxLength: 1024 }),
});

export const uploadBody = t.Object({ files: t.Files({ minItems: 1, maxItems: 50 }) });

export const FileItemResponse = t.Object({
  name: t.String(),
  path: t.String(),
  kind: t.Union([t.Literal('folder'), t.Literal('file')]),
  sizeBytes: t.Nullable(t.Number()),
  contentType: t.Nullable(t.String()),
  updatedAt: t.Nullable(t.String()),
});

export const FileListResponse = t.Object({
  root: t.String(),
  path: t.String(),
  vaultPath: t.Nullable(t.String()),
  absolutePath: t.String(),
  writable: t.Boolean(),
  truncated: t.Boolean(),
  items: t.Array(FileItemResponse),
});

export const FileTextResponse = t.Object({
  path: t.String(),
  content: t.String(),
  sizeBytes: t.Number(),
  etag: t.String(),
});

export const FilePathResponse = t.Object({ path: t.String() });
export const FileItemsResponse = t.Array(FileItemResponse);
