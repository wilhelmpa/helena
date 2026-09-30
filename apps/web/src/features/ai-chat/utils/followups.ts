import type { Followup, FollowupMode, FollowupTarget } from '@/lib/api/endpoints/agentFollowups';
import type { PlanUIMessage } from './chatMessages';

// The steering modes in the order the composer offers them; the first one the runtime
// supports is the default ("Einschieben", or "Danach" where a runtime only knows that).
export const FOLLOWUP_MODE_ORDER: FollowupMode[] = ['inject', 'after', 'replace'];

export function orderedModes(modes: FollowupMode[]): FollowupMode[] {
  return FOLLOWUP_MODE_ORDER.filter((mode) => modes.includes(mode));
}

export function defaultFollowupMode(modes: FollowupMode[]): FollowupMode | null {
  return orderedModes(modes)[0] ?? null;
}

const numericId = (id: string) => (/^\d+$/.test(id) ? Number(id) : null);

// The answer a follow-up instruction goes to: the newest answer of the open chat, once the
// server knows it by its number (a question just sent has none until the stream starts).
export function followupTargetOf(
  scopeKey: string,
  fallbackAgentId: number,
  messages: PlanUIMessage[],
): FollowupTarget | null {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return null;
  const id = numericId(last.id);
  if (id == null) return null;
  return {
    scopeKey,
    agentId: last.metadata?.agentId ?? fallbackAgentId,
    kind: 'chat',
    id,
  };
}

// What the transcript shows about an instruction. "After" ones become the next turn's
// own question once the server has queued it, so only a waiting one is a note; inject
// and replace stay notes of the answer they steered.
export function visibleFollowups(items: Followup[]): Followup[] {
  return items.filter((item) => item.mode !== 'after' || item.state === 'pending');
}

// The answers queued behind the current one that the chat does not hold yet, in order.
export function queuedAnswers(items: Followup[], messages: PlanUIMessage[]): number[] {
  const held = new Set(messages.map((message) => message.id));
  return items.flatMap((item) =>
    item.state === 'queued' && item.nextId != null && !held.has(String(item.nextId))
      ? [item.nextId]
      : [],
  );
}

export const hasWaiting = (items: Followup[]) => items.some((item) => item.state === 'pending');
