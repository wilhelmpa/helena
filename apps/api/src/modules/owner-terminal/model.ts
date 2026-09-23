import { t } from 'elysia';

// The only sessions the owner terminal ever starts. Fixed on purpose: nothing in
// this feature accepts a free-form command, from the API down to the shell script
// deployment/volition-stack/native/owner-terminal/owner-terminal-shell execs.
export const OWNER_TERMINAL_KINDS = [
  'shell',
  'claude',
  'codex',
  'helena-dev-claude',
  'helena-dev-codex',
] as const;
export type OwnerTerminalKind = (typeof OWNER_TERMINAL_KINDS)[number];

// A tmux/wetty session name within one kind ("main", "scratch-2"). Same shape as a
// project slug elsewhere in the app.
export const SESSION_NAME_PATTERN = '^[a-z0-9][a-z0-9-]{0,31}$';

export const OwnerTerminalKindParam = t.Object({ kind: t.UnionEnum([...OWNER_TERMINAL_KINDS]) });

export const StepUpTotpBody = t.Object({
  code: t.String({ pattern: '^[0-9]{6}$', description: 'The 6-digit TOTP code' }),
});

export const OwnerTerminalGrantResponse = t.Object({
  active: t.Boolean(),
  method: t.Union([t.Literal('totp'), t.Literal('passkey'), t.Null()]),
  expiresAt: t.Union([t.String(), t.Null()]),
  device: t.Union([t.String(), t.Null()]),
  ipAddress: t.Union([t.String(), t.Null()]),
});

export const SessionEventBody = t.Object({
  kind: t.UnionEnum([...OWNER_TERMINAL_KINDS]),
  name: t.String({ pattern: SESSION_NAME_PATTERN }),
});

export const OwnerTerminalAuditEntry = t.Object({
  id: t.Number(),
  event: t.String(),
  kind: t.Union([t.String(), t.Null()]),
  sessionName: t.Union([t.String(), t.Null()]),
  device: t.Union([t.String(), t.Null()]),
  ipAddress: t.Union([t.String(), t.Null()]),
  detail: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
});

export const OwnerTerminalAuditResponse = t.Array(OwnerTerminalAuditEntry);

// `stepUpMethods` and the passkey branch of `method` above are forward-looking:
// WebAuthn needs a secure context, which http://kingston-server.local is not, so
// passkey step-up is wired once Cloudflare Access puts the instance behind HTTPS
// (see CLAUDE.md "Security end state"). Until then the api only implements
// /owner-terminal/step-up/totp and this setting has one usable value.
export const OwnerTerminalSettingsResponse = t.Object({
  stepUpMethods: t.Array(t.Union([t.Literal('totp'), t.Literal('passkey')])),
  sudoPasswordRequired: t.Boolean(),
  recordOutput: t.Record(t.String(), t.Boolean()),
});

export const OwnerTerminalSettingsPatch = t.Partial(OwnerTerminalSettingsResponse);

export const TokenResponse = t.Object({ token: t.String() });

export const StepUpResponse = t.Object({ expiresAt: t.String() });
