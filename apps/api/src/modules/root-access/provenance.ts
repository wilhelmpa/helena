import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { projectRoot } from '#modules/project-files/roots';
import { toolsFullyObserved } from '@helena/sdk';
import { aiAgent, agentRun, agentChatMessage, db, user, project } from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { taintSourcesOf } from './policy';

// Runtime headers are hints; authorization uses the work's database observation.
export type Work = {
  runtime?: string;
  runId?: number | null;
  messageId?: number | null;
  ownerTerminal?: boolean;
};

export async function ownerOrigin(agentId: number, userId: string): Promise<string> {
  const [owner] = await db
    .select({ id: user.id })
    .from(aiAgent)
    .innerJoin(user, eq(user.id, aiAgent.ownerUserId))
    .where(and(eq(aiAgent.id, agentId), eq(user.id, userId), eq(user.role, 'god')));
  return owner ? 'owner-direct' : 'system';
}

export async function workProvenance(agentId: number, work: Work) {
  if (work.ownerTerminal)
    return {
      origin: 'owner-direct',
      runtime: work.runtime ?? 'unknown',
      taintSources: ['owner-terminal', 'unobserved-terminal-history'],
    };
  if (!!work.runId === !!work.messageId)
    throw new HttpError(400, 'Exactly one active run or chat answer is required');
  const table = work.runId ? agentRun : agentChatMessage;
  const [row] = await db
    .select({
      origin: table.rootOrigin,
      runtime: table.observedRuntime,
      taintSources: table.taintSources,
      status: table.status,
      startedAt: table.startedAt,
      nextAttemptAt: table.nextAttemptAt,
    })
    .from(table)
    .where(and(eq(table.id, (work.runId ?? work.messageId)!), eq(table.agentId, agentId)));
  if (
    !row?.startedAt ||
    row.nextAttemptAt.getTime() <= Date.now() ||
    !['pending', 'streaming'].includes(row.status)
  )
    throw new HttpError(409, 'This work is not running');
  return row;
}

export async function observeTool(
  agentId: number,
  _work: Work,
  tool: string,
  externalMcp = false,
  file?: { path?: string; workspace?: string },
) {
  let path: string | undefined;
  let workspaceRoots: string[] | undefined;
  if (file?.path && (file.path.startsWith('/') || file.workspace?.startsWith('/'))) {
    path = await realpath(resolve(file.workspace ?? '/', file.path)).catch(() => undefined);
    const projects = await db
      .select({ key: project.key })
      .from(project)
      .innerJoin(aiAgent, eq(aiAgent.teamId, project.teamId))
      .where(eq(aiAgent.id, agentId));
    workspaceRoots = await Promise.all(
      projects.map((p) => realpath(projectRoot(p.key, 'code').directory).catch(() => '')),
    );
    workspaceRoots = workspaceRoots.filter(Boolean);
  }
  const sources = taintSourcesOf({ tool, externalMcp, path, workspaceRoots });
  if (!sources.length) return;
  sources.push(`tool:${tool.slice(0, 200)}`);
  // A missing work header must not hide a read from a concurrent root request.
  for (const table of [agentRun, agentChatMessage]) {
    await db
      .update(table)
      .set({
        taintSources: sql`(
      select coalesce(jsonb_agg(distinct source), '[]'::jsonb)
      from jsonb_array_elements_text(${table.taintSources} || ${JSON.stringify(sources)}::jsonb) source
    )`,
      })
      .where(and(eq(table.agentId, agentId), sql`${table.status} in ('pending', 'streaming')`));
  }
}

export async function inheritedChatTaint(threadId: string, attached: boolean): Promise<string[]> {
  const rows = await db
    .select({ sources: agentChatMessage.taintSources, runtime: agentChatMessage.observedRuntime })
    .from(agentChatMessage)
    .where(and(eq(agentChatMessage.threadId, threadId), eq(agentChatMessage.role, 'assistant')));
  return [
    ...new Set([
      ...(attached ? ['attached-content'] : []),
      ...rows.flatMap((row) => [
        ...row.sources,
        ...(!toolsFullyObserved(row.runtime ?? '') ? ['unobserved-history'] : []),
      ]),
    ]),
  ];
}

export function workFromHeaders(agentId: number, headers: Headers): Work {
  const runId = Number(headers.get('x-helena-run')) || null;
  const messageId = Number(headers.get('x-volition-message')) || null;
  for (const id of [runId, messageId])
    if (id != null && (!Number.isSafeInteger(id) || id <= 0))
      throw new HttpError(400, 'Invalid work identifier');
  const unit = headers.get('x-volition-agent-unit');
  if (unit) {
    const match = /--a(\d+)-([rc])(\d+)-[a-f0-9]+\.service$/.exec(unit);
    const homeUnit = /-home--a0-/.test(unit);
    if (!match || (Number(match[1]) !== agentId && !homeUnit) || Number(match[3]) <= 0)
      throw new HttpError(403, 'The root request must belong to its launcher unit');
    const work = match[2] === 'r' ? { runId: Number(match[3]) } : { messageId: Number(match[3]) };
    if ((runId && runId !== work.runId) || (messageId && messageId !== work.messageId))
      throw new HttpError(403, 'The work header differs from its launcher unit');
    return { ...work, runtime: headers.get('x-volition-agent-runtime') ?? 'unknown' };
  }
  return { runId, messageId, runtime: 'unknown' };
}
