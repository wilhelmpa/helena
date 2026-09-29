import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { LabRun } from '@/lib/api/endpoints/browserTask';
import { formatDateTime } from '@/utils/dates';
import { formatCost, formatSeconds, isLabStatus, statusVariant } from './LabRunPanel';
import { Table, Th, Tr, Td } from '@/design-system';

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
      <Table stack={false} className="min-w-[640px]">
        <thead>
          <Tr>
            <Th>{t('when')}</Th>
            <Th>{t('backend')}</Th>
            <Th>{t('goal')}</Th>
            <Th>{t('status')}</Th>
            <Th alignment="end">{t('time')}</Th>
            <Th alignment="end">{t('steps')}</Th>
            <Th alignment="end">{t('tokens')}</Th>
            <Th alignment="end">{t('cost')}</Th>
          </Tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <Tr
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
              <Td>{formatDateTime(run.createdAt)}</Td>
              <Td>
                <span className="block max-w-48 truncate">{run.backendLabel}</span>
                {run.source === 'agent' && (
                  <span className="text-xs text-muted-foreground">
                    {t('byAgent', { name: run.agentName ?? '' })}
                  </span>
                )}
              </Td>
              <Td>
                <span className="line-clamp-2 max-w-80">{run.goal}</span>
              </Td>
              <Td>
                <Badge variant={statusVariant(run.status)} className="text-xs font-normal">
                  {isLabStatus(run.status) ? tStatus(run.status) : run.status}
                </Badge>
              </Td>
              <Td alignment="end">{formatSeconds(run.durationMs, locale)}</Td>
              <Td alignment="end">{run.steps.length}</Td>
              <Td alignment="end">
                {new Intl.NumberFormat(locale).format(run.inputTokens + run.outputTokens)}
              </Td>
              <Td alignment="end">{formatCost(run.costEur, locale)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
