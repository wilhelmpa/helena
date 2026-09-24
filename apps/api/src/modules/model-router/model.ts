import { t } from 'elysia';

// What the model router did for one run or chat answer (docs/helena-decisions/decisions.md
// §4): the configured model, the one used, whether it changed, and why.
export const modelRoute = t.Object({
  fromModel: t.String(),
  toModel: t.String(),
  routed: t.Boolean(),
  tier: t.Nullable(t.String()),
  confidence: t.Nullable(t.Number()),
  needsContext: t.Nullable(t.Number()),
  reason: t.String(),
});
