import { Elysia, type DocumentDecoration } from 'elysia';
import { getCallingAgent } from '#modules/approvals/service';
import { getIssueProjectId } from '#modules/issues/service';
import { getProjectById } from '#modules/projects/service';
import { authContext } from '#shared/auth-context';
import {
  assertMcpEnabled,
  assertPermission,
  requireProjectAccess,
  requireUser,
} from '#shared/access';
import { requiresPermission } from '#shared/guards';
import { HttpError } from '#shared/lib';
import { isMcpRequest } from '#shared/mcp-request';
import type { PermissionAction } from '#shared/permissions';
import { assertMailAccess, mailScope, threadAccess } from './access';
import { draftAccess } from './drafts/service';
import { attachmentThreadId, messageThreadId } from './threads/service';

const byId = (params: unknown, key: string) => Number((params as Record<string, string>)[key]);

// The guards of the mail routes. Each resolves the mail row a route addresses and
// asserts that the caller reaches its project (see access.ts).
export const mailGuards = new Elysia({ name: 'mail-guards' }).use(authContext).macro({
  mailTriage(_enabled: boolean) {
    return {
      detail: { 'x-permission': ['mail', 'triage'] } as DocumentDecoration,
      async resolve({ params, user, request }) {
        const project = await requireProjectAccess(
          (params as { projectKey: string }).projectKey,
          user,
        );
        await assertMailAccess(project.teamId, project.id, user, 'triage', request.headers);
        return { project };
      },
    };
  },
  // The mail of a :teamId the caller may reach with the action.
  mailTeam(action: PermissionAction) {
    return {
      detail: requiresPermission(['mail', action]) as DocumentDecoration,
      async resolve({ params, user }) {
        const teamId = byId(params, 'teamId');
        return { teamId, scope: await mailScope(teamId, user, action) };
      },
    };
  },
  mailThread(action: PermissionAction) {
    return {
      detail: requiresPermission(['mail', action]) as DocumentDecoration,
      async resolve({ params, user, request }) {
        const thread = await threadAccess(byId(params, 'threadId'), user, action, request.headers);
        return { thread };
      },
    };
  },
  mailMessage(action: PermissionAction) {
    return {
      detail: requiresPermission(['mail', action]) as DocumentDecoration,
      async resolve({ params, user, request }) {
        const threadId = await messageThreadId(byId(params, 'messageId'));
        if (threadId == null) throw new HttpError(404, 'Mail message not found');
        return { thread: await threadAccess(threadId, user, action, request.headers) };
      },
    };
  },
  mailAttachment(action: PermissionAction) {
    return {
      detail: requiresPermission(['mail', action]) as DocumentDecoration,
      async resolve({ params, user, request }) {
        const threadId = await attachmentThreadId(byId(params, 'attachmentId'));
        if (threadId == null) throw new HttpError(404, 'Attachment not found');
        return { thread: await threadAccess(threadId, user, action, request.headers) };
      },
    };
  },
  mailDraft(action: PermissionAction) {
    return {
      detail: requiresPermission(['mail', action]) as DocumentDecoration,
      async resolve({ params, user, request }) {
        const draft = await draftAccess(byId(params, 'draftId'));
        if (!draft) throw new HttpError(404, 'Draft not found');
        await assertMailAccess(draft.teamId, draft.projectId, user, action, request.headers).catch(
          (error: unknown) => {
            if (error instanceof HttpError && error.status === 404)
              throw new HttpError(404, 'Draft not found');
            throw error;
          },
        );
        return { draft };
      },
    };
  },
  // A task the caller may read, and the mail they reach in its team.
  issueMail(_enabled: boolean) {
    return {
      detail: requiresPermission(['work_items', 'read']) as DocumentDecoration,
      async resolve({ params, user }) {
        const projectId = await getIssueProjectId(byId(params, 'issueId'));
        if (projectId == null) throw new HttpError(404, 'Issue not found');
        await assertPermission(projectId, user, 'work_items', 'read');
        const owner = await getProjectById(projectId);
        return { scope: await mailScope(owner!.teamId, user, 'read') };
      },
    };
  },
  // The agent calling a :projectKey route, with the mail permission of its role there.
  mailAgent(action: PermissionAction) {
    return {
      detail: requiresPermission(['mail', action]) as DocumentDecoration,
      async resolve({ params, user, request }) {
        const project = await requireProjectAccess(
          (params as { projectKey: string }).projectKey,
          user,
        );
        assertMcpEnabled(project, isMcpRequest(request.headers));
        const agent = await getCallingAgent(requireUser(user).id, project.teamId);
        if (!agent) throw new HttpError(403, 'Only an agent asks for approval to send');
        await assertMailAccess(project.teamId, project.id, user, action, request.headers);
        return { project, agent };
      },
    };
  },
});
