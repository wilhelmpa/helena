import { createHash } from 'node:crypto';
import { aiAgent, agentRuntimeAction, helenaAgentSession, db } from '@repo/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { looksSecret } from '@helena/facts';
import { HttpError } from '#shared/lib';
import { parseFrontmatter } from '../skills/skill-format';
import { listAgentRuntimeSkills } from '../skills/service';
import type { LearnedSkill } from '../learning/service';
import type { AgentRuntimePolicy, AgentRuntimeState } from '../core/service';

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
  useCount?: number;
  history?: SkillChange[];
};

function contentOf(skill: LearnedSkill): LearnedSkill {
  const { path, name, markdown, files, otherFiles, truncated } = skill;
  return { path, name, markdown, files, otherFiles, truncated };
}

export function similarSkill(a: LearnedSkill, b: LearnedSkill): boolean {
  const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const overlap = (a: Set<string>, b: Set<string>) => {
    const intersection = [...a].filter((word) => b.has(word)).length;
    return intersection / Math.max(1, a.size + b.size - intersection);
  };
  const body = (s: LearnedSkill) =>
    s.markdown.replace(/^---[\s\S]*?---/, '').replace(/^#+.*$/gm, '');
  return (
    a.name.toLowerCase() === b.name.toLowerCase() ||
    overlap(words(a.name), words(b.name)) >= 0.8 ||
    (words(body(a)).size >= 12 && overlap(words(body(a)), words(body(b))) >= 0.85)
  );
}

export function skillDescription(skill: LearnedSkill): string {
  return parseFrontmatter(skill.markdown).description ?? skill.name;
}

export function skillQuality(skill: LearnedSkill): string[] {
  const issues: string[] = [];
  try {
    validateNativeSkill(skill);
  } catch {
    issues.push('Unsafe or incomplete skill');
  }
  const meta = parseFrontmatter(skill.markdown);
  if (!meta.name || !meta.description) issues.push('Name and when-to-use description required');
  if (meta.name !== skill.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.name ?? ''))
    issues.push('Frontmatter name must match the lowercase skill name');
  for (const heading of ['Steps', 'Pitfalls', 'Examples']) {
    if (!new RegExp(String.raw`^## ${heading}\s*\n\s*\S`, 'm').test(skill.markdown))
      issues.push(`Nonempty ${heading} section required`);
  }
  return issues;
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
  const content = [
    skill.path,
    skill.name,
    skill.markdown,
    ...skill.files.flatMap((file) => [file.path, file.content]),
  ];
  const credentialPath =
    /(?:\.ssh\/|\.aws\/|\.kube\/config|\.env(?:[./\s]|$)|\.npmrc|id_(?:rsa|ed25519)|\/(?:secrets?|credentials?)\/|\.(?:pem|key)(?:\s|$)|[?&](?:key|token|secret)=)/i;
  if (content.some((text) => looksSecret(text) || credentialPath.test(text)))
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
  if (options.structured && skillQuality(skill).length)
    throw new HttpError(400, skillQuality(skill).join('; '));
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
    }
    const skills = nativeSkills(agent.volitionLearnedSkills);
    const index = skills.findIndex((entry) => entry.path === skill.path);
    const current = skills[index];
    if ((current ? skillRevision(current) : null) !== baseRevision)
      throw new HttpError(409, 'The skill changed; read its current revision first');
    if (index < 0 && options.structured) {
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
          .map((skill) => ({ path: skill.path, issues: skillQuality(skill) })),
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

export async function recordSkillUse(agentId: number, name: string) {
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
    skill.useCount = (skill.useCount ?? 0) + 1;
    skill.lastUsedAt = new Date().toISOString();
    await store(tx, agent, skills);
  });
}

export async function reviewNativeSkill(
  agentId: number,
  path: string,
  revision: string,
  action: 'approve' | 'reject' | 'restore',
  userId: string,
) {
  return db.transaction(async (tx) => {
    const agent = await lockedAgent(tx, agentId);
    const skills = nativeSkills(agent.volitionLearnedSkills);
    const skill = skills.find((entry) => entry.path === path);
    if (!skill) throw new HttpError(404, 'Learned skill not found');
    if (skillRevision(skill) !== revision) throw new HttpError(409, 'Skill revision changed');
    const pending = skill.history?.find((event) => event.status === 'pending');
    if (action === 'restore') {
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
