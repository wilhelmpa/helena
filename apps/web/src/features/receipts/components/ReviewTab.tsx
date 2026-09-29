'use client';

import { useState } from 'react';
import { Check, ChevronDown, Link2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/common/page/EmptyState';
import { RowList, SectionLabel } from '@/components/common/page/RowList';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { MatchCandidate, ReviewItem } from '@/lib/api/endpoints/receipts';
import { useConfirmMatch, useMatchManually, useRejectMatch } from '../services/receipts.service';
import { MethodBadge, Percent, ReceiptLine, TransactionLine } from './ReceiptRows';

// "Prüfen": the matches Helena proposes but did not make on its own — the rules were not
// sure enough and the decision model was off, unsure, or chose against the rules. The owner
// confirms or rejects each, or picks another candidate; every answer goes back to the
// decision log.
export function ReviewTab({
  projectKey,
  items,
  loading,
  onOpenReceipt,
}: {
  projectKey: string;
  items: ReviewItem[];
  loading: boolean;
  onOpenReceipt: (receiptId: number) => void;
}) {
  const t = useTranslations('receipts');
  if (loading) return <ListSkeleton rows={3} rowClassName="h-28" />;
  if (!items.length)
    return <EmptyState title={t('review.emptyTitle')} description={t('review.emptyHint')} />;
  return (
    <div className="space-y-4 pb-8">
      {items.map((item) => (
        <ReviewCard
          key={item.matchId}
          projectKey={projectKey}
          item={item}
          onOpenReceipt={onOpenReceipt}
        />
      ))}
    </div>
  );
}

function CandidateReason({ candidate }: { candidate: MatchCandidate }) {
  const t = useTranslations('receipts.reasons');
  const parts = [
    t(`amount.${candidate.amount}`),
    candidate.reference ? t('reference') : null,
    candidate.identity ? t(`identity.${candidate.identity}`) : null,
    t(`date.${candidate.dateFit}`),
  ].filter(Boolean);
  return <span className="truncate text-xs text-muted-foreground">{parts.join(' · ')}</span>;
}

function ReviewCard({
  projectKey,
  item,
  onOpenReceipt,
}: {
  projectKey: string;
  item: ReviewItem;
  onOpenReceipt: (receiptId: number) => void;
}) {
  const t = useTranslations('receipts');
  const confirm = useConfirmMatch(projectKey);
  const reject = useRejectMatch(projectKey);
  const manual = useMatchManually(projectKey);
  const [open, setOpen] = useState(false);
  const busy = confirm.isPending || reject.isPending || manual.isPending;
  const proposed = item.candidates.find((c) => c.transaction.id === item.transaction.id);
  const others = item.candidates.filter((c) => c.transaction.id !== item.transaction.id);

  return (
    <article className="rounded-md border border-sidebar-border bg-card p-1">
      <ReceiptLine receipt={item.receipt} onOpen={() => onOpenReceipt(item.receipt.id)} />
      <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
        <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
        <MethodBadge method={item.method} />
        <Percent value={item.score} label={t('review.score')} />
        <Percent value={item.confidence} label={t('review.confidence')} />
        {proposed ? <CandidateReason candidate={proposed} /> : null}
      </div>
      <TransactionLine transaction={item.transaction} showAccount />
      <div className="flex flex-wrap items-center gap-2 px-2 pt-1 pb-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => confirm.mutate(item.matchId)}
        >
          <Check />
          {t('review.confirm')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => reject.mutate(item.matchId)}
        >
          <X />
          {t('review.reject')}
        </Button>
        {others.length > 0 && (
          <Collapsible open={open} onOpenChange={setOpen} className="contents">
            <CollapsibleTrigger asChild>
              <Button size="sm" variant="ghost" className="ms-auto">
                {t('review.others', { count: others.length })}
                <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="w-full">
              <SectionLabel as="h3">{t('review.pickOther')}</SectionLabel>
              <RowList>
                {others.map((candidate) => (
                  <div key={candidate.transaction.id}>
                    <TransactionLine
                      transaction={candidate.transaction}
                      trailing={
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            manual.mutate({
                              receiptId: item.receipt.id,
                              transactionId: candidate.transaction.id,
                            })
                          }
                        >
                          {t('review.useThis')}
                        </Button>
                      }
                    />
                    <div className="flex items-center gap-2 px-8 pb-1">
                      <Percent value={candidate.score} label={t('review.score')} />
                      <CandidateReason candidate={candidate} />
                    </div>
                  </div>
                ))}
              </RowList>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </article>
  );
}
