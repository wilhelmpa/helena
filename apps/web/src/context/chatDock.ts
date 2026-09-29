'use client';

import { createContext, useContext } from 'react';

// The chat of the Werkzeug-Panel while another tab is in front (owner 29.09., Auftrag
// 116): it stays mounted and moves to a narrow bar at the bottom of the panel — the
// composer with the microphone and the last answer in one line — which opens into a chat
// area over the composer. The same component instance keeps the answer that is streaming
// in, the draft and a running conversation; only this context changes.
export interface ChatDockState {
  // Open into a chat area (the transcript over the composer); closed it is one line.
  expanded: boolean;
  onToggle: () => void;
  // Brings the chat to the front as the panel's tab again.
  onOpenTab: () => void;
}

export const ChatDockCtx = createContext<ChatDockState | null>(null);

// The dock the chat is shown in, or null where it is a tab or a page of its own.
export function useChatDock(): ChatDockState | null {
  return useContext(ChatDockCtx);
}
