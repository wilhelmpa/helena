import { ChevronDown, ChevronRight } from 'lucide-react';
import { type IssueGroup } from '@/utils/project';
import { TableDropZone } from './TableDropZone';

// A sub-group header row (only present when sub-grouped). A drop onto it appends
// to the sub-group's bucket.
export function TableSubHeader({
  sub,
  count,
  collapsed,
  dropId,
  onDrop,
  onToggle,
}: {
  sub: IssueGroup;
  count: number;
  collapsed: boolean;
  dropId: string;
  onDrop: (issueId: number) => void;
  onToggle: () => void;
}) {
  return (
    <TableDropZone
      id={dropId}
      onDrop={onDrop}
      className="flex items-center bg-muted/20 py-1 pr-4 pl-9"
    >
      <button
        type="button"
        onClick={onToggle}
        className="board-column-heading flex items-center gap-2 text-muted-foreground"
      >
        {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: sub.color ?? 'var(--muted-foreground)' }}
        />
        {sub.name}
        <span className="text-muted-foreground/70">{count}</span>
      </button>
    </TableDropZone>
  );
}
