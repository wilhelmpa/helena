import { closestCenter, type DragEndEvent } from '@dnd-kit/core';
import DndContext from '@/components/common/dnd/DndContext';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStripSortSensors } from '@/lib/dnd';
import { cn } from '@/lib/utils';
import type { InitiativesTab } from '@/utils/paths';
import { PageTabs, usePageToolbarRoom } from '@/components/layout/PageToolbar';
import { useIsMobile } from '@/hooks/use-mobile';

export type InitiativeTabItem = { value: InitiativesTab; label: string; count?: number };

// The status tabs of the initiatives page, in the header row like every page's tabs
// (PageTabs' look), but sortable by drag: the order is a preference of the browser
// (useInitiativeTabOrder). When the row runs out of room they fold into PageTabs'
// dropdown, which keeps the order and drops only the dragging.
export default function InitiativeTabs({
  items,
  value,
  label,
  onSelect,
  onReorder,
}: {
  items: InitiativeTabItem[];
  value: InitiativesTab;
  label: string;
  onSelect: (value: InitiativesTab) => void;
  onReorder: (from: InitiativesTab, to: InitiativesTab) => void;
}) {
  const room = usePageToolbarRoom();
  const mobile = useIsMobile();
  const sensors = useStripSortSensors();
  if (!room.tabs || mobile)
    return <PageTabs items={items} value={value} onChange={onSelect} label={label} folded />;

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id)
      onReorder(active.id as InitiativesTab, over.id as InitiativesTab);
  };

  return (
    <nav aria-label={label} className="ds-segmented">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={items.map((item) => item.value)}
          strategy={horizontalListSortingStrategy}
        >
          {items.map((item) => (
            <SortableTab
              key={item.value}
              item={item}
              active={item.value === value}
              onSelect={() => onSelect(item.value)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </nav>
  );
}

// Selecting is a click, not a press: pressing a tab to drag it must not navigate and
// unmount the drag context before the reorder lands (dnd-kit swallows the click a
// finished drag leaves behind). Only the pointer listeners of useSortable are taken,
// so Space and Enter keep selecting the tab.
function SortableTab({
  item,
  active,
  onSelect,
}: {
  item: InitiativeTabItem;
  active: boolean;
  onSelect: () => void;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.value,
  });
  const { onKeyDown: _keyboardDrag, ...pointerListeners } = listeners ?? {};
  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-current={active ? 'page' : undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'z-10 cursor-grabbing')}
      {...pointerListeners}
      onClick={onSelect}
    >
      <span>{item.label}</span>
      {item.count != null ? (
        <span className="text-xs font-normal text-muted-foreground tabular-nums">
          {item.count > 99 ? '99+' : item.count}
        </span>
      ) : null}
    </button>
  );
}
