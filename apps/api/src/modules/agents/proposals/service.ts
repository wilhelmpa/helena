import { db, agentProposal, aiAgent, teamMember, user } from '@repo/db';
import { alias } from 'drizzle-orm/pg-core';
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { decideMemoryProposal } from '../memory/service';

// Changes an agent's runtime raised for the owner's decision, listed with the approvals:
// memory writes the runner held back, and updates of the runtime itself. A team's owners
// and managers decide on its agents' proposals; the instance owner decides on the rest and
// on every proposal.

export type ProposalKind = 'memory-write' | 'hermes-update';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';

export interface ProposalDto {
  id: number;
  kind: ProposalKind;
  status: ProposalStatus;
  title: string;
  payload: unknown;
  agentId: number | null;
  agentName: string | null;
  agentUsername: string | null;
  teamId: number | null;
  decidedByName: string | null;
  decidedAt: string | null;
  note: string | null;
  error: string | null;
  createdAt: string;
}

// Kinds decided by someone other than the instance owner, and how.
type Decide = (
  proposalId: number,
  approved: boolean,
  userId: string,
  note: string | null,
) => Promise<void>;
const deciders = new Map<ProposalKind, Decide>([['memory-write', decideMemoryProposal]]);

// Lets a feature decide the proposals of its kind (the runtime update registers its own).
export function registerProposalKind(kind: ProposalKind, decide: Decide): void {
  deciders.set(kind, decide);
}

const agentUser = alias(user, 'agent_user');
const decider = alias(user, 'decider');

async function visibleTo(userId: string, isOwner: boolean): Promise<SQL | undefined> {
  if (isOwner) return undefined;
  const teams = await db
    .select({ teamId: teamMember.teamId })
    .from(teamMember)
    .where(and(eq(teamMember.userId, userId), inArray(teamMember.role, ['owner', 'manager'])));
  if (teams.length === 0) return sql`false`;
  return inArray(
    aiAgent.teamId,
    teams.map((team) => team.teamId),
  );
}

function select() {
  return db
    .select({
      id: agentProposal.id,
      kind: agentProposal.kind,
      status: agentProposal.status,
      title: agentProposal.title,
      payload: agentProposal.payload,
      agentId: agentProposal.agentId,
      agentName: agentUser.name,
      agentUsername: aiAgent.username,
      teamId: aiAgent.teamId,
      decidedByName: decider.name,
      decidedAt: agentProposal.decidedAt,
      note: agentProposal.note,
      error: agentProposal.error,
      createdAt: agentProposal.createdAt,
    })
    .from(agentProposal)
    .leftJoin(aiAgent, eq(aiAgent.id, agentProposal.agentId))
    .leftJoin(agentUser, eq(agentUser.id, aiAgent.userId))
    .leftJoin(decider, eq(decider.id, agentProposal.decidedByUserId));
}

type Row = Awaited<ReturnType<typeof select>>[number];

function toDto(row: Row): ProposalDto {
  return {
    ...row,
    kind: row.kind as ProposalKind,
    status: row.status as ProposalStatus,
    decidedAt: row.decidedAt ? iso(row.decidedAt) : null,
    createdAt: iso(row.createdAt),
  };
}

export async function listProposals(
  viewer: { id: string; isOwner: boolean },
  status: 'pending' | 'decided',
): Promise<ProposalDto[]> {
  const scope = await visibleTo(viewer.id, viewer.isOwner);
  const rows = await select()
    .where(
      and(
        status === 'pending'
          ? eq(agentProposal.status, 'pending')
          : sql`${agentProposal.status} <> 'pending'`,
        // A proposal of the instance is the instance owner's alone.
        viewer.isOwner ? undefined : sql`${agentProposal.agentId} IS NOT NULL`,
        scope,
      ),
    )
    .orderBy(desc(agentProposal.id))
    .limit(100);
  return rows.map(toDto);
}

export async function countPendingProposals(viewer: { id: string; isOwner: boolean }) {
  const scope = await visibleTo(viewer.id, viewer.isOwner);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentProposal)
    .leftJoin(aiAgent, eq(aiAgent.id, agentProposal.agentId))
    .where(
      and(
        eq(agentProposal.status, 'pending'),
        viewer.isOwner ? undefined : sql`${agentProposal.agentId} IS NOT NULL`,
        scope,
      ),
    );
  return row?.n ?? 0;
}

export async function decideProposal(
  viewer: { id: string; isOwner: boolean },
  proposalId: number,
  approved: boolean,
  note: string | null,
): Promise<ProposalDto> {
  const scope = await visibleTo(viewer.id, viewer.isOwner);
  const [row] = await select().where(
    and(
      eq(agentProposal.id, proposalId),
      viewer.isOwner ? undefined : sql`${agentProposal.agentId} IS NOT NULL`,
      scope ? or(scope) : undefined,
    ),
  );
  if (!row) throw new HttpError(404, 'Proposal not found');
  const decide = deciders.get(row.kind as ProposalKind);
  if (!decide) throw new HttpError(409, 'This proposal cannot be decided here');
  await decide(proposalId, approved, viewer.id, note?.trim() || null);
  const [after] = await select().where(eq(agentProposal.id, proposalId));
  return toDto(after!);
}
