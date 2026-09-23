import { requireInteractiveOwner } from './interactive';
import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireGod } from '#shared/access';
import { commonErrors, errors } from '#shared/responses';
import {
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
    detail: {
      summary: 'Search mail',
      description:
        'Search one connected mail account with a provider query and optional pagination.',
    },
  })
  .post('/mail/thread', ({ body }) => mailThread(body), {
    body: MailThreadBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
    detail: {
      summary: 'Get a mail thread',
      description: 'Read one thread from a connected mail account by its provider thread ID.',
    },
  })
  .post('/mail/labels', ({ body }) => mailLabels(body), {
    body: MailAccountBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
    detail: {
      summary: 'List mail labels',
      description: 'List the labels available in one connected mail account.',
    },
  })
  .post('/mail/labels/modify', ({ body }) => mailModifyLabels(body), {
    body: MailLabelsBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
    detail: {
      summary: 'Modify mail thread labels',
      description: 'Add or remove labels on one thread in a connected mail account.',
    },
  })
  .post('/mail/drafts', ({ body }) => mailCreateDraft(body), {
    body: MailDraftBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
    detail: {
      summary: 'Create a mail draft',
      description: 'Create a draft message in a connected mail account without sending it.',
    },
  })
  .post('/mail/drafts/list', ({ body }) => mailListDrafts(body), {
    body: MailDraftListBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
    detail: {
      summary: 'List mail drafts',
      description: 'List draft messages in one connected mail account.',
    },
  })
  .post('/mail/drafts/authorize-send', ({ body }) => mailAuthorizeSend(body), {
    body: MailDraftActionBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
    detail: {
      summary: 'Authorize sending a mail draft',
      description: 'Create a short-lived confirmation token for sending one existing draft.',
    },
  })
  .post('/mail/drafts/send', ({ body }) => mailSendDraft(body), {
    body: MailSendBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
    detail: {
      summary: 'Send an authorized mail draft',
      description: 'Send one existing draft using its short-lived confirmation token.',
    },
  })
  .post('/mail/attachment', ({ body }) => mailAttachment(body), {
    body: MailAttachmentBody,
    response: { 200: MailPayload, ...commonErrors, ...errors(502, 503) },
    detail: {
      summary: 'Download a mail attachment',
      description: 'Download one attachment from a message in a connected mail account.',
    },
  })
  .post('/theme/sync', ({ body }) => syncWorkspaceTheme(body), {
    body: ThemeSyncBody,
    response: { 200: ThemeSyncResponse, ...commonErrors, ...errors(502, 503) },
    detail: { summary: 'Persist the owner theme across connected workspaces' },
  });
