import { agentRuntimeAction, aiAgent, db, recordServiceCheck } from '@repo/db';
import { and, eq, isNull } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { getAgentById, type AgentRuntimeState } from '../core/service';
import { runtimePolicySnapshot } from '../runtime-policy/service';
import { getRunnerAgent } from '../runner/service';
import type { agentSyncSummary, RuntimeSyncResponse } from './model';

// Whether an agent's runtime runs on what Helena says: the runner reports the revision of
// the settings it applied and what it read back from the runtime's profile (drift). This
// compares that report with the agent's current settings, and queues "Neu schreiben".

export type RuntimeSync = typeof RuntimeSyncResponse.static;
export type AgentSyncSummary = typeof agentSyncSummary.static;

// A runner polls every few seconds; one not seen for this long is gone.
const OFFLINE_AFTER_MS = 3 * 60_000;

export function syncState(
  state: AgentRuntimeState,
  lastSeenAt: string | null,
  revision: string,
  now = Date.now(),
): RuntimeSync['state'] {
  const seen = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  if (!(now - seen <= OFFLINE_AFTER_MS)) return 'offline';
  if (state.status === 'degraded') return 'degraded';
  // A runner that polls but reports no runtime state runs the operator's own command.
  if (state.status === 'offline') return 'unknown';
  if (state.appliedRevision !== revision) return 'pending';
  if (!state.profile) return 'unknown';
  return state.profile.drift.length > 0 ? 'drift' : 'synced';
}

async function rewritePending(agentId: number): Promise<boolean> {
  const rows = await db
    .select({ id: agentRuntimeAction.id })
    .from(agentRuntimeAction)
    .where(
      and(
        eq(agentRuntimeAction.agentId, agentId),
        eq(agentRuntimeAction.kind, 'rewrite-profile'),
        isNull(agentRuntimeAction.error),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function runtimeSyncOf(agentId: number, teamId: number): Promise<RuntimeSync> {
  const agent = await getAgentById(agentId, teamId);
  if (!agent) throw new HttpError(404, 'Agent not found');
  const runner = await getRunnerAgent(agent.userId);
  if (!runner) throw new HttpError(404, 'Agent not found');
  const { revision } = await runtimePolicySnapshot(runner);
  const state = agent.runtimeState;
  return {
    state: agent.template ? 'unknown' : syncState(state, agent.lastSeenAt, revision),
    revision,
    appliedRevision: state.appliedRevision,
    adapter: state.adapter,
    detail: state.detail,
    profile: state.profile,
    version: state.version,
    issues: state.issues,
    sandbox: state.sandbox,
    rewritePending: await rewritePending(agentId),
    reportedAt: state.reportedAt,
  };
}

// "Neu schreiben": the runner writes the agent's whole profile again with its next sync
// and reads it back at once. A request still waiting is replaced, not repeated.
export async function queueProfileRewrite(agentId: number, teamId: number): Promise<RuntimeSync> {
  const [agent] = await db
    .select({ id: aiAgent.id, template: aiAgent.template })
    .from(aiAgent)
    .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId)));
  if (!agent) throw new HttpError(404, 'Agent not found');
  if (agent.template) throw new HttpError(409, 'A template runs nowhere');
  await db.transaction(async (tx) => {
    await tx
      .delete(agentRuntimeAction)
      .where(
        and(
          eq(agentRuntimeAction.agentId, agentId),
          eq(agentRuntimeAction.kind, 'rewrite-profile'),
        ),
      );
    await tx
      .insert(agentRuntimeAction)
      .values({ agentId, kind: 'rewrite-profile', target: 'profile', payload: {} });
  });
  return runtimeSyncOf(agentId, teamId);
}

// What the Hermes runner's wrapper reports when it cannot start (and clears once it runs),
// for the health overview.
export async function recordRunnerHealth(error: string | null): Promise<void> {
  await recordServiceCheck('runner', error ? error.slice(0, 500) : null);
}

// Every agent a runner serves (external, not a template), with its sync state, for the
// health overview. The current revision is computed per agent, as the runner would read it.
export async function runtimeSyncSummary(): Promise<AgentSyncSummary> {
  const rows = await db
    .select({ id: aiAgent.id, teamId: aiAgent.teamId })
    .from(aiAgent)
    .where(and(eq(aiAgent.kind, 'external'), eq(aiAgent.template, false)))
    .orderBy(aiAgent.id);
  const summary: AgentSyncSummary = {
    total: 0,
    synced: 0,
    drift: 0,
    pending: 0,
    degraded: 0,
    offline: 0,
    unknown: 0,
    agents: [],
  };
  for (const row of rows) {
    const agent = await getAgentById(row.id, row.teamId);
    const runner = agent && (await getRunnerAgent(agent.userId));
    if (!agent || !runner) continue;
    const { revision } = await runtimePolicySnapshot(runner);
    const state = syncState(agent.runtimeState, agent.lastSeenAt, revision);
    summary.total++;
    summary[state]++;
    if (state !== 'synced' && summary.agents.length < 50) {
      summary.agents.push({
        id: agent.id,
        teamId: agent.teamId,
        username: agent.username,
        state,
        adapter: agent.runtimeState.adapter,
        drift: (agent.runtimeState.profile?.drift ?? []).map((entry) => entry.key),
        issues: agent.runtimeState.issues,
      });
    }
  }
  return summary;
}
