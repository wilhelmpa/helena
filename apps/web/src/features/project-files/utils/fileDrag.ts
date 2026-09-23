import type { DragEvent } from 'react';
import { baseName, childPath, parentPath } from '@/utils/vaultLinks';

// An entry dragged inside the Files page carries its path under a type of its own, so
// a drop can tell it from files dragged in from the computer.
export const ENTRY_TYPE = 'application/x-volition-file-entry';

export function startEntryDrag(event: DragEvent, path: string) {
  event.dataTransfer.setData(ENTRY_TYPE, path);
  event.dataTransfer.effectAllowed = 'move';
}

export const isEntryDrag = (event: DragEvent) => event.dataTransfer.types.includes(ENTRY_TYPE);

// Where an entry dropped on `folder` goes, or null when the drop changes nothing or
// would put a folder into itself.
export function moveTarget(entry: string, folder: string): string | null {
  if (parentPath(entry) === folder) return null;
  if (folder === entry || folder.startsWith(`${entry}/`)) return null;
  return childPath(folder, baseName(entry));
}
