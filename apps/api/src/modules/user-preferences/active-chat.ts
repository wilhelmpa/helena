import { agentChatThread, db, volitionActiveChat } from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';
import { getMembership } from '#modules/members/service';
import { getProjectByKey } from '#modules/projects/service';
import { HttpError } from '#shared/lib';

export interface ActiveChatLocation {
  agentId: number | null;
  threadId: string | null;
}

async function scopeProjectId(scope: string, userId: string): Promise<number | null> {
  if (scope === 'home') return null;
  if (!scope.startsWith('project:')) throw new HttpError(400, 'Invalid chat scope');
  const key = scope.slice('project:'.length);
  const project = key ? await getProjectByKey(key) : null;
  if (!project || !(await getMembership(project.id, userId))) {
    throw new HttpError(404, 'Project not found');
  }
  return project.id;
}

async function validThread(
  threadId: string,
  userId: string,
  projectId: number | null,
): Promise<ActiveChatLocation | null> {
  const [thread] = await db
    .select({
      agentId: agentChatThread.agentId,
      projectId: agentChatThread.projectId,
      deletedAt: agentChatThread.deletedAt,
    })
    .from(agentChatThread)
    .where(and(eq(agentChatThread.id, threadId), eq(agentChatThread.userId, userId)));
  if (!thread || thread.deletedAt || (projectId != null && thread.projectId !== projectId)) {
    return null;
  }
  if (thread.projectId != null && !(await getMembership(thread.projectId, userId))) return null;
  return { agentId: thread.agentId, threadId };
}

export async function getActiveChat(userId: string, scope: string): Promise<ActiveChatLocation> {
  const projectId = await scopeProjectId(scope, userId);
  const [saved] = await db
    .select({ threadId: volitionActiveChat.threadId, agentId: volitionActiveChat.agentId })
    .from(volitionActiveChat)
    .where(and(eq(volitionActiveChat.userId, userId), eq(volitionActiveChat.scope, scope)));
  if (!saved?.threadId) return { agentId: saved?.agentId ?? null, threadId: null };
  const valid = await validThread(saved.threadId, userId, projectId);
  if (valid) return valid;
  await db
    .update(volitionActiveChat)
    .set({ threadId: null, agentId: null })
    .where(
      and(
        eq(volitionActiveChat.userId, userId),
        eq(volitionActiveChat.scope, scope),
        eq(volitionActiveChat.threadId, saved.threadId),
      ),
    );
  return { agentId: null, threadId: null };
}

export async function setActiveChat(
  userId: string,
  scope: string,
  location: ActiveChatLocation,
): Promise<ActiveChatLocation> {
  const projectId = await scopeProjectId(scope, userId);
  let next = location;
  if (location.threadId) {
    const valid = await validThread(location.threadId, userId, projectId);
    if (!valid || (location.agentId != null && valid.agentId !== location.agentId)) {
      throw new HttpError(404, 'Chat not found');
    }
    next = valid;
  }
  await db
    .insert(volitionActiveChat)
    .values({ userId, scope, ...next })
    .onConflictDoUpdate({
      target: [volitionActiveChat.userId, volitionActiveChat.scope],
      set: { ...next, updatedAt: sql`now()` },
    });
  return next;
}
