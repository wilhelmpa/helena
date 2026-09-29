import { createHash } from 'node:crypto';
import { aiAgent, agentRuntimeAction, db } from '@repo/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { looksSecret } from '@helena/facts';
import { HttpError } from '#shared/lib';
import type { LearnedSkill } from '../learning/service';
import type { AgentRuntimePolicy, AgentRuntimeState } from '../core/service';

type NativeSkill = LearnedSkill & { pinned?: boolean; archived?: boolean };
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
      ]),
    )
    .digest('hex');
}

export function validateNativeSkill(skill: LearnedSkill): void {
  const safe = (path: string) =>
    path
      .split('/')
      .every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..');
  if (!safe(skill.path) || skill.files.some((file) => !safe(file.path) || file.path === 'SKILL.md'))
    throw new HttpError(400, 'Invalid skill path');
  if (new Set(skill.files.map((file) => file.path)).size !== skill.files.length)
    throw new HttpError(400, 'Duplicate skill file');
  if (skill.truncated || skill.otherFiles || !skill.markdown.trim())
    throw new HttpError(400, 'A native skill must include its complete content and files');
  if (looksSecret(skill.markdown) || skill.files.some((file) => looksSecret(file.content)))
    throw new HttpError(400, 'The skill looks like it holds a secret');
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
    .filter((skill) => !skill.archived)
    .map((skill) => ({
      name: skill.name,
      path: skill.path,
      category: 'volition',
      description: '',
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
      runtimeLearnedSkills: skills,
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

export async function listNativeSkills(agentId: number) {
  const [agent] = await db
    .select({ skills: aiAgent.runtimeLearnedSkills })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  return nativeSkills(agent?.skills)
    .filter((skill) => !skill.archived)
    .map((skill) => ({ ...skill, revision: skillRevision(skill) }));
}

export async function saveNativeSkill(
  agentId: number,
  skill: LearnedSkill,
  baseRevision: string | null,
) {
  validateNativeSkill(skill);
  return db.transaction(async (tx) => {
    const agent = await lockedAgent(tx, agentId);
    if ((agent.runtimePolicy as AgentRuntimePolicy).learning === false)
      throw new HttpError(403, 'Learning is disabled');
    const skills = nativeSkills(agent.runtimeLearnedSkills);
    const index = skills.findIndex((entry) => entry.path === skill.path);
    const current = skills[index];
    if ((current ? skillRevision(current) : null) !== baseRevision)
      throw new HttpError(409, 'The skill changed; read its current revision first');
    const next = { ...skill, pinned: current?.pinned ?? false, archived: false };
    if (index < 0) skills.push(next);
    else skills[index] = next;
    await store(tx, agent, skills);
    return { ...next, revision: skillRevision(next) };
  });
}

export async function nativeSkillAction(agentId: number, path: string, pinned: boolean | null) {
  return db.transaction(async (tx) => {
    const agent = await lockedAgent(tx, agentId);
    const skills = nativeSkills(agent.runtimeLearnedSkills);
    const skill = skills.find((entry) => entry.path === path && !entry.archived);
    if (!skill) throw new HttpError(404, 'Learned skill not found');
    if (pinned === null) skill.archived = true;
    else skill.pinned = pinned;
    await store(tx, agent, skills);
  });
}

export async function nativeCurator(agentId: number, run: boolean) {
  return db.transaction(async (tx) => {
    const agent = await lockedAgent(tx, agentId);
    const paused = (agent.runtimePolicy as AgentRuntimePolicy).curator !== true;
    const skills = nativeSkills(agent.runtimeLearnedSkills);
    const archived: string[] = [];
    if (run && !paused) {
      const seen = new Set<string>();
      // Pinned copies take precedence; distinct skills and every original remain stored.
      for (const skill of [...skills].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))) {
        if (skill.archived) continue;
        const content = JSON.stringify([skill.markdown, skill.files]);
        if (!skill.pinned && seen.has(content)) {
          skill.archived = true;
          archived.push(skill.path);
        }
        seen.add(content);
      }
      await store(tx, agent, skills);
    }
    return {
      paused,
      report: JSON.stringify({
        active: skills.filter((skill) => !skill.archived).length,
        archived,
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
    const skills = nativeSkills(agent.runtimeLearnedSkills);
    for (const action of actions) {
      const skill = skills.find((entry) => entry.path === action.target);
      if (!skill) {
        await tx
          .update(agentRuntimeAction)
          .set({ error: 'Learned skill not found' })
          .where(eq(agentRuntimeAction.id, action.id));
        continue;
      }
      if (action.kind === 'discard-skill') skill.archived = true;
      else skill.pinned = (action.payload as { pinned?: boolean }).pinned === true;
      await tx.delete(agentRuntimeAction).where(eq(agentRuntimeAction.id, action.id));
    }
    await store(tx, agent, skills);
  });
}
