import { t } from 'elysia';

export const templateParams = t.Object({ projectKey: t.String(), templateId: t.Numeric() });
export const templateKind = t.Union([t.Literal('project'), t.Literal('board')]);

export const captureTemplateBody = t.Object(
  {
    name: t.String({ minLength: 1, maxLength: 120 }),
    description: t.Optional(t.String({ maxLength: 500 })),
    kind: templateKind,
  },
  { additionalProperties: false },
);

export const updateTemplateBody = t.Object(
  {
    name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
    description: t.Optional(t.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

export const TemplateResponse = t.Object({
  id: t.Number(),
  teamId: t.Number(),
  kind: templateKind,
  name: t.String(),
  description: t.String(),
  createdBy: t.Nullable(t.String()),
  stateCount: t.Number(),
  folderCount: t.Number(),
  viewCount: t.Number(),
  workflowCount: t.Number(),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const ApplyTemplateResponse = t.Object({
  states: t.Number(),
  folders: t.Number(),
  views: t.Number(),
  workflows: t.Number(),
  requestedResources: t.Array(t.String()),
});
