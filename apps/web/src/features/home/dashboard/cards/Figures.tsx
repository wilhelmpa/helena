'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import StatusBadge, { type Status } from '@/components/common/page/StatusBadge';
import { usePendingApprovalCount } from '@/services/approvals.service';
import { useProposalCount } from '@/features/agent-runtime/services/agentRuntime.service';
import { useCrossProjectIssuesQuery } from '../../services/tasks.service';
import { useHomeRunningAgentsCount } from '../../services/homeKpis.service';

export interface HomeFigures {
  openTasks: number | null;
  // Approvals and proposals waiting for a decision (the approvals page lists both).
  decisions: number | null;
  running: number | null;
}

// The figures of Start, each from the read its list uses, so a figure and its list agree.
export function useHomeFigures(): HomeFigures {
  const openTasks = useCrossProjectIssuesQuery(
    { page: 1, pageSize: 1 },
    { assignee: 'me', stateType: 'open' },
  );
  const approvals = usePendingApprovalCount();
  const proposals = useProposalCount();
  const running = useHomeRunningAgentsCount();
  return {
    openTasks: openTasks.isPending ? null : (openTasks.data?.total ?? 0),
    decisions: approvals.data == null ? null : approvals.data.count + (proposals.data?.count ?? 0),
    running: running.isPending ? null : running.count,
  };
}

// A figure as a tile: its label (12px), the number (20px, tabular), an optional line under
// it. The whole tile opens the list it counts.
export function FigureTile({
  href,
  label,
  value,
  status,
  meta,
  children,
  className,
}: {
  href: string;
  label: ReactNode;
  value: ReactNode;
  status?: Status;
  meta?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex min-w-0 flex-col gap-1 rounded-lg border border-sidebar-border bg-card px-3 py-2.5 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{label}</span>
        {status && <StatusBadge status={status} dotOnly className="ms-auto" />}
      </span>
      <span className="text-xl font-semibold tabular-nums">{value ?? '–'}</span>
      {children}
      {meta != null && (
        <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">{meta}</span>
      )}
    </Link>
  );
}

// A figure as a sidebar row: the label, and the number where the sidebar puts a count.
export function FigureRow({
  href,
  icon,
  label,
  value,
  status,
}: {
  href: string;
  icon: ReactNode;
  label: ReactNode;
  value: number | null;
  status?: Status;
}) {
  return (
    <Link
      href={href}
      className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm transition-colors outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {status && <StatusBadge status={status} dotOnly />}
      <span className="font-mono text-xs tabular-nums">{value ?? '–'}</span>
    </Link>
  );
}
