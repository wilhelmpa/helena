'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { tasksPath, approvalsPath, globalAgentActivityPath } from '@/utils/paths';
import { usePendingApprovalCount } from '@/services/approvals.service';
import { useCrossProjectIssuesQuery } from '../../services/tasks.service';
import { useHomeRunningAgentsCount } from '../../services/homeKpis.service';
import StatusBadge from '@/components/common/page/StatusBadge';

// One figure of the KPI row: the number and what it counts, in one 32px row. Every
// figure opens the list it counts, so each one is a link with the sidebar's hover fill.
function Kpi({
  href,
  label,
  value,
  status,
  loading,
}: {
  href: string;
  label: string;
  value: number | null;
  status?: 'waiting' | 'running';
  loading: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
      )}
    >
      {status && <StatusBadge status={status} dotOnly />}
      <span className="text-base font-semibold tabular-nums">{loading ? '–' : (value ?? 0)}</span>
      <span className="truncate text-muted-foreground">{label}</span>
    </Link>
  );
}

// The KPI row at the top of Home (docs/volition-design-helena-ui.md "Start"): open
// tasks, pending approvals (amber when any wait), running agents (live) — plain figures
// in a row, no cards, the way the sidebar favors a row over a box. Two per line on a
// phone.
export default function HomeKpiRow() {
  const t = useTranslations('nav');
  const openTasks = useCrossProjectIssuesQuery(
    { page: 1, pageSize: 1 },
    { assignee: 'me', stateType: 'open' },
  );
  const approvals = usePendingApprovalCount();
  const runningAgents = useHomeRunningAgentsCount();

  return (
    <div className="-mx-2 grid grid-cols-2 gap-x-2 sm:flex sm:flex-wrap sm:items-center sm:gap-x-4">
      <Kpi
        href={tasksPath()}
        label={t('homeKpiOpenTasks')}
        value={openTasks.data?.total ?? null}
        loading={openTasks.isPending}
      />
      <Kpi
        href={approvalsPath()}
        label={t('homeKpiPendingApprovals')}
        value={approvals.data?.count ?? null}
        status={(approvals.data?.count ?? 0) > 0 ? 'waiting' : undefined}
        loading={approvals.isPending}
      />
      <Kpi
        href={globalAgentActivityPath()}
        label={t('homeKpiRunningAgents')}
        value={runningAgents.count}
        status={runningAgents.count > 0 ? 'running' : undefined}
        loading={runningAgents.isPending}
      />
    </div>
  );
}
