import { useState, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { Filter, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { View } from '@/lib/api/endpoints/views';
import { useStripSortSensors } from '@/lib/dnd';
import { usePermissions } from '@/hooks/usePermissions';
import AllViewTab, { ALL_DROP_ID } from '@/components/layout/AllViewTab';
import MobileViewSwitcher from '@/components/layout/MobileViewSwitcher';
import SavedViewTab from '@/components/layout/SavedViewTab';
import ViewTabChrome from '@/components/layout/ViewTabChrome';
import ViewTabLabel from '@/components/layout/ViewTabLabel';
import ViewFolderManager from '@/components/layout/ViewFolderManager';
import { useUpdateView, useViewFoldersQuery } from '@/services/views.service';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';

// The row of saved-view tabs above a project, plus a New view button and, on the
// right, the filter and display toggles. The leading "All" tab is implicit and
// has no filters; it cannot be deleted. The saved tabs are a horizontal sortable
// list — dragging one reorders it and persists via onReorder. The filter toggle
// shows the filter row, which filters the current screen only; onEdit opens the
// edit bar for a view (see WorkItemsPage).
export default function ViewTabs({
  views,
  projectKey,
  activeViewId,
  onSelect,
  onNewView,
  onEdit,
  onDelete,
  onReorder,
  onToggleFilter,
  displayControl,
  embedded = false,
}: {
  views: View[];
  projectKey: string;
  activeViewId: number | null;
  onSelect: (id: number | null) => void;
  onNewView: () => void;
  onEdit: (view: View) => void;
  onDelete: (view: View) => void;
  onReorder: (draggedId: number, targetId: number | null) => void;
  onToggleFilter: () => void;
  displayControl: ReactNode;
  // Rendered into the Shell's single-row header (useShellHeaderExtra) instead of
  // standing alone as its own bordered, full-height row: no WorkspaceHeader chrome
  // of its own, since AppHeader already supplies the row's height and border.
  embedded?: boolean;
}) {
  const t = useTranslations('views');
  const { can } = usePermissions();
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

  const Wrapper = embedded ? 'div' : WorkspaceHeader;
  const wrapperProps = embedded
    ? { className: 'flex min-w-0 flex-1 items-center gap-1' }
    : { className: 'gap-1 px-2 sm:px-3' };

  return (
    <Wrapper {...wrapperProps}>
      {/* Mobile: views collapse into a dropdown (no drag reorder there). */}
      <div className="flex min-w-0 flex-1 items-center sm:hidden">
        <MobileViewSwitcher
          views={views}
          activeViewId={activeViewId}
          canCreate={canCreateView}
          onSelect={onSelect}
          onNewView={onNewView}
        />
      </div>

      {/* Desktop: the scrollable, reorderable tab strip. */}
      <div className="hidden min-w-0 flex-1 [scrollbar-width:none] items-center gap-1 overflow-x-auto overflow-y-hidden sm:flex">
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
                <span className="flex items-center gap-1.5 py-1 pr-2 pl-2">
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
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3.5" />
            {t('newView')}
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 pl-2">
        {canEditView && <ViewFolderManager projectKey={projectKey} folders={folders} />}
        <button
          type="button"
          onClick={onToggleFilter}
          title={t('filter')}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Filter className="size-4" />
        </button>
        {displayControl}
      </div>
    </Wrapper>
  );
}
