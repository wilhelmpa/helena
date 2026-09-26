import Link from 'next/link';
import type { CrossProjectIssue } from '@/lib/api/endpoints/issues';
import { ROW_CLASS, ROW_INTERACTIVE_CLASS } from '@/components/common/page/RowList';
import { colorDot } from '@/components/common/fields/colorDot';
import { formatShortDate } from '@/utils/dates';
import { issuePath } from '@/utils/paths';
import { cn } from '@/lib/utils';
import HomeTaskPeople from '../../components/HomeTaskPeople';

// One task: its key (mono, as in the sidebar), the title, its state as a dot, and the due
// date (red once it is past). The row opens the task.
export default function DashboardTaskRow({
  issue,
  today,
}: {
  issue: CrossProjectIssue;
  today: string | null;
}) {
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
      <HomeTaskPeople issue={issue} />
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
