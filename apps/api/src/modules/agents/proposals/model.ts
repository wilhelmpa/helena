import { t } from 'elysia';

const kind = t.Union([t.Literal('memory-write'), t.Literal('hermes-update')]);
const status = t.Union([
  t.Literal('pending'),
  t.Literal('approved'),
  t.Literal('rejected'),
  t.Literal('applied'),
  t.Literal('failed'),
]);

export const ProposalResponse = t.Object({
  id: t.Number(),
  kind,
  status,
  title: t.String(),
  payload: t.Unknown({
    description:
      'memory-write: { file, before, after, baseSha256, sha256 } or { type: fact, input, scope }. hermes-update: { from, to, ' +
      'commits, notes }.',
  }),
  agentId: t.Nullable(t.Number()),
  agentName: t.Nullable(t.String()),
  agentUsername: t.Nullable(t.String()),
  teamId: t.Nullable(t.Number()),
  decidedByName: t.Nullable(t.String()),
  decidedAt: t.Nullable(t.String()),
  note: t.Nullable(t.String()),
  error: t.Nullable(t.String()),
  createdAt: t.String(),
});

export const ProposalListResponse = t.Array(ProposalResponse);

export const proposalListQuery = t.Object({
  status: t.Optional(t.Union([t.Literal('pending'), t.Literal('decided')])),
});

export const proposalParams = t.Object({ proposalId: t.Numeric() });

export const proposalDecisionBody = t.Object({
  approved: t.Boolean(),
  note: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
});

export const ProposalCountResponse = t.Object({ count: t.Number() });

export const memoryRevisionQuery = t.Object({
  file: t.Optional(t.Union([t.Literal('MEMORY.md'), t.Literal('USER.md')])),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
});

export const MemoryRevisionListResponse = t.Array(
  t.Object({
    id: t.Number(),
    file: t.Union([t.Literal('MEMORY.md'), t.Literal('USER.md')]),
    content: t.String(),
    sha256: t.String(),
    source: t.Union([t.Literal('agent'), t.Literal('owner'), t.Literal('observed')]),
    sourceContext: t.Nullable(t.Unknown()),
    proposalId: t.Nullable(t.Number()),
    userName: t.Nullable(t.String()),
    createdAt: t.String(),
  }),
);
