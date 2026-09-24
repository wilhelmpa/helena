import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { LayoutDashboard, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Dashboard } from '@/lib/api/endpoints/dashboards';
import { useStripSortSensors } from '@/lib/dnd';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/usePermissions';
import {
  PAGE_CONTROL_ACTIVE_CLASS,
  PAGE_CONTROL_CLASS,
  PageTabs,
  PAGE_PRIMARY_CLASS,
  usePageToolbarRoom,
} from '@/components/layout/PageToolbar';
import DashboardTab from './DashboardTab';

// The dashboard tabs, first in the page's header row (PageToolbar). Each named
// dashboard is a sortable tab; the active one exposes Rename/Delete. When the
// project has no dashboards, a single "Overview" tab stands in for the built-in
// default. When the row runs out of room the tabs fold into one dropdown, and New,
// Rename and Delete move into the row's "…" menu (see DashboardsPage).
export default function DashboardTabs({
  dashboards,
  activeDashboardId,
  isVirtual,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onReorder,
}: {
  dashboards: Dashboard[];
  activeDashboardId: number | null;
  isVirtual: boolean;
  onSelect: (id: number) => void;
  onNew: () => void;
  onRename: (d: Dashboard) => void;
  onDelete: (d: Dashboard) => void;
  onReorder: (draggedId: number, targetId: number) => void;
}) {
  const t = useTranslations('dashboards');
  const { can } = usePermissions();
  const room = usePageToolbarRoom();
  const canCreate = can('dashboards', 'create');
  const canEdit = can('dashboards', 'edit');
  const canDelete = can('dashboards', 'delete');
  const sensors = useStripSortSensors();
  const [activeId, setActiveId] = useState<number | null>(null);
  const dragged = activeId != null ? dashboards.find((d) => d.id === activeId) : null;

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (over && active.id !== over.id) onReorder(Number(active.id), Number(over.id));
  }

  if (dashboards.length === 0) {
    return (
      <div className="flex shrink-0 items-center gap-0.5">
        <span className={cn(PAGE_CONTROL_CLASS, PAGE_CONTROL_ACTIVE_CLASS, 'h-7')}>
          <LayoutDashboard aria-hidden="true" />
          {t('defaultName')}
        </span>
        {canCreate && room.tabs && <NewDashboardButton onClick={onNew} />}
      </div>
    );
  }

  if (!room.tabs) {
    return (
      <PageTabs
        label={t('options')}
        value={String(isVirtual ? '' : (activeDashboardId ?? ''))}
        onChange={(id) => onSelect(Number(id))}
        items={dashboards.map((d) => ({
          value: String(d.id),
          label: d.name,
          icon: LayoutDashboard,
        }))}
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
        <SortableContext
          items={dashboards.map((d) => d.id)}
          strategy={horizontalListSortingStrategy}
        >
          {dashboards.map((d) => (
            <DashboardTab
              key={d.id}
              dashboard={d}
              active={!isVirtual && activeDashboardId === d.id}
              canEdit={canEdit}
              canDelete={canDelete}
              onSelect={() => onSelect(d.id)}
              onRename={() => onRename(d)}
              onDelete={() => onDelete(d)}
            />
          ))}
        </SortableContext>
        <DragOverlay>
          {dragged ? (
            <span className={cn(PAGE_CONTROL_CLASS, PAGE_CONTROL_ACTIVE_CLASS, 'h-7 shadow-md')}>
              <LayoutDashboard aria-hidden="true" />
              {dragged.name}
            </span>
          ) : null}
        </DragOverlay>
      </DndContext>
      {canCreate && <NewDashboardButton onClick={onNew} />}
    </div>
  );
}

function NewDashboardButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations('dashboards');
  return (
    <button type="button" onClick={onClick} className={cn(PAGE_CONTROL_CLASS, PAGE_PRIMARY_CLASS)}>
      <Plus aria-hidden="true" />
      {t('newDashboard')}
    </button>
  );
}
