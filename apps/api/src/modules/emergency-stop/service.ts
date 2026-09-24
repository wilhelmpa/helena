import { db, agentChatMessage, aiAgent, getSetting, setSetting } from '@repo/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { queueRuntimeRequest } from '#modules/agents/runtime-requests/service';

// The instance's emergency stop ("Not-Aus"). While it is on, no runner is handed a run or a
// chat answer, a run in flight is stopped and handed back at its next heartbeat (it resumes
// its session once the stop is lifted), answers being written are stopped, and every Hermes
// runtime gets Hermes' own stop (`hermes pause`), which halts its scheduler and gateway.

const KEY = 'emergencyStop';

export interface EmergencyStop {
  active: boolean;
  reason: string | null;
  since: string | null;
  byUserId: string | null;
}

const OFF: EmergencyStop = { active: false, reason: null, since: null, byUserId: null };

// Read on every claim and heartbeat, so it is kept for a moment rather than read each time.
const CACHE_MS = 1_000;
let cached: { value: EmergencyStop; at: number } | null = null;

export async function getEmergencyStop(): Promise<EmergencyStop> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = { ...OFF, ...((await getSetting<Partial<EmergencyStop>>(KEY)) ?? {}) };
  cached = { value, at: Date.now() };
  return value;
}

export async function emergencyStopActive(): Promise<boolean> {
  return (await getEmergencyStop()).active;
}

// Hermes' own stop in each external agent's runtime whose runner is online. Best effort: an
// agent whose runner is away gets it from the policy on its next start, and the claims are
// held by Helena either way.
async function tellRuntimes(engaged: boolean, reason: string | null, userId: string) {
  const agents = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(
      and(
        eq(aiAgent.kind, 'external'),
        eq(aiAgent.template, false),
        sql`${aiAgent.lastSeenAt} > now() - interval '2 minutes'`,
      ),
    );
  await Promise.all(
    agents.map(({ id }) =>
      queueRuntimeRequest(id, { op: 'estop.set', engaged, reason }, userId).catch(() => null),
    ),
  );
}

export async function setEmergencyStop(
  active: boolean,
  userId: string,
  reason?: string | null,
): Promise<EmergencyStop> {
  const value: EmergencyStop = active
    ? {
        active: true,
        reason: reason?.trim().slice(0, 300) || null,
        since: new Date().toISOString(),
        byUserId: userId,
      }
    : OFF;
  await setSetting(KEY, value);
  cached = { value, at: Date.now() };
  if (active) {
    // An answer being written stops at the runner's next call, which reads the cancel.
    await db
      .update(agentChatMessage)
      .set({
        status: 'canceled',
        lastError: 'Stopped by the emergency stop',
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(agentChatMessage.role, 'assistant'),
          inArray(agentChatMessage.status, ['streaming']),
        ),
      );
  }
  await tellRuntimes(active, value.reason, userId);
  return value;
}
