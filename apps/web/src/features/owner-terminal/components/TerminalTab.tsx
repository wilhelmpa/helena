import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OpenTerminalTab } from '../OwnerTerminalPanel';
const tabKey = (tab: OpenTerminalTab) => `${tab.kind}:${tab.name}`;

export default function TerminalTab({
  tab,
  active,
  label,
  closeLabel,
  onSelect,
  onClose,
}: {
  tab: OpenTerminalTab;
  active: boolean;
  label: string;
  closeLabel: string;
  onSelect: () => void;
  onClose: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tabKey(tab),
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-xs',
        active ? 'bg-sidebar-accent font-medium' : 'text-muted-foreground hover:bg-sidebar-accent',
        isDragging && 'z-10 opacity-80',
      )}
    >
      <button
        type="button"
        className="max-w-32 cursor-pointer truncate"
        onClick={onSelect}
        {...attributes}
        {...listeners}
      >
        {label}
        {tab.name !== 'main' && (
          <span className="ms-1 font-mono text-xs opacity-70">{tab.name}</span>
        )}
      </button>
      <button
        type="button"
        aria-label={closeLabel}
        title={closeLabel}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onClose}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
