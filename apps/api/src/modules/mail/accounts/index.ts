import { Elysia, t } from 'elysia';
import { guards } from '#shared/guards';
import { noContent } from '#shared/http';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { teamParams } from '../model';
import {
  CreateRuleResponse,
  MailAccountListResponse,
  MailAccountResponse,
  MailRuleListResponse,
  TestConnectionResponse,
  accountParams,
  createAccountBody,
  createRuleBody,
  ruleParams,
  testConnectionBody,
  updateAccountBody,
} from './model';
import {
  createAccount,
  createRule,
  deleteAccount,
  deleteRule,
  listAccounts,
  listRules,
  testConnection,
  updateAccount,
} from './service';

// Mail accounts and the rules that file new mail under a project. An account holds a
// password, so it is managed with the integrations permission, like other credentials.
export const mailAccountRoutes = new Elysia({
  name: 'mail-accounts',
  detail: { tags: ['Mail'] },
})
  .use(guards)
  .get('/teams/:teamId/mail/accounts', ({ params }) => listAccounts(params.teamId), {
    teamPermission: ['integrations', 'read'],
    params: teamParams,
    response: { 200: MailAccountListResponse, ...accessErrors },
    detail: {
      summary: 'List the mail accounts of a team',
      description:
        'Every IMAP/SMTP account of the team with its import state; passwords are never returned.',
    },
  })
  .get(
    '/projects/:projectKey/mail/accounts',
    ({ project }) => listAccounts(project.teamId, project.id),
    {
      permission: ['integrations', 'read'],
      response: { 200: MailAccountListResponse, ...accessErrors },
      detail: {
        summary: 'List the mail accounts of a project',
        description: 'The accounts whose new mail is filed under this project.',
      },
    },
  )
  .post(
    '/teams/:teamId/mail/accounts',
    async ({ params, body, set }) => {
      set.status = 201;
      return createAccount(params.teamId, body);
    },
    {
      teamPermission: ['integrations', 'create'],
      params: teamParams,
      body: createAccountBody,
      response: { 201: MailAccountResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Add a mail account',
        description:
          'Stores the servers and the encrypted password; the worker starts importing within seconds.',
      },
    },
  )
  .patch(
    '/teams/:teamId/mail/accounts/:accountId',
    ({ params, body }) => updateAccount(params.teamId, params.accountId, body),
    {
      teamPermission: ['integrations', 'edit'],
      params: accountParams,
      body: updateAccountBody,
      response: { 200: MailAccountResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Change a mail account',
        description:
          'A password left out keeps the stored one; a changed setting makes the worker connect again.',
      },
    },
  )
  .delete(
    '/teams/:teamId/mail/accounts/:accountId',
    async ({ params }) => {
      await deleteAccount(params.teamId, params.accountId);
      return noContent();
    },
    {
      teamPermission: ['integrations', 'delete'],
      params: accountParams,
      response: { 204: t.Void(), ...accessErrors },
      detail: {
        summary: 'Remove a mail account',
        description: 'Removes the imported mail with it; attachments saved in the vault stay.',
      },
    },
  )
  .post(
    '/teams/:teamId/mail/accounts/test',
    ({ params, body }) => testConnection(params.teamId, body),
    {
      teamPermission: ['integrations', 'create'],
      params: teamParams,
      body: testConnectionBody,
      response: { 200: TestConnectionResponse, ...commonErrors },
      detail: {
        summary: 'Test the IMAP and SMTP login of a mail account',
        description:
          'Logs in to both servers and answers with null for each that accepted, else the reason.',
      },
    },
  )
  .get('/teams/:teamId/mail/rules', ({ params }) => listRules(params.teamId), {
    teamPermission: ['integrations', 'read'],
    params: teamParams,
    response: { 200: MailRuleListResponse, ...accessErrors },
    detail: {
      summary: 'List the rules that file new mail under a project',
      description: 'Sender address and domain rules, for one account or all of the team.',
    },
  })
  .post(
    '/teams/:teamId/mail/rules',
    async ({ params, body, set }) => {
      set.status = 201;
      return createRule(params.teamId, body);
    },
    {
      teamPermission: ['integrations', 'edit'],
      params: teamParams,
      body: createRuleBody,
      response: { 201: CreateRuleResponse, ...commonErrors },
      detail: {
        summary: 'Add a rule that files mail of a sender under a project',
        description:
          'With applyToExisting the threads that already match move to the project too, attachments included.',
      },
    },
  )
  .delete(
    '/teams/:teamId/mail/rules/:ruleId',
    async ({ params }) => {
      await deleteRule(params.teamId, params.ruleId);
      return noContent();
    },
    {
      teamPermission: ['integrations', 'edit'],
      params: ruleParams,
      response: { 204: t.Void(), ...accessErrors },
      detail: {
        summary: 'Remove a mail rule',
        description: 'Threads already filed by the rule stay where they are.',
      },
    },
  );
