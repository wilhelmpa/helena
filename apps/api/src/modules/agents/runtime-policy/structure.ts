import { aiAgent, db, organizationAgentAssignment, projectMember } from '@repo/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { isHomeAgent } from '../core/home-agent';
import type { AgentRuntimeKind, AiAgentRow } from '../core/service';

const handles = (usernames: string[]) => usernames.map((username) => `@${username}`).join(', ');

export function homeAgentSection(
  projects: { key: string; name: string; coordinators: string[] }[],
): string {
  return [
    '## Home agent',
    "You are the Home agent, the master of this team's agents. People work with you in",
    'Home; the views of a project do not list you.',
    ...(projects.length > 0
      ? [
          '',
          'Each project is led by its coordinator:',
          ...projects.map(
            (p) =>
              `- ${p.key} — "${p.name}": ${p.coordinators.length > 0 ? handles(p.coordinators) : 'no coordinator'}`,
          ),
        ]
      : []),
    '',
    'To get work done in a project, create a task there with the Plan MCP tools, delegate',
    "it to the project's coordinator and follow the task until it is done. Answer questions",
    'that span several projects yourself.',
  ].join('\n');
}

// How the agent's runtime splits one run into parallel parts, if it can. Neither kind of
// helper is a Helena agent.
const SUB_AGENTS: Record<AgentRuntimeKind, string[]> = {
  hermes: [
    'For parallel parts of one run you may start Hermes sub-agents with the delegation',
    'toolset. They are not Plan agents, and Plan does not show them.',
  ],
  claude: [
    'For parallel parts of one run you may start Claude Code subagents with the Task tool.',
    'They are not Plan agents, and Plan does not show them.',
  ],
  codex: [],
};

export function coordinatorSection(input: {
  projectKeys: string[];
  manager: string | null;
  specialists: string[];
  runtime?: AgentRuntimeKind;
}): string {
  const manager =
    input.manager == null
      ? ''
      : isHomeAgent(input.manager)
        ? ` and report to the Home agent (@${input.manager})`
        : ` and report to @${input.manager}`;
  return [
    '## Agent team',
    `You coordinate the agent team of ${input.projectKeys.join(', ')}${manager}.`,
    ...SUB_AGENTS[input.runtime ?? 'hermes'],
    "Longer or specialist work goes to the project's specialists through the agent team",
    input.specialists.length > 0
      ? `instead: ${handles(input.specialists)}.`
      : 'instead; the project has none yet.',
  ].join('\n');
}

// The handles of the agents holding that agent-team role, per project.
async function roleHolders(
  teamId: number,
  projectIds: number[],
  role: 'coordinator' | 'specialist',
): Promise<Map<number, string[]>> {
  const byProject = new Map<number, string[]>();
  if (projectIds.length === 0) return byProject;
  const rows = await db
    .select({ projectId: projectMember.projectId, username: aiAgent.username })
    .from(aiAgent)
    .innerJoin(
      organizationAgentAssignment,
      and(
        eq(organizationAgentAssignment.agentId, aiAgent.id),
        eq(organizationAgentAssignment.teamId, aiAgent.teamId),
      ),
    )
    .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
    .where(
      and(
        eq(aiAgent.teamId, teamId),
        eq(organizationAgentAssignment.role, role),
        inArray(projectMember.projectId, projectIds),
      ),
    )
    .orderBy(asc(aiAgent.username));
  for (const row of rows)
    byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row.username]);
  return byProject;
}

const manager = alias(aiAgent, 'manager');

// The agent's place in the team's structure, as a SOUL.md section: the Home agent hands
// project work to the coordinators, and a coordinator reports to Home and leads the
// project's specialists. Empty for every other agent.
export async function structureSection(agent: AiAgentRow): Promise<string> {
  const projectIds = agent.projects.map((p) => p.id);
  if (isHomeAgent(agent.username)) {
    const coordinators = await roleHolders(agent.teamId, projectIds, 'coordinator');
    return homeAgentSection(
      agent.projects.map((p) => ({
        key: p.key,
        name: p.name,
        coordinators: coordinators.get(p.id) ?? [],
      })),
    );
  }
  const [assignment] = await db
    .select({ role: organizationAgentAssignment.role, manager: manager.username })
    .from(organizationAgentAssignment)
    .leftJoin(manager, eq(manager.id, organizationAgentAssignment.reportsToAgentId))
    .where(
      and(
        eq(organizationAgentAssignment.teamId, agent.teamId),
        eq(organizationAgentAssignment.agentId, agent.id),
      ),
    );
  if (assignment?.role !== 'coordinator' || projectIds.length === 0) return '';
  const specialists = await roleHolders(agent.teamId, projectIds, 'specialist');
  return coordinatorSection({
    projectKeys: agent.projects.map((p) => p.key),
    manager: assignment.manager,
    specialists: [...new Set([...specialists.values()].flat())],
    runtime: agent.runtimePolicy.runtime ?? 'hermes',
  });
}
