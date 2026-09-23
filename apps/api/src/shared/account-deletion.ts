import { db, user } from '@repo/db';
import { eq } from 'drizzle-orm';

export async function deleteAccount(userId: string): Promise<boolean> {
  const deleted = await db.delete(user).where(eq(user.id, userId)).returning({ id: user.id });
  return deleted.length > 0;
}
