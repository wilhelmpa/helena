'use client';

import { closestCenter, type DragEndEvent } from '@dnd-kit/core';
import DndContext from '@/components/common/dnd/DndContext';
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useStripSortSensors } from '@/lib/dnd';
import { OWNER_TERMINAL_KINDS, type OwnerTerminalKind } from '@/lib/api/endpoints/owner-terminal';
import TerminalTab from './TerminalTab';
import { useOwnerTerminalLocalModels } from '../services/owner-terminal.service';
import type { OpenTerminalTab } from '../OwnerTerminalPanel';

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
  const localModels = useOwnerTerminalLocalModels();
  const available = ADD_ORDER.filter(
    (kind) =>
      !kind.startsWith('local-') ||
      localModels.data?.some((model) => model.kind === kind && model.ready),
  );

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
          {available.map((kind) => (
            <DropdownMenuItem key={kind} onClick={() => onAdd(kind)}>
              {t(kind)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
