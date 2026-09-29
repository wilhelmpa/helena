import { request } from '@/lib/api/core/client';
import type { AgUiEvent } from './agentChat';

export type FollowupMode = 'inject' | 'after' | 'replace';
export interface Followup {
  id: string;
  mode: FollowupMode;
  state: 'pending' | 'applied' | 'queued';
  prompt: string;
  nextId: number | null;
  position?: { sessionId: string; seq: number; step: number };
}
export interface Followups {
  modes: FollowupMode[];
  items: Followup[];
}
export interface FollowupTarget {
  scopeKey: string;
  agentId: number;
  kind: 'chat' | 'run';
  id: number;
}
const path = ({ scopeKey, agentId, kind, id }: FollowupTarget) => {
  const scope = scopeKey.startsWith('team:')
    ? `/teams/${scopeKey.slice(5)}`
    : `/projects/${encodeURIComponent(scopeKey)}`;
  return `${scope}/ai-agents/${agentId}/${kind === 'chat' ? 'chat' : 'runs'}/${id}/followups`;
};
export const getFollowups = (target: FollowupTarget) => request<Followups>(path(target));
export const sendFollowup = (
  target: FollowupTarget,
  input: { id: string; prompt: string; mode: FollowupMode },
) => request<Followup>(path(target), { method: 'POST', body: JSON.stringify(input) });
export function followupEvent(event: AgUiEvent): Followup | null {
  if (event.type !== 'CUSTOM' || event.name !== 'message_injected') return null;
  const value = event.value as Partial<Followup> | null;
  if (
    !value ||
    typeof value.id !== 'string' ||
    typeof value.prompt !== 'string' ||
    !['inject', 'after', 'replace'].includes(value.mode ?? '') ||
    !['pending', 'applied', 'queued'].includes(value.state ?? '') ||
    (value.nextId !== null && typeof value.nextId !== 'number')
  )
    return null;
  return value as Followup;
}

export function mergeFollowup(items: Followup[], item: Followup): Followup[] {
  const index = items.findIndex((old) => old.id === item.id);
  if (index < 0) return [...items, item];
  if (items[index]!.state !== 'pending' && item.state === 'pending') return items;
  return items.map((old, i) => (i === index ? { ...old, ...item } : old));
}
