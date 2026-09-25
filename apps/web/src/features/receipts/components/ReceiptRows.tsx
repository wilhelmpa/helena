'use client';

import type { ReactNode } from 'react';
import { ArrowDownLeft, ArrowUpRight, FileCode2, FileText, Image as ImageIcon, Mail } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { ROW_CLASS, ROW_INTERACTIVE_CLASS } from '@/components/common/page/RowList';
import type { MatchMethod, Receipt, Transaction } from '@/lib/api/endpoints/receipts';
import { formatCents, formatDay } from '../utils/format';

// The rows of the receipts page: the sidebar's 32px row (13px text, 12px detail) on the
// card surface, one line per receipt or transaction, the amount right-aligned in tabular
// figures. A row that opens something takes the sidebar's hover fill.

export function Money({ cents, currency }: { cents: number | null; currency: string }) {
  const locale = useLocale();
  return (
    <span
      className={cn(
        'shrink-0 text-sm tabular-nums',
        cents === null
          ? 'text-muted-foreground'
          : cents < 0
            ? 'text-foreground'
            : 'text-status-success',
      )}
    >
      {formatCents(cents, currency, locale)}
    </span>
  );
}

function ReceiptIcon({ receipt }: { receipt: Receipt }) {
  if (receipt.einvoice) return <FileCode2 aria-hidden="true" />;
  if (receipt.source === 'mail') return <Mail aria-hidden="true" />;
  if (/^image\//.test(receipt.contentType)) return <ImageIcon aria-hidden="true" />;
  return <FileText aria-hidden="true" />;
}

export function MethodBadge({ method }: { method: MatchMethod }) {
  const t = useTranslations('receipts.method');
  return (
    <span className="shrink-0 rounded-sm bg-accent px-1.5 py-0.5 text-xs text-muted-foreground">
      {t(method)}
    </span>
  );
}

// A receipt's amount as the bank sees it: a bill we pay is money going out.
export function receiptSignedCents(receipt: Receipt): number | null {
  if (receipt.totalGrossCents === null) return null;
  const out = (receipt.direction === 'incoming') !== receipt.creditNote;
  return out ? -Math.abs(receipt.totalGrossCents) : Math.abs(receipt.totalGrossCents);
}

export function ReceiptLine({
  receipt,
  onOpen,
  trailing,
}: {
  receipt: Receipt;
  onOpen?: () => void;
  trailing?: ReactNode;
}) {
  const t = useTranslations('receipts');
  const locale = useLocale();
  const title = receipt.issuer ?? receipt.filename;
  const detail = [
    receipt.invoiceNumber,
    formatDay(receipt.invoiceDate, locale),
    receipt.creditNote ? t('creditNote') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const body = (
    <>
      <ReceiptIcon receipt={receipt} />
      <span className="min-w-0 shrink truncate" dir="auto">
        {title}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto">
        {detail}
      </span>
      <Money cents={receiptSignedCents(receipt)} currency={receipt.currency} />
    </>
  );
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className={cn(ROW_CLASS, ROW_INTERACTIVE_CLASS, 'flex-1 text-start')}
        >
          {body}
        </button>
      ) : (
        <div className={cn(ROW_CLASS, 'flex-1')}>{body}</div>
      )}
      {trailing ? <span className="flex shrink-0 items-center gap-0.5">{trailing}</span> : null}
    </div>
  );
}

export function TransactionLine({
  transaction,
  trailing,
  showAccount = false,
}: {
  transaction: Transaction;
  trailing?: ReactNode;
  showAccount?: boolean;
}) {
  const t = useTranslations('receipts');
  const locale = useLocale();
  const Icon = transaction.amountCents < 0 ? ArrowUpRight : ArrowDownLeft;
  const detail = [
    formatDay(transaction.bookingDate, locale),
    showAccount ? transaction.accountName : null,
    transaction.purpose,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={cn(ROW_CLASS, 'pe-1')}>
      <Icon aria-hidden="true" />
      <span className="min-w-0 shrink truncate" dir="auto">
        {transaction.counterpartyName || t('noName')}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
        dir="auto"
        title={transaction.purpose}
      >
        {detail}
      </span>
      <Money cents={transaction.amountCents} currency={transaction.currency} />
      {trailing ? <span className="flex shrink-0 items-center gap-0.5">{trailing}</span> : null}
    </div>
  );
}

// A score or confidence (0–1) as a small percentage.
export function Percent({ value, label }: { value: number | null; label: string }) {
  if (value === null) return null;
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={label}>
      {label} {Math.round(value * 100)} %
    </span>
  );
}
