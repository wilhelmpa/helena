import { db, integrationCredential, openCredential, project } from '@repo/db';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { decisionKey } from './decision-model';

export const DECISION_SOURCE_UNAVAILABLE =
  'The API key source is unavailable or invalid for this connection. Choose an API key in the same team and project (Zugänge).';

function sourceScope(teamId: number, projectId: number | null) {
  return and(
    eq(integrationCredential.teamId, teamId),
    eq(integrationCredential.integrationKey, 'api_key'),
    projectId === null
      ? isNull(integrationCredential.projectId)
      : or(isNull(integrationCredential.projectId), eq(integrationCredential.projectId, projectId)),
  );
}

// Only managers choose a source. This metadata never contains a key or grants one to an agent.
export function decisionKeySourceOptions(teamId: number, projectId: number | null) {
  return db
    .select({
      id: integrationCredential.id,
      label: integrationCredential.label,
      projectId: integrationCredential.projectId,
      projectKey: project.key,
    })
    .from(integrationCredential)
    .leftJoin(project, eq(project.id, integrationCredential.projectId))
    .where(sourceScope(teamId, projectId))
    .orderBy(asc(integrationCredential.label), asc(integrationCredential.id));
}

// Resolve anew for every call: a rotation, deletion or scope change takes effect immediately.
export async function readDecisionKeySource(
  id: unknown,
  teamId: number,
  projectId: number | null,
): Promise<string> {
  if (!Number.isSafeInteger(id) || Number(id) <= 0)
    throw new HttpError(400, DECISION_SOURCE_UNAVAILABLE);
  const [source] = await db
    .select()
    .from(integrationCredential)
    .where(and(eq(integrationCredential.id, id as number), sourceScope(teamId, projectId)));
  try {
    if (!source?.ciphertext) throw new Error();
    const key = decisionKey((JSON.parse(openCredential(source)) as { value?: unknown }).value);
    if (!key) throw new Error();
    return key;
  } catch {
    throw new HttpError(400, DECISION_SOURCE_UNAVAILABLE);
  }
}
