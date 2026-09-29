'use client';

import { createContext, useCallback, useContext } from 'react';
import type { ChatFolder } from '@/lib/api/endpoints/userPreferences';
import { useAccountPreferences, useUpdateAccountPreferences } from '@/services/preferences.service';

const NONE: ChatFolder[] = [];

// The member's chat folders (O4), saved with the account's preferences so they are the
// same on every device.
export function useChatFolders() {
  const prefs = useAccountPreferences();
  const { mutate } = useUpdateAccountPreferences();
  const folders = prefs.homeDashboard.chatFolders ?? NONE;
  const save = useCallback(
    (next: ChatFolder[]) =>
      mutate({ homeDashboard: { ...prefs.homeDashboard, chatFolders: next } }),
    [mutate, prefs.homeDashboard],
  );
  return { folders, save };
}

// Read once by the list (ChatListPaneBody) and handed to its rows and folder headings,
// instead of every row reading the preferences itself. Outside a list: no folders.
export const ChatFoldersContext = createContext<ReturnType<typeof useChatFolders>>({
  folders: NONE,
  save: () => {},
});

export const useChatFoldersContext = () => useContext(ChatFoldersContext);
