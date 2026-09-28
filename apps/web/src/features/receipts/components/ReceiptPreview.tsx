'use client';

import { createElement, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { receiptFileBlob, type Receipt } from '@/lib/api/endpoints/receipts';
import { useReceiptQuery } from '../services/receipts.service';
import { receiptFormOf } from '../utils/form';
import { formatCents } from '../utils/format';
import ReceiptBody from './ReceiptBody';
import { receiptIcon, receiptSignedCents } from './ReceiptRows';

// The receipt's own file as the browser shows it: the PDF's first page or the image; an
// e-invoice (XML) or a mail body shows its kind, since the fields below say what it holds.
function ReceiptDocument({ projectKey, receipt }: { projectKey: string; receipt: Receipt }) {
  const t = useTranslations('receipts.preview');
  const visual = /^(image\/|application\/pdf)/.test(receipt.contentType) && !receipt.einvoice;
  const file = useQuery({
    queryKey: ['receipt-file', projectKey, receipt.id],
    queryFn: () => receiptFileBlob(projectKey, receipt.id),
    enabled: visual,
    staleTime: 5 * 60_000,
  });
  const url = useMemo(() => (file.data ? URL.createObjectURL(file.data) : null), [file.data]);
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);
  return (
    <div className="ds-preview-frame is-portrait">
      {visual && url ? (
        receipt.contentType.startsWith('image/') ? (
          // eslint-disable-next-line @next/next/no-img-element -- a blob of the receipt, not a build asset
          <img src={url} alt="" className="h-full w-full object-contain" />
        ) : (
          <object
            data={`${url}#page=1&toolbar=0&navpanes=0&view=FitH`}
            type="application/pdf"
            aria-label={receipt.filename}
            className="h-full w-full"
          />
        )
      ) : (
        <div className="grid h-full place-items-center content-center gap-3 p-6 text-center">
          {createElement(receiptIcon(receipt), {
            size: 40,
            strokeWidth: 1.3,
            className: 'text-muted-foreground',
          })}
          <p className="text-xs text-muted-foreground">
            {visual
              ? file.isError
                ? t('unavailable')
                : t('loading')
              : receipt.einvoice
                ? t('einvoice')
                : receipt.source === 'mail'
                  ? t('mail')
                  : t('noPicture')}
          </p>
        </div>
      )}
    </div>
  );
}

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
