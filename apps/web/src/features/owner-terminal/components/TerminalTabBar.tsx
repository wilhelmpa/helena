'use client';

import { closestCenter, type DragEndEvent } from '@dnd-kit/core';
import DndContext from '@/components/common/dnd/DndContext';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useStripSortSensors } from '@/lib/dnd';
import { cn } from '@/lib/utils';
import { OWNER_TERMINAL_KINDS, type OwnerTerminalKind } from '@/lib/api/endpoints/owner-terminal';
import type { OpenTerminalTab } from '../OwnerTerminalPanel';

// Fixed startable kinds, in the order the "+" menu offers them (design's
// Nachtrag: "Shell, Claude Code, Codex, Helena weiterentwickeln"). Helena
// weiterentwickeln covers both agents in the dev clone, listed as two rows here
// rather than a submenu -- there is no third choice to hide behind one.
const ADD_ORDER: OwnerTerminalKind[] = [...OWNER_TERMINAL_KINDS];

const tabKey = (tab: OpenTerminalTab) => `${tab.kind}:${tab.name}`;

// The open terminals as tabs: drag one to reorder them (owner, 2026-09-24: "die Shells
// in der Reihenfolge ändern können"), X ends its session.
export default function TerminalTabBar({
  tabs,
  activeKey,
  onSelect,
  onClose,
  onAdd,
  onReorder,
}: {
  tabs: OpenTerminalTab[];
  activeKey: string;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onAdd: (kind: OwnerTerminalKind) => void;
  onReorder: (fromKey: string, toKey: string) => void;
}) {
  const t = useTranslations('ownerTerminal.kinds');
  const sensors = useStripSortSensors();

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  }

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b px-1">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map(tabKey)} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab) => (
            <TerminalTab
              key={tabKey(tab)}
              tab={tab}
              active={tabKey(tab) === activeKey}
              label={t(tab.kind)}
              closeLabel={t('close')}
              onSelect={() => onSelect(tabKey(tab))}
              onClose={() => onClose(tabKey(tab))}
            />
          ))}
        </SortableContext>
      </DndContext>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-6">
            <Plus className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {ADD_ORDER.map((kind) => (
            <DropdownMenuItem key={kind} onClick={() => onAdd(kind)}>
              {t(kind)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function TerminalTab({
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
