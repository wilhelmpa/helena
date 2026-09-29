import { t } from 'elysia';

// The fields a task view shows, per layout: property keys such as 'id', 'priority' or
// 'goal', and 'cf:<id>' for a custom field. The keys are not checked against the app's
// list here (a project keeps working when the app gains or drops a property); the web
// drops what it does not know. Bounded, so the row stays small.
const PropertyKey = t.String({
  minLength: 1,
  maxLength: 40,
  pattern: '^[A-Za-z][A-Za-z0-9]*(:[0-9]+)?$',
});
const Properties = t.Array(PropertyKey, { maxItems: 60 });

export const FieldDefaultsSchema = t.Object({
  kanban: t.Optional(Properties),
  list: t.Optional(Properties),
  table: t.Optional(Properties),
  calendar: t.Optional(Properties),
});

export const DisplayDefaultsResponse = t.Object({
  // Saved by a project admin for everyone in the project.
  project: t.Nullable(FieldDefaultsSchema),
  // Saved by the member for every project without one of its own (Home).
  global: t.Nullable(FieldDefaultsSchema),
});

export const SetDisplayDefaultsBody = t.Object({
  // null removes the saved default.
  defaults: t.Nullable(FieldDefaultsSchema),
});
