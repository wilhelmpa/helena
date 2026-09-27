import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards, entityGuard } from '#shared/guards';
import { HttpError } from '#shared/lib';
import { mcpTool } from '#mcp/generate';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { requireUser } from '#shared/access';
import { knowledgeActor } from '#modules/knowledge/reach';
import { storeProjectFile } from '#modules/attachments/project-vault';
import { serveVaultFile, trashVaultFile } from '#modules/project-files/service';
import { ATTACHMENT_INLINE } from '#modules/project-files/serve';
import {
  assertAttachmentUploadAllowed,
  attachmentObjectResponse,
  safeAttachmentFilename,
  uploadContentType,
} from '#modules/attachments/storage';
import {
  ChatAttachmentContentResponse,
  ChatAttachmentResponse,
  projectKeyParams,
  publicIdParams,
  rawAttachmentQuery,
  uploadChatAttachmentBody,
} from './model';
import {
  createChatAttachment,
  getChatAttachmentByPublicId,
  getChatAttachmentProjectId,
  readChatAttachmentContent,
  chatFileState,
  type ChatAttachmentRow,
} from './service';

function chatAttachmentDto(a: ChatAttachmentRow & { missing?: boolean }) {
  return {
    id: a.publicId,
    filename: a.filename,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt,
    url: `/chat-attachments/${a.publicId}/raw`,
    vaultPath: a.vaultPath,
    missing: a.missing ?? false,
  };
}

export const chatAttachmentRoutes = new Elysia({
  name: 'chat-attachments',
  detail: { tags: ['Chat attachments'] },
})
  .use(authContext)
  .use(guards)
  .macro({
    chatAttachment: entityGuard('documents', 'Attachment not found', (p) =>
      getChatAttachmentProjectId(p.publicId),
    ),
  })
  .post(
    '/projects/:projectKey/chat-attachments',
    async ({ body, set, project, user, request }) => {
      const bytes = Buffer.from(body.contentBase64, 'base64');
      if (bytes.length === 0)
        throw new HttpError(400, 'contentBase64 is empty or not valid base64');
      const filename = safeAttachmentFilename(body.filename);
      const contentType = await uploadContentType(bytes, filename, body.contentType);
      await assertAttachmentUploadAllowed(project.id, bytes.length, contentType);
      const actor = await knowledgeActor(requireUser(user), request.headers);
      const file = await storeProjectFile(
        project.id,
        'Files/Chat Attachments',
        filename,
        bytes,
        actor,
      );
      let row;
      try {
        row = await createChatAttachment({
          projectId: project.id,
          uploadedByUserId: requireUser(user).id,
          ...file,
          contentType,
        });
      } catch (error) {
        await trashVaultFile(file.vaultPath);
        throw error;
      }
      set.status = 201;
      return chatAttachmentDto(row);
    },
    {
      body: uploadChatAttachmentBody,
      params: projectKeyParams,
      permission: ['documents', 'create'],
      feature: 'documents',
      response: { 201: ChatAttachmentResponse, ...commonErrors, ...errors(413, 502) },
      detail: {
        summary: 'Upload a chat attachment',
        description:
          'Store the original file in this project vault. PDFs and images remain unchanged; extracted text is available separately. Returns its vault path and a stable, permission-checked attachment link. Send bytes as contentBase64.',
        ...mcpTool('upload_chat_attachment', { openWorldHint: false }, 'write', 'workspace'),
      },
    },
  )
  .get(
    '/chat-attachments/:publicId',
    async ({ params }) => {
      const found = await getChatAttachmentByPublicId(params.publicId);
      if (!found) throw new HttpError(404, 'Attachment not found');
      const row = await chatFileState(found);
      return { ...chatAttachmentDto(row), ...(await readChatAttachmentContent(row)) };
    },
    {
      params: publicIdParams,
      chatAttachment: 'read',
      response: { 200: ChatAttachmentContentResponse, ...accessErrors, ...errors(400) },
      detail: {
        summary: 'Read a chat attachment',
        description:
          'Read a file identified by its chat attachment id. Its original is in the project vault at vaultPath. Returns text or table rows when available, plus a stable authenticated download URL. Scanned PDFs and images remain available as their original bytes.',
        ...mcpTool('read_chat_attachment'),
      },
    },
  )
  .get(
    '/chat-attachments/:publicId/raw',
    async ({ params, query, request }) => {
      const found = await getChatAttachmentByPublicId(params.publicId);
      if (!found) throw new HttpError(404, 'Attachment not found');
      const row = await chatFileState(found);
      if (row.vaultPath) {
        if (row.missing) throw new HttpError(404, 'The attachment file is missing');
        return serveVaultFile({
          vaultPath: row.vaultPath,
          filename: row.filename,
          contentType: row.contentType,
          request,
          download: query.download != null,
          inline: ATTACHMENT_INLINE,
        });
      }
      if (!row.s3Key) throw new HttpError(404, 'The attachment file is missing');
      return attachmentObjectResponse({
        s3Key: row.s3Key,
        filename: row.filename,
        contentType: row.contentType,
        request,
        download: query.download != null,
      });
    },
    {
      params: publicIdParams,
      query: rawAttachmentQuery,
      chatAttachment: 'read',
      response: { ...commonErrors },
      detail: { summary: 'Download a chat attachment with project file access' },
    },
  );
