import { t, type Static } from 'elysia';

const previewName = t.String({ pattern: '^[a-z0-9][a-z0-9-]{0,39}$' });
export const previewParams = t.Object({ projectKey: t.String() });
export const previewQuery = t.Object({ name: t.Optional(previewName) });
export const previewLogsQuery = t.Object({
  name: t.Optional(previewName),
  tail: t.Optional(t.Numeric({ minimum: 1, maximum: 200, default: 100 })),
});
export const previewStartBody = t.Object({
  name: t.Optional(previewName),
  cwd: t.Optional(
    t.String({
      maxLength: 512,
      description: 'Directory relative to this project workspace. Omit to detect its dev app.',
    }),
  ),
  command: t.Optional(
    t.String({
      maxLength: 120,
      description:
        'Optional supported dev command: astro dev, vite, next dev, npm run dev or bun run dev. No shell syntax or installation.',
    }),
  ),
  idleTimeoutSec: t.Optional(t.Integer({ minimum: 60, maximum: 86400 })),
});
export const PreviewSchema = t.Object({
  name: t.String(),
  slug: t.String(),
  status: t.Union([
    t.Literal('starting'),
    t.Literal('running'),
    t.Literal('stopped'),
    t.Literal('failed'),
  ]),
  url: t.String(),
  port: t.Integer(),
  cwd: t.String(),
  command: t.String(),
  startedAt: t.Nullable(t.Number()),
  lastActivityAt: t.Nullable(t.Number()),
  idleTimeoutSec: t.Number(),
  error: t.Optional(t.String()),
});
export const PreviewReply = t.Object({
  preview: PreviewSchema,
  lines: t.Optional(t.Array(t.String())),
  browserInstruction: t.Optional(t.String()),
});
export const PreviewList = t.Object({
  previews: t.Array(PreviewSchema),
  projectId: t.Number(),
  canManage: t.Boolean(),
});
export const PreviewLogs = t.Object({ preview: PreviewSchema, lines: t.Array(t.String()) });
export const PreviewUrl = t.Object({
  name: t.String(),
  url: t.String(),
  browserInstruction: t.String(),
});
export type Preview = Static<typeof PreviewSchema>;
export type PreviewStart = Static<typeof previewStartBody>;
