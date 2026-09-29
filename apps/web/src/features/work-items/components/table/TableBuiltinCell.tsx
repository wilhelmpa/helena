import { CalendarClock } from 'lucide-react';
import type { Issue } from '@/lib/api/endpoints/issues';
import { type Maps } from '@/utils/project';
import { formatDurationShort, formatShortDate, isDueOverdue } from '@/utils/dates';
import { formatMinutes } from '@/utils/estimate';
import { usePriorityLabel } from '@/hooks/usePriorityLabel';
import { useSession } from '@/lib/auth-client';
import { BoardHintPill } from '../shared/BoardHintPill';
import {
  AssigneeAvatar,
  DateBadge,
  DelegateAvatar,
} from '@/features/issue/components/shared/IssueBadges';
import { PriorityIcon, StateIcon } from '@/features/issue/components/shared/IssueIcons';
import { type TableColumn } from '../../utils/table';
import { StatusBox } from '@/design-system';

const DASH = <span className="text-muted-foreground/40">—</span>;

// One built-in property cell in a table row.
export function TableBuiltinCell({
  column,
  issue,
  maps,
}: {
  column: TableColumn;
  issue: Issue;
  maps: Maps;
}) {
  const priorityLabel = usePriorityLabel();
  const { data: session } = useSession();
  switch (column) {
    case 'status': {
      const col = maps.columnById.get(issue.columnId);
      // The status as its own box, the same as in the list (owner, O43/O45).
      return (
        <div className="flex min-w-0 items-center">
          {col ? (
            <StatusBox
              stateType={col.stateType}
              icon={<StateIcon stateType={col.stateType} color={col.color} />}
            >
              {col.name}
            </StatusBox>
          ) : (
            DASH
          )}
        </div>
      );
    }
    case 'priority':
      return (
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {issue.priority ? (
            <>
              <PriorityIcon priority={issue.priority} className="size-3.5 shrink-0" />
              <span className="truncate">{priorityLabel(issue.priority)}</span>
            </>
          ) : (
            DASH
          )}
        </div>
      );
    case 'type': {
      const type = issue.typeId != null ? maps.typeById.get(issue.typeId) : undefined;
      return (
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {type ? (
            <>
              <span
                className="inline-block size-2 shrink-0 rounded-full"
                style={{ backgroundColor: type.color }}
              />
              <span className="truncate">{type.name}</span>
            </>
          ) : (
            DASH
          )}
        </div>
      );
    }
    case 'assignee': {
      const assignee =
        issue.assigneeUserId != null ? maps.assigneeById.get(issue.assigneeUserId) : undefined;
      return (
        <div className="flex justify-end">
          {assignee && assignee.userId !== session?.user.id ? (
            <AssigneeAvatar name={assignee.name} image={assignee.image} />
          ) : (
            DASH
          )}
        </div>
      );
    }
    case 'delegate': {
      const delegate =
        issue.delegateUserId != null ? maps.assigneeById.get(issue.delegateUserId) : undefined;
      return (
        <div className="flex justify-end">
          {delegate ? <DelegateAvatar name={delegate.name} image={delegate.image} /> : DASH}
        </div>
      );
    }
    case 'goal':
      return (
        <div className="truncate text-xs text-muted-foreground">{issue.goal?.title ?? DASH}</div>
      );
    case 'cycle':
      return (
        <div className="truncate text-xs text-muted-foreground">{issue.cycle?.name ?? DASH}</div>
      );
    case 'labels':
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-1 overflow-hidden">
          {issue.labelIds.length > 0
            ? issue.labelIds.map((id) => {
                const label = maps.labelById.get(id);
                if (!label) return null;
                return <BoardHintPill key={id} name={label.name} />;
              })
            : DASH}
        </div>
      );
    case 'estimatePoints':
      return <div className="text-xs text-muted-foreground">{issue.estimatePoints ?? DASH}</div>;
    case 'estimateTime':
      return (
        <div className="text-xs text-muted-foreground">
          {issue.estimateMinutes == null ? DASH : formatMinutes(issue.estimateMinutes)}
        </div>
      );
    case 'startDate':
      return (
        <div className="text-xs text-muted-foreground">
          {issue.startDate ? formatShortDate(issue.startDate) : DASH}
        </div>
      );
    case 'dueDate':
      return (
        <div className="text-xs">
          {issue.dueDate ? (
            <DateBadge
              icon={<CalendarClock className="size-2.5" />}
              date={issue.dueDate}
              overdue={isDueOverdue(issue.dueDate, maps.columnById.get(issue.columnId)?.stateType)}
            />
          ) : (
            DASH
          )}
        </div>
      );
    case 'created':
      return (
        <div className="text-xs text-muted-foreground">{formatShortDate(issue.createdAt)}</div>
      );
    case 'updated':
      return (
        <div className="text-xs text-muted-foreground">{formatShortDate(issue.updatedAt)}</div>
      );
    case 'statusAge':
      return (
        <div className="text-xs text-muted-foreground">
          {formatDurationShort(issue.statusSince)}
        </div>
      );
  }
}
