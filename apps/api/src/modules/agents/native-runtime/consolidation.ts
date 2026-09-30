import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  aiAgent,
  db,
  helenaFact,
  helenaFactEntity,
  helenaFactEntityLink,
  projectMember,
} from '@repo/db';
import {
  contradictionOf,
  extractEntities,
  looksSecret,
  sameFact,
  type FactRow,
} from '@helena/facts';
import { registerSystemJob, type SystemJobContext } from '#modules/engine/system-jobs';
import { memoryBaseline } from '../memory/service';
import { nativeRuntimeEnabled, normalizeRuntimePolicy } from '../core/service';
import { agentContextLimits } from '../core/context-limits';
import { listNotes, noteFile, proposeMemory } from './memory';

export function consolidateNotes(
  baseline: string,
  notes: string[],
  facts: FactRow[],
  limit = 2200,
) {
  const lines = baseline.trim() ? [baseline.trim()] : [];
  const known = new Set(
    baseline.split('\n').map((line) =>
      line
        .replace(/^[-*]\s*/, '')
        .trim()
        .toLowerCase(),
    ),
  );
  let duplicates = 0;
  let conflicts = 0;
  let omitted = 0;
  for (const note of notes) {
    for (const raw of note.split('\n')) {
      const content = raw.replace(/^-\s+\d{2}:\d{2}\s+/, '').trim();
      if (!content) continue;
      if (looksSecret(content)) {
        omitted++;
        continue;
      }
      const candidate: FactRow = {
        id: 0,
        content,
        entities: extractEntities(content),
        category: 'memory',
        trust: 0.5,
        updatedAt: new Date(0),
        hrr: null,
      };
      if (
        known.has(content.toLowerCase()) ||
        facts.some(
          (fact) =>
            fact.content.trim().toLowerCase() === content.toLowerCase() ||
            sameFact(candidate, fact),
        )
      ) {
        duplicates++;
        continue;
      }
      if (facts.some((fact) => contradictionOf(candidate, fact))) {
        conflicts++;
        continue;
      }
      if ([...lines, `- ${content}`].join('\n').length > limit) {
        omitted++;
        continue;
      }
      lines.push(`- ${content}`);
      known.add(content.toLowerCase());
      facts = [...facts, candidate];
    }
  }
  return { content: lines.join('\n'), duplicates, conflicts, omitted };
}

export async function consolidateAgentMemory(agentId: number, now = new Date()) {
  const [agent] = await db.select().from(aiAgent).where(eq(aiAgent.id, agentId));
  if (!agent || normalizeRuntimePolicy(agent.runtimePolicy).runtime !== 'helena') return null;
  const projects = await db
    .select({ id: projectMember.projectId })
    .from(projectMember)
    .where(eq(projectMember.userId, agent.userId));
  const rows = await db
    .select({
      id: helenaFact.id,
      content: helenaFact.content,
      category: helenaFact.category,
      trust: helenaFact.trust,
      updatedAt: helenaFact.updatedAt,
      entities: sql<
        string[]
      >`coalesce((select array_agg(${helenaFactEntity.name}) from ${helenaFactEntityLink} join ${helenaFactEntity} on ${helenaFactEntity.id} = ${helenaFactEntityLink.entityId} where ${helenaFactEntityLink.factId} = ${helenaFact.id}), '{}')`,
    })
    .from(helenaFact)
    .where(
      and(
        eq(helenaFact.teamId, agent.teamId),
        isNull(helenaFact.deletedAt),
        or(
          projects.length
            ? inArray(
                helenaFact.projectId,
                projects.map((project) => project.id),
              )
            : undefined,
          agent.agentRole === 'home' ? isNull(helenaFact.projectId) : undefined,
        ) ?? sql`false`,
      ),
    );
  const facts: FactRow[] = rows.map((row) => ({ ...row, hrr: null }));
  const before =
    (await memoryBaseline(agentId)).find((file) => file.file === 'MEMORY.md')?.content ?? '';
  const today = noteFile(now).slice(6, -3);
  const notes = (await listNotes(agentId, 200)).filter((note) => note.day < today).reverse();
  const result = consolidateNotes(
    before,
    notes.map((note) => note.content),
    facts,
    (await agentContextLimits(agentId)).memory,
  );
  if (result.content.trim() === before.trim()) return { ...result, status: 'unchanged' };
  return {
    ...result,
    ...(await proposeMemory(
      agentId,
      'MEMORY.md',
      result.content,
      createHash('sha256').update(before).digest('hex'),
    )),
  };
}

export async function runMemoryConsolidation(context: SystemJobContext): Promise<void> {
  const now = await context.step('date', async () =>
    (context.scheduledFor ?? new Date()).toISOString(),
  );
  const agents = await context.step('agents', async () =>
    (await db.select({ id: aiAgent.id, policy: aiAgent.runtimePolicy }).from(aiAgent))
      .filter((agent) => normalizeRuntimePolicy(agent.policy).runtime === 'helena')
      .map((agent) => agent.id),
  );
  for (const agentId of agents) {
    await context.step(`memory:${agentId}`, () => consolidateAgentMemory(agentId, new Date(now)));
  }
}

registerSystemJob({
  id: 'helena.memory-consolidation',
  schedule: async () => ({
    enabled: nativeRuntimeEnabled(),
    cron: '0 3 * * *',
    timezone: 'Europe/Berlin',
  }),
  run: runMemoryConsolidation,
});
