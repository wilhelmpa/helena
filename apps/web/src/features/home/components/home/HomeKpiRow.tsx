'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { tasksPath, approvalsPath, globalAgentActivityPath } from '@/utils/paths';
import { usePendingApprovalCount } from '@/services/approvals.service';
import { useProposalCount } from '@/features/agent-runtime/services/agentRuntime.service';
import { useCrossProjectIssuesQuery } from '../../services/tasks.service';
import { useHomeRunningAgentsCount } from '../../services/homeKpis.service';
import StatusBadge from '@/components/common/page/StatusBadge';

// One figure of the KPI row: the number and what it counts, in a sidebar-surface tile.
// Every figure opens the list it counts, so each one is a link with the sidebar's hover
// fill.
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
      className="flex h-10 min-w-0 items-center gap-2 rounded-lg border bg-card px-3 text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
    >
      <span className="text-md font-semibold tabular-nums">{loading ? '–' : (value ?? 0)}</span>
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      {status && <StatusBadge status={status} dotOnly className="ms-auto" />}
    </Link>
  );
}

// The KPI row at the top of Home (docs/volition-design-helena-ui.md "Start"): the
// reader's open tasks, pending approvals (amber when any wait), running agents (live).
// Three tiles side by side, one under the other on a phone.
export default function HomeKpiRow() {
  const t = useTranslations('nav');
  const openTasks = useCrossProjectIssuesQuery(
    { page: 1, pageSize: 1 },
    { assignee: 'me', stateType: 'open' },
  );
  const approvals = usePendingApprovalCount();
  // Memory writes and Hermes updates wait on the same page.
  const proposals = useProposalCount();
  const pendingApprovals =
    approvals.data == null ? null : approvals.data.count + (proposals.data?.count ?? 0);
  const runningAgents = useHomeRunningAgentsCount();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Kpi
        href={`${tasksPath()}?assignee=me`}
        label={t('homeKpiOpenTasks')}
        value={openTasks.data?.total ?? null}
        loading={openTasks.isPending}
      />
      <Kpi
        href={approvalsPath()}
        label={t('homeKpiPendingApprovals')}
        value={pendingApprovals}
        status={(pendingApprovals ?? 0) > 0 ? 'waiting' : undefined}
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
