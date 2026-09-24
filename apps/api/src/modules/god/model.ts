import { t } from 'elysia';
import { REGISTRATION_MODES } from '@repo/auth';
import { pageQueryFields, pageResponse } from '#shared/pagination';
import { PermissionMatrixSchema } from '#shared/permissions';
import { USER_KINDS } from './service';
import { agentSyncSummary } from '#modules/agents/runtime-sync/model';

const encryption = t.UnionEnum(['none', 'ssl', 'tls']);

export const userParams = t.Object({ userId: t.String() });

export const projectParams = t.Object({ projectId: t.Numeric() });

export const listUsersQuery = t.Object({
  search: t.Optional(t.String()),
  // Agent bot users are accounts too, but they are managed on a project's AI
  // Agents screen, so the directory lists people unless asked otherwise.
  kind: t.Optional(t.UnionEnum([...USER_KINDS])),
  ...pageQueryFields,
});

// The query every searchable directory listing takes: the projects, the teams, and a
// team's own projects and members.
export const searchPageQuery = t.Object({
  search: t.Optional(t.String()),
  ...pageQueryFields,
});

export const deleteUserQuery = t.Object({
  // Delete the projects this user owns alone along with the account. Every
  // issue, comment and attachment in them goes too.
  withProjects: t.Optional(t.Boolean()),
});

export const AuthSettingsResponse = t.Object({
  registration: t.UnionEnum([...REGISTRATION_MODES]),
  requireEmailVerification: t.Boolean(),
  magicLink: t.Boolean(),
  emailPassword: t.Boolean(),
  trustProviderEmails: t.Boolean(),
  // The settings that depend on outbound email cannot be turned on without a mail
  // provider, and the UI explains why.
  hasEmailProvider: t.Boolean(),
  // Password sign-in cannot be turned off without another way in, and the UI
  // explains why.
  hasSsoProvider: t.Boolean(),
});

export const AuthSettingsBody = t.Object({
  registration: t.Optional(t.UnionEnum([...REGISTRATION_MODES])),
  requireEmailVerification: t.Optional(t.Boolean()),
  magicLink: t.Optional(t.Boolean()),
  emailPassword: t.Optional(t.Boolean()),
  trustProviderEmails: t.Optional(t.Boolean()),
});

export const EmailSettingsResponse = t.Object({
  smtp: t.Object({
    enabled: t.Boolean(),
    host: t.String(),
    port: t.Nullable(t.Number()),
    encryption,
    username: t.String(),
    hasPassword: t.Boolean(),
    timeout: t.Nullable(t.Number()),
  }),
  resend: t.Object({ enabled: t.Boolean(), hasApiKey: t.Boolean() }),
  from: t.String(),
  // Whether projects may deliver their notifications through this provider instead
  // of configuring one of their own.
  allowProjects: t.Boolean(),
});

export const EmailSettingsBody = t.Object({
  smtp: t.Optional(
    t.Object({
      enabled: t.Boolean(),
      host: t.String(),
      port: t.Nullable(t.Integer({ minimum: 1, maximum: 65535 })),
      encryption,
      username: t.String(),
      password: t.Optional(t.String()),
      timeout: t.Nullable(t.Integer({ minimum: 1 })),
    }),
  ),
  resend: t.Optional(t.Object({ enabled: t.Boolean(), apiKey: t.Optional(t.String()) })),
  from: t.Optional(t.String()),
  allowProjects: t.Optional(t.Boolean()),
});

export const EmailTestResponse = t.Object({ recipient: t.String() });

export const GoogleSettingsResponse = t.Object({
  enabled: t.Boolean(),
  clientId: t.String(),
  hasClientSecret: t.Boolean(),
  // The value to register in the Google Cloud console. Derived from the API origin,
  // so the UI shows it rather than asking the owner to assemble it.
  redirectUri: t.String(),
});

export const GoogleSettingsBody = t.Object({
  enabled: t.Optional(t.Boolean()),
  clientId: t.Optional(t.String()),
  clientSecret: t.Optional(t.String()),
});

export const OidcSettingsResponse = t.Object({
  enabled: t.Boolean(),
  label: t.String(),
  discoveryUrl: t.String(),
  clientId: t.String(),
  hasClientSecret: t.Boolean(),
  scopes: t.Array(t.String()),
  pkce: t.Boolean(),
  // The value to register with the identity provider. Derived from the API origin,
  // so the UI shows it rather than asking the owner to assemble it.
  redirectUri: t.String(),
});

export const OidcSettingsBody = t.Object({
  enabled: t.Optional(t.Boolean()),
  label: t.Optional(t.String({ maxLength: 60 })),
  discoveryUrl: t.Optional(t.String({ maxLength: 2048 })),
  clientId: t.Optional(t.String({ maxLength: 512 })),
  clientSecret: t.Optional(t.String({ maxLength: 512 })),
  scopes: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 })),
  pkce: t.Optional(t.Boolean()),
});

export const ScimSettingsResponse = t.Object({
  enabled: t.Boolean(),
  hasToken: t.Boolean(),
  tokenPrefix: t.String(),
  // Where to point the identity provider. Derived from the API origin, like the
  // OIDC redirect URI.
  baseUrl: t.String(),
});

export const ScimSettingsBody = t.Object({
  enabled: t.Optional(t.Boolean()),
});

// The generated token, returned once. It is not stored anywhere it can be read
// back, so a lost token is replaced rather than recovered.
export const ScimTokenResponse = t.Object({
  token: t.String(),
});

const scimGroupMapping = t.Object({
  projectId: t.Integer(),
  role: t.UnionEnum(['owner', 'member']),
  // Which project_role a member joins on. Null for an owner (owners bypass the
  // permission matrix) or to fall back to the project's default role.
  roleId: t.Nullable(t.Integer()),
});

export const ScimGroupResponse = t.Object({
  id: t.String(),
  displayName: t.String(),
  externalId: t.Nullable(t.String()),
  memberCount: t.Integer(),
  mappings: t.Array(
    t.Intersect([scimGroupMapping, t.Object({ projectKey: t.String(), projectName: t.String() })]),
  ),
});

export const ScimGroupMappingsBody = t.Object({
  mappings: t.Array(scimGroupMapping, { maxItems: 100 }),
});

export const scimGroupParams = t.Object({ groupId: t.String() });

export const StorageSettingsBody = t.Object({
  maxAttachmentMb: t.Optional(t.Integer({ minimum: 1, maximum: 10240 })),
  maxAvatarMb: t.Optional(t.Integer({ minimum: 1, maximum: 1024 })),
  attachmentMimeTypes: t.Optional(t.Array(t.String({ minLength: 1 }))),
  projectQuotaMb: t.Optional(t.Integer({ minimum: 0 })),
});

export const TelegramSettingsResponse = t.Object({
  enabled: t.Boolean(),
  // Resolved from Telegram when the token is saved. Shown so the administrator can
  // confirm which bot the token belongs to, and used to build the link deep link.
  botUsername: t.String(),
  hasBotToken: t.Boolean(),
});

export const TelegramSettingsBody = t.Object({
  enabled: t.Optional(t.Boolean()),
  botToken: t.Optional(t.String()),
});

const InstanceUserResponse = t.Object({
  id: t.String(),
  name: t.String(),
  email: t.String(),
  image: t.Nullable(t.String()),
  emailVerified: t.Boolean(),
  role: t.String(),
  isAgent: t.Boolean(),
  providers: t.Array(t.String()),
  projectCount: t.Number(),
  lastSeenAt: t.Nullable(t.String()),
  createdAt: t.String(),
});

export const InstanceUserDetailResponse = t.Composite([
  InstanceUserResponse,
  t.Object({
    projects: t.Array(
      t.Object({
        projectId: t.Number(),
        projectKey: t.String(),
        projectName: t.String(),
        role: t.UnionEnum(['owner', 'member']),
        roleId: t.Nullable(t.Number()),
        roleName: t.Nullable(t.String()),
        permissions: PermissionMatrixSchema,
        ownerCount: t.Number(),
        joinedAt: t.String(),
      }),
    ),
  }),
]);

export const InstanceUserPageResponse = pageResponse(InstanceUserResponse);

const InstanceProjectResponse = t.Object({
  id: t.Number(),
  key: t.String(),
  name: t.String(),
  description: t.String(),
  mcpEnabled: t.Boolean(),
  memberCount: t.Number(),
  issueCount: t.Number(),
  archivedIssueCount: t.Number(),
  initiativeCount: t.Number(),
  dashboardCount: t.Number(),
  viewCount: t.Number(),
  agentCount: t.Number(),
  skillCount: t.Number(),
  toolCount: t.Number(),
  lastActivityAt: t.Nullable(t.String()),
  createdAt: t.String(),
});

export const InstanceProjectDetailResponse = t.Composite([
  InstanceProjectResponse,
  t.Object({
    members: t.Array(
      t.Object({
        userId: t.String(),
        name: t.String(),
        email: t.String(),
        username: t.Nullable(t.String()),
        image: t.Nullable(t.String()),
        isAgent: t.Boolean(),
        role: t.UnionEnum(['owner', 'member']),
        roleId: t.Nullable(t.Number()),
        roleName: t.Nullable(t.String()),
        permissions: PermissionMatrixSchema,
        description: t.String(),
        timezone: t.String(),
        joinedAt: t.String(),
      }),
    ),
    roles: t.Array(t.Object({ id: t.Integer(), name: t.String(), isDefault: t.Boolean() })),
  }),
]);

export const InstanceProjectPageResponse = pageResponse(InstanceProjectResponse);

export const InstanceProjectOptionListResponse = t.Array(
  t.Object({ id: t.Number(), key: t.String(), name: t.String() }),
);

export const teamParams = t.Object({ teamId: t.Numeric() });

export const InstanceTeamResponse = t.Object({
  id: t.Number(),
  name: t.String(),
  mcpEnabled: t.Boolean(),
  memberCount: t.Number(),
  projectCount: t.Number(),
  issueCount: t.Number(),
  agentCount: t.Number(),
  skillCount: t.Number(),
  toolCount: t.Number(),
  roleCount: t.Number(),
  createdAt: t.String(),
});

export const InstanceTeamPageResponse = pageResponse(InstanceTeamResponse);

export const InstanceTeamProjectPageResponse = pageResponse(
  t.Object({
    id: t.Number(),
    key: t.String(),
    name: t.String(),
    mcpEnabled: t.Boolean(),
    memberCount: t.Number(),
    issueCount: t.Number(),
    createdAt: t.String(),
  }),
);

export const InstanceTeamMemberPageResponse = pageResponse(
  t.Object({
    userId: t.String(),
    name: t.String(),
    email: t.String(),
    image: t.Nullable(t.String()),
    isAgent: t.Boolean(),
    role: t.UnionEnum(['owner', 'manager', 'member', 'agent']),
    joinedAt: t.String(),
  }),
);

export const EngineSettingsResponse = t.Object({
  defaultTimezone: t.String({ description: 'The time zone used where none is named.' }),
  serverTimezone: t.String(),
  timezoneSet: t.Boolean({ description: 'Whether the default is set here, not the server’s.' }),
});

export const SystemHealthResponse = t.Object({
  agents: agentSyncSummary,
  services: t.Array(
    t.Object({
      service: t.Union([
        t.Literal('runner'),
        t.Literal('engine'),
        t.Literal('provisioning'),
        t.Literal('worker'),
      ]),
      state: t.Union([t.Literal('ok'), t.Literal('down'), t.Literal('unknown')], {
        description: 'unknown: the service has never been seen.',
      }),
      lastSeenAt: t.Nullable(t.String({ description: 'When it was last seen working.' })),
      error: t.Nullable(t.String({ description: 'Why the last check failed.' })),
    }),
  ),
  runs: t.Object({
    waiting: t.Number({ description: 'Agent runs due and not claimed.' }),
    oldestWaitingSince: t.Nullable(t.String()),
    overdue: t.Number({ description: 'Claimed runs still running past their time limit.' }),
    resuming: t.Number({
      description:
        'Runs waiting to resume, or already resumed, the coding agent session of a ' +
        'runner that died mid run.',
    }),
    failedLastDay: t.Number(),
    needsResumeReview: t.Number({
      description: 'Runs that reached the resume limit and need the owner to look at them.',
    }),
    provisioningFailed: t.Number({ description: 'Provisioning jobs that gave up.' }),
  }),
  engine: t.Object({
    running: t.Boolean({ description: 'Whether the engine runs in this api process.' }),
    executorId: t.Nullable(t.String()),
    queued: t.Number({
      description: 'Runs written but not started yet (their start is retried).',
    }),
    active: t.Number({ description: 'Runs working now: running, or waiting for an agent.' }),
    waiting: t.Number({ description: 'Runs waiting for an approval or a wait step.' }),
    failedLastDay: t.Number({ description: 'Runs that failed in the last 24 hours.' }),
    stalled: t.Number({
      description:
        'Active runs the engine has not moved on for 30 minutes although nothing they wait ' +
        'for is pending.',
    }),
    schedules: t.Number({ description: 'Enabled routines and workflow schedules.' }),
    overdueSchedules: t.Number({
      description: 'Enabled schedules whose time passed over five minutes ago without a fire.',
    }),
    lastErrors: t.Array(
      t.Object({
        runId: t.String(),
        projectKey: t.String(),
        name: t.String(),
        error: t.String(),
        at: t.String(),
      }),
      { description: 'The newest failures, newest first.' },
    ),
  }),
  janitors: t.Array(
    t.Object({
      job: t.Union([
        t.Literal('run-janitor'),
        t.Literal('resume-janitor'),
        t.Literal('engine-maintenance'),
        t.Literal('runtime-janitor'),
      ]),
      state: t.Union([t.Literal('ok'), t.Literal('down'), t.Literal('unknown')], {
        description: 'unknown: the job has never run.',
      }),
      ranAt: t.Nullable(t.String({ description: 'When it last ran.' })),
      cleaned: t.Nullable(
        t.Number({
          description:
            'What it cleaned up that run. Stays at the last run that had a count while the ' +
            'most recent run failed before counting anything.',
        }),
      ),
      error: t.Nullable(t.String({ description: 'Why the last run failed.' })),
    }),
  ),
});
