'use client';

import { useEffect } from 'react';

// A file of Wissen sent to the chat ("An Chat anhängen", owner 29.09., O80): the composer
// that is open — or opens next — picks it up and attaches it the way a member who typed
// its vault path would. The queue lives outside React because the chat is another tree
// (the tool panel) than the page the action is used on.
export interface QueuedChatAttachment {
  // The canonical vault path (Projects/<KEY>/Docs/plan.md).
  path: string;
  name: string;
}

let queue: QueuedChatAttachment[] = [];
const listeners = new Set<() => void>();

export function queueChatAttachment(attachment: QueuedChatAttachment) {
  queue = [...queue.filter((item) => item.path !== attachment.path), attachment];
  listeners.forEach((listener) => listener());
}

function take(): QueuedChatAttachment[] {
  const taken = queue;
  queue = [];
  return taken;
}

export function resetChatAttachQueueForTest() {
  queue = [];
}

export function takeQueuedChatAttachments(): QueuedChatAttachment[] {
  return take();
}

// The composer's side: gets what is queued now and whatever is queued later.
export function useQueuedChatAttachments(onAttach: (items: QueuedChatAttachment[]) => void) {
  useEffect(() => {
    const drain = () => {
      const items = take();
      if (items.length > 0) onAttach(items);
    };
    drain();
    listeners.add(drain);
    return () => {
      listeners.delete(drain);
    };
  }, [onAttach]);
}
