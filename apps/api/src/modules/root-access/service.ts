import { randomUUID } from 'node:crypto';
import {
  aiAgent,
  approvalRequest,
  db,
  project,
  projectMember,
  user,
  volitionRootExecution,
} from '@repo/db';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { toolsFullyObserved } from '@helena/sdk';
import { HostdError, hostd } from '#modules/server/hostd';
import type { RunnerAgent } from '#modules/agents/runner/service';
import { enqueueTelegramApproval } from '#modules/telegram/channel';
import { publishDomainEvent } from '#shared/helena';
import { HttpError } from '#shared/lib';
import { persistenceMarkers, rootDecision } from './policy';
import { workProvenance, type Work } from './provenance';

export type RootSettings = {
  enabled: boolean;
  directOnly: boolean;
  unrestricted: boolean;
  epoch: number;
};
export const rootSettings = () => hostd<RootSettings>('RootSettings');

export async function setRootSettings(
  input: { enabled: boolean; directOnly: boolean; unrestricted?: boolean },
  userId: string,
) {
  const settings = await hostd<RootSettings>(
    'SetRootSettings',
    { ...input, actor: `user:${userId}` },
    155_000,
  );
  const revoked = await db
    .update(volitionRootExecution)
    .set({ status: 'revoked', finishedAt: new Date() })
    .where(
      and(
        eq(volitionRootExecution.status, 'pending'),
        lt(volitionRootExecution.epoch, settings.epoch),
      ),
    )
    .returning({ approvalId: volitionRootExecution.approvalId });
  const approvalIds = revoked.flatMap((row) => (row.approvalId == null ? [] : [row.approvalId]));
  if (approvalIds.length)
    await db
      .update(approvalRequest)
      .set({
        status: 'rejected',
        decidedByUserId: userId,
        decidedAt: new Date(),
        decisionNote: 'Root access revoked',
      })
      .where(and(inArray(approvalRequest.id, approvalIds), eq(approvalRequest.status, 'pending')));
  await db.insert(volitionRootExecution).values({
    id: randomUUID().replaceAll('-', ''),
    command: 'SetRootSettings',
    reason: `Owner ${userId}: ${JSON.stringify(input)}`,
    origin: 'owner-direct',
    runtime: 'hostd',
    taintSources: [],
    persistence: [],
    epoch: settings.epoch,
    status: 'success',
    startedAt: new Date(),
    finishedAt: new Date(),
  });
  return settings;
}

export async function rootOwner(agentId: number): Promise<string> {
  const [row] = await db
    .select({ owner: aiAgent.ownerUserId, role: user.role, agentRole: aiAgent.agentRole })
    .from(aiAgent)
    .innerJoin(user, eq(user.id, aiAgent.ownerUserId))
    .where(eq(aiAgent.id, agentId));
  if (row?.agentRole !== 'home' || row.role !== 'god' || !row.owner)
    throw new HttpError(403, 'Only the instance owner’s Home agent may use root access');
  return row.owner;
}

export async function requestRoot(
  agent: RunnerAgent,
  work: Work,
  input: { command: string; reason: string },
) {
  const ownerId = await rootOwner(agent.id);
  const provenance = await workProvenance(agent.id, work);
  provenance.runtime = work.runtime ?? 'unknown';
  const settings = await rootSettings();
  if (!settings.enabled) throw new HttpError(409, 'Root access is disabled');
  const sources = [...provenance.taintSources];
  if (!toolsFullyObserved(provenance.runtime ?? '')) sources.push('Laufzeit nicht beobachtbar');
  const id = randomUUID().replaceAll('-', '');
  const requiresApproval =
    rootDecision({
      ...provenance,
      directOnly: settings.directOnly,
      unrestricted: settings.unrestricted,
      agentRole: agent.agentRole,
    }) === 'approval';
  const [approvalProject] = await db
    .select({ id: project.id })
    .from(project)
    .innerJoin(projectMember, eq(projectMember.projectId, project.id))
    .where(
      and(
        eq(project.teamId, agent.teamId),
        eq(projectMember.userId, ownerId),
        eq(projectMember.role, 'owner'),
      ),
    )
    .orderBy(project.id)
    .limit(1);
  const projectId = approvalProject?.id;
  if (requiresApproval && projectId == null)
    throw new HttpError(409, 'Home needs a project for its approval inbox');
  let approvalId: number | null = null;
  await db.transaction(async (tx) => {
    if (requiresApproval) {
      const [approval] = await tx
        .insert(approvalRequest)
        .values({
          agentId: agent.id,
          projectId: projectId!,
          runId: work.runId ?? null,
          kind: 'execute',
          category: 'execute',
          action: `Root: ${input.command.slice(0, 200)}`,
          command: input.command,
          details: `Origin: ${provenance.origin}\nRuntime: ${provenance.runtime ?? 'unknown'}\n${sources.join(', ')}\n${input.reason}\nCommand: ${input.command}`,
          policyReason: 'root-provenance',
          payload: { type: 'volition-root', rootExecutionId: id, ownerId },
        })
        .returning({ id: approvalRequest.id });
      approvalId = approval!.id;
    }
    await tx.insert(volitionRootExecution).values({
      id,
      agentId: agent.id,
      runId: work.runId,
      messageId: work.messageId,
      approvalId,
      command: input.command,
      reason: input.reason,
      origin: provenance.origin,
      runtime: provenance.runtime ?? 'unknown',
      taintSources: sources,
      persistence: persistenceMarkers(input.command),
      epoch: settings.epoch,
    });
    if (approvalId != null)
      await publishDomainEvent(
        {
          type: 'helena.approval.requested',
          projectId: projectId!,
          subject: `approvals/${approvalId}`,
          actor: `agent:${agent.id}`,
          data: {
            approvalId,
            kind: 'execute',
            projectId: projectId!,
            agentId: agent.id,
            issueId: null,
            runId: work.runId ?? null,
          },
        },
        tx,
      );
  });
  if (approvalId != null) {
    await enqueueTelegramApproval(approvalId, [ownerId]);
    return { id, status: 'pending', approvalId };
  }
  return executeRoot(id);
}

async function executeRoot(id: string) {
  const [entry] = await db
    .update(volitionRootExecution)
    .set({ status: 'running', startedAt: new Date() })
    .where(and(eq(volitionRootExecution.id, id), eq(volitionRootExecution.status, 'pending')))
    .returning();
  if (!entry) return null;
  try {
    const result = await hostd<{ unit: string; exitCode: number; output: string }>(
      'RunPrivileged',
      {
        id,
        command: entry.command,
        seconds: 120,
        epoch: entry.epoch,
        actor: `agent:${entry.agentId};run:${entry.runId ?? '-'};chat:${entry.messageId ?? '-'}`,
      },
      140_000,
    );
    const current = await rootSettings();
    let status = result.exitCode === 0 ? 'success' : 'failed';
    if (current.epoch !== entry.epoch) status = 'revoked';
    await db
      .update(volitionRootExecution)
      .set({
        unit: result.unit,
        exitCode: result.exitCode,
        output: result.output.slice(0, 65536),
        status,
        finishedAt: new Date(),
      })
      .where(eq(volitionRootExecution.id, id));
    return { id, status, approvalId: entry.approvalId, ...result };
  } catch (error) {
    await db
      .update(volitionRootExecution)
      .set({
        status: error instanceof HostdError && error.code === 'NotAllowed' ? 'revoked' : 'failed',
        output: error instanceof Error ? error.message : 'Host operation failed',
        finishedAt: new Date(),
      })
      .where(eq(volitionRootExecution.id, id));
    throw error;
  }
}

export async function executeRootApproval(approvalId: number, approved: boolean) {
  const [entry] = await db
    .select({ id: volitionRootExecution.id })
    .from(volitionRootExecution)
    .where(eq(volitionRootExecution.approvalId, approvalId));
  if (!entry) return;
  if (approved) await executeRoot(entry.id);
  else
    await db
      .update(volitionRootExecution)
      .set({ status: 'rejected', finishedAt: new Date() })
      .where(eq(volitionRootExecution.id, entry.id));
}

export async function rootAudit() {
  const rows = await db
    .select()
    .from(volitionRootExecution)
    .orderBy(desc(volitionRootExecution.createdAt))
    .limit(100);
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }));
}

export async function processApprovedRoots(): Promise<void> {
  const interrupted = await db
    .select()
    .from(volitionRootExecution)
    .where(
      and(
        eq(volitionRootExecution.status, 'running'),
        lt(volitionRootExecution.startedAt, new Date(Date.now() - 150_000)),
      ),
    )
    .limit(4);
  for (const entry of interrupted) {
    const result = await hostd<{
      pending?: boolean;
      unit?: string;
      exitCode?: number | null;
      output?: string;
    }>('PrivilegedResult', { id: entry.id });
    const settings = await rootSettings();
    let status = result.exitCode === 0 ? 'success' : 'failed';
    if (settings.epoch !== entry.epoch) status = 'revoked';
    await db
      .update(volitionRootExecution)
      .set({
        status,
        unit: result.unit ?? null,
        exitCode: result.exitCode ?? null,
        output:
          result.output ??
          'The helper has no completion record; this command will not be replayed.',
        finishedAt: new Date(),
      })
      .where(
        and(eq(volitionRootExecution.id, entry.id), eq(volitionRootExecution.status, 'running')),
      );
  }

  const rejected = await db
    .select({ id: volitionRootExecution.id })
    .from(volitionRootExecution)
    .innerJoin(approvalRequest, eq(approvalRequest.id, volitionRootExecution.approvalId))
    .where(
      and(eq(volitionRootExecution.status, 'pending'), eq(approvalRequest.status, 'rejected')),
    );
  if (rejected.length)
    await db
      .update(volitionRootExecution)
      .set({ status: 'rejected', finishedAt: new Date() })
      .where(
        inArray(
          volitionRootExecution.id,
          rejected.map((row) => row.id),
        ),
      );

  const rows = await db
    .select({ id: volitionRootExecution.id })
    .from(volitionRootExecution)
    .innerJoin(approvalRequest, eq(approvalRequest.id, volitionRootExecution.approvalId))
    .where(and(eq(volitionRootExecution.status, 'pending'), eq(approvalRequest.status, 'approved')))
    .limit(4);
  for (const row of rows) await executeRoot(row.id);
}

export async function assertRootApprovalPending(approvalId: number): Promise<void> {
  const [entry] = await db
    .select({ status: volitionRootExecution.status, epoch: volitionRootExecution.epoch })
    .from(volitionRootExecution)
    .where(eq(volitionRootExecution.approvalId, approvalId));
  const settings = await rootSettings();
  if (entry?.status !== 'pending' || entry.epoch !== settings.epoch || !settings.enabled) {
    throw new HttpError(409, 'This root request has been revoked');
  }
}
