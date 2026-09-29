import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X } from 'lucide-react';
import { tabKey, type OpenTerminalTab } from '../utils/terminalTabs';

// One terminal in the tab strip — the same tab the tool panel's head uses
// (.ds-panel-tab): a name, X on hover and when selected.
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
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.8 : undefined,
      }}
      className="ds-panel-tab"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className="ds-panel-tab-select"
        onClick={onSelect}
        {...attributes}
        {...listeners}
      >
        <span>{label}</span>
      </button>
      <button
        type="button"
        aria-label={`${closeLabel}: ${label}`}
        title={closeLabel}
        className="ds-panel-tab-close"
        onClick={onClose}
      >
        <X size={13} />
      </button>
    </div>
  );
}
