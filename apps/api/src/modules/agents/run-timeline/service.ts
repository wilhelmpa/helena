import { db, agentRun, agentRunEvent, agentUsage, aiAgent, issue, project, user } from '@repo/db';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { HttpError, intEnv, iso } from '#shared/lib';
import { heldBy, touchRunner, type RunAck } from '../runner/service';
import { emergencyStopActive } from '#modules/emergency-stop/service';
import { priceRows } from '../usage/service';
import { reflectionView, type ReflectionView } from '../runner/reflection';
import type { ModelCheck } from '../runtime-sync/model-check';

// A run's timeline: the AG-UI events its runner read from the command's output, redacted on
// the runner, stored while the run runs. The run view reads them live and replays them later;
// the full transcript of the session comes from the runtime itself (runtime-views).

export const runTimelineConfig = {
  // Past these the events of a run are no longer stored; the transcript still has them.
  maxEvents: () => intEnv('AGENT_RUN_EVENTS_MAX', 4000),
  maxEventBytes: () => intEnv('AGENT_RUN_EVENT_MAX_BYTES', 64 * 1024),
  // Events of runs finished longer ago than this are removed by the janitor.
  keepDays: () => intEnv('AGENT_RUN_EVENTS_KEEP_DAYS', 30),
};

// The events a runner reports for a run it holds. The answer says, like a heartbeat, whether
// the command is to stop. Null when the run is not this agent's.
export async function appendRunEvents(
  agentId: number,
  runId: number,
  claim: number | undefined,
  events: unknown[],
): Promise<RunAck | null> {
  await touchRunner(agentId);
  const [held] = await db
    .select({ id: agentRun.id, claims: agentRun.claims })
    .from(agentRun)
    .where(heldBy(agentId, runId, claim));
  if (!held) {
    const [row] = await db
      .select({ status: agentRun.status })
      .from(agentRun)
      .where(and(eq(agentRun.id, runId), eq(agentRun.agentId, agentId)));
    if (!row) return null;
    return { canceled: row.status === 'canceled' || claim !== undefined };
  }
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentRunEvent)
    .where(eq(agentRunEvent.runId, runId));
  const room = Math.max(0, runTimelineConfig.maxEvents() - n);
  // The closing events always fit, so a long run still shows how it ended.
  const closing = (event: unknown) =>
    ['RUN_FINISHED', 'RUN_ERROR'].includes((event as { type?: unknown })?.type as string);
  const kept = events
    .filter((event, index) => index < room || closing(event))
    .filter(
      (event) =>
        Buffer.byteLength(JSON.stringify(event ?? null), 'utf8') <=
        runTimelineConfig.maxEventBytes(),
    );
  if (kept.length > 0) {
    await db
      .insert(agentRunEvent)
      .values(kept.map((payload) => ({ runId, claim: claim ?? held.claims, payload })));
  }
  return (await emergencyStopActive()) ? { canceled: false, hold: true } : { canceled: false };
}

export interface RunEventPage {
  events: { id: number; claim: number; payload: unknown; createdAt: string }[];
  // Pass as `after` to read what arrived since.
  next: number;
}

export async function listRunEvents(
  runId: number,
  after: number,
  limit: number,
): Promise<RunEventPage> {
  const rows = await db
    .select()
    .from(agentRunEvent)
    .where(and(eq(agentRunEvent.runId, runId), gt(agentRunEvent.id, after)))
    .orderBy(asc(agentRunEvent.id))
    .limit(Math.min(Math.max(limit, 1), 1000));
  return {
    events: rows.map((row) => ({
      id: row.id,
      claim: row.claim,
      payload: row.payload,
      createdAt: iso(row.createdAt),
    })),
    next: rows.at(-1)?.id ?? after,
  };
}

export interface RunDetail {
  id: number;
  agentId: number;
  agentName: string;
  agentUsername: string;
  projectId: number;
  projectKey: string;
  status: string;
  trigger: string;
  issueId: number | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  prompt: string;
  output: string | null;
  lastError: string | null;
  attempts: number;
  resumes: number;
  sessionId: string | null;
  model: string | null;
  continuedFromRunId: number | null;
  blockedQuestion: string | null;
  reflection: ReflectionView | null;
  // The model the run was configured with against the one its session ran on.
  modelCheck: ModelCheck | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  // What the run spent, per model, from the token ledger (run and reflection).
  usage: {
    kind: string;
    runtime: string | null;
    model: string | null;
    provider: string | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
    durationMs: number | null;
    costEur: number | null;
  }[];
}

// One run of the agent, when it is in one of `projectIds` (undefined: any project).
export async function getRunDetail(
  agentId: number,
  runId: number,
  projectIds?: number[],
): Promise<RunDetail | null> {
  const [row] = await db
    .select({
      run: agentRun,
      agentName: user.name,
      agentUsername: aiAgent.username,
      projectKey: project.key,
      issueSeq: issue.sequenceNumber,
      issueTitle: issue.title,
    })
    .from(agentRun)
    .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .innerJoin(project, eq(project.id, agentRun.projectId))
    .leftJoin(issue, eq(issue.id, agentRun.issueId))
    .where(
      and(
        eq(agentRun.id, runId),
        eq(agentRun.agentId, agentId),
        projectIds ? inArray(agentRun.projectId, projectIds.length ? projectIds : [0]) : undefined,
      ),
    );
  if (!row) return null;
  const usage = await db
    .select({
      kind: agentUsage.kind,
      runtime: agentUsage.runtime,
      model: agentUsage.model,
      provider: agentUsage.provider,
      inputTokens: agentUsage.inputTokens,
      outputTokens: agentUsage.outputTokens,
      cacheReadTokens: agentUsage.cacheReadTokens,
      cacheWriteTokens: agentUsage.cacheWriteTokens,
      reasoningTokens: agentUsage.reasoningTokens,
      durationMs: agentUsage.durationMs,
    })
    .from(agentUsage)
    .where(eq(agentUsage.runId, runId))
    .orderBy(asc(agentUsage.id));
  const run = row.run;
  return {
    id: run.id,
    agentId: run.agentId,
    agentName: row.agentName,
    agentUsername: row.agentUsername,
    projectId: run.projectId,
    projectKey: row.projectKey,
    status: run.status,
    trigger: run.trigger,
    issueId: run.issueId,
    issueIdentifier: row.issueSeq == null ? null : `${row.projectKey}-${row.issueSeq}`,
    issueTitle: row.issueTitle ?? null,
    prompt: run.prompt,
    output: run.output,
    lastError: run.lastError,
    attempts: run.attempts,
    resumes: run.resumes,
    sessionId: run.sessionId,
    model: run.model,
    continuedFromRunId: run.continuedFromRunId,
    blockedQuestion: run.blockedQuestion,
    reflection: reflectionView(run.reflection, run.finishedAt),
    modelCheck: (run.modelCheck as ModelCheck | null) ?? null,
    startedAt: run.startedAt ? iso(run.startedAt) : null,
    finishedAt: run.finishedAt ? iso(run.finishedAt) : null,
    createdAt: iso(run.createdAt),
    usage: await priceRows(usage),
  };
}

// "Continue from here": a new run of the same agent, project and task that resumes the
// finished run's session with the owner's instruction. It is claimed like any run and goes
// through the same limits, approvals and emergency stop.
export async function continueRun(
  agentId: number,
  runId: number,
  instruction: string,
  projectIds?: number[],
): Promise<number> {
  const run = await getRunDetail(agentId, runId, projectIds);
  if (!run) throw new HttpError(404, 'Run not found');
  if (run.status === 'pending') throw new HttpError(409, 'The run is still running');
  if (!run.sessionId) throw new HttpError(409, 'The run has no session to continue');
  const text = instruction.trim();
  if (!text) throw new HttpError(400, 'Say what the agent should do next');
  const [pending] = await db
    .select({ id: agentRun.id })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.agentId, agentId),
        eq(agentRun.status, 'pending'),
        run.issueId == null
          ? eq(agentRun.continuedFromRunId, run.id)
          : eq(agentRun.issueId, run.issueId),
      ),
    )
    .limit(1);
  if (pending) throw new HttpError(409, 'The agent already has a queued run for this task');
  const [row] = await db
    .insert(agentRun)
    .values({
      agentId,
      projectId: run.projectId,
      issueId: run.issueId,
      trigger: 'manual',
      prompt: text,
      sessionId: run.sessionId,
      continuedFromRunId: run.id,
    })
    .returning({ id: agentRun.id });
  return row!.id;
}

// Janitor: the events of runs that finished longer ago than the keep time.
export async function pruneRunEvents(): Promise<number> {
  const rows = await db.execute(sql`
    DELETE FROM agent_run_event e
    USING agent_run r
    WHERE r.id = e.run_id
      AND r.finished_at < now() - make_interval(days => ${runTimelineConfig.keepDays()})
  `);
  return (rows as unknown as { count?: number }).count ?? 0;
}
