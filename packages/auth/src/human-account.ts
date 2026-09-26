import { db, user, aiAgent } from '@repo/db';
import { eq, isNull } from 'drizzle-orm';

export async function isHumanAccount(userId: string): Promise<boolean> {
  const [agent] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(eq(aiAgent.userId, userId))
    .limit(1);
  return !agent;
}

export async function hasMultipleHumans(): Promise<boolean> {
  const people = await db
    .select({ id: user.id })
    .from(user)
    .leftJoin(aiAgent, eq(aiAgent.userId, user.id))
    .where(isNull(aiAgent.id))
    .limit(2);
  return people.length > 1;
}
