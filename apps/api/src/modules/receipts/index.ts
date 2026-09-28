import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireUser } from '#shared/access';
import { guards } from '#shared/guards';
import { noContent } from '#shared/http';
import { commonErrors, errors } from '#shared/responses';
import { useReceiptIntake } from '#modules/mail-triage/classify';
import { VIEWER_INLINE } from '#modules/project-files/serve';
import { serveVaultFile } from '#modules/project-files/service';
import {
  createAccount,
  deleteAccount,
  importStatement,
  listAccounts,
  listImports,
  listTransactions,
  updateAccount,
  updateTransaction,
} from './accounts';
import { monthExport } from './export';
import {
  confirmProposal,
  matchManually,
  matchReceipt,
  receiptCandidates,
  rejectProposal,
  removeMatch,
  reviewList,
} from './matching';
import {
  Account,
  accountBody,
  accountPatch,
  Candidate,
  Duplicate,
  Import,
  ImportResult,
  listQuery,
  MatchOutcome,
  monthPattern,
  Receipt,
  ReceiptDetail,
  receiptPatch,
  ReviewItem,
  Summary,
  Transaction,
  transactionPatch,
} from './model';
import {
  deleteReceipt,
  DuplicateReceipt,
  extractAgain,
  getReceipt,
  intakeMailReceipts,
  listReceipts,
  receiptFromVault,
  receiptSummary,
  requireReceipt,
  updateReceipt,
  uploadReceipt,
} from './receipts';
import { linkReceiptOriginal, unlinkReceiptOriginal } from './originals';
import { receiptViews } from './views';
import { receiptOriginalMail } from './archived-source';
import { listPairHistory, listPairSuggestions, resolvePairSuggestion } from './dedup';

// Receipt matching (Belege, docs/helena-decisions/decisions.md §7): a project's bank accounts
// and statement imports, its receipts, the matches between them, the review list and the
// month's export for the tax advisor. Finance data is sensitive: every route is for the
// project's administrators (its owner, or an owner or manager of the team), and none is an
// MCP tool.

// An invoice mail's attachments become receipts of the project the classifier filed it in.
useReceiptIntake(intakeMailReceipts);

const base = '/projects/:projectKey/receipts';
const accountParams = t.Object({ projectKey: t.String(), accountId: t.Numeric() });
const receiptParams = t.Object({ projectKey: t.String(), receiptId: t.Numeric() });
const matchParams = t.Object({ projectKey: t.String(), matchId: t.Numeric() });
const transactionParams = t.Object({ projectKey: t.String(), transactionId: t.Numeric() });
const monthQuery = t.Object({ month: t.Optional(monthPattern) });

// A receipt that is already there answers 409 with the id of the one that is.
async function orDuplicate<T>(set: { status?: number | string }, create: () => Promise<T>) {
  try {
    set.status = 201;
    return await create();
  } catch (error) {
    if (!(error instanceof DuplicateReceipt)) throw error;
    set.status = 409;
    return { error: error.message, code: error.code, existingId: error.existingId };
  }
}

export const receiptRoutes = new Elysia({
  name: 'receipts',
  detail: { tags: ['Receipts'] },
})
  .use(authContext)
  .use(guards)

  // ── Bank accounts and statements ─────────────────────────────────────────────────────

  .get(`${base}/accounts`, async ({ project }) => ({ accounts: await listAccounts(project.id) }), {
    projectAdmin: true,
    response: { 200: t.Object({ accounts: t.Array(Account) }), ...commonErrors },
    detail: {
      summary: "List the project's bank accounts",
      description: 'With their transaction counts (open, matched, ignored) and the last import.',
    },
  })
  .post(
    `${base}/accounts`,
    async ({ project, body, set }) => {
      set.status = 201;
      return createAccount(project, body);
    },
    {
      projectAdmin: true,
      body: accountBody,
      response: { 201: Account, ...commonErrors, ...errors(409) },
      detail: { summary: 'Add a bank account' },
    },
  )
  .patch(
    `${base}/accounts/:accountId`,
    ({ project, params, body }) => updateAccount(project.id, params.accountId, body),
    {
      projectAdmin: true,
      params: accountParams,
      body: accountPatch,
      response: { 200: Account, ...commonErrors, ...errors(409) },
      detail: { summary: 'Rename a bank account or set its IBAN' },
    },
  )
  .delete(
    `${base}/accounts/:accountId`,
    async ({ project, params }) => {
      await deleteAccount(project.id, params.accountId);
      return noContent();
    },
    {
      projectAdmin: true,
      params: accountParams,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Delete a bank account',
        description:
          'Deletes its imports, transactions and their matches; matched receipts are open again.',
      },
    },
  )
  .post(
    `${base}/accounts/:accountId/imports`,
    async ({ project, params, body, user, set }) => {
      set.status = 201;
      return importStatement(project, params.accountId, body.file, requireUser(user).id);
    },
    {
      projectAdmin: true,
      params: accountParams,
      body: t.Object({ file: t.File() }),
      response: { 201: ImportResult, ...commonErrors, ...errors(409, 413) },
      detail: {
        summary: 'Import a bank statement',
        description:
          'A CAMT.052/053/054 XML file, a ZIP of them, or a CSV export of a German bank (at ' +
          'most 20 MB). Adds the booked entries that are new, skips pending ones and those ' +
          'already imported, then matches the open receipts.',
      },
    },
  )
  .get(
    `${base}/imports`,
    async ({ project, query }) => ({ imports: await listImports(project.id, query.accountId) }),
    {
      projectAdmin: true,
      query: t.Object({ accountId: t.Optional(t.Numeric()) }),
      response: { 200: t.Object({ imports: t.Array(Import) }), ...commonErrors },
      detail: { summary: 'List the statement imports' },
    },
  )
  .get(
    `${base}/transactions`,
    async ({ project, query }) => ({ transactions: await listTransactions(project.id, query) }),
    {
      projectAdmin: true,
      query: listQuery,
      response: { 200: t.Object({ transactions: t.Array(Transaction) }), ...commonErrors },
      detail: {
        summary: 'List bank transactions',
        description: 'Filter by status (open, matched, ignored), month (YYYY-MM), text, account.',
      },
    },
  )
  .patch(
    `${base}/transactions/:transactionId`,
    ({ project, params, body }) => updateTransaction(project.id, params.transactionId, body),
    {
      projectAdmin: true,
      params: transactionParams,
      body: transactionPatch,
      response: { 200: Transaction, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Mark a transaction as needing no receipt, or add a note',
        description: 'status ignored = "kein Beleg nötig"; open undoes it.',
      },
    },
  )

  // ── The month: counts, review list, export ──────────────────────────────────────────

  .get(`${base}/summary`, ({ project, query }) => receiptSummary(project.id, query.month ?? null), {
    projectAdmin: true,
    query: monthQuery,
    response: { 200: Summary, ...commonErrors },
    detail: {
      summary: 'Count transactions, receipts and proposals',
      description: 'For one month or all; with the months that have any.',
    },
  })
  .get(
    `${base}/review`,
    async ({ project, query }) => ({ items: await reviewList(project.id, query.month ?? null) }),
    {
      projectAdmin: true,
      query: monthQuery,
      response: { 200: t.Object({ items: t.Array(ReviewItem) }), ...commonErrors },
      detail: {
        summary: 'List the proposed matches waiting for the owner',
        description: 'Each with its receipt, transaction, score, confidence and the candidates.',
      },
    },
  )
  .get(
    `${base}/export`,
    async ({ project, query }) => {
      const built = await monthExport(project, query.month);
      return new Response(built.zip, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${built.filename}"; filename*=UTF-8''${encodeURIComponent(built.filename)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    },
    {
      projectAdmin: true,
      query: t.Object({ month: monthPattern }),
      response: { ...commonErrors },
      detail: {
        summary: "Download the month's receipts for the tax advisor",
        description:
          'A ZIP with the booking CSV, the receipts under Ausgaben/Einnahmen, the receipts ' +
          'without a payment, and the XML of each e-invoice next to its PDF.',
      },
    },
  )
  .post(
    `${base}/matches/:matchId/confirm`,
    async ({ project, params, user }) => ({
      receipt: await confirmProposal(project.id, params.matchId, requireUser(user).id),
    }),
    {
      projectAdmin: true,
      params: matchParams,
      response: { 200: t.Object({ receipt: Receipt }), ...commonErrors, ...errors(409) },
      detail: { summary: 'Confirm a proposed match' },
    },
  )
  .post(
    `${base}/matches/:matchId/reject`,
    async ({ project, params, user }) => ({
      receipt: await rejectProposal(project.id, params.matchId, requireUser(user).id),
    }),
    {
      projectAdmin: true,
      params: matchParams,
      response: { 200: t.Object({ receipt: Receipt }), ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Reject a proposed match',
        description: 'The transaction is not proposed for this receipt again.',
      },
    },
  )
  .delete(
    `${base}/matches/:matchId`,
    async ({ project, params }) => {
      await removeMatch(project.id, params.matchId);
      return noContent();
    },
    {
      projectAdmin: true,
      params: matchParams,
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Remove a match', description: 'Receipt and transaction are open again.' },
    },
  )

  // ── Receipts ─────────────────────────────────────────────────────────────────────────

  .get(base, async ({ project, query }) => ({ receipts: await listReceipts(project.id, query) }), {
    projectAdmin: true,
    query: listQuery,
    response: { 200: t.Object({ receipts: t.Array(Receipt) }), ...commonErrors },
    detail: {
      summary: 'List receipts',
      description: 'Filter by status, month (invoice date, else arrival) and text.',
    },
  })
  .get(
    `${base}/pair-suggestions`,
    async ({ project }) => ({ items: await listPairSuggestions(project.id) }),
    {
      projectAdmin: true,
      response: {
        200: t.Object({
          items: t.Array(
            t.Object({
              id: t.Number(),
              projectId: t.Number(),
              teamId: t.Number(),
              receiptId: t.Number(),
              candidateId: t.Number(),
              kind: t.String(),
              status: t.String(),
              reason: t.String(),
              createdAt: t.String(),
            }),
          ),
        }),
        ...commonErrors,
      },
      detail: { summary: 'List receipt pair and duplicate suggestions for the inbox' },
    },
  )
  .get(
    `${base}/pair-history`,
    async ({ project }) => ({ items: await listPairHistory(project.id) }),
    {
      projectAdmin: true,
      response: {
        200: t.Object({
          items: t.Array(
            t.Object({
              id: t.Number(),
              projectId: t.Number(),
              teamId: t.Number(),
              receiptId: t.Number(),
              primaryReceiptId: t.Number(),
              action: t.String(),
              createdByUserId: t.Nullable(t.String()),
              createdAt: t.String(),
            }),
          ),
        }),
        ...commonErrors,
      },
      detail: { summary: 'List automatic receipt links and detaches' },
    },
  )
  .post(
    `${base}/pair-suggestions/:suggestionId`,
    ({ project, params, body, user }) =>
      resolvePairSuggestion(
        project.id,
        params.suggestionId,
        body.action,
        body.primaryReceiptId ?? null,
        requireUser(user).id,
      ),
    {
      projectAdmin: true,
      params: t.Object({ projectKey: t.String(), suggestionId: t.Numeric() }),
      body: t.Object({
        action: t.Union([t.Literal('link'), t.Literal('ignore')]),
        primaryReceiptId: t.Optional(t.Integer({ minimum: 1 })),
      }),
      response: { 200: t.Object({ ok: t.Boolean() }), ...commonErrors, ...errors(409) },
      detail: { summary: 'Link or ignore a receipt pair suggestion' },
    },
  )
  .post(
    base,
    ({ project, body, user, set }) =>
      orDuplicate(set, () => uploadReceipt(project, body.file, requireUser(user).id)),
    {
      projectAdmin: true,
      body: t.Object({ file: t.File() }),
      response: { 201: ReceiptDetail, 409: Duplicate, ...commonErrors, ...errors(413) },
      detail: {
        summary: 'Upload a receipt',
        description:
          'A PDF, PNG, JPG or e-invoice XML (at most 25 MB), stored under ' +
          'Files/Belege/<month>, read and matched. The same file twice answers 409 with the ' +
          'existing receipt.',
      },
    },
  )
  .post(
    `${base}/from-vault`,
    ({ project, body, user, set }) =>
      orDuplicate(set, () => receiptFromVault(project, body.path, requireUser(user).id)),
    {
      projectAdmin: true,
      body: t.Object({ path: t.String({ minLength: 1, maxLength: 1024 }) }),
      response: { 201: ReceiptDetail, 409: Duplicate, ...commonErrors, ...errors(413) },
      detail: {
        summary: "Take a file from the project's vault as a receipt",
        description: 'The path is relative to the project folder; the file stays where it is.',
      },
    },
  )
  .get(
    `${base}/:receiptId`,
    ({ project, params, user, request }) =>
      getReceipt(project.id, params.receiptId, requireUser(user), request.headers),
    {
      projectAdmin: true,
      params: receiptParams,
      response: { 200: ReceiptDetail, ...commonErrors },
      detail: {
        summary: 'Read a receipt',
        description: 'With the text read from it and accessible mail and task source links.',
      },
    },
  )
  .get(
    `${base}/:receiptId/source-mail`,
    ({ project, params, user, request, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      return receiptOriginalMail(project.id, params.receiptId, requireUser(user), request.headers);
    },
    {
      projectAdmin: true,
      params: receiptParams,
      response: {
        200: t.Object({
          messageId: t.Number(),
          archived: t.Boolean(),
          subject: t.String(),
          fromName: t.String(),
          fromAddress: t.String(),
          sentAt: t.String(),
          text: t.String(),
          htmlText: t.Nullable(t.String()),
        }),
        ...commonErrors,
        ...errors(409, 413),
      },
      detail: {
        summary: 'Read only the original mail bound to this receipt, including archived mail',
      },
    },
  )
  .patch(
    `${base}/:receiptId`,
    ({ project, params, body }) => updateReceipt(project.id, params.receiptId, body),
    {
      projectAdmin: true,
      params: receiptParams,
      body: receiptPatch,
      response: { 200: ReceiptDetail, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Correct what was read from a receipt',
        description: 'An open receipt is matched again afterwards.',
      },
    },
  )
  .delete(
    `${base}/:receiptId`,
    async ({ project, params }) => {
      await deleteReceipt(project.id, params.receiptId);
      return noContent();
    },
    {
      projectAdmin: true,
      params: receiptParams,
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Delete a receipt', description: 'Its file stays in the vault.' },
    },
  )
  .post(
    `${base}/:receiptId/extract`,
    ({ project, params }) => extractAgain(project, params.receiptId),
    {
      projectAdmin: true,
      params: receiptParams,
      response: { 200: ReceiptDetail, ...commonErrors },
      detail: { summary: 'Read a receipt again' },
    },
  )
  .post(
    `${base}/:receiptId/match`,
    async ({ project, params }) => {
      const row = await requireReceipt(project.id, params.receiptId);
      const outcome = await matchReceipt(row.id);
      const [receipt] = await receiptViews([await requireReceipt(project.id, row.id)]);
      return { outcome, receipt: receipt! };
    },
    {
      projectAdmin: true,
      params: receiptParams,
      response: {
        200: t.Object({ outcome: MatchOutcome, receipt: Receipt }),
        ...commonErrors,
      },
      detail: {
        summary: 'Match a receipt again',
        description: 'Rules first, then the decision model; an open receipt only.',
      },
    },
  )
  .put(
    `${base}/:receiptId/original-link`,
    async ({ project, params, body, user }) => {
      await linkReceiptOriginal(
        project.id,
        params.receiptId,
        body.primaryReceiptId,
        requireUser(user).id,
      );
      return { ok: true };
    },
    {
      projectAdmin: true,
      params: receiptParams,
      body: t.Object({ primaryReceiptId: t.Integer({ minimum: 1 }) }),
      response: { 200: t.Object({ ok: t.Boolean() }), ...commonErrors, ...errors(409) },
      detail: { summary: 'Attach a supplementary original to a receipt' },
    },
  )
  .delete(
    `${base}/:receiptId/original-link`,
    async ({ project, params, body, user }) => {
      await unlinkReceiptOriginal(
        project.id,
        params.receiptId,
        body.primaryReceiptId,
        requireUser(user).id,
      );
      return { ok: true };
    },
    {
      projectAdmin: true,
      params: receiptParams,
      body: t.Object({ primaryReceiptId: t.Integer({ minimum: 1 }) }),
      response: { 200: t.Object({ ok: t.Boolean() }), ...commonErrors, ...errors(409) },
      detail: { summary: 'Detach a supplementary original without changing its facts' },
    },
  )
  .post(
    `${base}/:receiptId/match-manual`,
    async ({ project, params, body, user }) => ({
      receipt: await matchManually(
        project.id,
        params.receiptId,
        body.transactionId,
        requireUser(user).id,
      ),
    }),
    {
      projectAdmin: true,
      params: receiptParams,
      body: t.Object({ transactionId: t.Integer({ minimum: 1 }) }),
      response: { 200: t.Object({ receipt: Receipt }), ...commonErrors },
      detail: {
        summary: 'Match a receipt to a transaction by hand',
        description: 'Replaces a match the receipt had.',
      },
    },
  )
  .get(
    `${base}/:receiptId/candidates`,
    async ({ project, params }) => ({
      candidates: await receiptCandidates(project.id, params.receiptId),
    }),
    {
      projectAdmin: true,
      params: receiptParams,
      response: { 200: t.Object({ candidates: t.Array(Candidate) }), ...commonErrors },
      detail: { summary: 'List the transactions that could pay a receipt' },
    },
  )
  .get(
    `${base}/:receiptId/file`,
    async ({ project, params, query, request }) => {
      const row = await requireReceipt(project.id, params.receiptId);
      return serveVaultFile({
        vaultPath: row.vaultPath,
        filename: row.filename,
        contentType: row.contentType,
        request,
        download: query.download !== undefined,
        inline: VIEWER_INLINE,
      });
    },
    {
      projectAdmin: true,
      params: receiptParams,
      query: t.Object({ download: t.Optional(t.String()) }),
      response: { ...commonErrors },
      detail: { summary: "Open or download a receipt's file" },
    },
  );
