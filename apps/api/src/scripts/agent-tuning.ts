// Brings the running Hermes agents to the configuration the audit of 2026-09-25 settled on
// (docs/helena-decisions/agent-tuning.md; the target itself is agent-tuning/target.ts): the
// skills of their role, Hermes toolsets and bundled skills they cannot or must not use
// turned off, German instructions that say where things are, the project-wide instructions
// of PRIV, FAM, VOL and VERVE, and each specialist's assignment in its project. It also
// reports, read-only, what the runners last saw in each Hermes home: drift, the skills
// Hermes really loads, memory against its limits, memory writes waiting for the owner,
// reflections and learned skills.
//
// Everything is written through Helena's own services (updateAgent, setAgentSkills,
// setProjectAssignment, setAgentProjectInstructions), exactly what the editor in Helena
// calls, so each agent's runtime policy gets a new revision and its runner rewrites the
// profile by itself. Nothing here touches a file of a Hermes home.
//
// Run once by the operator, as the API's user with the API's environment:
//
//   bun src/scripts/agent-tuning.ts                      # dry run: the plan and the report
//   bun src/scripts/agent-tuning.ts --apply              # writes the default sections
//
// Options: --dry-run (the default), --apply, --sections=skills,tools,instructions,projects,
// reasoning,report (default: all but reasoning), --agent <username> (only these agents and no
// project instructions; repeatable), --team <id> (default: the team of the Home agent).
//
// Running it again changes nothing: it only adds skills, toolsets and disabled skills that
// are missing, and a text replaces only an empty field or the exact text the audit saw.

import {
  agentProposal,
  agentRun,
  agentSkill,
  agentSkillLink,
  aiAgent,
  db,
  organizationProjectAssignment,
  project,
  projectMember,
  teamMember,
} from '@repo/db';
import { and, count, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { getAgentById, normalizeRuntimePolicy, updateAgent } from '#modules/agents/core/service';
import { setAgentSkills } from '#modules/agents/skills/service';
import { setAgentProjectInstructions, setProjectAssignment } from '#modules/organization/service';
import {
  auditState,
  DEFAULT_SECTIONS,
  formatPlan,
  nextPolicy,
  planTuning,
  SECTIONS,
  type Change,
  type CurrentAgent,
  type CurrentState,
  type InventorySkill,
  type Plan,
  type Section,
  type TuningTarget,
} from './agent-tuning/plan';
import { TARGET } from './agent-tuning/target';

export interface TuningOptions {
  apply?: boolean;
  sections?: Section[];
  // Only these agents, and then no project instructions.
  agents?: string[];
  teamId?: number;
  target?: TuningTarget;
  log?: (line: string) => void;
}

const REFLECTION_DAYS = 30;

// The team the tuning is for: the one given, or the one whose Home agent is @master.
async function resolveTeam(teamId?: number): Promise<number> {
  if (teamId !== undefined) return teamId;
  const rows = await db
    .select({ teamId: aiAgent.teamId })
    .from(aiAgent)
    .where(eq(aiAgent.username, 'master'));
  if (rows.length !== 1) throw new Error('Name the team with --team <id>.');
  return rows[0]!.teamId;
}

async function teamOwner(teamId: number): Promise<string> {
  const [owner] = await db
    .select({ userId: teamMember.userId })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.role, 'owner')))
    .limit(1);
  if (!owner) throw new Error(`Team ${teamId} has no owner.`);
  return owner.userId;
}

interface StoredState {
  status?: unknown;
  inventory?: {
    skills?: { name?: unknown; origin?: unknown }[];
    memory?: { file?: unknown; chars?: unknown; content?: unknown }[];
  } | null;
  profile?: { drift?: { key?: unknown; code?: unknown }[] } | null;
}

function inventoryOf(value: unknown): CurrentAgent['inventory'] {
  const inventory = (value as StoredState | null)?.inventory;
  if (!inventory || typeof inventory !== 'object') return null;
  const skills = (Array.isArray(inventory.skills) ? inventory.skills : [])
    .filter((s) => typeof s?.name === 'string')
    .map((s) => ({ name: String(s.name), origin: String(s.origin) as InventorySkill['origin'] }));
  const memory = (Array.isArray(inventory.memory) ? inventory.memory : [])
    .filter((m) => m?.file === 'MEMORY.md' || m?.file === 'USER.md')
    .map((m) => ({
      file: m.file as 'MEMORY.md' | 'USER.md',
      chars:
        typeof m.chars === 'number'
          ? m.chars
          : typeof m.content === 'string'
            ? m.content.length
            : 0,
    }));
  return { skills, memory };
}

// What the tuning reads, all of it from the team's rows; the report half comes from the
// runners' last reports (runtime_state), memory proposals and the runs' reflections.
export async function loadTuningState(teamId: number): Promise<CurrentState> {
  const [agents, links, library, members, assignments, proposals, runs] = await Promise.all([
    db
      .select({
        id: aiAgent.id,
        userId: aiAgent.userId,
        username: aiAgent.username,
        template: aiAgent.template,
        instructions: aiAgent.instructions,
        runtimePolicy: aiAgent.runtimePolicy,
        runtimeState: aiAgent.runtimeState,
        learned: aiAgent.runtimeLearnedSkills,
        triggerOnMention: aiAgent.triggerOnMention,
        triggerOnAssign: aiAgent.triggerOnAssign,
      })
      .from(aiAgent)
      .where(eq(aiAgent.teamId, teamId)),
    db
      .select({ agentId: agentSkillLink.agentId, name: agentSkill.name })
      .from(agentSkillLink)
      .innerJoin(agentSkill, eq(agentSkill.id, agentSkillLink.skillId))
      .where(eq(agentSkill.teamId, teamId)),
    db.select({ name: agentSkill.name }).from(agentSkill).where(eq(agentSkill.teamId, teamId)),
    db
      .select({
        projectId: project.id,
        key: project.key,
        userId: projectMember.userId,
        description: projectMember.description,
      })
      .from(projectMember)
      .innerJoin(project, eq(project.id, projectMember.projectId))
      .where(eq(project.teamId, teamId)),
    db
      .select({
        projectId: organizationProjectAssignment.projectId,
        instructions: organizationProjectAssignment.instructions,
      })
      .from(organizationProjectAssignment)
      .where(eq(organizationProjectAssignment.teamId, teamId)),
    db
      .select({ agentId: agentProposal.agentId, pending: count() })
      .from(agentProposal)
      .where(and(eq(agentProposal.kind, 'memory-write'), eq(agentProposal.status, 'pending')))
      .groupBy(agentProposal.agentId),
    db
      .select({ agentId: agentRun.agentId, reflection: agentRun.reflection })
      .from(agentRun)
      .where(
        and(
          isNotNull(agentRun.reflection),
          gt(agentRun.createdAt, sql`now() - make_interval(days => ${REFLECTION_DAYS})`),
        ),
      ),
  ]);
  const projects = await db
    .select({ id: project.id, key: project.key })
    .from(project)
    .where(eq(project.teamId, teamId));

  return {
    library: library.map((row) => row.name),
    projects: projects.map((row) => ({
      id: row.id,
      key: row.key,
      instructions: assignments.find((a) => a.projectId === row.id)?.instructions ?? '',
    })),
    agents: agents.map((row) => {
      const policy = normalizeRuntimePolicy(row.runtimePolicy);
      const state = (row.runtimeState ?? {}) as StoredState;
      const reflections = runs
        .filter((run) => run.agentId === row.id)
        .map((run) => run.reflection as { status?: string; saved?: unknown[] });
      return {
        id: row.id,
        username: row.username,
        template: row.template,
        runtime: policy.runtime ?? 'hermes',
        instructions: row.instructions,
        soul: policy.files.find((file) => file.path === 'SOUL.md')?.content ?? null,
        toolDeny: policy.toolDeny,
        skillsDisabled: policy.skillsDisabled ?? [],
        reasoningEffort: policy.reasoningEffort,
        skills: links.filter((link) => link.agentId === row.id).map((link) => link.name),
        projects: members
          .filter((member) => member.userId === row.userId)
          .map((member) => ({
            id: member.projectId,
            key: member.key,
            assignment: member.description,
          })),
        triggerOnMention: row.triggerOnMention,
        triggerOnAssign: row.triggerOnAssign,
        inventory: inventoryOf(state),
        status: typeof state.status === 'string' ? state.status : 'offline',
        drift: (state.profile?.drift ?? []).map((entry) => ({
          key: String(entry?.key),
          code: String(entry?.code),
        })),
        learnedSkills: Array.isArray(row.learned) ? row.learned.length : 0,
        pendingMemoryProposals: proposals.find((p) => p.agentId === row.id)?.pending ?? 0,
        reflections: {
          total: reflections.length,
          saved: reflections.filter((r) => Array.isArray(r?.saved) && r.saved.length > 0).length,
          failed: reflections.filter((r) => r?.status === 'failed' || r?.status === 'lost').length,
        },
      };
    }),
  };
}

// Carries the plan out through the services the editor in Helena uses. Each agent's policy
// and instructions go in one update, so its runner applies one new revision.
async function applyPlan(teamId: number, plan: Plan, state: CurrentState): Promise<void> {
  const actor = await teamOwner(teamId);
  const skillIds = new Map(
    (
      await db
        .select({ id: agentSkill.id, name: agentSkill.name })
        .from(agentSkill)
        .where(eq(agentSkill.teamId, teamId))
    ).map((row) => [row.name, row.id]),
  );
  const byAgent = new Map<number, Change[]>();
  for (const change of plan.changes) {
    if (!('agentId' in change)) continue;
    byAgent.set(change.agentId, [...(byAgent.get(change.agentId) ?? []), change]);
  }
  for (const [agentId, changes] of byAgent) {
    const skills = changes.find((c) => c.kind === 'skills');
    if (skills?.kind === 'skills') {
      const removed = new Set(skills.remove.map((r) => r.name));
      const current = state.agents.find((a) => a.id === agentId)?.skills ?? [];
      const names = [...current.filter((name) => !removed.has(name)), ...skills.add];
      await setAgentSkills(
        agentId,
        teamId,
        names.map((name) => skillIds.get(name)).filter((id): id is number => id !== undefined),
      );
    }
    const agent = await getAgentById(agentId, teamId);
    if (!agent) throw new Error(`Agent #${agentId} disappeared`);
    const policy = nextPolicy(agent.runtimePolicy, changes);
    const instructions = changes.find((c) => c.kind === 'instructions');
    if (policy || instructions) {
      await updateAgent(
        agentId,
        teamId,
        {
          ...(policy && { runtimePolicy: policy }),
          ...(instructions?.kind === 'instructions' && { instructions: instructions.to }),
        },
        actor,
      );
    }
    for (const change of changes) {
      if (change.kind === 'assignment') {
        await setAgentProjectInstructions(teamId, agentId, change.projectId, change.to);
      }
    }
  }
  for (const change of plan.changes) {
    if (change.kind === 'projectInstructions') {
      await setProjectAssignment(teamId, change.projectId, { instructions: change.to });
    }
  }
}

export async function runAgentTuning(options: TuningOptions = {}): Promise<Plan> {
  const log = options.log ?? console.log;
  const target = options.target ?? TARGET;
  const teamId = await resolveTeam(options.teamId);
  const sections = options.sections ?? DEFAULT_SECTIONS;
  const only = options.agents?.length ? new Set(options.agents) : null;
  // Limited to some agents, the project-wide instructions are left out: they are no agent's.
  const scoped: TuningTarget = only
    ? { projects: [], agents: target.agents.filter((agent) => only.has(agent.username)) }
    : target;

  const state = await loadTuningState(teamId);
  const plan = planTuning(state, scoped, sections);
  log(
    `Helena agent tuning — ${options.apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}; ` +
      `team ${teamId}; sections: ${sections.join(', ')}` +
      (only ? `; agents: ${[...only].map((name) => `@${name}`).join(', ')}` : ''),
  );
  log('\n== Plan ==');
  const lines = formatPlan(plan);
  for (const line of lines.length ? lines : ['nothing to change']) log(line);

  if (options.apply && plan.changes.length) {
    await applyPlan(teamId, plan, state);
    log(`\nApplied ${plan.changes.length} change(s).`);
    log(
      'Each agent got a new runtime policy revision; its runner rewrites the profile by itself. ' +
        'Hermes keeps the system prompt of a session it continues, so the changes reach new ' +
        'chats and runs; an open chat keeps the old one until it is started anew.',
    );
  } else if (!options.apply) {
    log(
      `\nWould apply ${plan.changes.length} change(s), skip ${plan.skipped.length}. ` +
        'Run with --apply to write.',
    );
  }

  if (sections.includes('report')) {
    log('\n== Report (what the runners last saw) ==');
    const after = options.apply && plan.changes.length ? await loadTuningState(teamId) : state;
    for (const line of auditState(after)) log(line);
  }
  return plan;
}

function args(argv: string[]): TuningOptions {
  const options: TuningOptions = { apply: false, agents: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg.startsWith('--sections=')) {
      const names = arg
        .slice('--sections='.length)
        .split(',')
        .map((s) => s.trim());
      for (const name of names) {
        if (!SECTIONS.includes(name as Section)) throw new Error(`Unknown section ${name}`);
      }
      options.sections = names as Section[];
    } else if (arg === '--agent') options.agents!.push(String(argv[++i] ?? '').replace(/^@/, ''));
    else if (arg === '--team') options.teamId = Number(argv[++i]);
    else throw new Error(`Unknown argument ${arg}`);
  }
  // --dry-run wins over --apply when both are given.
  if (argv.includes('--dry-run')) options.apply = false;
  return options;
}

if (import.meta.main) {
  await runAgentTuning(args(process.argv.slice(2)));
  process.exit(0);
}
