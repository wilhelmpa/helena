import { db } from '@repo/db';
import { sql } from 'drizzle-orm';

export async function backfillRunUsage(ids: number[], apply = false) {
  if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id < 1))
    throw new Error('Explicit positive run IDs are required');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(210233)`);
    const rows = await tx.execute(sql`
      SELECT r.id, r.agent_id, r.project_id,
        COALESCE(r.model_check->'used'->>'model', s.model, r.model) AS model,
        r.model_check->'used'->>'provider' AS provider,
        r.session_id, r.input_tokens, r.output_tokens, r.finished_at,
        GREATEST(0, LEAST(2000000000, EXTRACT(EPOCH FROM (r.finished_at - COALESCE(r.claimed_at, r.started_at))) * 1000))::integer AS duration_ms
      FROM agent_run r
      LEFT JOIN LATERAL (SELECT model FROM helena_agent_session WHERE run_id = r.id AND kind = 'run' ORDER BY updated_at DESC LIMIT 1) s ON true
      WHERE r.id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
        AND r.status <> 'pending' AND r.finished_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM agent_usage u WHERE u.run_id = r.id AND u.kind = 'run')
      ORDER BY r.id FOR UPDATE OF r
    `);
    if (apply)
      for (const row of rows) {
        await tx.execute(sql`
        INSERT INTO agent_usage (agent_id, project_id, run_id, kind, model, provider, session_id, input_tokens, output_tokens, duration_ms, occurred_at)
        VALUES (${row.agent_id}, ${row.project_id}, ${row.id}, 'run', ${row.model}, ${row.provider}, ${row.session_id}, ${row.input_tokens ?? 0}, ${row.output_tokens ?? 0}, ${row.duration_ms}, ${row.finished_at})
      `);
      }
    return rows.map((row) => ({
      runId: row.id,
      model: row.model,
      provider: row.provider,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      missingUsage: row.input_tokens === null && row.output_tokens === null,
    }));
  });
}
