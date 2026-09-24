import { db, integrationCredential } from '@repo/db';
import { eq } from 'drizzle-orm';
import { getTeamMembership, runsTeam } from '#modules/teams/service';

// For a callback that arrives without a team in its path: the team of the connection, and
// whether the signed-in person runs that team.
export async function teamOfConnection(id: number): Promise<number | null> {
  const [row] = await db
    .select({ teamId: integrationCredential.teamId })
    .from(integrationCredential)
    .where(eq(integrationCredential.id, id));
  return row?.teamId ?? null;
}

export async function managesTeam(teamId: number, userId: string): Promise<boolean> {
  const standing = await getTeamMembership(teamId, userId);
  return standing ? runsTeam(standing) : false;
}
