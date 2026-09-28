import Link from 'next/link';
import { FolderKanban } from 'lucide-react';
import type { CrossProjectIssue } from '@/lib/api/endpoints/issues';
import { usePriorityLabel } from '@/hooks/usePriorityLabel';
import { dayKey, formatDate } from '@/utils/dates';
import { issuePath } from '@/utils/paths';
import { cn } from '@/lib/utils';
import { colorDot } from '@/components/common/fields/colorDot';
import HomeTaskPeople from './HomeTaskPeople';

// One task of the Home lists. It opens the task in its project, where it is edited.
export default function HomeTaskRow({ issue }: { issue: CrossProjectIssue }) {
  const priorityLabel = usePriorityLabel();
  const overdue = issue.dueDate != null && issue.dueDate < dayKey(new Date().toISOString());

  return (
    <Link
      href={issuePath(issue.projectKey, issue.sequenceNumber)}
      className="flex h-8 min-w-0 items-center gap-3 rounded-md px-2 text-sm transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
    >
      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground max-sm:w-14" dir="ltr">
        {issue.identifier}
      </span>
      <span className="min-w-0 flex-1 truncate" dir="auto">
        {issue.title}
      </span>
      {issue.areaName && (
        <span className="hidden max-w-40 shrink-0 items-center gap-1 truncate text-xs text-muted-foreground md:flex">
          <FolderKanban className="size-3.5 shrink-0" />
          <span className="truncate">{issue.areaName}</span>
        </span>
      )}
      <span className="hidden w-32 shrink-0 items-center gap-1.5 truncate text-xs text-muted-foreground sm:flex">
        {colorDot(issue.stateColor)}
        <span className="truncate">{issue.stateName}</span>
      </span>
      <span className="hidden w-16 shrink-0 truncate text-xs text-muted-foreground lg:block">
        {issue.priority ? priorityLabel(issue.priority) : ''}
      </span>
      <span
        className={cn(
          'w-24 shrink-0 text-end text-xs text-muted-foreground max-sm:w-auto',
          overdue ? 'text-destructive' : 'max-sm:hidden',
        )}
      >
        {issue.dueDate ? formatDate(issue.dueDate) : ''}
      </span>
      <HomeTaskPeople issue={issue} />
    </Link>
  );
}
