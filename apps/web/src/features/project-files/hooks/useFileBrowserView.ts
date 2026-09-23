import { useState } from 'react';
import type { FileSort } from '../utils/fileSort';

export type FileViewMode = 'list' | 'grid';

const VIEW_KEY = 'files:view';

function savedMode(): FileViewMode {
  if (typeof window === 'undefined') return 'list';
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

// How the reader looks at a folder: the name filter, the order, and list or grid. The
// mode is remembered in this browser.
export function useFileBrowserView() {
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<FileSort>({ key: 'name', descending: false });
  const [mode, setModeState] = useState<FileViewMode>(savedMode);

  const setMode = (next: FileViewMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Storage can be blocked; the mode then lasts for the page only.
    }
  };

  return { filter, setFilter, sort, setSort, mode, setMode };
}
