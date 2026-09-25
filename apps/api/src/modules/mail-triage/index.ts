import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireUser } from '#shared/access';
import { commonErrors } from '#shared/responses';
import { threadAccess } from '#modules/mail/access';
import {
  acceptSuggestion,
  classificationsOfThreads,
  classifyThreadNow,
  correctClassification,
} from './classify';
import './config';
import './job';

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
  actions: t.Array(
    t.Object({
      kind: t.String(),
      projectId: t.Optional(t.Nullable(t.Number())),
      issueId: t.Optional(t.Nullable(t.Number())),
      approvalId: t.Optional(t.Nullable(t.Number())),
      agentId: t.Optional(t.Nullable(t.Number())),
      receiptIds: t.Optional(t.Array(t.Number())),
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
