import { Elysia, type DocumentDecoration } from 'elysia';
import { isAgentUser } from '#modules/agents/core/service';
import { authContext } from '#shared/auth-context';
import { assertPermission, requireUser } from '#shared/access';
import { assertMcpAllowed, requiresPermission } from '#shared/guards';
import { HttpError } from '#shared/lib';
import { DECIDE_PERMISSION, getApprovalAccess } from './service';

export const approvalGuards = new Elysia({ name: 'approval-guards' }).use(authContext).macro({
  approval(action: 'read' | 'decide') {
    return {
      ...(action === 'decide'
        ? { detail: requiresPermission(DECIDE_PERMISSION) as DocumentDecoration }
        : {}),
      async resolve({ params, user, request }) {
        const approvalId = Number((params as { approvalId: string }).approvalId);
        const access = await getApprovalAccess(approvalId);
        if (!access) throw new HttpError(404, 'Approval request not found');
        const callerId = requireUser(user).id;
        if (action === 'decide' || access.agentUserId !== callerId)
          await assertPermission(access.projectId, user, ...DECIDE_PERMISSION);
        if (action === 'decide' && (await isAgentUser(callerId)))
          throw new HttpError(403, 'Only a person can decide an approval request');
        await assertMcpAllowed(access.projectId, request.headers);
        return { approvalId };
      },
    };
  },
});
