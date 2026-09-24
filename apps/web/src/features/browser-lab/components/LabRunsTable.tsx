import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { LabRun } from '@/lib/api/endpoints/browserTask';
import { formatDateTime } from '@/utils/dates';
import { formatCost, formatSeconds, isLabStatus, statusVariant } from './LabRunPanel';

// Every browser task of this browser, the tests and the agents' own, newest first: which backend,
// how it ended, how long, how many decisions and tokens, what it cost — the comparison.
export function LabRunsTable({
  runs,
  selected,
  onSelect,
}: {
  runs: LabRun[];
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const t = useTranslations('browserLab.table');
  const tStatus = useTranslations('browserLab.status');
  const locale = useLocale();
  if (runs.length === 0) return <p className="px-1 text-sm text-muted-foreground">{t('empty')}</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-sidebar-border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-start text-xs text-muted-foreground">
          <tr className="border-b border-border/60">
            <th className="px-3 py-2 font-normal">{t('when')}</th>
            <th className="px-3 py-2 font-normal">{t('backend')}</th>
            <th className="px-3 py-2 font-normal">{t('goal')}</th>
            <th className="px-3 py-2 font-normal">{t('status')}</th>
            <th className="px-3 py-2 text-end font-normal">{t('time')}</th>
            <th className="px-3 py-2 text-end font-normal">{t('steps')}</th>
            <th className="px-3 py-2 text-end font-normal">{t('tokens')}</th>
            <th className="px-3 py-2 text-end font-normal">{t('cost')}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.id}
              tabIndex={0}
              className={cn(
                'cursor-pointer border-b border-border/60 last:border-0 hover:bg-accent',
                selected === run.id && 'bg-accent',
              )}
              onClick={() => onSelect(run.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(run.id);
              }}
            >
              <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">
                {formatDateTime(run.createdAt)}
              </td>
              <td className="px-3 py-2">
                <span className="block max-w-48 truncate">{run.backendLabel}</span>
                {run.source === 'agent' && (
                  <span className="text-xs text-muted-foreground">
                    {t('byAgent', { name: run.agentName ?? '' })}
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                <span className="line-clamp-2 max-w-80">{run.goal}</span>
              </td>
              <td className="px-3 py-2">
                <Badge variant={statusVariant(run.status)} className="text-xs font-normal">
                  {isLabStatus(run.status) ? tStatus(run.status) : run.status}
                </Badge>
              </td>
              <td className="px-3 py-2 text-end whitespace-nowrap">
                {formatSeconds(run.durationMs, locale)}
              </td>
              <td className="px-3 py-2 text-end">{run.steps.length}</td>
              <td className="px-3 py-2 text-end">
                {new Intl.NumberFormat(locale).format(run.inputTokens + run.outputTokens)}
              </td>
              <td className="px-3 py-2 text-end whitespace-nowrap">
                {formatCost(run.costEur, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
