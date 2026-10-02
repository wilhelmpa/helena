'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useReceiptQuery } from '../services/receipts.service';
import { receiptFormOf } from '../utils/form';
import { formatCents } from '../utils/format';
import ReceiptBody from './ReceiptBody';
import ReceiptDocument from './ReceiptDocument';
import { receiptSignedCents } from './ReceiptRows';

// The open receipt in the overlay on the right: its file, its name and amount, and the
// full detail (fields, originals, match, extracted text, delete) that used to be a sheet.
export default function ReceiptPreview({
  projectKey,
  receiptId,
  onOpenReceipt,
  onDeleted,
}: {
  projectKey: string;
  receiptId: number;
  onOpenReceipt: (id: number) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations('receipts');
  const locale = useLocale();
  const query = useReceiptQuery(projectKey, receiptId);
  const receipt = query.data;
  if (!receipt)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('detail.loading')}
      </p>
    );
  return (
    <div className="flex flex-col gap-3.5" data-receipt-preview={receipt.id}>
      <ReceiptDocument projectKey={projectKey} receipt={receipt} />
      <div className="flex items-baseline justify-between gap-3">
        <p className="m-0 min-w-0 text-base break-words" dir="auto">
          {receipt.issuer ?? receipt.filename}
        </p>
        <span className="shrink-0 text-sm tabular-nums">
          {formatCents(receiptSignedCents(receipt), receipt.currency, locale)}
        </span>
      </div>
      <p className="m-0 -mt-2 truncate text-xs text-muted-foreground" dir="auto">
        {receipt.filename}
      </p>
      <div className="-mx-4">
        <ReceiptBody
          // A new version of the receipt (saved, read again, matched) starts the form over.
          key={`${receipt.id}:${receipt.status}:${JSON.stringify(receiptFormOf(receipt))}`}
          projectKey={projectKey}
          receipt={receipt}
          onDeleted={onDeleted}
          onOpenReceipt={onOpenReceipt}
        />
      </div>
    </div>
  );
}
