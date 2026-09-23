import { useState, type DragEvent } from 'react';
import type { FileItem } from '@/lib/api/endpoints/projectFiles';
import { ENTRY_TYPE, isEntryDrag, startEntryDrag } from '../utils/fileDrag';

// Dragging entries onto folders (a row, a tile, a breadcrumb) to move them. `over` is
// the folder the pointer is on, for its highlight.
export function useFileEntryDrag(
  enabled: boolean,
  onDrop: (entry: string, folder: string) => void,
) {
  const [over, setOver] = useState<string | null>(null);

  return {
    over,
    source: (item: FileItem) =>
      enabled
        ? { draggable: true, onDragStart: (event: DragEvent) => startEntryDrag(event, item.path) }
        : {},
    target: (folder: string) =>
      enabled
        ? {
            onDragOver(event: DragEvent) {
              if (!isEntryDrag(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setOver(folder);
            },
            onDragLeave() {
              setOver((current) => (current === folder ? null : current));
            },
            onDrop(event: DragEvent) {
              if (!isEntryDrag(event)) return;
              event.preventDefault();
              event.stopPropagation();
              setOver(null);
              onDrop(event.dataTransfer.getData(ENTRY_TYPE), folder);
            },
          }
        : {},
  };
}

export type FileEntryDrag = ReturnType<typeof useFileEntryDrag>;
