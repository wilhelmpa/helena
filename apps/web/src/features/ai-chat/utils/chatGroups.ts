import type { ChatSummary } from '@/lib/api/endpoints/agentChat';
import { dayKey } from '@/utils/dates';

// The sections of the chat list: the pinned chats, then the others by when they were
// last written in. Past the last month, each calendar month is a section of its own.
export type ChatGroupKey =
  | 'pinned'
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | `m:${string}`
  // By project (`p:KEY`, `p:` for Helena's own chats) or by agent (`a:<id>`).
  | `p:${string}`
  | `a:${number}`;

export interface ChatGroup {
  key: ChatGroupKey;
  chats: ChatSummary[];
  // The heading of a project or agent group; date groups are named by the list.
  label?: string;
}

// How the list is sorted into sections (owner, 28.09., O4: groups).
export type ChatGrouping = 'time' | 'project' | 'agent';

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

// The chats in sections by project or by agent: the pinned ones first as before, then one
// section per project (Helena's own chats first) or per agent, each in the list's order,
// the sections by their newest chat.
export function groupChatsBy(
  chats: ChatSummary[],
  by: 'project' | 'agent',
  helenaLabel: string,
): ChatGroup[] {
  const pinned = chats.filter((chat) => chat.pinned);
  const sections = new Map<string, ChatGroup>();
  for (const chat of chats) {
    if (chat.pinned) continue;
    const key: ChatGroupKey =
      by === 'project' ? `p:${chat.project?.key ?? ''}` : `a:${chat.agent.id}`;
    const label =
      by === 'project' ? (chat.project?.name ?? helenaLabel) : chat.agent.name;
    const section = sections.get(key) ?? { key, chats: [], label };
    section.chats.push(chat);
    sections.set(key, section);
  }
  const ordered = [...sections.values()];
  if (by === 'project') {
    const home = ordered.findIndex((group) => group.key === 'p:');
    if (home > 0) ordered.unshift(...ordered.splice(home, 1));
  }
  return [...(pinned.length ? [{ key: 'pinned' as const, chats: pinned }] : []), ...ordered];
}
