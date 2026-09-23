import type { ChatSummary } from '@/lib/api/endpoints/agentChat';
import { dayKey } from '@/utils/dates';

// The sections of the chat list: the pinned chats, then the others by when they were
// last written in. Past the last month, each calendar month is a section of its own.
export type ChatGroupKey = 'pinned' | 'today' | 'yesterday' | 'week' | 'month' | `m:${string}`;

export interface ChatGroup {
  key: ChatGroupKey;
  chats: ChatSummary[];
}

function daysBetween(fromKey: string, toKey: string): number {
  const utc = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(toKey) - utc(fromKey)) / 86_400_000);
}

export function chatGroupKey(updatedAt: string, now: Date): ChatGroupKey {
  const day = dayKey(updatedAt);
  const age = daysBetween(day, dayKey(now.toISOString()));
  if (age <= 0) return 'today';
  if (age === 1) return 'yesterday';
  if (age < 7) return 'week';
  if (age < 30) return 'month';
  return `m:${day.slice(0, 7)}`;
}

// The chats in their sections, in the order the list shows them. The list arrives
// pinned first and then newest first, so the sections come out in order.
export function groupChats(chats: ChatSummary[], now: Date): ChatGroup[] {
  const groups: ChatGroup[] = [];
  for (const chat of chats) {
    const key = chat.pinned ? 'pinned' : chatGroupKey(chat.updatedAt, now);
    const last = groups.at(-1);
    if (last?.key === key) last.chats.push(chat);
    else groups.push({ key, chats: [chat] });
  }
  return groups;
}
