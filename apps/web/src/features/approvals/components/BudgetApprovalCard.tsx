'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CircleCheck, CircleX, Gauge } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import type { ApprovalRequest } from '@/lib/api/endpoints/approvals';
import type { BudgetCardAction } from '@/lib/api/endpoints/autopilot';
import { issuePath } from '@/utils/paths';
import { formatDateTime } from '@/utils/dates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDecideBudgetCard } from '@/services/autopilot.service';
import {
  formatBudgetAmount,
  inputToLimit,
  limitToInput,
} from '@/features/autopilot/utils/autopilotFormat';

// The owner's card for a used-up budget: which budget, what is used of it, and the three
// answers: raise it, let the work continue once, or keep it stopped.
export default function BudgetApprovalCard({ request }: { request: ApprovalRequest }) {
  const t = useTranslations('autopilot');
  const tApprovals = useTranslations('approvals');
  const locale = useLocale();
  const decide = useDecideBudgetCard();
  const payload = request.payload ?? {};
  const metric = payload.metric ?? 'tokens';
  const limit = payload.limit ?? 0;
  const used = payload.used ?? 0;
  const [text, setText] = useState(() => limitToInput(metric, Math.max(limit * 2, used * 1.5)));

  const period = payload.period ? t(`period.${payload.period}`) : '';
  const what =
    payload.scope === 'project'
      ? t('card.projectBudget', {
          period,
          metric: t(`metric.${metric}`),
          project: request.projectName,
        })
      : t('card.agentBudget', { period, metric: t(`metric.${metric}`), agent: request.agentName });

  async function answer(action: BudgetCardAction) {
    let next: number | undefined;
    if (action === 'raise') {
      const parsed = inputToLimit(metric, text);
      if (parsed == null || parsed <= used) {
        toast.error(t('card.limitTooLow'));
        return;
      }
      next = parsed;
    }
    try {
      await decide.mutateAsync({ id: request.id, action, limit: next });
      toast.success(
        t(
          action === 'raise'
            ? 'card.raisedToast'
            : action === 'once'
              ? 'card.onceToast'
              : 'card.keptToast',
        ),
      );
    } catch {
      // Surfaced by the global mutation error toast.
    }
  }

  return (
    <article className="space-y-3 rounded-lg border border-status-waiting/40 bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-medium text-status-waiting">
          <Gauge className="size-3.5" />
          {t('card.title')}
        </span>
        <span>
          {tApprovals('requestedBy', {
            agent: request.agentName,
            username: request.agentUsername,
            project: request.projectName,
          })}
        </span>
        {request.issueSequenceNumber != null && (
          <Link
            href={issuePath(request.projectKey, request.issueSequenceNumber)}
            className="truncate hover:underline"
          >
            <span dir="ltr">{request.issueIdentifier}</span>
            {request.issueTitle && <span dir="auto"> · {request.issueTitle}</span>}
          </Link>
        )}
        <span className="ms-auto">{formatDateTime(request.createdAt)}</span>
      </div>
      <p className="text-md font-medium">{what}</p>
      <p className="text-sm text-muted-foreground tabular-nums">
        {t('usedOf', {
          used: formatBudgetAmount(metric, used, locale),
          limit: formatBudgetAmount(metric, limit, locale),
        })}
      </p>
      {request.status === 'pending' ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor={`budget-card-${request.id}`} className="text-xs text-muted-foreground">
              {t('card.newLimit')} ({t(`metricUnit.${metric}`)})
            </label>
            <Input
              id={`budget-card-${request.id}`}
              inputMode="decimal"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="h-8 w-36 tabular-nums"
            />
          </div>
          <Button size="sm" disabled={decide.isPending} onClick={() => void answer('raise')}>
            {t('card.raise')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={decide.isPending}
            onClick={() => void answer('once')}
          >
            {t('card.once')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={decide.isPending}
            onClick={() => void answer('keep')}
          >
            {t('card.keep')}
          </Button>
        </div>
      ) : (
        <BudgetCardOutcome request={request} />
      )}
    </article>
  );
}

function BudgetCardOutcome({ request }: { request: ApprovalRequest }) {
  const t = useTranslations('autopilot');
  const tApprovals = useTranslations('approvals');
  const name = request.decidedByName ?? tApprovals('someone');
  const kept = request.status === 'rejected';
  const Icon = kept ? CircleX : CircleCheck;
  const text = kept
    ? t('card.kept', { name })
    : request.note === 'once'
      ? t('card.continuedOnce', { name })
      : t('card.raised', { name });
  return (
    <p className="flex flex-wrap items-center gap-x-2 border-t pt-3 text-sm">
      <Icon className={kept ? 'size-4 text-destructive' : 'size-4 text-status-success'} />
      <span className="font-medium">{text}</span>
      {request.decidedAt && (
        <span className="text-xs text-muted-foreground">{formatDateTime(request.decidedAt)}</span>
      )}
    </p>
  );
}
