import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireUser } from '#shared/access';
import { commonErrors, errors } from '#shared/responses';
import { guards } from '#shared/guards';
import { mcpTool } from '#mcp/generate';
import { triageBatchBody, TriageBatchResponse } from './model';
import { threadAccess } from '#modules/mail/access';
import {
  acceptSuggestion,
  classificationsOfThreads,
  classifyThreadNow,
  correctClassification,
  runProjectTriage,
} from './classify';
import './config';

// The mail classifier in the inbox (docs/helena-decisions/decisions.md §5): what it decided
// for a thread, the owner's corrections, the suggestions the owner accepts, and "Einordnen"
// for a thread now.

const Answer = t.Object({
  choice: t.Nullable(t.String()),
  confidence: t.Nullable(t.Number()),
  decided: t.Boolean(),
});

export const MailClassification = t.Object({
  id: t.Number(),
  threadId: t.Number(),
  messageId: t.Number(),
  status: t.String(),
  projectId: t.Nullable(t.Number()),
  projectKey: t.Nullable(t.String()),
  category: t.Nullable(t.String()),
  priority: t.Nullable(t.String()),
  needsReply: t.Nullable(t.Boolean()),
  createTask: t.Nullable(t.Boolean()),
  answers: t.Record(t.String(), Answer),
  cascade: t.Record(
    t.String(),
    t.Union([t.Literal('act'), t.Literal('suggest'), t.Literal('escalate')]),
  ),
  actions: t.Array(
    t.Object({
      kind: t.String(),
      projectId: t.Optional(t.Nullable(t.Number())),
      issueId: t.Optional(t.Nullable(t.Number())),
      approvalId: t.Optional(t.Nullable(t.Number())),
      agentId: t.Optional(t.Nullable(t.Number())),
      receiptIds: t.Optional(t.Array(t.Number())),
      attemptedAt: t.Optional(t.String()),
      note: t.Optional(t.Nullable(t.String())),
    }),
  ),
  issueId: t.Nullable(t.Number()),
  error: t.Nullable(t.String()),
  corrected: t.Boolean(),
  createdAt: t.String(),
});

const threadParams = t.Object({ threadId: t.Numeric() });

export const mailTriageRoutes = new Elysia({
  name: 'mail-triage',
  detail: { tags: ['Mail'] },
})
  .use(authContext)
  .use(guards)
  .post(
    '/projects/:projectKey/mail-triage/run',
    ({ project, body, request }) =>
      runProjectTriage(project, body.maxMessages ?? 5, request.signal),
    {
      permission: ['mail', 'edit'],
      body: triageBatchBody,
      response: { 200: TriageBatchResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Triage a batch of new inbox mail in this project',
        description:
          'For native Helena schedules. Uses the enabled Mail decision class and its saved task/receipt preferences. Only connected, enabled accounts and threads in this project. The application task policy excludes newsletters, advertising, pure login/security/recovery notices and problem-free shipping. Uncertain eligibility creates no task: report reviewRequired and unsure message IDs for review, without bypassing the policy through another task tool. Never sends mail or delegates tasks. Repeat while hasMore and failed is zero; stop and report failures. Previously classified mail only retries failed receipt filing, without repeating task creation. receiptIds and receiptCount identify the distinct receipts successfully filed or already present in this run, combining first-time classification and receipt retries; they do not count newly created records. Each result reports the receipts for its classified message. receiptRetries counts successfully retried messages, not receipts; receiptRetries=0 does not mean no receipts were filed. An empty result or failure is not proof that no receipt exists. Each result identifies the classified message with messageId and its thread with threadId. Pass threadId (never messageId) to read_mail; threadHref opens that thread in Helena.',
        ...mcpTool('run_mail_triage', undefined, 'execute'),
      },
    },
  )

  .get(
    '/mail/threads/:threadId/classification',
    async ({ params, user, request }) => {
      await threadAccess(params.threadId, user, 'read', request.headers);
      return {
        classification:
          (await classificationsOfThreads([params.threadId])).get(params.threadId) ?? null,
      };
    },
    {
      params: threadParams,
      response: {
        200: t.Object({ classification: t.Nullable(MailClassification) }),
        ...commonErrors,
      },
      detail: {
        summary: 'Read how a mail thread was classified',
        description:
          'The project, kind, priority, whether it needs a reply or a task, each with its ' +
          'confidence, and what Helena did or suggests.',
      },
    },
  )

  .post(
    '/mail/threads/:threadId/classification',
    async ({ params, user, request }) => {
      await threadAccess(params.threadId, user, 'edit', request.headers);
      return { classification: await classifyThreadNow(params.threadId, requireUser(user).id) };
    },
    {
      params: threadParams,
      response: {
        200: t.Object({ classification: t.Nullable(MailClassification) }),
        ...commonErrors,
      },
      detail: { summary: 'Classify a mail thread now' },
    },
  )

  .patch(
    '/mail/threads/:threadId/classification',
    async ({ params, body, user, request }) => {
      await threadAccess(params.threadId, user, 'edit', request.headers);
      return correctClassification(params.threadId, body, requireUser(user).id);
    },
    {
      params: threadParams,
      body: t.Object({
        category: t.Optional(t.String({ maxLength: 40 })),
        priority: t.Optional(t.String({ maxLength: 20 })),
        projectId: t.Optional(t.Nullable(t.Integer({ minimum: 1 }))),
        needsReply: t.Optional(t.Boolean()),
      }),
      response: { 200: MailClassification, ...commonErrors },
      detail: {
        summary: "Correct a mail thread's classification",
        description: 'The right answer is kept and goes to the decision log for the evals.',
      },
    },
  )

  .post(
    '/mail/threads/:threadId/classification/accept',
    async ({ params, body, user, request }) => {
      await threadAccess(params.threadId, user, 'edit', request.headers);
      return acceptSuggestion(params.threadId, body.kind, requireUser(user).id);
    },
    {
      params: threadParams,
      body: t.Object({ kind: t.Union([t.Literal('task'), t.Literal('agent')]) }),
      response: { 200: MailClassification, ...commonErrors },
      detail: {
        summary: "Accept the classifier's suggestion",
        description:
          'Creates the suggested task in the thread’s project, or the task for the configured ' +
          'agent, linked to the mail.',
      },
    },
  );
