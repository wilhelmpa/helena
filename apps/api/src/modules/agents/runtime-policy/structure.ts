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
    'To get work done in a project, create a task there with the Helena MCP tools, delegate',
    "it to the project's coordinator and follow the task until it is done. Answer questions",
    'that span several projects yourself.',
  ].join('\n');
}

// How the agent's runtime splits one run into parallel parts, if it can. Neither kind of
// helper is a Helena agent.
const SUB_AGENTS: Record<AgentRuntimeKind, string[]> = {
  hermes: [
    'For parallel parts of one run you may start Hermes sub-agents with the delegation',
    'toolset. They are not Helena agents, and Helena does not show them.',
  ],
  claude: [
    'For parallel parts of one run you may start Claude Code subagents with the Task tool.',
    'They are not Helena agents, and Helena does not show them.',
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

// How a specialist or a reviewer of a project's agent team works with it: whom it reports
// to, who else is on the team, and how it hands its work back (owner's audit 2026-09-25,
// docs/helena-decisions/agent-context.md §2). Without it a specialist never read who its
// coordinator is.
export interface TeamPeer {
  username: string;
  capabilities: string[];
}

export function memberSection(input: {
  role: 'specialist' | 'reviewer' | null;
  projectKeys: string[];
  // Whom the agent reports to (organization chart), else null.
  manager: string | null;
  // The coordinators of the agent's projects, named when the agent reports to none of them.
  coordinators: string[];
  // The other specialists and reviewers of those projects.
  peers: TeamPeer[];
}): string {
  const projects = input.projectKeys.join(', ');
  const lead = input.manager
    ? isHomeAgent(input.manager)
      ? `the Home agent (@${input.manager})`
      : `@${input.manager}`
    : input.coordinators.length > 0
      ? handles(input.coordinators)
      : null;
  const what =
    input.role === 'reviewer'
      ? `You review the work of the agent team of ${projects}`
      : `You are a specialist in the agent team of ${projects}`;
  const peers = input.peers.map((peer) =>
    peer.capabilities.length > 0
      ? `@${peer.username} (${peer.capabilities.join(', ')})`
      : `@${peer.username}`,
  );
  return [
    '## Agent team',
    `${what}${lead ? ` and report to ${lead}` : ''}. Your work comes from ${lead ?? "the project's owners"}: tasks delegated or assigned to you, a mention in a comment, or a stage of the agent team.`,
    ...(peers.length > 0
      ? [
          `The team's other members: ${peers.join(', ')}. Work that fits one of them better goes back to ${lead ?? 'the person who gave it to you'}; do not hand it over yourself.`,
        ]
      : []),
    '',
    'Handing your work back:',
    "- In a stage of the agent team, answer with exactly the JSON the stage asks for. Helena puts it on the task and your coordinator reviews it; do not change the task's status yourself there.",
    "- On a task given to you directly, finish with a short comment on it (add_comment): what you did, what is verified, what is left. Then move it to its completed state, or to the project's review column where it has one.",
    `- Tag ${lead ?? 'the person who gave you the task'} in that comment only when they have to act on it.`,
    '- Before anything with effects outside Helena (push, deploy, send, publish, pay, delete), ask with request_approval where the approval rules require it, then end the run.',
    '- When only a person can decide how to go on, call mark_issue_blocked with one clear question and stop.',
  ].join('\n');
}

// The agents of the agent team of these projects: their project, role and capabilities.
async function teamMembers(
  teamId: number,
  projectIds: number[],
): Promise<{ projectId: number; username: string; role: string | null; capabilities: string[] }[]> {
  if (projectIds.length === 0) return [];
  return db
    .select({
      projectId: projectMember.projectId,
      username: aiAgent.username,
      role: organizationAgentAssignment.role,
      capabilities: organizationAgentAssignment.capabilities,
    })
    .from(aiAgent)
    .innerJoin(
      organizationAgentAssignment,
      and(
        eq(organizationAgentAssignment.agentId, aiAgent.id),
        eq(organizationAgentAssignment.teamId, aiAgent.teamId),
      ),
    )
    .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
    .where(and(eq(aiAgent.teamId, teamId), inArray(projectMember.projectId, projectIds)))
    .orderBy(asc(aiAgent.username));
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
// project work to the coordinators, a coordinator reports to Home and leads the project's
// specialists, and a specialist or reviewer reports to its coordinator (or whoever the
// organization chart names) and hands its work back. Empty for an agent outside the chain.
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
  if (projectIds.length === 0) return '';
  if (assignment?.role === 'coordinator') {
    const specialists = await roleHolders(agent.teamId, projectIds, 'specialist');
    return coordinatorSection({
      projectKeys: agent.projects.map((p) => p.key),
      manager: assignment.manager,
      specialists: [...new Set([...specialists.values()].flat())],
      runtime: agent.runtimePolicy.runtime ?? 'hermes',
    });
  }
  // A specialist or reviewer, or an agent the organization chart puts under someone: it
  // learns its place in the chain. An agent in no team and under nobody gets nothing.
  const role =
    assignment?.role === 'specialist' || assignment?.role === 'reviewer' ? assignment.role : null;
  if (!role && !assignment?.manager) return '';
  const members = await teamMembers(agent.teamId, projectIds);
  const others = members.filter((member) => member.username !== agent.username);
  const unique = (names: string[]) => [...new Set(names)];
  const peers = new Map<string, string[]>();
  for (const member of others) {
    if (member.role !== 'specialist' && member.role !== 'reviewer') continue;
    peers.set(member.username, member.capabilities ?? []);
  }
  return memberSection({
    role,
    projectKeys: agent.projects.map((p) => p.key),
    manager: assignment?.manager ?? null,
    coordinators: unique(
      others.filter((member) => member.role === 'coordinator').map((member) => member.username),
    ),
    peers: [...peers].map(([username, capabilities]) => ({ username, capabilities })),
  });
}
