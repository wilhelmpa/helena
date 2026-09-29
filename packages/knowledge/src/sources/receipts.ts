import { asc, eq, gt, inArray, type SQL } from 'drizzle-orm';
import { db, helenaReceipt, helenaReceiptOriginalLink, project } from '@repo/db';
import type { KnowledgeItem, KnowledgeSource } from '@helena/sdk';
import { cursorId, iso, nextCursor, numericIds, pageLimit } from './common';

// The receipt record and its original vault file remain separate searchable items.
// This record names the original path so an attached receipt always points to its source.
async function rows(where: SQL | undefined, limit?: number) {
  const query = db
    .select({
      receipt: helenaReceipt,
      key: project.key,
      original: helenaReceiptOriginalLink.primaryReceiptId,
    })
    .from(helenaReceipt)
    .innerJoin(project, eq(project.id, helenaReceipt.projectId))
    .leftJoin(helenaReceiptOriginalLink, eq(helenaReceiptOriginalLink.receiptId, helenaReceipt.id))
    .where(where)
    .orderBy(asc(helenaReceipt.id));
  return limit ? query.limit(limit) : query;
}

type Row = Awaited<ReturnType<typeof rows>>[number];

function toItem(row: Row): KnowledgeItem {
  const receipt = row.receipt;
  const title = [receipt.issuer, receipt.invoiceNumber, receipt.filename]
    .filter(Boolean)
    .join(' · ');
  return {
    id: String(receipt.id),
    title,
    text: [
      title,
      receipt.invoiceDate,
      receipt.totalGross ? `${receipt.totalGross} ${receipt.currency}` : null,
      receipt.textExcerpt,
      `Original: ${receipt.vaultPath}`,
    ]
      .filter(Boolean)
      .join('\n'),
    href: `/project/${encodeURIComponent(row.key)}/receipts`,
    mimeType: receipt.contentType,
    scope: {
      teamId: receipt.teamId,
      projectId: receipt.projectId,
      visibility: 'project',
      permission: 'receipt_admin',
    },
    provenance: { createdAt: iso(receipt.createdAt), updatedAt: iso(receipt.createdAt) },
    group: `receipt:${row.original ?? receipt.id}`,
    metadata: {
      projectKey: row.key,
      originalPath: receipt.vaultPath,
      status: receipt.status,
      invoiceNumber: receipt.invoiceNumber,
    },
    links: [{ target: `vault:${receipt.vaultPath}`, kind: 'attachment' }],
  };
}

export const receiptSource: KnowledgeSource = {
  id: 'receipt',
  label: { i18n: 'knowledge.source.receipt' },
  icon: 'receipt',
  async list(ctx) {
    const limit = pageLimit(ctx);
    const found = await rows(gt(helenaReceipt.id, cursorId(ctx)), limit);
    return { items: found.map(toItem), cursor: nextCursor(found, limit, (row) => row.receipt.id) };
  },
  async get(id) {
    const [row] = await rows(eq(helenaReceipt.id, Number(id) || 0));
    return row ? toItem(row) : null;
  },
  async present(ids) {
    const numbers = numericIds(ids);
    if (!numbers.length) return [];
    const found = await db
      .select({ id: helenaReceipt.id })
      .from(helenaReceipt)
      .where(inArray(helenaReceipt.id, numbers));
    return found.map((row) => String(row.id));
  },
};
