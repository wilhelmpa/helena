import { auth } from '@repo/auth';
import {
  aiAgent,
  db,
  organizationAgentAssignment,
  project,
  projectMember,
  teamMember,
  user,
} from '@repo/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { HOME_AGENT_USERNAME, isHomeAgent } from '#modules/agents/core/home-agent';
import { createAgent, regenerateKey } from '#modules/agents/core/service';
import {
  createHermesProjectCoordinator,
  hermesProjectCoordinatorUsername,
  isHermesProjectCoordinatorUsername,
} from '#modules/projects/service';
import { getDefaultRoleId } from '#modules/roles/service';

export type HomeAgentBootstrapResult =
  { status: 'pending' } | { status: 'ready'; agentId: number; apiKey: string };

// Kept byte-identical to Hermes v0.21.4's auto-seeded default SOUL.md. Plan owns this
// canonical copy for newly bootstrapped Home agents; existing agents are never rewritten.
export const HOME_AGENT_SOUL =
  'You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of ' +
  'the ask — a one-line question gets a one-line answer, and finished work gets a short report of what ' +
  'changed, what\'s verified, and what\'s left, never a replay of the process. No filler ("Great question," ' +
  '"I\'d be happy to"), no restating the request back, no re-summarizing what you already said, no narrating ' +
  "tool calls the user can see. Plain claims over adjectives; when unsure, say so plainly. Agree because it's " +
  'right, not because the user said it. Depth is earned — give it when the user asks for detail, teaches, or ' +
  'the stakes demand it, not by default.';

const HOME_AGENT_INSTRUCTIONS = [
  'You are the Home agent, the master of all agents of this system.',
  'You help set up and run the whole system.',
  'Work across projects, keep tasks traceable in Plan, and take no external action without explicit approval.',
].join(' ');

export interface ProjectCoordinatorBootstrapResult {
  project: { id: number; teamId: number; key: string; name: string; description: string };
  agent: { id: number; userId: string; username: string };
  // Null when the caller's current key is still valid for the coordinator.
  apiKey: string | null;
  projectInstructions: string;
  agentInstructions: string;
}

async function isAgentKey(userId: string, apiKey: string): Promise<boolean> {
  const verified = await auth.api.verifyApiKey({ body: { key: apiKey } });
  return verified.valid && verified.key?.referenceId === userId;
}

// A key is issued only when the caller holds none that still works, because issuing
// one revokes the key the Hermes runner is using.
async function currentOrNewKey(
  agent: { id: number; userId: string },
  teamId: number,
  currentApiKey: string | undefined,
): Promise<string | null> {
  if (currentApiKey && (await isAgentKey(agent.userId, currentApiKey))) return null;
  const apiKey = await regenerateKey(agent.id, teamId);
  if (!apiKey) throw new Error('The agent could not be keyed');
  return apiKey;
}

export async function bootstrapProjectCoordinator(
  projectId: number,
  currentApiKey?: string,
): Promise<ProjectCoordinatorBootstrapResult | null> {
  const [target] = await db
    .select({
      id: project.id,
      teamId: project.teamId,
      key: project.key,
      name: project.name,
      description: project.description,
      ownerUserId: projectMember.userId,
    })
    .from(project)
    .innerJoin(
      projectMember,
      and(eq(projectMember.projectId, project.id), eq(projectMember.role, 'owner')),
    )
    .where(eq(project.id, projectId))
    .orderBy(asc(projectMember.createdAt))
    .limit(1);
  if (!target) return null;

  const username = hermesProjectCoordinatorUsername(target.key);
  let [agent] = await db
    .select({ id: aiAgent.id, userId: aiAgent.userId, username: aiAgent.username })
    .from(aiAgent)
    .where(and(eq(aiAgent.teamId, target.teamId), eq(aiAgent.username, username)))
    .limit(1);
  if (!agent) {
    const roleId = await getDefaultRoleId(target.teamId);
    await db.transaction((tx) =>
      createHermesProjectCoordinator(tx, {
        projectId: target.id,
        teamId: target.teamId,
        projectKey: target.key,
        projectName: target.name,
        ownerUserId: target.ownerUserId,
        roleId,
      }),
    );
    [agent] = await db
      .select({ id: aiAgent.id, userId: aiAgent.userId, username: aiAgent.username })
      .from(aiAgent)
      .where(and(eq(aiAgent.teamId, target.teamId), eq(aiAgent.username, username)))
      .limit(1);
  }
  if (!agent) throw new Error('The project coordinator could not be created');
  const apiKey = await currentOrNewKey(agent, target.teamId, currentApiKey);
  const [full] = await db
    .select({ instructions: aiAgent.instructions })
    .from(aiAgent)
    .where(eq(aiAgent.id, agent.id))
    .limit(1);
  return {
    project: {
      id: target.id,
      teamId: target.teamId,
      key: target.key,
      name: target.name,
      description: target.description,
    },
    agent,
    apiKey,
    projectInstructions: '',
    agentInstructions: full?.instructions ?? '',
  };
}

export interface ProjectAgentBootstrapResult {
  agent: { id: number; userId: string; username: string };
  // Null when the caller's current key is still valid for the agent.
  apiKey: string | null;
}

// An external agent of the project with a Hermes runtime of its own. The Home agent and
// the coordinators have theirs already. An agent that works in another project as well
// has none, because the runner claims an agent's runs from all of its projects with one
// working directory. The worker picks the agents by the same rule.
export async function bootstrapProjectAgent(
  projectId: number,
  agentId: number,
  currentApiKey?: string,
): Promise<ProjectAgentBootstrapResult | null> {
  const [agent] = await db
    .select({
      id: aiAgent.id,
      userId: aiAgent.userId,
      username: aiAgent.username,
      teamId: aiAgent.teamId,
      runtime: sql<string | null>`${aiAgent.runtimePolicy}->>'runtime'`,
      projects: sql<number>`(select count(*)::int from ${projectMember} where ${projectMember.userId} = ${aiAgent.userId})`,
    })
    .from(aiAgent)
    .innerJoin(
      projectMember,
      and(eq(projectMember.userId, aiAgent.userId), eq(projectMember.projectId, projectId)),
    )
    .innerJoin(project, and(eq(project.id, projectId), eq(project.teamId, aiAgent.teamId)))
    .where(eq(aiAgent.id, agentId))
    .limit(1);
  if (
    !agent ||
    isHomeAgent(agent.username) ||
    isHermesProjectCoordinatorUsername(agent.username) ||
    agent.projects !== 1 ||
    // A Claude Code or Codex agent runs on a runner of that preset, not in Hermes.
    (agent.runtime ?? 'hermes') !== 'hermes'
  ) {
    return null;
  }
  return {
    agent: { id: agent.id, userId: agent.userId, username: agent.username },
    apiKey: await currentOrNewKey(agent, agent.teamId, currentApiKey),
  };
}

export async function bootstrapHomeAgent(): Promise<HomeAgentBootstrapResult> {
  const [owner] = await db
    .select({ userId: user.id, teamId: teamMember.teamId })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(and(eq(user.role, 'god'), eq(teamMember.role, 'owner')))
    .orderBy(asc(user.createdAt), asc(teamMember.teamId))
    .limit(1);

  if (!owner) return { status: 'pending' };

  const [existing] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(and(eq(aiAgent.teamId, owner.teamId), eq(aiAgent.username, HOME_AGENT_USERNAME)))
    .limit(1);

  if (existing) {
    const apiKey = await regenerateKey(existing.id, owner.teamId);
    if (!apiKey) throw new Error('The existing Home agent could not be re-keyed');
    return { status: 'ready', agentId: existing.id, apiKey };
  }

  const created = await createAgent(owner.teamId, {
    name: 'Home',
    username: HOME_AGENT_USERNAME,
    projectIds: [],
    ownerUserId: owner.userId,
    runnerScope: 'owner',
    instructions: HOME_AGENT_INSTRUCTIONS,
    triggerOnMention: true,
    triggerOnAssign: false,
    delegationDelaySec: 0,
    runtimePolicy: {
      reasoningEffort: null,
      toolAllow: [],
      toolDeny: [],
      mcpGrants: ['itsaplan'],
      files: [{ kind: 'instructions', path: 'SOUL.md', content: HOME_AGENT_SOUL }],
    },
  });

  if (!created.apiKey) throw new Error('Home agent creation did not return an external key');
  // Coordinators of projects created before the Home agent report to nobody yet.
  await db
    .update(organizationAgentAssignment)
    .set({ reportsToAgentId: created.agent.id, updatedAt: new Date() })
    .where(
      and(
        eq(organizationAgentAssignment.teamId, owner.teamId),
        eq(organizationAgentAssignment.role, 'coordinator'),
        isNull(organizationAgentAssignment.reportsToAgentId),
      ),
    );
  return { status: 'ready', agentId: created.agent.id, apiKey: created.apiKey };
}

if (import.meta.main) {
  const result = await bootstrapHomeAgent();
  if (result.status === 'pending') {
    process.exit(75);
  }
  process.stdout.write(result.apiKey, () => process.exit(0));
}
