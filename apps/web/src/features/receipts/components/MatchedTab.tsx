'use client';

import { Unlink } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Receipt } from '@/lib/api/endpoints/receipts';
import { useRemoveMatch } from '../services/receipts.service';
import { formatDay } from '../utils/format';
import { MethodBadge, Money, ReceiptLine } from './ReceiptRows';

// "Zugeordnet": the receipts of the month with the transaction each was matched to, how
// (rule, decision model, by hand), and a way to undo it.
export function MatchedTab({
  projectKey,
  receipts,
  loading,
  onOpenReceipt,
}: {
  projectKey: string;
  receipts: Receipt[];
  loading: boolean;
  onOpenReceipt: (receiptId: number) => void;
}) {
  const t = useTranslations('receipts');
  const locale = useLocale();
  const remove = useRemoveMatch(projectKey);
  if (loading) return <ListSkeleton rows={6} />;
  if (!receipts.length)
    return <EmptyState title={t('matched.emptyTitle')} description={t('matched.emptyHint')} />;
  return (
    <div className="space-y-2 pb-8">
      {receipts.map((receipt) => {
        const match = receipt.match;
        return (
          <article key={receipt.id} className="rounded-lg border border-sidebar-border bg-card p-1">
            <ReceiptLine receipt={receipt} onOpen={() => onOpenReceipt(receipt.id)} />
            {match && (
              <div className="flex h-8 min-w-0 items-center gap-2 ps-8 pe-1 text-sm">
                <MethodBadge method={match.method} />
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto">
                  {formatDay(match.bookingDate, locale)} · {match.counterpartyName || t('noName')}
                </span>
                <Money cents={match.amountCents} currency={match.currency} />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('matched.unmatch')}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(match.matchId)}
                    >
                      <Unlink />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('matched.unmatch')}</TooltipContent>
                </Tooltip>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
