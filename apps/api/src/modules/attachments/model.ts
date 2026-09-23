import { t } from 'elysia';

// Wire shape produced by attachmentDto (see the controller for what it omits).
export const AttachmentResponse = t.Object({
  id: t.String(),
  filename: t.String(),
  contentType: t.String(),
  sizeBytes: t.Number(),
  createdAt: t.String(),
  url: t.String(),
});

export const AttachmentListResponse = t.Array(AttachmentResponse);

// An issue attachment's file is in the vault: `vaultPath` is where, `linked` says the
// file was there before the attachment, `missing` that it is no longer found.
export const IssueAttachmentResponse = t.Composite([
  AttachmentResponse,
  t.Object({
    vaultPath: t.Nullable(t.String()),
    linked: t.Boolean(),
    missing: t.Boolean(),
  }),
]);

export const IssueAttachmentListResponse = t.Array(IssueAttachmentResponse);

export const issueParams = t.Object({ issueId: t.Numeric() });

// The public id is a UUID column. Validating its format here turns a malformed id
// into a 400 instead of letting it reach Postgres and surface as a 500.
export const publicIdParams = t.Object({ publicId: t.String({ format: 'uuid' }) });

export const uploadAttachmentBody = t.Object({ file: t.File() });

export const importAttachmentBody = t.Object({
  filename: t.String({ minLength: 1 }),
  url: t.Optional(t.String()),
  contentBase64: t.Optional(t.String()),
  contentType: t.Optional(t.String()),
});

// A path relative to the project's vault folder, as the Files page lists it.
export const linkAttachmentBody = t.Object({ path: t.String({ minLength: 1, maxLength: 1024 }) });

export const rawAttachmentQuery = t.Object({ download: t.Optional(t.String()) });
