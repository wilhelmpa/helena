import { requireInteractiveOwner } from './interactive';
import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireGod } from '#shared/access';
import { commonErrors, errors } from '#shared/responses';
import {
  SecretInventoryResponse,
  SecretSetBody,
  ConnectionActionBody,
  ConnectionsResponse,
  MailAccountBody,
  MailAccountsResponse,
  MailAttachmentBody,
  MailDraftActionBody,
  MailDraftBody,
  MailDraftListBody,
  MailLabelsBody,
  MailPayload,
  MailSearchBody,
  MailSendBody,
  MailThreadBody,
  ThemeSyncBody,
  ThemeSyncResponse,
} from './model';
import {
  secretInventory,
  secretSet,
  connectionsAction,
  connectionsSnapshot,
  mailAccounts,
  mailAttachment,
  mailAuthorizeSend,
  mailCreateDraft,
  mailLabels,
  mailListDrafts,
  mailModifyLabels,
  mailSearch,
  mailSendDraft,
  mailThread,
  syncWorkspaceTheme,
} from './service';

export const connectionsRoutes = new Elysia({
  name: 'connections',
  detail: { tags: ['Connections'] },
})
  .use(authContext)
  .onBeforeHandle(async ({ user, request }) => {
    const owner = requireGod(user);
    await requireInteractiveOwner(request, owner.id);
  })
  .get(
    '/connections/secrets',
    ({ set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return secretInventory();
    },
    { response: { 200: SecretInventoryResponse, ...errors(401, 403, 502, 503) } },
  )
  .post(
    '/connections/secrets',
    ({ body, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return secretSet(body);
    },
    {
      body: SecretSetBody,
      response: { 200: SecretInventoryResponse, ...commonErrors, ...errors(502, 503) },
    },
  )
  .get('/connections', () => connectionsSnapshot(), {
    response: { 200: ConnectionsResponse, ...errors(401, 403, 502, 503) },
    detail: { summary: 'List redacted host connections and live health' },
  })
  .post('/connections/actions', ({ body }) => connectionsAction(body), {
    body: ConnectionActionBody,
    response: { 200: ConnectionsResponse, ...commonErrors, ...errors(502, 503) },
    detail: { summary: 'Probe or reconnect an allowlisted connection' },
  })
  .get('/mail/accounts', () => mailAccounts(), {
    response: { 200: MailAccountsResponse, ...errors(401, 403, 502, 503) },
    detail: { summary: 'Check existing Google mail profiles' },
  })
  .post('/mail/search', ({ body }) => mailSearch(body), {
    body: MailSearchBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
  })
  .post('/mail/thread', ({ body }) => mailThread(body), {
    body: MailThreadBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
  })
  .post('/mail/labels', ({ body }) => mailLabels(body), {
    body: MailAccountBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
  })
  .post('/mail/labels/modify', ({ body }) => mailModifyLabels(body), {
    body: MailLabelsBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
  })
  .post('/mail/drafts', ({ body }) => mailCreateDraft(body), {
    body: MailDraftBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
  })
  .post('/mail/drafts/list', ({ body }) => mailListDrafts(body), {
    body: MailDraftListBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
  })
  .post('/mail/drafts/authorize-send', ({ body }) => mailAuthorizeSend(body), {
    body: MailDraftActionBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
  })
  .post('/mail/drafts/send', ({ body }) => mailSendDraft(body), {
    body: MailSendBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
  })
  .post('/mail/attachment', ({ body }) => mailAttachment(body), {
    body: MailAttachmentBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
  })
  .post('/theme/sync', ({ body }) => syncWorkspaceTheme(body), {
    body: ThemeSyncBody,
    response: { 200: ThemeSyncResponse, ...commonErrors, ...errors(502, 503) },
    detail: { summary: 'Persist the owner theme across connected workspaces' },
  });
