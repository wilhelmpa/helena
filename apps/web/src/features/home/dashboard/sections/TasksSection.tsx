'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ListTodo } from 'lucide-react';
import type { CrossProjectIssue } from '@/lib/api/endpoints/issues';
import { ROW_CLASS, ROW_INTERACTIVE_CLASS, RowEmpty } from '@/components/common/page/RowList';
import { colorDot } from '@/components/common/fields/colorDot';
import { useNow } from '@/features/provider-limits/hooks/useNow';
import { dayKey, formatShortDate } from '@/utils/dates';
import { issuePath, tasksPath } from '@/utils/paths';
import { cn } from '@/lib/utils';
import { DashboardSection, SkeletonRows } from '../DashboardParts';
import { useCrossProjectIssuesQuery } from '../../services/tasks.service';

const PAGE = { page: 1, pageSize: 20 };
const FILTERS = { assignee: 'me', stateType: 'open' } as const;
const SHOWN = 6;

// The reader's open tasks, soonest due first: one read for the section and the tile.
export function useMyOpenTasks() {
  return useCrossProjectIssuesQuery(PAGE, FILTERS);
}

// One task: its key (mono, as in the sidebar), the title, its state as a dot, and the due
// date (red once it is past). The row opens the task.
function TaskRow({ issue, today }: { issue: CrossProjectIssue; today: string | null }) {
  const overdue = today !== null && issue.dueDate != null && issue.dueDate < today;
  return (
    <Link
      href={issuePath(issue.projectKey, issue.sequenceNumber)}
      className={cn(ROW_CLASS, ROW_INTERACTIVE_CLASS)}
    >
      <span className="w-16 shrink-0 truncate font-mono text-xs text-muted-foreground" dir="ltr">
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

// "Meine Aufgaben": the reader's open tasks, with the way to all of them.
export default function TasksSection() {
  const t = useTranslations('home');
  const query = useMyOpenTasks();
  const now = useNow(60_000);
  const today = now === null ? null : dayKey(new Date(now).toISOString());
  const issues = query.data?.items ?? [];
  return (
    <DashboardSection
      label={t('widgets.my-tasks')}
      count={query.data?.total}
      href={`${tasksPath()}?assignee=me`}
      hrefLabel={t('links.all')}
    >
      {query.isPending ? (
        <SkeletonRows count={SHOWN} />
      ) : issues.length === 0 ? (
        <RowEmpty icon={<ListTodo />}>{t('tasks.empty')}</RowEmpty>
      ) : (
        issues
          .slice(0, SHOWN)
          .map((issue) => <TaskRow key={issue.id} issue={issue} today={today} />)
      )}
    </DashboardSection>
  );
}
