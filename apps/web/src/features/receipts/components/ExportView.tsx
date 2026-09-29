'use client';

import { useState } from 'react';
import { CalendarDays, Download, FileArchive } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button, EmptyState } from '@/design-system';
import { KnowledgeRow } from '@/components/helena/KnowledgeFrame';
import { downloadMonthExport } from '@/lib/api/endpoints/receipts';
import { useReceiptSummaryQuery } from '../services/receipts.service';
import { formatMonth, saveBlob } from '../utils/format';

const SHOWN = 12;

// Belege › Export (owner 29.09.): every month that has receipts or bookings, newest first,
// with what the month holds and the ZIP for the tax advisor (booking CSV, receipts under
// Ausgaben/Einnahmen, e-invoice XML) one click away.
export default function ExportView({
  projectKey,
  months,
  loading,
  onUpload,
}: {
  projectKey: string;
  months: string[];
  loading: boolean;
  onUpload: () => void;
}) {
  const t = useTranslations('receipts');
  const [all, setAll] = useState(false);
  if (loading)
    return (
      <EmptyState icon={<FileArchive />} fill={false}>
        {t('detail.loading')}
      </EmptyState>
    );
  if (months.length === 0)
    return (
      <EmptyState
        icon={<FileArchive />}
        title={t('export.emptyTitle')}
        action={
          <Button variant="primary" onClick={onUpload}>
            {t('actions.upload')}
          </Button>
        }
      >
        {t('export.emptyHint')}
      </EmptyState>
    );
  const shown = all ? months : months.slice(0, SHOWN);
  return (
    <div data-receipt-export className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {shown.map((month, index) => (
        <ExportMonthRow key={month} projectKey={projectKey} month={month} index={index} />
      ))}
      {months.length > SHOWN && !all && (
        <Button variant="ghost" onClick={() => setAll(true)}>
          {t('export.older', { count: months.length - SHOWN })}
        </Button>
      )}
    </div>
  );
}

function ExportMonthRow({
  projectKey,
  month,
  index,
}: {
  projectKey: string;
  month: string;
  index: number;
}) {
  const t = useTranslations('receipts');
  const locale = useLocale();
  const summary = useReceiptSummaryQuery(projectKey, month, true).data;
  const [busy, setBusy] = useState(false);
  const receipts = summary
    ? summary.receipts.open + summary.receipts.matched + summary.receipts.ignored
    : null;
  const detail = summary
    ? [
        t('export.receipts', { count: receipts ?? 0 }),
        summary.receipts.open ? t('export.openReceipts', { count: summary.receipts.open }) : null,
        summary.transactions.open
          ? t('export.openTransactions', { count: summary.transactions.open })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '…';
  const download = async () => {
    setBusy(true);
    try {
      saveBlob(
        await downloadMonthExport(projectKey, month),
        `Helena-Belege_${projectKey}_${month}.zip`,
      );
      toast.success(t('export.done', { month: formatMonth(month, locale) }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <KnowledgeRow
      index={index}
      icon={CalendarDays}
      name={formatMonth(month, locale)}
      detail={detail}
      trailing={
        <Button
          variant="quiet"
          size="small"
          icon={<Download size={14} />}
          disabled={busy}
          onClick={() => void download()}
          aria-label={t('export.downloadMonth', { month: formatMonth(month, locale) })}
        >
          {t('export.download')}
        </Button>
      }
    />
  );
}
