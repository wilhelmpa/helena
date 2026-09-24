import { aiAgent, db } from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';

import { HttpError } from '#shared/lib';
import { getAgentById, normalizeRuntimePolicy, type AgentRuntimePolicy } from '../core/service';
import { runtimeFileKind } from './paths';

export type AgentRuntimeFile = AgentRuntimePolicy['files'][number];

function sorted(files: AgentRuntimeFile[]): AgentRuntimeFile[] {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}

function validatePath(path: string): { path: string; kind: AgentRuntimeFile['kind'] } {
  const kind = runtimeFileKind(path);
  if (!kind) {
    throw new HttpError(400, 'Runtime file path must be SOUL.md or Markdown below instructions/');
  }
  return { path, kind };
}

export async function listAgentRuntimeFiles(
  agentId: number,
  teamId: number,
  visibleTo?: string,
): Promise<AgentRuntimeFile[] | null> {
  const agent = await getAgentById(agentId, teamId, visibleTo);
  if (!agent) return null;
  return sorted(agent.runtimePolicy.files);
}

async function mutateAgentRuntimeFiles(
  agentId: number,
  teamId: number,
  visibleTo: string | undefined,
  mutate: (files: AgentRuntimeFile[]) => AgentRuntimeFile[],
): Promise<AgentRuntimeFile[] | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ runtimePolicy: aiAgent.runtimePolicy })
      .from(aiAgent)
      .where(
        and(
          eq(aiAgent.id, agentId),
          eq(aiAgent.teamId, teamId),
          visibleTo == null
            ? undefined
            : sql`exists (select 1 from project_member pm join project_member mine on mine.project_id = pm.project_id and mine.user_id = ${visibleTo} where pm.user_id = ${aiAgent.userId})`,
        ),
      )
      .for('update');
    if (!row) return null;
    const policy = normalizeRuntimePolicy(row.runtimePolicy);
    const files = sorted(mutate(policy.files));
    await tx
      .update(aiAgent)
      .set({ runtimePolicy: { ...policy, files } })
      .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId)));
    return files;
  });
}

export async function upsertAgentRuntimeFile(
  agentId: number,
  teamId: number,
  visibleTo: string | undefined,
  path: string,
  content: string,
): Promise<AgentRuntimeFile[] | null> {
  const file = { ...validatePath(path), content };
  return mutateAgentRuntimeFiles(agentId, teamId, visibleTo, (files) => {
    const remaining = files.filter((existing) => existing.path !== file.path);
    if (remaining.length >= 32)
      throw new HttpError(400, 'An agent may have at most 32 runtime files');
    return [...remaining, file];
  });
}

export async function deleteAgentRuntimeFile(
  agentId: number,
  teamId: number,
  visibleTo: string | undefined,
  path: string,
): Promise<AgentRuntimeFile[] | null> {
  validatePath(path);
  return mutateAgentRuntimeFiles(agentId, teamId, visibleTo, (files) => {
    if (!files.some((file) => file.path === path))
      throw new HttpError(404, 'Runtime file not found');
    return files.filter((file) => file.path !== path);
  });
}
