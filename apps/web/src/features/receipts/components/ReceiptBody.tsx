'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FolderOpen, RefreshCw, ScanText, Trash2, Unlink } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { RowEmpty, RowList, SectionLabel } from '@/components/common/page/RowList';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  receiptFileBlob,
  type ReceiptDetail,
  type ReceiptPatch,
} from '@/lib/api/endpoints/receipts';
import { filesPath } from '@/utils/paths';
import {
  useDeleteReceipt,
  useExtractReceipt,
  useMatchManually,
  useMatchReceipt,
  useReceiptCandidatesQuery,
  useRemoveMatch,
  useUpdateReceipt,
} from '../services/receipts.service';
import { formatDay, parseCentsInput, projectFileLocation } from '../utils/format';
import { MethodBadge, Money, Percent, TransactionLine } from './ReceiptRows';

import { receiptFormOf } from '../utils/form';
import ReceiptExtractionProblem from './ReceiptExtractionProblem';
import ReceiptSourceLinks from './ReceiptSourceLinks';

export default function ReceiptBody({
  projectKey,
  receipt,
  onDeleted,
}: {
  projectKey: string;
  receipt: ReceiptDetail;
  onDeleted: () => void;
}) {
  const t = useTranslations('receipts');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const update = useUpdateReceipt(projectKey);
  const extract = useExtractReceipt(projectKey);
  const rematch = useMatchReceipt(projectKey);
  const manual = useMatchManually(projectKey);
  const unmatch = useRemoveMatch(projectKey);
  const remove = useDeleteReceipt(projectKey);
  const candidates = useReceiptCandidatesQuery(
    projectKey,
    receipt.status === 'open' ? receipt.id : null,
  );
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState(() => receiptFormOf(receipt));
  const inProject = projectFileLocation(projectKey, receipt.vaultPath);
  const busy = update.isPending || extract.isPending || rematch.isPending;

  function save() {
    const gross = form.gross.trim() ? parseCentsInput(form.gross) : null;
    const vat = form.vat.trim() ? parseCentsInput(form.vat) : null;
    if ((form.gross.trim() && gross === null) || (form.vat.trim() && vat === null)) {
      toast.error(t('detail.badAmount'));
      return;
    }
    const patch: ReceiptPatch = {
      issuer: form.issuer.trim() || null,
      invoiceNumber: form.invoiceNumber.trim() || null,
      invoiceDate: form.invoiceDate || null,
      dueDate: form.dueDate || null,
      totalGrossCents: gross,
      vatCents: vat,
      currency: form.currency.trim().toUpperCase() || 'EUR',
      iban: form.iban.trim() || null,
      direction: form.direction,
    };
    update.mutate(
      { receiptId: receipt.id, patch },
      { onSuccess: () => toast.success(t('detail.saved')) },
    );
  }

  async function openFile() {
    try {
      const blob = await receiptFileBlob(projectKey, receipt.id);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  const field = (key: keyof typeof form, label: string, type = 'text', mono = false) => (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={`receipt-${key}`} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={`receipt-${key}`}
        type={type}
        value={form[key]}
        className={mono ? 'font-mono' : undefined}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-6 p-4">
      <section className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>
          {t(`source.${receipt.source}`)} · {t(`extraction.${receipt.extraction}`)}
          {receipt.creditNote ? ` · ${t('creditNote')}` : ''}
          {receipt.directDebit ? ` · ${t('directDebit')}` : ''}
        </p>
        {receipt.extractionError && <ReceiptExtractionProblem error={receipt.extractionError} />}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => void openFile()}>
            <ExternalLink />
            {t('detail.openFile')}
          </Button>
          {inProject && (
            <Button size="sm" variant="ghost" asChild>
              <Link href={filesPath(projectKey, inProject.folder, { file: inProject.file })}>
                <FolderOpen />
                {t('detail.inFiles')}
              </Link>
            </Button>
          )}
        </div>
        {receipt.source === 'mail' && (
          <ReceiptSourceLinks projectKey={projectKey} source={receipt.sourceLinks} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('issuer', t('fields.issuer'))}
          {field('invoiceNumber', t('fields.invoiceNumber'))}
          {field('invoiceDate', t('fields.invoiceDate'), 'date')}
          {field('dueDate', t('fields.dueDate'), 'date')}
          {field('gross', t('fields.gross'))}
          {field('vat', t('fields.vat'))}
          {field('currency', t('fields.currency'))}
          {field('iban', t('fields.iban'), 'text', true)}
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="receipt-direction" className="text-xs text-muted-foreground">
              {t('fields.direction')}
            </Label>
            <Select
              value={form.direction}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, direction: value as 'incoming' | 'outgoing' }))
              }
            >
              <SelectTrigger id="receipt-direction" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="incoming">{t('direction.incoming')}</SelectItem>
                <SelectItem value="outgoing">{t('direction.outgoing')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={save}>
            {tCommon('save')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => extract.mutate(receipt.id)}
          >
            <ScanText />
            {t('detail.extract')}
          </Button>
        </div>
      </section>

      <section>
        <SectionLabel>{t('detail.match')}</SectionLabel>
        {receipt.match ? (
          <RowList className="bg-card">
            <div className="flex h-8 min-w-0 items-center gap-2 px-2 text-sm">
              <MethodBadge method={receipt.match.method} />
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {formatDay(receipt.match.bookingDate, locale)} ·{' '}
                {receipt.match.counterpartyName || t('noName')}
              </span>
              <Money cents={receipt.match.amountCents} currency={receipt.match.currency} />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('matched.unmatch')}
                disabled={unmatch.isPending}
                onClick={() => unmatch.mutate(receipt.match!.matchId)}
              >
                <Unlink />
              </Button>
            </div>
          </RowList>
        ) : (
          <div className="flex flex-col gap-2">
            <RowList className="bg-card">
              {candidates.isPending ? (
                <RowEmpty>{t('detail.loading')}</RowEmpty>
              ) : (candidates.data ?? []).length === 0 ? (
                <RowEmpty>{t('detail.noCandidates')}</RowEmpty>
              ) : (
                (candidates.data ?? []).map((candidate) => (
                  <div key={candidate.transaction.id}>
                    <TransactionLine
                      transaction={candidate.transaction}
                      trailing={
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={manual.isPending}
                          onClick={() =>
                            manual.mutate({
                              receiptId: receipt.id,
                              transactionId: candidate.transaction.id,
                            })
                          }
                        >
                          {t('review.useThis')}
                        </Button>
                      }
                    />
                    <div className="px-8 pb-1">
                      <Percent value={candidate.score} label={t('review.score')} />
                    </div>
                  </div>
                ))
              )}
            </RowList>
            <div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => rematch.mutate(receipt.id)}
              >
                <RefreshCw />
                {t('detail.matchAgain')}
              </Button>
            </div>
          </div>
        )}
      </section>

      {receipt.textExcerpt && (
        <section>
          <SectionLabel>{t('detail.text')}</SectionLabel>
          <pre className="max-h-64 overflow-auto rounded-lg border border-sidebar-border bg-card p-3 text-xs whitespace-pre-wrap text-muted-foreground">
            {receipt.textExcerpt}
          </pre>
        </section>
      )}

      <section>
        <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}>
          <Trash2 />
          {t('detail.delete')}
        </Button>
      </section>

      {deleting && (
        <ConfirmDialog
          title={t('detail.deleteTitle')}
          confirmLabel={tCommon('delete')}
          onConfirm={async () => {
            await remove.mutateAsync(receipt.id);
            setDeleting(false);
            onDeleted();
          }}
          onClose={() => setDeleting(false)}
        >
          <p>{t('detail.deleteHint')}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
