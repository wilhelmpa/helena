import { createHash } from 'node:crypto';
import type { BundleBudget, BundleDepartment, TemplateBundle } from '@helena/sdk';
import {
  aiAgent,
  db,
  helenaBudget,
  helenaSchedule,
  organizationAgentAssignment,
  organizationDepartment,
  organizationGoal,
  project,
  projectMember,
} from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import {
  createDepartment,
  createGoal,
  setAgentAssignment,
  updateDepartment,
  updateGoal,
} from '#modules/organization/service';
import { routineIdempotencyKey } from '#modules/project-blueprints/plan';
import { departmentSkills, setDepartmentSkills } from '#modules/organization/skills';
import { setBudgets } from '#modules/autopilot/budgets';
import { createRoutine } from '#modules/routines/service';
import {
  addAgentMcpServers,
  addAgentSkills,
  exportBundle,
  importBundle,
  SyncLog,
  type AgentRow,
  type Organization,
} from './sync';

type Department = NonNullable<TemplateBundle['department']>;
type RosterMember = Department['agents'][number];
type ExistingAgent = AgentRow & {
  projects: { key: string }[];
  heartbeatIntervalMinutes: number | null;
  heartbeatTimezone: string;
  heartbeatDays: number[];
  heartbeatStart: string;
  heartbeatEnd: string;
  heartbeatInstructions: string;
};

const budgetData = (
  rows: { metric: string; period: string; limitValue: number }[],
): BundleBudget[] =>
  rows.map((row) => ({
    metric: row.metric as BundleBudget['metric'],
    period: row.period as BundleBudget['period'],
    limit: row.limitValue,
  }));

const budgetsEqual = (a: BundleBudget[], b: BundleBudget[]) =>
  a.length === b.length &&
  a.every((entry) =>
    b.some(
      (other) =>
        entry.metric === other.metric &&
        entry.period === other.period &&
        entry.limit === other.limit,
    ),
  );

function routineKey(projectKey: string, agent: string, title: string): string {
  return createHash('sha256')
    .update(`${projectKey}\0${agent}\0${title}`)
    .digest('hex')
    .slice(0, 24);
}

export async function exportDepartmentBundle(
  log: SyncLog,
  teamId: number,
  departmentId: number,
): Promise<TemplateBundle> {
  const [department] = await db
    .select()
    .from(organizationDepartment)
    .where(
      and(eq(organizationDepartment.id, departmentId), eq(organizationDepartment.teamId, teamId)),
    );
  if (!department) throw new HttpError(404, 'Department not found');
  const assignments = await db
    .select({
      id: aiAgent.id,
      name: aiAgent.username,
      role: organizationAgentAssignment.role,
      reportsToId: organizationAgentAssignment.reportsToAgentId,
      intervalMinutes: aiAgent.heartbeatIntervalMinutes,
      timezone: aiAgent.heartbeatTimezone,
      days: aiAgent.heartbeatDays,
      start: aiAgent.heartbeatStart,
      end: aiAgent.heartbeatEnd,
      instructions: aiAgent.heartbeatInstructions,
    })
    .from(organizationAgentAssignment)
    .innerJoin(aiAgent, eq(aiAgent.id, organizationAgentAssignment.agentId))
    .where(
      and(
        eq(organizationAgentAssignment.departmentId, departmentId),
        eq(organizationAgentAssignment.teamId, teamId),
        eq(aiAgent.template, false),
      ),
    );
  const agentIds = assignments.map((row) => row.id);
  const [policy, agentProjects, budgets, goals, routines, allProjects] = await Promise.all([
    departmentSkills(teamId, departmentId),
    agentIds.length
      ? db
          .select({ agentId: aiAgent.id, key: project.key })
          .from(aiAgent)
          .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
          .innerJoin(project, eq(project.id, projectMember.projectId))
          .where(inArray(aiAgent.id, agentIds))
      : Promise.resolve([]),
    db.select().from(helenaBudget).where(eq(helenaBudget.teamId, teamId)),
    db
      .select()
      .from(organizationGoal)
      .where(
        and(eq(organizationGoal.teamId, teamId), eq(organizationGoal.departmentId, departmentId)),
      ),
    agentIds.length
      ? db
          .select({
            projectKey: project.key,
            agentId: helenaSchedule.agentId,
            title: helenaSchedule.title,
            instructions: helenaSchedule.instructions,
            cron: helenaSchedule.cron,
            timezone: helenaSchedule.timezone,
            catchUp: helenaSchedule.catchUp,
          })
          .from(helenaSchedule)
          .innerJoin(project, eq(project.id, helenaSchedule.projectId))
          .where(
            and(
              inArray(helenaSchedule.agentId, agentIds),
              eq(helenaSchedule.kind, 'routine'),
              eq(helenaSchedule.mode, 'new'),
            ),
          )
      : Promise.resolve([]),
    db.select({ id: project.id, key: project.key }).from(project).where(eq(project.teamId, teamId)),
  ]);
  const byId = new Map(assignments.map((row) => [row.id, row.name]));
  const roster: RosterMember[] = assignments.map((row) => ({
    name: row.name,
    role: row.role as RosterMember['role'],
    reportsTo: row.reportsToId ? (byId.get(row.reportsToId) ?? null) : null,
    projects: agentProjects
      .filter((entry) => entry.agentId === row.id)
      .map((entry) => entry.key)
      .sort(),
    heartbeat: {
      intervalMinutes: row.intervalMinutes,
      timezone: row.timezone,
      days: row.days,
      start: row.start,
      end: row.end,
      instructions: row.instructions,
    },
    budgets: budgetData(budgets.filter((entry) => entry.agentId === row.id)),
  }));
  const departmentData: BundleDepartment = {
    name: department.name,
    description: department.description,
    restrictedSkills: policy.restricted,
    allowedSkills: policy.skills.map((skill) => skill.name),
    budgets: budgetData(budgets.filter((entry) => entry.departmentId === departmentId)),
    agents: roster,
    goals: goals.map((goal) => ({
      title: goal.title,
      description: goal.description,
      status: goal.status as BundleDepartment['goals'][number]['status'],
      targetDate: goal.targetDate,
      parent: goal.parentGoalId
        ? (goals.find((entry) => entry.id === goal.parentGoalId)?.title ?? null)
        : null,
      project: goal.projectId
        ? (allProjects.find((entry) => entry.id === goal.projectId)?.key ?? null)
        : null,
    })),
    routines: routines.map((row) => ({
      key: routineKey(row.projectKey, byId.get(row.agentId!)!, row.title),
      project: row.projectKey,
      agent: byId.get(row.agentId!)!,
      title: row.title,
      instructions: row.instructions,
      cron: row.cron,
      timezone: row.timezone,
      catchUp: row.catchUp as 'skip' | 'once',
    })),
  };
  const bundle = await exportBundle(log, teamId, {
    workingAgents: true,
    agents: roster.map((row) => row.name),
    extraSkills: departmentData.allowedSkills,
    includeMcpServers: false,
    name:
      department.name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 64) || 'department',
    displayName: department.name,
    description: `Department template: ${department.name}`,
  });
  return {
    ...bundle,
    skills: departmentData.restrictedSkills
      ? bundle.skills.filter((skill) => departmentData.allowedSkills.includes(skill.name))
      : bundle.skills,
    agents: departmentData.restrictedSkills
      ? bundle.agents.map((agent) => ({
          ...agent,
          skills: agent.skills.filter((name) => departmentData.allowedSkills.includes(name)),
        }))
      : bundle.agents,
    department: departmentData,
  };
}

async function applyBudgets(
  log: SyncLog,
  teamId: number,
  target: { departmentId: number } | { agentId: number },
  wanted: BundleBudget[],
  userId: string,
) {
  const stored = await db
    .select()
    .from(helenaBudget)
    .where(
      'agentId' in target
        ? eq(helenaBudget.agentId, target.agentId)
        : eq(helenaBudget.departmentId, target.departmentId),
    );
  const current = budgetData(stored);
  if (budgetsEqual(current, wanted)) {
    log.ok('budgets');
    return;
  }
  if (current.length && !log.differs('budgets differ')) return;
  await log.write('set budgets', () =>
    setBudgets(
      teamId,
      target,
      [
        ...wanted,
        ...current
          .filter(
            (entry) =>
              !wanted.some(
                (other) => other.metric === entry.metric && other.period === entry.period,
              ),
          )
          .map((entry) => ({ ...entry, limit: null })),
      ],
      userId,
    ),
  );
}

function heartbeatBody(member: RosterMember) {
  return {
    heartbeatIntervalMinutes: member.heartbeat.intervalMinutes,
    heartbeatTimezone: member.heartbeat.timezone,
    heartbeatDays: member.heartbeat.days,
    heartbeatStart: member.heartbeat.start,
    heartbeatEnd: member.heartbeat.end,
    heartbeatInstructions: member.heartbeat.instructions,
  };
}

export async function importDepartmentBundle(
  log: SyncLog,
  teamId: number,
  userId: string,
  bundle: TemplateBundle,
): Promise<void> {
  const template = bundle.department;
  if (!template) throw new HttpError(400, 'Bundle has no department');
  const { skillIds, serverIds } = await importBundle(log, teamId, bundle, { skipAgents: true });
  const [org, agents, projects] = await Promise.all([
    log.api<Organization>('GET', `/teams/${teamId}/organization`),
    log.api<ExistingAgent[]>('GET', `/teams/${teamId}/ai-agents`),
    db.select({ id: project.id, key: project.key }).from(project).where(eq(project.teamId, teamId)),
  ]);
  let department = org.departments.find((entry) => entry.name === template.name);
  if (!department) {
    const created = await log.write(`create department ${template.name}`, () =>
      createDepartment(teamId, { name: template.name, description: template.description }),
    );
    if (created) department = created;
  } else {
    const [current] = await db
      .select({ description: organizationDepartment.description })
      .from(organizationDepartment)
      .where(eq(organizationDepartment.id, department.id));
    if (current?.description === template.description) log.ok('department description');
    else if (log.differs('department description differs'))
      await log.write('update department description', () =>
        updateDepartment(teamId, department!.id, { description: template.description }),
      );
  }
  const departmentId = department?.id ?? -1;
  if (departmentId > 0) {
    const policy = await departmentSkills(teamId, departmentId);
    const wantedIds = template.allowedSkills
      .map((name) => skillIds.get(name))
      .filter((id): id is number => id != null);
    if (wantedIds.length !== template.allowedSkills.length && !log.opts.dryRun)
      throw new Error('A department skill was not imported');
    const same =
      policy.restricted === template.restrictedSkills &&
      policy.skills
        .map((skill) => skill.name)
        .sort()
        .join('\0') === [...template.allowedSkills].sort().join('\0');
    if (same) log.ok('department skill policy');
    else if (
      (!policy.restricted && !policy.skills.length) ||
      log.differs('department skill policy differs')
    )
      await log.write('set department skill policy', () =>
        setDepartmentSkills(teamId, departmentId, {
          restricted: template.restrictedSkills,
          skillIds: wantedIds,
        }),
      );
    await applyBudgets(log, teamId, { departmentId }, template.budgets, userId);
  } else {
    log.log('[DRY-RUN] would set department skill policy and budgets');
  }
  const ids = new Map<string, number>();
  for (const member of template.agents) {
    const spec = bundle.agents.find((entry) => entry.name === member.name)!;
    const found = agents.find(
      (entry) => entry.username.toLowerCase() === member.name.toLowerCase(),
    );
    if (found?.template) {
      log.warn(`@${member.name} is a template, not a working agent`);
      continue;
    }
    const previousAssignment = found ? org.agents.find((entry) => entry.id === found.id) : null;
    if (
      previousAssignment?.departmentId &&
      previousAssignment.departmentId !== departmentId &&
      !log.opts.update
    ) {
      log.differs(`@${member.name} belongs to another department`);
      continue;
    }
    const projectIds = member.projects.flatMap((key) => {
      const row = projects.find((entry) => entry.key === key);
      if (!row) log.warn(`Project ${key} is missing for @${member.name}`);
      return row ? [row.id] : [];
    });
    const body = {
      name: spec.helena.displayName,
      username: spec.name,
      kind: 'external',
      template: false,
      projectIds,
      instructions: spec.instructions,
      model: spec.model,
      runtimePolicy: {
        reasoningEffort: spec.effort,
        toolAllow: [],
        toolDeny: spec.disallowedTools,
        mcpGrants: [],
        files: [],
        ...(spec.maxTurns ? { maxTurns: spec.maxTurns } : {}),
        ...(spec.helena.runBudgetSeconds ? { runBudgetSeconds: spec.helena.runBudgetSeconds } : {}),
      },
      triggerOnMention: spec.helena.triggers.mention,
      triggerOnAssign: spec.helena.triggers.assign,
      runnerScope: 'team',
      ...heartbeatBody(member),
    };
    let id = found?.id ?? -1;
    if (!found) {
      const created = await log.write(`create agent @${member.name}`, () =>
        log.api<{ agent: { id: number } }>('POST', `/teams/${teamId}/ai-agents`, body),
      );
      if (created) id = created.agent.id;
    } else {
      ids.set(member.name, id);
      const same =
        found.name === body.name &&
        found.instructions === body.instructions &&
        found.model === body.model &&
        found.triggerOnMention === body.triggerOnMention &&
        found.triggerOnAssign === body.triggerOnAssign &&
        found.runtimePolicy.reasoningEffort === spec.effort &&
        [...found.runtimePolicy.toolDeny].sort().join(',') ===
          [...spec.disallowedTools].sort().join(',') &&
        (found.runtimePolicy.maxTurns ?? null) === spec.maxTurns &&
        (found.runtimePolicy.runBudgetSeconds ?? null) === spec.helena.runBudgetSeconds &&
        found.projects
          .map((entry) => entry.key)
          .sort()
          .join(',') ===
          member.projects
            .filter((key) => projects.some((entry) => entry.key === key))
            .sort()
            .join(',') &&
        found.heartbeatIntervalMinutes === body.heartbeatIntervalMinutes &&
        found.heartbeatTimezone === body.heartbeatTimezone &&
        found.heartbeatDays.join(',') === body.heartbeatDays.join(',') &&
        found.heartbeatStart === body.heartbeatStart &&
        found.heartbeatEnd === body.heartbeatEnd &&
        found.heartbeatInstructions === body.heartbeatInstructions;
      if (same) log.ok(`agent @${member.name}`);
      else if (log.differs(`agent @${member.name} differs`))
        await log.write(`update agent @${member.name}`, () =>
          log.api('PATCH', `/teams/${teamId}/ai-agents/${id}`, {
            ...body,
            runtimePolicy: {
              ...found.runtimePolicy,
              reasoningEffort: spec.effort,
              toolDeny: spec.disallowedTools,
              ...(spec.maxTurns == null ? { maxTurns: null } : { maxTurns: spec.maxTurns }),
              ...(spec.helena.runBudgetSeconds == null
                ? { runBudgetSeconds: null }
                : { runBudgetSeconds: spec.helena.runBudgetSeconds }),
            },
          }),
        );
    }
    if (id < 0) {
      log.log(`[DRY-RUN] would assign @${member.name} and its skills, budgets and heartbeat`);
      continue;
    }
    ids.set(member.name, id);
    const current = org.agents.find((entry) => entry.id === id);
    if (
      current?.departmentId !== departmentId ||
      current.role !== member.role ||
      current.roleTitle !== spec.helena.roleTitle ||
      current.capabilities.join(',') !== spec.helena.capabilities.join(',')
    ) {
      if (!current?.departmentId || log.differs(`assignment of @${member.name} differs`))
        await log.write(`assign @${member.name} to ${template.name}`, () =>
          setAgentAssignment(teamId, id, {
            departmentId,
            reportsToAgentId: current?.reportsToAgentId ?? null,
            role: member.role,
            roleTitle: spec.helena.roleTitle,
            capabilities: spec.helena.capabilities,
            runtimeAgentId: current?.runtimeAgentId ?? null,
          }),
        );
    } else log.ok(`assignment of @${member.name}`);
    await addAgentSkills(log, teamId, { id, username: member.name }, spec.skills, skillIds);
    await addAgentMcpServers(
      log,
      teamId,
      { id, username: member.name },
      spec.mcpServers,
      serverIds,
    );
    await applyBudgets(log, teamId, { agentId: id }, member.budgets, userId);
  }
  for (const member of template.agents.filter((entry) => entry.reportsTo)) {
    const id = ids.get(member.name);
    const managerId = ids.get(member.reportsTo!);
    if (!id || !managerId) {
      log.log(`[DRY-RUN] would set reporting line for @${member.name}`);
      continue;
    }
    const current = org.agents.find((entry) => entry.id === id);
    if (current?.reportsToAgentId === managerId) {
      log.ok(`reporting line of @${member.name}`);
      continue;
    }
    if (current?.reportsToAgentId && !log.differs(`reporting line of @${member.name} differs`))
      continue;
    const spec = bundle.agents.find((entry) => entry.name === member.name)!;
    await log.write(`set reporting line of @${member.name}`, () =>
      setAgentAssignment(teamId, id, {
        departmentId,
        reportsToAgentId: managerId,
        role: member.role,
        roleTitle: spec.helena.roleTitle,
        capabilities: spec.helena.capabilities,
        runtimeAgentId: current?.runtimeAgentId ?? null,
      }),
    );
  }
  const existingGoals =
    departmentId > 0
      ? await db
          .select()
          .from(organizationGoal)
          .where(
            and(
              eq(organizationGoal.teamId, teamId),
              eq(organizationGoal.departmentId, departmentId),
            ),
          )
      : [];
  const goalIds = new Map(existingGoals.map((goal) => [goal.title, goal.id]));
  const pending = [...template.goals];
  while (pending.length) {
    const index = pending.findIndex((goal) => !goal.parent || goalIds.has(goal.parent));
    if (index < 0) {
      log.warn('Goal hierarchy cannot be imported');
      break;
    }
    const goal = pending.splice(index, 1)[0]!;
    const goalProject = goal.project ? projects.find((entry) => entry.key === goal.project) : null;
    if (goal.project && !goalProject) {
      log.warn(`Goal ${goal.title}: project ${goal.project} is missing`);
      continue;
    }
    const found = existingGoals.find((entry) => entry.title === goal.title);
    if (found) {
      const parentId = goal.parent ? (goalIds.get(goal.parent) ?? null) : null;
      if (
        found.description === goal.description &&
        found.status === goal.status &&
        found.targetDate === goal.targetDate &&
        found.projectId === (goalProject?.id ?? null) &&
        found.parentGoalId === parentId
      )
        log.ok(`goal ${goal.title}`);
      else if (log.differs(`goal ${goal.title} differs`))
        await log.write(`update goal ${goal.title}`, () =>
          updateGoal(teamId, found.id, {
            description: goal.description,
            status: goal.status,
            targetDate: goal.targetDate,
            parentGoalId: parentId,
            projectId: goalProject?.id ?? null,
          }),
        );
      continue;
    }
    const created = await log.write(`create goal ${goal.title}`, () =>
      createGoal(teamId, {
        title: goal.title,
        description: goal.description,
        departmentId,
        projectId: goalProject?.id ?? null,
        parentGoalId: goal.parent ? (goalIds.get(goal.parent) ?? null) : null,
        status: goal.status,
        targetDate: goal.targetDate,
      }),
    );
    if (created) goalIds.set(goal.title, created.id);
    else if (log.opts.dryRun) goalIds.set(goal.title, -1);
  }
  for (const routine of template.routines) {
    const owner = projects.find((entry) => entry.key === routine.project);
    const agentId = ids.get(routine.agent);
    if (!owner) {
      log.warn(`Routine ${routine.key}: project or agent is missing`);
      continue;
    }
    if (!agentId) {
      if (log.opts.dryRun) log.log(`[DRY-RUN] would create disabled routine ${routine.title}`);
      else log.warn(`Routine ${routine.key}: agent is missing`);
      continue;
    }
    const key = routineIdempotencyKey(
      template.name,
      routine.project,
      routineKey(routine.project, routine.agent, routine.title),
    );
    const [existing] = await db
      .select({ id: helenaSchedule.id })
      .from(helenaSchedule)
      .where(and(eq(helenaSchedule.projectId, owner.id), eq(helenaSchedule.scheduleKey, key)));
    if (existing) {
      log.ok(`routine ${routine.title}`);
      continue;
    }
    await log.write(`create disabled routine ${routine.title}`, () =>
      createRoutine({ ...owner, name: owner.key, teamId }, userId, {
        idempotencyKey: key,
        agentId,
        title: routine.title,
        instructions: routine.instructions,
        mode: 'new',
        cron: routine.cron,
        timezone: routine.timezone,
        catchUp: routine.catchUp,
        enabled: false,
      }),
    );
  }
}
