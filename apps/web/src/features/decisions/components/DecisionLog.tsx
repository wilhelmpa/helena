'use client';

import { Card } from '@/design-system';
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
import { useCorrectDecision, useDecisionLogQuery } from '@/services/decisions.service';
import { classKey, euros, milliseconds, percent } from '../utils/format';

const STATUS: Record<string, Status> = {
  decided: 'success',
  unsure: 'waiting',
  off: 'idle',
  no_backend: 'danger',
  timeout: 'danger',
  error: 'danger',
};

function shorten(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// How the log names a question and an option: Helena's own classes in the owner's language,
// anything else (the decide tool, a workflow step, a plugin) as it was asked.
function useWording() {
  const t = useTranslations('decisions.log');
  const tq = useTranslations('decisions.questions');
  const tt = useTranslations('decisions.tiers');
  const tm = useTranslations('mail.triage');
  return {
    question(entry: DecisionLogEntry): string {
      const key = `${classKey(entry.classId)}.${entry.questionId}`;
      if (tq.has(key as never)) return tq(key as never);
      return entry.question ? shorten(entry.question, 120) : entry.questionId;
    },
    option(entry: DecisionLogEntry, id: string): string {
      if (entry.kind === 'yesno' && (id === 'yes' || id === 'no')) return t(id);
      const cls = classKey(entry.classId);
      if (cls === 'mail') {
        if (entry.questionId === 'project')
          return id === 'none' ? t('noProject') : id.replace(/^p:/, '').toUpperCase();
        if (entry.questionId === 'category' && tm.has(`categories.${id}` as never))
          return tm(`categories.${id}` as never);
        if (entry.questionId === 'priority' && tm.has(`priorities.${id}` as never))
          return tm(`priorities.${id}` as never);
      }
      if (cls === 'router' && entry.questionId === 'route' && tt.has(id as never))
        return tt(id as never);
      if (cls === 'receipts' && entry.questionId === 'match')
        return id === 'none' ? t('noTransaction') : t('transaction', { id: id.replace(/^t:/, '') });
      return shorten(entry.optionLabels?.[id] ?? id);
    },
  };
}

function Row({ entry, teamId }: { entry: DecisionLogEntry; teamId: number }) {
  const t = useTranslations('decisions.log');
  const tc = useTranslations('decisions.classes');
  const locale = useLocale();
  const correct = useCorrectDecision(teamId);
  const wording = useWording();
  const classLabel = tc.has(`${classKey(entry.classId)}.label` as never)
    ? tc(`${classKey(entry.classId)}.label` as never)
    : entry.classId;
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
          <span className="font-medium">{classLabel}</span>
          <span className="text-muted-foreground">· {wording.question(entry)}</span>
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
              <span className="text-sm text-foreground">{wording.option(entry, entry.choice)}</span>{' '}
              {t('confidence', { value: percent(entry.confidence) })}
              {top.length > 1 &&
                ` · ${top.map(([option, p]) => `${wording.option(entry, option)} ${percent(p)}`).join(', ')}`}
            </>
          ) : (
            (entry.error ?? t('noAnswer'))
          )}
          {' · '}
          {entry.connection ?? entry.backend ?? '–'}
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
                  {wording.option(entry, option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {entry.outcome && entry.outcome !== entry.choice && (
        <p className="text-xs text-status-danger">
          {t('wasWrong', { outcome: wording.option(entry, entry.outcome) })}
        </p>
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
    <Card pad="none" className="divide-y divide-border/60">
      {items.map((entry) => (
        <Row key={entry.id} entry={entry} teamId={teamId} />
      ))}
    </Card>
  );
}
