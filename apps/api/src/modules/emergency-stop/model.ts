import { t } from 'elysia';

export const EmergencyStopResponse = t.Object({
  active: t.Boolean(),
  reason: t.Nullable(t.String()),
  since: t.Nullable(t.String({ description: 'When it was switched on (ISO).' })),
  byUserId: t.Nullable(t.String()),
});

export const emergencyStopBody = t.Object({
  active: t.Boolean(),
  reason: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
});
