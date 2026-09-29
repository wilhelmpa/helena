import { localTerminalOptions } from './local-model';
import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireGod } from '#shared/access';
import { noContent } from '#shared/http';
import { commonErrors, errors } from '#shared/responses';
import { requireInteractiveOwner } from '#modules/connections/interactive';
import {
  LocalTerminalOptionsResponse,
  StepUpTotpBody,
  StepUpResponse,
  OwnerTerminalGrantResponse,
  SessionEventBody,
  OwnerTerminalAuditResponse,
  OwnerTerminalSettingsResponse,
  OwnerTerminalSettingsPatch,
} from './model';
import {
  stepUpWithTotp,
  grantStatus,
  revokeGrant,
  listAudit,
  recordSessionEvent,
  getOwnerTerminalSettingsForApi,
  setOwnerTerminalSettings,
} from './service';

// The owner terminal (Home -> Terminal, Home -> Security): step-up, the 12h grant
// it opens, its audit trail and the instance policy. Every route here is the
// instance owner's own interactive session only -- never a project role, never an
// API key or an agent. requireInteractiveOwner also enforces the trusted-origin
// check on writes, the same guard the vault device sync uses for the same reason
// (a personal API key must not turn into a root shell).
export const ownerTerminalRoutes = new Elysia({
  name: 'owner-terminal',
  detail: { tags: ['Owner terminal'] },
})
  .use(authContext)
  .onBeforeHandle(async ({ user, request }) => {
    const owner = requireGod(user);
    await requireInteractiveOwner(request, owner.id);
  })
  .get('/owner-terminal/local-models', () => localTerminalOptions(), {
    response: { 200: LocalTerminalOptionsResponse, ...errors(401, 403) },
    detail: { summary: 'Read loaded local owner-terminal model options' },
  })
  .post(
    '/owner-terminal/step-up/totp',
    async ({ body, request, set }) => {
      const result = await stepUpWithTotp(request, body.code);
      set.headers['Cache-Control'] = 'private, no-store';
      return result;
    },
    {
      body: StepUpTotpBody,
      response: { 200: StepUpResponse, ...commonErrors, ...errors(409, 429, 503) },
      detail: {
        summary: 'Re-authenticate with a TOTP code and open a 12h terminal grant',
        description:
          'Verifies the code against the code already enrolled at Account -> Security, ' +
          'replaces any grant already open for this owner, and returns when the new one ' +
          'expires. Rate-limited to 5 attempts per 15 minutes; a 6th attempt in that ' +
          'window is refused (429) without checking the code.',
      },
    },
  )
  .get(
    '/owner-terminal/grant',
    async ({ request, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return grantStatus(request);
    },
    {
      response: { 200: OwnerTerminalGrantResponse, ...errors(401, 403) },
      detail: {
        summary: 'Read the current terminal grant',
        description: 'Whether this session holds a live 12h terminal grant, and until when.',
      },
    },
  )
  .post(
    '/owner-terminal/grant/revoke',
    async ({ request }) => {
      await revokeGrant(request);
      return noContent();
    },
    {
      response: { 204: t.Void(), ...errors(401, 403) },
      detail: {
        summary: 'Revoke the current terminal grant',
        description:
          'Ends the grant immediately. Open terminal connections are disconnected on ' +
          'their next request (nginx re-checks on every one); the tmux sessions keep ' +
          'running and reconnecting needs a fresh step-up.',
      },
    },
  )
  .post(
    '/owner-terminal/sessions/start',
    async ({ body, request }) => {
      await recordSessionEvent(request, 'session_start', body.kind, body.name);
      return noContent();
    },
    {
      body: SessionEventBody,
      response: { 204: t.Void(), ...errors(401, 403) },
      detail: {
        summary: 'Record that a terminal tab was opened',
        description: 'Audited at Home -> Security. Called by the panel when a tab attaches.',
      },
    },
  )
  .post(
    '/owner-terminal/sessions/end',
    async ({ body, request }) => {
      await recordSessionEvent(request, 'session_end', body.kind, body.name);
      return noContent();
    },
    {
      body: SessionEventBody,
      response: { 204: t.Void(), ...errors(401, 403) },
      detail: {
        summary: 'Record that a terminal tab was closed',
        description: 'Audited at Home -> Security. Called by the panel when a tab detaches.',
      },
    },
  )
  .get(
    '/owner-terminal/audit',
    async ({ set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return listAudit();
    },
    {
      response: { 200: OwnerTerminalAuditResponse, ...errors(401, 403) },
      detail: {
        summary: 'List the owner terminal audit trail',
        description:
          'Step-up attempts, grant lifecycle and session start/end, newest first. No ' +
          'keystrokes -- see /owner-terminal/settings for the opt-in output recording.',
      },
    },
  )
  .get('/owner-terminal/settings', () => getOwnerTerminalSettingsForApi(), {
    response: { 200: OwnerTerminalSettingsResponse, ...errors(401, 403) },
    detail: {
      summary: 'Get the owner terminal policy',
      description: 'Step-up methods, the effective owner sudo rule, and output recording.',
    },
  })
  .patch(
    '/owner-terminal/settings',
    ({ body, request }) => setOwnerTerminalSettings(body, request),
    {
      body: OwnerTerminalSettingsPatch,
      response: { 200: OwnerTerminalSettingsResponse, ...commonErrors, ...errors(502, 503, 504) },
      detail: {
        summary: 'Update the owner terminal policy',
        description:
          '`sudoWithoutPassword` changes the managed sudoers rule immediately through hostd.',
      },
    },
  );
