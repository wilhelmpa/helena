import { renderDisplayName } from '@helena/sdk';
import {
  agentHeartbeatEvent,
  agentRun,
  aiAgent,
  db,
  getDisplayName,
  helenaDecision,
} from '@repo/db';
import { and, asc, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { enqueueAgentRun } from './run-queue';
import { isHeartbeatWorkTime, nextHeartbeatAt } from './heartbeat-time';
import { classSetting, decide } from '#modules/decisions/service';
import { HEARTBEAT_PRECHECK_CLASS } from '#modules/decisions/classes';
import { heartbeatPrecheckQuestions } from '#modules/decisions/questions';
import { isBorderlineHeartbeat, type HeartbeatCandidate } from './heartbeat-precheck';
import { heartbeatBudgetThrottled } from '#modules/autopilot/budgets';
import { localAiHasCapacity, localAiMayStart } from '#modules/local-ai/pressure';

type Candidate = HeartbeatCandidate;

async function precheckHeartbeat(input: {
  teamId: number;
  agentId: number;
  agentName: string;
  candidate: Candidate;
  now: Date;
}) {
  try {
    if (!(await localAiHasCapacity('background')))
      return { skip: false, reason: 'precheck deferred due local AI load' };
    const setting = await classSetting(input.teamId, HEARTBEAT_PRECHECK_CLASS);
    const outcome = await decide({
      teamId: input.teamId,
      classId: HEARTBEAT_PRECHECK_CLASS,
      localOnly: true,
      projectId: input.candidate.projectId,
      agentId: input.agentId,
      subject: `heartbeat:${input.agentId}`,
      context: {
        agent: input.agentName,
        count: 1,
        priority: 'low',
        dueDate: null,
        title: input.candidate.title.slice(0, 200),
      },
      questions: heartbeatPrecheckQuestions(input.agentName),
    });
    const answer = outcome.answers.work;
    const recommendsSkip =
      outcome.status === 'decided' && answer?.decided && answer.choice === 'no';
    const [first] = outcome.credentialId
      ? await db
          .select({ createdAt: helenaDecision.createdAt })
          .from(helenaDecision)
          .where(
            and(
              eq(helenaDecision.teamId, input.teamId),
              eq(helenaDecision.agentId, input.agentId),
              eq(helenaDecision.classId, HEARTBEAT_PRECHECK_CLASS),
              eq(helenaDecision.credentialId, outcome.credentialId),
              eq(helenaDecision.questionId, 'work'),
              inArray(helenaDecision.choice, ['yes', 'no']),
            ),
          )
          .orderBy(asc(helenaDecision.createdAt))
          .limit(1)
      : [];
    const shadowComplete =
      first && input.now.getTime() - first.createdAt.getTime() >= 7 * 24 * 60 * 60_000;
    const active = setting.config.heartbeatMode === 'active' && shadowComplete;
    const skip = Boolean(recommendsSkip && active);
    return {
      skip,
      reason: `precheck ${outcome.status}: ${answer?.choice ?? 'unavailable'}${answer?.decisionId ? ` (#${answer.decisionId})` : ''}${recommendsSkip && !active ? ' [shadow]' : ''}`,
    };
  } catch {
    return { skip: false, reason: 'precheck unavailable' };
  }
}

export async function fireDueAgentHeartbeats(now = new Date()): Promise<number> {
  const displayName = await getDisplayName();
  const due = await db
    .select({ id: aiAgent.id, model: aiAgent.model, dueAt: aiAgent.heartbeatNextAt })
    .from(aiAgent)
    .where(
      and(lte(aiAgent.heartbeatNextAt, now), isNull(aiAgent.pausedAt), eq(aiAgent.template, false)),
    )
    .limit(100);
  let checked = 0;
  for (const { id, model, dueAt } of due) {
    if (
      !(await localAiMayStart({
        kind: 'normal',
        model,
        createdAt: dueAt ?? now,
      }))
    )
      continue;
    const throttle = await heartbeatBudgetThrottled(id, null);
    const fired = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(aiAgent).where(eq(aiAgent.id, id));
      if (
        !current ||
        !current.heartbeatNextAt ||
        current.heartbeatNextAt > now ||
        current.pausedAt ||
        current.template
      )
        return false;
      const nextAt = nextHeartbeatAt(
        throttle && current.heartbeatIntervalMinutes != null
          ? {
              ...current,
              heartbeatIntervalMinutes: Math.min(10080, current.heartbeatIntervalMinutes * 2),
            }
          : current,
        now,
      );
      const [claimed] = await tx
        .update(aiAgent)
        .set({ heartbeatLastAt: now, heartbeatNextAt: nextAt })
        .where(and(eq(aiAgent.id, id), lte(aiAgent.heartbeatNextAt, now)))
        .returning({ id: aiAgent.id });
      if (!claimed) return false;

      if (!isHeartbeatWorkTime(current, now)) {
        await tx.insert(agentHeartbeatEvent).values({
          agentId: id,
          checkedAt: now,
          outcome: 'skipped',
          reason: 'outside work hours',
        });
        return true;
      }

      const pending = await tx
        .select({ id: agentRun.id })
        .from(agentRun)
        .where(and(eq(agentRun.agentId, id), eq(agentRun.status, 'pending')))
        .limit(1);
      let candidate: Candidate | undefined;
      if (pending.length === 0) {
        const comments = await tx.execute(sql`
          SELECT i.project_id AS "projectId", i.id AS "issueId", i.title, 'new comment' AS reason
          FROM issue_activity a
          JOIN issue i ON i.id = a.issue_id
          JOIN project_member pm ON pm.project_id = i.project_id AND pm.user_id = ${current.userId}
          WHERE a.kind = 'comment' AND a.created_at > COALESCE(${current.heartbeatLastAt?.toISOString() ?? null}::timestamptz, '-infinity'::timestamptz)
            AND a.actor_user_id IS DISTINCT FROM ${current.userId}
            AND (i.delegate_user_id = ${current.userId} OR i.assignee_user_id = ${current.userId})
            AND i.archived_at IS NULL
          ORDER BY a.created_at DESC, a.id DESC LIMIT 1
        `);
        candidate = (comments as unknown as Candidate[])[0];
      }
      if (pending.length === 0 && !candidate) {
        const open = await tx.execute(sql`
          SELECT i.project_id AS "projectId", i.id AS "issueId", i.title, 'open task' AS reason,
            i.priority, i.due_date AS "dueDate", c.state_type AS "stateType",
            count(*) OVER() AS "candidateCount"
          FROM issue i
          JOIN project_column c ON c.id = i.column_id
          JOIN project_member pm ON pm.project_id = i.project_id AND pm.user_id = ${current.userId}
          WHERE (i.delegate_user_id = ${current.userId} OR i.assignee_user_id = ${current.userId}
            OR EXISTS (SELECT 1 FROM organization_agent_assignment oa
              WHERE oa.agent_id = ${id} AND oa.role = 'coordinator'))
            AND i.archived_at IS NULL AND c.state_type NOT IN ('completed', 'canceled')
          ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            i.due_date NULLS LAST, i.id
          LIMIT 1
        `);
        candidate = (open as unknown as Candidate[])[0];
        if (!candidate) {
          const goals = await tx.execute(sql`
            SELECT g.project_id AS "projectId", NULL::integer AS "issueId", g.title, 'due goal' AS reason
            FROM initiative g
            JOIN project_member pm ON pm.project_id = g.project_id AND pm.user_id = ${current.userId}
            WHERE g.owner_user_id = ${current.userId} AND g.status IN ('planned', 'active')
              AND g.target_date <= ${now.toISOString().slice(0, 10)}
            ORDER BY g.target_date, g.id LIMIT 1
          `);
          candidate = (goals as unknown as Candidate[])[0];
        }
        if (!candidate) {
          const goals = await tx.execute(sql`
            SELECT pm.project_id AS "projectId", NULL::integer AS "issueId", g.title, 'due goal' AS reason
            FROM organization_goal g
            JOIN project_member pm ON pm.user_id = ${current.userId}
              AND (g.project_id = pm.project_id OR g.project_id IS NULL)
            JOIN project p ON p.id = pm.project_id AND p.team_id = g.team_id
            WHERE g.team_id = ${current.teamId} AND g.status IN ('planned', 'active')
              AND g.target_date <= ${now.toISOString().slice(0, 10)}
              AND (g.project_id IS NOT NULL OR EXISTS (
                SELECT 1 FROM organization_agent_assignment oa
                WHERE oa.agent_id = ${id} AND oa.role = 'coordinator'
              ))
            ORDER BY g.target_date, g.id, pm.project_id LIMIT 1
          `);
          candidate = (goals as unknown as Candidate[])[0];
        }
      }
      if (
        candidate &&
        !throttle &&
        current.heartbeatIntervalMinutes != null &&
        (await heartbeatBudgetThrottled(id, candidate.projectId, candidate.issueId))
      ) {
        await tx
          .update(aiAgent)
          .set({
            heartbeatNextAt: nextHeartbeatAt(
              {
                ...current,
                heartbeatIntervalMinutes: Math.min(10080, current.heartbeatIntervalMinutes * 2),
              },
              now,
            ),
          })
          .where(eq(aiAgent.id, id));
      }
      const precheck =
        candidate && isBorderlineHeartbeat(candidate)
          ? await precheckHeartbeat({
              teamId: current.teamId,
              agentId: id,
              agentName: current.username,
              candidate,
              now,
            })
          : null;
      if (precheck?.skip) {
        await tx.insert(agentHeartbeatEvent).values({
          agentId: id,
          projectId: candidate?.projectId ?? null,
          checkedAt: now,
          outcome: 'skipped',
          reason: precheck.reason,
        });
        return true;
      }
      let runId: number | null = null;
      if (candidate) {
        runId = await enqueueAgentRun(
          {
            agentId: id,
            projectId: candidate.projectId,
            issueId: candidate.issueId,
            sourceActivityId: null,
            trigger: 'heartbeat',
            prompt: [
              renderDisplayName(current.heartbeatInstructions, displayName) ||
                'Review your assigned work and take the next useful step.',
              '',
              `${candidate.reason}: ${candidate.title}`,
            ].join('\n'),
          },
          tx,
        );
      }
      await tx.insert(agentHeartbeatEvent).values({
        agentId: id,
        projectId: candidate?.projectId ?? null,
        checkedAt: now,
        outcome: candidate ? 'queued' : 'skipped',
        reason: [
          candidate?.reason ?? (pending.length ? 'run pending' : 'no work'),
          precheck?.reason,
        ]
          .filter(Boolean)
          .join('; '),
        runId,
      });
      return true;
    });
    if (fired) checked++;
  }
  return checked;
}

export async function listAgentHeartbeats(
  agentId: number,
  projectIds?: number[],
  includeIdle = false,
) {
  if (projectIds?.length === 0) return [];
  const rows = await db
    .select({
      id: agentHeartbeatEvent.id,
      projectId: agentHeartbeatEvent.projectId,
      checkedAt: agentHeartbeatEvent.checkedAt,
      outcome: agentHeartbeatEvent.outcome,
      reason: agentHeartbeatEvent.reason,
      runId: agentHeartbeatEvent.runId,
    })
    .from(agentHeartbeatEvent)
    .where(
      and(
        eq(agentHeartbeatEvent.agentId, agentId),
        includeIdle ? undefined : ne(agentHeartbeatEvent.reason, 'no work'),
        projectIds
          ? or(
              inArray(agentHeartbeatEvent.projectId, projectIds),
              isNull(agentHeartbeatEvent.projectId),
            )
          : undefined,
      ),
    )
    .orderBy(sql`${agentHeartbeatEvent.checkedAt} DESC`)
    .limit(50);
  return rows.map((row) => ({ ...row, checkedAt: row.checkedAt.toISOString() }));
}
