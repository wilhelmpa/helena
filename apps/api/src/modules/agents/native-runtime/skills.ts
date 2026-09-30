import { createHash } from 'node:crypto';
import {
  aiAgent,
  agentRuntimeAction,
  helenaAgentSession,
  helenaAgentSessionItem,
  db,
} from '@repo/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { listAgentRuntimeSkills } from '../skills/service';
import type { LearnedSkill } from '../learning/service';
import type { AgentRuntimePolicy, AgentRuntimeState } from '../core/service';
import {
  oneOffSkillSource,
  similarSkill,
  skillDescription,
  skillQuality,
  validateNativeSkill,
} from './skill-quality';
export {
  oneOffSkillSource,
  similarSkill,
  skillDescription,
  skillQuality,
  validateNativeSkill,
} from './skill-quality';

export interface SkillChange {
  id: string;
  version: number;
  at: string;
  actor: string;
  sessionId: string | null;
  action: string;
  status: 'applied' | 'pending' | 'rejected';
  baseRevision: string | null;
  before: LearnedSkill | null;
  after: LearnedSkill;
  diff: string;
}
export type NativeSkill = LearnedSkill & {
  pinned?: boolean;
  archived?: boolean;
  proposed?: boolean;
  version?: number;
  createdAt?: string;
  lastUsedAt?: string;
  lastUseSessionId?: string;
  useCount?: number;
  benefit?: 'useful' | 'no-benefit';
  comparison?: {
    baselineSteps: number;
    loadedSteps: number;
    baselineSessionId: string;
    loadedSessionId: string;
  };
  history?: SkillChange[];
};

function contentOf(skill: LearnedSkill): LearnedSkill {
  const { path, name, markdown, files, otherFiles, truncated } = skill;
  return { path, name, markdown, files, otherFiles, truncated };
}

function change(
  skill: NativeSkill | undefined,
  next: LearnedSkill,
  actor: string,
  action: string,
  status: SkillChange['status'],
  sessionId: string | null = null,
): SkillChange {
  const before = skill && !skill.proposed ? contentOf(skill) : null;
  const after = contentOf(next);
  return {
    id: crypto.randomUUID(),
    version: (skill?.version ?? (before ? 1 : 0)) + 1,
    at: new Date().toISOString(),
    actor,
    sessionId,
    action,
    status,
    baseRevision: before ? skillRevision(skill!) : null,
    before,
    after,
    diff: [before ? JSON.stringify(before) : '', JSON.stringify(after)]
      .map((text, i) => `${i ? '+' : '-'} ${text}`)
      .join('\n'),
  };
}
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function nativeSkills(value: unknown): NativeSkill[] {
  return Array.isArray(value) ? (value as NativeSkill[]) : [];
}

export function skillRevision(skill: NativeSkill): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        skill.path,
        skill.name,
        skill.markdown,
        skill.files.map((file) => [file.path, file.content]),
        skill.otherFiles,
        skill.truncated,
        skill.pinned === true,
        skill.archived === true,
        skill.version ?? 0,
        skill.history?.map(({ id, status }) => [id, status]),
      ]),
    )
    .digest('hex');
}

async function lockedAgent(tx: Transaction, agentId: number) {
  const [agent] = await tx.select().from(aiAgent).where(eq(aiAgent.id, agentId)).for('update');
  if (!agent) throw new HttpError(404, 'Agent not found');
  if ((agent.runtimePolicy as AgentRuntimePolicy).runtime !== 'helena')
    throw new HttpError(409, 'This agent does not use the native runtime');
  return agent;
}

export function learnedInventory(skills: NativeSkill[]) {
  return skills
    .filter((skill) => !skill.archived && !skill.proposed)
    .map((skill) => ({
      name: skill.name,
      path: skill.path,
      category: 'volition',
      description: skillDescription(skill),
      origin: 'agent' as const,
      pinned: skill.pinned === true,
    }));
}

async function store(tx: Transaction, agent: typeof aiAgent.$inferSelect, skills: NativeSkill[]) {
  if (JSON.stringify(skills).length > 2 * 1024 * 1024)
    throw new HttpError(413, 'Learned skills are too large');
  const state = agent.runtimeState as AgentRuntimeState;
  const inventory = state.inventory ?? { toolsets: [], mcpServers: [], skills: [], memory: [] };
  await tx
    .update(aiAgent)
    .set({
      volitionLearnedSkills: skills,
      runtimeState: {
        ...state,
        inventory: {
          ...inventory,
          skills: [
            ...inventory.skills.filter((skill) => skill.origin !== 'agent'),
            ...learnedInventory(skills),
          ],
        },
      },
    })
    .where(eq(aiAgent.id, agent.id));
}

export async function listNativeSkills(
  agentId: number,
  includeArchived = false,
  includeHistory = includeArchived,
) {
  const [agent] = await db
    .select({ skills: aiAgent.volitionLearnedSkills })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  return nativeSkills(agent?.skills)
    .filter((skill) => includeArchived || (!skill.archived && !skill.proposed))
    .map((skill) => ({
      ...skill,
      history: includeHistory ? skill.history : undefined,
      revision: skillRevision(skill),
    }));
}

export async function saveNativeSkill(
  agentId: number,
  skill: LearnedSkill,
  baseRevision: string | null,
  options: { sessionId?: string | null; structured?: boolean } = {},
) {
  validateNativeSkill(skill);
  if (skillQuality(skill).length) throw new HttpError(400, skillQuality(skill).join('; '));
  return db.transaction(async (tx) => {
    const agent = await lockedAgent(tx, agentId);
    if ((agent.runtimePolicy as AgentRuntimePolicy).learning === false)
      throw new HttpError(403, 'Learning is disabled');
    if (options.sessionId) {
      const [session] = await tx
        .select({ id: helenaAgentSession.id })
        .from(helenaAgentSession)
        .where(
          and(
            eq(helenaAgentSession.id, options.sessionId),
            eq(helenaAgentSession.agentId, agentId),
          ),
        );
      if (!session) throw new HttpError(403, 'Session does not belong to the agent');
      if (!baseRevision) {
        const source = await tx
          .select({ text: helenaAgentSessionItem.text })
          .from(helenaAgentSessionItem)
          .where(
            and(
              eq(helenaAgentSessionItem.sessionId, options.sessionId),
              eq(helenaAgentSessionItem.role, 'user'),
            ),
          )
          .orderBy(asc(helenaAgentSessionItem.seq))
          .limit(3);
        if (source.some((item) => oneOffSkillSource(item.text)))
          throw new HttpError(400, 'One-time lookups cannot create learned skills');
      }
    }
    const skills = nativeSkills(agent.volitionLearnedSkills);
    const recent = skills
      .flatMap((entry) => entry.history ?? [])
      .filter(
        (event) =>
          event.actor === `agent:${agentId}` && Date.parse(event.at) > Date.now() - 86_400_000,
      ).length;
    if (recent >= 5) throw new HttpError(429, 'Daily learned skill limit reached');
    const index = skills.findIndex((entry) => entry.path === skill.path);
    const current = skills[index];
    if ((current ? skillRevision(current) : null) !== baseRevision)
      throw new HttpError(409, 'The skill changed; read its current revision first');
    if (index < 0) {
      const duplicate = skills.find((entry) => similarSkill(entry, skill));
      if (duplicate)
        throw new HttpError(409, `Similar skill: ${duplicate.path}; read and improve its revision`);
      const installed = (await listAgentRuntimeSkills(agentId)).find((entry) =>
        similarSkill({ ...entry, path: entry.slug, otherFiles: 0, truncated: false }, skill),
      );
      if (installed)
        throw new HttpError(
          409,
          `Covered by installed skill ${installed.slug}; use the installed procedure instead of creating a duplicate`,
        );
    }
    if (current?.history?.some((event) => event.status === 'pending'))
      throw new HttpError(409, 'A skill proposal is already pending');
    const pending = (agent.runtimePolicy as AgentRuntimePolicy).memoryApproval === true;
    const event = change(
      current,
      skill,
      `agent:${agentId}`,
      current ? 'update' : 'create',
      pending ? 'pending' : 'applied',
      options.sessionId ?? null,
    );
    const next: NativeSkill = {
      ...(pending && current ? current : skill),
      pinned: current?.pinned ?? false,
      archived: pending ? (current?.archived ?? true) : false,
      proposed: pending && (!current || current.proposed === true),
      version: pending ? (current?.version ?? 0) : event.version,
      createdAt: current?.createdAt ?? event.at,
      useCount: current?.useCount ?? 0,
      lastUsedAt: current?.lastUsedAt,
      history: [...(current?.history ?? []), event],
    };
    if (index < 0) skills.push(next);
    else skills[index] = next;
    await store(tx, agent, skills);
    return { ...next, revision: skillRevision(next), status: event.status, change: event };
  });
}

export async function nativeSkillAction(agentId: number, path: string, pinned: boolean | null) {
  return db.transaction(async (tx) => {
    const agent = await lockedAgent(tx, agentId);
    const skills = nativeSkills(agent.volitionLearnedSkills);
    const skill = skills.find((entry) => entry.path === path && !entry.archived);
    if (!skill) throw new HttpError(404, 'Learned skill not found');
    if (skill.history?.some((event) => event.status === 'pending'))
      throw new HttpError(409, 'Review the pending proposal first');
    const event = change(
      skill,
      skill,
      `agent:${agentId}`,
      pinned === null ? 'archive' : pinned ? 'pin' : 'unpin',
      'applied',
    );
    skill.history = [...(skill.history ?? []), event];
    skill.version = event.version;
    if (pinned === null) skill.archived = true;
    else skill.pinned = pinned;
    await store(tx, agent, skills);
  });
}

export function unusedNativeSkill(skill: NativeSkill, now: number): boolean {
  return (
    !!skill.createdAt &&
    now - Date.parse(skill.lastUsedAt ?? skill.createdAt) > 180 * 86_400_000 &&
    (skill.useCount ?? 0) < 3
  );
}

async function sessionSteps(tx: Transaction, sessionId: string): Promise<number> {
  const rows = await tx
    .select({ content: helenaAgentSessionItem.content })
    .from(helenaAgentSessionItem)
    .where(
      and(
        eq(helenaAgentSessionItem.sessionId, sessionId),
        eq(helenaAgentSessionItem.role, 'assistant'),
      ),
    );
  return rows.reduce((count, row) => {
    const message = row.content as { content?: unknown };
    if (!Array.isArray(message.content)) return count;
    return (
      count +
      message.content.filter(
        (part: { type?: string; toolName?: string }) =>
          part.type === 'tool-call' && !['memory', 'skill_manage'].includes(part.toolName ?? ''),
      ).length
    );
  }, 0);
}

export async function nativeCurator(agentId: number, run: boolean) {
  return db.transaction(async (tx) => {
    const agent = await lockedAgent(tx, agentId);
    const policy = agent.runtimePolicy as AgentRuntimePolicy;
    const paused = policy.curator !== true || policy.learning === false;
    const skills = nativeSkills(agent.volitionLearnedSkills);
    const archived: string[] = [];
    if (run && !paused) {
      const seen: NativeSkill[] = [];
      const now = Date.now();
      for (const skill of [...skills].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))) {
        if (skill.archived || skill.proposed) continue;
        const baselineSessionId = skill.history?.find(
          (event) => event.action === 'create' && event.status === 'applied',
        )?.sessionId;
        if (
          !skill.comparison &&
          baselineSessionId &&
          skill.lastUseSessionId &&
          baselineSessionId !== skill.lastUseSessionId
        ) {
          const [loaded] = await tx
            .select({ updatedAt: helenaAgentSession.updatedAt })
            .from(helenaAgentSession)
            .where(
              and(
                eq(helenaAgentSession.id, skill.lastUseSessionId),
                eq(helenaAgentSession.agentId, agentId),
              ),
            );
          if (loaded && now - loaded.updatedAt.getTime() > 60_000) {
            const baselineSteps = await sessionSteps(tx, baselineSessionId);
            const loadedSteps = await sessionSteps(tx, skill.lastUseSessionId);
            if (baselineSteps > 0 && loadedSteps > 0) {
              skill.benefit = loadedSteps < baselineSteps ? 'useful' : 'no-benefit';
              skill.comparison = {
                baselineSteps,
                loadedSteps,
                baselineSessionId,
                loadedSessionId: skill.lastUseSessionId,
              };
            }
          }
        }
        skill.createdAt ??= new Date(now).toISOString();
        const duplicate = seen.find(
          (entry) =>
            entry.markdown === skill.markdown &&
            JSON.stringify(entry.files) === JSON.stringify(skill.files),
        );
        const stale = unusedNativeSkill(skill, now);
        if (!skill.pinned && (duplicate || stale)) {
          const event = change(
            skill,
            skill,
            'curator',
            duplicate ? `merge:${duplicate.path}` : 'archive:unused',
            policy.memoryApproval === true ? 'pending' : 'applied',
          );
          if (skill.history?.some((entry) => entry.status === 'pending')) continue;
          skill.history = [...(skill.history ?? []), event];
          if (event.status === 'applied') {
            skill.archived = true;
            skill.version = event.version;
            if (duplicate) {
              duplicate.useCount = (duplicate.useCount ?? 0) + (skill.useCount ?? 0);
              skill.useCount = 0;
            }
            archived.push(skill.path);
          }
        }
        seen.push(skill);
      }
      await store(tx, agent, skills);
    }
    return {
      paused,
      report: JSON.stringify({
        active: skills.filter((skill) => !skill.archived && !skill.proposed).length,
        archived,
        priority: 'background',
        quality: skills
          .filter((skill) => !skill.archived)
          .map((skill) => ({
            path: skill.path,
            issues: [
              ...skillQuality(skill),
              ...(skill.benefit === 'no-benefit' ? ['No measured step benefit'] : []),
            ],
          })),
      }),
    };
  });
}

export async function applyNativeSkillActions(agentId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const agent = await lockedAgent(tx, agentId);
    const actions = await tx
      .select()
      .from(agentRuntimeAction)
      .where(
        and(
          eq(agentRuntimeAction.agentId, agentId),
          inArray(agentRuntimeAction.kind, ['pin-skill', 'discard-skill']),
          isNull(agentRuntimeAction.error),
        ),
      )
      .orderBy(asc(agentRuntimeAction.id));
    if (!actions.length) return;
    const skills = nativeSkills(agent.volitionLearnedSkills);
    for (const action of actions) {
      const skill = skills.find((entry) => entry.path === action.target);
      if (!skill) {
        await tx
          .update(agentRuntimeAction)
          .set({ error: 'Learned skill not found' })
          .where(eq(agentRuntimeAction.id, action.id));
        continue;
      }
      if (skill.history?.some((event) => event.status === 'pending')) {
        await tx
          .update(agentRuntimeAction)
          .set({ error: 'Review the pending proposal first' })
          .where(eq(agentRuntimeAction.id, action.id));
        continue;
      }
      const event = change(skill, skill, `runtime-action:${action.id}`, action.kind, 'applied');
      skill.history = [...(skill.history ?? []), event];
      skill.version = event.version;
      if (action.kind === 'discard-skill') skill.archived = true;
      else skill.pinned = (action.payload as { pinned?: boolean }).pinned === true;
      await tx.delete(agentRuntimeAction).where(eq(agentRuntimeAction.id, action.id));
    }
    await store(tx, agent, skills);
  });
}

export async function recordSkillUse(agentId: number, name: string, sessionId?: string) {
  await db.transaction(async (tx) => {
    const agent = await lockedAgent(tx, agentId);
    const skills = nativeSkills(agent.volitionLearnedSkills);
    const skill = skills.find(
      (entry) =>
        (entry.name.toLowerCase() === name.toLowerCase() || `learned/${entry.path}` === name) &&
        !entry.archived &&
        !entry.proposed,
    );
    if (!skill) return;
    if (sessionId) {
      const [session] = await tx
        .select({ id: helenaAgentSession.id })
        .from(helenaAgentSession)
        .where(and(eq(helenaAgentSession.id, sessionId), eq(helenaAgentSession.agentId, agentId)));
      if (!session) throw new HttpError(403, 'Session does not belong to the agent');
      skill.lastUseSessionId = sessionId;
    }
    skill.useCount = (skill.useCount ?? 0) + 1;
    skill.lastUsedAt = new Date().toISOString();
    await store(tx, agent, skills);
  });
}

export async function reviewNativeSkill(
  agentId: number,
  path: string,
  revision: string,
  action: 'approve' | 'reject' | 'restore' | 'revert',
  userId: string,
  version?: number,
) {
  return db.transaction(async (tx) => {
    const agent = await lockedAgent(tx, agentId);
    const skills = nativeSkills(agent.volitionLearnedSkills);
    const skill = skills.find((entry) => entry.path === path);
    if (!skill) throw new HttpError(404, 'Learned skill not found');
    if (skillRevision(skill) !== revision) throw new HttpError(409, 'Skill revision changed');
    const pending = skill.history?.find((event) => event.status === 'pending');
    if (action === 'revert') {
      if (pending) throw new HttpError(409, 'Review the pending proposal first');
      const previous = skill.history?.find(
        (event) => event.version === version && event.status === 'applied',
      );
      if (!previous) throw new HttpError(404, 'Skill version not found');
      validateNativeSkill(previous.after);
      const event = change(skill, previous.after, `user:${userId}`, `revert:${version}`, 'applied');
      Object.assign(skill, previous.after);
      skill.version = event.version;
      skill.history = [...(skill.history ?? []), event];
    } else if (action === 'restore') {
      if (skill.proposed || pending) throw new HttpError(409, 'Review the pending proposal first');
      const event = change(skill, skill, `user:${userId}`, 'restore', 'applied');
      skill.history = [...(skill.history ?? []), event];
      skill.archived = false;
      skill.version = event.version;
      skill.lastUsedAt = event.at;
    } else {
      if (!pending) throw new HttpError(409, 'No pending proposal');
      pending.status = action === 'approve' ? 'applied' : 'rejected';
      const event = change(
        skill,
        pending.after,
        `user:${userId}`,
        action,
        'applied',
        pending.sessionId,
      );
      if (action === 'approve') {
        validateNativeSkill(pending.after);
        Object.assign(skill, pending.after);
        skill.archived =
          pending.action.startsWith('archive:') || pending.action.startsWith('merge:');
        skill.proposed = false;
        if (pending.action.startsWith('merge:')) {
          const target = skills.find(
            (entry) => entry.path === pending.action.slice(6) && !entry.archived,
          );
          if (!target) throw new HttpError(409, 'Merge target is no longer active');
          target.useCount = (target.useCount ?? 0) + (skill.useCount ?? 0);
          skill.useCount = 0;
        }
        skill.version = pending.version;
      }
      skill.history!.push(event);
    }
    await store(tx, agent, skills);
    return { ...skill, revision: skillRevision(skill) };
  });
}
