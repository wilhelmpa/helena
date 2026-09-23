import { db, projectMailAccount } from '@repo/db';
import { eq } from 'drizzle-orm';
import { mailAccounts } from '#modules/connections/service';

export async function getProjectMailAccount(projectId: number) {
  const [assignment] = await db
    .select({ provider: projectMailAccount.provider, account: projectMailAccount.account })
    .from(projectMailAccount)
    .where(eq(projectMailAccount.projectId, projectId))
    .limit(1);
  if (!assignment) return null;

  try {
    const snapshot = await mailAccounts();
    const live = snapshot.accounts.find(
      (candidate) => candidate.account.toLowerCase() === assignment.account.toLowerCase(),
    );
    return {
      provider: 'gmail' as const,
      account: assignment.account,
      assignmentStatus: 'configured' as const,
      connectionStatus: live?.status ?? ('unavailable' as const),
      lastCheckedAt: live?.lastCheckedAt ?? null,
      lastError: live?.lastError ?? null,
    };
  } catch {
    return {
      provider: 'gmail' as const,
      account: assignment.account,
      assignmentStatus: 'configured' as const,
      connectionStatus: 'unavailable' as const,
      lastCheckedAt: null,
      lastError: null,
    };
  }
}
