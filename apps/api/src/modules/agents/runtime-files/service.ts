import { aiAgent, db } from '@repo/db';
import { and, eq } from 'drizzle-orm';

import { HttpError } from '#shared/lib';
import {
  getAgentById,
  normalizeRuntimePolicy,
  type AgentRuntimePolicy,
  type AgentScope,
  agentVisibility,
} from '../core/service';
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
  visibleTo?: AgentScope,
): Promise<AgentRuntimeFile[] | null> {
  const agent = await getAgentById(agentId, teamId, visibleTo);
  if (!agent) return null;
  return sorted(agent.runtimePolicy.files);
}

async function mutateAgentRuntimeFiles(
  agentId: number,
  teamId: number,
  visibleTo: AgentScope | undefined,
  mutate: (files: AgentRuntimeFile[]) => AgentRuntimeFile[],
): Promise<AgentRuntimeFile[] | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ runtimePolicy: aiAgent.runtimePolicy })
      .from(aiAgent)
      .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId), agentVisibility(visibleTo)))
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
  visibleTo: AgentScope | undefined,
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
  visibleTo: AgentScope | undefined,
  path: string,
): Promise<AgentRuntimeFile[] | null> {
  validatePath(path);
  return mutateAgentRuntimeFiles(agentId, teamId, visibleTo, (files) => {
    if (!files.some((file) => file.path === path))
      throw new HttpError(404, 'Runtime file not found');
    return files.filter((file) => file.path !== path);
  });
}
