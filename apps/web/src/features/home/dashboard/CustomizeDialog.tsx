'use client';

import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DndContext from '@/components/common/dnd/DndContext';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useDndSensors } from '@/lib/dnd';
import { cn } from '@/lib/utils';
import type { DashboardWidget } from '@/extensions/dashboardWidgets';
import type { HomeDashboardPreference } from '@/lib/api/endpoints/userPreferences';
import { moveTo, withVisibility, type Arranged } from './layout';
import { useWidgetLabel } from './WidgetView';

// One widget in "Anpassen": the grip to drag it, its name, the arrows that move it by
// keyboard or tap, and the switch that shows or hides it.
function WidgetRow({
  entry,
  first,
  last,
  onMove,
  onToggle,
}: {
  entry: Arranged<DashboardWidget>;
  first: boolean;
  last: boolean;
  onMove: (step: -1 | 1) => void;
  onToggle: (visible: boolean) => void;
}) {
  const t = useTranslations('home.customize');
  const label = useWidgetLabel()(entry.widget);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.widget.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex h-10 min-w-0 items-center gap-2 rounded-md ps-1 pe-2 text-sm',
        isDragging && 'relative z-10 bg-accent opacity-80',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t('drag', { name: label })}
        className="inline-flex size-8 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className={cn('min-w-0 flex-1 truncate', !entry.visible && 'text-muted-foreground')}>
        {label}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('up', { name: label })}
        disabled={first}
        onClick={() => onMove(-1)}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('down', { name: label })}
        disabled={last}
        onClick={() => onMove(1)}
      >
        <ArrowDown />
      </Button>
      <Switch
        checked={entry.visible}
        onCheckedChange={onToggle}
        aria-label={t('show', { name: label })}
        className="ms-1"
      />
    </li>
  );
}

// One list of "Anpassen" (the figures, or the sections), sortable by drag, arrows and
// keyboard (the grip takes Space and the arrow keys).
function WidgetList({
  title,
  entries,
  prefs,
  order,
  onChange,
}: {
  title: string;
  entries: Arranged<DashboardWidget>[];
  prefs: HomeDashboardPreference;
  // Every widget id in the order shown, both lists.
  order: string[];
  onChange: (next: HomeDashboardPreference) => void;
}) {
  const sensors = useDndSensors();
  const ids = entries.map((entry) => entry.widget.id);
  const move = (id: string, to: number) => {
    // The list's new order, put back where its widgets sit in the whole order.
    const moved = moveTo(ids, id, to);
    const slots = order.map((other) => (ids.includes(other) ? null : other));
    let next = 0;
    onChange({ ...prefs, order: slots.map((other) => other ?? moved[next++]!) });
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) move(String(active.id), ids.indexOf(String(over.id)));
  };
  return (
    <section className="min-w-0">
      <h3 className="flex h-8 items-center px-2 text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-px rounded-lg border border-sidebar-border bg-card p-1">
            {entries.map((entry, index) => (
              <WidgetRow
                key={entry.widget.id}
                entry={entry}
                first={index === 0}
                last={index === entries.length - 1}
                onMove={(step) => move(entry.widget.id, index + step)}
                onToggle={(visible) => onChange(withVisibility(prefs, entry.widget, visible))}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  );
}

// "Anpassen": which figures and sections Start shows, and in which order, for this reader
// (stored with the account, so every device shows the same Start).
export default function CustomizeDialog({
  open,
  onOpenChange,
  figures,
  sections,
  prefs,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  figures: Arranged<DashboardWidget>[];
  sections: Arranged<DashboardWidget>[];
  prefs: HomeDashboardPreference;
  onChange: (next: HomeDashboardPreference) => void;
}) {
  const t = useTranslations('home.customize');
  const order = [...figures, ...sections].map((entry) => entry.widget.id);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <WidgetList
          title={t('figures')}
          entries={figures}
          prefs={prefs}
          order={order}
          onChange={onChange}
        />
        <WidgetList
          title={t('sections')}
          entries={sections}
          prefs={prefs}
          order={order}
          onChange={onChange}
        />
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onChange({ ...prefs, order: [], hidden: [], shown: [] })}
          >
            {t('reset')}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
