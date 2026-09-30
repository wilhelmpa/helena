import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  aiAgent,
  appSetting,
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
import { HttpError } from '#shared/lib';
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
  let filtered = 0;
  for (const note of notes) {
    let skipEntry = false;
    for (const raw of note.split('\n')) {
      if (/^-\s+\d{2}:\d{2}\s+/.test(raw)) skipEntry = false;
      const content = raw.replace(/^-\s+\d{2}:\d{2}\s+/, '').trim();
      if (!content) continue;
      if (
        /\[compaction:[^\]]*\]|battle[ -]?(?:test|notiz)|(?:test|batch)[ -]?(?:notiz|note)|(?:INJECT|REPLACE|AFTER)-OK-\d+/i.test(
          content,
        )
      )
        skipEntry = true;
      if (skipEntry) {
        filtered++;
        continue;
      }
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
  return { content: lines.join('\n'), duplicates, conflicts, omitted, filtered };
}

async function consolidateMemory(agentId: number, now = new Date(), includeToday = false) {
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
  const notes = (await listNotes(agentId, 200))
    .filter((note) => note.day < today || (includeToday && note.day === today))
    .reverse();
  const result = consolidateNotes(
    before,
    notes.map((note) => note.content),
    facts,
    (await agentContextLimits(agentId)).memory - 1,
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

type DreamEntry = {
  startedAt: string;
  finishedAt: string | null;
  trigger: 'manual' | 'schedule';
  status: 'running' | 'succeeded' | 'failed';
  result?: {
    status: string;
    duplicates: number;
    conflicts: number;
    omitted: number;
    filtered: number;
  };
  error?: string;
};
const dreamKey = (agentId: number) => `volition.agent.${agentId}.dreams`;

export async function dreamHistory(agentId: number): Promise<DreamEntry[]> {
  const [row] = await db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, dreamKey(agentId)));
  return Array.isArray(row?.value) ? (row.value as DreamEntry[]) : [];
}

export async function consolidateAgentMemory(
  agentId: number,
  now = new Date(),
  trigger: 'manual' | 'schedule' = 'schedule',
) {
  const entry: DreamEntry = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    trigger,
    status: 'running',
  };
  const history = await db.transaction(async (tx) => {
    const [agent] = await tx
      .select({ policy: aiAgent.runtimePolicy })
      .from(aiAgent)
      .where(eq(aiAgent.id, agentId))
      .for('update');
    if (!agent) throw new HttpError(404, 'Agent not found');
    if (normalizeRuntimePolicy(agent.policy).runtime !== 'helena') {
      if (trigger === 'manual') throw new HttpError(409, 'Dreaming requires the native runtime');
      return null;
    }
    const [row] = await tx
      .select({ value: appSetting.value })
      .from(appSetting)
      .where(eq(appSetting.key, dreamKey(agentId)));
    const previous = Array.isArray(row?.value) ? (row.value as DreamEntry[]) : [];
    if (
      previous[0]?.status === 'running' &&
      Date.now() - Date.parse(previous[0].startedAt) < 3600000
    )
      throw new HttpError(409, 'Memory consolidation is already running');
    const next = [entry, ...previous].slice(0, 20);
    await tx
      .insert(appSetting)
      .values({ key: dreamKey(agentId), value: next })
      .onConflictDoUpdate({ target: appSetting.key, set: { value: next } });
    return next;
  });
  if (!history) return null;
  try {
    const result = await consolidateMemory(agentId, now, trigger === 'manual');
    if (!result) throw new HttpError(409, 'Agent runtime changed during consolidation');
    entry.status = 'succeeded';
    entry.result = {
      status: result.status,
      duplicates: result.duplicates,
      conflicts: result.conflicts,
      omitted: result.omitted,
      filtered: result.filtered,
    };
    return result;
  } catch (error) {
    entry.status = 'failed';
    entry.error = error instanceof HttpError ? error.message : 'Memory consolidation failed';
    throw error;
  } finally {
    entry.finishedAt = new Date().toISOString();
    await db
      .update(appSetting)
      .set({ value: history })
      .where(eq(appSetting.key, dreamKey(agentId)));
  }
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
  runWhenNew: true,
  schedule: async () => ({
    enabled: nativeRuntimeEnabled(),
    cron: '0 3 * * *',
    timezone: 'Europe/Berlin',
  }),
  run: runMemoryConsolidation,
});
