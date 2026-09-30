import { Elysia } from 'elysia';
import { agentChatThread, aiAgent, db, project, teamMember, projectMember } from '@repo/db';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { requireProjectAdmin, requireTeamMembership, requireUser } from '#shared/access';
import { authContext } from '#shared/auth-context';
import { HttpError } from '#shared/lib';

export const chatTrashGuard = new Elysia({ name: 'chat-trash-guard' }).use(authContext).macro({
  chatTrashAdmin(mode: 'empty' | 'single') {
    return {
      async resolve({ user, params, query, body }) {
        if (mode === 'single' && !(query as { permanent?: boolean }).permanent) return;
        const caller = requireUser(user);
        const projectKey = (body as { projectKey?: string } | undefined)?.projectKey;
        const current = projectKey ? await requireProjectAdmin(projectKey, caller) : null;
        const threadId = (params as { threadId?: string } | undefined)?.threadId;
        const rows = await db
          .selectDistinct({ teamId: aiAgent.teamId, projectKey: project.key })
          .from(agentChatThread)
          .innerJoin(aiAgent, eq(aiAgent.id, agentChatThread.agentId))
          .leftJoin(project, eq(project.id, agentChatThread.projectId))
          .where(
            and(
              eq(agentChatThread.userId, caller.id),
              isNotNull(agentChatThread.deletedAt),
              current ? eq(agentChatThread.projectId, current.id) : undefined,
              threadId ? eq(agentChatThread.id, threadId) : undefined,
            ),
          );
        if (mode === 'single' && !rows.length) throw new HttpError(404, 'Chat not found');
        if (!rows.length && !current) {
          const admins = await db
            .select({ id: teamMember.teamId })
            .from(teamMember)
            .where(
              and(eq(teamMember.userId, caller.id), inArray(teamMember.role, ['owner', 'manager'])),
            )
            .limit(1);
          const owners = await db
            .select({ id: projectMember.projectId })
            .from(projectMember)
            .where(and(eq(projectMember.userId, caller.id), eq(projectMember.role, 'owner')))
            .limit(1);
          if (!admins.length && !owners.length)
            throw new HttpError(403, 'Only an owner or manager can empty the trash');
        }
        for (const row of rows) {
          if (row.projectKey) await requireProjectAdmin(row.projectKey, caller);
          else {
            const membership = await requireTeamMembership(row.teamId, caller);
            if (!['owner', 'manager'].includes(membership.role))
              throw new HttpError(403, 'Only a team owner or manager can empty the trash');
          }
        }
      },
    };
  },
});
