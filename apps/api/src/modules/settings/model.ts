import { t } from 'elysia';
import { oneOf } from '#shared/schemas';

export const DisplayNameSchema = t.Object({
  displayName: t.String({ minLength: 1, maxLength: 40 }),
});

export const StorageSettingsSchema = t.Object({
  maxAttachmentMb: t.Number(),
  maxAvatarMb: t.Number(),
  attachmentMimeTypes: t.Array(t.String()),
  projectQuotaMb: t.Number(),
});

// A default budget of a new project (owner 28.09., Paperclip's budgets): the same metrics
// and periods as a project's own budgets.
const DefaultBudgetSchema = t.Object({
  metric: oneOf(['tokens', 'cost', 'time']),
  period: oneOf(['day', 'month']),
  limit: t.Number({ exclusiveMinimum: 0, maximum: 1e15 }),
});

export const ProjectDefaultsSchema = t.Object({
  mcpEnabled: t.Boolean(),
  autopilotLevel: t.Union([t.Literal(0), t.Literal(1), t.Literal(2), t.Literal(3)]),
  budgets: t.Array(DefaultBudgetSchema, {
    maxItems: 6,
    description:
      'The budgets a new project starts with (one per metric and period). A project changes ' +
      'its own; the settings mark where it differs from this default.',
  }),
});

export const ProjectDefaultsPatchSchema = t.Partial(ProjectDefaultsSchema);

export const RunResumeSettingsSchema = t.Object({
  maxResumes: t.Number({
    minimum: 0,
    maximum: 20,
    description:
      'How many times a run may resume its coding agent session after the runner ' +
      'holding it died mid run, before it stops on its own and asks the owner to look ' +
      'at it. 0 turns resuming off: an interrupted run is retried fresh instead.',
  }),
});

// A command id bound to a combination written as modifier tokens plus a key
// ('mod+k', 'n'). The set of commands lives in the web app (its lib/hotkeys), so
// the API checks the shape and stores the map as given.
export const HotkeyCombosSchema = t.Record(
  t.String({ pattern: '^[a-z][a-z0-9.-]{0,63}$' }),
  t.String({ pattern: '^(mod\\+|shift\\+|alt\\+)*[a-z0-9]{1,10}$' }),
);

const ReleaseSchema = t.Object({
  tag: t.String(),
  version: t.String(),
  publishedAt: t.String(),
  url: t.Nullable(t.String()),
  notes: t.String(),
  notesFormat: oneOf(['html', 'markdown']),
});

export const UpdateStatusSchema = t.Object({
  currentVersion: t.String(),
  latestVersion: t.Nullable(t.String()),
  updateAvailable: t.Boolean(),
  checkedAt: t.Nullable(t.String()),
  releases: t.Array(ReleaseSchema),
});

export const VersionResponse = t.Object({ version: t.String() });

const RenameSchema = t.Object({ from: t.String(), to: t.String() });

// What migration 0115 did to this instance's data, as the migration recorded it.
const TeamsMigrationSchema = t.Object({
  version: t.Number(),
  teams: t.Array(
    t.Object({
      name: t.String(),
      projects: t.Array(t.Object({ key: t.String(), name: t.String() })),
    }),
  ),
  renamed: t.Record(t.String(), t.Array(RenameSchema)),
  merged: t.Object({ roles: t.Number(), agentTools: t.Number() }),
  movedInvites: t.Number(),
  droppedNotificationSettings: t.Array(t.String()),
});

const BackupSchema = t.Object({
  path: t.String(),
  sizeBytes: t.Number(),
  createdAt: t.String(),
  expiresAt: t.String(),
  migrations: t.Array(t.String()),
});

export const WhatsNewSchema = t.Object({
  version: t.String(),
  pending: t.Boolean(),
  releases: t.Array(ReleaseSchema),
  backup: t.Nullable(BackupSchema),
  migration: t.Nullable(TeamsMigrationSchema),
});
