import { db, aiAgent, project } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import {
  effectiveLevel,
  isAutopilotLevel,
  type AutopilotLevel,
  type EffectiveLevel,
} from '@helena/policy';
import { HttpError } from '#shared/lib';
import { isAgentUser } from '#modules/agents/core/service';
import { onTemplateRelevantChange } from '#modules/agents/core/template-sync';
import { getProjectDefaults } from '#modules/settings/service';

// Which Autopilot level applies: the project's, an agent's own stricter one, or an agent's
// own higher one the owner allowed (see @helena/policy levels.ts).

export interface ResolvedLevel extends EffectiveLevel {
  projectLevel: AutopilotLevel | null;
  agentLevel: AutopilotLevel | null;
  agentRaise: boolean;
}

export async function resolveLevel(
  agentId: number | null,
  projectId: number | null,
): Promise<ResolvedLevel> {
  const [agentRow] =
    agentId == null
      ? []
      : await db
          .select({ level: aiAgent.autopilotLevel, raise: aiAgent.autopilotRaise })
          .from(aiAgent)
          .where(eq(aiAgent.id, agentId));
  const [projectRow] =
    projectId == null
      ? []
      : await db
          .select({ level: project.autopilotLevel })
          .from(project)
          .where(eq(project.id, projectId));
  const projectLevel = isAutopilotLevel(projectRow?.level) ? projectRow.level : null;
  const agentLevel = isAutopilotLevel(agentRow?.level) ? agentRow.level : null;
  const agentRaise = agentRow?.raise === true;
  const defaultLevel =
    projectLevel === null && agentLevel === null
      ? (await getProjectDefaults()).autopilotLevel
      : undefined;
  return {
    ...effectiveLevel({ projectLevel, agentLevel, agentRaise, defaultLevel }),
    projectLevel,
    agentLevel,
    agentRaise,
  };
}

async function refuseAgents(userId: string): Promise<void> {
  if (await isAgentUser(userId))
    throw new HttpError(403, 'An agent cannot change how independently agents act');
}

export async function setProjectLevel(
  projectId: number,
  level: AutopilotLevel,
  userId: string,
): Promise<void> {
  await refuseAgents(userId);
  await db.update(project).set({ autopilotLevel: level }).where(eq(project.id, projectId));
}

// The agent's own level (null follows the project). `raise` lets it exceed the project's,
// which only the team's owner may allow.
export async function setAgentLevel(
  teamId: number,
  agentId: number,
  input: { level: AutopilotLevel | null; raise: boolean },
  user: { id: string; isTeamOwner: boolean },
): Promise<boolean> {
  await refuseAgents(user.id);
  if (input.raise && input.level !== null && !user.isTeamOwner) {
    throw new HttpError(
      403,
      "Only the team's owner may let an agent act more independently than its project",
    );
  }
  const rows = await db
    .update(aiAgent)
    .set({ autopilotLevel: input.level, autopilotRaise: input.level !== null && input.raise })
    .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId)))
    .returning({ id: aiAgent.id });
  if (rows.length > 0) await onTemplateRelevantChange(agentId, ['approvals']);
  return rows.length > 0;
}
