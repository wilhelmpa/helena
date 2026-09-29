'use client';

import { createContext } from 'react';

// What a file's overlay lets its actions do: an action that shows another surface (the chat)
// has to put the overlay away first, or that surface opens behind it.
export interface FileOverlayContext {
  // Saves what is open, then closes (and unpins) the overlay.
  dismiss: () => void;
}

export const FileOverlayCtx = createContext<FileOverlayContext | null>(null);
