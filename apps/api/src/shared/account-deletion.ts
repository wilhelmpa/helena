import { db, user } from '@repo/db';
import { eq } from 'drizzle-orm';
import { transferDepartingAssignee } from '#modules/issues/responsibility';

export async function deleteAccount(userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update');
    await transferDepartingAssignee(tx, userId);
    const deleted = await tx.delete(user).where(eq(user.id, userId)).returning({ id: user.id });
    return deleted.length > 0;
  });
}
