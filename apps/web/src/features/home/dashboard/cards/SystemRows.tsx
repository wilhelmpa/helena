'use client';

import { useTranslations } from 'next-intl';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import StatusBadge, { type Status } from '@/components/common/page/StatusBadge';
import { ROW_CLASS, ROW_INTERACTIVE_CLASS } from '@/components/common/page/RowList';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { formatDurationShort } from '@/utils/dates';
import { cn } from '@/lib/utils';
import { SkeletonRows } from '../DashboardCard';
import { useSystemHealthQuery } from '../../services/systemHealth.service';
import HomeSystemHealth from '../../components/home/HomeSystemHealth';
import { systemSummary, type SystemProblem } from '../systemSummary';

function useProblemText() {
  const t = useTranslations('home.system');
  const tHealth = useTranslations('god.systemHealth');
  const tp = useTranslations('providerLimits');
  return (problem: SystemProblem): string => {
    switch (problem.key) {
      case 'serviceDown':
        return t('serviceDown', {
          service: tHealth(`service.${problem.service}` as 'service.runner'),
        });
      case 'janitorDown':
        return t('janitorDown', {
          job: tHealth(`janitor.${problem.job}` as 'janitor.run-janitor'),
        });
      case 'loginNeedsOwner':
        return t('loginNeedsOwner', {
          provider: ['anthropic', 'openai-codex'].includes(problem.provider)
            ? tp(`providers.${problem.provider}` as 'providers.anthropic')
            : problem.provider,
        });
      case 'loginsStale':
        return t('loginsStale', { time: formatDurationShort(problem.since) });
      case 'agentsDrift':
        return t('agentsDrift', { count: problem.count });
      case 'modelsRefused':
        return t('modelsRefused', { count: problem.count });
      case 'run':
        return problem.problem.key === 'waiting'
          ? tHealth('waiting', {
              count: problem.problem.count,
              time: problem.problem.since ? formatDurationShort(problem.problem.since) : '',
            })
          : tHealth(problem.problem.key, { count: problem.problem.count });
    }
  };
}

// One area of the system as a report row: its state as a dot, its name, how much of it is
// well. Not a control, so no hover.
function AreaRow({ status, label, value }: { status: Status; label: string; value: string }) {
  return (
    <div className={ROW_CLASS}>
      <StatusBadge status={status} dotOnly className="w-4 justify-center" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{value}</span>
    </div>
  );
}

// The System card: one line that says whether everything runs, with "Details", which opens
// the full health overview; under it the areas (services, agents in sync, logins,
// maintenance) and each run problem as a line of its own. `compact` shows the areas only
// when one of them is not well. For the Administrator only.
export default function SystemRows({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('home.system');
  const text = useProblemText();
  const [open, setOpen] = useState(false);
  const health = useSystemHealthQuery(true);
  if (!health.data) return <SkeletonRows count={compact ? 1 : 5} />;
  const summary = systemSummary(health.data);
  const has = (key: SystemProblem['key']) => summary.problems.some((p) => p.key === key);
  const areas: { key: string; status: Status; label: string; value: string }[] = [
    {
      key: 'services',
      status: has('serviceDown') ? 'danger' : 'success',
      label: t('areas.services'),
      value: `${summary.services.ok}/${summary.services.total}`,
    },
    {
      key: 'agents',
      status: has('agentsDrift') || has('modelsRefused') ? 'waiting' : 'success',
      label: t('areas.agents'),
      value: `${summary.agents.synced}/${summary.agents.total}`,
    },
    ...(summary.logins.total > 0 || has('loginsStale')
      ? [
          {
            key: 'logins',
            status: (has('loginNeedsOwner')
              ? 'danger'
              : has('loginsStale')
                ? 'waiting'
                : 'success') as Status,
            label: t('areas.logins'),
            value: `${summary.logins.ok}/${summary.logins.total}`,
          },
        ]
      : []),
    {
      key: 'janitors',
      status: has('janitorDown') ? 'waiting' : 'success',
      label: t('areas.janitors'),
      value: `${summary.janitors.ok}/${summary.janitors.total}`,
    },
  ];
  const shownAreas = compact ? areas.filter((area) => area.status !== 'success') : areas;
  const details = summary.problems.filter(
    (problem) =>
      problem.key === 'run' || problem.key === 'loginNeedsOwner' || problem.key === 'serviceDown',
  );
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(ROW_CLASS, ROW_INTERACTIVE_CLASS, 'w-full text-start')}
      >
        <StatusBadge status={summary.status} dotOnly className="w-4 justify-center" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {summary.problems.length === 0
            ? t('ok')
            : t('problems', { count: summary.problems.length })}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
          {t('details')}
          <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
        </span>
      </button>
      {shownAreas.map((area) => (
        <AreaRow key={area.key} status={area.status} label={area.label} value={area.value} />
      ))}
      {details.slice(0, 3).map((problem, index) => (
        <div key={`${problem.key}:${index}`} className={cn(ROW_CLASS, 'text-xs')}>
          <StatusBadge status={problem.tone} dotOnly className="w-4 justify-center" />
          <span className="min-w-0 flex-1 truncate" title={text(problem)}>
            {text(problem)}
          </span>
        </div>
      ))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"
        >
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            {t('title')}
          </DialogTitle>
          <HomeSystemHealth />
        </DialogContent>
      </Dialog>
    </>
  );
}
