import type { RuntimeFailure } from '@helena/sdk';
import { routesOfRuns, type RouteView } from '#modules/model-router/service';
import { db, agentRun, issue, project } from '@repo/db';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { intEnv, iso } from '#shared/lib';
import type { AgentRunTrigger } from '../model';
import { reflectionView, type ReflectionView } from '../runner/reflection';
import type { ModelCheck } from '../runtime-sync/model-check';

// The agent_run outbox: data access for triggered runs and run history. The agent's
// runner claims pending rows over HTTP (modules/agents/runner) and reports the outcome.

// Tuning, env-overridable with defaults. An agent run can take minutes, so the lease is
// generous — it must exceed a quiet stretch of a run so a row is not re-claimed while
// its run is still in flight.
export const agentRunConfig = {
  maxAttempts: () => intEnv('AGENT_RUN_MAX_ATTEMPTS', 3),
  leaseSeconds: () => intEnv('AGENT_RUN_LEASE_SECONDS', 300),
};

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Queues a run of the agent and returns its id. On an issue, a mention, delegation or
// field trigger queues nothing while the agent already has a run pending there — queued
// or in flight — and returns that run: one automated run per agent and issue at a time,
// and the run that is there reads the issue as it is when it starts. An approval
// decision is always queued, so it reaches the agent. `executor` is the transaction the
// queueing belongs to, when it has one.
export async function enqueueAgentRun(
  input: {
    agentId: number;
    // The project the run works in, which is the issue's. An agent works in several
    // projects, so the run carries its own rather than reading the agent's.
    projectId: number;
    // Null only for an approval decision on a request made outside an issue.
    issueId: number | null;
    sourceActivityId: number | null;
    prompt: string;
    trigger?: 'mention' | 'delegation' | 'field' | 'approval' | 'workspace';
    // Seconds the run stays unclaimable after it is queued, so the issue can still be
    // edited before the agent reads it.
    delaySeconds?: number;
    // The session of an earlier run this one continues (an approval decision resumes the
    // run that asked), so the agent still has its plan.
    continueSession?: { runId: number; sessionId: string };
  },
  executor: typeof db | Transaction = db,
): Promise<number> {
  const delay = Math.max(0, Math.trunc(input.delaySeconds ?? 0));
  const queue = async (tx: typeof db | Transaction): Promise<number> => {
    if (input.issueId != null && input.trigger !== 'approval') {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`agent-run:${input.agentId}:${input.issueId}`}, 0))`,
      );
      const [pending] = await tx
        .select({ id: agentRun.id })
        .from(agentRun)
        .where(
          and(
            eq(agentRun.agentId, input.agentId),
            eq(agentRun.issueId, input.issueId),
            eq(agentRun.status, 'pending'),
          ),
        )
        .limit(1);
      if (pending) return pending.id;
    }
    const [row] = await tx
      .insert(agentRun)
      .values({
        agentId: input.agentId,
        projectId: input.projectId,
        issueId: input.issueId,
        sourceActivityId: input.sourceActivityId,
        prompt: input.prompt,
        trigger: input.trigger ?? (input.sourceActivityId == null ? 'delegation' : 'mention'),
        nextAttemptAt: delay > 0 ? sql`now() + make_interval(secs => ${delay})` : undefined,
        ...(input.continueSession && {
          sessionId: input.continueSession.sessionId,
          continuedFromRunId: input.continueSession.runId,
        }),
      })
      .returning({ id: agentRun.id });
    return row!.id;
  };
  return executor === db ? db.transaction(queue) : queue(executor);
}

// How far up a thread the agent is given. Further up, the exchange is too far from
// the question to pay for the tokens it costs.
const THREAD_CONTEXT_DEPTH = 5;

// The comments the given one replies to, oldest first and at most
// THREAD_CONTEXT_DEPTH of them, as the text a prompt carries. Null when the comment
// is not a reply.
export async function loadThreadContext(sourceActivityId: number | null): Promise<string | null> {
  if (sourceActivityId == null) return null;
  const rows = await db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT a.id, a.reply_to_id, a.actor_name, a.body, 0 AS depth
        FROM issue_activity a
       WHERE a.id = ${sourceActivityId}
      UNION ALL
      SELECT p.id, p.reply_to_id, p.actor_name, p.body, c.depth + 1
        FROM issue_activity p
        JOIN chain c ON p.id = c.reply_to_id
       WHERE c.depth < ${THREAD_CONTEXT_DEPTH}
    )
    SELECT actor_name AS "actorName", body FROM chain WHERE depth > 0 ORDER BY depth DESC
  `);
  const ancestors = rows as unknown as { actorName: string | null; body: string | null }[];
  if (ancestors.length === 0) return null;
  return ancestors.map((a) => `${a.actorName ?? 'Unknown'}: ${a.body ?? ''}`).join('\n\n');
}

// One row of an agent's run history, for the runs sidebar. The issue is joined for
// its human key and title.
export interface AgentRunRow {
  id: number;
  status: string;
  trigger: AgentRunTrigger;
  issueId: number | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  prompt: string;
  attempts: number;
  lastError: string | null;
  // What the run produced: the runtime's reply, or whatever the runner's command
  // printed. Null until the run finishes.
  output: string | null;
  contextTokens?: number;
  blockedQuestion: string | null;
  reflection: ReflectionView | null;
  // The Autopilot level the run worked at; null for a run from before the Autopilot.
  autopilotLevel: number | null;
  // The configured model and reasoning next to what the run's session really ran on.
  modelCheck: ModelCheck | null;
  // What the model router did for the run (decisions.md §4).
  modelRoute?: RouteView | null;
  // Why the run failed, where the runtime's words said (a model the provider refused).
  failure: RuntimeFailure | null;
  nextAttemptAt: string;
  createdAt: string;
}

// The size of a run's context as its DTO carries it. The field is left out where there
// is nothing to report: a run stored before the counts were recorded, and one whose
// agent reports none.
export function contextTokensOf(row: { inputTokens: number | null; outputTokens: number | null }): {
  contextTokens?: number;
} {
  if (row.inputTokens == null && row.outputTokens == null) return {};
  return { contextTokens: (row.inputTokens ?? 0) + (row.outputTokens ?? 0) };
}

export interface AgentRunPage {
  items: AgentRunRow[];
  // The id to pass as `before` to load the next page, or null when at the end.
  nextCursor: number | null;
}

// One page of an agent's runs, newest first. Keyset pagination by id (runs are
// id-monotonic): pass the previous page's nextCursor as `before`. limit is clamped to
// 1..50.
//
// An agent works in several projects of its team and a run carries the one it ran in,
// so `projectIds` bounds the page to the projects the reader may see. Omitted, it
// reads every project — only a caller who runs the team passes nothing.
export async function listAgentRuns(
  agentId: number,
  opts: { before?: number; limit?: number; projectIds?: number[] } = {},
): Promise<AgentRunPage> {
  if (opts.projectIds?.length === 0) return { items: [], nextCursor: null };
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 50);
  const rows = await db
    .select({
      id: agentRun.id,
      status: agentRun.status,
      trigger: agentRun.trigger,
      issueId: agentRun.issueId,
      prompt: agentRun.prompt,
      attempts: agentRun.attempts,
      lastError: agentRun.lastError,
      output: agentRun.output,
      inputTokens: agentRun.inputTokens,
      outputTokens: agentRun.outputTokens,
      blockedQuestion: agentRun.blockedQuestion,
      reflection: agentRun.reflection,
      autopilotLevel: agentRun.autopilotLevel,
      modelCheck: agentRun.modelCheck,
      failure: agentRun.failure,
      finishedAt: agentRun.finishedAt,
      nextAttemptAt: agentRun.nextAttemptAt,
      createdAt: agentRun.createdAt,
      issueSeq: issue.sequenceNumber,
      issueTitle: issue.title,
      projectKey: project.key,
    })
    .from(agentRun)
    .leftJoin(issue, eq(issue.id, agentRun.issueId))
    .leftJoin(project, eq(project.id, issue.projectId))
    .where(
      and(
        eq(agentRun.agentId, agentId),
        opts.projectIds ? inArray(agentRun.projectId, opts.projectIds) : undefined,
        opts.before ? lt(agentRun.id, opts.before) : undefined,
      ),
    )
    .orderBy(desc(agentRun.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const routes = await routesOfRuns(page.map((r) => r.id));
  return {
    items: page.map((r) => ({
      id: r.id,
      status: r.status,
      trigger: r.trigger as AgentRunTrigger,
      issueId: r.issueId,
      issueIdentifier: r.projectKey && r.issueSeq != null ? `${r.projectKey}-${r.issueSeq}` : null,
      issueTitle: r.issueTitle ?? null,
      prompt: r.prompt,
      attempts: r.attempts,
      lastError: r.lastError,
      output: r.output,
      ...contextTokensOf(r),
      blockedQuestion: r.blockedQuestion,
      reflection: reflectionView(r.reflection, r.finishedAt),
      autopilotLevel: r.autopilotLevel,
      modelCheck: (r.modelCheck as ModelCheck | null) ?? null,
      modelRoute: routes.get(r.id) ?? null,
      failure: (r.failure as RuntimeFailure | null) ?? null,
      nextAttemptAt: iso(r.nextAttemptAt),
      createdAt: iso(r.createdAt),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}
