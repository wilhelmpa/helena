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
type ActionKind = RuntimeActionInput['kind'] | 'rewrite-profile';

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
  if (row.kind === 'rewrite-profile') return { id: row.id, kind: 'rewrite-profile' };
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

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A skill action only names a skill the runner reported as created by the agent.
function assertActionable(inventory: AgentRuntimeInventory | null, skillPath: string | null) {
  if (!inventory) {
    throw new HttpError(409, "The agent's runtime has not reported what it learned yet");
  }
  if (
    skillPath !== null &&
    !inventory.skills.some((skill) => skill.origin === 'agent' && skill.path === skillPath)
  ) {
    throw new HttpError(404, 'Learned skill not found');
  }
}

// The newest decision on a target replaces an older one, carried out or failed, so a
// discard also drops a pin still waiting.
async function insertAction(
  tx: Transaction,
  agentId: number,
  kind: ActionKind,
  target: string,
  payload: Record<string, unknown>,
): Promise<RuntimeActionRow> {
  const kinds: ActionKind[] =
    kind === 'write-memory' ? ['write-memory'] : ['discard-skill', 'pin-skill'];
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
    .values({ agentId, kind, target, payload })
    .returning();
  return toRow(row);
}

export async function queueRuntimeAction(
  agentId: number,
  input: RuntimeActionInput,
): Promise<RuntimeActionRow> {
  const { inventory } = await runtimeOf(agentId);
  const target = input.kind === 'write-memory' ? input.file : input.path;
  assertActionable(inventory, input.kind === 'write-memory' ? null : target);
  const payload =
    input.kind === 'pin-skill'
      ? { pinned: input.pinned }
      : input.kind === 'write-memory'
        ? { content: input.content, baseSha256: input.baseSha256 }
        : {};
  return db.transaction((tx) => insertAction(tx, agentId, input.kind, target, payload));
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

function learnedSkillAt(learned: LearnedSkill[], path: string): LearnedSkill {
  const skill = learned.find((entry) => entry.path === path);
  if (!skill) throw new HttpError(404, 'Learned skill not found');
  return skill;
}

export async function getLearnedSkill(agentId: number, path: string): Promise<LearnedSkill> {
  return learnedSkillAt((await runtimeOf(agentId)).learned, path);
}

// Copies a skill the agent created into the team's library and enables it on the agent,
// where the runner then writes it as one of Plan's skills. The agent's own copy is
// discarded with the same sync, so the agent does not load the skill twice. A skill with
// files the library cannot hold, such as scripts, stays with the agent: discarding its
// copy would take those files from it.
export async function promoteLearnedSkill(
  teamId: number,
  agentId: number,
  path: string,
): Promise<SkillRow> {
  const { inventory, learned } = await runtimeOf(agentId);
  assertActionable(inventory, path);
  const skill = learnedSkillAt(learned, path);
  if (skill.truncated || !skill.markdown.trim()) {
    throw new HttpError(409, 'The skill is too large to take over');
  }
  if (skill.otherFiles > 0) {
    throw new HttpError(409, 'The skill has files the skill library cannot hold, such as scripts');
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
  await db.transaction(async (tx) => {
    await tx.insert(agentSkillLink).values({ agentId, skillId: created.id }).onConflictDoNothing();
    await insertAction(tx, agentId, 'discard-skill', path, {});
  });
  return created;
}
