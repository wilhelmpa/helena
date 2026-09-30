import { createHash } from 'node:crypto';
import {
  aiAgent,
  agentRun,
  db,
  helenaBrowserTaskRun,
  integrationCredential,
  project,
  projectMember,
  user,
} from '@repo/db';
import { and, eq, isNull } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { isHomeAgent } from '#modules/agents/core/home-agent';
import { browserGatewayEnabledForAgent } from '#modules/agent-browser-gateway/service';
import { BROWSER_CLASS, decisionClass } from '#modules/decisions/classes';
import { firstStageCandidate } from '#modules/decisions/first-stage';
import { firstStageChatState } from '#modules/decisions/chat-stage';
import {
  classSetting,
  effectiveThreshold,
  usableDecisionConnection,
} from '#modules/decisions/service';
import type { DecisionConnection } from './connection';
import { effectiveBrowserControl, type EffectiveBrowserControl } from './settings';

type TaskRow = typeof helenaBrowserTaskRun.$inferSelect;
type Scope = NonNullable<TaskRow['firstStageScope']>;
type Caller = Pick<TaskRow, 'teamId' | 'projectId' | 'agentId' | 'runId' | 'chatMessageId'>;

export async function optionalBrowserStage(teamId: number) {
  const cls = decisionClass(BROWSER_CLASS)!;
  const threshold = effectiveThreshold(cls, await classSetting(teamId, BROWSER_CLASS));
  const stage = await firstStageCandidate(teamId, BROWSER_CLASS, threshold);
  if (!stage) return null;
  const permitted = await usableDecisionConnection(teamId, cls, stage.connection.credentialId);
  if ('refused' in permitted) return null;
  return { ...stage, connection: permitted.connection, threshold };
}

async function connectionVersion(connection: DecisionConnection): Promise<string> {
  const ids = [connection.credentialId, connection.sourceCredentialId].filter(
    (id): id is number => id !== null,
  );
  const stamps = [];
  for (const id of ids) {
    const [row] = await db
      .select({ updatedAt: integrationCredential.updatedAt })
      .from(integrationCredential)
      .where(eq(integrationCredential.id, id));
    stamps.push([id, row?.updatedAt?.toISOString() ?? null]);
  }
  return createHash('sha256').update(JSON.stringify({ connection, stamps })).digest('hex');
}

async function callerAllowed(caller: Caller): Promise<boolean> {
  if (!caller.agentId || (!caller.chatMessageId && !caller.runId)) return false;
  const [agent] = await db
    .select({ userId: aiAgent.userId, username: aiAgent.username, agentRole: aiAgent.agentRole })
    .from(aiAgent)
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .where(
      and(eq(aiAgent.id, caller.agentId), eq(aiAgent.teamId, caller.teamId), eq(user.active, true)),
    );
  if (!agent || !(await browserGatewayEnabledForAgent(caller.agentId, caller.teamId))) return false;
  if (caller.projectId === null) {
    if (!isHomeAgent(agent.agentRole)) return false;
  } else {
    const [membership] = await db
      .select({ id: project.id })
      .from(project)
      .innerJoin(
        projectMember,
        and(eq(projectMember.projectId, project.id), eq(projectMember.userId, agent.userId)),
      )
      .where(and(eq(project.id, caller.projectId), eq(project.teamId, caller.teamId)));
    if (!membership) return false;
  }
  if (caller.runId) {
    const [run] = await db
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(
        and(
          eq(agentRun.id, caller.runId),
          eq(agentRun.agentId, caller.agentId),
          caller.projectId === null
            ? isNull(agentRun.projectId)
            : eq(agentRun.projectId, caller.projectId),
        ),
      );
    if (!run) return false;
  }
  return true;
}

export async function captureBrowserStage(
  caller: Caller,
  control: EffectiveBrowserControl,
): Promise<Scope | null> {
  if (!control.firstStage) return null;
  if (!(await callerAllowed(caller)))
    throw new HttpError(
      409,
      'The optional Jev stage needs an authorized task or chat. Continue with step tools.',
    );
  const current = await effectiveBrowserControl({
    teamId: caller.teamId,
    projectId: caller.projectId,
    agentId: caller.agentId ?? undefined,
  });
  const chat = await firstStageChatState(caller);
  if (
    !current.firstStage ||
    !current.connection ||
    current.connection.credentialId !== control.connection?.credentialId ||
    current.firstStage.revision !== control.firstStage.revision ||
    !chat ||
    chat.mode === 'off'
  )
    throw new HttpError(409, 'The optional Jev stage is disabled. Continue with step tools.');
  return {
    revision: current.firstStage.revision,
    chatRevision: chat.revision,
    connectionVersion: await connectionVersion(current.connection),
  };
}

export async function browserStageStillEnabled(row: TaskRow): Promise<boolean> {
  if (!row.firstStageScope) return true;
  if (!(await callerAllowed(row))) return false;
  const [currentRow] = await db
    .select({
      cancelledAt: helenaBrowserTaskRun.cancelledAt,
      finishedAt: helenaBrowserTaskRun.finishedAt,
    })
    .from(helenaBrowserTaskRun)
    .where(eq(helenaBrowserTaskRun.id, row.id));
  if (!currentRow || currentRow.cancelledAt || currentRow.finishedAt) return false;
  const current = await effectiveBrowserControl({
    teamId: row.teamId,
    projectId: row.projectId,
    agentId: row.agentId ?? undefined,
  });
  const chat = await firstStageChatState(row);
  return Boolean(
    current.firstStage &&
    current.connection &&
    current.firstStage.revision === row.firstStageScope.revision &&
    current.connection.credentialId === row.credentialId &&
    (await connectionVersion(current.connection)) === row.firstStageScope.connectionVersion &&
    chat &&
    chat.mode !== 'off' &&
    chat.revision === row.firstStageScope.chatRevision,
  );
}
