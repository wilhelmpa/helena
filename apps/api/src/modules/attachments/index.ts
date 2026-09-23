import { Elysia, t } from 'elysia';
import { noContent } from '#shared/http';
import { authContext } from '#shared/auth-context';
import { entityGuard } from '#shared/guards';
import { HttpError } from '#shared/lib';
import { pinnedFetch } from '#shared/net';
import { mcpTool } from '#mcp/generate';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { getIssueProjectId } from '#modules/issues/service';
import { getStorageSettings, MB } from '#modules/settings/service';
import { ATTACHMENT_INLINE, VIEWER_INLINE } from '#modules/project-files/serve';
import { serveVaultFile } from '#modules/project-files/service';
import {
  IssueAttachmentResponse,
  IssueAttachmentListResponse,
  importAttachmentBody,
  issueParams,
  linkAttachmentBody,
  publicIdParams,
  rawAttachmentQuery,
  uploadAttachmentBody,
} from './model';
import {
  createAttachment,
  listAttachments,
  getAttachmentByPublicId,
  replaceAttachmentFile,
  deleteAttachmentByPublicId,
  removeAttachmentEmbeds,
  type AttachmentFile,
  type AttachmentRow,
} from './service';
import {
  assertAttachmentUploadAllowed,
  attachmentObjectResponse,
  safeAttachmentFilename,
} from './storage';
import {
  currentAttachmentPath,
  discardAttachmentFile,
  linkedAttachmentFile,
  purgeAttachmentFiles,
  storeAttachmentFile,
  storeReplacement,
  withFileState,
} from './vault';

// Public shape returned to the UI: never exposes the internal serial id or the
// object key. `url` is the public, no-auth download route — it can be embedded in
// an issue description and fetched by external services. `vaultPath` is where the
// file is in the vault; `missing` says it is no longer found there.
function attachmentDto(a: AttachmentRow & { missing?: boolean }) {
  return {
    id: a.publicId,
    filename: a.filename,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt,
    url: `/attachments/${a.publicId}/raw`,
    vaultPath: a.vaultPath,
    linked: a.linked,
    missing: a.missing ?? false,
  };
}

async function projectOfAttachment(publicId: string) {
  const existing = await getAttachmentByPublicId(publicId);
  return existing ? getIssueProjectId(existing.issueId) : null;
}

// Stores the file, then writes the row; a file whose row could not be written is
// removed again.
async function attach(projectId: number, issueId: number, file: AttachmentFile) {
  try {
    return await createAttachment({ projectId, issueId, ...file });
  } catch (error) {
    if (!file.linked) await discardAttachmentFile(file);
    throw error;
  }
}

// Points the row at `file`. The previous file is removed unless `file` is the same
// file written in place; a new file whose row could not be written is removed again.
async function replaceWith(
  publicId: string,
  projectId: number,
  previous: AttachmentRow,
  file: AttachmentFile,
) {
  const inPlace = file.vaultPath === previous.vaultPath;
  let replacement;
  try {
    replacement = await replaceAttachmentFile(publicId, projectId, file);
    if (!replacement) throw new HttpError(404, 'Attachment not found');
  } catch (error) {
    if (!file.linked && !inPlace) await discardAttachmentFile(file);
    throw error;
  }
  if (!inPlace) await purgeAttachmentFiles([replacement.replaced]);
  return replacement.attachment;
}

// The file of an attachment, served inline for the kinds `inline` allows.
async function attachmentFile(
  publicId: string,
  request: Request,
  download: boolean,
  inline: (contentType: string) => boolean,
) {
  const row = await getAttachmentByPublicId(publicId);
  if (!row) throw new HttpError(404, 'Attachment not found');
  if (row.s3Key) {
    return attachmentObjectResponse({
      s3Key: row.s3Key,
      contentType: row.contentType,
      filename: row.filename,
      request,
      download,
    });
  }
  const vaultPath = await currentAttachmentPath(row);
  if (!vaultPath) throw new HttpError(404, 'The file of this attachment is missing');
  return serveVaultFile({
    vaultPath,
    filename: row.filename,
    contentType: row.contentType,
    request,
    download,
    inline,
  });
}

export const attachmentRoutes = new Elysia({
  name: 'attachments',
  detail: { tags: ['Attachments'] },
})
  .use(authContext)
  // Guards for the attachment routes, keyed by how they address the work item:
  // `issueAttachment` for /issues/:issueId/attachments, `attachment` for
  // /attachments/:publicId. Both assert a work_items action on the owning project.
  // Linking a vault file also needs the documents read permission the Files page
  // asks for, since the attachment makes the file readable through the issue.
  .macro({
    issueAttachment: entityGuard('work_items', 'Issue not found', (p) =>
      getIssueProjectId(Number(p.issueId)),
    ),
    issueDocuments: entityGuard('documents', 'Issue not found', (p) =>
      getIssueProjectId(Number(p.issueId)),
    ),
    attachment: entityGuard('work_items', 'Attachment not found', (p) =>
      projectOfAttachment(p.publicId),
    ),
    attachmentDocuments: entityGuard('documents', 'Attachment not found', (p) =>
      projectOfAttachment(p.publicId),
    ),
  })
  .get(
    '/issues/:issueId/attachments',
    async ({ params }) => {
      const rows = await listAttachments(params.issueId);
      return Promise.all(rows.map(async (row) => attachmentDto(await withFileState(row))));
    },
    {
      params: issueParams,
      issueAttachment: 'read',
      response: { 200: IssueAttachmentListResponse, ...commonErrors },
      detail: {
        summary: 'List attachments',
        description:
          "List an issue's attachments by its numeric id. vaultPath is the file's path in the vault; missing is true when the file is no longer found.",
        ...mcpTool('list_attachments'),
      },
    },
  )

  // Accepts a multipart form with a single "file" field, stores the file in the
  // issue's folder of the vault, and records the metadata. Returns the attachment DTO.
  .post(
    '/issues/:issueId/attachments',
    async ({ params, body, set, projectId }) => {
      const file = body.file;
      if (!(file instanceof File)) throw new HttpError(400, 'No file uploaded (form field "file")');
      if (file.size === 0) throw new HttpError(400, 'Uploaded file is empty');

      const contentType = file.type || 'application/octet-stream';
      await assertAttachmentUploadAllowed(projectId, file.size, contentType);
      const stored = await storeAttachmentFile(
        params.issueId,
        safeAttachmentFilename(file.name),
        contentType,
        new Uint8Array(await file.arrayBuffer()),
      );
      set.status = 201;
      return attachmentDto(await attach(projectId, params.issueId, stored));
    },
    {
      body: uploadAttachmentBody,
      params: issueParams,
      issueAttachment: 'edit',
      response: { 201: IssueAttachmentResponse, ...commonErrors, ...errors(413, 502) },
      detail: { summary: 'Upload an attachment' },
    },
  )

  // Adds an attachment from a URL or inline base64, for callers that cannot send a
  // multipart file (internal agents). Exactly one of url / contentBase64 is given.
  // A URL is fetched server-side, so it is SSRF-guarded (https only in prod, no
  // private/local hosts, no redirects) and size-capped like a direct upload.
  .post(
    '/issues/:issueId/attachments/import',
    async ({ params, body, set, projectId }) => {
      const { url, contentBase64 } = body;
      if ((url == null) === (contentBase64 == null)) {
        throw new HttpError(400, 'Provide exactly one of url or contentBase64');
      }
      const limits = await getStorageSettings();

      let bytes: Buffer;
      let contentType: string;
      if (url != null) {
        let res: Response;
        try {
          res = await pinnedFetch(url, { timeoutMs: 15000 });
        } catch (err) {
          if (err instanceof HttpError) throw err;
          throw new HttpError(400, 'Could not fetch the url');
        }
        if (res.status >= 300 && res.status < 400) {
          throw new HttpError(400, 'The url redirects; provide the final url');
        }
        if (!res.ok) throw new HttpError(400, `Could not fetch the url (status ${res.status})`);
        const declared = Number(res.headers.get('content-length') ?? '');
        if (declared && declared > limits.maxAttachmentMb * MB) {
          throw new HttpError(413, `File exceeds the ${limits.maxAttachmentMb} MB limit`);
        }
        bytes = Buffer.from(await res.arrayBuffer());
        contentType =
          body.contentType ||
          res.headers.get('content-type')?.split(';')[0]?.trim() ||
          'application/octet-stream';
      } else {
        bytes = Buffer.from(contentBase64 as string, 'base64');
        if (bytes.length === 0)
          throw new HttpError(400, 'contentBase64 is empty or not valid base64');
        contentType = body.contentType || 'application/octet-stream';
      }

      if (bytes.length === 0) throw new HttpError(400, 'The file is empty');
      await assertAttachmentUploadAllowed(projectId, bytes.length, contentType);
      const stored = await storeAttachmentFile(
        params.issueId,
        safeAttachmentFilename(body.filename),
        contentType,
        bytes,
      );
      set.status = 201;
      return attachmentDto(await attach(projectId, params.issueId, stored));
    },
    {
      params: issueParams,
      body: importAttachmentBody,
      issueAttachment: 'edit',
      response: { 201: IssueAttachmentResponse, ...commonErrors, ...errors(413, 502) },
      detail: {
        summary: 'Add an attachment from a URL or base64',
        description: 'Attach a file to an issue without a multipart upload.',
        ...mcpTool('add_attachment'),
      },
    },
  )

  // Attaches a file that is in the project's vault folder already, without copying
  // it. Deleting the attachment later leaves the file where it is.
  .post(
    '/issues/:issueId/attachments/link',
    async ({ params, body, set, projectId }) => {
      const linked = await linkedAttachmentFile(params.issueId, body.path);
      set.status = 201;
      return attachmentDto(await attach(projectId, params.issueId, linked));
    },
    {
      params: issueParams,
      body: linkAttachmentBody,
      issueAttachment: 'edit',
      issueDocuments: 'read',
      response: { 201: IssueAttachmentResponse, ...commonErrors },
      detail: {
        summary: 'Link a project file to an issue',
        description:
          "Attach a file of the project's vault folder by its path relative to that folder. The file is not copied.",
      },
    },
  )

  // Swaps the file behind an attachment, keeping its publicId and so its URL:
  // an edited image (annotated, cropped) stays the same attachment and every
  // embed of it in a description shows the new version. The old file moves to the
  // trash, and the raw route serves the new bytes because it revalidates.
  .put(
    '/attachments/:publicId',
    async ({ params, body, projectId }) => {
      const existing = await getAttachmentByPublicId(params.publicId);
      if (!existing) throw new HttpError(404, 'Attachment not found');

      const file = body.file;
      if (!(file instanceof File)) throw new HttpError(400, 'No file uploaded (form field "file")');
      if (file.size === 0) throw new HttpError(400, 'Uploaded file is empty');

      const contentType = file.type || 'application/octet-stream';
      const replacedBytes = existing.linked ? 0 : existing.sizeBytes;
      await assertAttachmentUploadAllowed(projectId, file.size, contentType, replacedBytes);
      const stored = await storeReplacement(
        existing,
        safeAttachmentFilename(file.name, existing.filename),
        contentType,
        new Uint8Array(await file.arrayBuffer()),
      );
      return attachmentDto(await replaceWith(params.publicId, projectId, existing, stored));
    },
    {
      body: uploadAttachmentBody,
      attachment: 'edit',
      response: { 200: IssueAttachmentResponse, ...commonErrors, ...errors(413, 502) },
      detail: { summary: "Replace an attachment's file" },
    },
  )

  // Points an attachment whose file went missing at a file of the project's vault
  // folder. The chosen file is linked: it stays when the attachment is deleted.
  .put(
    '/attachments/:publicId/link',
    async ({ params, body, projectId }) => {
      const existing = await getAttachmentByPublicId(params.publicId);
      if (!existing) throw new HttpError(404, 'Attachment not found');
      const linked = await linkedAttachmentFile(existing.issueId, body.path);
      return attachmentDto(await replaceWith(params.publicId, projectId, existing, linked));
    },
    {
      params: publicIdParams,
      body: linkAttachmentBody,
      attachment: 'edit',
      attachmentDocuments: 'read',
      response: { 200: IssueAttachmentResponse, ...commonErrors },
      detail: { summary: 'Point an attachment at another project file' },
    },
  )

  .delete(
    '/attachments/:publicId',
    async ({ params }) => {
      const row = await deleteAttachmentByPublicId(params.publicId);
      if (!row) throw new HttpError(404, 'Attachment not found');
      // Strip any embed of this attachment from the issue description and its
      // markdown field values, so no broken image is left behind.
      await removeAttachmentEmbeds(row.issueId, row.publicId);
      // Row is already gone; a failed file removal only leaves the bytes, so don't
      // fail the request over it.
      await purgeAttachmentFiles([row]);
      return noContent();
    },
    {
      attachment: 'delete',
      response: { 204: t.Void(), ...accessErrors },
      detail: {
        summary: 'Delete an attachment',
        description:
          'Delete an attachment. Its file moves to the trash of the vault; a linked file stays where it is.',
        ...mcpTool('delete_attachment'),
      },
    },
  )

  // The file for the viewer in Plan: PDF, images, audio, video and text open inline,
  // everything else is a download.
  .get(
    '/attachments/:publicId/view',
    ({ params, query, request }) =>
      attachmentFile(params.publicId, request, query.download != null, VIEWER_INLINE),
    {
      params: publicIdParams,
      query: rawAttachmentQuery,
      attachment: 'read',
      response: { ...commonErrors },
      detail: { summary: 'Open an attachment in the viewer' },
    },
  )

  // Public download/preview URL: unauthenticated so it works in <img>/<video>
  // tags and can be fetched by external services. The publicId is an unguessable
  // uuid. `?download=1` forces a download instead of inline rendering.
  .get(
    '/attachments/:publicId/raw',
    ({ params, query, request }) =>
      attachmentFile(params.publicId, request, query.download != null, ATTACHMENT_INLINE),
    {
      params: publicIdParams,
      query: rawAttachmentQuery,
      // Public route: no 401/403. Returns a raw Response (bytes), so no typed 200
      // body — Elysia cannot validate a raw Response. Only the statuses it can throw.
      response: { ...errors(400, 404) },
      detail: { summary: 'Download or preview an attachment (public, no auth)' },
    },
  );
