import { db, mailMessage, mailThread, project } from '@repo/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { intakeMailReceipts, prepareMailReceipts } from '#modules/receipts/receipts';
import { assertReviewedMailSource } from '#modules/receipts/mail-review';
import { mailOriginalPair } from '#modules/receipts/original-pair';

const Entry = z
  .object({
    messageId: z.number().int().positive(),
    accountId: z.number().int().positive(),
    projectKey: z.string().regex(/^[A-Z0-9_-]+$/),
    attachmentIds: z.array(z.number().int().positive()),
    includeBody: z.boolean(),
  })
  .strict();

const Review = z.object({
  mode: z.literal('dry-run'),
  reports: z
    .array(
      z.object({
        messageId: z.number().int().positive(),
        accountId: z.number().int().positive(),
        projectKey: z.string(),
        threadId: z.number().int().positive(),
        originalPair: z
          .object({
            invoiceSha256: z.string().regex(/^[a-f0-9]{64}$/),
            receiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
            invoiceNumber: z.string().min(1),
            grossCents: z.number().int().positive(),
            currency: z.string().regex(/^[A-Z]{3}$/),
          })
          .nullable()
          .optional(),
        files: z
          .array(
            z.object({
              attachmentId: z.number().int().positive().nullable(),
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
              size: z.number().int().positive(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export async function backfillMailReceipts(manifest: unknown, apply = false, reviewed?: unknown) {
  const entries = z.array(Entry).min(1).parse(manifest);
  const review = reviewed === undefined ? null : Review.parse(reviewed);
  if (apply && !review) throw new Error('Apply requires a reviewed dry-run report.');
  if (new Set(entries.map((entry) => entry.messageId)).size !== entries.length)
    throw new Error('The manifest contains duplicate message IDs.');
  if (
    review &&
    (review.reports.length !== entries.length ||
      new Set(review.reports.map((report) => report.messageId)).size !== entries.length ||
      entries.some(
        (entry) =>
          !review.reports.some(
            (report) =>
              report.messageId === entry.messageId &&
              report.accountId === entry.accountId &&
              report.projectKey === entry.projectKey,
          ),
      ))
  )
    throw new Error('The reviewed dry-run does not match this manifest scope.');
  const seen = new Set<string>();
  const prepared = [];
  let existing = 0;
  let duplicates = 0;
  let missingFacts = 0;
  for (const entry of entries) {
    const [source] = await db
      .select({
        teamId: mailMessage.teamId,
        threadId: mailMessage.threadId,
        accountId: mailMessage.accountId,
        projectId: project.id,
        projectKey: project.key,
      })
      .from(mailMessage)
      .innerJoin(mailThread, eq(mailThread.id, mailMessage.threadId))
      .innerJoin(project, eq(project.id, mailThread.projectId))
      .where(eq(mailMessage.id, entry.messageId));
    if (!source || source.accountId !== entry.accountId || source.projectKey !== entry.projectKey)
      throw new Error(`Source scope changed for message ${entry.messageId}.`);
    const expected = review?.reports.find((report) => report.messageId === entry.messageId);
    const reviewedSource = expected
      ? {
          accountId: expected.accountId,
          threadId: expected.threadId,
          originals: expected.files,
          originalPair: expected.originalPair ?? null,
        }
      : undefined;
    const input = {
      teamId: source.teamId,
      projectId: source.projectId,
      messageId: entry.messageId,
      actorUserId: null,
      attachmentIds: entry.attachmentIds,
      includeBody: entry.includeBody,
      reviewedSource,
      skipMatching: true,
    };
    const plans = await prepareMailReceipts(input);
    if (!plans.length) throw new Error(`No original found for message ${entry.messageId}.`);
    const checkedSource = {
      accountId: source.accountId,
      threadId: source.threadId,
      originals: plans,
      originalPair: mailOriginalPair(plans),
    };
    if (reviewedSource) assertReviewedMailSource(reviewedSource, checkedSource);
    input.reviewedSource = checkedSource;
    const files = plans.map((plan) => {
      const key = `${source.projectId}:${plan.sha256}`;
      const status = plan.existingId ? 'existing' : seen.has(key) ? 'duplicate' : 'new';
      if (status === 'existing') existing++;
      if (status === 'duplicate') duplicates++;
      seen.add(key);
      if (plan.facts.grossCents === null) missingFacts++;
      return {
        attachmentId: plan.attachmentId,
        sha256: plan.sha256,
        size: plan.size,
        status,
        receiptId: plan.existingId,
        amountFound: plan.facts.grossCents !== null,
        extractionWarning: plan.facts.extractionError,
        bodyProvenance: plan.facts.details.mailBody ?? null,
      };
    });
    prepared.push({
      entry,
      input,
      files,
      threadId: source.threadId,
      originalPair: checkedSource.originalPair,
    });
  }
  const reports = [];
  for (const item of prepared) {
    const receiptIds = apply ? await intakeMailReceipts(item.input) : [];
    reports.push({
      messageId: item.entry.messageId,
      accountId: item.entry.accountId,
      projectKey: item.entry.projectKey,
      threadId: item.threadId,
      files: item.files,
      originalPair: item.originalPair,
      receiptIds,
    });
  }
  return {
    mode: apply ? 'apply' : 'dry-run',
    messages: entries.length,
    originals: prepared.reduce((n, item) => n + item.files.length, 0),
    new: prepared.flatMap((item) => item.files).filter((file) => file.status === 'new').length,
    existing,
    duplicates,
    missingFacts,
    reports,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const manifest = args.find((arg) => arg.startsWith('--manifest='))?.slice('--manifest='.length);
  const reviewed = args.find((arg) => arg.startsWith('--reviewed='))?.slice('--reviewed='.length);
  if (
    !manifest ||
    args.some(
      (arg) =>
        arg !== '--apply' && !arg.startsWith('--manifest=') && !arg.startsWith('--reviewed='),
    )
  )
    throw new Error(
      'Usage: bun src/scripts/mail-receipt-backfill.ts --manifest=<reviewed.json> [--reviewed=<dry-run.json>] [--apply]',
    );
  console.log(
    JSON.stringify(
      await backfillMailReceipts(
        await Bun.file(manifest).json(),
        args.includes('--apply'),
        reviewed ? await Bun.file(reviewed).json() : undefined,
      ),
      null,
      2,
    ),
  );
  process.exit(0);
}
