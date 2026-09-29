import { db, aiAgent, getSetting, setSetting } from '@repo/db';
import { and, eq, or, sql } from 'drizzle-orm';
import { intEnv } from '#shared/lib';
import { emergencyStopActive } from '#modules/emergency-stop/service';
import { queueRuntimeRequest } from './service';

// Hermes' curator only reviews the learned skills when something calls it: Hermes' own
// maintenance used to (its dashboard and gateway tick it). Helena calls it instead, so the
// dashboard can go: every agent whose curator is on gets a review once per interval, through
// its runner like the "run now" button. Never while the emergency stop is on.

const KEY = 'curatorSchedule';

const intervalMs = () => intEnv('AGENT_CURATOR_INTERVAL_HOURS', 24 * 7) * 3_600_000;

// Queues the reviews that are due; returns how many.
export async function scheduleCuratorRuns(now = new Date()): Promise<number> {
  if (await emergencyStopActive()) return 0;
  const agents = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(
      and(
        eq(aiAgent.kind, 'external'),
        eq(aiAgent.template, false),
        sql`coalesce((${aiAgent.runtimePolicy}->>'curator')::boolean, false)`,
        sql`coalesce((${aiAgent.runtimePolicy}->>'learning')::boolean, true)`,
        or(
          sql`${aiAgent.runtimePolicy}->>'runtime' = 'helena'`,
          and(
            sql`${aiAgent.runtimeState}->'capabilities' ? 'curator'`,
            sql`${aiAgent.lastSeenAt} > now() - interval '2 minutes'`,
          ),
        ),
      ),
    );
  if (agents.length === 0) return 0;
  const last = (await getSetting<Record<string, string>>(KEY)) ?? {};
  const due = agents.filter(
    (agent) => !last[agent.id] || now.getTime() - Date.parse(last[agent.id]!) >= intervalMs(),
  );
  let queued = 0;
  for (const agent of due) {
    try {
      await queueRuntimeRequest(agent.id, { op: 'curator.run' }, null);
      last[agent.id] = now.toISOString();
      queued++;
    } catch {
      // Its runner went away since the query; the next pass tries again.
    }
  }
  if (queued > 0) {
    const known = new Set(agents.map((agent) => String(agent.id)));
    await setSetting(KEY, Object.fromEntries(Object.entries(last).filter(([id]) => known.has(id))));
  }
  return queued;
}
