import { db, mailMessage, mailThread, project } from '@repo/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { intakeMailReceipts, prepareMailReceipts } from '#modules/receipts/receipts';

const Entry = z
  .object({
    messageId: z.number().int().positive(),
    accountId: z.number().int().positive(),
    projectKey: z.string().regex(/^[A-Z0-9_-]+$/),
    attachmentIds: z.array(z.number().int().positive()),
    includeBody: z.boolean(),
  })
  .strict();

export async function backfillMailReceipts(manifest: unknown, apply = false) {
  const entries = z.array(Entry).min(1).parse(manifest);
  const seen = new Set<string>();
  const prepared = [];
  let existing = 0;
  let duplicates = 0;
  let missingFacts = 0;
  for (const entry of entries) {
    const [source] = await db
      .select({
        teamId: mailMessage.teamId,
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
    const input = {
      teamId: source.teamId,
      projectId: source.projectId,
      messageId: entry.messageId,
      actorUserId: null,
      attachmentIds: entry.attachmentIds,
      includeBody: entry.includeBody,
    };
    const plans = await prepareMailReceipts(input);
    if (!plans.length) throw new Error(`No original found for message ${entry.messageId}.`);
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
        status,
        receiptId: plan.existingId,
        amountFound: plan.facts.grossCents !== null,
        extractionWarning: plan.facts.extractionError,
      };
    });
    prepared.push({ entry, input, files });
  }
  const reports = [];
  for (const item of prepared) {
    const receiptIds = apply ? await intakeMailReceipts(item.input) : [];
    reports.push({
      messageId: item.entry.messageId,
      accountId: item.entry.accountId,
      projectKey: item.entry.projectKey,
      files: item.files,
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
  if (!manifest || args.some((arg) => arg !== '--apply' && !arg.startsWith('--manifest=')))
    throw new Error(
      'Usage: bun src/scripts/mail-receipt-backfill.ts --manifest=<reviewed.json> [--apply]',
    );
  console.log(
    JSON.stringify(
      await backfillMailReceipts(await Bun.file(manifest).json(), args.includes('--apply')),
      null,
      2,
    ),
  );
  process.exit(0);
}
