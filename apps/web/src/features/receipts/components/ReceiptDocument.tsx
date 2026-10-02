'use client';

import { createElement, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { receiptFileBlob, type Receipt } from '@/lib/api/endpoints/receipts';
import { receiptIcon } from './ReceiptRows';

// The receipt's own file as the browser shows it: the PDF's first page or the image; an
// e-invoice (XML) or a mail body shows its kind, since the fields below say what it holds.
export default function ReceiptDocument({
  projectKey,
  receipt,
}: {
  projectKey: string;
  receipt: Receipt;
}) {
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
          <iframe
            src={`${url}#page=1&toolbar=0&navpanes=0&view=FitH`}
            title={receipt.filename}
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
