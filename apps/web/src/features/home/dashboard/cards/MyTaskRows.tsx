'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ListTodo } from 'lucide-react';
import type { CrossProjectIssue } from '@/lib/api/endpoints/issues';
import { ROW_CLASS, ROW_INTERACTIVE_CLASS, RowEmpty } from '@/components/common/page/RowList';
import { colorDot } from '@/components/common/fields/colorDot';
import { dayKey, formatShortDate } from '@/utils/dates';
import { issuePath } from '@/utils/paths';
import { cn } from '@/lib/utils';
import { SkeletonRows } from '../DashboardCard';
import { useCrossProjectIssuesQuery } from '../../services/tasks.service';

export function useMyOpenTasks(limit: number) {
  return useCrossProjectIssuesQuery(
    { page: 1, pageSize: limit },
    { assignee: 'me', stateType: 'open' },
  );
}

// One of the reader's tasks in a card: its key (mono, as in the sidebar), the title, the
// state as a dot, and the due date (red once it is past). The row opens the task.
export function TaskRow({ issue }: { issue: CrossProjectIssue }) {
  const overdue = issue.dueDate != null && issue.dueDate < dayKey(new Date().toISOString());
  return (
    <Link
      href={issuePath(issue.projectKey, issue.sequenceNumber)}
      className={cn(ROW_CLASS, ROW_INTERACTIVE_CLASS)}
    >
      <span className="w-14 shrink-0 truncate font-mono text-xs text-muted-foreground" dir="ltr">
        {issue.identifier}
      </span>
      <span className="min-w-0 flex-1 truncate" dir="auto">
        {issue.title}
      </span>
      <span className="flex shrink-0 items-center" title={issue.stateName}>
        {colorDot(issue.stateColor)}
      </span>
      <span
        className={cn(
          'shrink-0 text-end text-xs whitespace-nowrap tabular-nums',
          overdue ? 'text-status-danger' : 'text-muted-foreground',
        )}
      >
        {issue.dueDate ? formatShortDate(issue.dueDate) : ''}
      </span>
    </Link>
  );
}

export default function MyTaskRows({ limit }: { limit: number }) {
  const t = useTranslations('home');
  const query = useMyOpenTasks(limit);
  if (query.isPending) return <SkeletonRows count={Math.min(4, limit)} />;
  const issues = query.data?.items ?? [];
  if (issues.length === 0) return <RowEmpty icon={<ListTodo />}>{t('tasks.empty')}</RowEmpty>;
  return (
    <>
      {issues.slice(0, limit).map((issue) => (
        <TaskRow key={issue.id} issue={issue} />
      ))}
    </>
  );
}
