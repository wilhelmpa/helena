import { aiAgent, db, projectMember, user } from '@repo/db';

// An agent with its bot user, working in the given projects, as the api creates it.
export async function insertAgent(
  teamId: number,
  username: string,
  projectIds: number[],
  kind = 'external',
): Promise<number> {
  const userId = crypto.randomUUID();
  await db
    .insert(user)
    .values({ id: userId, name: username, email: `${userId}@agents.local`, role: 'user' });
  const [agent] = await db.insert(aiAgent).values({ teamId, userId, username, kind }).returning();
  if (projectIds.length) {
    await db
      .insert(projectMember)
      .values(projectIds.map((projectId) => ({ projectId, userId, role: 'member' })));
  }
  return agent.id;
}
