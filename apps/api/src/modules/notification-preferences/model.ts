import { t } from 'elysia';

const EventToggles = t.Object({
  assigned: t.Boolean(),
  mentioned: t.Boolean(),
  commented: t.Boolean(),
  state_changed: t.Boolean(),
  // Optional so a client written before the event existed keeps saving its toggles; the
  // stored value is kept then.
  approval_requested: t.Optional(t.Boolean()),
});

// Request body of the PUT and the response of both routes.
export const NotificationPreferenceBody = t.Object({
  emailEvents: EventToggles,
  telegramEvents: EventToggles,
});
