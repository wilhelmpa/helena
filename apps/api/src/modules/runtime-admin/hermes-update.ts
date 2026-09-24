import { db, agentProposal, aiAgent, getSetting, setSetting } from '@repo/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { askRuntime } from '#modules/agents/runtime-requests/service';
import { registerProposalKind } from '#modules/agents/proposals/service';

// Updating the Hermes installation the agents run on. A check asks a Hermes runner, whose
// root helper fetches the upstream and lists what an update brings. Requesting an update
// raises a proposal the instance owner approves on the approvals page; approving it has the
// runner hand the update to the helper, which rolls back on any failure.

const STATE_KEY = 'hermesUpdate';
const CHECK_TIMEOUT_MS = 170_000;

export interface VersionRef {
  commit: string;
  describe: string | null;
  version: string | null;
}

export interface UpdateCheck {
  current: VersionRef;
  latest: VersionRef;
  commits: { commit: string; date: string; subject: string }[];
  localPatches: { commit: string; date: string; subject: string }[];
}

interface StoredState {
  checkedAt: string;
  check: UpdateCheck;
}

// A Hermes runner that is online: the Home agent's when it is, any other otherwise. All of
// them run on the same installation.
async function hermesAgent(): Promise<number> {
  const rows = await db
    .select({ id: aiAgent.id, username: aiAgent.username })
    .from(aiAgent)
    .where(
      and(
        eq(aiAgent.kind, 'external'),
        eq(aiAgent.template, false),
        sql`${aiAgent.runtimeState}->>'adapter' = 'hermes'`,
        sql`${aiAgent.lastSeenAt} > now() - interval '2 minutes'`,
      ),
    )
    .orderBy(sql`${aiAgent.username} = 'master' DESC`, aiAgent.id)
    .limit(1);
  if (!rows[0]) throw new HttpError(503, 'No Hermes runner is online');
  return rows[0].id;
}

export async function checkHermesUpdate(userId: string): Promise<StoredState> {
  const check = await askRuntime<UpdateCheck>(
    await hermesAgent(),
    { op: 'runtime.update', action: 'check' },
    { userId, timeoutMs: CHECK_TIMEOUT_MS },
  );
  const state = { checkedAt: new Date().toISOString(), check };
  await setSetting(STATE_KEY, state);
  return state;
}

interface UpdatePayload {
  target: string;
  from: VersionRef;
  to: VersionRef;
  commits: UpdateCheck['commits'];
  localPatches: UpdateCheck['localPatches'];
  agentId?: number;
  helperRequestId?: string;
  result?: unknown;
  log?: string;
}

// Raises the proposal to update to the newest version the last check found.
export async function requestHermesUpdate(): Promise<number> {
  const state = await getSetting<StoredState>(STATE_KEY);
  if (!state) throw new HttpError(409, 'Check for an update first');
  const { current, latest } = state.check;
  if (current.commit === latest.commit || state.check.commits.length === 0) {
    throw new HttpError(409, 'Hermes is up to date');
  }
  const payload: UpdatePayload = {
    target: latest.commit,
    from: current,
    to: latest,
    commits: state.check.commits.slice(0, 200),
    localPatches: state.check.localPatches,
  };
  const title = `Hermes ${current.version ?? current.describe ?? current.commit.slice(0, 8)} → ${
    latest.version ?? latest.describe ?? latest.commit.slice(0, 8)
  }`;
  const [earlier] = await db
    .select({ id: agentProposal.id, status: agentProposal.status })
    .from(agentProposal)
    .where(
      and(eq(agentProposal.kind, 'hermes-update'), eq(agentProposal.externalId, latest.commit)),
    );
  if (earlier && !['rejected', 'failed'].includes(earlier.status)) {
    throw new HttpError(409, 'This update is already requested or done');
  }
  if (earlier) {
    await db
      .update(agentProposal)
      .set({
        status: 'pending',
        title,
        payload,
        decidedAt: null,
        decidedByUserId: null,
        error: null,
        note: null,
      })
      .where(eq(agentProposal.id, earlier.id));
    return earlier.id;
  }
  const [row] = await db
    .insert(agentProposal)
    .values({ kind: 'hermes-update', externalId: latest.commit, title, payload })
    .returning({ id: agentProposal.id });
  return row!.id;
}

async function decideHermesUpdate(
  proposalId: number,
  approved: boolean,
  userId: string,
  note: string | null,
): Promise<void> {
  const [proposal] = await db
    .update(agentProposal)
    .set({
      status: approved ? 'approved' : 'rejected',
      decidedByUserId: userId,
      decidedAt: new Date(),
      note,
    })
    .where(and(eq(agentProposal.id, proposalId), eq(agentProposal.status, 'pending')))
    .returning();
  if (!proposal) throw new HttpError(409, 'This proposal has already been decided');
  if (!approved) return;
  const payload = proposal.payload as UpdatePayload;
  try {
    const agentId = await hermesAgent();
    const started = await askRuntime<{ id: string }>(
      agentId,
      { op: 'runtime.update', action: 'apply', target: payload.target },
      { userId },
    );
    await db
      .update(agentProposal)
      .set({ payload: { ...payload, agentId, helperRequestId: started.id } })
      .where(eq(agentProposal.id, proposalId));
  } catch (error) {
    await db
      .update(agentProposal)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message.slice(0, 500) : 'The update did not start',
      })
      .where(eq(agentProposal.id, proposalId));
  }
}

registerProposalKind('hermes-update', decideHermesUpdate);

interface HelperStatus {
  id: string | null;
  state: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
  log?: string;
}

// An approved update that is running is followed through the runner until the helper says
// it is done or failed.
async function follow(proposal: typeof agentProposal.$inferSelect, userId: string) {
  const payload = proposal.payload as UpdatePayload;
  if (proposal.status !== 'approved' || !payload.helperRequestId || !payload.agentId) return;
  const status = await askRuntime<HelperStatus>(
    payload.agentId,
    { op: 'runtime.update', action: 'status' },
    { userId },
  ).catch(() => null);
  if (!status || status.id !== payload.helperRequestId || status.state === 'running') return;
  await db
    .update(agentProposal)
    .set({
      status: status.ok ? 'applied' : 'failed',
      error: status.ok ? null : (status.error ?? 'The update failed').slice(0, 500),
      payload: { ...payload, result: status.result ?? null, log: status.log?.slice(-20_000) },
    })
    .where(eq(agentProposal.id, proposal.id));
}

export async function hermesUpdateState(userId: string) {
  const [latest] = await db
    .select()
    .from(agentProposal)
    .where(eq(agentProposal.kind, 'hermes-update'))
    .orderBy(desc(agentProposal.id))
    .limit(1);
  if (latest) await follow(latest, userId);
  const [proposal] = latest
    ? await db.select().from(agentProposal).where(eq(agentProposal.id, latest.id))
    : [];
  const stored = await getSetting<StoredState>(STATE_KEY);
  return {
    checkedAt: stored?.checkedAt ?? null,
    check: stored?.check ?? null,
    proposal: proposal
      ? {
          id: proposal.id,
          status: proposal.status,
          title: proposal.title,
          error: proposal.error,
          decidedAt: proposal.decidedAt ? iso(proposal.decidedAt) : null,
          createdAt: iso(proposal.createdAt),
          log: (proposal.payload as UpdatePayload).log ?? null,
        }
      : null,
  };
}
