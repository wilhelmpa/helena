'use client';

import { closestCenter, type DragEndEvent } from '@dnd-kit/core';
import DndContext from '@/components/common/dnd/DndContext';
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IconButton, Menu, MenuContent, MenuItem, MenuTrigger } from '@/design-system';
import { useStripSortSensors } from '@/lib/dnd';
import type { OwnerTerminalKind } from '@/lib/api/endpoints/owner-terminal';
import TerminalTab from './TerminalTab';
import { tabKey, type OpenTerminalTab } from '../utils/terminalTabs';

// The open terminals as tabs in the panel's own tab look: drag one to reorder them
// (owner, 2026-09-24), X ends its session. "+" offers only what is not open yet — each
// terminal once (owner, 28.09., O26) — and disappears when all are open.
export default function TerminalTabBar({
  tabs,
  addable,
  activeKey,
  onSelect,
  onClose,
  onAdd,
  onReorder,
}: {
  tabs: OpenTerminalTab[];
  addable: OwnerTerminalKind[];
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
    <div className="ds-terminal-bar">
      <div className="ds-panel-tabs">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tabs.map(tabKey)} strategy={horizontalListSortingStrategy}>
            <div className="ds-panel-tabs-track" role="tablist" aria-label={t('label')}>
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
            </div>
          </SortableContext>
        </DndContext>
        {addable.length > 0 && (
          <Menu>
            <MenuTrigger asChild>
              <IconButton label={t('add')} size="small">
                <Plus size={15} />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="start">
              {addable.map((kind) => (
                <MenuItem key={kind} onSelect={() => onAdd(kind)}>
                  {t(kind)}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        )}
      </div>
    </div>
  );
}
