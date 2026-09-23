import type { FileItem } from '@/lib/api/endpoints/projectFiles';

export type FileSortKey = 'name' | 'modified' | 'size';
export interface FileSort {
  key: FileSortKey;
  descending: boolean;
}

function compare(a: FileItem, b: FileItem, key: FileSortKey): number {
  if (key === 'modified') return (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '');
  if (key === 'size') return (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0);
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

// The entries of a folder as the toolbar asks for them: those whose name contains the
// filter, folders before files, each group in the chosen order.
export function visibleItems(items: FileItem[], filter: string, sort: FileSort): FileItem[] {
  const needle = filter.trim().toLocaleLowerCase();
  return items
    .filter((item) => !needle || item.name.toLocaleLowerCase().includes(needle))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      const order = compare(a, b, sort.key) || compare(a, b, 'name');
      return sort.descending ? -order : order;
    });
}
