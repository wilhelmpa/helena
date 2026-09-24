import { ChevronDown, ChevronRight } from 'lucide-react';
import { colorDot } from '@/components/common/fields/colorDot';

// A group header above the cycles of one status, collapsible like the work items
// table sections. `count` is how many cycles the group holds in all, which for the
// archive is more than the rows loaded under it.
export default function CycleTableSection({
  label,
  color,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  color: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex h-8 w-full items-center gap-2 border-b bg-sidebar-accent/40 px-3 text-sm font-medium text-foreground hover:bg-sidebar-accent/70"
    >
      {collapsed ? (
        <ChevronRight className="size-3.5 text-muted-foreground" />
      ) : (
        <ChevronDown className="size-3.5 text-muted-foreground" />
      )}
      {colorDot(color)}
      {label}
      <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
    </button>
  );
}
