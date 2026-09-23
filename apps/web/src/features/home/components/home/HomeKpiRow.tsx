'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { tasksPath, approvalsPath } from '@/utils/paths';
import { usePendingApprovalCount } from '@/services/approvals.service';
import { useCrossProjectIssuesQuery } from '../../services/tasks.service';
import { useHomeRunningAgentsCount } from '../../services/homeKpis.service';
import StatusBadge from '@/components/common/page/StatusBadge';

// The KPI row at the top of Home (docs/volition-design-helena-ui.md "Start"):
// open tasks, pending approvals (amber, clickable), running agents (live), each a
// plain number with a label — no cards, no borders, so it reads as one line, the
// way the sidebar itself favors a row over a box.
function Kpi({
  href,
  label,
  value,
  status,
  loading,
}: {
  href?: string;
  label: string;
  value: number | null;
  status?: 'waiting' | 'running';
  loading: boolean;
}) {
  const content = (
    <>
      {status && <StatusBadge status={status} dotOnly />}
      <span className="text-2xl font-semibold tabular-nums">{loading ? '–' : (value ?? 0)}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </>
  );
  const className = cn(
    'flex items-center gap-2 rounded-lg px-1 py-1',
    href && 'transition-colors hover:bg-accent',
  );
  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

export default function HomeKpiRow() {
  const t = useTranslations('nav');
  const openTasks = useCrossProjectIssuesQuery(
    { page: 1, pageSize: 1 },
    { assignee: 'me', stateType: 'open' },
  );
  const approvals = usePendingApprovalCount();
  const runningAgents = useHomeRunningAgentsCount();

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2">
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
        label={t('homeKpiRunningAgents')}
        value={runningAgents.count}
        status={runningAgents.count > 0 ? 'running' : undefined}
        loading={runningAgents.isPending}
      />
    </div>
  );
}
