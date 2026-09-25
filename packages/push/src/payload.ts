import { createHash } from 'node:crypto';
import type { PushDeliveryMessage } from '@repo/db/schema';

// What the service worker (apps/web/public/sw.js) reads from a push.
export interface PushPayload {
  v: 1;
  category: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  renotify?: boolean;
  requireInteraction?: boolean;
  at: string;
}

// RFC 8030 §5.4: at most 32 characters of the base64url alphabet. A hash of the tag, so the
// alarm and its recovery share one topic: whichever is newer replaces the other while the
// device is offline.
export function pushTopic(tag: string): string {
  return createHash('sha256').update(tag).digest('base64url').slice(0, 32);
}

// A text cut to `max` characters, with an ellipsis where it was cut.
function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

export function pushPayload(message: PushDeliveryMessage): PushPayload {
  return {
    v: 1,
    category: message.category,
    title: clip(message.title, 120),
    body: clip(message.body, 600),
    url: message.url,
    tag: message.tag,
    ...(message.renotify ? { renotify: true } : {}),
    ...(message.requireInteraction ? { requireInteraction: true } : {}),
    at: message.at,
  };
}
