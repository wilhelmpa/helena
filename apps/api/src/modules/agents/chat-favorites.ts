import { db, agentChatFavorite } from '@repo/db';
import { and, eq } from 'drizzle-orm';

// The conversations a member starred (see the agent_chat_favorite comment in the
// schema). The row names the thread by id.

// How many starred conversations the favorites group shows. The group is not paginated,
// so it is bounded here.
export const FAVORITES_LIMIT = 50;

// Stars a conversation. Starring one that is already starred changes nothing; the
// caller has checked the thread is theirs.
export async function addFavorite(
  userId: string,
  agentId: number,
  threadId: string,
): Promise<void> {
  await db.insert(agentChatFavorite).values({ userId, agentId, threadId }).onConflictDoNothing();
}

export async function removeFavorite(userId: string, threadId: string): Promise<void> {
  await db
    .delete(agentChatFavorite)
    .where(and(eq(agentChatFavorite.userId, userId), eq(agentChatFavorite.threadId, threadId)));
}

// The row has no foreign key to the thread, so deleting the thread has to take it along.
export async function deleteFavorite(threadId: string): Promise<void> {
  await db.delete(agentChatFavorite).where(eq(agentChatFavorite.threadId, threadId));
}
