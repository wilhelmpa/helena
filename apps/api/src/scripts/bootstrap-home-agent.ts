import { auth } from '@repo/auth';
import { aiAgent, db, project, projectMember, teamMember, user } from '@repo/db';
import { and, asc, eq } from 'drizzle-orm';

import { createAgent, regenerateKey } from '#modules/agents/core/service';
import {
  createHermesProjectCoordinator,
  hermesProjectCoordinatorUsername,
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
  'Du bist der globale Home-Koordinator.',
  'Du hilfst beim Einrichten und Steuern des gesamten Systems.',
  'Arbeite projektuebergreifend, halte Aufgaben in Plan nachvollziehbar und fuehre keine externen Aktionen ohne ausdrueckliche Freigabe aus.',
].join(' ');

export interface ProjectCoordinatorBootstrapResult {
  project: { id: number; teamId: number; key: string; name: string; description: string };
  agent: { id: number; userId: string; username: string };
  // Null when the caller's current key is still valid for the coordinator.
  apiKey: string | null;
  projectInstructions: string;
  agentInstructions: string;
}

async function isCoordinatorKey(userId: string, apiKey: string): Promise<boolean> {
  const verified = await auth.api.verifyApiKey({ body: { key: apiKey } });
  return verified.valid && verified.key?.referenceId === userId;
}

// A key is issued only when the caller holds none that still works, because issuing
// one revokes the key the Hermes runner is using.
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
  let apiKey: string | null = null;
  if (!currentApiKey || !(await isCoordinatorKey(agent.userId, currentApiKey))) {
    apiKey = await regenerateKey(agent.id, target.teamId);
    if (!apiKey) throw new Error('The project coordinator could not be keyed');
  }
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
    .select({ id: aiAgent.id, kind: aiAgent.kind })
    .from(aiAgent)
    .where(and(eq(aiAgent.teamId, owner.teamId), eq(aiAgent.username, 'master')))
    .limit(1);

  if (existing) {
    if (existing.kind !== 'external') {
      throw new Error('The reserved Home agent handle "master" belongs to a non-external agent');
    }
    const apiKey = await regenerateKey(existing.id, owner.teamId);
    if (!apiKey) throw new Error('The existing Home agent could not be re-keyed');
    return { status: 'ready', agentId: existing.id, apiKey };
  }

  const created = await createAgent(owner.teamId, {
    name: 'Home',
    username: 'master',
    kind: 'external',
    projectIds: [],
    ownerUserId: owner.userId,
    runnerScope: 'owner',
    instructions: HOME_AGENT_INSTRUCTIONS,
    memoryEnabled: true,
    memoryLastMessages: 50,
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
  return { status: 'ready', agentId: created.agent.id, apiKey: created.apiKey };
}

if (import.meta.main) {
  const result = await bootstrapHomeAgent();
  if (result.status === 'pending') {
    process.exit(75);
  }
  process.stdout.write(result.apiKey, () => process.exit(0));
}
