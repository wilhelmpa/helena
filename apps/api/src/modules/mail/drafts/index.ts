import { Elysia, t } from 'elysia';
import { mcpTool } from '#mcp/generate';
import { isAgentUser } from '#modules/agents/core/service';
import { createApprovalRequest } from '#modules/approvals/service';
import { getIssueProjectId } from '#modules/issues/service';
import { getProjectByKey } from '#modules/projects/service';
import { assertPermission, requireUser } from '#shared/access';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { noContent } from '#shared/http';
import { HttpError } from '#shared/lib';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { inScope, mailScope, threadAccess } from '../access';
import { mailGuards } from '../guards';
import { resolveProjectThreadId } from '../threads/resolve';
import {
  DraftListResponse,
  DraftResponse,
  SendRequestResponse,
  createDraftBody,
  draftParams,
  draftReplyBody,
  draftReplyParams,
  projectDraftParams,
  teamParams,
  updateDraftBody,
  uploadDraftAttachmentBody,
  vaultAttachmentBody,
} from './model';
import {
  accountRow,
  attachVaultFile,
  createDraft,
  deleteDraft,
  draftAccess,
  draftForApproval,
  getDraft,
  latestThreadMessage,
  listOpenDrafts,
  markPendingApproval,
  messageRow,
  queueDraft,
  undoSend,
  updateDraft,
  uploadAttachment,
} from './service';

// Writing mail: drafts, their attachments, sending with a short undo time, and the
// draft and send-request tools of an agent. An agent never sends: it asks for an
// approval, and the worker sends once a person approved it.
export const mailDraftRoutes = new Elysia({
  name: 'mail-drafts',
  detail: { tags: ['Mail'] },
})
  .use(authContext)
  .use(guards)
  .use(mailGuards)
  .get('/teams/:teamId/mail/drafts', ({ teamId, scope }) => listOpenDrafts(teamId, scope), {
    mailTeam: 'create',
    params: teamParams,
    response: { 200: DraftListResponse, ...accessErrors },
    detail: {
      summary: 'List the open mail drafts',
      description: 'Drafts being written, waiting for approval, failed or in their undo time.',
    },
  })
  .post(
    '/teams/:teamId/mail/drafts',
    async ({ teamId, scope, body, user, request, set }) => {
      const message = body.messageId ? await messageRow(body.messageId) : null;
      if (body.mode !== 'new' && !message)
        throw new HttpError(400, 'Name the message to answer or forward');
      if (message) {
        if (message.teamId !== teamId) throw new HttpError(404, 'Mail message not found');
        await threadAccess(message.threadId, user, 'create', request.headers);
      }
      const accountId = body.accountId ?? message?.accountId;
      if (!accountId) throw new HttpError(400, 'Choose the account to send from');
      if (accountId !== message?.accountId) {
        const account = await accountRow(teamId, accountId);
        if (!inScope(scope, account.projectId))
          throw new HttpError(403, 'You do not have permission to send from this account');
      }
      if (body.issueId) {
        const projectId = await getIssueProjectId(body.issueId);
        if (projectId == null) throw new HttpError(404, 'Issue not found');
        await assertPermission(projectId, user, 'work_items', 'read');
      }
      set.status = 201;
      return createDraft({
        teamId,
        userId: requireUser(user).id,
        mode: body.mode,
        accountId,
        message,
        issueId: body.issueId,
        to: body.to,
      });
    },
    {
      mailTeam: 'create',
      params: teamParams,
      body: createDraftBody,
      response: { 201: DraftResponse, ...commonErrors },
      detail: {
        summary: 'Start a mail, an answer or a forward',
        description:
          'An answer or a forward is prefilled with recipients, subject, quote and forwarded attachments.',
      },
    },
  )
  .get('/mail/drafts/:draftId', ({ draft }) => getDraft(draft.id), {
    mailDraft: 'create',
    params: draftParams,
    response: { 200: DraftResponse, ...accessErrors },
    detail: {
      summary: 'Get a mail draft',
      description: 'One draft with its recipients, body and attachments.',
    },
  })
  .patch(
    '/mail/drafts/:draftId',
    async ({ draft, body, user }) => {
      if (body.accountId !== undefined) {
        const account = await accountRow(draft.teamId, body.accountId);
        const scope = await mailScope(draft.teamId, user, 'create');
        if (!inScope(scope, account.projectId))
          throw new HttpError(403, 'You do not have permission to send from this account');
      }
      return updateDraft(draft.id, body);
    },
    {
      mailDraft: 'create',
      params: draftParams,
      body: updateDraftBody,
      response: { 200: DraftResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Save a mail draft',
        description: 'Autosave of the compose panel. Attachments can only be kept or dropped here.',
      },
    },
  )
  .delete(
    '/mail/drafts/:draftId',
    async ({ draft }) => {
      await deleteDraft(draft.id);
      return noContent();
    },
    {
      mailDraft: 'create',
      params: draftParams,
      response: { 204: t.Void(), ...accessErrors, ...errors(409) },
      detail: {
        summary: 'Discard a mail draft',
        description: 'Removes the draft and its uploaded files.',
      },
    },
  )
  .post(
    '/mail/drafts/:draftId/attachments',
    async ({ draft, body, set }) => {
      if (!(body.file instanceof File))
        throw new HttpError(400, 'No file uploaded (form field "file")');
      set.status = 201;
      return uploadAttachment(draft.id, body.file);
    },
    {
      mailDraft: 'create',
      params: draftParams,
      body: uploadDraftAttachmentBody,
      response: { 201: DraftResponse, ...commonErrors, ...errors(409, 413) },
      detail: {
        summary: 'Attach an uploaded file to a draft',
        description: 'Stores the file until the mail is sent.',
      },
    },
  )
  .post(
    '/mail/drafts/:draftId/vault-attachments',
    async ({ draft, body, user, set }) => {
      const path = body.path.replace(/^\/+/, '');
      const [root, key] = path.split('/');
      const scope = await mailScope(draft.teamId, user, 'read');
      if (root === 'Projects' && key) {
        const owner = await getProjectByKey(key);
        if (!owner || owner.teamId !== draft.teamId)
          throw new HttpError(404, 'The file is not in the vault');
        await assertPermission(owner.id, user, 'documents', 'read');
      } else if (root !== 'Home' || !scope.home) {
        throw new HttpError(403, 'You do not have permission to attach this file');
      }
      set.status = 201;
      return attachVaultFile(draft.id, path);
    },
    {
      mailDraft: 'create',
      params: draftParams,
      body: vaultAttachmentBody,
      response: { 201: DraftResponse, ...commonErrors, ...errors(409, 413) },
      detail: {
        summary: 'Attach a file of the vault to a draft',
        description: 'A file of a project the caller may read, or of Home.',
      },
    },
  )
  .post(
    '/mail/drafts/:draftId/send',
    async ({ draft, user }) => {
      if (await isAgentUser(requireUser(user).id))
        throw new HttpError(403, 'An agent asks for approval to send: use request_mail_send');
      return queueDraft(draft.id);
    },
    {
      mailDraft: 'create',
      params: draftParams,
      response: { 200: DraftResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Send a mail draft',
        description: 'The worker sends it after ten seconds, the time left to undo it.',
      },
    },
  )
  .post('/mail/drafts/:draftId/undo', ({ draft }) => undoSend(draft.id), {
    mailDraft: 'create',
    params: draftParams,
    response: { 200: DraftResponse, ...accessErrors, ...errors(409) },
    detail: {
      summary: 'Take back a mail in its undo time',
      description: 'Returns a queued draft to the drafts before the worker sends it.',
    },
  })
  .post(
    '/projects/:projectKey/mail/threads/:threadId/draft-reply',
    async ({ project, params, body, user, set }) => {
      const threadId = await resolveProjectThreadId(String(params.threadId), project.id);
      const message = await latestThreadMessage(threadId, project.id);
      set.status = 201;
      return createDraft({
        teamId: project.teamId,
        userId: requireUser(user).id,
        mode: body.replyAll ? 'reply_all' : 'reply',
        accountId: message.accountId,
        message,
        body: body.body,
      });
    },
    {
      permission: ['mail', 'create'],
      params: draftReplyParams,
      body: draftReplyBody,
      response: { 201: DraftResponse, ...commonErrors },
      detail: {
        summary: 'Draft an answer to a mail thread',
        description:
          'Write an answer to the last message of a thread of this project as a draft in ' +
          'Helena. threadId accepts a Helena numeric ID or an external Gmail thread ID. ' +
          'The quoted message is added below your text. Nothing is sent: a person ' +
          'reviews the draft, or you ask for approval with `request_mail_send`.',
        ...mcpTool('draft_reply'),
      },
    },
  )
  .post(
    '/projects/:projectKey/mail/drafts/:draftId/request-send',
    async ({ project, agent, params }) => {
      const access = await draftAccess(params.draftId);
      if (!access || access.projectId !== project.id) throw new HttpError(404, 'Draft not found');
      const { row, action, details } = await draftForApproval(params.draftId);
      const issueInProject =
        row.issueId != null && (await getIssueProjectId(row.issueId)) === project.id;
      const { approval } = await createApprovalRequest({
        projectId: project.id,
        agent,
        kind: 'send',
        action,
        details,
        issueId: issueInProject ? row.issueId! : undefined,
      });
      await markPendingApproval(row.id, approval.id);
      return { draftId: row.id, approvalId: approval.id, status: 'pending_approval' as const };
    },
    {
      mailAgent: 'create',
      params: projectDraftParams,
      response: { 200: SendRequestResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Ask for approval to send a mail draft',
        description:
          'Ask a person to approve sending a draft of this project. The request shows the ' +
          'whole mail on the Approvals page. End your run afterwards: once the request is ' +
          'approved Helena sends the mail, and a rejected draft goes back to the drafts.',
        ...mcpTool('request_mail_send', undefined, 'report'),
      },
    },
  );
