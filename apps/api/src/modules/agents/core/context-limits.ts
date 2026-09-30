import { agentMemoryRevision, aiAgent, db, team } from '@repo/db';
import {
  contextFileLimit,
  effectiveContextLimits,
  normalizeContextLimits,
  truncateContext,
} from '@helena/sdk';
import { and, desc, eq } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import type { AgentRuntimePolicy } from './service';
import { getAgentById } from './service';
import { memoryBaseline } from '../memory/service';
import { getRunnerAgent } from '../runner/service';
import { runtimePolicySnapshot } from '../runtime-policy/service';

async function agentContextSettings(agentId: number) {
  const [row] = await db
    .select({ policy: aiAgent.runtimePolicy, team: team.agentContextLimits })
    .from(aiAgent)
    .innerJoin(team, eq(team.id, aiAgent.teamId))
    .where(eq(aiAgent.id, agentId));
  if (!row) throw new HttpError(404, 'Agent not found');
  const own = (row.policy as AgentRuntimePolicy).contextLimits;
  return {
    limits: effectiveContextLimits(row.team, own),
    overrides: { ...normalizeContextLimits(row.team), ...normalizeContextLimits(own) },
  };
}

export async function agentContextLimits(agentId: number) {
  return (await agentContextSettings(agentId)).limits;
}

export async function agentContextSizeView(agentId: number, teamId: number) {
  const agent = await getAgentById(agentId, teamId);
  if (!agent) throw new HttpError(404, 'Agent not found');
  const runner = await getRunnerAgent(agent.userId);
  if (!runner) throw new HttpError(404, 'Agent runner not found');
  const { limits, overrides } = await agentContextSettings(agentId);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [memory, note, snapshot] = await Promise.all([
    memoryBaseline(agentId),
    db
      .select({ file: agentMemoryRevision.file, content: agentMemoryRevision.content })
      .from(agentMemoryRevision)
      .where(
        and(
          eq(agentMemoryRevision.agentId, agentId),
          eq(agentMemoryRevision.file, `notes/${today}.md`),
        ),
      )
      .orderBy(desc(agentMemoryRevision.id))
      .limit(1),
    runtimePolicySnapshot(runner),
  ]);
  const model = agent.model?.split('/') ?? [];
  const server = snapshot.localAi?.servers.find((entry) => entry.provider === model[0]);
  const contextTokens =
    server?.models.find((entry) => entry.id === model.slice(1).join('/'))?.contextLength ??
    server?.contextLength ??
    131_072;
  const files = snapshot.runtimePolicy.files;
  const dailyNote = note[0]?.content ?? '';
  const scopes = {
    memory: memory.find((entry) => entry.file === 'MEMORY.md')?.content ?? '',
    user: memory.find((entry) => entry.file === 'USER.md')?.content ?? '',
    dailyNote,
    soul: files.find((entry) => entry.path === 'SOUL.md')?.content ?? '',
    agentInstructions: agent.instructions ?? '',
    projectInstructions: agent.projects
      .map((entry) => entry.instructions)
      .filter(Boolean)
      .join('\n\n'),
    teamInstructions: agent.runtimePolicy.files
      .filter((entry) => entry.path !== 'SOUL.md')
      .map((entry) => entry.content)
      .join('\n\n'),
    skillDescription: snapshot.skills.reduce(
      (max, entry) => (entry.description.length > max.length ? entry.description : max),
      '',
    ),
    loadedSkills: snapshot.skills.length,
  };
  const areas = Object.entries(scopes).map(([key, value]) => {
    const count = typeof value === 'number' ? value : value.length;
    const configured = limits[key as keyof typeof limits];
    const limit = ['soul', 'agentInstructions', 'projectInstructions', 'teamInstructions'].includes(
      key,
    )
      ? contextFileLimit(
          contextTokens,
          configured,
          overrides[key as keyof typeof overrides] !== undefined,
        )
      : configured;
    const cut = typeof value === 'string' ? truncateContext(value, limit) : null;
    return {
      key,
      size: count,
      limit,
      truncated:
        (cut?.truncated ?? count > limit) ||
        (key === 'soul' && value.toString().includes('[Context warning:')),
      charsBefore: count,
      charsAfter: cut?.charsAfter ?? count,
    };
  });
  return { modelContextTokens: contextTokens, areas };
}

export async function agentSizeLimits(agentId: number, teamId: number) {
  const { areas } = await agentContextSizeView(agentId, teamId);
  const fields = [
    'memory',
    'user',
    'dailyNote',
    'soul',
    'agentInstructions',
    'projectInstructions',
  ] as const;
  return Object.fromEntries(
    fields.map((field) => {
      const area = areas.find((entry) => entry.key === field)!;
      return [field, { used: area.size, limit: area.limit, truncated: area.truncated }];
    }),
  ) as Record<(typeof fields)[number], { used: number; limit: number; truncated: boolean }>;
}
