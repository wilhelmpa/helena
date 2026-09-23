import { t } from 'elysia';

export const ProjectMailAccountResponse = t.Object({
  provider: t.Literal('gmail'),
  account: t.String(),
  assignmentStatus: t.Literal('configured'),
  connectionStatus: t.Union([
    t.Literal('connected'),
    t.Literal('available'),
    t.Literal('configured'),
    t.Literal('disabled'),
    t.Literal('unavailable'),
    t.Literal('unsupported'),
    t.Literal('error'),
  ]),
  lastCheckedAt: t.Nullable(t.String()),
  lastError: t.Nullable(t.String()),
});
