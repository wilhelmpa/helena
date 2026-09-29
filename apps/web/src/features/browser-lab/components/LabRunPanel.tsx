import Link from 'next/link';
import { Loader2, MessageSquare, RotateCcw, Square } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { labRunActive, type LabRun } from '@/lib/api/endpoints/browserTask';
import { vaultFileUrl } from '@/lib/api/endpoints/knowledge';
import { useNow } from '@/features/provider-limits/hooks/useNow';
import { approvalsPath } from '@/utils/paths';

const GOOD = new Set(['done']);

// How a run can end, and the two states before (browserLab.status).
const STATUSES = [
  'queued',
  'running',
  'done',
  'likely_done',
  'needs_agent',
  'needs_login',
  'needs_confirmation',
  'needs_approval',
  'denied',
  'blocked',
  'error',
  'stuck',
  'max_steps',
  'owner_took_over',
  'backend_error',
  'cancelled',
] as const;
export type LabStatus = (typeof STATUSES)[number];
export const isLabStatus = (status: string): status is LabStatus =>
  (STATUSES as readonly string[]).includes(status);

export function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (GOOD.has(status)) return 'default';
  if (status === 'running' || status === 'queued') return 'secondary';
  if (['error', 'backend_error', 'denied', 'blocked'].includes(status)) return 'destructive';
  return 'outline';
}

export function formatCost(value: number | null, locale: string): string {
  if (value === null) return '–';
  if (value === 0) return '0 €';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    maximumSignificantDigits: 2,
  }).format(value);
}

export function formatSeconds(ms: number | null, locale: string): string {
  if (ms === null) return '–';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(ms / 1000)} s`;
}

// One run as it happens: its status, each step (operation, element, value key, probability,
// milliseconds), the result, time, tokens and cost, and what to do next.
export function LabRunPanel({
  run,
  chatHref,
  onCancel,
  onRerun,
  cancelling,
}: {
  run: LabRun;
  chatHref: string | null;
  onCancel: () => void;
  onRerun: () => void;
  cancelling: boolean;
}) {
  const t = useTranslations('browserLab.run');
  const tStatus = useTranslations('browserLab.status');
  const locale = useLocale();
  const active = labRunActive(run);
  const now = useNow(active ? 1_000 : 60_000);
  const elapsed =
    run.durationMs ?? (active && now !== null ? now - new Date(run.createdAt).getTime() : null);
  const mismatch =
    run.modelConfigured &&
    run.modelReported &&
    run.backend !== 'standard' &&
    !run.modelReported
      .toLowerCase()
      .includes(run.modelConfigured.toLowerCase().replace(/-latest$/, '')) &&
    !run.modelConfigured.includes('/');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant(run.status)}>
          {active && <Loader2 className="animate-spin" />}
          {isLabStatus(run.status) ? tStatus(run.status) : run.status}
        </Badge>
        <span className="text-sm font-medium">{run.backendLabel}</span>
        {run.agentName && (
          <span className="text-xs text-muted-foreground">{t('as', { name: run.agentName })}</span>
        )}
        <span className="ms-auto flex items-center gap-2">
          {active ? (
            <Button variant="outline" size="sm" disabled={cancelling} onClick={onCancel}>
              <Square />
              {t('cancel')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onRerun}>
              <RotateCcw />
              {t('rerun')}
            </Button>
          )}
        </span>
      </div>
      <p className="text-sm">{run.goal}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">{t('time')}</dt>
          <dd>{formatSeconds(elapsed, locale)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('steps')}</dt>
          <dd>
            {run.steps.length}
            {run.decisions ? ` · ${t('decisions', { count: run.decisions })}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('tokens')}</dt>
          <dd>{new Intl.NumberFormat(locale).format(run.inputTokens + run.outputTokens)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('cost')}</dt>
          <dd>{formatCost(run.costEur, locale)}</dd>
        </div>
      </dl>
      {(run.modelReported || run.modelConfigured) && (
        <p className={cn('text-xs text-muted-foreground', mismatch && 'text-destructive')}>
          {t('model', { model: run.modelReported ?? run.modelConfigured ?? '' })}
          {mismatch ? ` · ${t('modelMismatch', { configured: run.modelConfigured ?? '' })}` : ''}
          {run.decisions > 0 && run.decisionMs > 0
            ? ` · ${t('perDecision', { ms: Math.round(run.decisionMs / run.decisions) })}`
            : ''}
        </p>
      )}

      {run.steps.length > 0 && (
        <ol className="divide-y divide-border/60 rounded-md border border-sidebar-border bg-card">
          {run.steps.map((step, index) => (
            <li key={index} className="flex items-start gap-2 px-3 py-2 text-sm">
              <span className="w-5 shrink-0 text-end text-xs text-muted-foreground">
                {step.n ?? index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-mono text-xs">{step.operation}</span>{' '}
                <span className="break-words">{step.element}</span>
                {step.valueKey ? (
                  <span className="text-xs text-muted-foreground"> ← {step.valueKey}</span>
                ) : null}
                {step.option ? (
                  <span className="text-xs text-muted-foreground"> → {step.option}</span>
                ) : null}
                {step.outcome && step.outcome !== 'done' ? (
                  <span className="block text-xs text-muted-foreground">{step.outcome}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-end text-xs text-muted-foreground">
                {typeof step.probability === 'number' ? `p ${step.probability.toFixed(2)}` : ''}
                {typeof step.decisionMs === 'number' ? ` · ${step.decisionMs} ms` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}

      {!active && (run.summary || run.result?.url) && (
        <div className="space-y-1 rounded-md border border-sidebar-border bg-card px-3 py-2 text-sm">
          {run.summary && <p className="whitespace-pre-wrap">{run.summary}</p>}
          {run.result?.url && (
            <p dir="ltr" className="truncate text-xs text-muted-foreground">
              {run.result.url}
            </p>
          )}
          {run.result?.approvalId ? (
            <Link href={approvalsPath()} className="text-xs underline-offset-2 hover:underline">
              {t('approval', { id: run.result.approvalId })}
            </Link>
          ) : null}
          {run.result?.candidates?.length ? (
            <p className="text-xs text-muted-foreground">
              {t('candidates')}:{' '}
              {run.result.candidates.map((c) => `${c.element} (${c.probability})`).join(', ')}
            </p>
          ) : null}
        </div>
      )}
      {chatHref && (
        <Link
          href={chatHref}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          <MessageSquare className="size-3.5" />
          {t('openChat')}
        </Link>
      )}
      {(run.finalFramePath || run.finalFrame) && (
        // eslint-disable-next-line @next/next/no-img-element -- the run's last page from the vault
        <img
          src={run.finalFramePath ? vaultFileUrl(run.finalFramePath) : run.finalFrame!}
          alt={t('finalFrame')}
          className="w-full rounded-md border border-sidebar-border"
        />
      )}
    </div>
  );
}
