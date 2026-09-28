import { and, eq, ne } from 'drizzle-orm';
import { agentRun, aiAgent, db, projectMember } from '@repo/db';
import { enqueueAgentRun } from '../core/run-queue';
import { normalizeRuntimePolicy } from '../core/service';

// A task Helena's own loop handed to a bigger model it does not drive itself
// (docs/helena-decisions/zentrale-laufzeit.md §9): Claude Code or Codex, with the owner's
// subscriptions. Helena queues the follow-up run on the task, with the hand-over as its
// prompt, for
//   `agent:<id>`             that agent;
//   `runtime:claude[/…]`,
//   `runtime:codex[/…]`      an agent of the run's project on that runtime.
// The run of the loop has already ended as a success ("handed over"); a target nobody can
// take is said on the run itself.

export interface EscalationReport {
  target: string;
  reason: string;
  detail: string | null;
  handover: string;
}

async function targetAgent(
  fromAgentId: number,
  projectId: number,
  target: string,
): Promise<number | null> {
  const explicit = /^agent:(\d+)$/.exec(target);
  if (explicit) {
    const id = Number(explicit[1]);
    const [row] = await db
      .select({ id: aiAgent.id })
      .from(aiAgent)
      .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
      .where(and(eq(aiAgent.id, id), eq(projectMember.projectId, projectId)));
    return row?.id ?? null;
  }
  const runtime = /^runtime:(claude|codex)(?:\/.*)?$/.exec(target)?.[1];
  if (!runtime) return null;
  const candidates = await db
    .select({ id: aiAgent.id, runtimePolicy: aiAgent.runtimePolicy })
    .from(aiAgent)
    .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
    .where(and(eq(projectMember.projectId, projectId), ne(aiAgent.id, fromAgentId)))
    .orderBy(aiAgent.id);
  return (
    candidates.find(
      (candidate) => normalizeRuntimePolicy(candidate.runtimePolicy).runtime === runtime,
    )?.id ?? null
  );
}

export async function queueEscalation(
  agentId: number,
  run: { id: number; projectId: number; issueId: number | null },
  report: EscalationReport,
): Promise<{ runId: number | null; error: string | null }> {
  const target = await targetAgent(agentId, run.projectId, report.target);
  if (!target) {
    const error = `Keine Übergabe möglich: kein Agent für ${report.target} im Projekt.`;
    await db.update(agentRun).set({ lastError: error }).where(eq(agentRun.id, run.id));
    return { runId: null, error };
  }
  const runId = await enqueueAgentRun({
    agentId: target,
    projectId: run.projectId,
    issueId: run.issueId,
    sourceActivityId: null,
    prompt: `${report.handover}\n\n(Übernommen von Lauf #${run.id}; Grund: ${report.reason}${report.detail ? `, ${report.detail}` : ''}.)`,
    trigger: 'escalation',
  });
  return { runId, error: null };
}
