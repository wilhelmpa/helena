'use client';

import { useLocale, useTranslations } from 'next-intl';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import StatusBadge, { type Status } from '@/components/common/page/StatusBadge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DecisionLogEntry } from '@/lib/api/endpoints/decisions';
import { useCorrectDecision, useDecisionLogQuery } from '../services/decisions.service';
import { classKey, euros, milliseconds, percent } from '../utils/format';

const STATUS: Record<string, Status> = {
  decided: 'success',
  unsure: 'waiting',
  off: 'idle',
  no_backend: 'danger',
  timeout: 'danger',
  error: 'danger',
};

function Row({ entry, teamId }: { entry: DecisionLogEntry; teamId: number }) {
  const t = useTranslations('decisions.log');
  const tc = useTranslations('decisions.classes');
  const locale = useLocale();
  const correct = useCorrectDecision(teamId);
  const top = Object.entries(entry.probabilities ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return (
    <div className="space-y-1 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge status={STATUS[entry.status] ?? 'idle'}>
            {t(`status.${entry.status}` as never)}
          </StatusBadge>
          <span className="font-medium">{tc(`${classKey(entry.classId)}.label` as never)}</span>
          <span className="text-muted-foreground">· {entry.questionId}</span>
          {entry.subject && (
            <span className="truncate text-xs text-muted-foreground">· {entry.subject}</span>
          )}
          {entry.projectKey && (
            <span className="text-xs text-muted-foreground">· {entry.projectKey}</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(entry.createdAt).toLocaleString(locale)}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {entry.choice ? (
            <>
              <span className="text-sm text-foreground">{entry.choice}</span>{' '}
              {t('confidence', { value: percent(entry.confidence) })}
              {top.length > 1 &&
                ` · ${top.map(([option, p]) => `${option} ${percent(p)}`).join(', ')}`}
            </>
          ) : (
            (entry.error ?? t('noAnswer'))
          )}
          {' · '}
          {entry.backend ?? '–'}
          {entry.model ? ` (${entry.model})` : ''} · {milliseconds(entry.latencyMs)}
          {entry.costEur ? ` · ${euros(entry.costEur, locale)}` : ''}
        </div>
        {entry.choice && (
          <Select
            value={entry.outcome ?? ''}
            onValueChange={(outcome) => correct.mutate({ decisionId: entry.id, outcome })}
          >
            <SelectTrigger className="h-8 w-44" aria-label={t('correct')}>
              <SelectValue placeholder={t('correct')} />
            </SelectTrigger>
            <SelectContent>
              {entry.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {entry.outcome && entry.outcome !== entry.choice && (
        <p className="text-xs text-status-danger">{t('wasWrong', { outcome: entry.outcome })}</p>
      )}
      {entry.inputText && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t('input')}</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-card p-2 whitespace-pre-wrap">
            {entry.inputText}
          </pre>
        </details>
      )}
    </div>
  );
}

// Every question asked, newest first; the owner corrects a wrong answer here, which the evals
// and the numbers read.
export function DecisionLog({
  teamId,
  classId,
  status,
}: {
  teamId: number;
  classId: string;
  status: string;
}) {
  const t = useTranslations('decisions.log');
  const log = useDecisionLogQuery(teamId, classId, status);
  if (log.isPending) return <ListSkeleton rows={6} rowClassName="h-14" />;
  const items = log.data?.items ?? [];
  if (items.length === 0) return <EmptyState title={t('empty')} description={t('emptyHint')} />;
  return (
    <div className="divide-y divide-border/60 rounded-md border border-sidebar-border bg-card">
      {items.map((entry) => (
        <Row key={entry.id} entry={entry} teamId={teamId} />
      ))}
    </div>
  );
}
