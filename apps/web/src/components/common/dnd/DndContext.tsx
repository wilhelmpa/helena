'use client';

import { type ComponentProps } from 'react';
// The one place that imports dnd-kit's own DndContext (see no-restricted-imports).
import { DndContext as DndKitContext, type Announcements } from '@dnd-kit/core';
import { useTranslations } from 'next-intl';

// dnd-kit's DndContext with the screen-reader texts in the interface's language: its
// built-in announcements and instructions are English ("Draggable item 3 was dropped
// over droppable area group:1"). Every drag surface uses this one.
export default function DndContext(props: ComponentProps<typeof DndKitContext>) {
  const t = useTranslations('common.dnd');
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('pickedUp', { id: String(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? t('movedOver', { id: String(active.id), over: String(over.id) })
        : t('notOver', { id: String(active.id) }),
    onDragEnd: ({ active, over }) =>
      over
        ? t('droppedOver', { id: String(active.id), over: String(over.id) })
        : t('dropped', { id: String(active.id) }),
    onDragCancel: ({ active }) => t('cancelled', { id: String(active.id) }),
  };
  return (
    <DndKitContext
      {...props}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t('instructions') },
        ...props.accessibility,
      }}
    />
  );
}
