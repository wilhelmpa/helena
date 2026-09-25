'use client';

import { CircleSlash, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { RowEmpty, RowList, SectionLabel } from '@/components/common/page/RowList';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Receipt, Transaction } from '@/lib/api/endpoints/receipts';
import { useUpdateTransaction } from '../services/receipts.service';
import { ReceiptLine, TransactionLine } from './ReceiptRows';

// "Offen": what still lacks its counterpart — receipts without a transaction and
// transactions without a receipt. A transaction that needs none (a transfer between own
// accounts, a salary) is marked "kein Beleg nötig" and moves to its own group.
export function OpenTab({
  projectKey,
  receipts,
  transactions,
  ignored,
  loading,
  onOpenReceipt,
}: {
  projectKey: string;
  receipts: Receipt[];
  transactions: Transaction[];
  ignored: Transaction[];
  loading: boolean;
  onOpenReceipt: (receiptId: number) => void;
}) {
  const t = useTranslations('receipts');
  const update = useUpdateTransaction(projectKey);
  if (loading) return <ListSkeleton rows={6} />;
  const setStatus = (transactionId: number, status: 'open' | 'ignored') =>
    update.mutate({ transactionId, patch: { status } });

  return (
    <div className="space-y-6 pb-8">
      <section>
        <SectionLabel trailing={<span className="tabular-nums">{receipts.length}</span>}>
          {t('open.receipts')}
        </SectionLabel>
        <RowList className="bg-card">
          {receipts.length ? (
            receipts.map((receipt) => (
              <ReceiptLine
                key={receipt.id}
                receipt={receipt}
                onOpen={() => onOpenReceipt(receipt.id)}
              />
            ))
          ) : (
            <RowEmpty>{t('open.noReceipts')}</RowEmpty>
          )}
        </RowList>
      </section>

      <section>
        <SectionLabel trailing={<span className="tabular-nums">{transactions.length}</span>}>
          {t('open.transactions')}
        </SectionLabel>
        <RowList className="bg-card">
          {transactions.length ? (
            transactions.map((transaction) => (
              <TransactionLine
                key={transaction.id}
                transaction={transaction}
                showAccount
                trailing={
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('open.noReceiptNeeded')}
                        disabled={update.isPending}
                        onClick={() => setStatus(transaction.id, 'ignored')}
                      >
                        <CircleSlash />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('open.noReceiptNeeded')}</TooltipContent>
                  </Tooltip>
                }
              />
            ))
          ) : (
            <RowEmpty>{t('open.noTransactions')}</RowEmpty>
          )}
        </RowList>
      </section>

      {ignored.length > 0 && (
        <section>
          <SectionLabel trailing={<span className="tabular-nums">{ignored.length}</span>}>
            {t('open.ignored')}
          </SectionLabel>
          <RowList className="bg-card">
            {ignored.map((transaction) => (
              <TransactionLine
                key={transaction.id}
                transaction={transaction}
                showAccount
                trailing={
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('open.undoIgnore')}
                        disabled={update.isPending}
                        onClick={() => setStatus(transaction.id, 'open')}
                      >
                        <Undo2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('open.undoIgnore')}</TooltipContent>
                  </Tooltip>
                }
              />
            ))}
          </RowList>
        </section>
      )}
    </div>
  );
}
