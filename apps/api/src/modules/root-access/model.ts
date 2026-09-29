import { t } from 'elysia';

export const rootCommandBody = t.Object({
  command: t.String({ minLength: 1, maxLength: 4096 }),
  reason: t.String({ minLength: 1, maxLength: 2000 }),
});
export const rootSettingsBody = t.Object({ enabled: t.Boolean(), directOnly: t.Boolean() });
