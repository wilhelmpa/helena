import { db, aiAgent, agentRuntimeAction, agentSkillLink } from '@repo/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import type { AgentRuntimeInventory } from '../core/service';
import { createSkillFromFiles, type SkillRow } from '../skills/service';
import type {
  createRuntimeActionBody,
  learnedSkill,
  runtimeActionResult,
  runtimeActionSnapshot,
} from './model';

// What an external agent learned in its runtime, and the owner's decisions on it. The
// runner reports the skills the agent created and its memory; an action the owner takes
// is queued here and reaches the runner with the agent's runtime policy.

export type RuntimeActionInput = typeof createRuntimeActionBody.static;
export type LearnedSkill = typeof learnedSkill.static;
export type RuntimeActionResult = typeof runtimeActionResult.static;
type RuntimeActionSnapshot = typeof runtimeActionSnapshot.static;
type ActionKind = RuntimeActionInput['kind'];

export interface RuntimeActionRow {
  id: number;
  kind: ActionKind;
  target: string;
  pinned: boolean | null;
  error: string | null;
  createdAt: string;
}

type StoredAction = typeof agentRuntimeAction.$inferSelect;

function toRow(row: StoredAction): RuntimeActionRow {
  const payload = row.payload as { pinned?: unknown };
  return {
    id: row.id,
    kind: row.kind as ActionKind,
    target: row.target,
    pinned: row.kind === 'pin-skill' ? payload.pinned === true : null,
    error: row.error,
    createdAt: iso(row.createdAt),
  };
}

function toSnapshot(row: StoredAction): RuntimeActionSnapshot {
  const payload = row.payload as { pinned?: boolean; content?: string; baseSha256?: string };
  if (row.kind === 'pin-skill') {
    return { id: row.id, kind: 'pin-skill', path: row.target, pinned: payload.pinned === true };
  }
  if (row.kind === 'write-memory') {
    return {
      id: row.id,
      kind: 'write-memory',
      file: row.target as 'MEMORY.md' | 'USER.md',
      content: payload.content ?? '',
      baseSha256: payload.baseSha256 ?? '',
    };
  }
  return { id: row.id, kind: 'discard-skill', path: row.target };
}

async function runtimeOf(agentId: number) {
  const [row] = await db
    .select({ state: aiAgent.runtimeState, learned: aiAgent.runtimeLearnedSkills })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  if (!row) throw new HttpError(404, 'Agent not found');
  const inventory = (row.state as { inventory?: AgentRuntimeInventory | null }).inventory ?? null;
  return { inventory, learned: Array.isArray(row.learned) ? (row.learned as LearnedSkill[]) : [] };
}

export async function listRuntimeActions(agentId: number): Promise<RuntimeActionRow[]> {
  const rows = await db
    .select()
    .from(agentRuntimeAction)
    .where(eq(agentRuntimeAction.agentId, agentId))
    .orderBy(asc(agentRuntimeAction.id));
  return rows.map(toRow);
}

// The actions the runner has not carried out yet, as it receives them with the policy.
export async function pendingRuntimeActions(agentId: number): Promise<RuntimeActionSnapshot[]> {
  const rows = await db
    .select()
    .from(agentRuntimeAction)
    .where(and(eq(agentRuntimeAction.agentId, agentId), isNull(agentRuntimeAction.error)))
    .orderBy(asc(agentRuntimeAction.id));
  return rows.map(toSnapshot);
}

// Skill actions only name a skill the runner reported as created by the agent. The
// newest decision on a target replaces an older one, carried out or failed, so a
// discard also drops a pin still waiting.
export async function queueRuntimeAction(
  agentId: number,
  input: RuntimeActionInput,
): Promise<RuntimeActionRow> {
  const { inventory } = await runtimeOf(agentId);
  if (!inventory) {
    throw new HttpError(409, "The agent's runtime has not reported what it learned yet");
  }
  const skill = input.kind !== 'write-memory';
  const target = skill ? input.path : input.file;
  if (skill && !inventory.skills.some((s) => s.origin === 'agent' && s.path === target)) {
    throw new HttpError(404, 'Learned skill not found');
  }
  const payload =
    input.kind === 'pin-skill'
      ? { pinned: input.pinned }
      : input.kind === 'write-memory'
        ? { content: input.content, baseSha256: input.baseSha256 }
        : {};
  const kinds: ActionKind[] = skill ? ['discard-skill', 'pin-skill'] : ['write-memory'];
  return db.transaction(async (tx) => {
    await tx
      .delete(agentRuntimeAction)
      .where(
        and(
          eq(agentRuntimeAction.agentId, agentId),
          eq(agentRuntimeAction.target, target),
          inArray(agentRuntimeAction.kind, kinds),
        ),
      );
    const [row] = await tx
      .insert(agentRuntimeAction)
      .values({ agentId, kind: input.kind, target, payload })
      .returning();
    return toRow(row);
  });
}

// A done action is deleted; a failed one keeps its error, which the owner sees.
export async function completeRuntimeActions(
  agentId: number,
  results: RuntimeActionResult[],
): Promise<void> {
  const done = results.filter((result) => result.error === null).map((result) => result.id);
  if (done.length > 0) {
    await db
      .delete(agentRuntimeAction)
      .where(and(eq(agentRuntimeAction.agentId, agentId), inArray(agentRuntimeAction.id, done)));
  }
  for (const { id, error } of results) {
    if (error === null) continue;
    await db
      .update(agentRuntimeAction)
      .set({ error })
      .where(and(eq(agentRuntimeAction.agentId, agentId), eq(agentRuntimeAction.id, id)));
  }
}

export async function getLearnedSkill(agentId: number, path: string): Promise<LearnedSkill> {
  const { learned } = await runtimeOf(agentId);
  const skill = learned.find((entry) => entry.path === path);
  if (!skill) throw new HttpError(404, 'Learned skill not found');
  return skill;
}

// Copies a skill the agent created into the team's library and enables it on the agent,
// where the runner then writes it as one of Plan's skills. The agent's own copy is
// discarded with the same sync, so the agent does not load the skill twice.
export async function promoteLearnedSkill(
  teamId: number,
  agentId: number,
  path: string,
): Promise<SkillRow> {
  const skill = await getLearnedSkill(agentId, path);
  if (skill.truncated || !skill.markdown.trim()) {
    throw new HttpError(409, 'The skill is too large to take over');
  }
  const created = await createSkillFromFiles(teamId, {
    name: skill.name,
    markdown: skill.markdown,
    source: 'inline',
    refs: skill.files.map((file) => ({
      path: file.path,
      bytes: Buffer.from(file.content, 'utf8'),
      contentType: 'text/markdown',
    })),
  });
  await db.insert(agentSkillLink).values({ agentId, skillId: created.id }).onConflictDoNothing();
  await queueRuntimeAction(agentId, { kind: 'discard-skill', path });
  return created;
}
