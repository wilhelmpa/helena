import { useState } from 'react';
import { closestCenter, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import DndContext from '@/components/common/dnd/DndContext';
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { View } from '@/lib/api/endpoints/views';
import { useStripSortSensors } from '@/lib/dnd';
import { usePermissions } from '@/hooks/usePermissions';
import AllViewTab, { ALL_DROP_ID } from '@/components/layout/AllViewTab';
import MobileViewSwitcher from '@/components/layout/MobileViewSwitcher';
import SavedViewTab from '@/components/layout/SavedViewTab';
import ViewTabChrome from '@/components/layout/ViewTabChrome';
import ViewTabLabel from '@/components/layout/ViewTabLabel';
import {
  PAGE_CONTROL_CLASS,
  PAGE_PRIMARY_CLASS,
  usePageToolbarRoom,
} from '@/components/layout/PageToolbar';
import { cn } from '@/lib/utils';
import { useUpdateView, useViewFoldersQuery } from '@/services/views.service';

// The board's saved-view tabs, the first thing in its header row (PageToolbar): the
// leading "All" tab, which is implicit, has no filters and cannot be deleted, the
// saved tabs as a horizontal sortable list (dragging one reorders it and persists
// via onReorder) and a New view button. When the row runs out of room the strip
// folds into one dropdown of the same views (MobileViewSwitcher), like every page's
// tabs. The filter, display and area controls sit at the end of the row (see
// WorkItemsPage).
export default function ViewTabs({
  views,
  projectKey,
  activeViewId,
  onSelect,
  onNewView,
  onEdit,
  onDelete,
  onReorder,
}: {
  views: View[];
  projectKey: string;
  activeViewId: number | null;
  onSelect: (id: number | null) => void;
  onNewView: () => void;
  onEdit: (view: View) => void;
  onDelete: (view: View) => void;
  onReorder: (draggedId: number, targetId: number | null) => void;
}) {
  const t = useTranslations('views');
  const { can } = usePermissions();
  const room = usePageToolbarRoom();
  const canCreateView = can('views', 'create');
  const canEditView = can('views', 'edit');
  const canDeleteView = can('views', 'delete');
  const sensors = useStripSortSensors();
  const { data: folders = [] } = useViewFoldersQuery(projectKey);
  const updateView = useUpdateView(projectKey);
  // The view being dragged, used to render the DragOverlay preview.
  const [activeId, setActiveId] = useState<number | null>(null);
  const activeView = activeId != null ? (views.find((v) => v.id === activeId) ?? null) : null;

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const draggedId = Number(active.id);
    if (over.id === ALL_DROP_ID) {
      // Move to the front of the stored order. The tab row is not that order —
      // favorites are pinned ahead of it — so the front cannot be named by a tab.
      onReorder(draggedId, null);
      return;
    }
    if (over.id !== active.id) onReorder(draggedId, Number(over.id));
  }

  // Folded (no drag reorder there): the views in one dropdown showing the active one.
  if (!room.tabs) {
    return (
      <MobileViewSwitcher
        views={views}
        activeViewId={activeViewId}
        canCreate={canCreateView}
        onSelect={onSelect}
        onNewView={onNewView}
      />
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => setActiveId(Number(e.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <AllViewTab
          active={activeViewId === null}
          dragging={activeId != null}
          onClick={() => onSelect(null)}
        />

        <SortableContext items={views.map((v) => v.id)} strategy={horizontalListSortingStrategy}>
          {views.map((view) => (
            <SavedViewTab
              key={view.id}
              view={view}
              projectKey={projectKey}
              active={activeViewId === view.id}
              canEdit={canEditView}
              canDelete={canDeleteView}
              onSelect={() => onSelect(view.id)}
              onEdit={() => onEdit(view)}
              onDelete={() => onDelete(view)}
              folders={folders}
              onMove={(folderId) => updateView.mutate({ id: view.id, input: { folderId } })}
            />
          ))}
        </SortableContext>

        <DragOverlay>
          {activeView ? (
            <ViewTabChrome active className="cursor-grabbing shadow-md">
              <span className="flex items-center gap-1.5 px-2">
                <ViewTabLabel view={activeView} />
              </span>
            </ViewTabChrome>
          ) : null}
        </DragOverlay>
      </DndContext>

      {canCreateView && (
        <button
          type="button"
          onClick={onNewView}
          title={t('newViewHint')}
          className={cn(PAGE_CONTROL_CLASS, PAGE_PRIMARY_CLASS)}
        >
          <Plus aria-hidden="true" />
          {t('newView')}
        </button>
      )}
    </div>
  );
}
