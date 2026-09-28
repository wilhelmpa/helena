import { agentHeartbeatEvent, agentRun, aiAgent, db } from '@repo/db';
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { enqueueAgentRun } from './run-queue';
import { isHeartbeatWorkTime, nextHeartbeatAt } from './heartbeat-time';

type Candidate = { projectId: number; issueId: number | null; title: string; reason: string };

export async function fireDueAgentHeartbeats(now = new Date()): Promise<number> {
  const due = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(
      and(lte(aiAgent.heartbeatNextAt, now), isNull(aiAgent.pausedAt), eq(aiAgent.template, false)),
    )
    .limit(100);
  let checked = 0;
  for (const { id } of due) {
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
      const nextAt = nextHeartbeatAt(current, now);
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
          SELECT i.project_id AS "projectId", i.id AS "issueId", i.title, 'open task' AS reason
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
              current.heartbeatInstructions ||
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
        reason: candidate?.reason ?? (pending.length ? 'run pending' : 'no work'),
        runId,
      });
      return true;
    });
    if (fired) checked++;
  }
  return checked;
}

export async function listAgentHeartbeats(agentId: number, projectIds?: number[]) {
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
